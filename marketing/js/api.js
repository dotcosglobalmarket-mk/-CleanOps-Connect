import { API_BASE_URL } from './config.js';

const SESSION_TOKEN_KEY = 'cleanops_token';
const SESSION_ROLE_KEY = 'cleanops_role';
const SESSION_USER_KEY = 'cleanops_user';

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
