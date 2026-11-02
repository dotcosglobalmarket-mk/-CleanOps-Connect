const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const totp = require('./totp.service');
const { signToken, toPublicUser, revokeSessions } = require('./session.service');

// Two-step login. Admin accounts must use an authenticator app (a six-digit
// code on top of the password); anyone else who has turned it on is asked too.
//
// - The password step never returns a session for such an account. It returns
//   a short-lived "challenge" (code needed) or "setup" (first time) token.
// - Those tokens are signed with a different secret from sessions, so they can
//   never be used as a login token anywhere else in the API.
// - The authenticator secret is stored encrypted, recovery codes only as hashes.
// - Wrong codes lock the account for a while; a used code cannot be replayed.
//
// Wrong codes are counted atomically in the database (see reserveAttempt), so
// sending many guesses at once cannot get past the limit, and a code or recovery
// code is claimed in one database step, so it cannot be used twice at once.
//
// ADMIN_2FA_REQUIRED=false only stops admins who have NOT set it up yet from
// being made to; anyone who has it on is still asked for a code.
//
// Break glass for an admin locked out of their own account (lost phone and
// recovery codes, and no other admin to reset them): set ADMIN_2FA_RESET_EMAIL
// to that admin's email on the server and redeploy. At start-up that admin's
// two-step login is cleared, so after the password they are taken through
// set-up again. Remove the setting afterwards, or it clears it at every restart.

const ISSUER = 'CleanOps Connect';
const CHALLENGE_TTL = '5m';
const SETUP_TTL = '15m';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const unauthorized = (message) => httpError(401, message);

function isRequiredFor(user) {
  return user.role === 'admin' && process.env.ADMIN_2FA_REQUIRED !== 'false';
}

function tokenSecret() {
  return `${process.env.JWT_SECRET}:two-factor`;
}

