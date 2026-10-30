// Staff routes re-check the account on every request (requireActiveStaff).
jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, name: 'Staff', role: 'admin', active: true })),
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/services/subscription.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const subscriptionService = require('../../src/services/subscription.service');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

const subscriptionId = '507f1f77bcf86cd799439022';

describe('Subscription cancellation routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('cleaner: POST /subscriptions/me/cancellation-request', () => {
    it('needs a login', async () => {
      const res = await request(app).post('/subscriptions/me/cancellation-request').send({});
      expect(res.status).toBe(401);
    });

    it.each(['customer', 'admin'])('is for cleaners only (%s gets 403)', async (role) => {
      const res = await request(app)
        .post('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor(role))
        .send({});
      expect(res.status).toBe(403);
      expect(subscriptionService.requestCancellation).not.toHaveBeenCalled();
    });

    it('passes the cleaner and their reason to the service', async () => {
      subscriptionService.requestCancellation.mockResolvedValue({ cancellationRequestedAt: '2026-10-30T00:00:00Z' });
      const res = await request(app)
        .post('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor('cleaner', 'cleaner-user'))
        .send({ reason: 'Moving abroad' });
      expect(res.status).toBe(201);
      expect(subscriptionService.requestCancellation).toHaveBeenCalledWith('cleaner-user', 'Moving abroad');
    });

    it('allows no reason', async () => {
      subscriptionService.requestCancellation.mockResolvedValue({});
      const res = await request(app)
        .post('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({});
      expect(res.status).toBe(201);
    });

    it('rejects an over-long reason', async () => {
      const res = await request(app)
        .post('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ reason: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });
  });

  describe('cleaner: DELETE /subscriptions/me/cancellation-request', () => {
    it('is for cleaners only', async () => {
      const res = await request(app)
        .delete('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor('customer'));
      expect(res.status).toBe(403);
    });

    it('withdraws the request', async () => {
      subscriptionService.withdrawCancellation.mockResolvedValue({});
      const res = await request(app)
        .delete('/subscriptions/me/cancellation-request')
        .set('Authorization', authHeaderFor('cleaner', 'cleaner-user'));
      expect(res.status).toBe(200);
      expect(subscriptionService.withdrawCancellation).toHaveBeenCalledWith('cleaner-user');
    });
  });

  describe('admin: GET /admin/subscriptions', () => {
    it.each(['cleaner', 'customer', 'operator'])('is for admins only (%s gets 403)', async (role) => {
      const res = await request(app).get('/admin/subscriptions').set('Authorization', authHeaderFor(role));
      expect(res.status).toBe(403);
    });

    it('lists, passing the status filter through', async () => {
      subscriptionService.listForAdmin.mockResolvedValue([{ plan: 'pro' }]);
      const res = await request(app)
        .get('/admin/subscriptions?status=requested')
        .set('Authorization', authHeaderFor('admin'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ plan: 'pro' }]);
      expect(subscriptionService.listForAdmin).toHaveBeenCalledWith({ status: 'requested' });
    });

    it('rejects an unknown filter', async () => {
      const res = await request(app).get('/admin/subscriptions?status=nonsense').set('Authorization', authHeaderFor('admin'));
      expect(res.status).toBe(400);
    });
  });

  describe('admin: POST /admin/subscriptions/:id/cancel', () => {
    const url = `/admin/subscriptions/${subscriptionId}/cancel`;

    it('is for admins only', async () => {
      const res = await request(app).post(url).set('Authorization', authHeaderFor('cleaner')).send({ when: 'now', reason: 'Because' });
      expect(res.status).toBe(403);
      expect(subscriptionService.cancelAsAdmin).not.toHaveBeenCalled();
    });

    it('requires a reason, because it is audited', async () => {
      const res = await request(app).post(url).set('Authorization', authHeaderFor('admin')).send({ when: 'now' });
      expect(res.status).toBe(400);
      expect(subscriptionService.cancelAsAdmin).not.toHaveBeenCalled();
    });

    it('rejects a reason that is too short', async () => {
      const res = await request(app).post(url).set('Authorization', authHeaderFor('admin')).send({ when: 'now', reason: 'x' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown "when"', async () => {
      const res = await request(app).post(url).set('Authorization', authHeaderFor('admin')).send({ when: 'tomorrow', reason: 'Because' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed id', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/not-an-id/cancel')
        .set('Authorization', authHeaderFor('admin'))
        .send({ when: 'now', reason: 'Because' });
      expect(res.status).toBe(400);
    });

    it.each(['now', 'period_end'])('cancels "%s" and passes the request through for the audit log', async (when) => {
      subscriptionService.cancelAsAdmin.mockResolvedValue({ isActive: false });
      const res = await request(app)
        .post(url)
        .set('Authorization', authHeaderFor('admin', 'admin1'))
        .send({ when, reason: 'Asked to leave' });
      expect(res.status).toBe(200);
      expect(subscriptionService.cancelAsAdmin).toHaveBeenCalledWith(
        subscriptionId,
        { when, reason: 'Asked to leave' },
        expect.objectContaining({ user: expect.objectContaining({ id: 'admin1', role: 'admin' }) })
      );
    });
  });

  describe('admin: POST /admin/subscriptions/:id/decline-cancellation', () => {
    const url = `/admin/subscriptions/${subscriptionId}/decline-cancellation`;

    it('requires a reason', async () => {
      const res = await request(app).post(url).set('Authorization', authHeaderFor('admin')).send({});
      expect(res.status).toBe(400);
    });

    it('declines', async () => {
      subscriptionService.declineCancellation.mockResolvedValue({});
      const res = await request(app).post(url).set('Authorization', authHeaderFor('admin')).send({ reason: 'Contract runs to March' });
      expect(res.status).toBe(200);
      expect(subscriptionService.declineCancellation).toHaveBeenCalledWith(
        subscriptionId,
        'Contract runs to March',
        expect.any(Object)
      );
    });
  });
});
