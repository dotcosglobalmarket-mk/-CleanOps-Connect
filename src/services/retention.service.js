const Job = require('../models/Job');
const logger = require('../utils/logger');

// Retention that MongoDB's TTL indexes cannot do on their own. Chat (6 months)
// and the staff audit log (12 months) are deleted by TTL indexes on their
// models. The written description a customer gives when reporting a problem is
// deleted here 12 months after the report; the reason code and outcome stay
// with the payment record, which is kept for 6 years for HMRC.

const DAY_MS = 24 * 60 * 60 * 1000;
const DISPUTE_TEXT_RETENTION_DAYS = 365;

async function purgeOldDisputeText(now = new Date()) {
  const cutoff = new Date(now.getTime() - DISPUTE_TEXT_RETENTION_DAYS * DAY_MS);
  const result = await Job.updateMany(
    { disputedAt: { $lt: cutoff }, disputeDetail: { $exists: true } },
    { $unset: { disputeDetail: 1 } }
  );
  const count = result.modifiedCount || 0;
  if (count) logger.info(`[retention] Removed the written dispute description from ${count} job(s) older than 12 months.`);
  return count;
}

module.exports = { purgeOldDisputeText, DISPUTE_TEXT_RETENTION_DAYS };
