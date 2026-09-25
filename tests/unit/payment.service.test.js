jest.mock('../../src/models/Job');
jest.mock('../../src/models/CleanerProfile');
jest.mock('../../src/services/stripe.service');

const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const stripeService = require('../../src/services/stripe.service');
const paymentService = require('../../src/services/payment.service');
const { STATES } = require('../../src/services/payment-state-machine');

function makeJob(overrides = {}) {
  return {
    _id: 'job1',
    cleaner: 'cleaner1',
    pricePence: 10000,
    payoutAttemptCount: 0,
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeCleaner(overrides = {}) {
  return {
    _id: 'cleaner1',
    stripeConnectedAccountId: 'acct_1',
    payoutsEnabled: true,
    commissionTierRate: 0.15,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handlePaymentSucceeded — duplicate webhook does not double-process', () => {
  it('processes the first delivery and transitions BOOKED -> PAID_HELD', async () => {
    const job = makeJob({ paymentStatus: STATES.BOOKED, stripePaymentIntentId: 'pi_1' });
    Job.findOne.mockResolvedValue(job);

    const result = await paymentService.handlePaymentSucceeded('pi_1', 10000);

    expect(result.paymentStatus).toBe(STATES.PAID_HELD);
    expect(job.save).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on a duplicate delivery once the job has already moved past BOOKED', async () => {
    const job = makeJob({ paymentStatus: STATES.PAID_HELD, stripePaymentIntentId: 'pi_1' });
    Job.findOne.mockResolvedValue(job);

    const result = await paymentService.handlePaymentSucceeded('pi_1', 10000);

    expect(result.paymentStatus).toBe(STATES.PAID_HELD);
    expect(job.save).not.toHaveBeenCalled();
  });
});

describe('transfer retry — idempotency key reuse and never double-paying a cleaner', () => {
  it('reuses the same idempotency key (derived from job id) across retry attempts', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500 });
    const cleaner = makeCleaner();
    stripeService.createTransfer
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({ id: 'tr_1' });

    await paymentService.attemptTransfer(job, cleaner); // fails -> TRANSFER_FAILED
    expect(job.paymentStatus).toBe(STATES.TRANSFER_FAILED);

    await paymentService.attemptTransfer(job, cleaner); // retry succeeds

    expect(stripeService.createTransfer).toHaveBeenCalledTimes(2);
    const firstKey = stripeService.createTransfer.mock.calls[0][0].idempotencyKey;
    const secondKey = stripeService.createTransfer.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(`transfer:${job._id}`);
    expect(secondKey).toBe(firstKey);
  });

  it('escalates to MANUAL_REVIEW_HOLD after 3 failed attempts and stops retrying', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500 });
    const cleaner = makeCleaner();
    stripeService.createTransfer.mockRejectedValue(new Error('stripe down'));

    await paymentService.attemptTransfer(job, cleaner); // attempt 1 -> TRANSFER_FAILED
    await paymentService.attemptTransfer(job, cleaner); // attempt 2 -> TRANSFER_FAILED
    await paymentService.attemptTransfer(job, cleaner); // attempt 3 -> TRANSFER_FAILED
    await paymentService.attemptTransfer(job, cleaner); // attempt 4 -> exceeds cap

    expect(job.paymentStatus).toBe(STATES.MANUAL_REVIEW_HOLD);
    expect(stripeService.createTransfer).toHaveBeenCalledTimes(4);
  });
});

