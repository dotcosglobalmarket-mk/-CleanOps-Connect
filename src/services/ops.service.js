const Job = require('../models/Job');
const CleanerProfile = require('../models/CleanerProfile');
const ApprovalRequest = require('../models/ApprovalRequest');
const JobNote = require('../models/JobNote');
const adminService = require('./admin.service');
const auditService = require('./audit.service');
const paymentService = require('./payment.service');
const { STATES } = require('./payment-state-machine');
const { hasPermission } = require('../config/permissions');

// Refunds above this need an admin's approval when an operator resolves a
// dispute (maker-checker). Default £150.
const DEFAULT_OPS_REFUND_LIMIT_PENCE = 15000;
const AUTO_CONFIRM_WINDOW_HOURS = 48;

function opsRefundLimitPence() {
  const configured = Number(process.env.OPS_REFUND_LIMIT_PENCE);
  return Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_OPS_REFUND_LIMIT_PENCE;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// --- Summary ---

async function getSummary() {
  const overdueBefore = new Date(Date.now() - AUTO_CONFIRM_WINDOW_HOURS * 60 * 60 * 1000);
  const [base, openDisputes, pendingApprovals, overdueConfirmations] = await Promise.all([
    adminService.getSummary(),
    Job.countDocuments({ paymentStatus: STATES.DISPUTED }),
    ApprovalRequest.countDocuments({ status: 'pending' }),
    Job.countDocuments({
      paymentStatus: STATES.AWAITING_CONFIRMATION,
      awaitingConfirmationAt: { $lt: overdueBefore },
    }),
  ]);

  return {
    ...base,
    disputes: { open: openDisputes, pendingApprovals },
    overdueConfirmations,
    refundLimitPence: opsRefundLimitPence(),
  };
}

// --- Disputes ---

async function listDisputes() {
  return Job.find({ paymentStatus: STATES.DISPUTED })
    .populate('customer', 'name email')
    .populate('cleaner', 'name')
    .populate('serviceType', 'name')
    .sort({ disputedAt: 1, updatedAt: 1 });
}

async function getDispute(jobId) {
  const job = await adminService.getJobById(jobId);
  const [notes, audit, pendingApproval] = await Promise.all([
    listJobNotes(jobId),
    auditService.listForTarget('job', jobId),
    ApprovalRequest.findOne({ job: jobId, status: 'pending' }).populate('requestedBy', 'name role'),
  ]);
  return { job, notes, audit, pendingApproval, refundLimitPence: opsRefundLimitPence() };
}

function refundFor(job, outcome, refundPence) {
  if (outcome === 'refund') return job.pricePence;
  if (outcome === 'payout') return 0;
  if (!Number.isInteger(refundPence) || refundPence <= 0 || refundPence >= job.pricePence) {
    throw httpError(400, 'A partial refund must be more than £0 and less than the job price');
  }
  return refundPence;
}

async function executeResolution(jobId, outcome, refundPence, pricePence) {
  if (outcome === 'refund') return paymentService.resolveDisputeRefund(jobId);
  if (outcome === 'payout') return paymentService.resolveDisputePayout(jobId);
  return paymentService.resolveDisputePartial(jobId, {
    refundPence,
    payoutPence: pricePence - refundPence,
  });
}

async function resolveDispute(jobId, { outcome, refundPence, reason }, req) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');
  if (job.paymentStatus !== STATES.DISPUTED) {
    throw httpError(400, 'Only a disputed job can be resolved');
  }
  if (await ApprovalRequest.exists({ job: job._id, status: 'pending' })) {
    throw httpError(409, 'A resolution for this job is already waiting for admin approval');
  }

  const refund = refundFor(job, outcome, refundPence);

  if (refund > opsRefundLimitPence() && !hasPermission(req.user.role, 'refunds.over_limit')) {
    let approval;
    try {
      approval = await ApprovalRequest.create({
        job: job._id,
        requestedBy: req.user.id,
        outcome,
        refundPence: refund,
        payoutPence: job.pricePence - refund,
        reason,
      });
    } catch (err) {
      // The unique partial index lost a race with another operator.
      if (err && err.code === 11000) {
        throw httpError(409, 'A resolution for this job is already waiting for admin approval');
      }
      throw err;
    }
    await auditService.record({
      req,
      action: 'dispute.resolution.requested',
      targetType: 'job',
      targetId: job._id,
      after: { approvalId: approval._id, outcome, refundPence: refund },
      reason,
    });
    return { status: 'pending_approval', approval };
  }

  const before = { paymentStatus: job.paymentStatus };
  const resolved = await executeResolution(job._id, outcome, refund, job.pricePence);
  await auditService.record({
    req,
    action: 'dispute.resolve',
    targetType: 'job',
    targetId: job._id,
    before,
    after: { paymentStatus: resolved.paymentStatus, outcome, refundPence: refund },
    reason,
  });
  return { status: 'resolved', job: resolved };
}

// --- Approvals (admin) ---

async function listApprovals({ status } = {}) {
  const filter = status ? { status } : {};
  return ApprovalRequest.find(filter)
    .populate('job', 'pricePence paymentStatus disputeReason postcode')
    .populate('requestedBy', 'name role')
    .populate('decidedBy', 'name role')
    .sort({ createdAt: 1 });
}

