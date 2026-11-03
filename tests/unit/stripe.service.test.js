process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const mockProductsRetrieve = jest.fn();
const mockProductsCreate = jest.fn();
const mockSubscriptionsCreate = jest.fn();
const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionsUpdate = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    products: { retrieve: mockProductsRetrieve, create: mockProductsCreate },
    subscriptions: { create: mockSubscriptionsCreate, retrieve: mockSubscriptionsRetrieve, update: mockSubscriptionsUpdate },
  }));
});

const stripeService = require('../../src/services/stripe.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('stripe.service.createSubscription', () => {
  it('reuses an existing plan Product and references it by id in price_data (not product_data)', async () => {
    mockProductsRetrieve.mockResolvedValue({ id: 'cleanops-plan-starter' });
    mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_1' });

    await stripeService.createSubscription({
      customerId: 'cus_1',
      planId: 'starter',
      pricePence: 250,
      productName: 'CleanOps Starter',
      paymentMethodId: 'pm_1',
      metadata: { plan: 'starter' },
    });

    expect(mockProductsRetrieve).toHaveBeenCalledWith('cleanops-plan-starter');
    expect(mockProductsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              currency: 'gbp',
              unit_amount: 250,
              product: 'cleanops-plan-starter',
            }),
          }),
        ],
      })
    );
    const [[sentParams]] = mockSubscriptionsCreate.mock.calls;
    expect(sentParams.items[0].price_data.product_data).toBeUndefined();
  });

  it('bills on the interval it is given, and monthly when none is given', async () => {
    mockProductsRetrieve.mockResolvedValue({ id: 'cleanops-plan-starter' });
    mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_1' });
    const base = { customerId: 'cus_1', planId: 'starter', pricePence: 250, productName: 'CleanOps Starter', paymentMethodId: 'pm_1' };

    await stripeService.createSubscription({ ...base, interval: 'week' });
    expect(mockSubscriptionsCreate.mock.calls[0][0].items[0].price_data.recurring).toEqual({ interval: 'week' });

    await stripeService.createSubscription(base);
    expect(mockSubscriptionsCreate.mock.calls[1][0].items[0].price_data.recurring).toEqual({ interval: 'month' });
  });

  it("creates the plan's Product once when it doesn't exist yet (404), then reuses it on the next call", async () => {
    const notFound = Object.assign(new Error('No such product'), { statusCode: 404 });
    mockProductsRetrieve.mockRejectedValueOnce(notFound).mockResolvedValue({ id: 'cleanops-plan-pro' });
    mockProductsCreate.mockResolvedValue({ id: 'cleanops-plan-pro' });
    mockSubscriptionsCreate.mockResolvedValue({ id: 'sub_1' });

    await stripeService.createSubscription({
      customerId: 'cus_1',
      planId: 'pro',
      pricePence: 1000,
      productName: 'CleanOps Pro',
      paymentMethodId: 'pm_1',
      metadata: {},
    });

    expect(mockProductsCreate).toHaveBeenCalledWith({ id: 'cleanops-plan-pro', name: 'CleanOps Pro' });

    // Second call for the same plan should use the in-memory cache and make
    // no further Product API calls at all.
    await stripeService.createSubscription({
      customerId: 'cus_2',
      planId: 'pro',
      pricePence: 1000,
      productName: 'CleanOps Pro',
      paymentMethodId: 'pm_2',
      metadata: {},
    });

    expect(mockProductsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockProductsCreate).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-404 error from retrieving the Product instead of trying to create it', async () => {
    const serverError = Object.assign(new Error('Stripe is down'), { statusCode: 500 });
    mockProductsRetrieve.mockRejectedValue(serverError);

    await expect(
      stripeService.createSubscription({
        customerId: 'cus_1',
        planId: 'industrial_pro',
        pricePence: 1000,
        productName: 'CleanOps Industrial Pro',
        paymentMethodId: 'pm_1',
        metadata: {},
      })
    ).rejects.toThrow('Stripe is down');

    expect(mockProductsCreate).not.toHaveBeenCalled();
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });
});

describe('stripe.service.switchSubscriptionInterval', () => {
  const args = { subscriptionId: 'sub_1', planId: 'starter', pricePence: 250, interval: 'week', productName: 'CleanOps Starter' };

  it('replaces the existing item (not adds one) with the weekly price and prorates', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', price: { unit_amount: 250, recurring: { interval: 'month' } } }] },
    });
    mockProductsRetrieve.mockResolvedValue({ id: 'cleanops-plan-starter' });
    mockSubscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });

    await stripeService.switchSubscriptionInterval(args);

    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
      items: [
        {
          id: 'si_1',
          price_data: { currency: 'gbp', unit_amount: 250, recurring: { interval: 'week' }, product: 'cleanops-plan-starter' },
        },
      ],
      proration_behavior: 'create_prorations',
    });
  });

  it('does nothing when the subscription is already on that price (safe to run twice)', async () => {
    const already = { id: 'sub_1', items: { data: [{ id: 'si_1', price: { unit_amount: 250, recurring: { interval: 'week' } } }] } };
    mockSubscriptionsRetrieve.mockResolvedValue(already);

    const result = await stripeService.switchSubscriptionInterval(args);

    expect(result).toBe(already);
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });
});