describe('transfer is never attempted when payoutsEnabled is false', () => {
  it('routes straight to PAYOUT_BLOCKED without calling Stripe', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500 });
    const cleaner = makeCleaner({ payoutsEnabled: false });

    await paymentService.attemptTransfer(job, cleaner);

    expect(job.paymentStatus).toBe(STATES.PAYOUT_BLOCKED);
    expect(stripeService.createTransfer).not.toHaveBeenCalled();
  });

  it('resolveDisputePartial refuses to run when the cleaner has not completed payouts onboarding', async () => {
    const job = makeJob({ paymentStatus: STATES.DISPUTED, pricePence: 10000, stripePaymentIntentId: 'pi_1' });
    Job.findById.mockResolvedValue(job);
    CleanerProfile.findById.mockResolvedValue(makeCleaner({ payoutsEnabled: false }));

    await expect(
      paymentService.resolveDisputePartial('job1', { refundPence: 5000, payoutPence: 5000 })
    ).rejects.toMatchObject({ status: 400 });

    expect(stripeService.createTransfer).not.toHaveBeenCalled();
  });
});

describe('commission calculation reads the cleaner tier at confirmation time, not booking time', () => {
  it('uses the cleaner tier rate current at enterPayoutPending, ignoring any booking-time value', async () => {
    const job = makeJob({
      paymentStatus: STATES.AWAITING_CONFIRMATION,
      pricePence: 10000,
      commissionRate: 0.15, // a stale value as if it had been cached at booking
    });
    Job.findById.mockResolvedValue(job);
    const cleaner = makeCleaner({ commissionTierRate: 0.10 }); // tier changed since booking
    CleanerProfile.findById.mockResolvedValue(cleaner);
    stripeService.createTransfer.mockResolvedValue({ id: 'tr_1' });

    await paymentService.confirmJob('job1');

    expect(job.commissionRate).toBe(0.10);
    expect(job.commissionPence).toBe(1000);
    expect(job.cleanerPayoutPence).toBe(9000);
  });
});

describe('TRANSFER_FAILED never triggers a customer refund', () => {
  it('handleTransferError only mutates payout fields, never calls Stripe refund', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, cleanerPayoutPence: 8500 });
    const cleaner = makeCleaner();
    stripeService.createTransfer.mockRejectedValue(new Error('stripe down'));

    await paymentService.attemptTransfer(job, cleaner);

    expect(job.paymentStatus).toBe(STATES.TRANSFER_FAILED);
    expect(stripeService.createRefund).not.toHaveBeenCalled();
  });

  it('handleTransferFailedWebhook does not issue a refund either', async () => {
    const job = makeJob({ paymentStatus: STATES.PAYOUT_PENDING, stripeTransferId: 'tr_1' });
    Job.findOne.mockResolvedValue(job);

    await paymentService.handleTransferFailedWebhook('tr_1');

    expect(stripeService.createRefund).not.toHaveBeenCalled();
  });
});

describe('deductive commission model', () => {
  it('commission is subtracted from the cleaner payout, never added to the customer charge', async () => {
    const job = makeJob({ pricePence: 20000 });
    const cleaner = makeCleaner({ commissionTierRate: 0.15 });

    const { rate, commissionPence, cleanerPayoutPence } = await paymentService.calculateSplit(job, cleaner);

    expect(rate).toBe(0.15);
    expect(commissionPence).toBe(3000);
    expect(cleanerPayoutPence).toBe(17000);
    expect(commissionPence + cleanerPayoutPence).toBe(job.pricePence);
  });
});

describe('payout.failed webhook', () => {
  it('disables payouts on the cleaner and never touches a Job', async () => {
    const cleaner = makeCleaner();
    CleanerProfile.findOne.mockResolvedValue(cleaner);

    await paymentService.handlePayoutFailed('acct_1');

    expect(cleaner.payoutsEnabled).toBe(false);
    expect(cleaner.save).toHaveBeenCalledTimes(1);
    expect(Job.findOne).not.toHaveBeenCalled();
  });
});

