// In-memory Job store that honours the queries the service makes, including the
// atomic "claim this attempt" update, so double runs are really exercised.
const mockStore = { jobs: [], series: {}, users: {} };
const mockMatchAttempts = (cond, value) => {
  if (cond && typeof cond === 'object' && cond.$in) return cond.$in.includes(value == null ? null : value);
  return cond === value;
};

jest.mock('../../src/models/Job', () => {
  const apply = (job, update) => {
    if (update.$set) Object.assign(job, update.$set);
    if (update.$unset) for (const k of Object.keys(update.$unset)) delete job[k];
  };
  return {
    find: jest.fn(async (q) =>
      mockStore.jobs.filter(
        (j) =>
          j.visitState === q.visitState &&
          j.preferredStartAt <= q.preferredStartAt.$lte &&
          (!j.nextChargeAttemptAt || j.nextChargeAttemptAt <= q.$or[2].nextChargeAttemptAt.$lte)
      )
    ),
    findOneAndUpdate: jest.fn(async (q, update) => {
      const job = mockStore.jobs.find(
        (j) =>
          String(j._id) === String(q._id) &&
          j.visitState === q.visitState &&
          (q.chargeAttempts === undefined || mockMatchAttempts(q.chargeAttempts, j.chargeAttempts))
      );
      if (!job) return null;
      apply(job, update);
      return job;
    }),
    updateOne: jest.fn(async (q, update) => {
      const job = mockStore.jobs.find((j) => String(j._id) === String(q._id));
      if (job) apply(job, update);
    }),
  };
});
jest.mock('../../src/models/Series', () => ({
  findById: jest.fn(async (id) => mockStore.series[id] || null),
  findOneAndUpdate: jest.fn(async (q, update) => {
    const s = mockStore.series[q._id];
    if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) s[k] = (s[k] || 0) + v;
    return s;
  }),
  updateOne: jest.fn(async (q, update) => {
    Object.assign(mockStore.series[q._id], update.$set || {});
  }),
}));
jest.mock('../../src/models/User', () => ({ findById: jest.fn(async (id) => mockStore.users[id] || null) }));
jest.mock('../../src/services/stripe.service');
jest.mock('../../src/services/notification.service');

const stripeService = require('../../src/services/stripe.service');
const notifications = require('../../src/services/notification.service');
const charging = require('../../src/services/visit-charging.service');

const H = 3600 * 1000;
const now = new Date('2026-02-10T08:00:00Z');
const inHours = (h) => new Date(+now + h * H);

function visit(overrides = {}) {
  const job = {
    _id: `job${mockStore.jobs.length + 1}`,
    series: 'series1',
    visitNumber: 2,
    visitState: 'scheduled',
    status: 'allocated',
    pricePence: 2600,
    cleaner: 'cleaner1',
    preferredStartAt: inHours(47),
    chargeAttempts: 0,
    save: jest.fn(async () => job),
    ...overrides,
  };
  mockStore.jobs.push(job);
  return job;
}

const cardError = () => Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' });

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.jobs = [];
  mockStore.series = { series1: { _id: 'series1', customer: 'cust1', cleaner: 'cleaner1', status: 'active', paymentFailureStreak: 0, save: jest.fn(async function s() { return this; }) } };
  mockStore.users = { cust1: { stripeCustomerId: 'cus_1', savedCard: { paymentMethodId: 'pm_1', consentVersion: 'card-v2' } } };
  stripeService.createPaymentIntent.mockResolvedValue({ id: 'pi_1' });
  stripeService.confirmOffSession.mockResolvedValue({ status: 'succeeded' });
  stripeService.cancelPaymentIntent.mockResolvedValue({});
});

