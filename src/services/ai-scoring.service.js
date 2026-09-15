/**
 * Scores a cleaner against a job using distance, experience, rating,
 * price fit, insurance status, and compliance flags.
 */
async function scoreCleanerForJob(job, cleaner) {
  // TODO: implement rule-based scoring
  throw new Error('Not implemented');
}

/**
 * Scores and ranks a list of eligible cleaners for a job.
 */
async function rankCleanersForJob(job, cleaners) {
  // TODO: implement ranking using scoreCleanerForJob
  throw new Error('Not implemented');
}

module.exports = {
  scoreCleanerForJob,
  rankCleanersForJob,
};
