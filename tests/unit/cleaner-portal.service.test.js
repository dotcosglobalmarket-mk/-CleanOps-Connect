jest.mock('../../src/services/subscription.service', () => ({ requireActiveSubscription: jest.fn().mockResolvedValue(undefined) }));
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

  it('shows a tender\'s closing time and requirements, and the cleaner\'s own quote only', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    const closesAt = new Date('2026-11-01T12:00:00Z');
    JobOffer.find.mockReturnValue(
      chainable([
        {
          _id: 'offer2',
          status: 'quoted',
          quotePricePence: 125000,
          quoteMessage: 'Can start Monday',
          quotedAt: new Date('2026-10-26T10:00:00Z'),
          job: {
            _id: 'job2',
            postcode: 'LS12 1AB',
            lat: 53.79,
            lng: -1.59,
            procurement: 'tender',
            tender: { closesAt, requirements: 'Warehouse, 2 floors' },
            serviceType: { name: 'Industrial Deep Clean' },
          },
        },
      ])
    );

    const [offer] = await portal.listMyOffers('user1');

    expect(offer.job.procurement).toBe('tender');
    expect(offer.job.tender).toEqual({ closesAt, requirements: 'Warehouse, 2 floors' });
    expect(offer.quote).toMatchObject({ pricePence: 125000, message: 'Can start Monday' });
    expect(offer.job.area).toBe('LS12');
    expect(offer.job.postcode).toBeUndefined();
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

describe('offers need a paid-up subscription', () => {
  it('lists nothing and says why when the platform fee is not being paid', async () => {
    const subscriptionService = require('../../src/services/subscription.service');
    CleanerProfile.findOne.mockResolvedValue(profile());
    subscriptionService.requireActiveSubscription.mockRejectedValueOnce(Object.assign(new Error('pay'), { status: 402 }));
    await expect(portal.listMyOffers('user1')).rejects.toMatchObject({ status: 402 });
    expect(JobOffer.find).not.toHaveBeenCalled();
  });
});

describe('recurring bookings in the cleaner’s views', () => {
  const offerFor = (jobOverrides) =>
    chainable([
      {
        _id: 'offerR',
        status: 'sent',
        job: {
          _id: 'jobR',
          postcode: 'LS12 1AB',
          lat: 53.79,
          lng: -1.59,
          category: 'domestic',
          frequency: 'weekly',
          preferredStartAt: new Date('2026-02-03T10:00:00Z'),
          budgetMin: 20,
          budgetMax: 30,
          serviceType: { name: 'Regular clean' },
          ...jobOverrides,
        },
      },
    ]);

  afterEach(() => {
    delete process.env.RECURRING_JOBS_ENABLED;
  });

  it('tells the cleaner the frequency, end date and number of visits before they accept', async () => {
    process.env.RECURRING_JOBS_ENABLED = 'true';
    CleanerProfile.findOne.mockResolvedValue(profile());
    JobOffer.find.mockReturnValue(offerFor({}));
    const [offer] = await portal.listMyOffers('user1');
    expect(offer.job.recurring).toMatchObject({ frequency: 'weekly', visits: 26 });
    expect(offer.job.recurring.endsOn).toBeInstanceOf(Date);
  });

  it('says nothing about a series while recurring bookings are off, or for a one-off', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    JobOffer.find.mockReturnValue(offerFor({}));
    expect((await portal.listMyOffers('user1'))[0].job.recurring).toBeUndefined();

    process.env.RECURRING_JOBS_ENABLED = 'true';
    JobOffer.find.mockReturnValue(offerFor({ frequency: 'one_off' }));
    expect((await portal.listMyOffers('user1'))[0].job.recurring).toBeUndefined();
  });

  it('keeps visits made ahead out of My Jobs until they are charged', async () => {
    CleanerProfile.findOne.mockResolvedValue(profile());
    Job.find.mockReturnValue(chainable([]));
    await portal.listMyJobs('user1');
    expect(Job.find).toHaveBeenCalledWith({ cleaner: 'profile1', visitState: { $nin: ['scheduled', 'skipped'] } });
  });
});
