const mongoose = require('mongoose');

const cleanerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    companyName: {
      type: String,
    },
    basePostcode: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
    },
    lng: {
      type: Number,
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServiceType',
      },
    ],
    coverageType: {
      type: String,
      enum: ['radius', 'polygon'],
      default: 'radius',
    },
    coverageRadiusKm: {
      type: Number,
    },
    coveragePolygon: {
      type: {
        type: String,
        enum: ['Polygon'],
      },
      coordinates: {
        type: [[[Number]]],
      },
    },
    dbsVerified: {
      type: Boolean,
      default: false,
    },
    coshhTrained: {
      type: Boolean,
      default: false,
    },
    insuranceStatus: {
      type: String,
      enum: ['none', 'own', 'platform'],
      default: 'none',
    },
    ratingAverage: {
      type: Number,
      default: 0,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    aiScoreBase: {
      type: Number,
      default: 0,
    },
    experienceYears: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

cleanerProfileSchema.index({ coveragePolygon: '2dsphere' });

module.exports = mongoose.model('CleanerProfile', cleanerProfileSchema);
