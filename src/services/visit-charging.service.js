const Job = require('../models/Job');
const Series = require('../models/Series');
const User = require('../models/User');
const { hasRecurringConsent } = require('./customer-card.service');
const stripeService = require('./stripe.service');
const notifications = require('./notification.service');
const { EVENTS, transition } = require('./payment-state-machine');
const logger = require('../utils/logger');

const HOUR = 3600 * 1000;
// A visit is charged this long before it starts: late enough for the customer to
// skip it for free, early enough to try a failed card again.
const CHARGE_AHEAD_HOURS = 48;
// A declined card is tried once more this much later.
const RETRY_AFTER_HOURS = 12;
// A visit still unpaid this close to its start is skipped, so a cleaner never
// turns up for a visit that has not been paid for.
const GIVE_UP_AHEAD_HOURS = 24;
const MAX_ATTEMPTS = 2;
// This many visits in a row skipped for payment pauses the series.
const PAUSE_AFTER_FAILURES = 2;

function attemptKey(job, attempt) {
  return `visit:${job._id}:a${attempt}`;
}

// A visit that will not happen. Only a visit that is still scheduled (never
// charged) can be skipped this way; the claim stops two sweeps both doing it.
async function skipScheduledVisit(jobId, reason) {
  return Job.findOneAndUpdate(
    { _id: jobId, visitState: 'scheduled' },
    { $set: { visitState: 'skipped', status: 'cancelled', skipReason: reason } },
    { new: true }
  );
}

async function recordPaymentSkip(series, job) {
  const updated = await Series.findOneAndUpdate({ _id: series._id }, { $inc: { paymentFailureStreak: 1 } }, { new: true });
  notifications.visitSkipped(job, { reason: 'payment' });
  if (updated && updated.paymentFailureStreak >= PAUSE_AFTER_FAILURES && updated.status === 'active') {
    updated.status = 'paused';
    updated.pausedBy = 'payment';
    updated.pausedAt = new Date();
    await updated.save();
    notifications.seriesPaused(updated, { reason: 'payment' });
  }
}

// One failed attempt: undo the booking made for it, tell the customer, and either
// schedule the retry or skip the visit.
async function handleDeclined(job, series, attempt, now, reason) {
  logger.info(`[visit-charging] Visit ${job._id} attempt ${attempt} not paid (${reason})`);

  if (job.stripePaymentIntentId) {
    await stripeService.cancelPaymentIntent(job.stripePaymentIntentId).catch(() => {});
  }
  // Back to a visit that has not been charged. The state machine has no step for
  // "unbook", so this is set directly; nothing was paid on the intent.
  const startsAt = job.preferredStartAt;
  // The retry itself must fall more than 24 hours before the visit, or there is no point.
  const proposedRetryAt = new Date(now.getTime() + RETRY_AFTER_HOURS * HOUR);
  const canRetry = attempt < MAX_ATTEMPTS && startsAt.getTime() - proposedRetryAt.getTime() > GIVE_UP_AHEAD_HOURS * HOUR;
  const retryAt = canRetry ? proposedRetryAt : undefined;

  job.paymentStatus = undefined;
  job.stripePaymentIntentId = undefined;
  job.bookedAt = undefined;
  job.visitState = 'scheduled';
  job.nextChargeAttemptAt = retryAt;
  await job.save();

  if (canRetry) {
    notifications.visitPaymentFailed(job, { retryAt });
    return 'retry';
  }
  const skipped = await skipScheduledVisit(job._id, 'payment');
  if (skipped) await recordPaymentSkip(series, skipped);
  return 'skipped';
}

