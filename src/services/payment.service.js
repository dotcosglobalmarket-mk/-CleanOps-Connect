const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');
const stripeService = require('./stripe.service');
const { STATES, EVENTS, transition, PaymentStateError } = require('./payment-state-machine');

const MAX_TRANSFER_ATTEMPTS = 3;
const RETRY_BACKOFF_MINUTES = [5, 30, 120]; // 5min -> 30min -> 2hr
const AUTO_CONFIRM_WINDOW_HOURS = 48;

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

// Cancellation policy — the spec referenced "check cancellation policy
// window" without specifying the exact hours/percentage; these numbers are
// the confirmed business rule (full refund within 24hr of booking, 50% back
// on a later cancellation), not a placeholder.
const CUSTOMER_FULL_REFUND_WINDOW_HOURS = 24;
const CUSTOMER_LATE_CANCELLATION_REFUND_RATE = 0.5;

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

async function cancelBooked(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.CANCEL_BOOKED);
  await job.save();
  return job;
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
  // notify cleaner — logging stands in for a real notification channel
  console.log(`[payments] Job ${job._id}: notifying cleaner, payment held.`);
  return job;
}

// --- Cancellation (pre-start) ---

async function cancelByCleaner(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.PAID_HELD) {
    throw badRequest('Job can only be cancelled by the cleaner before it has started');
  }

  transition(job, EVENTS.CANCEL_BY_CLEANER);
  await job.save();

  await stripeService.createRefund({
    paymentIntentId: job.stripePaymentIntentId,
    idempotencyKey: refundIdempotencyKey(job),
  });

  // Dock reliability score — NOT automatic deactivation. No fully
  // automated, irreversible deactivation is permitted; any escalation must
  // route through deactivationStatus = 'under_review' for human review.
  console.log(`[payments] Job ${job._id}: cleaner cancellation logged against reliability score.`);

  transition(job, EVENTS.REFUND_DONE);
  await job.save();
  return job;
}

async function cancelByCustomer(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.PAID_HELD) {
    throw badRequest('Job can only be cancelled by the customer before it has started');
  }

  // The refund window runs from when the job was booked, not when it was
  // posted. Jobs booked before bookedAt existed fall back to createdAt.
  const bookedAt = job.bookedAt || job.createdAt;
  const hoursSinceBooking = (Date.now() - bookedAt.getTime()) / (1000 * 60 * 60);
  const isWithinFullRefundWindow = hoursSinceBooking <= CUSTOMER_FULL_REFUND_WINDOW_HOURS;

  transition(job, EVENTS.CANCEL_BY_CUSTOMER);
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
  return job;
}

// --- In-progress / completion / confirmation ---

async function checkIn(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.CHECK_IN);
  await job.save();
  return job;
}

async function markComplete(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.MARK_COMPLETE);
  job.awaitingConfirmationAt = new Date();
  await job.save();
  console.log(`[payments] Job ${job._id}: notifying customer, 48hr auto-confirm timer started.`);
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

  transition(job, EVENTS.CALCULATE_SPLIT);
  await job.save();

  return attemptTransfer(job, cleaner);
}

async function confirmJob(jobId) {
  const job = await requireJob(jobId);
  if (job.paymentStatus !== STATES.AWAITING_CONFIRMATION) {
    throw badRequest('Job is not awaiting confirmation');
  }

  transition(job, EVENTS.CONFIRM);
  await job.save();
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
    await job.save();
    results.push(await enterPayoutPending(job));
  }
  return results;
}

// --- Disputes ---

async function raiseDispute(jobId, reasonCode) {
  if (!DISPUTE_REASON_CODES.includes(reasonCode)) {
    throw badRequest(`reasonCode must be one of: ${DISPUTE_REASON_CODES.join(', ')}`);
  }

  const job = await requireJob(jobId);
  transition(job, EVENTS.RAISE_DISPUTE);
  job.disputeReason = reasonCode;
  await job.save();
  console.log(`[payments] Job ${job._id}: flagged for review (${reasonCode}). Auto-confirm timer frozen.`);
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
  return job;
}

async function resolveDisputePayout(jobId) {
  const job = await requireJob(jobId);
  transition(job, EVENTS.RESOLVE_PAYOUT);
  await job.save();

  transition(job, EVENTS.PROCEED_TO_CONFIRMED);
  await job.save();
  return enterPayoutPending(job);
}

// --- Payout / transfer attempt + retry ---

async function attemptTransfer(job, cleaner) {
  if (!cleaner.payoutsEnabled) {
    transition(job, EVENTS.BLOCK_PAYOUT);
    await job.save();
    console.log(`[payments] Job ${job._id}: payout blocked, cleaner has not finished Stripe onboarding.`);
    return job;
  }

  try {
    const transfer = await stripeService.createTransfer({
      amountPence: job.cleanerPayoutPence,
      destinationAccountId: cleaner.stripeConnectedAccountId,
      idempotencyKey: transferIdempotencyKey(job),
      metadata: { jobId: job._id.toString() },
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
    console.log(`[payments] ALERT ops: Job ${job._id} exhausted ${MAX_TRANSFER_ATTEMPTS} transfer retries.`);
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
  });
  job.stripeTransferId = transfer.id;
  await job.save();
  return job;
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
  console.log(`[payments] Job ${job._id}: paid out, rating eligibility unlocked.`);
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
  console.log(`[payments] Cleaner ${cleaner._id}: payout to bank failed, notify to fix bank details.`);
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
  console.log(`[payments] ALERT ops: Stripe chargeback on job ${job._id} (${reason}).`);
  return job;
}

module.exports = {
  DISPUTE_REASON_CODES,
  MAX_TRANSFER_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  bookJob,
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
  handleTransferPaid,
  handleTransferFailedWebhook,
  handlePayoutFailed,
  handleAccountUpdated,
  handleChargeDisputeCreated,
  calculateSplit,
};
