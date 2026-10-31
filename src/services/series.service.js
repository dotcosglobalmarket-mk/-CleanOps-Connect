const Job = require('../models/Job');
const Series = require('../models/Series');
const User = require('../models/User');
const { STATES } = require('./payment-state-machine');
const { londonParts, londonToUtc, daysInMonth } = require('../utils/london-time');
const notifications = require('./notification.service');
const logger = require('../utils/logger');

const RECURRING_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'];
const DEFAULT_SERIES_MONTHS = 6;
// Visits are made this far ahead, so cleaners and customers can see what is coming.
const GENERATE_AHEAD_DAYS = 14;

// Recurring bookings ship switched off and are turned on with this setting once
// the screens and charging are in place.
function isEnabled() {
  return process.env.RECURRING_JOBS_ENABLED === 'true';
}

function isRecurringJob(job) {
  return Boolean(job) && job.category === 'domestic' && RECURRING_FREQUENCIES.includes(job.frequency) && Boolean(job.preferredStartAt);
}

function addMonthsLocal({ year, month, day, hour, minute }, months) {
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  // The 31st becomes the 30th or 28th in a short month, and returns to the 31st after.
  return { year: y, month: m, day: Math.min(day, daysInMonth(y, m)), hour, minute };
}

function addDaysLocal({ year, month, day, hour, minute }, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute };
}

// The start of visit n (visit 1 is firstVisitAt), keeping the same UK clock time.
function visitAt(firstVisitAt, frequency, n) {
  const first = londonParts(firstVisitAt);
  const steps = n - 1;
  let local;
  if (frequency === 'weekly') local = addDaysLocal(first, 7 * steps);
  else if (frequency === 'fortnightly') local = addDaysLocal(first, 14 * steps);
  else if (frequency === 'monthly') local = addMonthsLocal(first, steps);
  else throw new Error(`Unknown series frequency: ${frequency}`);
  return londonToUtc(local);
}

function defaultEndsOn(firstVisitAt) {
  const first = londonParts(firstVisitAt);
  return londonToUtc(addMonthsLocal(first, DEFAULT_SERIES_MONTHS));
}

// What a cleaner is told before accepting, so a recurring booking is never a surprise.
function describeForOffer(job) {
  if (!isEnabled() || !isRecurringJob(job)) return undefined;
  const endsOn = defaultEndsOn(job.preferredStartAt);
  let visits = 0;
  while (visitAt(job.preferredStartAt, job.frequency, visits + 1) <= endsOn) visits += 1;
  return { frequency: job.frequency, endsOn, visits };
}

// Called when a cleaner accepts an offer on a recurring job. The job just booked
// becomes visit 1. A failure here must never undo the booking itself.
async function startFromBookedJob(job) {
  if (!isEnabled() || !isRecurringJob(job) || job.series) return null;
  try {
    const series = await Series.create({
      customer: job.customer,
      cleaner: job.cleaner,
      firstJob: job._id,
      serviceType: job.serviceType,
      category: job.category,
      postcode: job.postcode,
      lat: job.lat,
      lng: job.lng,
      description: job.description,
      estimatedHours: job.estimatedHours,
      budgetMin: job.budgetMin,
      budgetMax: job.budgetMax,
      frequency: job.frequency,
      pricePence: job.pricePence,
      firstVisitAt: job.preferredStartAt,
      endsOn: defaultEndsOn(job.preferredStartAt),
    });
    await Job.updateOne({ _id: job._id }, { $set: { series: series._id, visitNumber: 1 } });
    return series;
  } catch (err) {
    logger.error(`[series] Could not start a series for job ${job._id}: ${err.message}`);
    return null;
  }
}

// Money has been taken for visit 1 and the job is not cancelled or refunded.
const VISIT_ONE_PAID = new Set([
  STATES.PAID_HELD,
  STATES.IN_PROGRESS,
  STATES.AWAITING_CONFIRMATION,
  STATES.DISPUTED,
  STATES.CONFIRMED,
  STATES.PAYOUT_PENDING,
  STATES.PAYOUT_BLOCKED,
  STATES.TRANSFER_FAILED,
  STATES.MANUAL_REVIEW_HOLD,
  STATES.RESOLVED_PAYOUT,
  STATES.RESOLVED_PARTIAL,
  STATES.PAID_OUT,
]);
const VISIT_ONE_ENDED = new Set([
  STATES.CANCELLED,
  STATES.CANCELLED_BY_CLEANER,
  STATES.CANCELLED_BY_CUSTOMER,
  STATES.REFUNDED,
  STATES.PARTIALLY_REFUNDED,
  STATES.RESOLVED_REFUND,
]);

