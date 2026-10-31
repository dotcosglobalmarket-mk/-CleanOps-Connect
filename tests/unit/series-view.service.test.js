jest.mock('../../src/models/Job', () => ({ find: jest.fn() }));
jest.mock('../../src/models/Series', () => ({ find: jest.fn() }));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn() }));

const Job = require('../../src/models/Job');
const Series = require('../../src/models/Series');
const User = require('../../src/models/User');
const CleanerProfile = require('../../src/models/CleanerProfile');
const view = require('../../src/services/series-view.service');

const now = new Date('2026-02-10T08:00:00Z');
const inDays = (d) => new Date(+now + d * 86400000);

function query(result) {
  const q = {};
  ['populate', 'sort', 'limit', 'select', 'lean'].forEach((m) => {
    q[m] = jest.fn().mockReturnValue(q);
  });
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

const seriesDoc = (o = {}) => ({
  _id: 's1',
  status: 'active',
  frequency: 'weekly',
  pricePence: 2600,
  firstVisitAt: inDays(-7),
  endsOn: inDays(150),
  cleaner: { name: 'Sam Cleaner' },
  customer: { name: 'Pat Customer', email: 'pat@example.com' },
  serviceType: { name: 'Regular clean' },
  ...o,
});
const job = (o = {}) => ({ series: 's1', visitNumber: 2, preferredStartAt: inDays(3), pricePence: 2600, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RECURRING_JOBS_ENABLED;
});

describe('the state of a visit, in one plain word', () => {
  it.each([
    [{ visitState: 'scheduled' }, 'scheduled'],
    [{ visitState: 'skipped' }, 'skipped'],
    [{ paymentStatus: 'BOOKED' }, 'awaiting_payment'],
    [{ paymentStatus: 'PAID_HELD' }, 'paid'],
    [{ paymentStatus: 'IN_PROGRESS' }, 'in_progress'],
    [{ paymentStatus: 'AWAITING_CONFIRMATION' }, 'awaiting_confirmation'],
    [{ paymentStatus: 'DISPUTED' }, 'disputed'],
    [{ paymentStatus: 'CONFIRMED' }, 'done'],
    [{ paymentStatus: 'PAID_OUT' }, 'done'],
    [{ paymentStatus: 'REFUNDED' }, 'cancelled'],
    [{ paymentStatus: 'CANCELLED_BY_CLEANER' }, 'cancelled'],
  ])('%j is %s', (j, expected) => {
    expect(view.visitState(j)).toBe(expected);
  });
});

describe("a customer's own series", () => {
  it('shows the cleaner, the price, and the visits, and offers a skip only where one is allowed', async () => {
    process.env.RECURRING_JOBS_ENABLED = 'true';
    Series.find.mockReturnValue(query([seriesDoc()]));
    User.findById.mockResolvedValue({ savedCard: { paymentMethodId: 'pm_1' } });
    Job.find.mockReturnValue(
      query([
        job({ visitNumber: 1, preferredStartAt: inDays(-7), paymentStatus: 'CONFIRMED' }),
        job({ visitNumber: 2, paymentStatus: 'PAID_HELD' }),
        job({ visitNumber: 3, preferredStartAt: inDays(10), visitState: 'scheduled' }),
        job({ visitNumber: 4, preferredStartAt: inDays(17), visitState: 'skipped', skipReason: 'customer' }),
      ])
    );

    const result = await view.listMine({ id: 'cust1', role: 'customer' }, now);

    expect(Series.find).toHaveBeenCalledWith({ customer: 'cust1' });
    expect(result.enabled).toBe(true);
    const [s] = result.series;
    expect(s).toMatchObject({ with: 'Sam Cleaner', pricePence: 2600, frequency: 'weekly', needsCard: false });
    expect(s.visits.map((v) => [v.visitNumber, v.state, v.canSkip])).toEqual([
      [1, 'done', false], // the first visit is cancelled like an ordinary job
      [2, 'paid', true],
      [3, 'scheduled', true],
      [4, 'skipped', false],
    ]);
    expect(s.visits.every((v) => v.canCancel === false)).toBe(true);
  });

  it('asks for a card when none is saved', async () => {
    Series.find.mockReturnValue(query([seriesDoc({ status: 'awaiting_card' })]));
    User.findById.mockResolvedValue({});
    Job.find.mockReturnValue(query([]));
    const [s] = (await view.listMine({ id: 'cust1', role: 'customer' }, now)).series;
    expect(s.needsCard).toBe(true);
  });

  it('does not ask for a card on a series that has ended', async () => {
    Series.find.mockReturnValue(query([seriesDoc({ status: 'cancelled' })]));
    User.findById.mockResolvedValue({});
    Job.find.mockReturnValue(query([]));
    expect((await view.listMine({ id: 'cust1', role: 'customer' }, now)).series[0].needsCard).toBe(false);
  });

  it('shows nothing and says the feature is off when there are no series and it is switched off', async () => {
    Series.find.mockReturnValue(query([]));
    expect(await view.listMine({ id: 'cust1', role: 'customer' }, now)).toEqual({ enabled: false, series: [] });
  });

  it('only shows the most recent visits', async () => {
    Series.find.mockReturnValue(query([seriesDoc()]));
    User.findById.mockResolvedValue({ savedCard: { paymentMethodId: 'pm_1' } });
    Job.find.mockReturnValue(query(Array.from({ length: 20 }, (_, i) => job({ visitNumber: i + 2, preferredStartAt: inDays(3 + i * 7), visitState: 'scheduled' }))));
    expect((await view.listMine({ id: 'cust1', role: 'customer' }, now)).series[0].visits).toHaveLength(12);
  });
});

describe("a cleaner's own series", () => {
  it('shows the customer, and offers “can’t attend” only on visits still to come', async () => {
    CleanerProfile.findOne.mockResolvedValue({ _id: 'cleaner1' });
    Series.find.mockReturnValue(query([seriesDoc()]));
    Job.find.mockReturnValue(
      query([
        job({ visitNumber: 1, preferredStartAt: inDays(-7), paymentStatus: 'CONFIRMED' }),
        job({ visitNumber: 2, paymentStatus: 'PAID_HELD' }),
        job({ visitNumber: 3, preferredStartAt: inDays(10), visitState: 'scheduled' }),
        job({ visitNumber: 4, preferredStartAt: inDays(17), paymentStatus: 'IN_PROGRESS' }),
      ])
    );

    const result = await view.listMine({ id: 'cleaner-user', role: 'cleaner' }, now);

    expect(Series.find).toHaveBeenCalledWith({ cleaner: 'cleaner1' });
    const [s] = result.series;
    expect(s.with).toBe('Pat Customer');
    expect(s.needsCard).toBe(false);
    expect(s.visits.map((v) => [v.visitNumber, v.canCancel])).toEqual([
      [1, false],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(s.visits.every((v) => v.canSkip === false)).toBe(true);
  });

  it('shows nothing to someone with no cleaner profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(null);
    expect((await view.listMine({ id: 'x', role: 'cleaner' }, now)).series).toEqual([]);
  });
});

describe('the staff list', () => {
  it('shows who, how much, what has gone wrong, and the next visit', async () => {
    Series.find.mockReturnValue(
      query([seriesDoc({ cleaner: { name: 'Sam', companyName: 'Sparkle Ltd' }, paymentFailureStreak: 1, cleanerCancellations: 1, visitsCreated: 3 })])
    );
    Job.find.mockReturnValue(query([{ series: 's1', preferredStartAt: inDays(3) }, { series: 's1', preferredStartAt: inDays(10) }]));

    const [row] = await view.listForStaff({ status: 'active' }, now);

    expect(Series.find).toHaveBeenCalledWith({ status: 'active' });
    expect(row).toMatchObject({
      cleaner: 'Sparkle Ltd',
      customer: { name: 'Pat Customer', email: 'pat@example.com' },
      paymentFailureStreak: 1,
      cleanerCancellations: 1,
      visitsCreated: 3,
      nextVisitAt: inDays(3),
    });
  });
});
