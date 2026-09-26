const Stripe = require('stripe');

const stripeService = require('../../src/services/stripe.service');

const stripe = new Stripe('sk_test_dummy');
const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'account.updated', data: { object: {} } });

function signedWith(secret) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe('constructWebhookEvent accepts the platform and Connect signing secrets', () => {
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
  });

  afterAll(() => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  });

  it('verifies an event signed with the platform secret', () => {
    expect(stripeService.constructWebhookEvent(payload, signedWith('whsec_platform')).id).toBe('evt_1');
  });

  it('verifies an event from the Connect endpoint', () => {
    expect(stripeService.constructWebhookEvent(payload, signedWith('whsec_connect')).id).toBe('evt_1');
  });

  it('rejects any other signature', () => {
    expect(() => stripeService.constructWebhookEvent(payload, signedWith('whsec_attacker'))).toThrow();
  });
});
