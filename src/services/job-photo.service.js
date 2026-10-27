const Job = require('../models/Job');
const JobPhoto = require('../models/JobPhoto');
const DocumentFile = require('../models/DocumentFile');
const CleanerProfile = require('../models/CleanerProfile');
const auditService = require('./audit.service');
const { STAFF_ROLES } = require('../config/permissions');
const logger = require('../utils/logger');

// Optional photos on a job. A cleaner can add before/after pictures of the
// work; a customer can add pictures of what went wrong when they report a
// problem. Both sides, and our staff, can see them. The pictures are kept for
// 90 days after the job is closed (confirmed, cancelled or any dispute settled)
// and never longer than a year from upload, whatever happens to the job. MongoDB
// deletes them with a TTL index; staff opening one is recorded in the audit log.

const KINDS = ['before', 'after', 'problem'];
const MAX_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS_AFTER_CLOSE = 90;
const MAX_RETENTION_DAYS = 365;
const MAX_PER_UPLOADER = { cleaner: 6, customer: 4 };

// Cleaners add pictures while the job is under way and may add them to answer a
// problem report; customers add them when they report a problem or while it is
// open.
const UPLOAD_STATES = {
  cleaner: ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'],
  customer: ['AWAITING_CONFIRMATION', 'DISPUTED'],
};
const KINDS_BY_ROLE = { cleaner: ['before', 'after'], customer: ['problem'] };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Trust the file's own first bytes, not the name or the Content-Type header.
function detectMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

function cleanFilename(name) {
  const base = String(name || 'photo').split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f"<>|:*?]/g, '').trim().slice(0, 120) || 'photo';
}

// Who the user is on this job: its customer, its booked cleaner, or staff.
async function requireAccess(jobId, user) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');

  if (user.role === 'customer' && job.customer && job.customer.toString() === user.id) {
    return { job, role: 'customer' };
  }
  if (user.role === 'cleaner' && job.cleaner) {
    const profile = await CleanerProfile.findOne({ user: user.id });
    if (profile && profile._id.toString() === job.cleaner.toString()) return { job, role: 'cleaner' };
  }
  if (STAFF_ROLES.includes(user.role)) return { job, role: user.role };
  throw httpError(403, 'You do not have access to this job');
}

function describe(photo) {
  return {
    _id: photo._id,
    kind: photo.kind,
    uploaderRole: photo.uploaderRole,
    originalName: photo.originalName,
    sizeBytes: photo.sizeBytes,
    uploadedAt: photo.uploadedAt,
  };
}

async function upload({ user, jobId, kind, filename, buffer }) {
  if (!KINDS.includes(kind)) throw httpError(400, 'kind must be before, after or problem');
  const { job, role } = await requireAccess(jobId, user);
  if (!KINDS_BY_ROLE[role] || !KINDS_BY_ROLE[role].includes(kind)) {
    throw httpError(403, role === 'cleaner' ? 'Cleaners add before or after photos' : 'Customers add photos with a problem report');
  }
  if (!UPLOAD_STATES[role].includes(job.paymentStatus)) {
    throw httpError(409, 'Photos can no longer be added to this job');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Upload a JPG or PNG photo');
  if (buffer.length > MAX_BYTES) throw httpError(413, 'That photo is over 5 MB');
  const mimeType = detectMimeType(buffer);
  if (!mimeType) throw httpError(400, 'Only JPG and PNG photos are accepted');

  const mine = await JobPhoto.countDocuments({ job: job._id, uploadedBy: user.id });
  if (mine >= MAX_PER_UPLOADER[role]) {
    throw httpError(409, `You can add up to ${MAX_PER_UPLOADER[role]} photos to one job`);
  }

  const file = await DocumentFile.create({
    data: buffer,
    mimeType,
    expireAt: new Date(Date.now() + MAX_RETENTION_DAYS * DAY_MS),
  });
  const photo = await JobPhoto.create({
    job: job._id,
    uploadedBy: user.id,
    uploaderRole: role,
    kind,
    originalName: cleanFilename(filename),
    mimeType,
    sizeBytes: buffer.length,
    file: file._id,
  });
  return describe(photo);
}

// Photos whose picture MongoDB has already deleted are tidied away here.
async function list({ user, jobId }) {
  const { job } = await requireAccess(jobId, user);
  const photos = await JobPhoto.find({ job: job._id }).sort({ uploadedAt: 1 }).lean();
  if (!photos.length) return [];
  const stored = new Set(
    (await DocumentFile.find({ _id: { $in: photos.map((p) => p.file) } }).select('_id').lean()).map((f) => String(f._id))
  );
  const gone = photos.filter((p) => !stored.has(String(p.file)));
  if (gone.length) await JobPhoto.deleteMany({ _id: { $in: gone.map((p) => p._id) } });
  return photos.filter((p) => stored.has(String(p.file))).map(describe);
}

// Staff opening a picture is itself a recorded act.
async function getFile({ user, jobId, photoId, req }) {
  const { job, role } = await requireAccess(jobId, user);
  const photo = await JobPhoto.findOne({ _id: photoId, job: job._id });
  if (!photo) throw httpError(404, 'Photo not found');
  const file = await DocumentFile.findById(photo.file);
  if (!file) {
    await JobPhoto.deleteOne({ _id: photo._id });
    throw httpError(410, 'This photo has been deleted under our retention policy');
  }
  if (STAFF_ROLES.includes(role)) {
    await auditService.record({
      req,
      action: 'job_photo.view',
      targetType: 'job',
      targetId: job._id,
      after: { photoId: String(photo._id), kind: photo.kind, uploaderRole: photo.uploaderRole },
      reason: 'Opened a job photo while looking into the job',
    });
  }
  return { photo, file };
}

// You can take back a photo you added, until the job is under dispute.
async function remove({ user, jobId, photoId }) {
  const { job } = await requireAccess(jobId, user);
  const photo = await JobPhoto.findOne({ _id: photoId, job: job._id });
  if (!photo) throw httpError(404, 'Photo not found');
  if (photo.uploadedBy.toString() !== user.id) throw httpError(403, 'You can only remove photos you added');
  if (job.paymentStatus === 'DISPUTED') throw httpError(409, 'Photos cannot be removed while a problem is being looked into');
  await DocumentFile.deleteMany({ _id: photo.file });
  await JobPhoto.deleteOne({ _id: photo._id });
}

// Called when a job is closed. Starts the 90 days for every picture on it.
// Never lets a payment step fail because of a photo.
async function scheduleExpiry(jobId, from = new Date()) {
  try {
    const photos = await JobPhoto.find({ job: jobId }).select('file').lean();
    if (!photos.length) return;
    await DocumentFile.updateMany(
      { _id: { $in: photos.map((p) => p.file) } },
      { $set: { expireAt: new Date(from.getTime() + RETENTION_DAYS_AFTER_CLOSE * DAY_MS) } }
    );
  } catch (err) {
    logger.error(`Could not schedule job photo deletion for job ${jobId}: ${err.message}`);
  }
}

module.exports = {
  upload,
  list,
  getFile,
  remove,
  scheduleExpiry,
  detectMimeType,
  MAX_BYTES,
  RETENTION_DAYS_AFTER_CLOSE,
  MAX_RETENTION_DAYS,
};
