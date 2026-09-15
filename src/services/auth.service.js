const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';

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

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
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

  return { user: toPublicUser(user), token: signToken(user) };
}

module.exports = {
  register,
  login,
};
