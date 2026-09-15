const express = require('express');
const SubscriptionController = require('../controllers/SubscriptionController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('cleaner', 'admin'), SubscriptionController.activate);
router.post('/insurance', requireAuth, requireRole('cleaner', 'admin'), SubscriptionController.addInsurance);

module.exports = router;
