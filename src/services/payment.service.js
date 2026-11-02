const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');
const stripeService = require('./stripe.service');
const { STATES, EVENTS, transition, PaymentStateError } = require('./payment-state-machine');
const notifications = require('./notification.service');
const jobPhotos = require('./job-photo.service');
const logger = require('../utils/logger');

const MAX_TRANSFER_ATTEMPTS = 3;
const RETRY_BACKOFF_MINUTES = [5, 30, 120]; // 5min -> 30min -> 2hr
const AUTO_CONFIRM_WINDOW_HOURS = 48;
const DEFAULT_PAYOUT_HOLD_DAYS = 3;
const MAX_PAYOUT_HOLD_DAYS = 7;

// How long the cleaner's share is held after the customer confirms: card money takes a few days
// to clear, and the hold leaves time to put a problem right before it leaves the platform.
// PAYOUT_HOLD_DAYS sets it (0 to 7, default 3).
function payoutHoldDays() {
  const raw = process.env.PAYOUT_HOLD_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_PAYOUT_HOLD_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return DEFAULT_PAYOUT_HOLD_DAYS;
  return Math.min(days, MAX_PAYOUT_HOLD_DAYS);
}

// The charge behind the job's payment, so the transfer can be tied to it (see stripe.service).
// If Stripe cannot say, the transfer is still tried without it.
async function sourceChargeFor(job) {
  if (!job.stripePaymentIntentId) return undefined;
  try {
    const intent = await stripeService.retrievePaymentIntent(job.stripePaymentIntentId);
    const charge = intent && intent.latest_charge;
    return typeof charge === 'string' ? charge : charge && charge.id;
  } catch (err) {
    logger.error(`[payment] Could not read the charge for job ${job._id}: ${err.message}`);
    return undefined;
  }
}

// Reason codes a customer must pick from when raising a dispute — "reason
// code required, not free text only" per spec. Free-text detail can still
// be attached alongside one of these, but the code itself must be one of
// this fixed set so disputes are triageable.
const DISPUTE_REASON_CODES = [
  'not_completed',
  'quality_issue',
  'damage_caused',
  'no_show',
  'other',
];

// Cancellation policy — the confirmed business rule, not a placeholder: a full
// refund up to 24 hours before the job starts, 50% back after that (see
// cancellationPolicy below for jobs with no start time).
const CUSTOMER_FULL_REFUND_WINDOW_HOURS = 24;
const CUSTOMER_LATE_CANCELLATION_REFUND_RATE = 0.5;

// When a customer can still cancel a paid job for a full refund.
//  - A job with a start time: full refund until 24 hours before it starts, then 50%.
//  - A job with no start time (older jobs, tenders): 24 hours from booking, as before.
//  - A later visit of a regular booking is charged 48 hours ahead, so once paid it is
//    always a late cancellation (skipping it before it is charged is free: see
//    series-rules.service.js).
// Returned for the screen too, so the customer is told the same thing the server will do.
function cancellationPolicy(job, now = new Date()) {
  if (job.series && job.visitNumber > 1) {
    return { basis: 'visit', fullRefund: false, fullRefundUntil: null };
  }
  const window = CUSTOMER_FULL_REFUND_WINDOW_HOURS * 3600 * 1000;
  if (job.preferredStartAt) {
    const fullRefundUntil = new Date(new Date(job.preferredStartAt).getTime() - window);
    return { basis: 'start', fullRefund: now.getTime() <= fullRefundUntil.getTime(), fullRefundUntil };
  }
  // Jobs booked before bookedAt existed fall back to createdAt.
  const bookedAt = job.bookedAt || job.createdAt;
  if (!bookedAt) return { basis: 'booking', fullRefund: false, fullRefundUntil: null };
  const fullRefundUntil = new Date(new Date(bookedAt).getTime() + window);
  return { basis: 'booking', fullRefund: now.getTime() <= fullRefundUntil.getTime(), fullRefundUntil };
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function transferIdempotencyKey(job) {
  return `transfer:${job._id}`;
}

function refundIdempotencyKey(job) {
  return `refund:${job._id}`;
}

async function requireJob(jobId) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  return job;
}

