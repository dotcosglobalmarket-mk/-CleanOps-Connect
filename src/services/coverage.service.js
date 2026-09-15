/**
 * Filters cleaners whose radius coverage includes the given job location.
 */
async function filterByRadius(jobLat, jobLng, cleaners) {
  // TODO: implement radius filtering
  throw new Error('Not implemented');
}

/**
 * Filters cleaners whose polygon coverage includes the given job location.
 */
async function filterByPolygon(jobLat, jobLng, cleaners) {
  // TODO: implement polygon (GeoJSON) filtering
  throw new Error('Not implemented');
}

module.exports = {
  filterByRadius,
  filterByPolygon,
};
