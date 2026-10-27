const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY = '7d';

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

module.exports = { signToken, toPublicUser };