// --- Booking ---

async function bookJob({ jobId, cleanerId, pricePence }) {
  const job = await requireJob(jobId);
  // Check bookability BEFORE creating a PaymentIntent so a job that is
  // already booked (or cancelled) never gets an orphaned Stripe charge.
  if (job.paymentStatus) {
    throw badRequest('This job has already been booked');
  }
  if (job.cleaner && job.cleaner.toString() !== cleanerId.toString()) {
    throw badRequest('This job has already been booked with another cleaner');
  }
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) throw notFound('Cleaner not found');
  if (cleaner.deactivationStatus === 'suspended') {
    throw badRequest('This cleaner is suspended and cannot be booked');
  }

  job.cleaner = cleaner._id;
  job.pricePence = pricePence; // set by the cleaner, immutable once booked
  job.bookedAt = new Date();

  const paymentIntent = await stripeService.createPaymentIntent({
    amountPence: pricePence,
    metadata: { jobId: job._id.toString() },
  });
  job.stripePaymentIntentId = paymentIntent.id;

  transition(job, EVENTS.BOOK);
  await job.save();
  return job;
}

// Customer cancels a booked job before paying. The PaymentIntent is
// cancelled at Stripe FIRST: if the customer's payment has just gone
// through, Stripe refuses and we keep the job, so a payment can never land
// on a job we have already cancelled.
async function cancelBooked(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.BOOKED) {
    throw badRequest('Only a booked job that has not been paid for can be cancelled this way');
  }

  if (job.stripePaymentIntentId) {
    try {
      await stripeService.cancelPaymentIntent(job.stripePaymentIntentId);
    } catch (err) {
      // Only a payment that has genuinely moved on blocks the cancel. An intent
      // Stripe no longer knows (made under another mode) was never paid: cancel.
      if (err.code === 'payment_intent_unexpected_state') {
        throw badRequest('Your payment is already being processed, so this booking cannot be cancelled without a refund. Please refresh and try again.');
      }
      if (!stripeService.isMissingResource(err)) throw err;
    }
  }

  transition(job, EVENTS.CANCEL_BOOKED);
  job.status = 'cancelled';
  await job.save();
  notifications.jobCancelled(job, { by: 'customer' });
  return job;
}

// The customer is about to pay a BOOKED (unpaid) job. Returns its PaymentIntent,
// making a fresh one if the stored one no longer exists for the Stripe key now in
// use (e.g. booked in test mode, site now live). Nothing was paid on the old one.
async function getOrRenewPaymentIntent(job) {
  try {
    return await stripeService.retrievePaymentIntent(job.stripePaymentIntentId);
  } catch (err) {
    if (!stripeService.isMissingResource(err)) throw err;
  }
  const renewed = await stripeService.createPaymentIntent({
    amountPence: job.pricePence,
    metadata: { jobId: job._id.toString() },
  });
  job.stripePaymentIntentId = renewed.id;
  await job.save();
  return renewed;
}

// --- payment_intent.succeeded webhook ---

async function handlePaymentSucceeded(paymentIntentId, amountReceivedPence) {
  const job = await Job.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!job) return null;
  if (job.paymentStatus !== STATES.BOOKED) return job; // dedup guard

  if (amountReceivedPence !== job.pricePence) {
    throw badRequest('Charge amount does not match job price');
  }

  transition(job, EVENTS.PAYMENT_SUCCEEDED);
  await job.save();
  notifications.paymentReceived(job);
  return job;
}

// --- Cancellation (pre-start) ---

