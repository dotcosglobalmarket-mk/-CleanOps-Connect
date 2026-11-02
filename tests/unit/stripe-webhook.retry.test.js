const mockSeen = new Set();
jest.mock('../../src/models/ProcessedWebhookEvent', () => ({
  create: jest.fn(async ({ eventId }) => {
    if (mockSeen.has(eventId)) {
      const err = new Error('duplicate');
      err.code = 11000;
      throw err;
    }
    mockSeen.add(eventId);
  }),
  deleteOne: jest.fn(async ({ eventId }) => { mockSeen.delete(eventId); }),
}));
jest.mock('../../src/services/stripe.service', () => ({ constructWebhookEvent: jest.fn((body) => JSON.parse(body)) }));
jest.mock('../../src/services/payment.service', () => ({ handlePaymentSucceeded: jest.fn() }));
jest.mock('../../src/services/subscription.service', () => ({}));

const ProcessedWebhookEvent = require('../../src/models/ProcessedWebhookEvent');
const paymentService = require('../../src/services/payment.service');
const { handle } = require('../../src/controllers/StripeWebhookController');

const mkRes = () => {
  const res = { code: null, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = res.json;
  return res;
};
const event = (id) => ({
  body: JSON.stringify({ id, type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount_received: 100 } } }),
  headers: {},
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSeen.clear();
  paymentService.handlePaymentSucceeded.mockReset();
});

describe('Stripe webhook retries', () => {
  it('does the work again when Stripe retries an event whose first attempt failed', async () => {
    paymentService.handlePaymentSucceeded.mockRejectedValueOnce(new Error('db blip'));
    const next = jest.fn();

    await handle(event('evt_1'), mkRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ProcessedWebhookEvent.deleteOne).toHaveBeenCalledWith({ eventId: 'evt_1' });

    const retry = mkRes();
    await handle(event('evt_1'), retry, next);
    expect(retry.code).toBe(200);
    expect(retry.body).toEqual({ received: true });
    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledTimes(2);
  });

  it('still answers "duplicate" without redoing the work once an event has succeeded', async () => {
    await handle(event('evt_2'), mkRes(), jest.fn());
    const again = mkRes();
    await handle(event('evt_2'), again, jest.fn());
    expect(again.body).toEqual({ received: true, duplicate: true });
    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledTimes(1);
  });

  it('still reports the original error if clearing the event fails too', async () => {
    paymentService.handlePaymentSucceeded.mockRejectedValueOnce(new Error('first'));
    ProcessedWebhookEvent.deleteOne.mockRejectedValueOnce(new Error('second'));
    const next = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await handle(event('evt_3'), mkRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'first' }));
    console.error.mockRestore();
  });
});
