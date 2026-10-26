const mongoose = require('mongoose');

// A certificate a cleaner has uploaded for staff to check (see
// compliance-document.service.js). Approving one is what switches on the
// matching badge on their profile; the file itself lives in DocumentFile.
const cleanerDocumentSchema = new mongoose.Schema(
  {
    cleaner: { type: mongoose.Schema.Types.ObjectId, ref: 'CleanerProfile', required: true, index: true },
    type: { type: String, enum: ['dbs', 'coshh', 'insurance'], required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'superseded', 'expired'],
      default: 'pending',
      index: true,
    },
    originalName: { type: String, maxlength: 200 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFile' },
    uploadedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 500 },
    // Insurance (always) and COSHH (optional): the date the certificate runs out.
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CleanerDocument', cleanerDocumentSchema);
