const {
  haversineDistanceKm,
  filterByRadius,
  filterByPolygon,
  filterCleanersByCoverage,
} = require('../../src/services/coverage.service');

describe('coverage.service', () => {
  const jobLat = 51.5074;
  const jobLng = -0.1278;

  describe('haversineDistanceKm', () => {
    it('returns ~0 for the same point', () => {
      expect(haversineDistanceKm(jobLat, jobLng, jobLat, jobLng)).toBeCloseTo(0, 5);
    });

    it('returns a positive distance for different points', () => {
      const distance = haversineDistanceKm(jobLat, jobLng, 52.4862, -1.8904); // London -> Birmingham
      expect(distance).toBeGreaterThan(150);
      expect(distance).toBeLessThan(200);
    });
  });

  describe('filterByRadius', () => {
    const inRange = { _id: 'in', coverageType: 'radius', lat: 51.51, lng: -0.13, coverageRadiusKm: 10 };
    const outOfRange = { _id: 'out', coverageType: 'radius', lat: 52.5, lng: -1.9, coverageRadiusKm: 10 };
    const polygonType = { _id: 'poly', coverageType: 'polygon' };
    const missingFields = { _id: 'missing', coverageType: 'radius' };

    it('includes cleaners within their radius', () => {
      const result = filterByRadius(jobLat, jobLng, [inRange]);
      expect(result.map((c) => c._id)).toEqual(['in']);
    });

    it('excludes cleaners outside their radius', () => {
      const result = filterByRadius(jobLat, jobLng, [outOfRange]);
      expect(result).toHaveLength(0);
    });

    it('excludes non-radius cleaners and cleaners missing required fields', () => {
      const result = filterByRadius(jobLat, jobLng, [polygonType, missingFields]);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterByPolygon', () => {
    const containingPolygon = {
      _id: 'inside',
      coverageType: 'polygon',
      coveragePolygon: {
        type: 'Polygon',
        coordinates: [[[-0.2, 51.4], [-0.2, 51.6], [0.0, 51.6], [0.0, 51.4], [-0.2, 51.4]]],
      },
    };
    const nonContainingPolygon = {
      _id: 'outside',
      coverageType: 'polygon',
      coveragePolygon: {
        type: 'Polygon',
        coordinates: [[[10, 10], [10, 11], [11, 11], [11, 10], [10, 10]]],
      },
    };
    const polygonWithHole = {
      _id: 'hole',
      coverageType: 'polygon',
      coveragePolygon: {
        type: 'Polygon',
        coordinates: [
          [[-1, 50], [-1, 53], [1, 53], [1, 50], [-1, 50]], // outer ring covers London
          [[-0.2, 51.4], [-0.2, 51.6], [0.0, 51.6], [0.0, 51.4], [-0.2, 51.4]], // hole excludes it
        ],
      },
    };

    it('includes a cleaner whose polygon contains the job location', () => {
      const result = filterByPolygon(jobLat, jobLng, [containingPolygon]);
      expect(result.map((c) => c._id)).toEqual(['inside']);
    });

    it('excludes a cleaner whose polygon does not contain the job location', () => {
      const result = filterByPolygon(jobLat, jobLng, [nonContainingPolygon]);
      expect(result).toHaveLength(0);
    });

    it('excludes a point that falls inside a polygon hole', () => {
      const result = filterByPolygon(jobLat, jobLng, [polygonWithHole]);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterCleanersByCoverage', () => {
    it('merges radius and polygon matches', () => {
      const radiusMatch = { _id: 'r', coverageType: 'radius', lat: 51.51, lng: -0.13, coverageRadiusKm: 10 };
      const polygonMatch = {
        _id: 'p',
        coverageType: 'polygon',
        coveragePolygon: {
          type: 'Polygon',
          coordinates: [[[-0.2, 51.4], [-0.2, 51.6], [0.0, 51.6], [0.0, 51.4], [-0.2, 51.4]]],
        },
      };
      const result = filterCleanersByCoverage(jobLat, jobLng, [radiusMatch, polygonMatch]);
      expect(result.map((c) => c._id).sort()).toEqual(['p', 'r']);
    });
  });
});
