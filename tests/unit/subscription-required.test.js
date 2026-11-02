jest.mock('../../src/models/Subscription', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({}));
jest.mock('../../src/models/CleanerProfile', () => ({}));
jest.mock('../../src/models/User', () => ({}));
jest.mock('../../src/services/notification.service', () => ({}));
jest.mock('../../src/services/audit.service', () => ({}));
jest.mock('../../src/services/stripe.service');

const Subscription = require('../../src/models/Subscription');
const subscriptionService = require('../../src/services/subscription.service');

function found(sub) {
  Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(sub) });
}

describe('a cleaner needs a paid-up subscription to see and answer offers', () => {
  it.each([
    ['active', { isActive: true, stripeStatus: 'active' }, true],
    ['with no Stripe status recorded yet', { isActive: true }, true],
    ['trialing', { isActive: true, stripeStatus: 'trialing' }, true],
    ['set to end at renewal (still running)', { isActive: true, cancelAtPeriodEnd: true, stripeStatus: 'active' }, true],
    ['payment failed (past due)', { isActive: true, stripeStatus: 'past_due' }, false],
    ['unpaid', { isActive: true, stripeStatus: 'unpaid' }, false],
    ['ended', null, false],
  ])('%s', async (_name, sub, allowed) => {
    found(sub);
    expect(await subscriptionService.hasActiveSubscription('c1')).toBe(allowed);
  });

  it('refuses with 402 and a message pointing to the fix', async () => {
    found(null);
    await expect(subscriptionService.requireActiveSubscription('c1')).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining('Coverage & Subscription'),
    });
  });

  it('lets a paid-up cleaner through', async () => {
    found({ isActive: true, stripeStatus: 'active' });
    await expect(subscriptionService.requireActiveSubscription('c1')).resolves.toBeUndefined();
  });
});