async function cancelByCleaner(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.PAID_HELD) {
    throw badRequest('Job can only be cancelled by the cleaner before it has started');
  }

  transition(job, EVENTS.CANCEL_BY_CLEANER);
  job.status = 'cancelled';
  await job.save();

  await stripeService.createRefund({
    paymentIntentId: job.stripePaymentIntentId,
    idempotencyKey: refundIdempotencyKey(job),
  });

  // Dock reliability score — NOT automatic deactivation. No fully
  // automated, irreversible deactivation is permitted; any escalation must
  // route through deactivationStatus = 'under_review' for human review.
  logger.info(`[payments] Job ${job._id}: cleaner cancellation logged against reliability score.`);

  transition(job, EVENTS.REFUND_DONE);
  await job.save();
  notifications.jobCancelled(job, { by: 'cleaner', refundPence: job.pricePence });
  return job;
}

async function cancelByCustomer(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.PAID_HELD) {
    throw badRequest('Job can only be cancelled by the customer before it has started');
  }

  const isWithinFullRefundWindow = cancellationPolicy(job).fullRefund;

  transition(job, EVENTS.CANCEL_BY_CUSTOMER);
  job.status = 'cancelled';
  await job.save();

  if (isWithinFullRefundWindow) {
    await stripeService.createRefund({
      paymentIntentId: job.stripePaymentIntentId,
      idempotencyKey: refundIdempotencyKey(job),
    });
    transition(job, EVENTS.REFUND_DONE);
  } else {
    const refundPence = Math.round(job.pricePence * CUSTOMER_LATE_CANCELLATION_REFUND_RATE);
    await stripeService.createRefund({
      paymentIntentId: job.stripePaymentIntentId,
      amountPence: refundPence,
      idempotencyKey: refundIdempotencyKey(job),
    });
    transition(job, EVENTS.PARTIAL_REFUND_DONE);
  }

  await job.save();
  notifications.jobCancelled(job, { by: 'customer' });
  return job;
}

// --- In-progress / completion / confirmation ---

async function checkIn(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.CHECK_IN);
  job.status = 'in_progress';
  job.checkedInAt = new Date();
  await job.save();
  notifications.cleanerArrived(job);
  return job;
}

async function markComplete(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.MARK_COMPLETE);
  job.status = 'completed';
  job.awaitingConfirmationAt = new Date();
  await job.save();
  notifications.jobCompleted(job);
  return job;
}

async function calculateSplit(job, cleaner) {
  // Commission rate is read from the cleaner's CURRENT tier at the moment
  // of confirmation — never cached from booking time, and never applied
  // to the customer-facing price the cleaner originally set.
  const rate = cleaner.commissionTierRate;
  const commissionPence = Math.round(job.pricePence * rate);
  const cleanerPayoutPence = job.pricePence - commissionPence;
  return { rate, commissionPence, cleanerPayoutPence };
}

async function enterPayoutPending(job) {
  const cleaner = await CleanerProfile.findById(job.cleaner);
  if (!cleaner) throw notFound('Cleaner not found');

  const { rate, commissionPence, cleanerPayoutPence } = await calculateSplit(job, cleaner);
  job.commissionRate = rate;
  job.commissionPence = commissionPence;
  job.cleanerPayoutPence = cleanerPayoutPence;

  const holdDays = payoutHoldDays();
  job.payoutReleaseAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

  transition(job, EVENTS.CALCULATE_SPLIT);
  await job.save();

  // During the hold the job waits in PAYOUT_PENDING; releaseDuePayouts() sends it afterwards.
  if (holdDays > 0) return job;
  return attemptTransfer(job, cleaner);
}

async function confirmJob(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.AWAITING_CONFIRMATION) {
    throw badRequest('Job is not awaiting confirmation');
  }

  transition(job, EVENTS.CONFIRM);
  job.confirmedAt = new Date();
  job.confirmationMethod = 'customer';
  await job.save();
  await jobPhotos.scheduleExpiry(job._id);
  notifications.jobConfirmed(job);
  return enterPayoutPending(job);
}

