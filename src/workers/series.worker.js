const seriesService = require('../services/series.service');
const logger = require('../utils/logger');

const SIX_HOURS = 6 * 60 * 60 * 1000;

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

module.exports = { startSeriesWorker };
