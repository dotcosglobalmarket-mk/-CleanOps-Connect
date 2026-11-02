jest.mock('../../src/models/Subscription', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({}));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({}));
jest.mock('../../src/services/audit.service', () => ({}));
jest.mock('../../src/services/stripe.service');

const CleanerProfile = require('../../src/models/CleanerProfile');
const User = require('../../src/models/User');
const stripeService = require('../../src/services/stripe.service');
const subscriptionService = require('../../src/services/subscription.service');

const missing = () => Object.assign(new Error('No such customer'), { code: 'resource_missing' });

beforeEach(() => {
  jest.clearAllMocks();
  stripeService.isMissingResource.mockImplementation((e) => e && e.code === 'resource_missing');
  User.findById.mockResolvedValue({ email: 'sam@example.com' });
  stripeService.createSetupIntent.mockResolvedValue({ client_secret: 'seti_secret' });
});

const owner = { id: 'u1', role: 'cleaner' };

describe('a cleaner paying the platform fee when the stored Stripe customer is from another mode', () => {
  it('replaces the missing customer and carries on, instead of failing with a Stripe 400', async () => {
    CleanerProfile.findById.mockResolvedValue({ _id: 'c1', user: { toString: () => 'u1' }, stripeCustomerId: 'cus_from_test_mode' });
    stripeService.retrieveCustomer.mockRejectedValue(missing());
    stripeService.createCustomer.mockResolvedValue({ id: 'cus_live' });

    const result = await subscriptionService.createSetupIntent('c1', owner);

    expect(result).toEqual({ clientSecret: 'seti_secret' });
    expect(CleanerProfile.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $set: { stripeCustomerId: 'cus_live' } });
    expect(stripeService.createSetupIntent).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_live' }));
  });

  it('keeps a customer Stripe does know', async () => {
    CleanerProfile.findById.mockResolvedValue({ _id: 'c1', user: { toString: () => 'u1' }, stripeCustomerId: 'cus_1' });
    stripeService.retrieveCustomer.mockResolvedValue({ id: 'cus_1' });
    await subscriptionService.createSetupIntent('c1', owner);
    expect(stripeService.createCustomer).not.toHaveBeenCalled();
    expect(stripeService.createSetupIntent).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1' }));
  });

  it('surfaces other Stripe failures rather than creating duplicate customers', async () => {
    CleanerProfile.findById.mockResolvedValue({ _id: 'c1', user: { toString: () => 'u1' }, stripeCustomerId: 'cus_1' });
    stripeService.retrieveCustomer.mockRejectedValue(new Error('timeout'));
    await expect(subscriptionService.createSetupIntent('c1', owner)).rejects.toThrow('timeout');
    expect(stripeService.createCustomer).not.toHaveBeenCalled();
  });
});
