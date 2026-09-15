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
      enum: ['sent', 'accepted', 'declined', 'expired'],
      default: 'sent',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobOffer', jobOfferSchema);