async function decideApproval(approvalId, { decision, reason }, req) {
  const existing = await ApprovalRequest.findById(approvalId);
  if (!existing) throw httpError(404, 'Approval request not found');
  if (existing.status !== 'pending') throw httpError(409, 'This approval request has already been decided');
  if (existing.requestedBy.toString() === req.user.id) {
    throw httpError(403, 'You cannot approve or reject a request you raised yourself');
  }

  // Claim the request atomically so two admins cannot both decide it.
  const claimed = await ApprovalRequest.findOneAndUpdate(
    { _id: existing._id, status: 'pending' },
    {
      $set: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: req.user.id,
        decisionReason: reason,
        decidedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!claimed) throw httpError(409, 'This approval request has already been decided');

  if (decision === 'reject') {
    await auditService.record({
      req,
      action: 'approval.reject',
      targetType: 'job',
      targetId: claimed.job,
      after: { approvalId: claimed._id },
      reason,
    });
    return { approval: claimed };
  }

  const job = await Job.findById(claimed.job);
  let resolved;
  try {
    if (!job || job.paymentStatus !== STATES.DISPUTED) {
      throw httpError(409, 'The job is no longer disputed, so this resolution cannot be applied');
    }
    resolved = await executeResolution(job._id, claimed.outcome, claimed.refundPence, job.pricePence);
  } catch (err) {
    // Put the request back so it can be retried or rejected.
    await ApprovalRequest.updateOne(
      { _id: claimed._id },
      { $set: { status: 'pending' }, $unset: { decidedBy: 1, decisionReason: 1, decidedAt: 1 } }
    );
    throw err;
  }

  await auditService.record({
    req,
    action: 'approval.approve',
    targetType: 'job',
    targetId: claimed.job,
    before: { paymentStatus: STATES.DISPUTED },
    after: {
      approvalId: claimed._id,
      paymentStatus: resolved.paymentStatus,
      outcome: claimed.outcome,
      refundPence: claimed.refundPence,
    },
    reason,
  });
  return { approval: claimed, job: resolved };
}

// --- Job notes ---

async function listJobNotes(jobId) {
  return JobNote.find({ job: jobId }).populate('author', 'name role').sort({ createdAt: -1 });
}

async function addJobNote(jobId, body, req) {
  const job = await Job.findById(jobId);
  if (!job) throw httpError(404, 'Job not found');

  const note = await JobNote.create({ job: job._id, author: req.user.id, body });
  await auditService.record({
    req,
    action: 'job.note',
    targetType: 'job',
    targetId: job._id,
    after: { noteId: note._id },
    reason: 'Internal support note added',
  });
  return note;
}

// --- Cleaners ---

const VERIFICATION_FIELDS = ['dbsVerified', 'coshhTrained', 'insuranceStatus'];

async function updateCleanerVerification(cleanerId, updates, reason, req) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) throw httpError(404, 'Cleaner not found');

  const before = {};
  const after = {};
  VERIFICATION_FIELDS.forEach((field) => {
    if (updates[field] !== undefined) {
      before[field] = cleaner[field];
      after[field] = updates[field];
      cleaner[field] = updates[field];
    }
  });
  await cleaner.save();

  await auditService.record({
    req,
    action: 'cleaner.verification.update',
    targetType: 'cleaner',
    targetId: cleaner._id,
    before,
    after,
    reason,
  });
  return cleaner;
}

// Human-driven only — this is the staff review action itself. Never called
// automatically from a rating/scoring trigger; that path must land here as
// 'under_review' first (see CleanerProfile.deactivationStatus comment).
async function updateCleanerStatus(cleanerId, deactivationStatus, reason, req) {
  const cleaner = await CleanerProfile.findById(cleanerId);
  if (!cleaner) throw httpError(404, 'Cleaner not found');

  const canSuspend = hasPermission(req.user.role, 'cleaners.suspend');
  if (!canSuspend && (deactivationStatus === 'suspended' || cleaner.deactivationStatus === 'suspended')) {
    throw httpError(403, 'Only an admin can suspend a cleaner or lift a suspension');
  }

  const before = { deactivationStatus: cleaner.deactivationStatus };
  cleaner.deactivationStatus = deactivationStatus;
  await cleaner.save();

  await auditService.record({
    req,
    action: 'cleaner.status.update',
    targetType: 'cleaner',
    targetId: cleaner._id,
    before,
    after: { deactivationStatus },
    reason,
  });
  return cleaner;
}

async function getCleanerDetail(cleanerId) {
  const cleaner = await adminService.getCleanerById(cleanerId);
  const audit = await auditService.listForTarget('cleaner', cleanerId);
  return { cleaner, audit };
}

// --- Payments ---

async function manualRetryTransfer(jobId, reason, req) {
  const job = await paymentService.manualRetryTransfer(jobId);
  await auditService.record({
    req,
    action: 'payout.manual_retry',
    targetType: 'job',
    targetId: job._id,
    after: { paymentStatus: job.paymentStatus },
    reason,
  });
  return job;
}

module.exports = {
  opsRefundLimitPence,
  getSummary,
  listDisputes,
  getDispute,
  resolveDispute,
  listApprovals,
  decideApproval,
  listJobNotes,
  addJobNote,
  updateCleanerVerification,
  updateCleanerStatus,
  getCleanerDetail,
  manualRetryTransfer,
};
