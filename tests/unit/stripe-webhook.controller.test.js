// Lifecycle emails are fire-and-forget side effects; tested in notification.service.test.js.
jest.mock('../../src/services/notification.service');
jest.mock('../../src/services/stripe.service');
jest.mock('../../src/models/ProcessedWebhookEvent');
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/subscription.service');

const stripeService = require('../../src/services/stripe.service');
const ProcessedWebhookEvent = require('../../src/models/ProcessedWebhookEvent');
const paymentService = require('../../src/services/payment.service');
const subscriptionService = require('../../src/services/subscription.service');
const StripeWebhookController = require('../../src/controllers/StripeWebhookController');

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StripeWebhookController.handle', () => {
  it('rejects a payload with an invalid signature before touching the dedup table', async () => {
    stripeService.constructWebhookEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'bad' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(ProcessedWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('dispatches payment_intent.succeeded to the payment service on first delivery', async () => {
    const event = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 10000 } },
    };
    stripeService.constructWebhookEvent.mockReturnValue(event);
    ProcessedWebhookEvent.create.mockResolvedValue({ eventId: 'evt_1' });

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(paymentService.handlePaymentSucceeded).toHaveBeenCalledWith('pi_1', 10000);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('short-circuits a duplicate delivery of the same event id without dispatching twice', async () => {
    const event = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 10000 } },
    };
    stripeService.constructWebhookEvent.mockReturnValue(event);
    const duplicateKeyError = new Error('duplicate');
    duplicateKeyError.code = 11000;
    ProcessedWebhookEvent.create.mockRejectedValue(duplicateKeyError);

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(paymentService.handlePaymentSucceeded).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
  });

  it('routes payout.failed against the cleaner only, never a Job', async () => {
    const event = {
      id: 'evt_2',
      type: 'payout.failed',
      data: { object: { destination: 'acct_1' } },
    };
    stripeService.constructWebhookEvent.mockReturnValue(event);
    ProcessedWebhookEvent.create.mockResolvedValue({ eventId: 'evt_2' });

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(paymentService.handlePayoutFailed).toHaveBeenCalledWith('acct_1');
  });

  it('syncs subscription status from customer.subscription.updated', async () => {
    const subscriptionObject = { id: 'sub_1', status: 'past_due' };
    const event = { id: 'evt_3', type: 'customer.subscription.updated', data: { object: subscriptionObject } };
    stripeService.constructWebhookEvent.mockReturnValue(event);
    ProcessedWebhookEvent.create.mockResolvedValue({ eventId: 'evt_3' });

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(subscriptionService.handleStripeSubscriptionUpdated).toHaveBeenCalledWith(subscriptionObject);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('routes invoice.payment_failed to the subscription service', async () => {
    const invoice = { id: 'in_1', subscription: 'sub_1' };
    const event = { id: 'evt_4', type: 'invoice.payment_failed', data: { object: invoice } };
    stripeService.constructWebhookEvent.mockReturnValue(event);
    ProcessedWebhookEvent.create.mockResolvedValue({ eventId: 'evt_4' });

    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
    const res = makeRes();

    await StripeWebhookController.handle(req, res, jest.fn());

    expect(subscriptionService.handleInvoicePaymentFailed).toHaveBeenCalledWith(invoice);
  });

  it('routes invoice.payment_succeeded and invoice.paid to the subscription service', async () => {
    for (const type of ['invoice.payment_succeeded', 'invoice.paid']) {
      const invoice = { id: `in_${type}`, subscription: 'sub_1' };
      stripeService.constructWebhookEvent.mockReturnValue({ id: `evt_${type}`, type, data: { object: invoice } });
      ProcessedWebhookEvent.create.mockResolvedValue({});
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'good' } };
      await StripeWebhookController.handle(req, makeRes(), jest.fn());
      expect(subscriptionService.handleInvoicePaid).toHaveBeenCalledWith(invoice);
    }
  });
});