function encryptionKey() {
  return crypto
    .createHash('sha256')
    .update(process.env.TWO_FACTOR_ENCRYPTION_KEY || `two-factor-secrets:${process.env.JWT_SECRET}`)
    .digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(stored) {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from(crypto.randomBytes(10), (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

function signStepToken(user, purpose, expiresIn) {
  return jwt.sign({ sub: user._id.toString(), purpose }, tokenSecret(), { expiresIn });
}

function readStepToken(token, purpose) {
  try {
    const payload = jwt.verify(token, tokenSecret());
    if (payload.purpose === purpose) return payload;
  } catch (err) {
    // fall through to the same message for expired, forged and wrong-purpose tokens
  }
  throw unauthorized('That sign-in has expired. Please log in again.');
}

// Called after the password has been checked. Returns what the client should do next.
function afterPassword(user) {
  if (user.twoFactor && user.twoFactor.enabled) {
    return { twoFactorRequired: true, challengeToken: signStepToken(user, 'mfa', CHALLENGE_TTL) };
  }
  if (isRequiredFor(user)) {
    return { twoFactorSetupRequired: true, setupToken: signStepToken(user, 'mfa-setup', SETUP_TTL) };
  }
  return { user: toPublicUser(user), token: signToken(user) };
}

async function loadUser(id) {
  const user = await User.findById(id);
  if (!user || user.active === false) throw unauthorized('That sign-in has expired. Please log in again.');
  return user;
}

// Every code attempt is counted BEFORE the code is checked, in one atomic
// database update that refuses once the limit is reached. Counting after the
// check (read, add one, save) lets a burst of simultaneous guesses all read the
// same number and never reach the limit. The count starts again 15 minutes after
// the last attempt that was let through.
async function reserveAttempt(user) {
  await User.updateOne(
    {
      _id: user._id,
      'twoFactor.failedAttempts': { $gt: 0 },
      'twoFactor.lastAttemptAt': { $lte: new Date(Date.now() - LOCK_MS) },
    },
    { $set: { 'twoFactor.failedAttempts': 0 } }
  );
  const reserved = await User.findOneAndUpdate(
    {
      _id: user._id,
      $or: [{ 'twoFactor.failedAttempts': { $exists: false } }, { 'twoFactor.failedAttempts': { $lt: MAX_FAILED_ATTEMPTS } }],
    },
    { $inc: { 'twoFactor.failedAttempts': 1 }, $set: { 'twoFactor.lastAttemptAt': new Date() } },
    { new: true }
  );
  if (!reserved) throw httpError(429, 'Too many wrong codes. Try again in 15 minutes.');
}

const clearAttempts = (user) =>
  User.updateOne(
    { _id: user._id },
    {
      $set: { 'twoFactor.failedAttempts': 0 },
      $unset: { 'twoFactor.lastAttemptAt': 1, 'twoFactor.lockedUntil': 1 },
    }
  );

const wrongCode = () => unauthorized('That code is not right');

// First-time set-up, step 1: make a secret for the authenticator app.
async function startSetup({ setupToken }) {
  const payload = readStepToken(setupToken, 'mfa-setup');
  const user = await loadUser(payload.sub);
  if (user.twoFactor && user.twoFactor.enabled) throw httpError(400, 'Two-step login is already set up');

  const secret = totp.generateSecret();
  user.twoFactor.pendingSecretEnc = encrypt(secret);
  await user.save();
  return { secret, otpauthUri: totp.otpauthUri(secret, user.email, ISSUER) };
}

// Step 2: the first code from the app proves it is set up; recovery codes are shown once.
async function enable({ setupToken, code }) {
  const payload = readStepToken(setupToken, 'mfa-setup');
  const user = await loadUser(payload.sub);
  if (user.twoFactor.enabled) throw httpError(400, 'Two-step login is already set up');
  if (!user.twoFactor.pendingSecretEnc) throw httpError(400, 'Start the set-up again');

  await reserveAttempt(user);
  const step = totp.verify(decrypt(user.twoFactor.pendingSecretEnc), String(code).replace(/\s/g, ''));
  if (step === null) throw wrongCode();

  const recoveryCodes = newRecoveryCodes();
  const enabled = await User.findOneAndUpdate(
    { _id: user._id, 'twoFactor.enabled': { $ne: true } },
    {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.secretEnc': user.twoFactor.pendingSecretEnc,
        'twoFactor.lastUsedStep': step,
        'twoFactor.recoveryCodeHashes': recoveryCodes.map(hashRecoveryCode),
        'twoFactor.failedAttempts': 0,
        'twoFactor.enabledAt': new Date(),
      },
      $unset: { 'twoFactor.pendingSecretEnc': 1, 'twoFactor.lastAttemptAt': 1, 'twoFactor.lockedUntil': 1 },
    },
    { new: true }
  );
  if (!enabled) throw httpError(400, 'Two-step login is already set up');

  return { user: toPublicUser(enabled), token: signToken(enabled), recoveryCodes };
}

// Every login after set-up: a six-digit code, or one of the recovery codes (each works once).
async function verifyLogin({ challengeToken, code }) {
  const payload = readStepToken(challengeToken, 'mfa');
  const user = await loadUser(payload.sub);
  if (!user.twoFactor || !user.twoFactor.enabled) throw unauthorized('That sign-in has expired. Please log in again.');

  await reserveAttempt(user);

  const entered = String(code).replace(/[\s-]/g, '');
  let recoveryUsed = false;
  let recoveryCodesLeft = (user.twoFactor.recoveryCodeHashes || []).length;
  if (/^\d{6}$/.test(entered)) {
    const afterStep = typeof user.twoFactor.lastUsedStep === 'number' ? user.twoFactor.lastUsedStep : -1;
    const step = totp.verify(decrypt(user.twoFactor.secretEnc), entered, { afterStep });
    if (step === null) throw wrongCode();
    // Claim the code in one step: a second request carrying the same code finds
    // this step already used and is refused, even if it arrived at the same moment.
    const claimed = await User.findOneAndUpdate(
      {
        _id: user._id,
        $or: [
          { 'twoFactor.lastUsedStep': { $exists: false } },
          { 'twoFactor.lastUsedStep': null },
          { 'twoFactor.lastUsedStep': { $lt: step } },
        ],
      },
      { $set: { 'twoFactor.lastUsedStep': step } }
    );
    if (!claimed) throw wrongCode();
  } else {
    const hash = hashRecoveryCode(entered);
    // Same for recovery codes: removing the code and checking it were there is one step.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, 'twoFactor.recoveryCodeHashes': hash },
      { $pull: { 'twoFactor.recoveryCodeHashes': hash } },
      { new: true }
    );
    if (!claimed) throw wrongCode();
    recoveryUsed = true;
    recoveryCodesLeft = claimed.twoFactor.recoveryCodeHashes.length;
  }

  await clearAttempts(user);
  return { user: toPublicUser(user), token: signToken(user), recoveryCodesLeft, recoveryUsed };
}

// Staff action when someone loses their phone and their recovery codes.
async function reset(user) {
  user.twoFactor = {
    enabled: false,
    secretEnc: undefined,
    pendingSecretEnc: undefined,
    recoveryCodeHashes: [],
    lastUsedStep: undefined,
    failedAttempts: 0,
    lockedUntil: undefined,
    lastAttemptAt: undefined,
    enabledAt: undefined,
  };
  // Whoever was signed in under the old authenticator is signed out.
  revokeSessions(user);
  await user.save();
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  isRequiredFor,
  afterPassword,
  startSetup,
  enable,
  verifyLogin,
  reset,
  // for tests
  encrypt,
  decrypt,
  hashRecoveryCode,
  newRecoveryCodes,
};
