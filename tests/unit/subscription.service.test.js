jest.mock('../../src/models/Subscription', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({ subscriptionPaymentFailed: jest.fn() }));
jest.mock('../../src/services/stripe.service');

const Subscription = require('../../src/models/Subscription');
const CleanerProfile = require('../../src/models/CleanerProfile');
const notificationService = require('../../src/services/notification.service');
const SubscriptionPayment = require('../../src/models/SubscriptionPayment');
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

    it('records the failed payment with its retry date', async () => {
      Subscription.findOne.mockResolvedValue({ cleaner: 'cleaner1', plan: 'pro', stripeSubscriptionId: 'sub_1' });
      CleanerProfile.findById.mockResolvedValue({ _id: 'cleaner1' });
      SubscriptionPayment.findOne.mockResolvedValue(null);

      await subscriptionService.handleInvoicePaymentFailed({
        id: 'in_9', subscription: 'sub_1', amount_due: 1000, attempt_count: 2, next_payment_attempt: 1790000000,
      });

      expect(SubscriptionPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeInvoiceId: 'in_9', status: 'failed', amountPence: 1000, plan: 'pro', attemptCount: 2,
          nextRetryAt: new Date(1790000000 * 1000),
        })
      );
    });

    it('finds the subscription on newer Stripe API versions (invoice.parent)', async () => {
      Subscription.findOne.mockResolvedValue({ cleaner: 'cleaner1', plan: 'pro', stripeSubscriptionId: 'sub_2' });
      CleanerProfile.findById.mockResolvedValue({ _id: 'cleaner1' });
      SubscriptionPayment.findOne.mockResolvedValue(null);

      await subscriptionService.handleInvoicePaymentFailed({
        id: 'in_10', amount_due: 250, parent: { subscription_details: { subscription: 'sub_2' } },
      });

      expect(Subscription.findOne).toHaveBeenCalledWith({ stripeSubscriptionId: 'sub_2' });
      expect(notificationService.subscriptionPaymentFailed).toHaveBeenCalled();
    });
  });

  describe('handleInvoicePaid', () => {
    it('records a paid invoice and turns an earlier failed attempt into paid', async () => {
      Subscription.findOne.mockResolvedValue({ cleaner: 'cleaner1', plan: 'starter', stripeSubscriptionId: 'sub_1' });
      const save = jest.fn().mockResolvedValue(undefined);
      const existing = { status: 'failed', save };
      SubscriptionPayment.findOne.mockResolvedValue(existing);

      await subscriptionService.handleInvoicePaid({ id: 'in_1', subscription: 'sub_1', amount_paid: 250 });

      expect(existing.status).toBe('paid');
      expect(existing.amountPence).toBe(250);
      expect(save).toHaveBeenCalled();
    });

    it('never lets a late "failed" event overwrite a payment that already succeeded', async () => {
      Subscription.findOne.mockResolvedValue({ cleaner: 'cleaner1', plan: 'pro', stripeSubscriptionId: 'sub_1' });
      CleanerProfile.findById.mockResolvedValue({ _id: 'cleaner1' });
      const save = jest.fn();
      const existing = { status: 'paid', save };
      SubscriptionPayment.findOne.mockResolvedValue(existing);

      await subscriptionService.handleInvoicePaymentFailed({ id: 'in_1', subscription: 'sub_1', amount_due: 1000 });

      expect(existing.status).toBe('paid');
      expect(save).not.toHaveBeenCalled();
    });

    it('is a no-op for an invoice that is not for a platform subscription', async () => {
      expect(await subscriptionService.handleInvoicePaid({ id: 'in_x' })).toBeNull();
    });
  });
});
