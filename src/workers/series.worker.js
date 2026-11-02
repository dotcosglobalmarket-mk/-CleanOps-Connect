const seriesService = require('../services/series.service');
const visitCharging = require('../services/visit-charging.service');
const logger = require('../utils/logger');

const SIX_HOURS = 6 * 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Charges the visits that are due (48 hours ahead), retries declined cards, and
// skips visits that cannot be paid for. Safe to run often: each attempt is claimed
// first and sent to Stripe with its own idempotency key.
function startChargeWorker(intervalMs = FIFTEEN_MINUTES) {
  if (process.env.RECURRING_JOBS_ENABLED !== 'true') return null;
  const run = () =>
    visitCharging
      .runChargeSweep()
      .then((counts) => {
        if (counts.paid || counts.retry || counts.skipped) logger.info(`[charge-worker] ${JSON.stringify(counts)}`);
      })
      .catch((err) => logger.error(`[charge-worker] ${err.message}`));
  run();
  return setInterval(run, intervalMs).unref();
}

// Makes the next visits of every recurring series. Running it more often than
// needed is harmless: visits that exist are skipped, never made twice.
function startSeriesWorker(intervalMs = SIX_HOURS) {
  const run = () =>
    seriesService
      .runVisitGenerator()
      .then(({ visits }) => {
        if (visits) logger.info(`[series-worker] Made ${visits} visit(s)`);
      })
      .catch((err) => logger.error(`[series-worker] ${err.message}`));
  run();
  return setInterval(run, intervalMs).unref();
}

module.exports = { startSeriesWorker, startChargeWorker };
