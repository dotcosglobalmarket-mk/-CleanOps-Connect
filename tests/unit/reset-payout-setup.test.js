jest.mock('../../src/models/Job', () => ({ countDocuments: jest.fn() }));
jest.mock('../../src/models/CleanerProfile', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/ApprovalRequest', () => ({}));
jest.mock('../../src/models/JobNote', () => ({}));
jest.mock('../../src/services/admin.service', () => ({}));
jest.mock('../../src/services/audit.service', () => ({ record: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/services/payment.service', () => ({}));
jest.mock('../../src/services/notification.service', () => ({}));
jest.mock('../../src/services/chat.service', () => ({}));

const Job = require('../../src/models/Job');
const CleanerProfile = require('../../src/models/CleanerProfile');
const auditService = require('../../src/services/audit.service');
const ops = require('../../src/services/ops.service');

const req = { user: { id: 'admin1', role: 'admin' } };
const cleaner = (o = {}) => ({
  _id: 'c1',
  stripeConnectedAccountId: 'acct_old',
  payoutsEnabled: true,
  save: jest.fn().mockResolvedValue(undefined),
  ...o,
});

beforeEach(() => jest.clearAllMocks());

describe('resetting a cleaner’s payout set-up', () => {
  it('forgets the stored account, audits it with the old id, and lets them start again', async () => {
    const c = cleaner();
    CleanerProfile.findById.mockResolvedValue(c);
    Job.countDocuments.mockResolvedValue(0);

    await ops.resetCleanerPayoutSetup('c1', 'Created in test mode', req);

    expect(c.stripeConnectedAccountId).toBeUndefined();
    expect(c.payoutsEnabled).toBe(false);
    expect(c.save).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cleaner.payouts_reset',
        targetType: 'cleaner',
        before: { stripeConnectedAccountId: 'acct_old', payoutsEnabled: true },
        reason: 'Created in test mode',
      })
    );
  });

  it('refuses while the cleaner is still owed money, so it is not orphaned', async () => {
    const c = cleaner();
    CleanerProfile.findById.mockResolvedValue(c);
    Job.countDocuments.mockResolvedValue(2);

    await expect(ops.resetCleanerPayoutSetup('c1', 'Because', req)).rejects.toMatchObject({ status: 409 });
    expect(c.save).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('refuses when there is nothing to reset', async () => {
    CleanerProfile.findById.mockResolvedValue(cleaner({ stripeConnectedAccountId: undefined }));
    await expect(ops.resetCleanerPayoutSetup('c1', 'Because', req)).rejects.toMatchObject({ status: 400 });
  });

  it('404s for an unknown cleaner', async () => {
    CleanerProfile.findById.mockResolvedValue(null);
    await expect(ops.resetCleanerPayoutSetup('nope', 'Because', req)).rejects.toMatchObject({ status: 404 });
  });
});
