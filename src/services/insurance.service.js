/**
 * A job is treated as high-risk when it's industrial work, or a domestic
 * job with a high budget ceiling — both cases where an uninsured cleaner
 * is not an acceptable match.
 */
const HIGH_RISK_DOMESTIC_BUDGET_THRESHOLD = 500;

function isHighRiskJob(job) {
  if (job.category === 'industrial') return true;
  return job.category === 'domestic' && job.budgetMax >= HIGH_RISK_DOMESTIC_BUDGET_THRESHOLD;
}

/**
 * Validates that a cleaner carries adequate insurance for a job. Non-high-risk
 * jobs pass regardless of insurance status; high-risk jobs require the
 * cleaner to have their own or platform-provided insurance.
 */
function validateInsuranceForJob(job, cleaner) {
  if (!isHighRiskJob(job)) return true;
  return cleaner.insuranceStatus === 'own' || cleaner.insuranceStatus === 'platform';
}

module.exports = {
  isHighRiskJob,
  validateInsuranceForJob,
};
