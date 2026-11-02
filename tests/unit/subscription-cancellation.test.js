jest.mock('../../src/models/Subscription', () => ({ findOne: jest.fn(), findById: jest.fn(), find: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/notification.service', () => ({
  subscriptionCancellationRequested: jest.fn(),
  subscriptionCancelled: jest.fn(),
  subscriptionCancellationDeclined: jest.fn(),
  subscriptionPaymentFailed: jest.fn(),
}));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/services/stripe.service');

const Subscription = require('../../src/models/Subscription');
const CleanerProfile = require('../../src/models/CleanerProfile');
const notifications = require('../../src/services/notification.service');
const auditService = require('../../src/services/audit.service');
const stripeService = require('../../src/services/stripe.service');
const subscriptionService = require('../../src/services/subscription.service');

const req = { user: { id: 'admin1', role: 'admin' }, ip: '127.0.0.1' };

function activeSubscription(overrides = {}) {
  return {
    cleaner: 'cleaner1',
    plan: 'pro',
    isActive: true,
    stripeSubscriptionId: 'sub_1',
    renewsAt: new Date('2026-12-01T00:00:00Z'),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  CleanerProfile.findOne.mockResolvedValue({ _id: 'cleaner1' });
});

describe('a cleaner asking to cancel', () => {
  function mySubscription(sub) {
    Subscription.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(sub) });
  }

  it('records the request and reason, and emails a receipt, without touching Stripe', async () => {
    const sub = activeSubscription();
    mySubscription(sub);

    await subscriptionService.requestCancellation('user1', '  Moving abroad  ');

    expect(sub.cancellationRequestedAt).toBeInstanceOf(Date);
    expect(sub.cancellationReason).toBe('Moving abroad');
    expect(sub.save).toHaveBeenCalled();
    expect(notifications.subscriptionCancellationRequested).toHaveBeenCalledWith('cleaner1');
    expect(stripeService.cancelSubscription).not.toHaveBeenCalled();
    expect(stripeService.cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('accepts a request with no reason', async () => {
    const sub = activeSubscription();
    mySubscription(sub);
    await subscriptionService.requestCancellation('user1', undefined);
    expect(sub.cancellationReason).toBeUndefined();
    expect(sub.cancellationRequestedAt).toBeInstanceOf(Date);
  });

  it('says so when there is no active subscription', async () => {
    mySubscription(null);
    await expect(subscriptionService.requestCancellation('user1')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a second request while one is waiting', async () => {
    mySubscription(activeSubscription({ cancellationRequestedAt: new Date() }));
    await expect(subscriptionService.requestCancellation('user1')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a request on a subscription that is already ending', async () => {
    mySubscription(activeSubscription({ cancelAtPeriodEnd: true }));
    await expect(subscriptionService.requestCancellation('user1')).rejects.toMatchObject({ status: 400 });
  });

  it('lets the cleaner withdraw a request', async () => {
    const sub = activeSubscription({ cancellationRequestedAt: new Date(), cancellationReason: 'x' });
    mySubscription(sub);

    await subscriptionService.withdrawCancellation('user1');

    expect(sub.cancellationRequestedAt).toBeUndefined();
    expect(sub.cancellationReason).toBeUndefined();
    expect(sub.save).toHaveBeenCalled();
  });

  it('rejects withdrawing when nothing was requested', async () => {
    mySubscription(activeSubscription());
    await expect(subscriptionService.withdrawCancellation('user1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('an admin cancelling a subscription', () => {
  it('at the end of the period: tells Stripe, keeps it active, audits, and emails the cleaner', async () => {
    const sub = activeSubscription({ cancellationRequestedAt: new Date(), cancellationReason: 'x' });
    Subscription.findById.mockResolvedValue(sub);

    await subscriptionService.cancelAsAdmin('s1', { when: 'period_end', reason: 'Asked to leave' }, req);

    expect(stripeService.cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith('sub_1');
    expect(stripeService.cancelSubscription).not.toHaveBeenCalled();
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.isActive).toBe(true);
    expect(sub.cancellationRequestedAt).toBeUndefined();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        action: 'subscription.cancel_at_period_end',
        targetType: 'cleaner',
        targetId: 'cleaner1',
        reason: 'Asked to leave',
      })
    );
    expect(notifications.subscriptionCancelled).toHaveBeenCalledWith('cleaner1', {
      when: 'period_end',
      endsAt: sub.renewsAt,
    });
  });

  it('immediately: cancels at Stripe and marks it ended', async () => {
    const sub = activeSubscription();
    Subscription.findById.mockResolvedValue(sub);

    await subscriptionService.cancelAsAdmin('s1', { when: 'now', reason: 'Fraud review' }, req);

    expect(stripeService.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(stripeService.cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
    expect(sub.isActive).toBe(false);
    expect(sub.stripeStatus).toBe('canceled');
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscription.cancel_now' }));
  });

  it('leaves the subscription untouched when Stripe fails, and writes no audit entry', async () => {
    const sub = activeSubscription();
    Subscription.findById.mockResolvedValue(sub);
    stripeService.cancelSubscriptionAtPeriodEnd.mockRejectedValue(new Error('stripe down'));

    await expect(
      subscriptionService.cancelAsAdmin('s1', { when: 'period_end', reason: 'Asked to leave' }, req)
    ).rejects.toThrow('stripe down');

    expect(sub.cancelAtPeriodEnd).toBeUndefined();
    expect(sub.save).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
    expect(notifications.subscriptionCancelled).not.toHaveBeenCalled();
  });

  it('refuses a subscription that has already ended', async () => {
    Subscription.findById.mockResolvedValue(activeSubscription({ isActive: false }));
    await expect(
      subscriptionService.cancelAsAdmin('s1', { when: 'now', reason: 'Because' }, req)
    ).rejects.toMatchObject({ status: 400 });
    expect(stripeService.cancelSubscription).not.toHaveBeenCalled();
  });

  it('refuses to schedule the end twice', async () => {
    Subscription.findById.mockResolvedValue(activeSubscription({ cancelAtPeriodEnd: true }));
    await expect(
      subscriptionService.cancelAsAdmin('s1', { when: 'period_end', reason: 'Because' }, req)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s for an unknown subscription', async () => {
    Subscription.findById.mockResolvedValue(null);
    await expect(
      subscriptionService.cancelAsAdmin('nope', { when: 'now', reason: 'Because' }, req)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('declining a request clears it, audits it, and tells the cleaner', async () => {
    const sub = activeSubscription({ cancellationRequestedAt: new Date(), cancellationReason: 'x' });
    Subscription.findById.mockResolvedValue(sub);

    await subscriptionService.declineCancellation('s1', 'Contract runs to March', req);

    expect(sub.cancellationRequestedAt).toBeUndefined();
    expect(stripeService.cancelSubscription).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subscription.cancellation_declined', reason: 'Contract runs to March' })
    );
    expect(notifications.subscriptionCancellationDeclined).toHaveBeenCalledWith('cleaner1');
  });

  it('cannot decline when there is no request', async () => {
    Subscription.findById.mockResolvedValue(activeSubscription());
    await expect(subscriptionService.declineCancellation('s1', 'Because', req)).rejects.toMatchObject({ status: 400 });
  });
});

describe('listing subscriptions for the admin', () => {
  function list() {
    const chain = { populate: jest.fn(), sort: jest.fn(), limit: jest.fn().mockResolvedValue([]) };
    chain.populate.mockReturnValue(chain);
    chain.sort.mockReturnValue(chain);
    Subscription.find.mockReturnValue(chain);
  }

  it.each([
    ['active', { isActive: true }],
    ['ended', { isActive: false }],
    ['ending', { isActive: true, cancelAtPeriodEnd: true }],
    ['requested', { isActive: true, cancelAtPeriodEnd: { $ne: true }, cancellationRequestedAt: { $ne: null } }],
  ])('"%s" filters on the right fields', async (status, expected) => {
    list();
    await subscriptionService.listForAdmin({ status });
    expect(Subscription.find).toHaveBeenCalledWith(expected);
  });

  it('defaults to active subscriptions', async () => {
    list();
    await subscriptionService.listForAdmin({});
    expect(Subscription.find).toHaveBeenCalledWith({ isActive: true });
  });
});

describe('Stripe telling us a subscription is set to end', () => {
  it('records it, and keeps the subscription active until it actually ends', async () => {
    const sub = { stripeSubscriptionId: 'sub_1', save: jest.fn().mockResolvedValue(undefined) };
    Subscription.findOne.mockResolvedValue(sub);

    await subscriptionService.handleStripeSubscriptionUpdated({
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: 1893456000,
    });

    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.isActive).toBe(true);
  });

  it('clears the flag if the scheduled end is removed', async () => {
    const sub = { stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: true, save: jest.fn().mockResolvedValue(undefined) };
    Subscription.findOne.mockResolvedValue(sub);

    await subscriptionService.handleStripeSubscriptionUpdated({ id: 'sub_1', status: 'active', cancel_at_period_end: false });

    expect(sub.cancelAtPeriodEnd).toBe(false);
  });
});
