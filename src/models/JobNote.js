const mongoose = require('mongoose');

// Internal support notes on a job, written by staff. Never shown to the
// customer or cleaner. Append-only: notes are not edited or deleted.
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

module.exports = mongoose.model('JobNote', jobNoteSchema);
