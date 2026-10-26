const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const notificationService = require('./notification.service');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
  };
}

async function register({ name, email, password, role, phone }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw conflict('Email already registered');
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({ name, email, passwordHash, role, phone });

  return { user: toPublicUser(user), token: signToken(user) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw unauthorized('Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw unauthorized('Invalid email or password');
  }

  if (user.active === false) {
    throw unauthorized('This account has been deactivated');
  }

  return { user: toPublicUser(user), token: signToken(user) };
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Always resolves the same way whether or not the email is registered —
// the caller must not be able to tell which emails exist in the system
// from this endpoint's response.
async function requestPasswordReset(email) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;

  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordTokenHash = hashToken(token);
  user.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);
  await user.save();

  await notificationService.passwordResetRequested(user, token);
}

async function resetPassword(token, newPassword) {
  const user = await User.findOne({
    resetPasswordTokenHash: hashToken(token),
    resetPasswordExpiresAt: { $gt: new Date() },
  });
  if (!user) {
    throw badRequest('This reset link is invalid or has expired');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetPasswordTokenHash = undefined;
  user.resetPasswordExpiresAt = undefined;
  await user.save();

  return { user: toPublicUser(user), token: signToken(user) };
}

module.exports = {
  register,
  login,
  hashPassword,
  toPublicUser,
  requestPasswordReset,
  resetPassword,
};
