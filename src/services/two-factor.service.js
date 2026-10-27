const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const totp = require('./totp.service');
const { signToken, toPublicUser } = require('./session.service');

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
// Break glass: if every admin is locked out, set ADMIN_2FA_REQUIRED=false on the
// server and redeploy, sign in with the password, then set it back.

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

function assertNotLocked(user) {
  const until = user.twoFactor && user.twoFactor.lockedUntil;
  if (until && until.getTime() > Date.now()) {
    throw httpError(429, 'Too many wrong codes. Try again in 15 minutes.');
  }
}

async function recordFailure(user) {
  user.twoFactor.failedAttempts = (user.twoFactor.failedAttempts || 0) + 1;
  if (user.twoFactor.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    user.twoFactor.lockedUntil = new Date(Date.now() + LOCK_MS);
    user.twoFactor.failedAttempts = 0;
  }
  await user.save();
  throw unauthorized('That code is not right');
}

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
  assertNotLocked(user);

  const step = totp.verify(decrypt(user.twoFactor.pendingSecretEnc), String(code).replace(/\s/g, ''));
  if (step === null) await recordFailure(user);

  const recoveryCodes = newRecoveryCodes();
  user.twoFactor.enabled = true;
  user.twoFactor.secretEnc = user.twoFactor.pendingSecretEnc;
  user.twoFactor.pendingSecretEnc = undefined;
  user.twoFactor.lastUsedStep = step;
  user.twoFactor.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);
  user.twoFactor.failedAttempts = 0;
  user.twoFactor.lockedUntil = undefined;
  user.twoFactor.enabledAt = new Date();
  await user.save();

  return { user: toPublicUser(user), token: signToken(user), recoveryCodes };
}

// Every login after set-up: a six-digit code, or one of the recovery codes (each works once).
async function verifyLogin({ challengeToken, code }) {
  const payload = readStepToken(challengeToken, 'mfa');
  const user = await loadUser(payload.sub);
  if (!user.twoFactor || !user.twoFactor.enabled) throw unauthorized('That sign-in has expired. Please log in again.');
  assertNotLocked(user);

  const entered = String(code).replace(/[\s-]/g, '');
  let recoveryUsed = false;
  if (/^\d{6}$/.test(entered)) {
    const afterStep = typeof user.twoFactor.lastUsedStep === 'number' ? user.twoFactor.lastUsedStep : -1;
    const step = totp.verify(decrypt(user.twoFactor.secretEnc), entered, { afterStep });
    if (step === null) await recordFailure(user);
    user.twoFactor.lastUsedStep = step;
  } else {
    const hash = hashRecoveryCode(entered);
    const hashes = user.twoFactor.recoveryCodeHashes || [];
    if (!hashes.includes(hash)) await recordFailure(user);
    user.twoFactor.recoveryCodeHashes = hashes.filter((h) => h !== hash);
    recoveryUsed = true;
  }

  user.twoFactor.failedAttempts = 0;
  user.twoFactor.lockedUntil = undefined;
  await user.save();
  return {
    user: toPublicUser(user),
    token: signToken(user),
    recoveryCodesLeft: user.twoFactor.recoveryCodeHashes.length,
    recoveryUsed,
  };
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
    enabledAt: undefined,
  };
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
