const mongoose = require('mongoose');

const serviceTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    category: {
      type: String,
      enum: ['domestic', 'industrial'],
      required: true,
    },
    description: {
      type: String,
    },
    requiresCoshh: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceType', serviceTypeSchema);
