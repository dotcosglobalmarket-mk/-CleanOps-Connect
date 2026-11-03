const User = require('../models/User');
const emailVerificationService = require('../services/email-verification.service');

// Use after requireAuth. A customer or cleaner who registered recently and has not yet
// confirmed their email address cannot do the action; everyone else is unaffected.
async function requireVerifiedEmail(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (emailVerificationService.isBlocked(user)) {
      return res.status(403).json({
        code: 'email_not_verified',
        message: 'Please confirm your email address first. We emailed you a link; you can ask for another from your dashboard.',
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireVerifiedEmail };
