const express = require('express');
const PricingController = require('../controllers/PricingController');
const { aiWritingLimiter } = require('../middleware/ai-rate-limit');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { priceGuideSchema } = require('../validation/pricing.validation');

const router = express.Router();

// A suggested range of typical local rates (customers see it as a budget
// guide, cleaners as a price guide). Informational only.
router.post(
  '/guide',
  requireAuth,
  requireRole('customer', 'cleaner'),
  aiWritingLimiter,
  validateBody(priceGuideSchema),
  PricingController.guide
);

module.exports = router;
