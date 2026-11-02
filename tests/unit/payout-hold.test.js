jest.mock('../../src/services/notification.service');
jest.mock('../../src/models/Job');
jest.mock('../../src/models/CleanerProfile');
jest.mock('../../src/services/stripe.service');
jest.mock('../../src/services/job-photo.service');

const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const stripeService = require('../../src/services/stripe.service');
const paymentService = require('../../src/services/payment.service');
const { STATES } = require('../../src/services/payment-state-machine');

const DAY = 24 * 60 * 60 * 1000;

const makeJob = (o = {}) => ({
  _id: 'job1',
  cleaner: 'cleaner1',
  pricePence: 10000,
  payoutAttemptCount: 0,
  stripePaymentIntentId: 'pi_1',
  createdAt: new Date(),
  save: jest.fn().mockResolvedValue(undefined),
  ...o,
});
const makeCleaner = () => ({
  _id: 'cleaner1',
  stripeConnectedAccountId: 'acct_1',
  payoutsEnabled: true,
  commissionTierRate: 0.15,
  save: jest.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PAYOUT_HOLD_DAYS;
  CleanerProfile.findById.mockResolvedValue(makeCleaner());
  stripeService.retrievePaymentIntent.mockResolvedValue({ latest_charge: 'ch_1' });
  stripeService.createTransfer.mockResolvedValue({ id: 'tr_1' });
});

describe('payout hold length', () => {
  it('defaults to 3 days, and clamps to 0-7', () => {
    expect(paymentService.payoutHoldDays()).toBe(3);
    process.env.PAYOUT_HOLD_DAYS = '5';
    expect(paymentService.payoutHoldDays()).toBe(5);
    process.env.PAYOUT_HOLD_DAYS = '30';
    expect(paymentService.payoutHoldDays()).toBe(7);
    process.env.PAYOUT_HOLD_DAYS = '0';
    expect(paymentService.payoutHoldDays()).toBe(0);
    process.env.PAYOUT_HOLD_DAYS = 'soon';
    expect(paymentService.payoutHoldDays()).toBe(3);
    process.env.PAYOUT_HOLD_DAYS = '-2';
    expect(paymentService.payoutHoldDays()).toBe(3);
  });
});

describe('confirming a job', () => {
  it('holds the cleaner share for 3 days and does not transfer yet', async () => {
    const job = makeJob({ paymentStatus: STATES.AWAITING_CONFIRMATION });
    Job.findById.mockResolvedValue(job);
    const before = Date.now();

    await paymentService.confirmJob('job1');

    expect(job.paymentStatus).toBe(STATES.PAYOUT_PENDING);
    expect(stripeService.createTransfer).not.toHaveBeenCalled();
    expect(job.payoutReleaseAt.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY);
    expect(job.payoutReleaseAt.getTime()).toBeLessThan(before + 3 * DAY + 60000);
  });

  it('sends straight away, tied to the customer charge, when the hold is 0', async () => {
    process.env.PAYOUT_HOLD_DAYS = '0';
    const job = makeJob({ paymentStatus: STATES.AWAITING_CONFIRMATION });
    Job.findById.mockResolvedValue(job);

    await paymentService.confirmJob('job1');

    expect(stripeService.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountPence: 8500, sourceTransaction: 'ch_1' })
    );
  });
});

describe('releasing held payouts', () => {
  it('sends only jobs whose hold has ended, tied to the charge', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500, payoutReleaseAt: new Date(Date.now() - 1000) });
    Job.find.mockResolvedValue([job]);

    const released = await paymentService.releaseDuePayouts(new Date());

    expect(Job.find).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: STATES.PAYOUT_PENDING, payoutReleaseAt: { $lte: expect.any(Date) } })
    );
    expect(released).toEqual(['job1']);
    expect(stripeService.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ sourceTransaction: 'ch_1' }));
    expect(job.stripeTransferId).toBe('tr_1');
  });

  it('still tries the transfer if the charge cannot be read', async () => {
    stripeService.retrievePaymentIntent.mockRejectedValue(new Error('down'));
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500 });
    await paymentService.attemptTransfer(job, makeCleaner());
    expect(stripeService.createTransfer.mock.calls[0][0].sourceTransaction).toBeUndefined();
  });

  it('ops can release a waiting job early', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500, payoutReleaseAt: new Date(Date.now() + 2 * DAY) });
    Job.findById.mockResolvedValue(job);

    await paymentService.releasePayoutNow('job1');

    expect(stripeService.createTransfer).toHaveBeenCalledTimes(1);
    expect(job.payoutReleaseAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('refuses to release a job that already has a transfer or is not waiting', async () => {
    Job.findById.mockResolvedValue(makeJob({ paymentStatus: STATES.PAYOUT_PENDING, stripeTransferId: 'tr_9' }));
    await expect(paymentService.releasePayoutNow('job1')).rejects.toMatchObject({ status: 400 });
    Job.findById.mockResolvedValue(makeJob({ paymentStatus: STATES.PAID_HELD }));
    await expect(paymentService.releasePayoutNow('job1')).rejects.toMatchObject({ status: 400 });
    expect(stripeService.createTransfer).not.toHaveBeenCalled();
  });
});