// Called by a scheduled job (not the retry worker) to auto-confirm jobs
// whose 48hr window has passed with no dispute raised.
async function autoConfirmExpiredJobs(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_CONFIRM_WINDOW_HOURS * 60 * 60 * 1000);
  const jobs = await Job.find({
    paymentStatus: STATES.AWAITING_CONFIRMATION,
    awaitingConfirmationAt: { $lte: cutoff },
  });

  const results = [];
  for (const job of jobs) {
    transition(job, EVENTS.CONFIRM);
    job.confirmedAt = new Date();
    job.confirmationMethod = 'automatic';
    await job.save();
    await jobPhotos.scheduleExpiry(job._id);
    notifications.jobConfirmed(job);
    results.push(await enterPayoutPending(job));
  }
  return results;
}

// --- Disputes ---

async function raiseDispute(jobId, reasonCode, detail) {
  if (!DISPUTE_REASON_CODES.includes(reasonCode)) {
    throw badRequest(`reasonCode must be one of: ${DISPUTE_REASON_CODES.join(', ')}`);
  }

  const job = await requireJob(jobId);
  transition(job, EVENTS.RAISE_DISPUTE);
  job.disputeReason = reasonCode;
  job.disputeDetail = detail;
  job.disputedAt = new Date();
  await job.save();
  notifications.disputeRaised(job);
  return job;
}

async function resolveDisputeRefund(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.RESOLVE_REFUND);
  await job.save();

  await stripeService.createRefund({
    paymentIntentId: job.stripePaymentIntentId,
    idempotencyKey: refundIdempotencyKey(job),
  });

  transition(job, EVENTS.REFUND_DONE);
  await job.save();
  await jobPhotos.scheduleExpiry(job._id);
  return job;
}

async function resolveDisputePartial(jobId, { refundPence, payoutPence }) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.DISPUTED) {
    throw badRequest('Only a disputed job can be resolved');
  }
  if (refundPence + payoutPence !== job.pricePence) {
    throw badRequest('refundPence + payoutPence must equal the original job price');
  }

  const cleaner = await CleanerProfile.findById(job.cleaner);
  if (!cleaner) throw notFound('Cleaner not found');
  if (!cleaner.payoutsEnabled) {
    throw badRequest('Cleaner has not completed Stripe payouts onboarding');
  }

  transition(job, EVENTS.RESOLVE_PARTIAL);
  await job.save();

  await stripeService.createRefund({
    paymentIntentId: job.stripePaymentIntentId,
    amountPence: refundPence,
    idempotencyKey: refundIdempotencyKey(job),
  });
  const transfer = await stripeService.createTransfer({
    amountPence: payoutPence,
    destinationAccountId: cleaner.stripeConnectedAccountId,
    idempotencyKey: transferIdempotencyKey(job),
    metadata: { jobId: job._id.toString() },
  });

  job.stripeTransferId = transfer.id;
  job.cleanerPayoutPence = payoutPence;
  transition(job, EVENTS.PARTIAL_RESOLUTION_DONE);
  await job.save();
  await jobPhotos.scheduleExpiry(job._id);
  return job;
}

async function resolveDisputePayout(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.RESOLVE_PAYOUT);
  await job.save();

  transition(job, EVENTS.PROCEED_TO_CONFIRMED);
  await job.save();
  await jobPhotos.scheduleExpiry(job._id);
  return enterPayoutPending(job);
}

// --- Payout / transfer attempt + retry ---

