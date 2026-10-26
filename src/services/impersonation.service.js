const jwt = require('jsonwebtoken');
const CleanerProfile = require('../models/CleanerProfile');
const authService = require('./auth.service');
const auditService = require('./audit.service');

// Short-lived, read-only. Separate from the normal 7-day staff session so
// a forgotten support session can't linger with standing access to a
// cleaner's account.
const IMPERSONATION_TOKEN_EXPIRY = '30m';
const IMPERSONATION_TOKEN_EXPIRY_SECONDS = 30 * 60;

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

// Admins only (see requirePermission('cleaners.impersonate') on the
// route) start a read-only session as a cleaner, to see exactly what
// they see while diagnosing a support ticket. The resulting token's role
// claim is 'cleaner' — it passes every cleaner-only route check — but
// requireAuth rejects any non-GET request made with it.
async function start(cleanerProfileId, reason, req) {
  const cleaner = await CleanerProfile.findById(cleanerProfileId).populate('user');
  if (!cleaner || !cleaner.user) throw notFound('Cleaner not found');

  const token = jwt.sign({ sub: cleaner.user._id.toString(), role: 'cleaner', imp: req.user.id }, process.env.JWT_SECRET, {
    expiresIn: IMPERSONATION_TOKEN_EXPIRY,
  });

  await auditService.record({
    req,
    action: 'cleaner.impersonation.start',
    targetType: 'cleaner',
    targetId: cleaner._id,
    after: { cleanerUserId: cleaner.user._id },
    reason,
  });

  return {
    token,
    expiresInSeconds: IMPERSONATION_TOKEN_EXPIRY_SECONDS,
    cleaner: authService.toPublicUser(cleaner.user),
  };
}

module.exports = {
  start,
};
