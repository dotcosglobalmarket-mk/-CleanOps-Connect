const mongoose = require('mongoose');

// One in-app chat message between the customer and the cleaner booked on a
// job. `body` is always the already-masked text: the original is never stored
// (UK GDPR data minimisation), only a flag and the kinds of detail hidden.
const messageSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['customer', 'cleaner'],
      required: true,
    },
    body: {
      type: String,
      required: true,
      maxlength: 1500,
    },
    contactMasked: {
      type: Boolean,
      default: false,
    },
    maskedKinds: {
      type: [String],
      default: [],
    },
    // Set when the other party fetches the message.
    readAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ job: 1, createdAt: 1 });
messageSchema.index({ job: 1, senderRole: 1, readAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
