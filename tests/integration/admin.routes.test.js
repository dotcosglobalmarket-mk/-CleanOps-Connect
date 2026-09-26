// Staff routes re-check the account on every request (requireActiveStaff).
jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/models/AuditLog', () => ({
  create: jest.fn((doc) => Promise.resolve({ _id: 'audit1', ...doc })),
  find: jest.fn(),
}));
jest.mock('../../src/models/ApprovalRequest', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../src/services/payment.service');
jest.mock('../../src/models/CleanerProfile', () => {
  const CleanerProfileMock = jest.fn();
  CleanerProfileMock.find = jest.fn();
  CleanerProfileMock.findById = jest.fn();
  CleanerProfileMock.countDocuments = jest.fn().mockResolvedValue(0);
  return CleanerProfileMock;
});
jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.find = jest.fn();
  JobMock.findById = jest.fn();
  JobMock.countDocuments = jest.fn().mockResolvedValue(0);
  return JobMock;
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const CleanerProfile = require('../../src/models/CleanerProfile');
const Job = require('../../src/models/Job');
const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const ApprovalRequest = require('../../src/models/ApprovalRequest');
const paymentService = require('../../src/services/payment.service');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

function chainable(finalValue, methods = ['populate', 'sort', 'limit']) {
  const obj = {};
  methods.forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.then = (resolve) => Promise.resolve(finalValue).then(resolve);
  return obj;
}

describe('Admin routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    CleanerProfile.countDocuments.mockResolvedValue(0);
    Job.countDocuments.mockResolvedValue(0);
    User.findById.mockImplementation((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true }));
    app = createApp();
  });

  describe('auth/role enforcement', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/admin/summary');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin', async () => {
      const res = await request(app).get('/admin/summary').set('Authorization', authHeaderFor('cleaner'));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/summary', () => {
    it('returns aggregate counts for admins', async () => {
      CleanerProfile.countDocuments
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3) // unverified
        .mockResolvedValueOnce(1) // under review
        .mockResolvedValueOnce(0); // suspended
      Job.countDocuments
        .mockResolvedValueOnce(50) // total
        .mockResolvedValueOnce(5) // open
        .mockResolvedValueOnce(2) // manual review hold
        .mockResolvedValueOnce(1); // payout blocked

      const res = await request(app).get('/admin/summary').set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        cleaners: { total: 10, unverified: 3, underReview: 1, suspended: 0 },
        jobs: { total: 50, open: 5 },
        paymentsOpsQueue: { manualReviewHold: 2, payoutBlocked: 1 },
      });
    });
  });

  describe('GET /admin/cleaners', () => {
    it('lists cleaners for admins', async () => {
      CleanerProfile.find.mockReturnValue(chainable([{ _id: 'c1', dbsVerified: true }]));

      const res = await request(app).get('/admin/cleaners').set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('rejects an invalid deactivationStatus filter', async () => {
      const res = await request(app)
        .get('/admin/cleaners?deactivationStatus=bogus')
        .set('Authorization', authHeaderFor('admin'));
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/cleaners/:id/verification', () => {
    const cleanerId = '507f1f77bcf86cd799439011';

    it('updates verification fields', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const cleaner = { _id: cleanerId, dbsVerified: false, save };
      CleanerProfile.findById.mockResolvedValue(cleaner);

      const res = await request(app)
        .patch(`/admin/cleaners/${cleanerId}/verification`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ dbsVerified: true, insuranceStatus: 'platform' });

      expect(res.status).toBe(200);
      expect(cleaner.dbsVerified).toBe(true);
      expect(cleaner.insuranceStatus).toBe('platform');
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty body', async () => {
      const res = await request(app)
        .patch(`/admin/cleaners/${cleanerId}/verification`)
        .set('Authorization', authHeaderFor('admin'))
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown cleaner', async () => {
      CleanerProfile.findById.mockResolvedValue(null);
      const res = await request(app)
        .patch(`/admin/cleaners/${cleanerId}/verification`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ dbsVerified: true });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /admin/cleaners/:id/deactivation', () => {
    const cleanerId = '507f1f77bcf86cd799439011';

    it('routes a rating-triggered suspension through under_review, never straight to suspended, when the admin says so', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const cleaner = { _id: cleanerId, deactivationStatus: 'active', save };
      CleanerProfile.findById.mockResolvedValue(cleaner);

      const res = await request(app)
        .patch(`/admin/cleaners/${cleanerId}/deactivation`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ deactivationStatus: 'under_review' });

      expect(res.status).toBe(200);
      expect(cleaner.deactivationStatus).toBe('under_review');
    });

    it('rejects an invalid deactivationStatus value', async () => {
      const res = await request(app)
        .patch(`/admin/cleaners/${cleanerId}/deactivation`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ deactivationStatus: 'banned' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/jobs', () => {
    it('lists jobs for admins', async () => {
      Job.find.mockReturnValue(chainable([{ _id: 'j1', status: 'open' }]));

      const res = await request(app).get('/admin/jobs').set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('rejects an invalid status filter', async () => {
      const res = await request(app).get('/admin/jobs?status=bogus').set('Authorization', authHeaderFor('admin'));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/jobs/:id', () => {
    const jobId = '507f1f77bcf86cd799439011';

    it('returns a single job for admins', async () => {
      Job.findById.mockReturnValue(chainable({ _id: jobId }, ['populate']));

      const res = await request(app).get(`/admin/jobs/${jobId}`).set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(200);
      expect(res.body._id).toBe(jobId);
    });

    it('returns 404 when the job does not exist', async () => {
      Job.findById.mockReturnValue(chainable(null, ['populate']));

      const res = await request(app).get(`/admin/jobs/${jobId}`).set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(404);
    });
  });

  describe('staff accounts', () => {
    const adminId = '64b000000000000000000002';

    it('creates an operator account and audits it', async () => {
      User.findOne.mockResolvedValue(null);
      User.create.mockImplementation((doc) =>
        Promise.resolve({ _id: '64b0000000000000000000aa', ...doc, active: true })
      );

      const res = await request(app)
        .post('/admin/users')
        .set('Authorization', authHeaderFor('admin', adminId))
        .send({ name: 'Olu', email: 'olu@example.com', password: 'a-long-passphrase', role: 'operator' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'olu@example.com', role: 'operator', active: true });
      expect(res.body.passwordHash).toBeUndefined();
      const created = User.create.mock.calls[0][0];
      expect(created.passwordHash).not.toBe('a-long-passphrase');
      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.create' }));
    });

    it('rejects short staff passwords and non-staff roles', async () => {
      const shortPassword = await request(app)
        .post('/admin/users')
        .set('Authorization', authHeaderFor('admin', adminId))
        .send({ name: 'Olu', email: 'olu@example.com', password: 'short', role: 'operator' });
      expect(shortPassword.status).toBe(400);

      const customerRole = await request(app)
        .post('/admin/users')
        .set('Authorization', authHeaderFor('admin', adminId))
        .send({ name: 'Olu', email: 'olu@example.com', password: 'a-long-passphrase', role: 'customer' });
      expect(customerRole.status).toBe(400);
      expect(User.create).not.toHaveBeenCalled();
    });

    it('deactivates an operator with a reason', async () => {
      const operator = {
        _id: '64b0000000000000000000aa',
        role: 'operator',
        active: true,
        save: jest.fn().mockResolvedValue(undefined),
      };
      User.findById.mockImplementation((id) =>
        Promise.resolve(id === adminId ? { _id: adminId, role: 'admin', active: true } : operator)
      );

      const res = await request(app)
        .patch('/admin/users/64b0000000000000000000aa')
        .set('Authorization', authHeaderFor('admin', adminId))
        .send({ active: false, reason: 'Left the company' });

      expect(res.status).toBe(200);
      expect(operator.active).toBe(false);
      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.deactivate' }));
    });

    it('does not let an admin deactivate themselves', async () => {
      const res = await request(app)
        .patch(`/admin/users/${adminId}`)
        .set('Authorization', authHeaderFor('admin', adminId))
        .send({ active: false, reason: 'testing' });
      expect(res.status).toBe(400);
    });
  });

  describe('audit log', () => {
    it('lists audit entries for admins', async () => {
      AuditLog.find.mockReturnValue(chainable([{ action: 'dispute.resolve' }]));
      const res = await request(app).get('/admin/audit?action=dispute.resolve').set('Authorization', authHeaderFor('admin'));
      expect(res.status).toBe(200);
      expect(AuditLog.find).toHaveBeenCalledWith({ action: 'dispute.resolve' });
    });
  });

  describe('approvals', () => {
    const approvalId = '64b0000000000000000000bb';

    it('approves a pending refund raised by an operator', async () => {
      const pending = {
        _id: approvalId,
        job: '507f1f77bcf86cd799439011',
        status: 'pending',
        requestedBy: { toString: () => 'operator1' },
        outcome: 'refund',
        refundPence: 20000,
      };
      ApprovalRequest.findById.mockResolvedValue(pending);
      ApprovalRequest.findOneAndUpdate.mockResolvedValue({ ...pending, status: 'approved' });
      Job.findById.mockResolvedValue({ _id: pending.job, paymentStatus: 'DISPUTED', pricePence: 20000 });
      paymentService.resolveDisputeRefund.mockResolvedValue({ _id: pending.job, paymentStatus: 'REFUNDED' });

      const res = await request(app)
        .post(`/admin/approvals/${approvalId}/decision`)
        .set('Authorization', authHeaderFor('admin', 'admin1'))
        .send({ decision: 'approve', reason: 'Checked the evidence' });

      expect(res.status).toBe(200);
      expect(paymentService.resolveDisputeRefund).toHaveBeenCalledWith(pending.job);
    });

    it('requires a reason for the decision', async () => {
      const res = await request(app)
        .post(`/admin/approvals/${approvalId}/decision`)
        .set('Authorization', authHeaderFor('admin'))
        .send({ decision: 'approve' });
      expect(res.status).toBe(400);
    });
  });
});
