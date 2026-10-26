const mongoose = require('mongoose');

// One row per Stripe invoice for a cleaner's platform subscription, kept so
// the admin Revenue tab can show what was billed and what failed. Written
// only from the invoice webhooks (see subscription.service.js), so it holds
// payments from the day those webhooks were switched on.
const subscriptionPaymentSchema = new mongoose.Schema(
  {
    stripeInvoiceId: { type: String, required: true, unique: true },
    stripeSubscriptionId: { type: String, index: true },
    cleaner: { type: mongoose.Schema.Types.ObjectId, ref: 'CleanerProfile' },
    plan: { type: String },
    amountPence: { type: Number, required: true },
    status: { type: String, enum: ['paid', 'failed'], required: true },
    attemptCount: { type: Number },
    // Failed invoices only: when Stripe will try again (absent once it gives up).
    nextRetryAt: { type: Date },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
