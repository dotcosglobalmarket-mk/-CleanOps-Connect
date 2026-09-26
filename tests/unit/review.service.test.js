jest.mock('../../src/models/Review', () => ({
  create: jest.fn(),
  aggregate: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../src/models/Job', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ updateOne: jest.fn() }));
jest.mock('../../src/services/audit.service');

const Review = require('../../src/models/Review');
const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const auditService = require('../../src/services/audit.service');
const reviewService = require('../../src/services/review.service');

const CLEANER_ID = '64b0000000000000000000c1';
const customer = { id: 'cust1', role: 'customer' };

function completedJob(overrides = {}) {
  return {
    _id: 'job1',
    customer: { toString: () => 'cust1' },
    cleaner: CLEANER_ID,
    awaitingConfirmationAt: new Date(),
    paymentStatus: 'PAID_OUT',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Review.aggregate.mockResolvedValue([{ average: 4.25, count: 4 }]);
});

describe('createReview', () => {
  it('lets the customer review a completed job and updates the cleaner rating', async () => {
    Job.findById.mockResolvedValue(completedJob());
    Review.create.mockResolvedValue({ _id: 'r1', rating: 5 });

    await reviewService.createReview('job1', { rating: 5, comment: 'Spotless' }, customer);

    expect(Review.create).toHaveBeenCalledWith({ job: 'job1', customer: 'cust1', cleaner: CLEANER_ID, rating: 5, comment: 'Spotless' });
    expect(CleanerProfile.updateOne).toHaveBeenCalledWith({ _id: CLEANER_ID }, { $set: { ratingAverage: 4.3, ratingCount: 4 } });
  });

  it("refuses another customer's job", async () => {
    Job.findById.mockResolvedValue(completedJob({ customer: { toString: () => 'someone-else' } }));
    await expect(reviewService.createReview('job1', { rating: 1 }, customer)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a job that has not been completed', async () => {
    Job.findById.mockResolvedValue(completedJob({ awaitingConfirmationAt: undefined, paymentStatus: 'PAID_HELD' }));
    await expect(reviewService.createReview('job1', { rating: 4 }, customer)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses while the job is still awaiting confirmation or disputed', async () => {
    for (const paymentStatus of ['AWAITING_CONFIRMATION', 'DISPUTED']) {
      Job.findById.mockResolvedValue(completedJob({ paymentStatus }));
      await expect(reviewService.createReview('job1', { rating: 4 }, customer)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('returns 409 for a second review of the same job', async () => {
    Job.findById.mockResolvedValue(completedJob());
    const duplicate = new Error('E11000');
    duplicate.code = 11000;
    Review.create.mockRejectedValue(duplicate);
    await expect(reviewService.createReview('job1', { rating: 4 }, customer)).rejects.toMatchObject({ status: 409 });
  });
});

describe('moderation', () => {
  it('hides a review with an audited reason and recalculates the rating', async () => {
    const review = { _id: 'r1', status: 'published', cleaner: CLEANER_ID, save: jest.fn().mockResolvedValue(undefined) };
    Review.findById.mockResolvedValue(review);
    const req = { user: { id: 'op1', role: 'operator' } };

    await reviewService.setVisibility('r1', { hidden: true, reason: 'Contains a phone number' }, req);

    expect(review.status).toBe('hidden');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'review.hide', targetType: 'review', reason: 'Contains a phone number' })
    );
    expect(CleanerProfile.updateOne).toHaveBeenCalled();
  });
});

describe('displayName', () => {
  it('shows first name and last initial only', () => {
    expect(reviewService.displayName('Rachel Anne Hughes')).toBe('Rachel H.');
    expect(reviewService.displayName('Rachel')).toBe('Rachel');
    expect(reviewService.displayName('')).toBe('Verified customer');
  });
});
