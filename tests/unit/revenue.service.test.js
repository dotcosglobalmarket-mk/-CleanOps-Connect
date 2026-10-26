jest.mock('../../src/models/Job', () => ({ find: jest.fn() }));
jest.mock('../../src/models/Subscription', () => ({ find: jest.fn() }));
jest.mock('../../src/models/SubscriptionPayment', () => ({ find: jest.fn() }));

const Job = require('../../src/models/Job');
const Subscription = require('../../src/models/Subscription');
const SubscriptionPayment = require('../../src/models/SubscriptionPayment');
const { getRevenue, REVENUE_STATES } = require('../../src/services/revenue.service');

// Mongoose-style query: any chain of select/sort/limit/populate/lean, then awaited.
function query(result) {
  const q = {};
  ['select', 'sort', 'limit', 'populate', 'lean'].forEach((m) => { q[m] = jest.fn().mockReturnValue(q); });
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

const NOW = new Date('2026-10-26T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  Job.find.mockReturnValue(query([]));
  Subscription.find.mockReturnValue(query([]));
  SubscriptionPayment.find.mockReturnValue(query([]));
});

describe('getRevenue', () => {
  it('only counts commission on confirmed jobs, never refunded or disputed ones', async () => {
    await getRevenue({ range: '30d' }, NOW);
    const filter = Job.find.mock.calls[0][0];
    expect(filter.paymentStatus.$in).toEqual(REVENUE_STATES);
    expect(REVENUE_STATES).toEqual(expect.arrayContaining(['CONFIRMED', 'PAID_OUT']));
    ['REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'CANCELLED', 'PAID_HELD'].forEach((s) => expect(REVENUE_STATES).not.toContain(s));
  });

  it('totals commission and subscription billing for the range and compares with the previous one', async () => {
    Job.find.mockReturnValue(query([
      { commissionPence: 300, confirmedAt: daysAgo(2) },
      { commissionPence: 200, confirmedAt: daysAgo(10) },
      { commissionPence: 400, confirmedAt: daysAgo(40) }, // previous 30 days
      { commissionPence: 999, confirmedAt: daysAgo(70) }, // before both windows
    ]));
    SubscriptionPayment.find.mockImplementation((filter) =>
      filter.status === 'paid'
        ? query([{ amountPence: 1000, occurredAt: daysAgo(1) }, { amountPence: 250, occurredAt: daysAgo(35) }])
        : query([])
    );

    const r = await getRevenue({ range: '30d' }, NOW);

    expect(r.totals.commissionPence).toBe(500);
    expect(r.totals.jobsCount).toBe(2);
    expect(r.totals.subscriptionBilledPence).toBe(1000);
    expect(r.totals.totalPence).toBe(1500);
    expect(r.totals.previousTotalPence).toBe(650);
  });

  it('buckets the last 8 weeks', async () => {
    Job.find.mockReturnValue(query([{ commissionPence: 300, confirmedAt: daysAgo(1) }]));
    const r = await getRevenue({ range: '7d' }, NOW);
    expect(r.weeks).toHaveLength(8);
    expect(r.weeks[7].commissionPence).toBe(300);
    expect(r.weeks.slice(0, 7).every((w) => w.commissionPence === 0)).toBe(true);
  });

  it('adds up active subscribers by plan, using the billed price', async () => {
    Subscription.find.mockImplementation((filter) =>
      filter.isActive
        ? query([{ plan: 'starter', pricePence: 250 }, { plan: 'starter', pricePence: 250 }, { plan: 'pro', pricePence: 1000 }])
        : query([])
    );
    const r = await getRevenue({}, NOW);
    expect(r.totals.mrrPence).toBe(1500);
    expect(r.totals.activeSubscribers).toBe(3);
    expect(r.plans.find((p) => p.plan === 'starter')).toMatchObject({ cleaners: 2, monthlyPence: 500, label: 'Starter' });
  });

  it('lists past-due subscriptions with their latest failure and what is at risk', async () => {
    Subscription.find.mockImplementation((filter) =>
      filter.stripeStatus
        ? query([{ plan: 'pro', pricePence: 1000, stripeStatus: 'past_due', stripeSubscriptionId: 'sub_1', cleaner: { _id: 'c1', name: 'Amy' } }])
        : query([])
    );
    SubscriptionPayment.find.mockImplementation((filter) =>
      filter.status === 'failed'
        ? query([{ stripeSubscriptionId: 'sub_1', occurredAt: daysAgo(2), nextRetryAt: daysAgo(-1) }])
        : query([])
    );
    const r = await getRevenue({}, NOW);
    expect(r.totals).toMatchObject({ failedCount: 1, atRiskPence: 1000 });
    expect(r.atRisk[0]).toMatchObject({ cleaner: 'Amy', status: 'past_due', planLabel: 'Pro' });
    expect(r.atRisk[0].failedOn).toEqual(daysAgo(2));
  });

  it('returns empty, zeroed figures when there is no data yet', async () => {
    const r = await getRevenue({}, NOW);
    expect(r.totals).toMatchObject({ totalPence: 0, mrrPence: 0, failedCount: 0 });
    expect(r.atRisk).toEqual([]);
    expect(r.recentPayments).toEqual([]);
  });
});
