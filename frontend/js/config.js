// Backend API base URL. Injected at build time from VITE_API_URL
// (see .env.production.example). Falls back to local dev default.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
