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
    // Two-step login (see two-factor.service.js). The authenticator secret is
    // stored encrypted and recovery codes only as hashes.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String },
      pendingSecretEnc: { type: String },
      recoveryCodeHashes: { type: [String], default: [] },
      lastUsedStep: { type: Number },
      failedAttempts: { type: Number, default: 0 },
      lockedUntil: { type: Date },
      enabledAt: { type: Date },
    },
    // Single-use password reset token — only the SHA-256 hash is stored,
    // never the raw token the user receives by email, so a database
    // compromise alone can't be used to reset anyone's password.
    resetPasswordTokenHash: {
      type: String,
    },
    resetPasswordExpiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
