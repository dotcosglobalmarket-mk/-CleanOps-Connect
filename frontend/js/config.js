// Backend API base URL. Injected at build time from VITE_API_URL
// (see .env.production.example). Falls back to local dev default.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Mapbox PUBLIC access token (starts with "pk."), injected at build time
// from VITE_MAPBOX_TOKEN. This is distinct from the backend's MAPBOX_API_KEY
// (a private key used server-side for geocoding) — Mapbox public tokens are
// designed to be embedded in client-side code and restricted via URL/referrer
// allowlists on the Mapbox account dashboard, not kept secret.
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
