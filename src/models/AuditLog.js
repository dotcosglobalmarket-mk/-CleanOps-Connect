const mongoose = require('mongoose');

// Append-only record of every action taken by staff (operators and admins).
// Supports UK GDPR accountability (Art. 5(2)) and dispute/refund review:
// who did what, to which record, when, and why.
const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String,
      enum: ['job', 'cleaner', 'user', 'approval'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    ip: {
      type: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

function refuseChange(next) {
  next(new Error('Audit log entries cannot be changed or deleted'));
}

[
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
].forEach((hook) => auditLogSchema.pre(hook, refuseChange));

auditLogSchema.pre('save', function preventEdit(next) {
  if (!this.isNew) return refuseChange(next);
  next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
