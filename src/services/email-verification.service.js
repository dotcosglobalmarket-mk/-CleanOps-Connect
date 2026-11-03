const crypto = require('crypto');
const User = require('../models/User');
const emailService = require('./email.service');
const notificationService = require('./notification.service');

// Confirms that the person who registered owns the email address. Customers and cleaners
// who registered after this existed must confirm before they can post a job, accept an
// offer or start a subscription (see requireVerifiedEmail). Staff are made by an admin, and
// accounts that already existed are not locked out: they are asked, never blocked.
//
// Safety valve: the block only applies while email sending is set up. If it is not, nobody
// could ever receive the link, so nobody is blocked.
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const ROLES = ['customer', 'cleaner'];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function isVerified(user) {
  return Boolean(user && user.emailVerification && user.emailVerification.verifiedAt);
}

// True when this account must confirm its email before taking the actions above.
function isBlocked(user) {
  if (!user || !ROLES.includes(user.role)) return false;
  const ev = user.emailVerification;
  return Boolean(ev && ev.required && !ev.verifiedAt && emailService.isConfigured());
}

// Makes a fresh single-use link (an earlier one stops working) and emails it.
async function issueToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  user.emailVerification = {
    ...(user.emailVerification && typeof user.emailVerification.toObject === 'function' ? user.emailVerification.toObject() : user.emailVerification),
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    sentAt: new Date(),
  };
  await user.save();
  await notificationService.emailVerification(user, token);
}

// Called when a customer or cleaner registers. Never makes registration fail.
async function startFor(user) {
  if (!user || !ROLES.includes(user.role)) return;
  user.emailVerification = { required: true };
  await issueToken(user);
}

async function verify(token) {
  const user = await User.findOne({
    'emailVerification.tokenHash': hashToken(token),
    'emailVerification.expiresAt': { $gt: new Date() },
  });
  if (!user) throw httpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');

  user.emailVerification.verifiedAt = new Date();
  user.emailVerification.tokenHash = undefined;
  user.emailVerification.expiresAt = undefined;
  await user.save();
  return { verified: true };
}

async function resend(userId) {
  const user = await User.findById(userId);
  if (!user || !ROLES.includes(user.role)) throw httpError(404, 'Nothing to confirm for this account');
  if (isVerified(user)) return { sent: false, verified: true };

  const sentAt = user.emailVerification && user.emailVerification.sentAt;
  if (sentAt && Date.now() - new Date(sentAt).getTime() < RESEND_COOLDOWN_MS) {
    throw httpError(429, 'We have only just sent a link. Please wait a minute, and check your spam folder.');
  }
  await issueToken(user);
  return { sent: true };
}

async function status(userId) {
  const user = await User.findById(userId);
  return {
    verified: isVerified(user),
    blocked: isBlocked(user),
    // False when the server cannot send email, so the screens do not offer a link that never comes.
    canSend: emailService.isConfigured(),
  };
}

// A password reset link was delivered to the address, which proves the same thing.
function markVerifiedByEmailProof(user) {
  if (!user || !ROLES.includes(user.role) || isVerified(user)) return;
  user.emailVerification = { ...(user.emailVerification && typeof user.emailVerification.toObject === 'function' ? user.emailVerification.toObject() : user.emailVerification), verifiedAt: new Date() };
}

module.exports = { TOKEN_TTL_MS, isBlocked, isVerified, startFor, verify, resend, status, markVerifiedByEmailProof };
