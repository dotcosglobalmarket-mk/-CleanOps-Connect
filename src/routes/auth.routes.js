const express = require('express');
const { rateLimit } = require('express-rate-limit');
const AuthController = require('../controllers/AuthController');
const { validateBody } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validation/auth.validation');

const router = express.Router();

// Slows down credential stuffing and mass account creation. Counted per
// client IP across both endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again in 15 minutes' },
});

router.post('/register', authLimiter, validateBody(registerSchema), AuthController.register);
router.post('/login', authLimiter, validateBody(loginSchema), AuthController.login);

module.exports = router;
