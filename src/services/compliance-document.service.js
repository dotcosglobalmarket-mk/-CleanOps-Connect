const CleanerDocument = require('../models/CleanerDocument');
const DocumentFile = require('../models/DocumentFile');
const CleanerProfile = require('../models/CleanerProfile');
const auditService = require('./audit.service');
const notifications = require('./notification.service');
const logger = require('../utils/logger');

// Cleaners upload the certificates behind their DBS, COSHH and insurance
// badges; an admin checks each one. The file is kept in the database, is
// readable only by admins (every view is audited) and is deleted by MongoDB's
// TTL index: DBS copies 6 months after the decision, rejected files after 30
// days. The review record itself stays.

const TYPES = ['dbs', 'coshh', 'insurance'];
const MAX_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const DBS_RETENTION_DAYS = 183;
const REJECTED_RETENTION_DAYS = 30;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Trust the file's own first bytes, not the name or the Content-Type header.
function detectMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

function cleanFilename(name) {
  const base = String(name || 'document').split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f"<>|:*?]/g, '').trim().slice(0, 120) || 'document';
}

const afterDays = (days, from = new Date()) => new Date(from.getTime() + days * DAY_MS);

function describe(doc, fileAvailable) {
  return {
    _id: doc._id,
    type: doc.type,
    status: doc.status,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.uploadedAt,
    reviewedAt: doc.reviewedAt,
    rejectionReason: doc.rejectionReason,
    expiresAt: doc.expiresAt,
    fileAvailable,
  };
}

async function fileIdsStillStored(docs) {
  const ids = docs.map((d) => d.file).filter(Boolean);
  if (!ids.length) return new Set();
  const found = await DocumentFile.find({ _id: { $in: ids } }).select('_id').lean();
  return new Set(found.map((f) => String(f._id)));
}

async function upload({ user, type, filename, buffer }) {
  if (!TYPES.includes(type)) throw httpError(400, 'Choose DBS, COSHH or insurance');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Upload a PDF, JPG or PNG file');
  if (buffer.length > MAX_BYTES) throw httpError(413, 'That file is over 5 MB');
  const mimeType = detectMimeType(buffer);
  if (!mimeType) throw httpError(400, 'Only PDF, JPG and PNG files are accepted');

  const cleaner = await CleanerProfile.findOne({ user: user.id });
  if (!cleaner) throw httpError(400, 'Register your profile first, under Coverage & Subscription');

  // A new upload replaces one still waiting for review.
  const waiting = await CleanerDocument.find({ cleaner: cleaner._id, type, status: 'pending' });
  if (waiting.length) {
    await DocumentFile.deleteMany({ _id: { $in: waiting.map((d) => d.file).filter(Boolean) } });
    await CleanerDocument.deleteMany({ _id: { $in: waiting.map((d) => d._id) } });
  }

  const file = await DocumentFile.create({
    data: buffer,
    mimeType,
    // DBS copies are never kept longer than the retention period, reviewed or not.
    expireAt: type === 'dbs' ? afterDays(DBS_RETENTION_DAYS) : undefined,
  });
  const doc = await CleanerDocument.create({
    cleaner: cleaner._id,
    type,
    originalName: cleanFilename(filename),
    mimeType,
    sizeBytes: buffer.length,
    file: file._id,
  });
  return describe(doc, true);
}

async function listMine(user) {
  const cleaner = await CleanerProfile.findOne({ user: user.id });
  if (!cleaner) return [];
  const docs = await CleanerDocument.find({ cleaner: cleaner._id }).sort({ uploadedAt: -1 }).lean();
  return docs.map((d) => describe(d, true));
}

async function listForAdmin({ status = 'pending' } = {}) {
  const filter = status === 'all' ? {} : { status };
  const docs = await CleanerDocument.find(filter)
    .sort({ uploadedAt: status === 'pending' ? 1 : -1 })
    .limit(200)
    .populate('cleaner', 'name companyName dbsVerified coshhTrained insuranceStatus')
    .lean();
  const stored = await fileIdsStillStored(docs);
  return docs.map((d) => ({
    ...describe(d, stored.has(String(d.file))),
    cleaner: d.cleaner
      ? {
          _id: d.cleaner._id,
          name: d.cleaner.companyName || d.cleaner.name,
          dbsVerified: d.cleaner.dbsVerified,
          coshhTrained: d.cleaner.coshhTrained,
          insuranceStatus: d.cleaner.insuranceStatus,
        }
      : null,
  }));
}

// Opening a certificate is itself a recorded act.
async function getFileForReview(id, req) {
  const doc = await CleanerDocument.findById(id);
  if (!doc) throw httpError(404, 'Document not found');
  const file = doc.file ? await DocumentFile.findById(doc.file) : null;
  if (!file) throw httpError(410, 'This file has been deleted under our retention policy');

  await auditService.record({
    req,
    action: 'compliance_document.view',
    targetType: 'cleaner',
    targetId: doc.cleaner,
    after: { type: doc.type, documentId: String(doc._id) },
    reason: 'Opened an uploaded compliance document to review it',
  });
  return { doc, file };
}

