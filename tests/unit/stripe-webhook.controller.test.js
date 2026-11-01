jest.mock('../../src/services/stripe.service');
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/subscription.service');

// A stand-in for the processed-events collection with the same unique-id rule.
const mockSeen = new Set();
jest.mock('../../src/models/ProcessedWebhookEvent', () => ({
  create: jest.fn(async ({ eventId }) => {
    if (mockSeen.has(eventId)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
    mockSeen.add(eventId);
  }),
  deleteOne: jest.fn(async ({ eventId }) => {
    mockSeen.delete(eventId);
  }),
}));

const stripeService = require('../../src/services/stripe.service');
const paymentService = require('../../src/services/payment.service');
const ProcessedWebhookEvent = require('../../src/models/ProcessedWebhookEvent');
const { handle } = require('../../src/controllers/StripeWebhookController');

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() });
const req = { body: '', headers: { 'stripe-signature': 'sig' } };
const paid = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount_received: 2600 } } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSeen.clear();
  stripeService.constructWebhookEvent.mockReturnValue(paid);
  paymentService.handlePaymentSucceeded.mockResolvedValue({});
});

describe('Stripe webhook handling', () => {
  it('handles an event once, and answers a repeat delivery as a duplicate without redoing the work', async () => {
    await handle(req, res(), jest.fn());
    const again = res();
    await handle(req, again, jest.fn());

    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledTimes(1);
    expect(again.json).toHaveBeenCalledWith({ received: true, duplicate: true });
  });

  it('a failure is passed on as an error so Stripe retries, and the retry really is handled again', async () => {
    paymentService.handlePaymentSucceeded.mockRejectedValueOnce(new Error('database blip'));

    const next = jest.fn();
    await handle(req, res(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'database blip' }));

    const retry = res();
    await handle(req, retry, jest.fn());
    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledTimes(2);
    expect(retry.json).toHaveBeenCalledWith({ received: true });
  });

  it('once it has succeeded, further repeats are ignored again', async () => {
    paymentService.handlePaymentSucceeded.mockRejectedValueOnce(new Error('blip'));
    await handle(req, res(), jest.fn());
    await handle(req, res(), jest.fn()); // the retry succeeds
    const third = res();
    await handle(req, third, jest.fn());
    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledTimes(2);
    expect(third.json).toHaveBeenCalledWith({ received: true, duplicate: true });
  });

  it('still reports the original failure if releasing the event also fails', async () => {
    paymentService.handlePaymentSucceeded.mockRejectedValueOnce(new Error('first failure'));
    ProcessedWebhookEvent.deleteOne.mockRejectedValueOnce(new Error('db down'));
    const next = jest.fn();
    await handle(req, res(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'first failure' }));
  });

  it('rejects a bad signature before recording or doing anything', async () => {
    stripeService.constructWebhookEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });
    const bad = res();
    await handle(req, bad, jest.fn());
    expect(bad.status).toHaveBeenCalledWith(400);
    expect(ProcessedWebhookEvent.create).not.toHaveBeenCalled();
    expect(paymentService.handlePaymentSucceeded).not.toHaveBeenCalled();
  });
});
