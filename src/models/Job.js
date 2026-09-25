const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    serviceType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceType',
      required: true,
    },
    category: {
      type: String,
      enum: ['domestic', 'industrial'],
      required: true,
    },
    postcode: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
    },
    lng: {
      type: Number,
    },
    description: {
      type: String,
    },
    estimatedHours: {
      type: Number,
    },
    frequency: {
      type: String,
      enum: ['one_off', 'weekly', 'monthly', 'contract'],
      default: 'one_off',
    },
    budgetMin: {
      type: Number,
      required: true,
    },
    budgetMax: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'allocated', 'in_progress', 'completed', 'cancelled'],
      default: 'open',
    },

    // --- Payment / escrow lifecycle (see src/services/payment-state-machine.js) ---
    // Kept separate from `status` above, which governs the lead-allocation
    // workflow — the two are independent state machines over the same job.
    cleaner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleanerProfile',
    },
    pricePence: {
      // Set by the cleaner at booking, immutable once booked. Never set or
      // suggested by the platform (self-employment requirement).
      type: Number,
    },
    commissionRate: {
      // Snapshot of the cleaner's commission_tier_rate, taken at CONFIRMED
      // — never at booking time.
      type: Number,
    },
    commissionPence: {
      type: Number,
    },
    cleanerPayoutPence: {
      type: Number,
    },
    paymentStatus: {
      type: String,
      enum: [
        'BOOKED',
        'PAID_HELD',
        'CANCELLED',
        'CANCELLED_BY_CLEANER',
        'CANCELLED_BY_CUSTOMER',
        'IN_PROGRESS',
        'AWAITING_CONFIRMATION',
        'DISPUTED',
        'RESOLVED_REFUND',
        'RESOLVED_PARTIAL',
        'RESOLVED_PAYOUT',
        'CONFIRMED',
        'PAYOUT_PENDING',
        'PAYOUT_BLOCKED',
        'TRANSFER_FAILED',
        'MANUAL_REVIEW_HOLD',
        'PAID_OUT',
        'REFUNDED',
        'PARTIALLY_REFUNDED',
      ],
    },
    stripePaymentIntentId: {
      type: String,
    },
    stripeTransferId: {
      type: String,
    },
    payoutAttemptCount: {
      type: Number,
      default: 0,
    },
    // Not in the original spec's data table, but required to implement the
    // "5min -> 30min -> 2hr" exponential backoff without polling every job
    // on every worker tick.
    nextPayoutRetryAt: {
      type: Date,
    },
    disputeReason: {
      type: String,
    },
    awaitingConfirmationAt: {
      type: Date,
    },
    // When the job was booked with a cleaner. The customer cancellation
    // refund window is measured from this, not from createdAt.
    bookedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Job', jobSchema);
