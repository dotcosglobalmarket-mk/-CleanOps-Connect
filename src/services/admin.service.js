const CleanerProfile = require('../models/CleanerProfile');
const Job = require('../models/Job');
const { STATES } = require('./payment-state-machine');

const JOBS_LIST_LIMIT = 200;

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function listCleaners({ deactivationStatus, verified } = {}) {
  const filter = {};
  if (deactivationStatus) filter.deactivationStatus = deactivationStatus;
  if (verified === 'true') {
    filter.dbsVerified = true;
    filter.insuranceStatus = { $ne: 'none' };
  } else if (verified === 'false') {
    filter.$or = [{ dbsVerified: false }, { insuranceStatus: 'none' }];
  }

  return CleanerProfile.find(filter).populate('user', 'name email').sort({ createdAt: -1 });
}

async function getCleanerById(id) {
  const cleaner = await CleanerProfile.findById(id).populate('user', 'name email');
  if (!cleaner) throw notFound('Cleaner not found');
  return cleaner;
}

// Human-driven only — this is the admin review action itself. Never called
// automatically from a rating/scoring trigger; that path must land here as
// 'under_review' first (see CleanerProfile.deactivationStatus comment).
async function updateCleanerVerification(id, updates) {
  const cleaner = await CleanerProfile.findById(id);
  if (!cleaner) throw notFound('Cleaner not found');
  Object.assign(cleaner, updates);
  await cleaner.save();
  return cleaner;
}

async function updateCleanerDeactivation(id, deactivationStatus) {
  const cleaner = await CleanerProfile.findById(id);
  if (!cleaner) throw notFound('Cleaner not found');
  cleaner.deactivationStatus = deactivationStatus;
  await cleaner.save();
  return cleaner;
}

async function listJobs({ status, paymentStatus } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  return Job.find(filter)
    .populate('customer', 'name email')
    .populate('cleaner', 'name')
    .populate('serviceType', 'name')
    .sort({ createdAt: -1 })
    .limit(JOBS_LIST_LIMIT);
}

async function getJobById(id) {
  const job = await Job.findById(id)
    .populate('customer', 'name email')
    .populate('cleaner', 'name')
    .populate('serviceType', 'name');
  if (!job) throw notFound('Job not found');
  return job;
}

async function getSummary() {
  const [
    totalCleaners,
    unverifiedCleaners,
    underReviewCleaners,
    suspendedCleaners,
    totalJobs,
    openJobs,
    manualReviewHoldJobs,
    payoutBlockedJobs,
  ] = await Promise.all([
    CleanerProfile.countDocuments({}),
    CleanerProfile.countDocuments({ $or: [{ dbsVerified: false }, { insuranceStatus: 'none' }] }),
    CleanerProfile.countDocuments({ deactivationStatus: 'under_review' }),
    CleanerProfile.countDocuments({ deactivationStatus: 'suspended' }),
    Job.countDocuments({}),
    Job.countDocuments({ status: 'open' }),
    Job.countDocuments({ paymentStatus: STATES.MANUAL_REVIEW_HOLD }),
    Job.countDocuments({ paymentStatus: STATES.PAYOUT_BLOCKED }),
  ]);

  return {
    cleaners: {
      total: totalCleaners,
      unverified: unverifiedCleaners,
      underReview: underReviewCleaners,
      suspended: suspendedCleaners,
    },
    jobs: {
      total: totalJobs,
      open: openJobs,
    },
    paymentsOpsQueue: {
      manualReviewHold: manualReviewHoldJobs,
      payoutBlocked: payoutBlockedJobs,
    },
  };
}

module.exports = {
  listCleaners,
  getCleanerById,
  updateCleanerVerification,
  updateCleanerDeactivation,
  listJobs,
  getJobById,
  getSummary,
};
