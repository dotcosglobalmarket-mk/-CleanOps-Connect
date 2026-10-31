const express = require('express');
const CustomerCardController = require('../controllers/CustomerCardController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { saveCardSchema, agreeSchema } = require('../validation/customer-card.validation');

const router = express.Router();

// A customer's own saved card. Customers only, and only ever their own.
const customerOnly = [requireAuth, requireRole('customer')];

router.get('/me/card', ...customerOnly, CustomerCardController.get);
router.post('/me/card/setup-intent', ...customerOnly, CustomerCardController.setupIntent);
router.post('/me/card', ...customerOnly, validateBody(saveCardSchema), CustomerCardController.save);
router.post('/me/card/consent', ...customerOnly, validateBody(agreeSchema), CustomerCardController.agree);
router.delete('/me/card', ...customerOnly, CustomerCardController.remove);

module.exports = router;
