jest.mock('../../src/models/CleanerProfile', () => {
  const CleanerProfileMock = jest.fn();
  CleanerProfileMock.findById = jest.fn();
  CleanerProfileMock.findOneAndUpdate = jest.fn();
  return CleanerProfileMock;
});
jest.mock('../../src/models/Subscription', () => {
  const SubscriptionMock = jest.fn();
  SubscriptionMock.findOne = jest.fn();
  return SubscriptionMock;
});
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/stripe.service');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const CleanerProfile = require('../../src/models/CleanerProfile');
const Subscription = require('../../src/models/Subscription');
const User = require('../../src/models/User');
const stripeService = require('../../src/services/stripe.service');

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

  describe('POST /subscriptions/setup-intent', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/subscriptions/setup-intent').send({ cleanerId });
      expect(res.status).toBe(401);
    });

    it('returns 404 when the cleaner does not exist', async () => {
      CleanerProfile.findById.mockResolvedValue(null);
      const res = await request(app)
        .post('/subscriptions/setup-intent')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId });
      expect(res.status).toBe(404);
    });

    it('creates a Stripe customer on first use and returns a setup intent client secret', async () => {
      CleanerProfile.findById.mockResolvedValue({ _id: cleanerId, user: { toString: () => 'owner1' }, stripeCustomerId: null });
      User.findById.mockResolvedValue({ email: 'cleaner@example.com' });
      stripeService.createCustomer.mockResolvedValue({ id: 'cus_123' });
      CleanerProfile.findOneAndUpdate.mockResolvedValue({ stripeCustomerId: 'cus_123' });
      stripeService.createSetupIntent.mockResolvedValue({ client_secret: 'seti_secret_123' });

      const res = await request(app)
        .post('/subscriptions/setup-intent')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send({ cleanerId });

      expect(res.status).toBe(200);
      expect(res.body.clientSecret).toBe('seti_secret_123');
      expect(stripeService.createCustomer).toHaveBeenCalledWith({
        email: 'cleaner@example.com',
        metadata: { cleanerProfileId: cleanerId },
      });
    });
  });

  describe('POST /subscriptions', () => {
    function validBody(overrides = {}) {
      return { cleanerId, plan: 'starter', paymentMethodId: 'pm_123', ...overrides };
    }

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/subscriptions').send(validBody());
      expect(res.status).toBe(401);
    });

    it('returns 400 for an invalid plan', async () => {
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner'))
        .send(validBody({ plan: 'gold' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when paymentMethodId is missing', async () => {
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner'))
        .send({ cleanerId, plan: 'starter' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the cleaner does not exist', async () => {
      CleanerProfile.findById.mockResolvedValue(null);
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner'))
        .send(validBody());
      expect(res.status).toBe(404);
    });

    it('returns 403 when the requester does not own the cleaner profile', async () => {
      CleanerProfile.findById.mockResolvedValue({ user: { toString: () => 'owner1' }, stripeCustomerId: 'cus_123' });
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'someone-else'))
        .send(validBody());
      expect(res.status).toBe(403);
    });

    it('returns 400 when no payment method has been set up yet', async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: cleanerId,
        user: { toString: () => 'owner1' },
        stripeCustomerId: null,
      });
      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send(validBody());
      expect(res.status).toBe(400);
      expect(stripeService.retrievePaymentMethod).not.toHaveBeenCalled();
    });

    it("rejects a payment method that does not belong to the cleaner's Stripe customer", async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: cleanerId,
        user: { toString: () => 'owner1' },
        stripeCustomerId: 'cus_123',
      });
      stripeService.retrievePaymentMethod.mockResolvedValue({ customer: 'cus_someone_else' });

      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send(validBody());

      expect(res.status).toBe(403);
      expect(stripeService.setDefaultPaymentMethod).not.toHaveBeenCalled();
    });

    it('activates a subscription for the owning cleaner at the correct price for the plan', async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: cleanerId,
        user: { toString: () => 'owner1' },
        stripeCustomerId: 'cus_123',
      });
      stripeService.retrievePaymentMethod.mockResolvedValue({ customer: 'cus_123' });
      stripeService.setDefaultPaymentMethod.mockResolvedValue({});
      Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
      stripeService.createSubscription.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        current_period_end: 1893456000,
      });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      Subscription.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send(validBody({ plan: 'pro' }));

      expect(res.status).toBe(201);
      expect(res.body.plan).toBe('pro');
      expect(res.body.pricePence).toBe(1000);
      expect(res.body.isActive).toBe(true);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(stripeService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_123', pricePence: 1000, paymentMethodId: 'pm_123' })
      );
    });

    it('cancels an existing active subscription before activating a new plan', async () => {
      CleanerProfile.findById.mockResolvedValue({
        _id: cleanerId,
        user: { toString: () => 'owner1' },
        stripeCustomerId: 'cus_123',
      });
      stripeService.retrievePaymentMethod.mockResolvedValue({ customer: 'cus_123' });
      stripeService.setDefaultPaymentMethod.mockResolvedValue({});
      const existingSave = jest.fn().mockResolvedValue(undefined);
      const existing = { stripeSubscriptionId: 'sub_old', isActive: true, save: existingSave };
      Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(existing) });
      stripeService.cancelSubscription.mockResolvedValue({});
      stripeService.createSubscription.mockResolvedValue({ id: 'sub_new', status: 'active' });
      const saveMock = jest.fn().mockResolvedValue(undefined);
      Subscription.mockImplementation(function (data) {
        Object.assign(this, data);
        this.save = saveMock;
      });

      const res = await request(app)
        .post('/subscriptions')
        .set('Authorization', authHeaderFor('cleaner', 'owner1'))
        .send(validBody());

      expect(res.status).toBe(201);
      expect(stripeService.cancelSubscription).toHaveBeenCalledWith('sub_old');
      expect(existing.isActive).toBe(false);
      expect(existingSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /subscriptions/me', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/subscriptions/me');
      expect(res.status).toBe(401);
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
