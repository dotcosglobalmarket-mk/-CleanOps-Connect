const bcrypt = require('bcryptjs');
const User = require('../models/User');
const DataRequest = require('../models/DataRequest');
const notificationService = require('./notification.service');
const { signToken, toPublicUser, revokeSessions } = require('./session.service');

const SALT_ROUNDS = 10;
const ROLES = ['customer', 'cleaner'];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function requirePerson(userId) {
  const user = await User.findById(userId);
  if (!user || !ROLES.includes(user.role) || user.erasedAt) throw httpError(404, 'Account not found');
  return user;
}

// Note: a wrong current password is a 400, not a 401, because the website treats a 401 as
// "your session has ended" and signs the person out.
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await requirePerson(userId);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw httpError(400, 'Your current password is not right');
  }
  if (currentPassword === newPassword) throw httpError(400, 'Choose a new password that is different from the current one');

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // Every other device is signed out; this one carries on with the fresh session returned below.
  revokeSessions(user);
  await user.save();

  notificationService.passwordChanged(user);
  return { user: toPublicUser(user), token: signToken(user) };
}

const oneMonthFrom = (date) => {
  const due = new Date(date);
  due.setMonth(due.getMonth() + 1);
  return due;
};

function view(request) {
  return {
    id: request._id,
    type: request.type,
    status: request.status,
    createdAt: request.createdAt,
    dueAt: request.dueAt,
    closedAt: request.closedAt,
    outcomeNote: request.outcomeNote,
  };
}

async function listMine(userId) {
  const requests = await DataRequest.find({ user: userId }).sort({ createdAt: -1 }).limit(20);
  return requests.map(view);
}

async function createDataRequest(userId, { type, note, currentPassword }) {
  const user = await requirePerson(userId);
  if (type === 'erase') {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw httpError(400, 'Enter your current password to ask for your account to be deleted');
    }
  }

  // One open request of each kind at a time.
  const open = await DataRequest.findOne({ user: user._id, type, status: 'pending' });
  if (open) return { ...view(open), alreadyOpen: true };

  const now = new Date();
  const request = await DataRequest.create({
    user: user._id,
    type,
    note: note || undefined,
    dueAt: oneMonthFrom(now),
  });
  notificationService.dataRequestReceived(user, request);
  return { ...view(request), alreadyOpen: false };
}

module.exports = { changePassword, listMine, createDataRequest, view };
