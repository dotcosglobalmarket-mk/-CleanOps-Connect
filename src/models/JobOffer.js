const mongoose = require('mongoose');

const jobOfferSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    cleaner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleanerProfile',
      required: true,
    },
    score: {
      type: Number,
      required: true,
    },
    scoreBreakdown: {
      distance: { type: Number, default: 0 },
      experience: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
      priceFit: { type: Number, default: 0 },
      insurance: { type: Number, default: 0 },
      compliance: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['sent', 'quoted', 'accepted', 'declined', 'expired'],
      default: 'sent',
    },
    // Tender quotes only: the cleaner's own price and note to the customer.
    quotePricePence: { type: Number },
    quoteMessage: { type: String, maxlength: 1500 },
    quotedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobOffer', jobOfferSchema);
