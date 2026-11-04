const mongoose = require('mongoose');

// A customer or cleaner asking, from their account page, for a copy of their data or for their
// account to be erased (UK GDPR Arts. 15 and 17). An admin checks it and does the work in the
// Privacy Requests tab. We have one month to answer, so `dueAt` is set when it arrives.
const dataRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['export', 'erase'], required: true },
    status: { type: String, enum: ['pending', 'done', 'declined'], default: 'pending', index: true },
    // Anything the person wants to add. Removed when their account is erased.
    note: { type: String, maxlength: 500 },
    dueAt: { type: Date, required: true },
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    outcomeNote: { type: String, maxlength: 500 },
    // Closed requests are kept 6 years, like the audit entries for copies and erasures, as proof
    // that the request was answered. Open ones have no date.
    expireAt: { type: Date },
  },
  { timestamps: true }
);

dataRequestSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DataRequest', dataRequestSchema);
