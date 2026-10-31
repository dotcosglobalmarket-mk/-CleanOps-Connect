// In-memory stand-ins for the models, with the same unique (series, visitNumber)
// rule the real Job index enforces, so a second run really would collide.
const mockStore = { jobs: [], series: [], users: {} };

jest.mock('../../src/models/Job', () => ({
  create: jest.fn(async (doc) => {
    if (doc.series && mockStore.jobs.some((j) => String(j.series) === String(doc.series) && j.visitNumber === doc.visitNumber)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    const job = { _id: `job${mockStore.jobs.length + 1}`, ...doc };
    mockStore.jobs.push(job);
    return job;
  }),
  findById: jest.fn(async (id) => mockStore.jobs.find((j) => j._id === id) || null),
  updateOne: jest.fn(async (filter, update) => {
    const job = mockStore.jobs.find((j) => j._id === filter._id);
    Object.assign(job, update.$set);
  }),
}));
jest.mock('../../src/models/Series', () => {
  const wrap = (data) => ({
    ...data,
    save: jest.fn(async function save() {
      return this;
    }),
  });
  return {
    create: jest.fn(async (doc) => {
      const s = wrap({ _id: `series${mockStore.series.length + 1}`, status: 'awaiting_card', visitsCreated: 1, ...doc });
      mockStore.series.push(s);
      return s;
    }),
    find: jest.fn(async (filter) => mockStore.series.filter((s) => filter.status.$in.includes(s.status))),
    updateOne: jest.fn(async (filter, update) => {
      const s = mockStore.series.find((x) => x._id === filter._id);
      if (update.$max) for (const [k, v] of Object.entries(update.$max)) s[k] = Math.max(s[k], v);
    }),
  };
});
jest.mock('../../src/models/User', () => ({ findById: jest.fn(async (id) => mockStore.users[id] || null) }));

const Series = require('../../src/models/Series');
const seriesService = require('../../src/services/series.service');
const { londonParts } = require('../../src/utils/london-time');

const utc = (s) => new Date(s);

function bookedJob(overrides = {}) {
  const job = {
    _id: 'job0',
    customer: 'cust1',
    cleaner: 'cleaner1',
    serviceType: 'st1',
    category: 'domestic',
    postcode: 'LS12 1AB',
    frequency: 'weekly',
    pricePence: 2600,
    budgetMin: 20,
    budgetMax: 30,
    // Tuesday 3 Feb 2026, 10:00 UK time (GMT)
    preferredStartAt: utc('2026-02-03T10:00:00Z'),
    paymentStatus: 'PAID_HELD',
    ...overrides,
  };
  mockStore.jobs.push(job);
  return job;
}

beforeEach(() => {
  mockStore.jobs = [];
  mockStore.series = [];
  mockStore.users = { cust1: { savedCard: { paymentMethodId: 'pm_1' } } };
  jest.clearAllMocks();
  process.env.RECURRING_JOBS_ENABLED = 'true';
});
afterAll(() => {
  delete process.env.RECURRING_JOBS_ENABLED;
});

describe('when each visit falls', () => {
  const first = utc('2026-02-03T10:00:00Z');

  it('weekly is 7 days on', () => {
    expect(seriesService.visitAt(first, 'weekly', 1)).toEqual(first);
    expect(seriesService.visitAt(first, 'weekly', 2)).toEqual(utc('2026-02-10T10:00:00Z'));
  });

  it('fortnightly is 14 days on', () => {
    expect(seriesService.visitAt(first, 'fortnightly', 3)).toEqual(utc('2026-03-03T10:00:00Z'));
  });

  it('monthly keeps the day of the month', () => {
    expect(seriesService.visitAt(first, 'monthly', 4)).toEqual(utc('2026-05-03T09:00:00Z'));
  });

  it('keeps 10:00 UK time when the clocks go forward (29 March 2026), so the UTC time moves', () => {
    const visit = seriesService.visitAt(first, 'weekly', 8); // Tue 24 Mar, still GMT
    expect(visit).toEqual(utc('2026-03-24T10:00:00Z'));
    const afterChange = seriesService.visitAt(first, 'weekly', 9); // Tue 31 Mar, BST
    expect(afterChange).toEqual(utc('2026-03-31T09:00:00Z'));
    expect(londonParts(afterChange)).toMatchObject({ hour: 10, minute: 0 });
  });

  it('a monthly visit on the 31st falls on the last day of a short month, then returns to the 31st', () => {
    const jan31 = utc('2026-01-31T10:00:00Z');
    expect(londonParts(seriesService.visitAt(jan31, 'monthly', 2))).toMatchObject({ month: 2, day: 28 });
    expect(londonParts(seriesService.visitAt(jan31, 'monthly', 3))).toMatchObject({ month: 3, day: 31 });
  });

  it('ends six months after the first visit by default', () => {
    expect(londonParts(seriesService.defaultEndsOn(first))).toMatchObject({ month: 8, day: 3, hour: 10 });
  });
});

describe('starting a series from an accepted job', () => {
  it('makes the job visit 1 of a series at the cleaner’s price', async () => {
    const job = bookedJob({ paymentStatus: 'BOOKED' });
    const series = await seriesService.startFromBookedJob(job);
    expect(series).toMatchObject({ frequency: 'weekly', pricePence: 2600, status: 'awaiting_card', cleaner: 'cleaner1', firstJob: 'job0' });
    expect(job).toMatchObject({ series: series._id, visitNumber: 1 });
  });

  it.each([
    ['one-off', { frequency: 'one_off' }],
    ['industrial', { category: 'industrial' }],
    ['no date', { preferredStartAt: undefined }],
  ])('does nothing for a %s job', async (_n, overrides) => {
    expect(await seriesService.startFromBookedJob(bookedJob(overrides))).toBeNull();
    expect(Series.create).not.toHaveBeenCalled();
  });

  it('does nothing while recurring jobs are switched off', async () => {
    process.env.RECURRING_JOBS_ENABLED = 'false';
    expect(await seriesService.startFromBookedJob(bookedJob())).toBeNull();
    expect(seriesService.describeForOffer(bookedJob())).toBeUndefined();
  });

  it('never undoes the booking if the series cannot be saved', async () => {
    Series.create.mockRejectedValueOnce(new Error('db down'));
    await expect(seriesService.startFromBookedJob(bookedJob())).resolves.toBeNull();
  });

  it('tells the cleaner what they are committing to', () => {
    const info = seriesService.describeForOffer(bookedJob());
    expect(info).toMatchObject({ frequency: 'weekly' });
    expect(info.visits).toBe(26);
  });
});

describe('the visit generator', () => {
  const now = utc('2026-02-04T08:00:00Z'); // the day after visit 1

  async function startedSeries(jobOverrides) {
    const job = bookedJob(jobOverrides);
    return seriesService.startFromBookedJob(job);
  }

  it('makes the visits due in the next 14 days, as scheduled jobs for the same cleaner and price', async () => {
    await startedSeries();
    const result = await seriesService.runVisitGenerator(now);

    // Visits 2 (10 Feb) and 3 (17 Feb) fall inside 14 days of 4 Feb.
    expect(result.visits).toBe(2);
    const made = mockStore.jobs.filter((j) => j.visitNumber > 1);
    expect(made.map((j) => j.visitNumber)).toEqual([2, 3]);
    expect(made[0]).toMatchObject({
      cleaner: 'cleaner1',
      customer: 'cust1',
      pricePence: 2600,
      visitState: 'scheduled',
      series: 'series1',
      preferredStartAt: utc('2026-02-10T10:00:00Z'),
    });
    expect(made[0].paymentStatus).toBeUndefined();
  });

  it('run twice, it makes no visit twice', async () => {
    await startedSeries();
    await seriesService.runVisitGenerator(now);
    const second = await seriesService.runVisitGenerator(now);

    expect(second.visits).toBe(0);
    const numbers = mockStore.jobs.filter((j) => j.series).map((j) => j.visitNumber);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('survives losing its own record of progress: the unique visit rule still stops duplicates', async () => {
    const series = await startedSeries();
    await seriesService.runVisitGenerator(now);
    series.visitsCreated = 1; // as if the update had been lost, or a second server ran at once
    const rerun = await seriesService.generateVisits(series, now);

    expect(rerun).toBe(0);
    expect(mockStore.jobs.filter((j) => j.series).map((j) => j.visitNumber)).toEqual([1, 2, 3]);
    expect(series.visitsCreated).toBe(3);
  });

  it('carries on later from where it stopped', async () => {
    await startedSeries();
    await seriesService.runVisitGenerator(now);
    const later = await seriesService.runVisitGenerator(utc('2026-02-18T08:00:00Z'));
    expect(later.visits).toBe(2); // 24 Feb and 3 Mar
    expect(mockStore.jobs.filter((j) => j.series).map((j) => j.visitNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('waits while visit 1 is not paid', async () => {
    await startedSeries({ paymentStatus: 'BOOKED' });
    expect((await seriesService.runVisitGenerator(now)).visits).toBe(0);
    expect(mockStore.series[0].status).toBe('awaiting_card');
  });

  it('waits until the customer has saved a card, then starts by itself', async () => {
    mockStore.users.cust1 = {};
    await startedSeries();
    expect((await seriesService.runVisitGenerator(now)).visits).toBe(0);

    mockStore.users.cust1 = { savedCard: { paymentMethodId: 'pm_1' } };
    expect((await seriesService.runVisitGenerator(now)).visits).toBe(2);
    expect(mockStore.series[0]).toMatchObject({ status: 'active' });
    expect(mockStore.series[0].activatedAt).toBeInstanceOf(Date);
  });

  it.each(['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'REFUNDED'])('stops the series if visit 1 ends as %s', async (status) => {
    await startedSeries({ paymentStatus: 'BOOKED' });
    mockStore.jobs[0].paymentStatus = status;
    expect((await seriesService.runVisitGenerator(now)).visits).toBe(0);
    expect(mockStore.series[0].status).toBe('cancelled');
  });

  it('never makes a visit past the end date, and marks the series ended afterwards', async () => {
    await startedSeries();
    const end = mockStore.series[0].endsOn;
    const afterEnd = new Date(end.getTime() + 24 * 3600 * 1000);
    await seriesService.runVisitGenerator(afterEnd);

    const last = Math.max(...mockStore.jobs.filter((j) => j.series).map((j) => j.visitNumber));
    expect(last).toBe(26);
    expect(Math.max(...mockStore.jobs.filter((j) => j.series).map((j) => +j.preferredStartAt))).toBeLessThanOrEqual(+end);
    expect(mockStore.series[0].status).toBe('ended');
  });

  it('does not touch paused or cancelled series', async () => {
    const series = await startedSeries();
    series.status = 'paused';
    expect((await seriesService.runVisitGenerator(now)).visits).toBe(0);
  });

  it('is off while the switch is off', async () => {
    await startedSeries();
    process.env.RECURRING_JOBS_ENABLED = 'false';
    expect(await seriesService.runVisitGenerator(now)).toEqual({ series: 0, visits: 0 });
  });

  it('one failing series does not stop the others', async () => {
    await startedSeries();
    const other = bookedJob({ _id: 'job9' });
    await seriesService.startFromBookedJob(other);
    mockStore.series[0].save = jest.fn().mockRejectedValue(new Error('boom'));
    mockStore.series[0].status = 'awaiting_card';
    mockStore.jobs[0].paymentStatus = 'CANCELLED'; // makes series 1 try to save, and fail
    const result = await seriesService.runVisitGenerator(now);
    expect(result.series).toBe(2);
    expect(result.visits).toBeGreaterThan(0);
  });
});
