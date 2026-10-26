const express = require('express');
const SubscriptionController = require('../controllers/SubscriptionController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const {
  setupIntentSchema,
  activateSubscriptionSchema,
  insuranceAddOnSchema,
} = require('../validation/subscription.validation');

const router = express.Router();

router.get('/me', requireAuth, requireRole('cleaner'), SubscriptionController.mySubscription);
router.post(
  '/setup-intent',
  requireAuth,
  requireRole('cleaner', 'admin'),
  validateBody(setupIntentSchema),
  SubscriptionController.createSetupIntent
);
router.post(
  '/',
  requireAuth,
  requireRole('cleaner', 'admin'),
  validateBody(activateSubscriptionSchema),
  SubscriptionController.activate
);
router.post(
  '/insurance',
  requireAuth,
  requireRole('cleaner', 'admin'),
  validateBody(insuranceAddOnSchema),
  SubscriptionController.addInsurance
);

module.exports = router;
