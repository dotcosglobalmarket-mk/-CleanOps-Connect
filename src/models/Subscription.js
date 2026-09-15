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
