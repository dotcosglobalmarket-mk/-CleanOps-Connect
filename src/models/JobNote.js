const mongoose = require('mongoose');

// Internal support notes on a job, written by staff. Never shown to the
// customer or cleaner. Not edited by anyone; MongoDB deletes each note 12 months
// after it was written (see the privacy notice).
const jobNoteSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    body: {
      type: String,
      required: true,
      maxlength: 2000,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

jobNoteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('JobNote', jobNoteSchema);
