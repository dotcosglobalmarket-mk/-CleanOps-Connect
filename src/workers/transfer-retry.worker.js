const Job = require('../models/Job');
const paymentService = require('../services/payment.service');
const { STATES } = require('../services/payment-state-machine');
const logger = require('../utils/logger');

// Finds TRANSFER_FAILED jobs whose backoff window has elapsed and retries
// them one at a time. payment.service's retryTransfer/handleTransferError
// enforce the 3-attempt cap and re-use the same idempotency key.
async function runTransferRetrySweep(now = new Date()) {
  const dueJobs = await Job.find({
    paymentStatus: STATES.TRANSFER_FAILED,
    nextPayoutRetryAt: { $lte: now },
  });

  for (const job of dueJobs) {
    try {
      await paymentService.retryTransfer(job._id);
    } catch (err) {
      logger.error(`[transfer-retry-worker] Job ${job._id}: ${err.message}`);
    }
  }

  return dueJobs.length;
}

// Confirms jobs whose 48hr AWAITING_CONFIRMATION window has elapsed with no
// dispute raised, then proceeds them into payout.
async function runAutoConfirmSweep(now = new Date()) {
  try {
    const results = await paymentService.autoConfirmExpiredJobs(now);
    return results.length;
  } catch (err) {
    logger.error(`[auto-confirm-worker] ${err.message}`);
    return 0;
  }
}

function startPaymentWorkers(intervalMs = 5 * 60 * 1000) {
  const interval = setInterval(() => {
    runTransferRetrySweep().catch((err) => logger.error(`[transfer-retry-worker] ${err.message}`));
    runAutoConfirmSweep().catch((err) => logger.error(`[auto-confirm-worker] ${err.message}`));
  }, intervalMs);

  return interval;
}

module.exports = { runTransferRetrySweep, runAutoConfirmSweep, startPaymentWorkers };
