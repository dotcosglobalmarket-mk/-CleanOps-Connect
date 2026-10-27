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
    // Optional profile picture or company logo (see cleaner-photo.service.js).
    // The picture itself is a DocumentFile; `updatedAt` lets pages cache it.
    photo: {
      file: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFile' },
      updatedAt: { type: Date },
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
    available: {
      type: Boolean,
      default: true,
    },
    bio: {
      type: String,
    },
    hourlyRate: {
      type: Number,
    },
    responseTime: {
      type: String,
    },
    travelDistanceMiles: {
      type: Number,
    },
    phoneNumber: {
      type: String,
    },
    contactEmail: {
      type: String,
    },
    website: {
      type: String,
    },
    instagram: {
      type: String,
    },
    workingDays: {
      type: [String],
      enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      default: [],
    },
    startTime: {
      type: String,
    },
    endTime: {
      type: String,
    },
    acceptEmergencyBookings: {
      type: Boolean,
      default: false,
    },
    customServices: {
      type: [String],
      default: [],
    },

    // --- Payment / Stripe Connect (see src/services/payment-state-machine.js) ---
    stripeConnectedAccountId: {
      type: String,
    },
    // Separate from stripeConnectedAccountId above: this is a platform-
    // account Customer the cleaner is billed FROM (monthly subscription
    // fee), not a Connect account funds are paid INTO.
    stripeCustomerId: {
      type: String,
    },    payoutsEnabled: {
      // Synced from the account.updated webhook. A Transfer must never be
      // attempted while this is false.
      type: Boolean,
      default: false,
    },
    commissionTier: {
      type: String,
      enum: ['standard', 'premium'],
      default: 'standard',
    },
    commissionTierRate: {
      // Deductive commission: subtracted from the cleaner's own price,
      // never added to what the customer pays. Read live at CONFIRMED,
      // never cached at booking time.
      type: Number,
      default: 0.15,
    },
    // dbsVerified / coshhTrained / insuranceStatus above already cover
    // "dbs_verified" / "coshh_verified" / "insurance_verified" from the
    // spec's data model — not duplicated here to avoid two fields drifting
    // out of sync.
    selfEmploymentEvidenceRef: {
      // Pointer to stored UTR/insurance doc, not the raw document inline.
      type: String,
    },
    deactivationStatus: {
      // Any suspension triggered by ratings/algorithmic scoring must route
      // here as "under_review" first — never straight to "suspended"
      // without a human review step.
      type: String,
      enum: ['active', 'under_review', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true }
);

cleanerProfileSchema.index({ coveragePolygon: '2dsphere' });

module.exports = mongoose.model('CleanerProfile', cleanerProfileSchema);
