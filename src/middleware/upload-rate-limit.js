const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Uploads are the heaviest requests (up to 5 MB each, stored in the database), so
// each person gets a generous but finite number per hour. Counted per logged-in
// person, not per address, so one office sharing an IP is not penalised. Mount it
// AFTER requireAuth and BEFORE express.raw, so a refused upload is never read.
// UPLOAD_RATE_LIMIT_MAX replaces every limit (tests raise it).
const HOUR_MS = 60 * 60 * 1000;

const limitFor = (normal) => Number(process.env.UPLOAD_RATE_LIMIT_MAX) || normal;

function uploadLimiter({ limit, windowMs = HOUR_MS }) {
  return rateLimit({
    windowMs,
    limit: limitFor(limit),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user && req.user.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    message: { message: "You've uploaded a lot in a short time. Please wait a little and try again." },
  });
}

module.exports = { uploadLimiter, limitFor };
