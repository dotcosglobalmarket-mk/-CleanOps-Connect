const mongoose = require('mongoose');

// A recurring booking: one cleaner, one customer, one price per visit, repeating
// until endsOn. Every visit is an ordinary Job linked back here, so payment,
// confirmation, commission, disputes and reviews all run per visit as they do for
// one-off jobs.
const seriesSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cleaner: { type: mongoose.Schema.Types.ObjectId, ref: 'CleanerProfile', required: true },
    // Visit 1: the job the customer posted and the cleaner accepted.
    firstJob: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    serviceType: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceType', required: true },
    category: { type: String, enum: ['domestic'], required: true },
    postcode: { type: String, required: true },
    lat: { type: Number },
    lng: { type: Number },
    description: { type: String },
    estimatedHours: { type: Number },
    budgetMin: { type: Number },
    budgetMax: { type: Number },
    frequency: { type: String, enum: ['weekly', 'fortnightly', 'monthly'], required: true },
    // The cleaner sets this once when accepting; it is fixed for the series.
    pricePence: { type: Number, required: true },
    firstVisitAt: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    // awaiting_card: visit 1 not yet paid, or no saved card yet. Visits are only
    // made once it is active. paused/cancelled/ended are set by the later rules.
    status: {
      type: String,
      enum: ['awaiting_card', 'active', 'paused', 'cancelled', 'ended'],
      default: 'awaiting_card',
    },
    // Highest visit number made so far (visit 1 is the first job).
    visitsCreated: { type: Number, default: 1 },
    activatedAt: { type: Date },
    // Consecutive visits skipped because the card could not be charged. Two pause the series.
    paymentFailureStreak: { type: Number, default: 0 },
    // Visits the cleaner has cancelled. A second one pauses the series.
    cleanerCancellations: { type: Number, default: 0 },
    pausedBy: { type: String, enum: ['customer', 'payment', 'cleaner_cancellations'] },
    pausedAt: { type: Date },
    cancelledAt: { type: Date },
    // Set when the cleaner gives their 14 days' notice to end the series.
    endNoticeGivenAt: { type: Date },
    // When the customer was told the series is about to end (14 days before). Sent once.
    renewalReminderSentAt: { type: Date },
  },
  { timestamps: true }
);

seriesSchema.index({ status: 1 });
seriesSchema.index({ customer: 1, createdAt: -1 });
seriesSchema.index({ cleaner: 1, createdAt: -1 });

module.exports = mongoose.model('Series', seriesSchema);
