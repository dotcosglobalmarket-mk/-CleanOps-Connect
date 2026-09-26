const staffAccounts = {};
jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve(staffAccounts[id] || null)),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.find = jest.fn();
  JobMock.findById = jest.fn();
  JobMock.countDocuments = jest.fn().mockResolvedValue(0);
  return JobMock;
});
jest.mock('../../src/models/CleanerProfile', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../src/models/ApprovalRequest', () => ({
  exists: jest.fn().mockResolvedValue(null),
  create: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../src/models/JobNote', () => ({ create: jest.fn(), find: jest.fn() }));
jest.mock('../../src/models/AuditLog', () => ({
  create: jest.fn((doc) => Promise.resolve({ _id: 'audit1', ...doc })),
  find: jest.fn(),
}));
jest.mock('../../src/services/payment.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const ApprovalRequest = require('../../src/models/ApprovalRequest');
const JobNote = require('../../src/models/JobNote');
const AuditLog = require('../../src/models/AuditLog');
const paymentService = require('../../src/services/payment.service');

const OPERATOR_ID = '64b000000000000000000001';
const ADMIN_ID = '64b000000000000000000002';
const INACTIVE_OPERATOR_ID = '64b000000000000000000003';
const jobId = '507f1f77bcf86cd799439011';
const cleanerId = '507f1f77bcf86cd799439012';

function tokenFor(role, id) {
  return `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}
const asOperator = () => tokenFor('operator', OPERATOR_ID);
const asAdmin = () => tokenFor('admin', ADMIN_ID);

function chainable(finalValue) {
  const obj = {};
  ['populate', 'sort', 'limit'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.then = (resolve) => Promise.resolve(finalValue).then(resolve);
  return obj;
}

describe('Ops (operator) routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(staffAccounts, {
      [OPERATOR_ID]: { _id: OPERATOR_ID, name: 'Olu Operator', role: 'operator', active: true },
      [ADMIN_ID]: { _id: ADMIN_ID, name: 'Ada Admin', role: 'admin', active: true },
      [INACTIVE_OPERATOR_ID]: { _id: INACTIVE_OPERATOR_ID, name: 'Former', role: 'operator', active: false },
    });
    ApprovalRequest.exists.mockResolvedValue(null);
    app = createApp();
  });

  describe('access control', () => {
    it('returns 401 without a token', async () => {
      const res = await request(app).get('/ops/disputes');
      expect(res.status).toBe(401);
    });

    it('returns 403 for customers and cleaners', async () => {
      for (const role of ['customer', 'cleaner']) {
        const res = await request(app).get('/ops/disputes').set('Authorization', tokenFor(role, 'someone'));
        expect(res.status).toBe(403);
      }
    });

    it('returns 401 for a deactivated operator whose token has not expired', async () => {
      const res = await request(app)
        .get('/ops/disputes')
        .set('Authorization', tokenFor('operator', INACTIVE_OPERATOR_ID));
      expect(res.status).toBe(401);
    });

    it('does not let an operator into the admin API', async () => {
      for (const path of ['/admin/summary', '/admin/audit', '/admin/users', '/admin/approvals']) {
        const res = await request(app).get(path).set('Authorization', asOperator());
        expect(res.status).toBe(403);
      }
    });
  });

  describe('disputes', () => {
    it('lists open disputes for an operator', async () => {
      Job.find.mockReturnValue(chainable([{ _id: jobId, paymentStatus: 'DISPUTED' }]));
      const res = await request(app).get('/ops/disputes').set('Authorization', asOperator());
      expect(res.status).toBe(200);
      expect(Job.find).toHaveBeenCalledWith({ paymentStatus: 'DISPUTED' });
      expect(res.body).toHaveLength(1);
    });

    it('resolves a dispute within the refund limit and writes an audit entry', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, paymentStatus: 'DISPUTED', pricePence: 10000 });
      paymentService.resolveDisputePartial.mockResolvedValue({ _id: jobId, paymentStatus: 'PARTIALLY_REFUNDED' });

      const res = await request(app)
        .post(`/ops/disputes/${jobId}/resolve`)
        .set('Authorization', asOperator())
        .send({ outcome: 'partial', refundPence: 3000, reason: 'Kitchen not cleaned; photos from customer' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('resolved');
      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ actor: OPERATOR_ID, actorRole: 'operator', action: 'dispute.resolve' })
      );
    });

    it('returns 202 and creates an approval request for a refund over the limit', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, paymentStatus: 'DISPUTED', pricePence: 30000 });
      ApprovalRequest.create.mockResolvedValue({ _id: 'appr1', status: 'pending' });

      const res = await request(app)
        .post(`/ops/disputes/${jobId}/resolve`)
        .set('Authorization', asOperator())
        .send({ outcome: 'refund', reason: 'Cleaner did not attend' });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_approval');
      expect(paymentService.resolveDisputeRefund).not.toHaveBeenCalled();
    });

    it('requires a reason', async () => {
      const res = await request(app)
        .post(`/ops/disputes/${jobId}/resolve`)
        .set('Authorization', asOperator())
        .send({ outcome: 'payout' });
      expect(res.status).toBe(400);
      expect(Job.findById).not.toHaveBeenCalled();
    });

    it('requires refundPence for a partial refund', async () => {
      const res = await request(app)
        .post(`/ops/disputes/${jobId}/resolve`)
        .set('Authorization', asOperator())
        .send({ outcome: 'partial', reason: 'Some work missed' });
      expect(res.status).toBe(400);
    });
  });

  describe('cleaners', () => {
    it('lets an operator verify DBS with an evidence reason', async () => {
      const cleaner = { _id: cleanerId, dbsVerified: false, save: jest.fn().mockResolvedValue(undefined) };
      CleanerProfile.findById.mockResolvedValue(cleaner);

      const res = await request(app)
        .patch(`/ops/cleaners/${cleanerId}/verification`)
        .set('Authorization', asOperator())
        .send({ dbsVerified: true, reason: 'Enhanced DBS 001234567890 issued 2026-08-01, seen on update service' });

      expect(res.status).toBe(200);
      expect(cleaner.dbsVerified).toBe(true);
      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cleaner.verification.update', targetType: 'cleaner' })
      );
    });

    it('rejects a verification change without a reason', async () => {
      const res = await request(app)
        .patch(`/ops/cleaners/${cleanerId}/verification`)
        .set('Authorization', asOperator())
        .send({ dbsVerified: true });
      expect(res.status).toBe(400);
    });

    it('does not let an operator suspend a cleaner', async () => {
      const res = await request(app)
        .patch(`/ops/cleaners/${cleanerId}/review`)
        .set('Authorization', asOperator())
        .send({ deactivationStatus: 'suspended', reason: 'Serious complaint' });
      expect(res.status).toBe(400);
    });

    it('does not let an operator re-activate a suspended cleaner', async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: cleanerId,
        deactivationStatus: 'suspended',
        save: jest.fn(),
      });
      const res = await request(app)
        .patch(`/ops/cleaners/${cleanerId}/review`)
        .set('Authorization', asOperator())
        .send({ deactivationStatus: 'active', reason: 'Appeal' });
      expect(res.status).toBe(403);
    });
  });

  describe('job notes', () => {
    it('adds an internal note', async () => {
      Job.findById.mockResolvedValue({ _id: jobId });
      JobNote.create.mockResolvedValue({ _id: 'note1', body: 'Called customer, agreed partial refund' });

      const res = await request(app)
        .post(`/ops/jobs/${jobId}/notes`)
        .set('Authorization', asOperator())
        .send({ body: 'Called customer, agreed partial refund' });

      expect(res.status).toBe(201);
      expect(JobNote.create).toHaveBeenCalledWith({
        job: jobId,
        author: OPERATOR_ID,
        body: 'Called customer, agreed partial refund',
      });
    });
  });

  describe('payments ops queue', () => {
    it('lets an operator see the payments queue', async () => {
      Job.find.mockReturnValue(chainable([]));
      const res = await request(app).get('/payments/ops/queue').set('Authorization', asOperator());
      expect(res.status).toBe(200);
    });

    it('lets an operator retry a held payout and audits it', async () => {
      paymentService.manualRetryTransfer.mockResolvedValue({ _id: jobId, paymentStatus: 'MANUAL_REVIEW_HOLD' });
      const res = await request(app)
        .post(`/payments/ops/jobs/${jobId}/manual-retry`)
        .set('Authorization', asOperator())
        .send({ reason: 'Cleaner finished Stripe onboarding today' });
      expect(res.status).toBe(200);
      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'payout.manual_retry' }));
    });

    it('does not let an operator call the direct refund endpoints (bypassing the limit)', async () => {
      const res = await request(app)
        .post(`/payments/jobs/${jobId}/resolve/refund`)
        .set('Authorization', asOperator());
      expect(res.status).toBe(403);
      expect(paymentService.resolveDisputeRefund).not.toHaveBeenCalled();
    });
  });

  describe('admins can use the ops API too', () => {
    it('lets an admin list disputes', async () => {
      Job.find.mockReturnValue(chainable([]));
      const res = await request(app).get('/ops/disputes').set('Authorization', asAdmin());
      expect(res.status).toBe(200);
    });
  });
});
