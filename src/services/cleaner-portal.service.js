const CleanerProfile = require('../models/CleanerProfile');
const JobOffer = require('../models/JobOffer');
const Job = require('../models/Job');
const User = require('../models/User');
const stripeService = require('./stripe.service');
const paymentService = require('./payment.service');
const { haversineDistanceKm } = require('./coverage.service');
const { STATES } = require('./payment-state-machine');
const { outwardCode } = require('./cleaner.service');

const LIST_LIMIT = 200;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function requireProfile(userId) {
  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) throw httpError(404, 'Cleaner profile not found — register as a cleaner first');
  return cleaner;
}

function frontendUrl() {
  const url = process.env.FRONTEND_URL;
  if (!url) throw httpError(500, 'FRONTEND_URL is not configured on the server');
  return url.replace(/\/+$/, '');
}

// --- Stripe Connect payout onboarding ---

async function startPayoutOnboarding(userId) {
  const cleaner = await requireProfile(userId);

  let accountId = cleaner.stripeConnectedAccountId;
  if (!accountId) {
    const user = await User.findById(userId);
    const account = await stripeService.createExpressAccount({
      email: user ? user.email : undefined,
      cleanerProfileId: cleaner._id.toString(),
    });
    // Claim atomically: a double click must not leave two accounts.
    const claimed = await CleanerProfile.findOneAndUpdate(
      { _id: cleaner._id, stripeConnectedAccountId: { $in: [null, ''] } },
      { $set: { stripeConnectedAccountId: account.id } },
      { new: true }
    );
    accountId = claimed ? claimed.stripeConnectedAccountId : (await CleanerProfile.findById(cleaner._id)).stripeConnectedAccountId;
  }

  const base = frontendUrl();
  const link = await stripeService.createAccountOnboardingLink({
    accountId,
    refreshUrl: `${base}/cleaner.html?payouts=refresh`,
    returnUrl: `${base}/cleaner.html?payouts=return`,
  });
  return { url: link.url };
}

// Called when the cleaner comes back from Stripe. The account.updated
// webhook does the same thing; this makes the dashboard correct straight
// away even if the webhook is delayed.
async function getPayoutStatus(userId) {
  const cleaner = await requireProfile(userId);
  if (!cleaner.stripeConnectedAccountId) {
    return { connected: false, detailsSubmitted: false, payoutsEnabled: false };
  }

  const account = await stripeService.retrieveAccount(cleaner.stripeConnectedAccountId);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  if (payoutsEnabled !== Boolean(cleaner.payoutsEnabled)) {
    await paymentService.handleAccountUpdated(cleaner.stripeConnectedAccountId, payoutsEnabled);
  }
  return {
    connected: true,
    detailsSubmitted: Boolean(account.details_submitted),
    payoutsEnabled,
    requirementsDue: (account.requirements && account.requirements.currently_due) || [],
  };
}

async function createPayoutDashboardLink(userId) {
  const cleaner = await requireProfile(userId);
  if (!cleaner.stripeConnectedAccountId) throw httpError(400, 'Set up payouts first');
  const link = await stripeService.createExpressDashboardLink(cleaner.stripeConnectedAccountId);
  return { url: link.url };
}

// --- Offers inbox ---

// Before a cleaner accepts, they see what they need to decide and price the
// job, but only the outward postcode (e.g. "LS12"). The customer's full
// postcode is shown once the job is booked with them.
function offerView(offer, cleaner) {
  const job = offer.job || {};
  const distanceKm =
    typeof job.lat === 'number' && typeof cleaner.lat === 'number'
      ? Math.round(haversineDistanceKm(cleaner.lat, cleaner.lng, job.lat, job.lng) * 10) / 10
      : undefined;
  return {
    _id: offer._id,
    status: offer.status,
    score: offer.score,
    createdAt: offer.createdAt,
    distanceKm,
    job: {
      _id: job._id,
      serviceType: job.serviceType,
      category: job.category,
      area: outwardCode(job.postcode),
      description: job.description,
      estimatedHours: job.estimatedHours,
      frequency: job.frequency,
      budgetMin: job.budgetMin,
      budgetMax: job.budgetMax,
      booked: Boolean(job.cleaner),
    },
  };
}

async function listMyOffers(userId, { status } = {}) {
  const cleaner = await requireProfile(userId);
  const filter = { cleaner: cleaner._id };
  if (status) filter.status = status;
  const offers = await JobOffer.find(filter)
    .populate({
      path: 'job',
      select: 'serviceType category postcode lat lng description estimatedHours frequency budgetMin budgetMax cleaner',
      populate: { path: 'serviceType', select: 'name' },
    })
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT);
  return offers.filter((offer) => offer.job).map((offer) => offerView(offer, cleaner));
}

// --- Booked jobs ---

const MY_JOB_FIELDS =
  'serviceType category postcode description estimatedHours frequency status paymentStatus pricePence ' +
  'commissionPence cleanerPayoutPence bookedAt awaitingConfirmationAt disputeReason customer createdAt updatedAt';

async function listMyJobs(userId) {
  const cleaner = await requireProfile(userId);
  return Job.find({ cleaner: cleaner._id })
    .select(MY_JOB_FIELDS)
    .populate('serviceType', 'name')
    .populate('customer', 'name')
    .sort({ bookedAt: -1, createdAt: -1 })
    .limit(LIST_LIMIT);
}

// --- Earnings ---

const IN_ESCROW = [STATES.PAID_HELD, STATES.IN_PROGRESS, STATES.AWAITING_CONFIRMATION, STATES.DISPUTED];
const PAYOUT_ON_THE_WAY = [
  STATES.CONFIRMED,
  STATES.PAYOUT_PENDING,
  STATES.PAYOUT_BLOCKED,
  STATES.TRANSFER_FAILED,
  STATES.MANUAL_REVIEW_HOLD,
];

async function getEarnings(userId) {
  const cleaner = await requireProfile(userId);
  const jobs = await Job.find({
    cleaner: cleaner._id,
    paymentStatus: { $in: [...IN_ESCROW, ...PAYOUT_ON_THE_WAY, STATES.PAID_OUT] },
  }).select('paymentStatus pricePence cleanerPayoutPence commissionPence bookedAt updatedAt serviceType');

  const rate = cleaner.commissionTierRate;
  const estimate = (job) => job.pricePence - Math.round(job.pricePence * rate);

  const totals = { paidOutPence: 0, onTheWayPence: 0, inEscrowPence: 0 };
  jobs.forEach((job) => {
    if (job.paymentStatus === STATES.PAID_OUT) {
      totals.paidOutPence += job.cleanerPayoutPence || 0;
    } else if (PAYOUT_ON_THE_WAY.includes(job.paymentStatus)) {
      totals.onTheWayPence += job.cleanerPayoutPence || estimate(job);
    } else if (IN_ESCROW.includes(job.paymentStatus)) {
      totals.inEscrowPence += estimate(job);
    }
  });

  return {
    commissionRate: rate,
    payoutsEnabled: Boolean(cleaner.payoutsEnabled),
    ...totals,
    jobs,
  };
}

module.exports = {
  startPayoutOnboarding,
  getPayoutStatus,
  createPayoutDashboardLink,
  listMyOffers,
  listMyJobs,
  getEarnings,
};
