const { rateLimit } = require('express-rate-limit');

// A limit counted per signed-in user, not per IP: one account cannot make unlimited
// attempts however many addresses it comes from. Use it after requireAuth.
function perUserLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : 'anonymous'),
    message: { message },
  });
}

module.exports = { perUserLimiter };
