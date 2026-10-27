require('dotenv').config();

const createApp = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { seedDefaultServiceTypes } = require('./services/service-type-seed.service');
const { ensureSuperAdmin } = require('./services/admin-bootstrap.service');
const complianceDocumentService = require('./services/compliance-document.service');
const retentionService = require('./services/retention.service');
const { startPaymentWorkers } = require('./workers/transfer-retry.worker');

const PORT = process.env.PORT || 4000;

// Removes the badge a certificate backs once it has passed its expiry date.
function startComplianceDocumentExpiry() {
  const run = () =>
    complianceDocumentService
      .expireLapsedDocuments()
      .catch((err) => logger.error(`Compliance document expiry check failed: ${err.message}`));
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

// Deletes the written description of a problem report 12 months after it was raised.
function startRetentionSweep() {
  const run = () =>
    retentionService
      .purgeOldDisputeText()
      .catch((err) => logger.error(`Retention sweep failed: ${err.message}`));
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

async function start() {
  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is not set in the environment');
    process.exit(1);
  }

  await connectDB();
  await seedDefaultServiceTypes();
  await ensureSuperAdmin().catch((err) => logger.error(`Super admin setup failed: ${err.message}`));

  const app = createApp();

  app.listen(PORT, () => {
    logger.info(`CleanOps Connect API listening on port ${PORT}`);
  });

  startPaymentWorkers();
  startComplianceDocumentExpiry();
  startRetentionSweep();
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});
