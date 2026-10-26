jest.mock('../../src/models/Subscription', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({ subscriptionPaymentFailed: jest.fn() }));
jest.mock('../../src/services/stripe.service');

const Subscription = require('../../src/models/Subscription');
const CleanerProfile = require('../../src/models/CleanerProfile');
const notificationService = require('../../src/services/notification.service');
const subscriptionService = require('../../src/services/subscription.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('subscription.service webhook handlers', () => {
  describe('handleStripeSubscriptionUpdated', () => {
    it('is a no-op when no local subscription matches the Stripe id', async () => {
      Subscription.findOne.mockResolvedValue(null);
      const result = await subscriptionService.handleStripeSubscriptionUpdated({ id: 'sub_unknown', status: 'active' });
      expect(result).toBeNull();
    });

    it('syncs status and renewsAt from the top-level current_period_end', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const subscription = { stripeSubscriptionId: 'sub_1', isActive: true, stripeStatus: 'active', save };
      Subscription.findOne.mockResolvedValue(subscription);

      await subscriptionService.handleStripeSubscriptionUpdated({
        id: 'sub_1',
        status: 'past_due',
        current_period_end: 1893456000,
      });

      expect(subscription.stripeStatus).toBe('past_due');
      expect(subscription.isActive).toBe(false);
      expect(subscription.renewsAt).toEqual(new Date(1893456000 * 1000));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('falls back to the subscription item period end when the top-level field is absent', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const subscription = { stripeSubscriptionId: 'sub_1', isActive: false, save };
      Subscription.findOne.mockResolvedValue(subscription);

      await subscriptionService.handleStripeSubscriptionUpdated({
        id: 'sub_1',
        status: 'active',
        items: { data: [{ current_period_end: 1893456000 }] },
      });

      expect(subscription.isActive).toBe(true);
      expect(subscription.renewsAt).toEqual(new Date(1893456000 * 1000));
    });

    it('marks a canceled subscription inactive', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const subscription = { stripeSubscriptionId: 'sub_1', isActive: true, save };
      Subscription.findOne.mockResolvedValue(subscription);

      await subscriptionService.handleStripeSubscriptionUpdated({ id: 'sub_1', status: 'canceled' });

      expect(subscription.isActive).toBe(false);
      expect(subscription.stripeStatus).toBe('canceled');
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    it('is a no-op for an invoice not tied to a subscription', async () => {
      const result = await subscriptionService.handleInvoicePaymentFailed({ id: 'in_1', subscription: null });
      expect(result).toBeNull();
      expect(Subscription.findOne).not.toHaveBeenCalled();
    });

    it('notifies the cleaner when their subscription payment fails', async () => {
      const subscription = { cleaner: 'cleaner1' };
      Subscription.findOne.mockResolvedValue(subscription);
      const cleaner = { _id: 'cleaner1' };
      CleanerProfile.findById.mockResolvedValue(cleaner);

      const result = await subscriptionService.handleInvoicePaymentFailed({ id: 'in_1', subscription: 'sub_1' });

      expect(Subscription.findOne).toHaveBeenCalledWith({ stripeSubscriptionId: 'sub_1' });
      expect(notificationService.subscriptionPaymentFailed).toHaveBeenCalledWith(cleaner);
      expect(result).toBe(subscription);
    });
  });
});
