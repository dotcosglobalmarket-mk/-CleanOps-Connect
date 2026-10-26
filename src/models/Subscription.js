const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    cleaner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleanerProfile',
      required: true,
    },
    plan: {
      type: String,
      enum: ['starter', 'pro', 'industrial_pro'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Monthly platform fee actually billed via Stripe (see
    // subscription.service.js PLAN_PRICES_PENCE) — snapshotted here so a
    // later price change doesn't rewrite the history of what was charged.
    pricePence: {
      type: Number,
    },
    stripeSubscriptionId: {
      type: String,
    },
    // Stripe's own subscription.status (active/past_due/canceled/...),
    // synced from customer.subscription.updated/deleted webhooks.
    stripeStatus: {
      type: String,
    },
    insuranceAddOn: {
      type: Boolean,
      default: false,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    renewsAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
