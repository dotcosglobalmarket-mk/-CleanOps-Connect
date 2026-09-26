// Lifecycle emails are fire-and-forget side effects; tested in notification.service.test.js.
jest.mock('../../src/services/notification.service');
jest.mock('../../src/models/Job', () => ({ findById: jest.fn(), find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/ApprovalRequest', () => ({
  exists: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../src/models/JobNote', () => ({ create: jest.fn(), find: jest.fn() }));
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/audit.service');

const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const ApprovalRequest = require('../../src/models/ApprovalRequest');
const paymentService = require('../../src/services/payment.service');
const auditService = require('../../src/services/audit.service');
const opsService = require('../../src/services/ops.service');
const { STATES } = require('../../src/services/payment-state-machine');

const operatorReq = { user: { id: 'op1', role: 'operator' }, ip: '127.0.0.1' };
const adminReq = { user: { id: 'admin1', role: 'admin' }, ip: '127.0.0.1' };

function disputedJob(overrides = {}) {
  return { _id: 'job1', paymentStatus: STATES.DISPUTED, pricePence: 20000, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OPS_REFUND_LIMIT_PENCE;
  ApprovalRequest.exists.mockResolvedValue(null);
  auditService.record.mockResolvedValue({});
});

describe('resolveDispute — maker-checker refund limit (default £150)', () => {
  it('resolves immediately when the refund is within the limit', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputePartial.mockResolvedValue({ _id: 'job1', paymentStatus: STATES.PARTIALLY_REFUNDED });

    const result = await opsService.resolveDispute(
      'job1',
      { outcome: 'partial', refundPence: 5000, reason: 'Two rooms missed, photos provided' },
      operatorReq
    );

    expect(result.status).toBe('resolved');
    expect(paymentService.resolveDisputePartial).toHaveBeenCalledWith('job1', { refundPence: 5000, payoutPence: 15000 });
    expect(ApprovalRequest.create).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.resolve', targetType: 'job', reason: 'Two rooms missed, photos provided' })
    );
  });

  it('pays the cleaner in full with no refund when the outcome is payout', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputePayout.mockResolvedValue({ _id: 'job1', paymentStatus: STATES.CONFIRMED });

    const result = await opsService.resolveDispute('job1', { outcome: 'payout', reason: 'Work verified' }, operatorReq);

    expect(result.status).toBe('resolved');
    expect(paymentService.resolveDisputePayout).toHaveBeenCalledWith('job1');
  });

  it('sends an operator refund above the limit to admin approval without touching Stripe', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    ApprovalRequest.create.mockResolvedValue({ _id: 'appr1' });

    const result = await opsService.resolveDispute(
      'job1',
      { outcome: 'refund', reason: 'Cleaner did not attend' },
      operatorReq
    );

    expect(result.status).toBe('pending_approval');
    expect(ApprovalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'job1', requestedBy: 'op1', outcome: 'refund', refundPence: 20000, payoutPence: 0 })
    );
    expect(paymentService.resolveDisputeRefund).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.resolution.requested' })
    );
  });

  it('respects OPS_REFUND_LIMIT_PENCE', async () => {
    process.env.OPS_REFUND_LIMIT_PENCE = '25000';
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputeRefund.mockResolvedValue({ _id: 'job1', paymentStatus: STATES.REFUNDED });

    const result = await opsService.resolveDispute('job1', { outcome: 'refund', reason: 'No show' }, operatorReq);

    expect(result.status).toBe('resolved');
  });

  it('lets an admin refund above the limit immediately', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputeRefund.mockResolvedValue({ _id: 'job1', paymentStatus: STATES.REFUNDED });

    const result = await opsService.resolveDispute('job1', { outcome: 'refund', reason: 'No show' }, adminReq);

    expect(result.status).toBe('resolved');
    expect(ApprovalRequest.create).not.toHaveBeenCalled();
  });

  it('refuses a job that is not disputed', async () => {
    Job.findById.mockResolvedValue(disputedJob({ paymentStatus: STATES.PAID_OUT }));
    await expect(
      opsService.resolveDispute('job1', { outcome: 'payout', reason: 'x'.repeat(5) }, operatorReq)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a partial refund that is not less than the job price', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    await expect(
      opsService.resolveDispute('job1', { outcome: 'partial', refundPence: 20000, reason: 'reason' }, operatorReq)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 409 when another operator raised an approval at the same moment', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    const duplicate = new Error('E11000 duplicate key');
    duplicate.code = 11000;
    ApprovalRequest.create.mockRejectedValue(duplicate);
    await expect(
      opsService.resolveDispute('job1', { outcome: 'refund', reason: 'No show' }, operatorReq)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a second resolution while one is awaiting approval', async () => {
    Job.findById.mockResolvedValue(disputedJob());
    ApprovalRequest.exists.mockResolvedValue({ _id: 'appr1' });
    await expect(
      opsService.resolveDispute('job1', { outcome: 'payout', reason: 'reason' }, operatorReq)
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('decideApproval', () => {
  const pending = {
    _id: 'appr1',
    job: 'job1',
    status: 'pending',
    requestedBy: { toString: () => 'op1' },
    outcome: 'refund',
    refundPence: 20000,
  };

  it('executes the stored refund and audits the approval', async () => {
    ApprovalRequest.findById.mockResolvedValue(pending);
    ApprovalRequest.findOneAndUpdate.mockResolvedValue({ ...pending, status: 'approved' });
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputeRefund.mockResolvedValue({ _id: 'job1', paymentStatus: STATES.REFUNDED });

    const result = await opsService.decideApproval('appr1', { decision: 'approve', reason: 'Evidence checked' }, adminReq);

    expect(paymentService.resolveDisputeRefund).toHaveBeenCalledWith('job1');
    expect(result.job.paymentStatus).toBe(STATES.REFUNDED);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'approval.approve' }));
  });

  it('rejects without moving any money and leaves the job disputed', async () => {
    ApprovalRequest.findById.mockResolvedValue(pending);
    ApprovalRequest.findOneAndUpdate.mockResolvedValue({ ...pending, status: 'rejected' });

    await opsService.decideApproval('appr1', { decision: 'reject', reason: 'Partial refund is fairer' }, adminReq);

    expect(paymentService.resolveDisputeRefund).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'approval.reject' }));
  });

  it('returns 409 when the request was already decided', async () => {
    ApprovalRequest.findById.mockResolvedValue({ ...pending, status: 'approved' });
    await expect(
      opsService.decideApproval('appr1', { decision: 'approve', reason: 'again' }, adminReq)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns 409 when another admin decides it at the same moment', async () => {
    ApprovalRequest.findById.mockResolvedValue(pending);
    ApprovalRequest.findOneAndUpdate.mockResolvedValue(null);
    await expect(
      opsService.decideApproval('appr1', { decision: 'approve', reason: 'race' }, adminReq)
    ).rejects.toMatchObject({ status: 409 });
    expect(paymentService.resolveDisputeRefund).not.toHaveBeenCalled();
  });

  it('does not let the requester approve their own request', async () => {
    ApprovalRequest.findById.mockResolvedValue({ ...pending, requestedBy: { toString: () => 'admin1' } });
    await expect(
      opsService.decideApproval('appr1', { decision: 'approve', reason: 'self' }, adminReq)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('puts the request back to pending if the refund fails', async () => {
    ApprovalRequest.findById.mockResolvedValue(pending);
    ApprovalRequest.findOneAndUpdate.mockResolvedValue({ ...pending, status: 'approved' });
    Job.findById.mockResolvedValue(disputedJob());
    paymentService.resolveDisputeRefund.mockRejectedValue(new Error('Stripe down'));

    await expect(
      opsService.decideApproval('appr1', { decision: 'approve', reason: 'ok' }, adminReq)
    ).rejects.toThrow('Stripe down');
    expect(ApprovalRequest.updateOne).toHaveBeenCalledWith(
      { _id: 'appr1' },
      expect.objectContaining({ $set: { status: 'pending' } })
    );
  });
});

describe('updateCleanerStatus', () => {
  function cleaner(status) {
    return { _id: 'c1', deactivationStatus: status, save: jest.fn().mockResolvedValue(undefined) };
  }

  it('lets an operator put a cleaner under review', async () => {
    const c = cleaner('active');
    CleanerProfile.findById.mockResolvedValue(c);
    await opsService.updateCleanerStatus('c1', 'under_review', 'Two quality complaints this week', operatorReq);
    expect(c.deactivationStatus).toBe('under_review');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cleaner.status.update', before: { deactivationStatus: 'active' } })
    );
  });

  it('does not let an operator lift a suspension', async () => {
    const c = cleaner('suspended');
    CleanerProfile.findById.mockResolvedValue(c);
    await expect(
      opsService.updateCleanerStatus('c1', 'active', 'appeal accepted', operatorReq)
    ).rejects.toMatchObject({ status: 403 });
    expect(c.save).not.toHaveBeenCalled();
  });

  it('lets an admin suspend a cleaner', async () => {
    const c = cleaner('under_review');
    CleanerProfile.findById.mockResolvedValue(c);
    await opsService.updateCleanerStatus('c1', 'suspended', 'Upheld safeguarding complaint', adminReq);
    expect(c.deactivationStatus).toBe('suspended');
  });
});

describe('updateCleanerVerification', () => {
  it('records before and after values for the fields changed', async () => {
    const c = { _id: 'c1', dbsVerified: false, coshhTrained: false, save: jest.fn().mockResolvedValue(undefined) };
    CleanerProfile.findById.mockResolvedValue(c);

    await opsService.updateCleanerVerification('c1', { dbsVerified: true }, 'DBS 001234567890, 2026-08-01', operatorReq);

    expect(c.dbsVerified).toBe(true);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ before: { dbsVerified: false }, after: { dbsVerified: true } })
    );
  });
});
