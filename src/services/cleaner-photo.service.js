const CleanerProfile = require('../models/CleanerProfile');
const DocumentFile = require('../models/DocumentFile');
const Job = require('../models/Job');
const JobOffer = require('../models/JobOffer');
const { STAFF_ROLES } = require('../config/permissions');

// An optional profile picture or company logo. The website crops it to a small
// square before sending, so the server only takes JPG or PNG up to 1 MB. It is
// kept while it is on the profile and deleted when replaced or removed. It is
// shown only to the cleaner, our staff, and customers the cleaner has been
// offered to or booked with.

const MAX_BYTES = 1024 * 1024;

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

async function setPhoto({ userId, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Choose a JPG or PNG picture');
  if (buffer.length > MAX_BYTES) throw httpError(413, 'That picture is over 1 MB');
  const mimeType = detectMimeType(buffer);
  if (!mimeType) throw httpError(400, 'Only JPG and PNG pictures are accepted');

  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) throw httpError(404, 'Save your profile first, then add a picture');

  const file = await DocumentFile.create({ data: buffer, mimeType });
  const previous = cleaner.photo && cleaner.photo.file;
  cleaner.photo = { file: file._id, updatedAt: new Date() };
  await cleaner.save();
  if (previous) await DocumentFile.deleteMany({ _id: previous });
  return { hasPhoto: true, updatedAt: cleaner.photo.updatedAt };
}

async function removePhoto({ userId }) {
  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) throw httpError(404, 'Cleaner profile not found');
  const previous = cleaner.photo && cleaner.photo.file;
  cleaner.photo = undefined;
  await cleaner.save();
  if (previous) await DocumentFile.deleteMany({ _id: previous });
}

async function customerHasDealtWith(customerId, cleanerId) {
  if (await Job.exists({ customer: customerId, cleaner: cleanerId })) return true;
  const jobIds = await Job.find({ customer: customerId }).distinct('_id');
  if (!jobIds.length) return false;
  return Boolean(await JobOffer.exists({ cleaner: cleanerId, job: { $in: jobIds } }));
}

async function getPhoto({ user, cleanerId }) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner || !cleaner.photo || !cleaner.photo.file) throw httpError(404, 'No picture');

  const isOwner = user.role === 'cleaner' && cleaner.user && cleaner.user.toString() === user.id;
  const isStaff = STAFF_ROLES.includes(user.role);
  if (!isOwner && !isStaff) {
    if (user.role !== 'customer' || cleaner.deactivationStatus === 'suspended') throw httpError(404, 'No picture');
    if (!(await customerHasDealtWith(user.id, cleaner._id))) throw httpError(404, 'No picture');
  }

  const file = await DocumentFile.findById(cleaner.photo.file);
  if (!file) throw httpError(404, 'No picture');
  return { file, updatedAt: cleaner.photo.updatedAt };
}

module.exports = { setPhoto, removePhoto, getPhoto, detectMimeType, MAX_BYTES };
