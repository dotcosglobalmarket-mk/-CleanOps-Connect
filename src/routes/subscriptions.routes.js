const express = require('express');
const SubscriptionController = require('../controllers/SubscriptionController');

const router = express.Router();

router.post('/', SubscriptionController.activate);
router.post('/insurance', SubscriptionController.addInsurance);

module.exports = router;