// Moves a series that has been waiting for visit 1 to be paid and a card to be
// saved into active, or stops it if visit 1 fell through. Returns whether it is active.
async function settleStatus(series) {
  if (series.status === 'active') return true;
  if (series.status !== 'awaiting_card') return false;

  const first = await Job.findById(series.firstJob);
  if (!first || VISIT_ONE_ENDED.has(first.paymentStatus)) {
    series.status = 'cancelled';
    await series.save();
    return false;
  }
  if (!VISIT_ONE_PAID.has(first.paymentStatus)) return false;

  const customer = await User.findById(series.customer);
  if (!customer || !customer.savedCard || !customer.savedCard.paymentMethodId) return false;

  series.status = 'active';
  series.activatedAt = new Date();
  await series.save();
  notifications.seriesStarted(series, { who: 'customer' });
  notifications.seriesStarted(series, { who: 'cleaner' });
  return true;
}

function visitDocument(series, number, startsAt) {
  return {
    customer: series.customer,
    serviceType: series.serviceType,
    category: series.category,
    postcode: series.postcode,
    lat: series.lat,
    lng: series.lng,
    description: series.description,
    estimatedHours: series.estimatedHours,
    frequency: series.frequency,
    budgetMin: series.budgetMin,
    budgetMax: series.budgetMax,
    procurement: 'standard',
    status: 'allocated',
    cleaner: series.cleaner,
    pricePence: series.pricePence,
    preferredStartAt: startsAt,
    series: series._id,
    visitNumber: number,
    visitState: 'scheduled',
  };
}

// Makes any visits due within the look-ahead for one series. Safe to run again at
// any time: a visit that already exists is skipped, never duplicated.
async function generateVisits(series, now = new Date()) {
  if (!(await settleStatus(series))) return 0;

  const horizon = new Date(now.getTime() + GENERATE_AHEAD_DAYS * 24 * 3600 * 1000);
  let made = 0;
  let number = series.visitsCreated;

  for (;;) {
    const next = number + 1;
    const startsAt = visitAt(series.firstVisitAt, series.frequency, next);
    if (startsAt > series.endsOn) {
      if (now > series.endsOn) {
        series.status = 'ended';
        await series.save();
      }
      break;
    }
    if (startsAt > horizon) break;

    // A date that passed while the series was paused is simply not made.
    if (startsAt <= now) {
      number = next;
      continue;
    }

    try {
      await Job.create(visitDocument(series, next, startsAt));
      made += 1;
    } catch (err) {
      // Another run already made this visit (the unique series + visit index).
      if (err.code !== 11000) throw err;
    }
    number = next;
  }

  if (number !== series.visitsCreated) {
    await Series.updateOne({ _id: series._id }, { $max: { visitsCreated: number } });
    series.visitsCreated = number;
  }
  return made;
}

// 14 days before a series ends, tells the customer it will not renew by itself.
// Each series is claimed first, so the email goes out once however often this runs.
const RENEWAL_NOTICE_DAYS = 14;

async function sendRenewalReminders(now = new Date()) {
  const soon = new Date(now.getTime() + RENEWAL_NOTICE_DAYS * 24 * 3600 * 1000);
  const due = await Series.find({
    status: 'active',
    endsOn: { $gt: now, $lte: soon },
    renewalReminderSentAt: null,
    endNoticeGivenAt: null,
  });
  let sent = 0;
  for (const series of due) {
    const claimed = await Series.findOneAndUpdate(
      { _id: series._id, renewalReminderSentAt: null },
      { $set: { renewalReminderSentAt: now } },
      { new: true }
    );
    if (claimed) {
      notifications.seriesRenewalReminder(claimed);
      sent += 1;
    }
  }
  return sent;
}

// The daily sweep: every series that is waiting or running.
async function runVisitGenerator(now = new Date()) {
  if (!isEnabled()) return { series: 0, visits: 0 };

  const all = await Series.find({ status: { $in: ['awaiting_card', 'active'] } });
  let visits = 0;
  for (const series of all) {
    try {
      visits += await generateVisits(series, now);
    } catch (err) {
      logger.error(`[series] Visit generation failed for series ${series._id}: ${err.message}`);
    }
  }
  try {
    await sendRenewalReminders(now);
  } catch (err) {
    logger.error(`[series] Renewal reminders failed: ${err.message}`);
  }
  return { series: all.length, visits };
}

module.exports = {
  RECURRING_FREQUENCIES,
  GENERATE_AHEAD_DAYS,
  isEnabled,
  isRecurringJob,
  visitAt,
  defaultEndsOn,
  describeForOffer,
  startFromBookedJob,
  generateVisits,
  sendRenewalReminders,
  runVisitGenerator,
};
