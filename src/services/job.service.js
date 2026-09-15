const Job = require('../models/Job');
const JobOffer = require('../models/JobOffer');
const CleanerProfile = require('../models/CleanerProfile');
const mapboxService = require('./mapbox.service');
const coverageService = require('./coverage.service');
const aiScoringService = require('./ai-scoring.service');
const insuranceService = require('./insurance.service');

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

module.exports = {
  createJob,
  getJobById,
  allocateJob,
};
