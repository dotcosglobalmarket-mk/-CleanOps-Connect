const DataRequest = require('../models/DataRequest');
const User = require('../models/User');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');
const { view } = require('./account.service');

// The admin side of requests made from a person's account page (see account.service.js).
const KEEP_CLOSED_YEARS = 6;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function closedExpiry(from) {
  const date = new Date(from);
  date.setFullYear(date.getFullYear() + KEEP_CLOSED_YEARS);
  return date;
}

async function listPending(now = new Date()) {
  const requests = await DataRequest.find({ status: 'pending' }).sort({ dueAt: 1 }).populate('user', 'name email role');
  return requests.map((r) => ({
    ...view(r),
    note: r.note,
    overdue: r.dueAt < now,
    person: r.user ? { id: r.user._id, name: r.user.name, email: r.user.email, role: r.user.role } : null,
  }));
}

async function close(id, { outcome, reason }, req) {
  const request = await DataRequest.findById(id);
  if (!request) throw httpError(404, 'Request not found');
  if (request.status !== 'pending') throw httpError(409, 'This request has already been closed');
  const why = reason ? String(reason).trim() : '';
  if (outcome === 'declined' && why.length < 3) throw httpError(400, 'Say why the request is being declined');

  const now = new Date();
  request.status = outcome;
  request.closedAt = now;
  request.closedBy = req && req.user ? req.user.id : undefined;
  request.outcomeNote = why || undefined;
  request.expireAt = closedExpiry(now);
  await request.save();

  await auditService.record({
    req,
    action: 'user.request_closed',
    targetType: 'user',
    targetId: request.user,
    reason: `${request.type} request ${outcome}${why ? `: ${why}` : ''}`,
  });

  const person = await User.findById(request.user);
  if (person && !person.erasedAt) notificationService.dataRequestClosed(person, request);
  return view(request);
}

// Called when an account is erased: an open erasure request is then complete, and the
// free text people wrote on any of their requests goes with the rest of their data.
async function afterErasure(userId, req) {
  const now = new Date();
  await DataRequest.updateMany(
    { user: userId, type: 'erase', status: 'pending' },
    {
      $set: { status: 'done', closedAt: now, closedBy: req && req.user ? req.user.id : undefined, outcomeNote: 'Account erased', expireAt: closedExpiry(now) },
    }
  );
  await DataRequest.updateMany({ user: userId }, { $unset: { note: 1 } });
}

module.exports = { listPending, close, afterErasure };