async function attemptTransfer(job, cleaner) {
  if (!cleaner.payoutsEnabled) {
    transition(job, EVENTS.BLOCK_PAYOUT);
    await job.save();
    notifications.payoutsNeedSetup(job);
    return job;
  }

  try {
    const transfer = await stripeService.createTransfer({
      amountPence: job.cleanerPayoutPence,
      destinationAccountId: cleaner.stripeConnectedAccountId,
      idempotencyKey: transferIdempotencyKey(job),
      metadata: { jobId: job._id.toString() },
      sourceTransaction: await sourceChargeFor(job),
    });
    job.stripeTransferId = transfer.id;
    await job.save();
    // Job stays in PAYOUT_PENDING (or TRANSFER_FAILED, on a retry) until
    // the transfer.paid webhook confirms funds actually landed.
    return job;
  } catch (err) {
    return handleTransferError(job);
  }
}

async function handleTransferError(job) {
  job.payoutAttemptCount += 1;

  if (job.payoutAttemptCount > MAX_TRANSFER_ATTEMPTS) {
    transition(job, EVENTS.ESCALATE_MANUAL);
    job.nextPayoutRetryAt = undefined;
    await job.save();
    notifications.opsAlert(
      `Payout on hold: job ${String(job._id).slice(-8)}`,
      `The transfer to the cleaner failed ${MAX_TRANSFER_ATTEMPTS} times and is now in MANUAL_REVIEW_HOLD. Retry it from the payments queue once the cause is fixed.`
    );
    return job;
  }

  if (job.paymentStatus === STATES.PAYOUT_PENDING) {
    transition(job, EVENTS.TRANSFER_ERROR);
  }
  // else: already TRANSFER_FAILED from a previous attempt — stay there,
  // TRANSITIONS has no TRANSFER_FAILED -> TRANSFER_FAILED self-loop needed.

  const backoffMinutes = RETRY_BACKOFF_MINUTES[job.payoutAttemptCount - 1] || RETRY_BACKOFF_MINUTES.at(-1);
  job.nextPayoutRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
  await job.save();
  return job;
}

// Called by the retry worker for jobs in TRANSFER_FAILED whose backoff
// window has elapsed.
async function retryTransfer(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.TRANSFER_FAILED) return job;

  const cleaner = await CleanerProfile.findById(job.cleaner);
  if (!cleaner) throw notFound('Cleaner not found');

  return attemptTransfer(job, cleaner);
}

// Ops-triggered only — MANUAL_REVIEW_HOLD never auto-retries.
async function manualRetryTransfer(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.MANUAL_REVIEW_HOLD) {
    throw badRequest('Job is not in manual review hold');
  }

  const cleaner = await CleanerProfile.findById(job.cleaner);
  if (!cleaner) throw notFound('Cleaner not found');
  if (!cleaner.payoutsEnabled) {
    throw badRequest('Cleaner still has not completed Stripe payouts onboarding');
  }

  const transfer = await stripeService.createTransfer({
    amountPence: job.cleanerPayoutPence,
    destinationAccountId: cleaner.stripeConnectedAccountId,
    idempotencyKey: transferIdempotencyKey(job),
    metadata: { jobId: job._id.toString() },
    sourceTransaction: await sourceChargeFor(job),
  });
  job.stripeTransferId = transfer.id;
  await job.save();
  return job;
}

// Sends the cleaner's share once its hold has ended. Only jobs still waiting (no transfer yet)
// are picked up; the transfer uses the same idempotency key on any retry.
async function releaseDuePayouts(now = new Date()) {
  const due = await Job.find({
    paymentStatus: STATES.PAYOUT_PENDING,
    stripeTransferId: { $in: [null, ''] },
    payoutReleaseAt: { $lte: now },
  });
  const released = [];
  for (const job of due) {
    try {
      const cleaner = await CleanerProfile.findById(job.cleaner);
      if (!cleaner) continue;
      await attemptTransfer(job, cleaner);
      released.push(job._id);
    } catch (err) {
      logger.error(`[payment] Releasing payout for job ${job._id}: ${err.message}`);
    }
  }
  return released;
}

