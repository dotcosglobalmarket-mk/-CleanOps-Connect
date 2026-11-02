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
    // True once the subscription is set to end at the close of the period the
    // cleaner has already paid for (mirrors Stripe's cancel_at_period_end).
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    // A cleaner asks to leave; an admin decides. Set while the request waits,
    // cleared when it is withdrawn or declined.
    cancellationRequestedAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      maxlength: 500,
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
