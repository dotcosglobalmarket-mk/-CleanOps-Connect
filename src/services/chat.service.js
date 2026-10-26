const { EventEmitter } = require('events');
const Job = require('../models/Job');
const Message = require('../models/Message');
const CleanerProfile = require('../models/CleanerProfile');
const { maskContactDetails } = require('./contact-filter.service');
const notifications = require('./notification.service');

// In-app chat between a customer and the cleaner booked on their job.
// Chat opens when a cleaner accepts (the job has a cleaner) and stays
// writable while the job is active; after that the history is read-only.

const MAX_BODY = 1000;
const PAGE_LIMIT = 200;
const EMAIL_THROTTLE_MS = 15 * 60 * 1000;

// Payment states in which the two parties can still write to each other.
const WRITABLE_STATES = ['BOOKED', 'PAID_HELD', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];

const MASKED_NOTICE =
  'For your safety, phone numbers, email addresses, postcodes and links are hidden in chat. Use CleanOps Connect to stay protected.';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Live delivery to open streams on this server instance. Clients also poll,
// so a second instance (or a dropped stream) only delays a message.
const bus = new EventEmitter();
bus.setMaxListeners(0);

function subscribe(jobId, listener) {
  const event = `job:${jobId}`;
  bus.on(event, listener);
  return () => bus.off(event, listener);
}

function toDto(message) {
  return {
    _id: String(message._id),
    job: String(message.job),
    senderRole: message.senderRole,
    body: message.body,
    contactMasked: Boolean(message.contactMasked),
    createdAt: message.createdAt,
    readAt: message.readAt || null,
  };
}

// Returns { job, role } when the user is the job's customer or its booked
// cleaner. Never reveals whether a job exists to anyone else.
async function requireParticipant(jobId, user) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');

  if (user.role === 'customer' && job.customer && job.customer.toString() === user.id) {
    return { job, role: 'customer' };
  }
  if (user.role === 'cleaner' && job.cleaner) {
    const profile = await CleanerProfile.findOne({ user: user.id });
    if (profile && profile._id.toString() === job.cleaner.toString()) {
      return { job, role: 'cleaner' };
    }
  }
  throw httpError(403, 'You do not have access to this conversation');
}

function chatState(job) {
  if (!job.cleaner) return { open: false, writable: false, reason: 'Chat opens when a cleaner accepts your job.' };
  const writable = WRITABLE_STATES.includes(job.paymentStatus);
  return {
    open: true,
    writable,
    reason: writable ? undefined : 'This conversation is now read-only because the job is no longer active.',
  };
}

async function listMessages(jobId, user, { after } = {}) {
  const { job, role } = await requireParticipant(jobId, user);
  const state = chatState(job);

  const query = { job: job._id };
  if (after) query._id = { $gt: after };
  const messages = await Message.find(query).sort({ createdAt: 1 }).limit(PAGE_LIMIT);

  // Reading marks the other person's messages as read.
  const otherRole = role === 'customer' ? 'cleaner' : 'customer';
  await Message.updateMany({ job: job._id, senderRole: otherRole, readAt: { $exists: false } }, { $set: { readAt: new Date() } });

  return { ...state, role, messages: messages.map(toDto) };
}

async function sendMessage(jobId, user, rawBody) {
  const { job, role } = await requireParticipant(jobId, user);
  const state = chatState(job);
  if (!state.open) throw httpError(409, state.reason);
  if (!state.writable) throw httpError(409, state.reason);

  const trimmed = String(rawBody || '').trim();
  if (!trimmed) throw httpError(400, 'Write a message first');
  if (trimmed.length > MAX_BODY) throw httpError(400, `Messages can be up to ${MAX_BODY} characters`);

  const { text, masked, kinds } = maskContactDetails(trimmed);

  const message = await Message.create({
    job: job._id,
    sender: user.id,
    senderRole: role,
    body: text,
    contactMasked: masked,
    maskedKinds: kinds,
  });

  const dto = toDto(message);
  bus.emit(`job:${job._id}`, dto);

  await notifyIfDue(job, role, message);

  return { message: dto, masked, notice: masked ? MASKED_NOTICE : undefined };
}

// One email per quiet period, not one per message.
async function notifyIfDue(job, senderRole, message) {
  const recipientRole = senderRole === 'customer' ? 'cleaner' : 'customer';
  const earlierUnread = await Message.exists({
    job: job._id,
    senderRole,
    readAt: { $exists: false },
    _id: { $ne: message._id },
    createdAt: { $gte: new Date(Date.now() - EMAIL_THROTTLE_MS) },
  });
  if (!earlierUnread) notifications.newMessage(job, recipientRole);
}

// Unread counts for the dashboard badges, keyed by job id.
async function unreadSummary(user) {
  let jobFilter;
  let otherRole;
  if (user.role === 'customer') {
    jobFilter = { customer: user.id, cleaner: { $exists: true } };
    otherRole = 'cleaner';
  } else {
    const profile = await CleanerProfile.findOne({ user: user.id });
    if (!profile) return { total: 0, byJob: {} };
    jobFilter = { cleaner: profile._id };
    otherRole = 'customer';
  }

  const jobs = await Job.find(jobFilter).select('_id');
  if (!jobs.length) return { total: 0, byJob: {} };

  const rows = await Message.aggregate([
    { $match: { job: { $in: jobs.map((j) => j._id) }, senderRole: otherRole, readAt: { $exists: false } } },
    { $group: { _id: '$job', count: { $sum: 1 } } },
  ]);

  const byJob = {};
  let total = 0;
  rows.forEach((row) => {
    byJob[String(row._id)] = row.count;
    total += row.count;
  });
  return { total, byJob };
}

// Staff read-only access for dispute handling. The route requires a reason
// and writes an audit entry; messages are returned exactly as stored.
async function listMessagesForStaff(jobId) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');
  const messages = await Message.find({ job: job._id }).sort({ createdAt: 1 }).limit(PAGE_LIMIT);
  return messages.map((m) => ({ ...toDto(m), maskedKinds: m.maskedKinds || [] }));
}

module.exports = {
  listMessages,
  sendMessage,
  unreadSummary,
  listMessagesForStaff,
  requireParticipant,
  subscribe,
  chatState,
  MAX_BODY,
  MASKED_NOTICE,
};
