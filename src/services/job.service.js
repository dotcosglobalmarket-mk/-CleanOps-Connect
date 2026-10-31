const Job = require('../models/Job');
const JobOffer = require('../models/JobOffer');
const CleanerProfile = require('../models/CleanerProfile');
const mapboxService = require('./mapbox.service');
const coverageService = require('./coverage.service');
const aiScoringService = require('./ai-scoring.service');
const insuranceService = require('./insurance.service');
const paymentService = require('./payment.service');
const subscriptionService = require('./subscription.service');
const seriesService = require('./series.service');
const notifications = require('./notification.service');
const { maskContactDetails } = require('./contact-filter.service');

const MAX_OFFERS = 5;
const MAX_TENDER_INVITES = 10;

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

async function requireOwnOffer(jobId, offerId, userId, allowedStatuses = ['sent']) {
  const offer = await JobOffer.findById(offerId);
  if (!offer || offer.job.toString() !== jobId) throw notFound('Offer not found');

  const cleaner = await requireOwningCleanerProfile(userId);
  if (offer.cleaner.toString() !== cleaner._id.toString()) {
    throw forbidden('This offer was not sent to you');
  }
  if (!allowedStatuses.includes(offer.status)) {
    throw badRequest('This offer is no longer available');
  }
  return { offer, cleaner };
}

