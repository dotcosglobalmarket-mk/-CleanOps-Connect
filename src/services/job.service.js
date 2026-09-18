const Job = require('../models/Job');
const JobOffer = require('../models/JobOffer');
const CleanerProfile = require('../models/CleanerProfile');
const mapboxService = require('./mapbox.service');
const coverageService = require('./coverage.service');
const aiScoringService = require('./ai-scoring.service');
const insuranceService = require('./insurance.service');
const paymentService = require('./payment.service');

const MAX_OFFERS = 5;

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function requireOwningCleanerProfile(userId) {
  const cleaner = await CleanerProfile.findOne({ user: userId });
  if (!cleaner) throw forbidden('No cleaner profile found for this user');
  return cleaner;
}

async function requireOwnOffer(jobId, offerId, userId) {
  const offer = await JobOffer.findById(offerId);
  if (!offer || offer.job.toString() !== jobId) throw notFound('Offer not found');

  const cleaner = await requireOwningCleanerProfile(userId);
  if (offer.cleaner.toString() !== cleaner._id.toString()) {
    throw forbidden('This offer was not sent to you');
  }
  if (offer.status !== 'sent') {
    throw badRequest('This offer is no longer available');
  }
  return { offer, cleaner };
}

async function createJob(jobData) {
  const { lat, lng } = await mapboxService.geocodePostcode(jobData.postcode);

  const job = new Job({
    ...jobData,
    lat,
    lng,
  });

  await job.save();
  return job;
}

async function getJobById(jobId) {
  return Job.findById(jobId);
}

async function allocateJob(jobId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) {
    throw notFound('Job not found');
  }

  if (requestingUser.role !== 'admin' && job.customer.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this job');
  }

  const candidates = await CleanerProfile.find({ services: job.serviceType });

  const inCoverage = coverageService.filterCleanersByCoverage(job.lat, job.lng, candidates);
  const insured = inCoverage.filter((cleaner) => insuranceService.validateInsuranceForJob(job, cleaner));
  const ranked = aiScoringService.rankCleanersForJob(job, insured).slice(0, MAX_OFFERS);

  const offers = await JobOffer.insertMany(
    ranked.map(({ cleaner, score, scoreBreakdown }) => ({
      job: job._id,
      cleaner: cleaner._id,
      score,
      scoreBreakdown,
      status: 'sent',
    }))
  );

  job.status = 'allocated';
  await job.save();

  return { jobId: job._id, offers };
}

// Cleaner accepts a sent offer at a price THEY set — the platform never sets
// or suggests a rate. Accepting books the job (creates the PaymentIntent via
// payment.service) and declines every other outstanding offer on it.
async function acceptOffer(jobId, offerId, requestingUser, pricePence) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (job.cleaner) throw badRequest('This job has already been booked with another cleaner');

  const { offer, cleaner } = await requireOwnOffer(jobId, offerId, requestingUser.id);

  offer.status = 'accepted';
  await offer.save();

  await JobOffer.updateMany(
    { job: job._id, _id: { $ne: offer._id }, status: 'sent' },
    { $set: { status: 'declined' } }
  );

  return paymentService.bookJob({ jobId: job._id, cleanerId: cleaner._id, pricePence });
}

async function declineOffer(jobId, offerId, requestingUser) {
  const { offer } = await requireOwnOffer(jobId, offerId, requestingUser.id);
  offer.status = 'declined';
  await offer.save();
  return offer;
}

module.exports = {
  createJob,
  getJobById,
  allocateJob,
  acceptOffer,
  declineOffer,
};
