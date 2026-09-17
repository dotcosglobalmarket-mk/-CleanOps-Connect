const mongoose = require('mongoose');

// Inbound webhook dedup table. Stripe's delivery guarantee is at-least-once,
// never exactly-once — every handler must ALSO guard on current job state
// before acting, independent of this table (see payment.service.js).
const processedWebhookEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
  },
  receivedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('ProcessedWebhookEvent', processedWebhookEventSchema);