async function createJob(jobData) {
  const { lat, lng } = await mapboxService.geocodePostcode(jobData.postcode);

  const job = new Job({
    ...jobData,
    procurement: jobData.tender ? 'tender' : 'standard',
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

// Customer's own jobs, newest first, without payment internals.
async function listJobsForCustomer(customerId) {
  // Visits the series has made ahead (not yet charged) stay out of this list.
  const jobs = await Job.find({ customer: customerId, visitState: { $nin: ['scheduled', 'skipped'] } })
    .populate('serviceType', 'name')
    .populate('cleaner', 'name ratingAverage ratingCount')
    .sort({ createdAt: -1 })
    .limit(200);
  return jobs.map(stripInternalFields);
}

// Offers on the customer's job with each cleaner's public details only.
async function listOffersForCustomer(jobId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (requestingUser.role !== 'admin' && job.customer.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this job');
  }

  const offers = await JobOffer.find({ job: job._id })
    .populate('cleaner', 'name companyName ratingAverage ratingCount dbsVerified coshhTrained insuranceStatus experienceYears photo.updatedAt')
    .sort({ score: -1 });
  return offers.map((offer) => ({
    _id: offer._id,
    status: offer.status,
    score: offer.score,
    cleaner: offer.cleaner,
    quotePricePence: offer.quotePricePence,
    quoteMessage: offer.quoteMessage,
    quotedAt: offer.quotedAt,
  }));
}

async function allocateJob(jobId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) {
    throw notFound('Job not found');
  }

  if (requestingUser.role !== 'admin' && job.customer.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this job');
  }

  const isTender = job.procurement === 'tender';
  if (job.cleaner || job.paymentStatus) {
    throw badRequest(isTender ? 'This tender has already been awarded' : 'This job has already been booked');
  }
  if (job.status === 'completed' || job.status === 'cancelled') {
    throw badRequest(`A ${job.status} job cannot be sent to cleaners`);
  }
  if (isTender && !tenderIsOpen(job)) throw badRequest('This tender has closed');

  const { ranked, diagnostics } = await matchCleanersForJob(job);
  const chosen = ranked.slice(0, isTender ? MAX_TENDER_INVITES : MAX_OFFERS);

  // Nobody matched: leave the job as it is (still open) so the customer is
  // not told it has been sent anywhere, and so it can be tried again.
  const offers = chosen.length
    ? await JobOffer.insertMany(
        chosen.map(({ cleaner, score, scoreBreakdown }) => ({
          job: job._id,
          cleaner: cleaner._id,
          score,
          scoreBreakdown,
          status: 'sent',
        }))
      )
    : [];

  if (offers.length) {
    job.status = 'allocated';
    await job.save();
    if (isTender) notifications.tenderInvited(job, offers);
    else notifications.offersSent(job, offers);
  }

  const result = { jobId: job._id, offers };
  // The per-filter counts are for staff; customers do not need them.
  if (requestingUser.role === 'admin') result.diagnostics = diagnostics;
  return result;
}

// Works out which cleaners a job can go to, and, for every cleaner offering
// the service that it cannot, the first rule that stopped them. Each cleaner
// is counted once, in this order: suspended, switched to unavailable,
// already offered this job, outside their coverage, uninsured for a
// high-risk job. Used to allocate and to explain an empty result.
async function matchCleanersForJob(job) {
  const offering = await CleanerProfile.find({ services: job.serviceType });
  const alreadyOffered = new Set((await JobOffer.find({ job: job._id })).map((o) => o.cleaner.toString()));

  const diagnostics = {
    offeringService: offering.length,
    suspended: 0,
    unavailable: 0,
    alreadyOffered: 0,
    outOfCoverage: 0,
    coverageNotSet: 0,
    uninsured: 0,
    eligible: 0,
  };

  const open = [];
  offering.forEach((cleaner) => {
    if (cleaner.deactivationStatus === 'suspended') diagnostics.suspended += 1;
    else if (cleaner.available === false) diagnostics.unavailable += 1;
    else if (alreadyOffered.has(cleaner._id.toString())) diagnostics.alreadyOffered += 1;
    else open.push(cleaner);
  });

  const inCoverage = coverageService.filterCleanersByCoverage(job.lat, job.lng, open);
  const covered = new Set(inCoverage);
  open.forEach((cleaner) => {
    if (covered.has(cleaner)) return;
    diagnostics.outOfCoverage += 1;
    const radiusUnset =
      cleaner.coverageType !== 'polygon' &&
      (typeof cleaner.lat !== 'number' || typeof cleaner.lng !== 'number' || typeof cleaner.coverageRadiusKm !== 'number');
    if (radiusUnset) diagnostics.coverageNotSet += 1;
  });

  const insured = inCoverage.filter((cleaner) => insuranceService.validateInsuranceForJob(job, cleaner));
  diagnostics.uninsured = inCoverage.length - insured.length;
  diagnostics.eligible = insured.length;

  return { ranked: aiScoringService.rankCleanersForJob(job, insured), diagnostics };
}

async function diagnoseAllocation(job) {
  return (await matchCleanersForJob(job)).diagnostics;
}

function tenderIsOpen(job) {
  return Boolean(job.tender && job.tender.closesAt && new Date(job.tender.closesAt).getTime() > Date.now());
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

// Books `job` with `cleaner` from `offer`: claims the offer and the job with
// conditional atomic updates, creates the PaymentIntent via payment.service,
// then declines every other outstanding offer. Used by a cleaner accepting an
// offer and by a customer awarding a tender quote.
//
// The offer and the job are claimed with conditional atomic updates so that
// two cleaners accepting different offers on the same job at the same moment
// cannot both book it (and both create a PaymentIntent).
async function bookFromOffer({ job, offer, cleaner, pricePence, fromStatus, otherStatuses, collectLosers = false }) {
  const claimedOffer = await JobOffer.findOneAndUpdate(
    { _id: offer._id, status: fromStatus },
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
    await JobOffer.updateOne({ _id: offer._id }, { $set: { status: fromStatus } });
    throw err;
  }

  // Remember who is about to be told they lost, before declining them.
  const others = { job: job._id, _id: { $ne: offer._id }, status: otherStatuses };
  const losing = collectLosers ? await JobOffer.find(others) : [];
  await JobOffer.updateMany(others, { $set: { status: 'declined' } });

  return { booked, losing };
}

// Cleaner accepts a sent offer at a price THEY set — the platform never sets
// or suggests a rate. Accepting books the job (creates the PaymentIntent via
// payment.service) and declines every other outstanding offer on it.
async function acceptOffer(jobId, offerId, requestingUser, pricePence) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (job.cleaner || job.paymentStatus) {
    throw badRequest('This job has already been booked with another cleaner');
  }
  if (job.procurement === 'tender') {
    throw badRequest('This job is open for quotes: send your quote instead');
  }

  const { offer, cleaner } = await requireOwnOffer(jobId, offerId, requestingUser.id);
  await subscriptionService.requireActiveSubscription(cleaner._id);

  const { booked } = await bookFromOffer({
    job,
    offer,
    cleaner,
    pricePence,
    fromStatus: 'sent',
    otherStatuses: 'sent',
  });
  // A recurring job becomes a series with this booking as its first visit.
  await seriesService.startFromBookedJob(booked);
  notifications.jobBooked(booked);

  return booked;
}

// --- Tenders (industrial jobs) ---

// An invited cleaner sends (or revises) a quote at THEIR OWN price, until the
// tender closes. The note to the customer has contact details hidden, like
// chat, so the work cannot be taken off the platform before it is awarded.
async function submitQuote(jobId, offerId, requestingUser, { pricePence, message }) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (job.procurement !== 'tender') throw badRequest('This job is not a tender');
  if (job.cleaner || job.paymentStatus) throw badRequest('This tender has already been awarded');
  if (!tenderIsOpen(job)) throw badRequest('This tender has closed');

  const offer = await JobOffer.findById(offerId);
  if (!offer || offer.job.toString() !== jobId) throw notFound('Offer not found');
  const cleaner = await requireOwningCleanerProfile(requestingUser.id);
  if (offer.cleaner.toString() !== cleaner._id.toString()) throw forbidden('This tender invitation was not sent to you');
  await subscriptionService.requireActiveSubscription(cleaner._id);

  const masked = message ? maskContactDetails(message).text : undefined;
  const updated = await JobOffer.findOneAndUpdate(
    { _id: offer._id, status: { $in: ['sent', 'quoted'] } },
    { $set: { status: 'quoted', quotePricePence: pricePence, quoteMessage: masked, quotedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw badRequest('This invitation is no longer available');

  notifications.quoteReceived(job, cleaner);
  return updated;
}

// The customer awards one quote. The booking price is the cleaner's quote,
// never anything the platform chooses.
async function awardQuote(jobId, offerId, requestingUser) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound('Job not found');
  if (requestingUser.role !== 'admin' && job.customer.toString() !== requestingUser.id) {
    throw forbidden('You do not have access to this job');
  }
  if (job.procurement !== 'tender') throw badRequest('This job is not a tender');
  if (job.cleaner || job.paymentStatus) throw badRequest('This tender has already been awarded');

  const offer = await JobOffer.findById(offerId);
  if (!offer || offer.job.toString() !== jobId) throw notFound('Quote not found');
  if (offer.status !== 'quoted' || !offer.quotePricePence) throw badRequest('That cleaner has not sent a quote');

  const cleaner = await CleanerProfile.findById(offer.cleaner);
  if (!cleaner || cleaner.deactivationStatus === 'suspended') {
    throw badRequest('That cleaner is no longer available');
  }

  const { booked, losing } = await bookFromOffer({
    job,
    offer,
    cleaner,
    pricePence: offer.quotePricePence,
    fromStatus: 'quoted',
    otherStatuses: { $in: ['sent', 'quoted'] },
    collectLosers: true,
  });
  notifications.tenderAwarded(booked, cleaner);
  notifications.tenderNotAwarded(booked, losing.filter((o) => o.status === 'quoted'));

  return booked;
}

async function declineOffer(jobId, offerId, requestingUser) {
  // A cleaner who has already sent a tender quote can still withdraw it.
  const { offer } = await requireOwnOffer(jobId, offerId, requestingUser.id, ['sent', 'quoted']);
  offer.status = 'declined';
  await offer.save();
  return offer;
}

module.exports = {
  createJob,
  getJobForUser,
  listJobsForCustomer,
  listOffersForCustomer,
  allocateJob,
  diagnoseAllocation,
  acceptOffer,
  declineOffer,
  submitQuote,
  awardQuote,
};
