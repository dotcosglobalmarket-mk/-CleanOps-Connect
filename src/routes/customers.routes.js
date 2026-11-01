const express = require('express');
const CustomerCardController = require('../controllers/CustomerCardController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { perUserLimiter } = require('../middleware/user-rate-limit');
const { saveCardSchema, agreeSchema } = require('../validation/customer-card.validation');

const router = express.Router();

// A customer's own saved card. Customers only, and only ever their own.
const customerOnly = [requireAuth, requireRole('customer')];

// Saving a card checks it with the bank, so an unlimited form is a way to test stolen card
// numbers. A real customer needs a handful of attempts an hour, not hundreds.
const cardAttempts = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.CARD_RATE_LIMIT_MAX) || 10,
  message: 'Too many card attempts. Please try again in an hour.',
});

router.get('/me/card', ...customerOnly, CustomerCardController.get);
router.post('/me/card/setup-intent', ...customerOnly, cardAttempts, CustomerCardController.setupIntent);
router.post('/me/card', ...customerOnly, cardAttempts, validateBody(saveCardSchema), CustomerCardController.save);
router.post('/me/card/consent', ...customerOnly, validateBody(agreeSchema), CustomerCardController.agree);
router.delete('/me/card', ...customerOnly, CustomerCardController.remove);

module.exports = router;
