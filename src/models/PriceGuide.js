const mongoose = require('mongoose');

// A cached "typical local rate" guide for one service in one postcode
// district. Looking it up on the web costs money and takes a while, and
// caching also means everyone in an area sees the same figures.
const priceGuideSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    area: { type: String, required: true },
    serviceType: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceType', required: true },
    found: { type: Boolean, required: true },
    hourlyLowPence: { type: Number },
    hourlyHighPence: { type: Number },
    scope: { type: String, enum: ['local', 'regional', 'national'] },
    basis: { type: String, maxlength: 400 },
    confidence: { type: String, enum: ['low', 'medium', 'high'] },
    sources: [{ _id: false, title: String, url: String }],
    generatedAt: { type: Date, required: true },
    // Removed automatically by MongoDB once this time passes.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: false }
);

module.exports = mongoose.model('PriceGuide', priceGuideSchema);
