const express = require('express');
const AccountController = require('../controllers/AccountController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { perUserLimiter } = require('../middleware/user-rate-limit');
const { changePasswordSchema, dataRequestSchema } = require('../validation/account.validation');

const router = express.Router();

// A person's own account. Customers and cleaners only, and only ever their own.
const people = [requireAuth, requireRole('customer', 'cleaner')];

const passwordLimiter = perUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ACCOUNT_PASSWORD_RATE_LIMIT_MAX) || 5,
  message: 'Too many attempts. Please try again in 15 minutes.',
});
const requestLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ACCOUNT_REQUEST_RATE_LIMIT_MAX) || 5,
  message: 'Too many requests. Please try again in an hour.',
});

router.post('/change-password', ...people, passwordLimiter, validateBody(changePasswordSchema), AccountController.changePassword);
router.get('/data-requests', ...people, AccountController.listDataRequests);
router.post('/data-requests', ...people, requestLimiter, validateBody(dataRequestSchema), AccountController.createDataRequest);

module.exports = router;
