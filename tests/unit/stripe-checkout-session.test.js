const mockCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({ checkout: { sessions: { create: mockCreate } } }))
);

const stripeService = require('../../src/services/stripe.service');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.FRONTEND_URL = 'https://www.cleanop-connect.co.uk/';
  mockCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
});

describe('createCheckoutSession', () => {
  it('sends exactly the Checkout Studio parameters plus the placeholders', async () => {
    const session = await stripeService.createCheckoutSession();

    expect(session.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      ui_mode: 'hosted_page',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      submit_type: 'auto',
      integration_identifier: 'hosted_mobile_app_0001',
      origin_context: 'mobile_app',
      mode: 'payment',
      success_url: 'https://www.cleanop-connect.co.uk/customer.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.cleanop-connect.co.uk/customer.html?checkout=cancelled',
      line_items: [{ price: 'price_...', quantity: 1 }],
    });
  });

  it('leaves out payment_method_collection, which only applies to subscriptions', async () => {
    await stripeService.createCheckoutSession();
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('payment_method_collection');
  });
});
