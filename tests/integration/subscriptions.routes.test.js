jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/Subscription', () => {
  const SubscriptionMock = jest.fn();
  SubscriptionMock.findOne = jest.fn();
  return SubscriptionMock;
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const CleanerProfile = require('../../src/models/CleanerProfile');
const Subscription = require('../../src/models/Subscription');

function authHeaderFor(role, id = 'user1') {
  const token = jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('Subscriptions routes', () => {
  let app;
  const cleanerId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /subscriptions', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/subscriptions').send({ cleanerId, plan: 'starter' });
      expect(res.status).toBe(401);
    });

    it('returns 400 for an invalid plan', async () => {
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId, plan: 'gold' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the cleaner does not exist', async () => {
      CleanerProfile.findById.mockResolvedValue(null);
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId, plan: 'starter' });
      expect(res.status).toBe(404);
    });

    it('returns 403 when the requester does not own the cleaner profile', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' } });
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'someone-else'))
        .send({ cleanerId, plan: 'starter' });
      expect(res.status).toBe(403);
    });

    it('activates a subscription for the owning cleaner', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' } });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      Subscription.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send({ cleanerId, plan: 'pro' });

      expect(res.status).toBe(201);
      expect(res.body.plan).toBe('pro');
      expect(res.body.isActive).toBe(true);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /subscriptions/insurance', () => {
    it('returns 404 when there is no active subscription', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' } });
      Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });

      const res = await request(app)
        .post('/subscriptions/insurance')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send({ cleanerId });

      expect(res.status).toBe(404);
    });

    it('adds the insurance add-on to the active subscription', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' } });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      const activeSubscription = { plan: 'pro', isActive: true, insuranceAddOn: false, save: saveMock };
      Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(activeSubscription) });

      const res = await request(app)
        .post('/subscriptions/insurance')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send({ cleanerId });

      expect(res.status).toBe(200);
      expect(res.body.insuranceAddOn).toBe(true);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
  });
});
