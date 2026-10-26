const mongoose = require('mongoose');

// The raw bytes of an uploaded compliance document, kept apart from the
// CleanerDocument record that describes it. MongoDB deletes the file on its
// own once `expireAt` passes (a TTL index), while the review record stays:
// that is how DBS certificate copies are removed after the retention period.
const documentFileSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true },
    expireAt: { type: Date, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocumentFile', documentFileSchema);
