const express = require('express');
const { rateLimit } = require('express-rate-limit');
const AuthController = require('../controllers/AuthController');
const { requireAuth } = require('../middleware/auth');
const { perUserLimiter } = require('../middleware/user-rate-limit');
const { validateBody } = require('../middleware/validate');
const {
  registerSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  twoFactorSetupSchema,
  twoFactorEnableSchema,
  twoFactorVerifySchema,
  verifyEmailSchema,
} = require('../validation/auth.validation');

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
router.post(
  '/request-password-reset',
  authLimiter,
  validateBody(requestPasswordResetSchema),
  AuthController.requestPasswordReset
);
router.post('/reset-password', authLimiter, validateBody(resetPasswordSchema), AuthController.resetPassword);

// Confirming the email address. The link in the email is the credential for verify-email;
// resend and status are for the signed-in person only.
router.post('/verify-email', authLimiter, validateBody(verifyEmailSchema), AuthController.verifyEmail);
router.post(
  '/resend-verification',
  requireAuth,
  perUserLimiter({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many requests. Please try again in an hour.' }),
  AuthController.resendVerification
);
router.get('/email-status', requireAuth, AuthController.emailStatus);

// Two-step login. These take the short-lived token the password step hands out,
// not a session, and share the per-IP limit above (wrong codes also lock the account).
router.post('/2fa/setup', authLimiter, validateBody(twoFactorSetupSchema), AuthController.twoFactorSetup);
router.post('/2fa/enable', authLimiter, validateBody(twoFactorEnableSchema), AuthController.twoFactorEnable);
router.post('/2fa/verify', authLimiter, validateBody(twoFactorVerifySchema), AuthController.twoFactorVerify);

module.exports = router;