// Charges one scheduled visit to the customer's saved card. Returns what happened:
// 'paid' (the webhook completes it), 'retry', 'skipped', 'pending' or 'busy'.
async function chargeVisit(job, series, now = new Date()) {
  const before = job.chargeAttempts || 0;
  const attempt = before + 1;

  // Claim this attempt, so two sweeps (or two servers) never charge it twice.
  const claimed = await Job.findOneAndUpdate(
    {
      _id: job._id,
      visitState: 'scheduled',
      chargeAttempts: before === 0 ? { $in: [null, 0] } : before,
    },
    { $set: { chargeAttempts: attempt }, $unset: { nextChargeAttemptAt: 1 } },
    { new: true }
  );
  if (!claimed) return 'busy';

  const customer = await User.findById(series.customer);
  const card = customer && customer.savedCard;
  if (!customer || !customer.stripeCustomerId || !card || !card.paymentMethodId || !hasRecurringConsent(customer)) {
    return handleDeclined(claimed, series, attempt, now, 'no saved card or no agreement to recurring charges');
  }

  // Book the visit and store the intent BEFORE asking Stripe to take the money, so
  // the payment webhook always finds the visit when it arrives.
  let intent;
  try {
    intent = await stripeService.createPaymentIntent({
      amountPence: claimed.pricePence,
      metadata: { jobId: claimed._id.toString(), seriesId: series._id.toString(), visit: String(claimed.visitNumber) },
      customerId: customer.stripeCustomerId,
      paymentMethodId: card.paymentMethodId,
      idempotencyKey: attemptKey(claimed, attempt),
    });
  } catch (err) {
    // Nothing was booked or charged: let the next sweep try this attempt again.
    await Job.updateOne({ _id: claimed._id }, { $set: { chargeAttempts: before } });
    throw err;
  }

  claimed.stripePaymentIntentId = intent.id;
  claimed.bookedAt = now;
  claimed.visitState = undefined;
  transition(claimed, EVENTS.BOOK);
  await claimed.save();

  try {
    const result = await stripeService.confirmOffSession({
      paymentIntentId: intent.id,
      paymentMethodId: card.paymentMethodId,
      idempotencyKey: `${attemptKey(claimed, attempt)}:confirm`,
    });
    if (result.status === 'succeeded' || result.status === 'processing') {
      await Series.updateOne({ _id: series._id }, { $set: { paymentFailureStreak: 0 } });
      return 'paid';
    }
    // requires_action: the bank wants the customer present. Treated as a decline.
    return handleDeclined(claimed, series, attempt, now, result.status);
  } catch (err) {
    if (err.type === 'StripeCardError') {
      return handleDeclined(claimed, series, attempt, now, err.code || 'card_error');
    }
    // We cannot tell whether the money was taken (e.g. a timeout). Leave the visit
    // booked with its intent: the payment webhook settles it if it did go through,
    // and otherwise the customer can pay or cancel it as an ordinary unpaid job.
    logger.error(`[visit-charging] Visit ${claimed._id}: could not confirm payment: ${err.message}`);
    return 'pending';
  }
}

// The sweep: every scheduled visit that is due.
async function runChargeSweep(now = new Date()) {
  const dueBy = new Date(now.getTime() + CHARGE_AHEAD_HOURS * HOUR);
  const due = await Job.find({
    visitState: 'scheduled',
    preferredStartAt: { $lte: dueBy },
    $or: [{ nextChargeAttemptAt: null }, { nextChargeAttemptAt: { $exists: false } }, { nextChargeAttemptAt: { $lte: now } }],
  });

  const counts = { paid: 0, retry: 0, skipped: 0, pending: 0, busy: 0, waiting: 0 };
  for (const job of due) {
    try {
      // A visit whose time has passed without being charged never happened.
      if (job.preferredStartAt <= now) {
        await skipScheduledVisit(job._id, 'missed');
        counts.skipped += 1;
        continue;
      }
      const series = await Series.findById(job.series);
      if (!series || series.status === 'cancelled' || series.status === 'ended') {
        await skipScheduledVisit(job._id, 'series_ended');
        counts.skipped += 1;
        continue;
      }
      if (series.status !== 'active') {
        counts.waiting += 1; // paused: left alone until the customer decides
        continue;
      }
      // Too close to the visit to try again: give up on a card that already failed.
      if ((job.chargeAttempts || 0) >= 1 && job.preferredStartAt.getTime() - now.getTime() <= GIVE_UP_AHEAD_HOURS * HOUR) {
        const skipped = await skipScheduledVisit(job._id, 'payment');
        if (skipped) await recordPaymentSkip(series, skipped);
        counts.skipped += 1;
        continue;
      }
      const outcome = await chargeVisit(job, series, now);
      counts[outcome] = (counts[outcome] || 0) + 1;
    } catch (err) {
      logger.error(`[visit-charging] Visit ${job._id}: ${err.message}`);
    }
  }
  return counts;
}

module.exports = {
  CHARGE_AHEAD_HOURS,
  RETRY_AFTER_HOURS,
  GIVE_UP_AHEAD_HOURS,
  MAX_ATTEMPTS,
  PAUSE_AFTER_FAILURES,
  skipScheduledVisit,
  chargeVisit,
  runChargeSweep,
};
