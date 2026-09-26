const mongoose = require('mongoose');

// A customer's review of the cleaner who did their job. Only the customer
// on a completed booking can leave one, and only one per job, so every
// review comes from a verified booking.
const reviewSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    cleaner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleanerProfile',
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      maxlength: 1000,
    },
    // Staff can hide a review only for a content-policy reason (abuse,
    // personal data, unrelated content), recorded in the audit log. Hidden
    // reviews still count towards nothing and are never deleted.
    status: {
      type: String,
      enum: ['published', 'hidden'],
      default: 'published',
    },
    hiddenReason: {
      type: String,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

reviewSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