describe('account.updated recheck', () => {
  it('re-attempts a blocked payout once payoutsEnabled flips true', async () => {
    const cleaner = makeCleaner({ payoutsEnabled: false });
    CleanerProfile.findOne.mockResolvedValue(cleaner);
    const blockedJob = makeJob({ paymentStatus: STATES.PAYOUT_BLOCKED, cleanerPayoutPence: 8500 });
    Job.find.mockResolvedValue([blockedJob]);
    stripeService.createTransfer.mockResolvedValue({ id: 'tr_1' });

    await paymentService.handleAccountUpdated('acct_1', true);

    expect(cleaner.payoutsEnabled).toBe(true);
    expect(blockedJob.paymentStatus).toBe(STATES.PAYOUT_PENDING);
    expect(stripeService.createTransfer).toHaveBeenCalledTimes(1);
  });
});

describe('bookJob — state is checked before any Stripe call', () => {
  it('does not create a PaymentIntent for a job that is already booked', async () => {
    Job.findById.mockResolvedValue(makeJob({ paymentStatus: STATES.BOOKED }));

    await expect(
      paymentService.bookJob({ jobId: 'job1', cleanerId: 'cleaner1', pricePence: 5000 })
    ).rejects.toMatchObject({ status: 400 });

    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('does not book a suspended cleaner', async () => {
    Job.findById.mockResolvedValue(makeJob({ cleaner: null, paymentStatus: undefined }));
    CleanerProfile.findById.mockResolvedValue(makeCleaner({ deactivationStatus: 'suspended' }));

    await expect(
      paymentService.bookJob({ jobId: 'job1', cleanerId: 'cleaner1', pricePence: 5000 })
    ).rejects.toMatchObject({ status: 400 });

    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('records bookedAt when the job is booked', async () => {
    const job = makeJob({ cleaner: null, paymentStatus: undefined });
    Job.findById.mockResolvedValue(job);
    CleanerProfile.findById.mockResolvedValue(makeCleaner());
    stripeService.createPaymentIntent.mockResolvedValue({ id: 'pi_new' });

    await paymentService.bookJob({ jobId: 'job1', cleanerId: 'cleaner1', pricePence: 5000 });

    expect(job.paymentStatus).toBe(STATES.BOOKED);
    expect(job.bookedAt).toBeInstanceOf(Date);
  });
});

describe('cancelByCustomer — refund window runs from booking, not from posting', () => {
  it('gives a full refund when booked recently even if the job was posted long ago', async () => {
    const job = makeJob({
      paymentStatus: STATES.PAID_HELD,
      stripePaymentIntentId: 'pi_1',
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      bookedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    Job.findById.mockResolvedValue(job);

    await paymentService.cancelByCustomer('job1');

    expect(stripeService.createRefund).toHaveBeenCalledWith(
      expect.not.objectContaining({ amountPence: expect.anything() })
    );
    expect(job.paymentStatus).toBe(STATES.REFUNDED);
  });

  it('gives a 50% refund when cancelled more than 24 hours after booking', async () => {
    const job = makeJob({
      paymentStatus: STATES.PAID_HELD,
      stripePaymentIntentId: 'pi_1',
      pricePence: 10000,
      bookedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    Job.findById.mockResolvedValue(job);

    await paymentService.cancelByCustomer('job1');

    expect(stripeService.createRefund).toHaveBeenCalledWith(expect.objectContaining({ amountPence: 5000 }));
    expect(job.paymentStatus).toBe(STATES.PARTIALLY_REFUNDED);
  });
});

describe('resolveDisputePartial — only runs on a disputed job', () => {
  it('refuses to refund or transfer when the job is not DISPUTED', async () => {
    Job.findById.mockResolvedValue(makeJob({ paymentStatus: STATES.PAID_OUT, pricePence: 10000 }));
    CleanerProfile.findById.mockResolvedValue(makeCleaner());

    await expect(
      paymentService.resolveDisputePartial('job1', { refundPence: 5000, payoutPence: 5000 })
    ).rejects.toMatchObject({ status: 400 });

    expect(stripeService.createRefund).not.toHaveBeenCalled();
    expect(stripeService.createTransfer).not.toHaveBeenCalled();
  });
});