// Ops: end the hold early for a job that is waiting.
async function releasePayoutNow(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.PAYOUT_PENDING || job.stripeTransferId) {
    throw badRequest('This job is not waiting for its payout to be released');
  }
  const cleaner = await CleanerProfile.findById(job.cleaner);
  if (!cleaner) throw notFound('Cleaner not found');
  job.payoutReleaseAt = new Date();
  await job.save();
  return attemptTransfer(job, cleaner);
}

// --- Webhooks that don't go through the job payment state machine ---

async function handleTransferPaid(transferId) {
  const job = await Job.findOne({ stripeTransferId: transferId });
  if (!job) return null;
  if (![STATES.PAYOUT_PENDING, STATES.TRANSFER_FAILED, STATES.MANUAL_REVIEW_HOLD].includes(job.paymentStatus)) {
    return job; // dedup / already-terminal guard
  }

  transition(job, EVENTS.TRANSFER_PAID);
  await job.save();
  notifications.payoutSent(job);
  return job;
}

async function handleTransferFailedWebhook(transferId) {
  const job = await Job.findOne({ stripeTransferId: transferId });
  if (!job) return null;
  if (job.paymentStatus !== STATES.PAYOUT_PENDING && job.paymentStatus !== STATES.TRANSFER_FAILED) {
    return job;
  }
  return handleTransferError(job);
}

// payout.failed is about the CLEANER's own Stripe balance -> bank transfer
// bouncing. It does NOT map to any Job state — never reopen or revert a
// PAID_OUT job because of it.
async function handlePayoutFailed(connectedAccountId) {
  const cleaner = await CleanerProfile.findOne({ stripeConnectedAccountId: connectedAccountId });
  if (!cleaner) return null;
  cleaner.payoutsEnabled = false;
  await cleaner.save();
  notifications.bankPayoutFailed(cleaner);
  return cleaner;
}

async function handleAccountUpdated(connectedAccountId, payoutsEnabled) {
  const cleaner = await CleanerProfile.findOne({ stripeConnectedAccountId: connectedAccountId });
  if (!cleaner) return null;

  const wasDisabled = !cleaner.payoutsEnabled;
  cleaner.payoutsEnabled = payoutsEnabled;
  await cleaner.save();

  if (wasDisabled && payoutsEnabled) {
    const blockedJobs = await Job.find({ cleaner: cleaner._id, paymentStatus: STATES.PAYOUT_BLOCKED });
    for (const job of blockedJobs) {
      transition(job, EVENTS.RECHECK_PAYOUT);
      await job.save();
      await attemptTransfer(job, cleaner);
    }
  }

  return cleaner;
}

// Stripe-side chargeback — distinct from our own in-app DISPUTED state
// (which is customer-raised via our API on a completed job). No state
// transition is defined for this in the spec; flag for ops review only.
async function handleChargeDisputeCreated(paymentIntentId, reason) {
  const job = await Job.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!job) return null;
  job.disputeReason = `stripe_chargeback: ${reason}`;
  await job.save();
  notifications.opsAlert(
    `Card chargeback on job ${String(job._id).slice(-8)}`,
    `The customer's bank has opened a chargeback (${reason}). Respond in the Stripe dashboard before the deadline.`
  );
  return job;
}

module.exports = {
  DISPUTE_REASON_CODES,
  MAX_TRANSFER_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  bookJob,
  cancellationPolicy,
  getOrRenewPaymentIntent,
  cancelBooked,
  handlePaymentSucceeded,
  cancelByCleaner,
  cancelByCustomer,
  checkIn,
  markComplete,
  confirmJob,
  autoConfirmExpiredJobs,
  raiseDispute,
  resolveDisputeRefund,
  resolveDisputePartial,
  resolveDisputePayout,
  attemptTransfer,
  retryTransfer,
  manualRetryTransfer,
  releaseDuePayouts,
  releasePayoutNow,
  payoutHoldDays,
  handleTransferPaid,
  handleTransferFailedWebhook,
  handlePayoutFailed,
  handleAccountUpdated,
  handleChargeDisputeCreated,
  calculateSplit,
};
