const mockCreate = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/x' });
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({ checkout: { sessions: { create: mockCreate } } })));

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.FRONTEND_URL = 'https://example.test/';
const stripeService = require('../../src/services/stripe.service');

describe('createCheckoutSession', () => {
  it('sends exactly the configured parameters', async () => {
    const res = await stripeService.createCheckoutSession();
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
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
      success_url: 'https://example.test/customer.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://example.test/customer.html?checkout=cancelled',
      line_items: [{ price: 'price_...', quantity: 1 }],
    });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('payment_method_collection');
  });
});
