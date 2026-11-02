jest.mock('../../src/models/Job', () => ({ findById: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/models/Series', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn() }));
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/visit-charging.service');
jest.mock('../../src/services/notification.service');

const Job = require('../../src/models/Job');
const Series = require('../../src/models/Series');
const User = require('../../src/models/User');
const CleanerProfile = require('../../src/models/CleanerProfile');
const paymentService = require('../../src/services/payment.service');
const charging = require('../../src/services/visit-charging.service');
const notifications = require('../../src/services/notification.service');
const rules = require('../../src/services/series-rules.service');

const series = (o = {}) => ({
  _id: 's1',
  customer: 'cust1',
  cleaner: 'cleaner1',
  status: 'active',
  endsOn: new Date('2026-08-01T00:00:00Z'),
  save: jest.fn(async function s() { return this; }),
  ...o,
});
const visit = (o = {}) => ({ _id: 'j2', series: 's1', visitNumber: 2, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  Series.findById.mockResolvedValue(series());
  CleanerProfile.findOne.mockResolvedValue({ _id: 'cleaner1' });
});

describe('a customer skipping a visit', () => {
  it('is free before it is charged: the visit is skipped and the cleaner told', async () => {
    Job.findById.mockResolvedValue(visit({ visitState: 'scheduled' }));
    charging.skipScheduledVisit.mockResolvedValue({ _id: 'j2' });
    await rules.skipVisit('s1', 'j2', 'cust1');
    expect(charging.skipScheduledVisit).toHaveBeenCalledWith('j2', 'customer');
    expect(notifications.visitSkipped).toHaveBeenCalledWith({ _id: 'j2' }, { reason: 'customer' });
    expect(paymentService.cancelByCustomer).not.toHaveBeenCalled();
  });

  it('once paid, uses the late-cancellation rule (the half-back refund)', async () => {
    Job.findById.mockResolvedValue(visit({ paymentStatus: 'PAID_HELD' }));
    await rules.skipVisit('s1', 'j2', 'cust1');
    expect(paymentService.cancelByCustomer).toHaveBeenCalledWith('j2');
  });

  it('cancels a charge still waiting for payment', async () => {
    Job.findById.mockResolvedValue(visit({ paymentStatus: 'BOOKED' }));
    await rules.skipVisit('s1', 'j2', 'cust1');
    expect(paymentService.cancelBooked).toHaveBeenCalledWith('j2');
  });

  it('says so if the visit was charged a moment ago', async () => {
    Job.findById.mockResolvedValue(visit({ visitState: 'scheduled' }));
    charging.skipScheduledVisit.mockResolvedValue(null);
    await expect(rules.skipVisit('s1', 'j2', 'cust1')).rejects.toMatchObject({ status: 409 });
  });

  it('sends the first visit to the ordinary job cancellation', async () => {
    Job.findById.mockResolvedValue(visit({ visitNumber: 1, paymentStatus: 'PAID_HELD' }));
    await expect(rules.skipVisit('s1', 'j2', 'cust1')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a visit that has started or finished', async () => {
    Job.findById.mockResolvedValue(visit({ paymentStatus: 'IN_PROGRESS' }));
    await expect(rules.skipVisit('s1', 'j2', 'cust1')).rejects.toMatchObject({ status: 400 });
  });

  it("refuses someone else's series, and a visit from another series", async () => {
    await expect(rules.skipVisit('s1', 'j2', 'someone-else')).rejects.toMatchObject({ status: 403 });
    Job.findById.mockResolvedValue(visit({ series: 'other' }));
    await expect(rules.skipVisit('s1', 'j2', 'cust1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('a customer pausing, resuming and cancelling', () => {
  it('pauses a running series, and only a running one', async () => {
    const s = series();
    Series.findById.mockResolvedValue(s);
    await rules.pause('s1', 'cust1');
    expect(s).toMatchObject({ status: 'paused', pausedBy: 'customer' });
    expect(notifications.seriesPausedByCustomer).toHaveBeenCalledWith(s, { resumed: false });

    Series.findById.mockResolvedValue(series({ status: 'cancelled' }));
    await expect(rules.pause('s1', 'cust1')).rejects.toMatchObject({ status: 400 });
  });

  it('resumes only with a saved card, and starts the failure counts afresh', async () => {
    const s = series({ status: 'paused', paymentFailureStreak: 2, cleanerCancellations: 2, pausedBy: 'payment' });
    Series.findById.mockResolvedValue(s);
    User.findById.mockResolvedValue({});
    await expect(rules.resume('s1', 'cust1')).rejects.toMatchObject({ status: 400 });
    User.findById.mockResolvedValue({ savedCard: { paymentMethodId: 'pm_1', consentVersion: 'card-v1' } });
    await expect(rules.resume('s1', 'cust1')).rejects.toMatchObject({ status: 400 });

    User.findById.mockResolvedValue({ savedCard: { paymentMethodId: 'pm_1', consentVersion: 'card-v2' } });
    await rules.resume('s1', 'cust1');
    expect(s).toMatchObject({ status: 'active', paymentFailureStreak: 0, cleanerCancellations: 0 });
    expect(notifications.seriesPausedByCustomer).toHaveBeenCalledWith(s, { resumed: true });
    expect(s.pausedBy).toBeUndefined();
  });

  it('cancelling drops visits not yet charged, keeps paid ones, and tells the cleaner', async () => {
    const s = series();
    Series.findById.mockResolvedValue(s);
    await rules.cancel('s1', 'cust1');
    expect(s.status).toBe('cancelled');
    expect(Job.updateMany).toHaveBeenCalledWith(
      { series: 's1', visitState: 'scheduled' },
      { $set: { visitState: 'skipped', status: 'cancelled', skipReason: 'series_ended' } }
    );
    expect(notifications.seriesCancelledByCustomer).toHaveBeenCalledWith(s);
  });

  it('cannot cancel a series that has already ended', async () => {
    Series.findById.mockResolvedValue(series({ status: 'ended' }));
    await expect(rules.cancel('s1', 'cust1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('a cleaner cancelling a visit', () => {
  const afterCancel = (n, status = 'active') => {
    const updated = series({ cleanerCancellations: n, status });
    Series.findOneAndUpdate.mockResolvedValue(updated);
    return updated;
  };

  it('first one: refunds in full if it was paid, logs it, and does not pause the series', async () => {
    Job.findById.mockResolvedValue(visit({ paymentStatus: 'PAID_HELD' }));
    const updated = afterCancel(1);
    await rules.cleanerCancelVisit('s1', 'j2', 'cleaner-user');
    expect(paymentService.cancelByCleaner).toHaveBeenCalledWith('j2');
    expect(Series.findOneAndUpdate).toHaveBeenCalledWith({ _id: 's1' }, { $inc: { cleanerCancellations: 1 } }, { new: true });
    expect(updated.status).toBe('active');
    expect(notifications.seriesPaused).not.toHaveBeenCalled();
  });

  it('a visit not yet charged is skipped, so nothing needs refunding', async () => {
    Job.findById.mockResolvedValue(visit({ visitState: 'scheduled' }));
    charging.skipScheduledVisit.mockResolvedValue({ _id: 'j2' });
    afterCancel(1);
    await rules.cleanerCancelVisit('s1', 'j2', 'cleaner-user');
    expect(charging.skipScheduledVisit).toHaveBeenCalledWith('j2', 'cleaner');
    expect(notifications.visitSkipped).toHaveBeenCalledWith({ _id: 'j2' }, { reason: 'cleaner' });
    expect(paymentService.cancelByCleaner).not.toHaveBeenCalled();
  });

  it('second one pauses the series and tells the customer', async () => {
    Job.findById.mockResolvedValue(visit({ paymentStatus: 'PAID_HELD' }));
    const updated = afterCancel(2);
    await rules.cleanerCancelVisit('s1', 'j2', 'cleaner-user');
    expect(updated).toMatchObject({ status: 'paused', pausedBy: 'cleaner_cancellations' });
    expect(notifications.seriesPaused).toHaveBeenCalledWith(updated, { reason: 'cleaner_cancellations' });
  });

  it("only the series' own cleaner may do it", async () => {
    CleanerProfile.findOne.mockResolvedValue({ _id: 'another-cleaner' });
    await expect(rules.cleanerCancelVisit('s1', 'j2', 'u')).rejects.toMatchObject({ status: 403 });
    expect(paymentService.cancelByCleaner).not.toHaveBeenCalled();
  });
});

describe('a cleaner ending the series', () => {
  const now = new Date('2026-03-01T09:00:00Z');

  it('needs 14 days’ notice: the series ends then, later visits are dropped, the customer is told', async () => {
    const s = series();
    Series.findById.mockResolvedValue(s);
    await rules.cleanerEnd('s1', 'cleaner-user', now);
    const expected = new Date('2026-03-15T09:00:00Z');
    expect(s.endsOn).toEqual(expected);
    expect(s.endNoticeGivenAt).toEqual(now);
    expect(Job.updateMany).toHaveBeenCalledWith(
      { series: 's1', visitState: 'scheduled', preferredStartAt: { $gt: expected } },
      { $set: { visitState: 'skipped', status: 'cancelled', skipReason: 'series_ended' } }
    );
    expect(notifications.seriesEndNotice).toHaveBeenCalledWith(s, { endsOn: expected });
  });

  it('never extends a series that already ends sooner', async () => {
    const s = series({ endsOn: new Date('2026-03-05T00:00:00Z') });
    Series.findById.mockResolvedValue(s);
    await rules.cleanerEnd('s1', 'cleaner-user', now);
    expect(s.endsOn).toEqual(new Date('2026-03-05T00:00:00Z'));
  });

  it('notice can only be given once, and not on a finished series', async () => {
    Series.findById.mockResolvedValue(series({ endNoticeGivenAt: now }));
    await expect(rules.cleanerEnd('s1', 'cleaner-user', now)).rejects.toMatchObject({ status: 400 });
    Series.findById.mockResolvedValue(series({ status: 'cancelled' }));
    await expect(rules.cleanerEnd('s1', 'cleaner-user', now)).rejects.toMatchObject({ status: 400 });
  });
});
