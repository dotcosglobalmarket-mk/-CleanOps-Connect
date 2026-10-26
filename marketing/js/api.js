import { API_BASE_URL } from './config.js';

const SESSION_TOKEN_KEY = 'cleanops_token';
const SESSION_ROLE_KEY = 'cleanops_role';
const SESSION_USER_KEY = 'cleanops_user';
// The admin's own session, stashed while viewing a cleaner's dashboard as
// support (see admin.js "View as cleaner" and nav.js's banner). Restored
// by exitImpersonation().
const IMPERSONATOR_KEY = 'cleanops_impersonator';

export function getToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function getRole() {
  return localStorage.getItem(SESSION_ROLE_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(SESSION_USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
  localStorage.setItem(SESSION_ROLE_KEY, user.role);
  localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_ROLE_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
}

export function isLoggedIn() {
  return Boolean(getToken());
}

// Switches the active session to a read-only impersonation token, stashing
// the admin's own session so exitImpersonation() can restore it.
export function startImpersonation(token, cleanerUser) {
  localStorage.setItem(IMPERSONATOR_KEY, JSON.stringify({ token: getToken(), user: getUser() }));
  setSession(token, cleanerUser);
}

export function getImpersonator() {
  const raw = localStorage.getItem(IMPERSONATOR_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Restores the admin's own session. Returns false if there was nothing to
// restore (not currently impersonating).
export function exitImpersonation() {
  const impersonator = getImpersonator();
  if (!impersonator) return false;
  localStorage.removeItem(IMPERSONATOR_KEY);
  setSession(impersonator.token, impersonator.user);
  return true;
}

export function requireRole(role) {
  if (getToken() && getRole() === role) return;
  window.location.href = 'login.html';
}

export async function apiRequest(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (!token) throw new Error('You must be logged in to do that.');
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error(
      `Could not reach the API at ${API_BASE_URL}. Check VITE_API_URL and that the backend is running.`
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.message ||
      (data.details && data.details.map((d) => `${d.path}: ${d.message}`).join(', ')) ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data.details;
    throw error;
  }

  return data;
}

// Sends a file as the raw request body (the API reads the Content-Type, so the
// browser's own file type is what gets checked server-side).
export async function apiUpload(path, file, query = {}) {
  const token = getToken();
  if (!token) throw new Error('You must be logged in to do that.');
  const qs = new URLSearchParams(query).toString();
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type, Authorization: `Bearer ${token}` },
      body: file,
    });
  } catch (networkErr) {
    throw new Error(`Could not reach the API at ${API_BASE_URL}.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Upload failed with status ${response.status}`);
  return data;
}

// Fetches a protected file (needs the Authorization header, so it cannot be a plain link)
// and returns it as a blob.
export async function apiFetchBlob(path) {
  const token = getToken();
  if (!token) throw new Error('You must be logged in to do that.');
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }
  return response.blob();
}
