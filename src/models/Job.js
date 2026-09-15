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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Job', jobSchema);
