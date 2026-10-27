const mongoose = require('mongoose');

// A photo attached to a job (see job-photo.service.js): the cleaner's before
// and after pictures, or the pictures a customer sends with a problem report.
// The picture itself is a DocumentFile, which MongoDB deletes on its own once
// its `expireAt` passes; this record only describes it.
const jobPhotoSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploaderRole: { type: String, enum: ['cleaner', 'customer'], required: true },
    kind: { type: String, enum: ['before', 'after', 'problem'], required: true },
    originalName: { type: String, maxlength: 200 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentFile', required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobPhoto', jobPhotoSchema);
