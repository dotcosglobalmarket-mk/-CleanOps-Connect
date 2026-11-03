jest.mock('../../src/models/Subscription', () => ({ find: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({}));
jest.mock('../../src/models/CleanerProfile', () => ({}));
jest.mock('../../src/models/User', () => ({}));
jest.mock('../../src/services/notification.service', () => ({ subscriptionMovedToWeekly: jest.fn() }));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/stripe.service');

const Subscription = require('../../src/models/Subscription');
const notificationService = require('../../src/services/notification.service');
const auditService = require('../../src/services/audit.service');
const stripeService = require('../../src/services/stripe.service');
const subscriptionService = require('../../src/services/subscription.service');

function monthlyStarter(name, id) {
  return {
    plan: 'starter',
    isActive: true,
    pricePence: 250,
    stripeSubscriptionId: `sub_${id}`,
    cleaner: { _id: `cleaner_${id}`, name },
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function found(subs) {
  Subscription.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(subs) });
}

beforeEach(() => jest.clearAllMocks());

describe('moveStarterToWeekly', () => {
  it('only previews without confirm: nothing is changed in Stripe, saved or emailed', async () => {
    found([monthlyStarter('Ana', 1), monthlyStarter('Ben', 2)]);

    const result = await subscriptionService.moveStarterToWeekly({}, {});

    expect(result).toEqual({ dryRun: true, count: 2, cleaners: ['Ana', 'Ben'] });
    expect(stripeService.switchSubscriptionInterval).not.toHaveBeenCalled();
    expect(notificationService.subscriptionMovedToWeekly).not.toHaveBeenCalled();
  });

  it('picks only live monthly Starter plans that are not leaving', async () => {
    found([]);
    await subscriptionService.moveStarterToWeekly({}, {});
    expect(Subscription.find).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'starter',
        isActive: true,
        cancelAtPeriodEnd: { $ne: true },
        cancellationRequestedAt: null,
        billingInterval: { $ne: 'week' },
      })
    );
  });

  it('with confirm, switches each in Stripe to weekly, records it, audits it and emails the cleaner', async () => {
    const ana = monthlyStarter('Ana', 1);
    found([ana]);
    stripeService.switchSubscriptionInterval.mockResolvedValue({ id: 'sub_1', status: 'active', current_period_end: 1893456000 });

    const result = await subscriptionService.moveStarterToWeekly({ confirm: true }, { id: 'req' });

    expect(stripeService.switchSubscriptionInterval).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub_1', planId: 'starter', pricePence: 250, interval: 'week' })
    );
    expect(ana).toMatchObject({ billingInterval: 'week', pricePence: 250, stripeStatus: 'active' });
    expect(ana.renewsAt).toEqual(new Date(1893456000 * 1000));
    expect(ana.save).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscription.move_to_weekly', targetId: 'cleaner_1' }));
    expect(notificationService.subscriptionMovedToWeekly).toHaveBeenCalledWith('cleaner_1', { pricePence: 250 });
    expect(result).toMatchObject({ dryRun: false, moved: 1, failed: [] });
  });

  it('one failure does not stop the others and is reported without telling that cleaner', async () => {
    const ana = monthlyStarter('Ana', 1);
    const ben = monthlyStarter('Ben', 2);
    found([ana, ben]);
    stripeService.switchSubscriptionInterval
      .mockRejectedValueOnce(new Error('card_declined'))
      .mockResolvedValueOnce({ id: 'sub_2', status: 'active' });

    const result = await subscriptionService.moveStarterToWeekly({ confirm: true }, {});

    expect(result.moved).toBe(1);
    expect(result.failed).toEqual([{ cleaner: 'Ana', error: 'card_declined' }]);
    expect(ana.save).not.toHaveBeenCalled();
    expect(ana.billingInterval).toBeUndefined();
    expect(ben.billingInterval).toBe('week');
    expect(notificationService.subscriptionMovedToWeekly).toHaveBeenCalledTimes(1);
  });
});
