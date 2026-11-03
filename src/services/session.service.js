const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY = '7d';

// `tv` is the user's tokenVersion when the session was issued. requireAuth
// refuses a session whose `tv` no longer matches, which is how a password
// reset or a staff reset ends every session already out there.
function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

// Call before saving the user: every session issued so far stops working.
function revokeSessions(user) {
  user.tokenVersion = (user.tokenVersion || 0) + 1;
}

// True when a verified session token is still the current one for this user.
// Tokens issued before tokenVersion existed carry no `tv`; they are left to
// expire on their own (at most 7 days).
function isCurrent(payload, user) {
  if (payload.tv === undefined) return true;
  if (!user || user.active === false) return false;
  return (user.tokenVersion || 0) === payload.tv;
}

function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerification && user.emailVerification.verifiedAt),
  };
}

module.exports = { signToken, toPublicUser, revokeSessions, isCurrent };
