jest.mock('../../src/models/User', () => ({ findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../src/services/email.service', () => ({ isConfigured: jest.fn(), send: jest.fn() }));
jest.mock('../../src/services/email-verification.service', () => {
  const actual = jest.requireActual('../../src/services/email-verification.service');
  return { ...actual, verify: jest.fn(), resend: jest.fn(), status: jest.fn() };
});
jest.mock('../../src/controllers/JobController');
jest.mock('../../src/controllers/SubscriptionController');
jest.mock('../../src/services/subscription.service', () => ({ requireActiveSubscription: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../../src/app');
const User = require('../../src/models/User');
const emailService = require('../../src/services/email.service');
const verification = require('../../src/services/email-verification.service');

const auth = (role, id = '64b000000000000000000001') => `Bearer ${jwt.sign({ sub: id, role }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
const OID = '64b000000000000000000001';
const JOB = '64b0000000000000000000a1';
const OFFER = '64b0000000000000000000b1';
const jobBody = { category: 'domestic', postcode: 'LS1 4DY', budgetMin: 50, budgetMax: 90, description: 'Two bed flat', serviceType: '64b0000000000000000000c1' };

describe('email confirmation routes', () => {
  const app = createApp();
  const reached = (req, res) => res.status(201).json({ reached: 'controller' });
  beforeEach(() => {
    jest.clearAllMocks();
    emailService.isConfigured.mockReturnValue(true);
    require('../../src/controllers/JobController').create.mockImplementation(reached);
    require('../../src/controllers/JobController').acceptOffer.mockImplementation(reached);
    require('../../src/controllers/JobController').submitQuote.mockImplementation(reached);
    require('../../src/controllers/SubscriptionController').activate.mockImplementation(reached);
  });

  it('verify-email passes the token on and answers for anyone with the link', async () => {
    verification.verify.mockResolvedValue({ verified: true });
    const res = await request(app).post('/auth/verify-email').send({ token: 'a'.repeat(64) });
    expect(res.status).toBe(200);
    expect(verification.verify).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('verify-email rejects a missing or silly token before looking anything up', async () => {
    expect((await request(app).post('/auth/verify-email').send({})).status).toBe(400);
    expect((await request(app).post('/auth/verify-email').send({ token: 'x' })).status).toBe(400);
    expect(verification.verify).not.toHaveBeenCalled();
  });

  it('resend and status need a login', async () => {
    expect((await request(app).post('/auth/resend-verification')).status).toBe(401);
    expect((await request(app).get('/auth/email-status')).status).toBe(401);
  });

  it('resend and status act for the signed-in person only', async () => {
    User.findById.mockResolvedValue({ _id: OID, role: 'customer' });
    verification.resend.mockResolvedValue({ sent: true });
    verification.status.mockResolvedValue({ verified: false, blocked: true, canSend: true });
    expect((await request(app).post('/auth/resend-verification').set('Authorization', auth('customer'))).status).toBe(200);
    expect(verification.resend).toHaveBeenCalledWith(OID);
    const res = await request(app).get('/auth/email-status').set('Authorization', auth('customer'));
    expect(res.body).toEqual({ verified: false, blocked: true, canSend: true });
    expect(verification.status).toHaveBeenCalledWith(OID);
  });

  describe('actions that need a confirmed address', () => {
    const blocked = { _id: OID, role: 'customer', emailVerification: { required: true } };
    const cleanerBlocked = { _id: OID, role: 'cleaner', emailVerification: { required: true } };
    const JobController = require('../../src/controllers/JobController');
    const SubscriptionController = require('../../src/controllers/SubscriptionController');

    it('stops an unconfirmed customer posting a job, with a code the website can act on', async () => {
      User.findById.mockResolvedValue(blocked);
      const res = await request(app).post('/jobs').set('Authorization', auth('customer')).send(jobBody);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('email_not_verified');
      expect(res.body.message).toMatch(/confirm your email/i);
      expect(JobController.create).not.toHaveBeenCalled();
    });

    it('stops an unconfirmed cleaner accepting, quoting or subscribing', async () => {
      User.findById.mockResolvedValue(cleanerBlocked);
      const accept = await request(app).post(`/jobs/${JOB}/offers/${OFFER}/accept`).set('Authorization', auth('cleaner')).send({ pricePence: 5000 });
      const quote = await request(app).post(`/jobs/${JOB}/offers/${OFFER}/quote`).set('Authorization', auth('cleaner')).send({ pricePence: 5000 });
      const sub = await request(app).post('/subscriptions').set('Authorization', auth('cleaner')).send({ cleanerId: OID, plan: 'pro', paymentMethodId: 'pm_1' });
      [accept, quote, sub].forEach((r) => expect(r.status).toBe(403));
      expect(JobController.acceptOffer).not.toHaveBeenCalled();
      expect(JobController.submitQuote).not.toHaveBeenCalled();
      expect(SubscriptionController.activate).not.toHaveBeenCalled();
    });

    it.each([
      ['has confirmed', { emailVerification: { required: true, verifiedAt: new Date() } }],
      ['is an older account', {}],
    ])('lets someone through who %s', async (_n, extra) => {
      User.findById.mockResolvedValue({ _id: OID, role: 'customer', ...extra });
      const res = await request(app).post('/jobs').set('Authorization', auth('customer')).send(jobBody);
      expect(res.status).toBe(201);
      expect(JobController.create).toHaveBeenCalled();
    });

    it('does not stop anyone while the server cannot send email', async () => {
      emailService.isConfigured.mockReturnValue(false);
      User.findById.mockResolvedValue(blocked);
      const res = await request(app).post('/jobs').set('Authorization', auth('customer')).send(jobBody);
      expect(res.status).toBe(201);
    });
  });
});
