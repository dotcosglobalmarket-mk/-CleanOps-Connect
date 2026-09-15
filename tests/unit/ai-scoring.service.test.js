const { scoreCleanerForJob, rankCleanersForJob, WEIGHTS } = require('../../src/services/ai-scoring.service');

describe('ai-scoring.service', () => {
  const domesticJob = { lat: 51.5074, lng: -0.1278, category: 'domestic' };
  const industrialJob = { lat: 51.5074, lng: -0.1278, category: 'industrial' };

  const strongCleaner = {
    lat: 51.51,
    lng: -0.13,
    coverageType: 'radius',
    coverageRadiusKm: 10,
    experienceYears: 10,
    ratingAverage: 5,
    insuranceStatus: 'own',
    dbsVerified: true,
    coshhTrained: true,
  };

  const weakCleaner = {
    lat: 51.51,
    lng: -0.13,
    coverageType: 'radius',
    coverageRadiusKm: 10,
    experienceYears: 0,
    ratingAverage: 0,
    insuranceStatus: 'none',
    dbsVerified: false,
    coshhTrained: false,
  };

  describe('scoreCleanerForJob', () => {
    it('awards full marks across the board for a strong domestic-compliant cleaner', () => {
      const { score, breakdown } = scoreCleanerForJob(domesticJob, strongCleaner);
      expect(breakdown.experience).toBeCloseTo(WEIGHTS.experience, 5);
      expect(breakdown.rating).toBeCloseTo(WEIGHTS.rating, 5);
      expect(breakdown.insurance).toBe(WEIGHTS.insurance);
      expect(breakdown.compliance).toBe(WEIGHTS.compliance);
      expect(score).toBeGreaterThan(90);
    });

    it('zeroes insurance and compliance for a weak, uninsured, non-DBS cleaner on a domestic job', () => {
      const { breakdown } = scoreCleanerForJob(domesticJob, weakCleaner);
      expect(breakdown.insurance).toBe(0);
      expect(breakdown.compliance).toBe(0);
      expect(breakdown.experience).toBe(0);
      expect(breakdown.rating).toBe(0);
    });

    it('checks COSHH (not DBS) compliance for industrial jobs', () => {
      const dbsOnlyCleaner = { ...weakCleaner, dbsVerified: true, coshhTrained: false };
      const coshhOnlyCleaner = { ...weakCleaner, dbsVerified: false, coshhTrained: true };

      expect(scoreCleanerForJob(industrialJob, dbsOnlyCleaner).breakdown.compliance).toBe(0);
      expect(scoreCleanerForJob(industrialJob, coshhOnlyCleaner).breakdown.compliance).toBe(WEIGHTS.compliance);
    });

    it('scores 0 distance for a cleaner missing coordinates', () => {
      const noCoords = { ...strongCleaner, lat: undefined, lng: undefined };
      const { breakdown } = scoreCleanerForJob(domesticJob, noCoords);
      expect(breakdown.distance).toBe(0);
    });
  });

  describe('rankCleanersForJob', () => {
    it('ranks the strong cleaner above the weak cleaner', () => {
      const ranked = rankCleanersForJob(domesticJob, [weakCleaner, strongCleaner]);
      expect(ranked).toHaveLength(2);
      expect(ranked[0].cleaner).toBe(strongCleaner);
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });
  });
});
