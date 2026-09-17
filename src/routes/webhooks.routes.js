const express = require('express');
const StripeWebhookController = require('../controllers/StripeWebhookController');

const router = express.Router();

// Stripe requires the raw, unparsed request body to verify the webhook
// signature — express.raw() is applied where this router is mounted in
// app.js, before the global express.json() middleware.
router.post('/stripe', StripeWebhookController.handle);

module.exports = router;
