const { haversineDistanceKm } = require('./coverage.service');

const WEIGHTS = {
  distance: 30,
  experience: 15,
  rating: 20,
  priceFit: 10,
  insurance: 15,
  compliance: 10,
};

const MAX_EXPERIENCE_YEARS = 10;
const MAX_RATING = 5;
const DEFAULT_MAX_DISTANCE_KM = 50;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function scoreDistance(job, cleaner) {
  if (typeof cleaner.lat !== 'number' || typeof cleaner.lng !== 'number') {
    return 0;
  }

  const distanceKm = haversineDistanceKm(job.lat, job.lng, cleaner.lat, cleaner.lng);
  const maxDistanceKm =
    cleaner.coverageType === 'radius' && typeof cleaner.coverageRadiusKm === 'number'
      ? cleaner.coverageRadiusKm
      : DEFAULT_MAX_DISTANCE_KM;

  return clamp01(1 - distanceKm / maxDistanceKm) * WEIGHTS.distance;
}

function scoreExperience(cleaner) {
  const years = typeof cleaner.experienceYears === 'number' ? cleaner.experienceYears : 0;
  return clamp01(years / MAX_EXPERIENCE_YEARS) * WEIGHTS.experience;
}

function scoreRating(cleaner) {
  const rating = typeof cleaner.ratingAverage === 'number' ? cleaner.ratingAverage : 0;
  return clamp01(rating / MAX_RATING) * WEIGHTS.rating;
}

function scorePriceFit() {
  // CleanerProfile does not currently record a rate, so price fit cannot be
  // computed from job budget vs. cleaner rate. Award full marks until a
  // rate field exists to compare against job.budgetMin/budgetMax.
  return WEIGHTS.priceFit;
}

function scoreInsurance(cleaner) {
  return cleaner.insuranceStatus === 'none' ? 0 : WEIGHTS.insurance;
}

function scoreCompliance(job, cleaner) {
  if (job.category === 'domestic') {
    return cleaner.dbsVerified ? WEIGHTS.compliance : 0;
  }
  if (job.category === 'industrial') {
    return cleaner.coshhTrained ? WEIGHTS.compliance : 0;
  }
  return 0;
}

/**
 * Scores a cleaner against a job using distance, experience, rating,
 * price fit, insurance status, and compliance flags. Returns a score out
 * of 100 plus a breakdown matching JobOffer.scoreBreakdown.
 */
function scoreCleanerForJob(job, cleaner) {
  const breakdown = {
    distance: scoreDistance(job, cleaner),
    experience: scoreExperience(cleaner),
    rating: scoreRating(cleaner),
    priceFit: scorePriceFit(job, cleaner),
    insurance: scoreInsurance(cleaner),
    compliance: scoreCompliance(job, cleaner),
  };

  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return { score, breakdown };
}

/**
 * Scores and ranks a list of eligible cleaners for a job, highest score first.
 */
function rankCleanersForJob(job, cleaners) {
  return cleaners
    .map((cleaner) => {
      const { score, breakdown } = scoreCleanerForJob(job, cleaner);
      return { cleaner, score, scoreBreakdown: breakdown };
    })
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  WEIGHTS,
  scoreCleanerForJob,
  rankCleanersForJob,
};
