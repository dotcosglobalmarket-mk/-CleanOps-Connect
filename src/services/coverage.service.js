const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Ray-casting point-in-polygon test.
 * `ring` is a GeoJSON linear ring: an array of [lng, lat] pairs.
 * `point` is [lng, lat].
 */
function isPointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function isPointInPolygon(lat, lng, polygon) {
  if (!polygon || !Array.isArray(polygon.coordinates) || polygon.coordinates.length === 0) {
    return false;
  }

  const point = [lng, lat];
  const [exteriorRing, ...holes] = polygon.coordinates;

  if (!isPointInRing(point, exteriorRing)) {
    return false;
  }

  return !holes.some((hole) => isPointInRing(point, hole));
}

/**
 * Filters cleaners whose radius coverage includes the given job location.
 */
function filterByRadius(jobLat, jobLng, cleaners) {
  return cleaners.filter((cleaner) => {
    if (cleaner.coverageType !== 'radius') return false;
    if (typeof cleaner.lat !== 'number' || typeof cleaner.lng !== 'number') return false;
    if (typeof cleaner.coverageRadiusKm !== 'number') return false;

    const distanceKm = haversineDistanceKm(jobLat, jobLng, cleaner.lat, cleaner.lng);
    return distanceKm <= cleaner.coverageRadiusKm;
  });
}

/**
 * Filters cleaners whose polygon coverage includes the given job location.
 */
function filterByPolygon(jobLat, jobLng, cleaners) {
  return cleaners.filter((cleaner) => {
    if (cleaner.coverageType !== 'polygon') return false;
    return isPointInPolygon(jobLat, jobLng, cleaner.coveragePolygon);
  });
}

/**
 * Filters a mixed list of cleaners (radius- and polygon-covered) down to
 * those whose coverage includes the given job location.
 */
function filterCleanersByCoverage(jobLat, jobLng, cleaners) {
  return [...filterByRadius(jobLat, jobLng, cleaners), ...filterByPolygon(jobLat, jobLng, cleaners)];
}

module.exports = {
  haversineDistanceKm,
  filterByRadius,
  filterByPolygon,
  filterCleanersByCoverage,
};
