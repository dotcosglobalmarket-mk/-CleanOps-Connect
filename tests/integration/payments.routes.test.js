jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.findById = jest.fn();
  JobMock.find = jest.fn();
  return JobMock;
});
jest.mock('../../src/models/CleanerProfile', () => {
  const CleanerProfileMock = jest.fn();
  CleanerProfileMock.findOne = jest.fn();
  return CleanerProfileMock;
});
jest.mock('../../src/services/payment.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const paymentService = require('../../src/services/payment.service');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('Payments routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /payments/jobs/:id/book', () => {
    const jobId = '507f1f77bcf86cd799439011';
    const cleanerId = '507f1f77bcf86cd799439012';

    it('returns 401 without auth', async () => {
      const res = await request(app).post(`/payments/jobs/${jobId}/book`).send({ cleanerId, pricePence: 5000 });
      expect(res.status).toBe(401);
    });

    it('returns 403 for a cleaner (only customer/admin may book)', async () => {
      const res = await request(app)
        .post(`/payments/jobs/${jobId}/book`)
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId, pricePence: 5000 });
      expect(res.status).toBe(403);
    });

    it('books the job at the price the cleaner set, using validated input', async () => {
      paymentService.bookJob.mockResolvedValue({ _id: jobId, paymentStatus: 'BOOKED', pricePence: 5000 });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/book`)
        .set('Authorization', authHeaderFor('customer'))
        .send({ cleanerId, pricePence: 5000 });

      expect(res.status).toBe(201);
      expect(paymentService.bookJob).toHaveBeenCalledWith({ jobId, cleanerId, pricePence: 5000 });
    });

    it('rejects a negative price at the validation layer', async () => {
      const res = await request(app)
        .post(`/payments/jobs/${jobId}/book`)
        .set('Authorization', authHeaderFor('customer'))
        .send({ cleanerId, pricePence: -100 });

      expect(res.status).toBe(400);
      expect(paymentService.bookJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /payments/jobs/:id/cancel — ownership enforcement', () => {
    const jobId = '507f1f77bcf86cd799439011';

    it('forbids a cleaner from cancelling a job they are not assigned to', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: 'user1', cleaner: 'someone-elses-profile' });
      CleanerProfile.findOne.mockResolvedValue({ _id: 'my-profile-id' });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/cancel`)
        .set('Authorization', authHeaderFor('cleaner', 'user2'));

      expect(res.status).toBe(403);
      expect(paymentService.cancelByCleaner).not.toHaveBeenCalled();
    });

    it('allows the assigned cleaner to cancel', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: 'customer1', cleaner: 'my-profile-id' });
      CleanerProfile.findOne.mockResolvedValue({ _id: 'my-profile-id' });
      paymentService.cancelByCleaner.mockResolvedValue({ _id: jobId, paymentStatus: 'CANCELLED_BY_CLEANER' });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/cancel`)
        .set('Authorization', authHeaderFor('cleaner', 'user2'));

      expect(res.status).toBe(200);
      expect(paymentService.cancelByCleaner).toHaveBeenCalledWith(jobId);
    });

    it('forbids a customer from cancelling someone else\'s job', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: 'the-real-customer', cleaner: null });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/cancel`)
        .set('Authorization', authHeaderFor('customer', 'not-the-customer'));

      expect(res.status).toBe(403);
      expect(paymentService.cancelByCustomer).not.toHaveBeenCalled();
    });
  });

  describe('GET /payments/ops/queue', () => {
    it('returns 403 for a non-admin', async () => {
      const res = await request(app).get('/payments/ops/queue').set('Authorization', authHeaderFor('customer'));
      expect(res.status).toBe(403);
    });

    it('lists MANUAL_REVIEW_HOLD and PAYOUT_BLOCKED jobs for admins', async () => {
      const sortMock = jest.fn().mockResolvedValue([{ _id: '1', paymentStatus: 'MANUAL_REVIEW_HOLD' }]);
      Job.find.mockReturnValue({ sort: sortMock });

      const res = await request(app).get('/payments/ops/queue').set('Authorization', authHeaderFor('admin'));

      expect(res.status).toBe(200);
      expect(Job.find).toHaveBeenCalledWith({ paymentStatus: { $in: ['MANUAL_REVIEW_HOLD', 'PAYOUT_BLOCKED'] } });
      expect(res.body).toHaveLength(1);
    });
  });

  describe('POST /payments/jobs/:id/dispute', () => {
    const jobId = '507f1f77bcf86cd799439011';

    it('rejects an unknown reason code', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: 'user1' });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/dispute`)
        .set('Authorization', authHeaderFor('customer', 'user1'))
        .send({ reasonCode: 'made_up_reason' });

      expect(res.status).toBe(400);
      expect(paymentService.raiseDispute).not.toHaveBeenCalled();
    });

    it('raises a dispute with a valid reason code for the owning customer', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: 'user1' });
      paymentService.raiseDispute.mockResolvedValue({ _id: jobId, paymentStatus: 'DISPUTED' });

      const res = await request(app)
        .post(`/payments/jobs/${jobId}/dispute`)
        .set('Authorization', authHeaderFor('customer', 'user1'))
        .send({ reasonCode: 'quality_issue' });

      expect(res.status).toBe(200);
      expect(paymentService.raiseDispute).toHaveBeenCalledWith(jobId, 'quality_issue');
    });
  });
});
