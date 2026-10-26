jest.mock('../../src/services/notification.service');
jest.mock('../../src/services/cleaner-portal.service');
jest.mock('../../src/services/review.service');
jest.mock('../../src/services/stripe.service');
jest.mock('../../src/models/User', () => ({
  findById: jest.fn((id) => Promise.resolve({ _id: id, role: 'operator', active: true, name: 'Olu' })),
  findOne: jest.fn(),
}));
jest.mock('../../src/models/Job', () => {
  const JobMock = jest.fn();
  JobMock.find = jest.fn();
  JobMock.findById = jest.fn();
  return JobMock;
});
jest.mock('../../src/models/JobOffer', () => ({ find: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const portal = require('../../src/services/cleaner-portal.service');
const reviewService = require('../../src/services/review.service');
const stripeService = require('../../src/services/stripe.service');
const Job = require('../../src/models/Job');
const JobOffer = require('../../src/models/JobOffer');

const jobId = '507f1f77bcf86cd799439011';

function tokenFor(role, id = 'user1') {
  return `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

function chainable(finalValue) {
  const obj = {};
  ['populate', 'sort', 'limit', 'select'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.then = (resolve, reject) => Promise.resolve(finalValue).then(resolve, reject);
  return obj;
}

describe('Phase 3 journey routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('cleaner portal', () => {
    it.each([
      ['get', '/cleaners/me/offers'],
      ['get', '/cleaners/me/jobs'],
      ['get', '/cleaners/me/earnings'],
      ['post', '/cleaners/me/payouts/onboarding'],
      ['get', '/cleaners/me/payouts/status'],
    ])('%s %s requires a cleaner', async (method, path) => {
      expect((await request(app)[method](path)).status).toBe(401);
      expect((await request(app)[method](path).set('Authorization', tokenFor('customer'))).status).toBe(403);
    });

    it('lists the cleaner’s own offers, filtered by status', async () => {
      portal.listMyOffers.mockResolvedValue([{ _id: 'o1' }]);
      const res = await request(app).get('/cleaners/me/offers?status=sent').set('Authorization', tokenFor('cleaner', 'c-user'));
      expect(res.status).toBe(200);
      expect(portal.listMyOffers).toHaveBeenCalledWith('c-user', { status: 'sent' });
    });

    it('rejects an unknown offer status filter', async () => {
      const res = await request(app).get('/cleaners/me/offers?status=bogus').set('Authorization', tokenFor('cleaner'));
      expect(res.status).toBe(400);
    });

    it('returns a Stripe onboarding link', async () => {
      portal.startPayoutOnboarding.mockResolvedValue({ url: 'https://connect.stripe.com/setup/x' });
      const res = await request(app).post('/cleaners/me/payouts/onboarding').set('Authorization', tokenFor('cleaner', 'c-user'));
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^https:\/\/connect\.stripe\.com/);
    });
  });

  describe('customer jobs', () => {
    it('lists only the logged-in customer’s jobs, without Stripe internals', async () => {
      Job.find.mockReturnValue(
        chainable([{ _id: jobId, customer: 'cust1', stripePaymentIntentId: 'pi_secret', paymentStatus: 'BOOKED' }])
      );
      const res = await request(app).get('/jobs/mine').set('Authorization', tokenFor('customer', 'cust1'));
      expect(res.status).toBe(200);
      expect(Job.find).toHaveBeenCalledWith({ customer: 'cust1' });
      expect(res.body[0].stripePaymentIntentId).toBeUndefined();
    });

    it('shows offers on the customer’s own job only', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: { toString: () => 'cust1' } });
      JobOffer.find.mockReturnValue(chainable([{ _id: 'o1', status: 'sent', score: 70, cleaner: { name: 'Sam' } }]));

      const own = await request(app).get(`/jobs/${jobId}/offers`).set('Authorization', tokenFor('customer', 'cust1'));
      expect(own.status).toBe(200);
      expect(own.body[0].cleaner.name).toBe('Sam');

      const other = await request(app).get(`/jobs/${jobId}/offers`).set('Authorization', tokenFor('customer', 'someone-else'));
      expect(other.status).toBe(403);
    });
  });

  describe('paying for a booked job', () => {
    it('returns the client secret to the customer who owns a BOOKED job', async () => {
      Job.findById.mockResolvedValue({
        _id: jobId,
        customer: { toString: () => 'cust1' },
        paymentStatus: 'BOOKED',
        stripePaymentIntentId: 'pi_1',
        pricePence: 7500,
      });
      stripeService.retrievePaymentIntent.mockResolvedValue({ client_secret: 'pi_1_secret_abc', status: 'requires_payment_method' });

      const res = await request(app).get(`/payments/jobs/${jobId}/intent`).set('Authorization', tokenFor('customer', 'cust1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ clientSecret: 'pi_1_secret_abc', amountPence: 7500, status: 'requires_payment_method' });
    });

    it('refuses another customer and jobs that are not waiting for payment', async () => {
      Job.findById.mockResolvedValue({ _id: jobId, customer: { toString: () => 'cust1' }, paymentStatus: 'PAID_HELD', stripePaymentIntentId: 'pi_1' });

      const other = await request(app).get(`/payments/jobs/${jobId}/intent`).set('Authorization', tokenFor('customer', 'x'));
      expect(other.status).toBe(403);

      const paid = await request(app).get(`/payments/jobs/${jobId}/intent`).set('Authorization', tokenFor('customer', 'cust1'));
      expect(paid.status).toBe(400);
      expect(stripeService.retrievePaymentIntent).not.toHaveBeenCalled();
    });
  });

  describe('reviews', () => {
    it('lets a customer review a job', async () => {
      reviewService.createReview.mockResolvedValue({ _id: 'r1', rating: 5 });
      const res = await request(app)
        .post(`/jobs/${jobId}/review`)
        .set('Authorization', tokenFor('customer', 'cust1'))
        .send({ rating: 5, comment: 'Brilliant' });
      expect(res.status).toBe(201);
      expect(reviewService.createReview).toHaveBeenCalledWith(jobId, { rating: 5, comment: 'Brilliant' }, expect.objectContaining({ id: 'cust1' }));
    });

    it('rejects ratings outside 1–5 and non-customers', async () => {
      const bad = await request(app).post(`/jobs/${jobId}/review`).set('Authorization', tokenFor('customer')).send({ rating: 6 });
      expect(bad.status).toBe(400);
      const cleaner = await request(app).post(`/jobs/${jobId}/review`).set('Authorization', tokenFor('cleaner')).send({ rating: 5 });
      expect(cleaner.status).toBe(403);
      expect(reviewService.createReview).not.toHaveBeenCalled();
    });

    it('serves latest reviews publicly', async () => {
      reviewService.listLatest.mockResolvedValue({ averageRating: 4.6, count: 12, reviews: [] });
      const res = await request(app).get('/reviews/latest?limit=3');
      expect(res.status).toBe(200);
      expect(reviewService.listLatest).toHaveBeenCalledWith({ limit: 3 });
    });

    it('lets an operator hide a review only with a reason', async () => {
      const noReason = await request(app)
        .patch('/ops/reviews/507f1f77bcf86cd799439099')
        .set('Authorization', tokenFor('operator', 'op1'))
        .send({ hidden: true });
      expect(noReason.status).toBe(400);

      reviewService.setVisibility.mockResolvedValue({ _id: 'r1', status: 'hidden' });
      const ok = await request(app)
        .patch('/ops/reviews/507f1f77bcf86cd799439099')
        .set('Authorization', tokenFor('operator', 'op1'))
        .send({ hidden: true, reason: 'Contains the cleaner’s home address' });
      expect(ok.status).toBe(200);
    });

    it('does not let customers moderate reviews', async () => {
      const res = await request(app)
        .patch('/ops/reviews/507f1f77bcf86cd799439099')
        .set('Authorization', tokenFor('customer'))
        .send({ hidden: true, reason: 'I do not like it' });
      expect(res.status).toBe(403);
    });
  });
});
