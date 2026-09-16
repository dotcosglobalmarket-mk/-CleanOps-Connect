import { MAPBOX_TOKEN } from './config.js';

// Approximate coordinates [lng, lat] for the coverage cities shown on the
// landing page. West Yorkshire cluster is CleanOps Connect's initial launch
// area; London is included to illustrate national scale.
export const COVERAGE_CITIES = [
  { name: 'Leeds', lng: -1.5491, lat: 53.8008 },
  { name: 'Bradford', lng: -1.7594, lat: 53.796 },
  { name: 'Wakefield', lng: -1.4977, lat: 53.6833 },
  { name: 'Castleford', lng: -1.362, lat: 53.7241 },
  { name: 'London', lng: -0.1276, lat: 51.5072 },
];

// Builds a GeoJSON LineString overlay (Mapbox Static Images API supports a
// URL-encoded GeoJSON feature as an overlay, styled via simplestyle-spec
// properties: https://docs.mapbox.com/api/maps/static-images/#overlays).
function buildRouteOverlay(fromCity, toCity, color) {
  const line = {
    type: 'Feature',
    properties: { stroke: `#${color}`, 'stroke-width': 3, 'stroke-opacity': 0.85 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [fromCity.lng, fromCity.lat],
        [toCity.lng, toCity.lat],
      ],
    },
  };
  return `geojson(${encodeURIComponent(JSON.stringify(line))})`;
}

// Builds a Mapbox Static Images API URL. Docs:
// https://docs.mapbox.com/api/maps/static-images/
export function buildStaticMapUrl({ cities, style = 'light-v11', width = 640, height = 420, markerColor = '2d8cff', padding = 60, retina = true, showRoute = false }) {
  if (!MAPBOX_TOKEN) return null;

  const markersOverlay = cities
    .map((city) => `pin-s+${markerColor}(${city.lng},${city.lat})`)
    .join(',');

  const overlays = [];
  if (showRoute && cities.length >= 2) {
    // Route overlay drawn first (bottom layer) so the pins sit on top of it.
    overlays.push(buildRouteOverlay(cities[0], cities[cities.length - 1], markerColor));
  }
  overlays.push(markersOverlay);

  const size = `${width}x${height}${retina ? '@2x' : ''}`;

  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${overlays.join(',')}/auto/${size}?padding=${padding}&access_token=${MAPBOX_TOKEN}`;
}
