const mongoose = require('mongoose');

// Maker-checker for dispute refunds. When an operator resolves a dispute
// with a refund above OPS_REFUND_LIMIT_PENCE, the resolution is stored here
// and only executed once an admin approves it.
const approvalRequestSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    outcome: {
      type: String,
      enum: ['refund', 'partial'],
      required: true,
    },
    refundPence: {
      type: Number,
      required: true,
    },
    payoutPence: {
      type: Number,
      default: 0,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    decisionReason: {
      type: String,
      maxlength: 2000,
    },
    decidedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Only one pending approval per job at a time.
approvalRequestSchema.index(
  { job: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('ApprovalRequest', approvalRequestSchema);