describe('charging a visit 48 hours ahead', () => {
  it('charges the saved card with idempotency keys and books the visit for the webhook to complete', async () => {
    const job = visit();
    const counts = await charging.runChargeSweep(now);

    expect(counts.paid).toBe(1);
    expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountPence: 2600, customerId: 'cus_1', paymentMethodId: 'pm_1', idempotencyKey: `visit:${job._id}:a1` })
    );
    expect(stripeService.confirmOffSession).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_1', paymentMethodId: 'pm_1', idempotencyKey: `visit:${job._id}:a1:confirm` })
    );
    expect(job).toMatchObject({ paymentStatus: 'BOOKED', stripePaymentIntentId: 'pi_1', chargeAttempts: 1 });
    expect(job.visitState).toBeUndefined();
    expect(job.bookedAt).toEqual(now);
  });

  it('books the visit and stores the intent before asking Stripe to take the money', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockImplementation(async () => {
      expect(job).toMatchObject({ paymentStatus: 'BOOKED', stripePaymentIntentId: 'pi_1' });
      return { status: 'succeeded' };
    });
    await charging.runChargeSweep(now);
    expect(stripeService.confirmOffSession).toHaveBeenCalled();
  });

  it('does not charge a visit more than 48 hours away', async () => {
    visit({ preferredStartAt: inHours(60) });
    await charging.runChargeSweep(now);
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('run twice, charges once', async () => {
    visit();
    await charging.runChargeSweep(now);
    await charging.runChargeSweep(now);
    expect(stripeService.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(stripeService.confirmOffSession).toHaveBeenCalledTimes(1);
  });

  it('two sweeps racing for the same visit: only one gets to charge', async () => {
    const job = visit();
    const series = mockStore.series.series1;
    const staleView = { ...job }; // what the second sweep read before the first claimed it
    const [a, b] = await Promise.all([charging.chargeVisit(job, series, now), charging.chargeVisit(staleView, series, now)]);
    expect([a, b].sort()).toEqual(['busy', 'paid']);
    expect(stripeService.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('a successful charge clears the run of failures', async () => {
    mockStore.series.series1.paymentFailureStreak = 1;
    visit();
    await charging.runChargeSweep(now);
    expect(mockStore.series.series1.paymentFailureStreak).toBe(0);
  });
});

describe('a declined card', () => {
  it('tells the customer, puts the visit back, and tries once more 12 hours later', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockRejectedValueOnce(cardError());

    const counts = await charging.runChargeSweep(now);

    expect(counts.retry).toBe(1);
    expect(stripeService.cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(job).toMatchObject({ visitState: 'scheduled', chargeAttempts: 1 });
    expect(job.paymentStatus).toBeUndefined();
    expect(job.stripePaymentIntentId).toBeUndefined();
    expect(job.nextChargeAttemptAt).toEqual(inHours(12));
    expect(notifications.visitPaymentFailed).toHaveBeenCalledWith(job, { retryAt: inHours(12) });
  });

  it('leaves it alone until the retry time, then retries with a new idempotency key', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockRejectedValueOnce(cardError());
    await charging.runChargeSweep(now);

    stripeService.createPaymentIntent.mockClear();
    await charging.runChargeSweep(inHours(6));
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();

    stripeService.createPaymentIntent.mockResolvedValue({ id: 'pi_2' });
    const counts = await charging.runChargeSweep(inHours(12));
    expect(counts.paid).toBe(1);
    expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `visit:${job._id}:a2` }));
    expect(job).toMatchObject({ paymentStatus: 'BOOKED', stripePaymentIntentId: 'pi_2' });
  });

  it('skips the visit if the second attempt also fails, and says so', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockRejectedValue(cardError());
    await charging.runChargeSweep(now);
    const counts = await charging.runChargeSweep(inHours(12));

    expect(counts.skipped).toBe(1);
    expect(job).toMatchObject({ visitState: 'skipped', status: 'cancelled', skipReason: 'payment' });
    expect(notifications.visitSkipped).toHaveBeenCalledWith(job, { reason: 'payment' });
    expect(mockStore.series.series1.paymentFailureStreak).toBe(1);
    expect(mockStore.series.series1.status).toBe('active');
  });

  it('pauses the series when two visits in a row are skipped for payment', async () => {
    visit({ visitNumber: 2 });
    visit({ visitNumber: 3, preferredStartAt: inHours(46) });
    stripeService.confirmOffSession.mockRejectedValue(cardError());
    await charging.runChargeSweep(now);
    await charging.runChargeSweep(inHours(12));

    const series = mockStore.series.series1;
    expect(series).toMatchObject({ status: 'paused', pausedBy: 'payment', paymentFailureStreak: 2 });
    expect(notifications.seriesPaused).toHaveBeenCalledWith(series, { reason: 'payment' });
  });

  it('gives up without a second try once the visit is less than 24 hours away', async () => {
    const job = visit({ preferredStartAt: inHours(30) });
    stripeService.confirmOffSession.mockRejectedValue(cardError());
    await charging.runChargeSweep(now); // fails; a retry at +12h would be 18h before the visit
    expect(job).toMatchObject({ visitState: 'skipped', skipReason: 'payment' });
    expect(stripeService.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('treats a bank asking for the customer to be present as a decline', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockResolvedValue({ status: 'requires_action' });
    expect((await charging.runChargeSweep(now)).retry).toBe(1);
    expect(job.visitState).toBe('scheduled');
  });

  it('treats a missing saved card as a decline, without calling Stripe', async () => {
    const job = visit();
    mockStore.users.cust1 = { stripeCustomerId: 'cus_1' };
    expect((await charging.runChargeSweep(now)).retry).toBe(1);
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
    expect(notifications.visitPaymentFailed).toHaveBeenCalled();
    expect(job.visitState).toBe('scheduled');
  });

  it('does not guess when Stripe fails in a way that could have taken the money: the visit stays booked', async () => {
    const job = visit();
    stripeService.confirmOffSession.mockRejectedValue(new Error('timeout'));
    const counts = await charging.runChargeSweep(now);
    expect(counts.pending).toBe(1);
    expect(job).toMatchObject({ paymentStatus: 'BOOKED', stripePaymentIntentId: 'pi_1' });
    expect(stripeService.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(notifications.visitSkipped).not.toHaveBeenCalled();
  });

  it('lets the next sweep retry if the intent could not even be created', async () => {
    const job = visit();
    stripeService.createPaymentIntent.mockRejectedValueOnce(new Error('network'));
    await charging.runChargeSweep(now);
    expect(job).toMatchObject({ chargeAttempts: 0, visitState: 'scheduled' });
    expect((await charging.runChargeSweep(now)).paid).toBe(1);
  });
});

describe('agreement to recurring charges', () => {
  it('does not charge a card that was saved under older wording', async () => {
    const job = visit();
    mockStore.users.cust1 = { stripeCustomerId: 'cus_1', savedCard: { paymentMethodId: 'pm_1', consentVersion: 'card-v1' } };
    const counts = await charging.runChargeSweep(now);
    expect(counts.retry).toBe(1);
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
    expect(notifications.visitPaymentFailed).toHaveBeenCalled();
    expect(job.visitState).toBe('scheduled');
  });
});

describe('visits the sweep does not charge', () => {
  it('leaves visits of a paused series alone', async () => {
    mockStore.series.series1.status = 'paused';
    const job = visit();
    const counts = await charging.runChargeSweep(now);
    expect(counts.waiting).toBe(1);
    expect(job.visitState).toBe('scheduled');
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('drops visits of a cancelled or ended series', async () => {
    mockStore.series.series1.status = 'cancelled';
    const job = visit();
    await charging.runChargeSweep(now);
    expect(job).toMatchObject({ visitState: 'skipped', skipReason: 'series_ended' });
  });

  it('marks a visit whose time has passed uncharged as never happened', async () => {
    const job = visit({ preferredStartAt: inHours(-2) });
    await charging.runChargeSweep(now);
    expect(job).toMatchObject({ visitState: 'skipped', skipReason: 'missed' });
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('one failing visit does not stop the rest', async () => {
    const bad = visit({ visitNumber: 2 });
    visit({ visitNumber: 3, preferredStartAt: inHours(46) });
    stripeService.createPaymentIntent.mockRejectedValueOnce(new Error('boom'));
    const counts = await charging.runChargeSweep(now);
    expect(counts.paid).toBe(1);
    expect(bad.visitState).toBe('scheduled');
  });
});
