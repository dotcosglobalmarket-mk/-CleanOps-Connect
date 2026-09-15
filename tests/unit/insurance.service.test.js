const { isHighRiskJob, validateInsuranceForJob } = require('../../src/services/insurance.service');

describe('insurance.service', () => {
  describe('isHighRiskJob', () => {
    it('treats industrial jobs as high-risk regardless of budget', () => {
      expect(isHighRiskJob({ category: 'industrial', budgetMax: 50 })).toBe(true);
    });

    it('treats low-budget domestic jobs as not high-risk', () => {
      expect(isHighRiskJob({ category: 'domestic', budgetMax: 100 })).toBe(false);
    });

    it('treats high-budget domestic jobs as high-risk', () => {
      expect(isHighRiskJob({ category: 'domestic', budgetMax: 600 })).toBe(true);
    });
  });

  describe('validateInsuranceForJob', () => {
    const uninsured = { insuranceStatus: 'none' };
    const ownInsurance = { insuranceStatus: 'own' };
    const platformInsurance = { insuranceStatus: 'platform' };

    it('allows an uninsured cleaner on a low-risk job', () => {
      expect(validateInsuranceForJob({ category: 'domestic', budgetMax: 100 }, uninsured)).toBe(true);
    });

    it('rejects an uninsured cleaner on a high-risk job', () => {
      expect(validateInsuranceForJob({ category: 'industrial', budgetMax: 200 }, uninsured)).toBe(false);
    });

    it('accepts own or platform insurance on a high-risk job', () => {
      const job = { category: 'industrial', budgetMax: 200 };
      expect(validateInsuranceForJob(job, ownInsurance)).toBe(true);
      expect(validateInsuranceForJob(job, platformInsurance)).toBe(true);
    });
  });
});
