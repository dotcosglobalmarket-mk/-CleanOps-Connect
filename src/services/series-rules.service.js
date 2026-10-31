const Job = require('../models/Job');
const Series = require('../models/Series');
const User = require('../models/User');
const CleanerProfile = require('../models/CleanerProfile');
const paymentService = require('./payment.service');
const visitCharging = require('./visit-charging.service');
const notifications = require('./notification.service');
const { STATES } = require('./payment-state-machine');
const logger = require('../utils/logger');

// The cleaner must give this much notice to end a whole series.
const CLEANER_NOTICE_DAYS = 14;
// A second visit cancelled by the cleaner pauses the series.
const PAUSE_AFTER_CLEANER_CANCELLATIONS = 2;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function customerSeries(seriesId, userId) {
  const series = await Series.findById(seriesId);
  if (!series) throw httpError(404, 'Series not found');
  if (String(series.customer) !== String(userId)) throw httpError(403, 'You do not have access to this series');
  return series;
}

async function cleanerSeries(seriesId, userId) {
  const series = await Series.findById(seriesId);
  if (!series) throw httpError(404, 'Series not found');
  const profile = await CleanerProfile.findOne({ user: userId });
  if (!profile || String(series.cleaner) !== String(profile._id)) throw httpError(403, 'You do not have access to this series');
  return series;
}

async function visitOf(series, jobId) {
  const job = await Job.findById(jobId);
  if (!job || String(job.series) !== String(series._id)) throw httpError(404, 'Visit not found');
  return job;
}

const LIVE = ['awaiting_card', 'active', 'paused'];

// --- Customer ---

// Skip one visit. Free until it is charged (48 hours ahead); after that it is paid
// for, so the usual late-cancellation rule applies (half back).
async function skipVisit(seriesId, jobId, userId) {
  const series = await customerSeries(seriesId, userId);
  const job = await visitOf(series, jobId);
  if (job.visitNumber === 1) {
    throw httpError(400, 'The first visit is cancelled like any other job, from its own page');
  }

  if (job.visitState === 'scheduled') {
    const skipped = await visitCharging.skipScheduledVisit(job._id, 'customer');
    if (!skipped) throw httpError(409, 'This visit has just been charged. Refresh and try again.');
    notifications.visitSkipped(skipped, { reason: 'customer' });
    return skipped;
  }
  if (job.paymentStatus === STATES.BOOKED) return paymentService.cancelBooked(job._id);
  if (job.paymentStatus === STATES.PAID_HELD) return paymentService.cancelByCustomer(job._id);
  throw httpError(400, 'This visit can no longer be skipped');
}

async function pause(seriesId, userId) {
  const series = await customerSeries(seriesId, userId);
  if (series.status !== 'active') throw httpError(400, 'Only a running series can be paused');
  series.status = 'paused';
  series.pausedBy = 'customer';
  series.pausedAt = new Date();
  await series.save();
  notifications.seriesPausedByCustomer(series, { resumed: false });
  return series;
}

async function resume(seriesId, userId) {
  const series = await customerSeries(seriesId, userId);
  if (series.status !== 'paused') throw httpError(400, 'This series is not paused');
  const customer = await User.findById(userId);
  if (!customer || !customer.savedCard || !customer.savedCard.paymentMethodId) {
    throw httpError(400, 'Save a card first, so your visits can be paid for');
  }
  series.status = 'active';
  series.pausedBy = undefined;
  series.pausedAt = undefined;
  series.paymentFailureStreak = 0;
  // A second cleaner cancellation would pause it again at once, so start the count afresh.
  series.cleanerCancellations = 0;
  await series.save();
  notifications.seriesPausedByCustomer(series, { resumed: true });
  return series;
}

// Ends the series now. Visits not yet charged are dropped; a visit already paid for
// stays booked (the customer can skip it separately).
async function cancel(seriesId, userId) {
  const series = await customerSeries(seriesId, userId);
  if (!LIVE.includes(series.status)) throw httpError(400, 'This series has already ended');
  series.status = 'cancelled';
  series.cancelledAt = new Date();
  await series.save();
  await Job.updateMany(
    { series: series._id, visitState: 'scheduled' },
    { $set: { visitState: 'skipped', status: 'cancelled', skipReason: 'series_ended' } }
  );
  notifications.seriesCancelledByCustomer(series);
  return series;
}

// --- Cleaner ---

// The cleaner cannot do one visit. The customer is refunded in full, it is logged
// against the cleaner, and a second one pauses the series.
async function cleanerCancelVisit(seriesId, jobId, userId) {
  const series = await cleanerSeries(seriesId, userId);
  const job = await visitOf(series, jobId);

  if (job.visitState === 'scheduled') {
    const skipped = await visitCharging.skipScheduledVisit(job._id, 'cleaner');
    if (!skipped) throw httpError(409, 'This visit has just been charged. Refresh and try again.');
    notifications.visitSkipped(skipped, { reason: 'cleaner' });
  } else if (job.paymentStatus === STATES.BOOKED) {
    await paymentService.cancelBooked(job._id);
    notifications.visitSkipped(job, { reason: 'cleaner' });
  } else if (job.paymentStatus === STATES.PAID_HELD) {
    await paymentService.cancelByCleaner(job._id); // full refund, emails the customer
  } else {
    throw httpError(400, 'This visit can no longer be cancelled');
  }

  const updated = await Series.findOneAndUpdate({ _id: series._id }, { $inc: { cleanerCancellations: 1 } }, { new: true });
  logger.info(`[series] Series ${series._id}: cleaner cancellation ${updated.cleanerCancellations}, logged against the cleaner's reliability.`);
  if (updated.cleanerCancellations >= PAUSE_AFTER_CLEANER_CANCELLATIONS && updated.status === 'active') {
    updated.status = 'paused';
    updated.pausedBy = 'cleaner_cancellations';
    updated.pausedAt = new Date();
    await updated.save();
    notifications.seriesPaused(updated, { reason: 'cleaner_cancellations' });
  }
  return updated;
}

// Ending the whole series needs 14 days' notice: the last visit is the one on or
// before the date notice runs out. Visits after it are dropped.
async function cleanerEnd(seriesId, userId, now = new Date()) {
  const series = await cleanerSeries(seriesId, userId);
  if (!LIVE.includes(series.status)) throw httpError(400, 'This series has already ended');
  if (series.endNoticeGivenAt) throw httpError(400, 'You have already given notice on this series');

  const endsOn = new Date(now.getTime() + CLEANER_NOTICE_DAYS * 24 * 3600 * 1000);
  if (endsOn < series.endsOn) series.endsOn = endsOn;
  series.endNoticeGivenAt = now;
  await series.save();
  await Job.updateMany(
    { series: series._id, visitState: 'scheduled', preferredStartAt: { $gt: series.endsOn } },
    { $set: { visitState: 'skipped', status: 'cancelled', skipReason: 'series_ended' } }
  );
  notifications.seriesEndNotice(series, { endsOn: series.endsOn });
  return series;
}

module.exports = {
  CLEANER_NOTICE_DAYS,
  PAUSE_AFTER_CLEANER_CANCELLATIONS,
  skipVisit,
  pause,
  resume,
  cancel,
  cleanerCancelVisit,
  cleanerEnd,
};