// Erasure on request (or withdrawn consent): deletes the stored copy at once.
// The decision record stays, and so does the profile badge: removing that is a
// separate decision made in Cleaner Verification. A document still waiting for
// review has nothing left to review, so it is marked withdrawn.
async function deleteFile(id, { reason }, req) {
  if (!reason || String(reason).trim().length < 3) throw httpError(400, 'Say why the file is being deleted');
  const doc = await CleanerDocument.findById(id);
  if (!doc) throw httpError(404, 'Document not found');
  if (!doc.file) throw httpError(409, 'This file has already been deleted');

  await DocumentFile.deleteMany({ _id: doc.file });
  const wasPending = doc.status === 'pending';
  doc.fileDeletedAt = new Date();
  if (wasPending) doc.status = 'withdrawn';
  await doc.save();

  await auditService.record({
    req,
    action: 'compliance_document.delete_file',
    targetType: 'cleaner',
    targetId: doc.cleaner,
    after: { type: doc.type, documentId: String(doc._id), status: doc.status },
    reason: String(reason).trim().slice(0, 500),
  });
  return doc;
}

const FLAG_FOR = { dbs: 'dbsVerified', coshh: 'coshhTrained', insurance: 'insuranceStatus' };

async function review(id, { decision, reason, expiresAt }, req) {
  const doc = await CleanerDocument.findById(id);
  if (!doc) throw httpError(404, 'Document not found');
  if (doc.status !== 'pending') throw httpError(409, 'This document has already been reviewed');

  const now = new Date();
  doc.reviewedBy = req.user.id;
  doc.reviewedAt = now;

  if (decision === 'reject') {
    if (!reason || String(reason).trim().length < 3) throw httpError(400, 'Say why it is being rejected');
    doc.status = 'rejected';
    doc.rejectionReason = String(reason).trim().slice(0, 500);
    await doc.save();
    await DocumentFile.updateOne({ _id: doc.file }, { $set: { expireAt: afterDays(REJECTED_RETENTION_DAYS, now) } });
    await auditService.record({
      req,
      action: 'compliance_document.reject',
      targetType: 'cleaner',
      targetId: doc.cleaner,
      after: { type: doc.type, documentId: String(doc._id) },
      reason: doc.rejectionReason,
    });
    notifications.complianceDocumentReviewed(doc.cleaner, doc);
    return doc;
  }

  // Approve. Insurance must say when it runs out; COSHH may.
  let expiry;
  if (expiresAt) {
    expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry <= now) throw httpError(400, 'The expiry date must be in the future');
  } else if (doc.type === 'insurance') {
    throw httpError(400, 'Enter the date the insurance runs out');
  }

  const cleaner = await CleanerProfile.findById(doc.cleaner);
  if (!cleaner) throw httpError(404, 'Cleaner not found');

  // Whatever was approved before is replaced, and its file deleted.
  const previous = await CleanerDocument.find({ cleaner: doc.cleaner, type: doc.type, status: 'approved' });
  if (previous.length) {
    await CleanerDocument.updateMany({ _id: { $in: previous.map((p) => p._id) } }, { $set: { status: 'superseded' } });
    await DocumentFile.deleteMany({ _id: { $in: previous.map((p) => p.file).filter(Boolean) } });
  }

  doc.status = 'approved';
  doc.expiresAt = expiry;
  await doc.save();
  if (doc.type === 'dbs') {
    await DocumentFile.updateOne({ _id: doc.file }, { $set: { expireAt: afterDays(DBS_RETENTION_DAYS, now) } });
  }

  const field = FLAG_FOR[doc.type];
  const before = { [field]: cleaner[field] };
  if (doc.type === 'insurance') {
    // Insurance the platform provides is not downgraded to "own".
    if (cleaner.insuranceStatus !== 'platform') cleaner.insuranceStatus = 'own';
  } else {
    cleaner[field] = true;
  }
  await cleaner.save();

  await auditService.record({
    req,
    action: 'compliance_document.approve',
    targetType: 'cleaner',
    targetId: doc.cleaner,
    before,
    after: { [field]: cleaner[field], type: doc.type, documentId: String(doc._id), expiresAt: expiry },
    reason: reason && String(reason).trim() ? String(reason).trim() : 'Certificate checked and accepted',
  });
  notifications.complianceDocumentReviewed(doc.cleaner, doc);
  return doc;
}

// A certificate past its expiry no longer backs the badge it switched on.
async function expireLapsedDocuments(now = new Date()) {
  const lapsed = await CleanerDocument.find({ status: 'approved', expiresAt: { $lt: now } });
  for (const doc of lapsed) {
    doc.status = 'expired';
    await doc.save();
    const cleaner = await CleanerProfile.findById(doc.cleaner);
    if (cleaner) {
      if (doc.type === 'coshh') cleaner.coshhTrained = false;
      if (doc.type === 'insurance' && cleaner.insuranceStatus === 'own') cleaner.insuranceStatus = 'none';
      await cleaner.save();
    }
    logger.info(`Compliance document ${doc._id} (${doc.type}) expired; badge removed from cleaner ${doc.cleaner}`);
    notifications.complianceDocumentExpired(doc.cleaner, doc);
  }
  return lapsed.length;
}

module.exports = {
  TYPES,
  MAX_BYTES,
  DBS_RETENTION_DAYS,
  REJECTED_RETENTION_DAYS,
  detectMimeType,
  upload,
  listMine,
  listForAdmin,
  getFileForReview,
  review,
  deleteFile,
  expireLapsedDocuments,
};
