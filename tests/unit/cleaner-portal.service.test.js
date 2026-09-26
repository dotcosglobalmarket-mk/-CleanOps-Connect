jest.mock('../../src/models/CleanerProfile', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), findById: jest.fn() }));
jest.mock('../../src/models/JobOffer', () => ({ find: jest.fn() }));
jest.mock('../../src/models/Job', () => ({ find: jest.fn() }));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/stripe.service');
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/notification.service');

const CleanerProfile = require('../../src/models/CleanerProfile');
const JobOffer = require('../../src/models/JobOffer');
const Job = require('../../src/models/Job');
const User = require('../../src/models/User');
const stripeService = require('../../src/services/stripe.service');
const paymentService = require('../../src/services/payment.service');
const portal = require('../../src/services/cleaner-portal.service');

function chainable(finalValue) {
  const obj = {};
  ['populate', 'sort', 'limit', 'select'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.then = (resolve, reject) => Promise.resolve(finalValue).then(resolve, reject);
  return obj;
}

const profile = (overrides = {}) => ({
  _id: 'profile1',
  lat: 53.8,
  lng: -1.55,
  commissionTierRate: 0.15,
  payoutsEnabled: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://www.cleanop-connect.co.uk/';
});

describe('payout onboarding (Stripe Connect Express)', () => {
  it('creates an Express account once, then returns a hosted onboarding link', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    User.findById.mockResolvedValue({ email: 'sam@example.com' });
    stripeService.createExpressAccount.mockResolvedValue({ id: 'acct_123' });
    CleanerProfile.findOneAndUpdate.mockResolvedValue(profile({ stripeConnectedAccountId: 'acct_123' }));
    stripeService.createAccountOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/abc' });

    const result = await portal.startPayoutOnboarding('user1');

    expect(stripeService.createExpressAccount).toHaveBeenCalledWith({ email: 'sam@example.com', cleanerProfileId: 'profile1' });
    expect(stripeService.createAccountOnboardingLink).toHaveBeenCalledWith({
      accountId: 'acct_123',
      refreshUrl: 'https://www.cleanop-connect.co.uk/cleaner.html?payouts=refresh',
      returnUrl: 'https://www.cleanop-connect.co.uk/cleaner.html?payouts=return',
    });
    expect(result.url).toBe('https://connect.stripe.com/setup/e/abc');
  });

  it('reuses an existing connected account', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile({ stripeConnectedAccountId: 'acct_existing' }));
    stripeService.createAccountOnboardingLink.mockResolvedValue({ url: 'https://connect.stripe.com/x' });

    await portal.startPayoutOnboarding('user1');

    expect(stripeService.createExpressAccount).not.toHaveBeenCalled();
    expect(stripeService.createAccountOnboardingLink).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct_existing' }));
  });

  it('fails clearly when FRONTEND_URL is not configured', async () => {
    delete process.env.FRONTEND_URL;
    CleanerProfile.findOne.mockResolvedValue(profile({ stripeConnectedAccountId: 'acct_existing' }));
    await expect(portal.startPayoutOnboarding('user1')).rejects.toMatchObject({ status: 500 });
  });

  it('syncs payoutsEnabled from Stripe when the cleaner returns, releasing blocked payouts', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile({ stripeConnectedAccountId: 'acct_1', payoutsEnabled: false }));
    stripeService.retrieveAccount.mockResolvedValue({ payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } });

    const status = await portal.getPayoutStatus('user1');

    expect(status).toMatchObject({ connected: true, detailsSubmitted: true, payoutsEnabled: true });
    expect(paymentService.handleAccountUpdated).toHaveBeenCalledWith('acct_1', true);
  });

  it('reports not connected before onboarding starts', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    await expect(portal.getPayoutStatus('user1')).resolves.toEqual({
      connected: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
    });
    expect(stripeService.retrieveAccount).not.toHaveBeenCalled();
  });
});

describe('offers inbox', () => {
  it('shows only the outward postcode and the distance before the cleaner accepts', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    JobOffer.find.mockReturnValue(
      chainable([
        {
          _id: 'offer1',
          status: 'sent',
          score: 80,
          job: { _id: 'job1', postcode: 'LS12 1AB', lat: 53.79, lng: -1.59, budgetMin: 50, budgetMax: 90, serviceType: { name: 'Deep clean' } },
        },
      ])
    );

    const [offer] = await portal.listMyOffers('user1', { status: 'sent' });

    expect(JobOffer.find).toHaveBeenCalledWith({ cleaner: 'profile1', status: 'sent' });
    expect(offer.job.area).toBe('LS12');
    expect(offer.job.postcode).toBeUndefined();
    expect(offer.distanceKm).toBeGreaterThan(0);
  });

  it('returns 404 when the cleaner has no profile', async () => {
    CleanerProfile.findOne.mockResolvedValue(null);
    await expect(portal.listMyOffers('user1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('earnings', () => {
  it('splits paid out, on the way and held in escrow', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile({ payoutsEnabled: true }));
    Job.find.mockReturnValue(
      chainable([
        { paymentStatus: 'PAID_OUT', pricePence: 10000, cleanerPayoutPence: 8500 },
        { paymentStatus: 'PAYOUT_BLOCKED', pricePence: 5000, cleanerPayoutPence: 4250 },
        { paymentStatus: 'PAID_HELD', pricePence: 2000 },
      ])
    );

    const earnings = await portal.getEarnings('user1');

    expect(earnings).toMatchObject({ paidOutPence: 8500, onTheWayPence: 4250, inEscrowPence: 1700, payoutsEnabled: true });
  });
});
