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
      enum: ['one_off', 'weekly', 'fortnightly', 'monthly', 'contract'],
      default: 'one_off',
    },
    // Set on every visit of a recurring series (visit 1 is the job the customer
    // posted). The pair is unique, so a visit can never be created twice.
    series: { type: mongoose.Schema.Types.ObjectId, ref: 'Series' },
    visitNumber: { type: Number },
    // 'scheduled' = made ahead by the series and not yet charged; it stays out of
    // the ordinary job lists until then.
    visitState: { type: String, enum: ['scheduled', 'skipped'] },
    // Automatic charging of a scheduled visit (see visit-charging.service.js).
    chargeAttempts: { type: Number, default: 0 },
    nextChargeAttemptAt: { type: Date },
    // Why a visit did not happen: skipped by the customer, the cleaner, a card that
    // could not be charged, or because it was never reached (e.g. series paused).
    skipReason: { type: String, enum: ['customer', 'cleaner', 'payment', 'missed', 'series_ended'] },
    // When the customer would like the visit (UK time on screen, stored as an
    // instant). Optional: tenders and older jobs have none.
    preferredStartAt: {
      type: Date,
    },
    budgetMin: {
      type: Number,
      required: true,
    },
    budgetMax: {
      type: Number,
      required: true,
    },
    // Industrial jobs can be run as a tender: invited cleaners each send a
    // quote (their own price) and the customer awards one. Standard jobs are
    // first-to-accept.
    procurement: {
      type: String,
      enum: ['standard', 'tender'],
      default: 'standard',
    },
    tender: {
      closesAt: { type: Date },
      requirements: { type: String, maxlength: 3000 },
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
      // Set by the cleaner at booking, immutable once booked. The platform
      // never sets, requires or negotiates it (self-employment requirement).
      // It may show an optional, area-wide guide to typical local rates (see
      // price-guide.service.js), which the cleaner is free to ignore.
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
    // Free-text detail the customer gave alongside the reason code.
    disputeDetail: {
      type: String,
      maxlength: 2000,
    },
    disputedAt: {
      type: Date,
    },
    // When the cleaner checked in, and when/how the job was confirmed.
    // Recorded for the service record; older jobs simply have none.
    checkedInAt: {
      type: Date,
    },
    confirmedAt: {
      type: Date,
    },
    confirmationMethod: {
      type: String,
      enum: ['customer', 'automatic'],
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

// One job per visit of a series: the guarantee that running the visit generator
// twice (or two servers at once) cannot make the same visit twice.
jobSchema.index({ series: 1, visitNumber: 1 }, { unique: true, partialFilterExpression: { series: { $exists: true } } });

module.exports = mongoose.model('Job', jobSchema);
