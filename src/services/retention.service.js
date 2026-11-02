const Job = require('../models/Job');
const JobPhoto = require('../models/JobPhoto');
const DocumentFile = require('../models/DocumentFile');
const AuditLog = require('../models/AuditLog');
const auditService = require('./audit.service');
const logger = require('../utils/logger');

// Retention that MongoDB's TTL indexes cannot do on their own. Chat (6 months),
// staff notes on a job (12 months) and the staff audit log (12 months, or 6 years
// for refund, payout and dispute decisions) are deleted by TTL indexes on their
// models. Here: the written description a customer gives when reporting a problem
// is deleted 12 months after the report (the reason code and outcome stay with the
// payment record, kept for 6 years for HMRC), job photo records whose picture has
// been deleted are tidied away, and older audit entries are given their dates.

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

// A photo record only describes a picture; once MongoDB has deleted the picture the
// record (file name, kind, who added it) has no purpose either.
async function purgeOrphanJobPhotos() {
  let removed = 0;
  let after = null;
  for (;;) {
    const batch = await JobPhoto.find(after ? { _id: { $gt: after } } : {})
      .sort({ _id: 1 })
      .limit(500)
      .select('file')
      .lean();
    if (!batch.length) break;
    after = batch[batch.length - 1]._id;
    const stored = new Set(
      (await DocumentFile.find({ _id: { $in: batch.map((p) => p.file) } }).select('_id').lean()).map((f) => String(f._id))
    );
    const gone = batch.filter((p) => !stored.has(String(p.file))).map((p) => p._id);
    if (gone.length) {
      await JobPhoto.deleteMany({ _id: { $in: gone } });
      removed += gone.length;
    }
  }
  if (removed) logger.info(`[retention] Removed ${removed} job photo record(s) whose picture had been deleted.`);
  return removed;
}

// Before each audit entry carried its own deletion date, a MongoDB index deleted every
// entry 12 months after it was written, which would also have deleted refund and
// payout decisions after a year. This drops that index and gives every older entry
// its date. Safe to run at every start-up: it does nothing once there is nothing to do.
async function migrateAuditRetention() {
  const collection = AuditLog.collection;
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err.code === 26) return { droppedIndexes: 0, datedEntries: 0 }; // no entries yet
    throw err;
  }

  const old = indexes.filter(
    (i) => i.key && Object.keys(i.key).length === 1 && i.key.createdAt === 1 && typeof i.expireAfterSeconds === 'number'
  );
  for (const index of old) await collection.dropIndex(index.name);

  let datedEntries = 0;
  for (;;) {
    const batch = await collection.find({ expireAt: { $exists: false } }, { projection: { action: 1, createdAt: 1 } }).limit(500).toArray();
    if (!batch.length) break;
    await collection.bulkWrite(
      batch.map((entry) => ({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { expireAt: auditService.expiryFor(entry.action, entry.createdAt || new Date()) } },
        },
      }))
    );
    datedEntries += batch.length;
  }
  if (old.length || datedEntries) {
    logger.info(`[retention] Audit log: dropped ${old.length} old index(es) and dated ${datedEntries} older entr${datedEntries === 1 ? 'y' : 'ies'}.`);
  }
  return { droppedIndexes: old.length, datedEntries };
}

module.exports = { purgeOldDisputeText, purgeOrphanJobPhotos, migrateAuditRetention, DISPUTE_TEXT_RETENTION_DAYS };
