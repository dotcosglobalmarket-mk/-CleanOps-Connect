const MAPBOX_GEOCODING_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

/**
 * Converts a UK postcode into { lat, lng } using the Mapbox Geocoding API.
 * Throws if MAPBOX_API_KEY is missing, the request fails, or no match is found.
 */
async function geocodePostcode(postcode) {
  if (!postcode || typeof postcode !== 'string') {
    throw new Error('postcode is required');
  }

  const apiKey = process.env.MAPBOX_API_KEY;
  if (!apiKey) {
    throw new Error('MAPBOX_API_KEY is not set in the environment');
  }

  const url = `${MAPBOX_GEOCODING_URL}/${encodeURIComponent(postcode)}.json?country=GB&types=postcode&limit=1&access_token=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox geocoding request failed with status ${response.status}`);
  }

  const data = await response.json();
  const [feature] = data.features || [];
  if (!feature || !Array.isArray(feature.center) || feature.center.length !== 2) {
    throw new Error(`Unable to geocode postcode: ${postcode}`);
  }

  const [lng, lat] = feature.center;
  return { lat, lng };
}

module.exports = {
  geocodePostcode,
};
