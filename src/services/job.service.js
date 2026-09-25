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

// Payment-internal fields only the platform needs to see.
const INTERNAL_JOB_FIELDS = ['stripePaymentIntentId', 'stripeTransferId', 'payoutAttemptCount', 'nextPayoutRetryAt'];

function toPlain(doc) {
  return typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
}

// A job contains the customer's postcode, coordinates and budget, so it is
// visible only to: the customer who posted it, an admin, the cleaner it is
// booked with, or a cleaner who was sent an offer for it.
async function getJobForUser(jobId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');

  if (requestingUser.role === 'admin') return job;

  if (requestingUser.role === 'customer' && job.customer && job.customer.toString() === requestingUser.id) {
    return stripInternalFields(job);
  }

  if (requestingUser.role === 'cleaner') {
    const cleaner = await CleanerProfile.findOne({ user: requestingUser.id });
    if (cleaner) {
      const isAssigned = job.cleaner && job.cleaner.toString() === cleaner._id.toString();
      const hasOffer = isAssigned || (await JobOffer.exists({ job: job._id, cleaner: cleaner._id }));
      if (hasOffer) return stripInternalFields(job);
    }
  }

  throw forbidden('You do not have access to this job');
}

function stripInternalFields(job) {
  const plain = toPlain(job);
  INTERNAL_JOB_FIELDS.forEach((field) => delete plain[field]);
  return plain;
}

async function allocateJob(jobId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) {
    throw notFound('Job not found');
  }

  if (requestingUser.role !== 'admin' && job.customer.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this job');
  }

  // Suspended cleaners and cleaners who have switched themselves to
  // unavailable must never be sent offers.
  const candidates = await CleanerProfile.find({
    services: job.serviceType,
    deactivationStatus: { $ne: 'suspended' },
    available: { $ne: false },
  });

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

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Cleaner accepts a sent offer at a price THEY set — the platform never sets
// or suggests a rate. Accepting books the job (creates the PaymentIntent via
// payment.service) and declines every other outstanding offer on it.
//
// The offer and the job are claimed with conditional atomic updates so that
// two cleaners accepting different offers on the same job at the same moment
// cannot both book it (and both create a PaymentIntent).
async function acceptOffer(jobId, offerId, requestingUser, pricePence) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (job.cleaner || job.paymentStatus) {
    throw badRequest('This job has already been booked with another cleaner');
  }

  const { offer, cleaner } = await requireOwnOffer(jobId, offerId, requestingUser.id);

  const claimedOffer = await JobOffer.findOneAndUpdate(
    { _id: offer._id, status: 'sent' },
    { $set: { status: 'accepted' } },
    { new: true }
  );
  if (!claimedOffer) throw badRequest('This offer is no longer available');

  const claimedJob = await Job.findOneAndUpdate(
    { _id: job._id, cleaner: null, paymentStatus: null },
    { $set: { cleaner: cleaner._id } },
    { new: true }
  );
  if (!claimedJob) {
    await JobOffer.updateOne({ _id: offer._id }, { $set: { status: 'declined' } });
    throw conflict('This job has just been booked with another cleaner');
  }

  let booked;
  try {
    booked = await paymentService.bookJob({ jobId: job._id, cleanerId: cleaner._id, pricePence });
  } catch (err) {
    // Release the claim so the job can still be booked by another offer.
    await Job.updateOne({ _id: job._id, cleaner: cleaner._id, paymentStatus: null }, { $unset: { cleaner: 1 } });
    await JobOffer.updateOne({ _id: offer._id }, { $set: { status: 'sent' } });
    throw err;
  }

  await JobOffer.updateMany(
    { job: job._id, _id: { $ne: offer._id }, status: 'sent' },
    { $set: { status: 'declined' } }
  );

  return booked;
}

async function declineOffer(jobId, offerId, requestingUser) {
  const { offer } = await requireOwnOffer(jobId, offerId, requestingUser.id);
  offer.status = 'declined';
  await offer.save();
  return offer;
}

module.exports = {
  createJob,
  getJobForUser,
  allocateJob,
  acceptOffer,
  declineOffer,
};
