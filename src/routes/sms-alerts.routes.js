const express = require('express');
const SmsAlertsController = require('../controllers/SmsAlertsController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { perUserLimiter } = require('../middleware/user-rate-limit');
const { enableSmsSchema } = require('../validation/sms-alerts.validation');

const router = express.Router();

// A person's own text alert settings. Customers and cleaners only, and only ever their own.
const people = [requireAuth, requireRole('customer', 'cleaner')];

// Changing the number is not something anyone needs to do many times an hour.
const changes = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SMS_SETTINGS_RATE_LIMIT_MAX) || 20,
  message: 'Too many changes. Please try again in an hour.',
});

router.get('/me', ...people, SmsAlertsController.get);
router.put('/me', ...people, changes, validateBody(enableSmsSchema), SmsAlertsController.enable);
router.delete('/me', ...people, changes, SmsAlertsController.disable);

module.exports = router;
