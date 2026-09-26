const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['customer', 'cleaner', 'operator', 'admin'],
      default: 'customer',
    },
    // Staff accounts are deactivated rather than deleted so the audit trail
    // keeps pointing at a real user. Inactive accounts cannot log in.
    active: {
      type: Boolean,
      default: true,
    },
    phone: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
