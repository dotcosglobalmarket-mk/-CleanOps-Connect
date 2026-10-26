const { rateLimit } = require('express-rate-limit');

// Each AI writing call costs money, so all AI writing endpoints share one
// per-IP budget.
const aiWritingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.AI_DESCRIBE_RATE_LIMIT_MAX) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many writing-help requests, please try again later' },
});

module.exports = { aiWritingLimiter };
