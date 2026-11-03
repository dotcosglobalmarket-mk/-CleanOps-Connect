import { isLoggedIn, getRole, getUser, clearSession, getImpersonator, exitImpersonation } from './api.js';
import { escapeHtml } from './dom.js';
import './pwa.js';

// The CleanOps Connect logo (mark and wordmark in one picture). Kept as an export so any page can reuse it.
export const BRAND_MARK = `<img class="brand-logo" src="/brand/logo-full.png" alt="CleanOps Connect" width="117" height="46" />`;

function renderNav() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;

  const loggedIn = isLoggedIn();
  const role = getRole();
  const user = getUser();

  let links = '';

  if (!loggedIn) {
    links = `
      <a href="login.html">Log in</a>
      <a href="register.html" class="button-link">Register</a>
    `;
  } else {
    const dashboardHref = { admin: 'admin.html', operator: 'ops.html', cleaner: 'cleaner.html' }[role] || 'customer.html';
    links = `
      <span class="nav-user">${escapeHtml(user ? user.name : '')} (${escapeHtml(role)})</span>
      <a href="${dashboardHref}">Dashboard</a>
      <a href="#" id="logout-link">Log out</a>
    `;
  }

  nav.innerHTML = `
    <a href="index.html" class="brand" aria-label="CleanOps Connect home">${BRAND_MARK}</a>
    <div class="nav-links">${links}</div>
  `;

  const logoutLink = document.getElementById('logout-link');
  if (logoutLink) {
    logoutLink.addEventListener('click', (event) => {
      event.preventDefault();
      clearSession();
      window.location.href = 'index.html';
    });
  }

  renderImpersonationBanner();
}

// Shown on every page while an admin is viewing a cleaner's dashboard as
// support (see admin.js "View as cleaner"). Read-only server-side — this
// banner just makes whose session is active unambiguous and gives a
// one-click way back.
export function renderImpersonationBanner() {
  const existing = document.getElementById('impersonation-banner');
  const impersonator = getImpersonator();
  const user = getUser();

  if (!impersonator || !user) {
    if (existing) existing.remove();
    return;
  }

  const banner = existing || document.createElement('div');
  banner.id = 'impersonation-banner';
  banner.setAttribute(
    'style',
    'background:#92400e;color:#fff;text-align:center;font-size:0.85rem;padding:0.5rem 1rem;'
  );
  banner.innerHTML = `
    Viewing as <strong>${escapeHtml(user.name)}</strong> (cleaner), read-only support view —
    <a href="#" id="exit-impersonation-link" style="color:#fff;text-decoration:underline;">Exit</a>
  `;
  if (!existing) document.body.insertBefore(banner, document.body.firstChild);

  document.getElementById('exit-impersonation-link').addEventListener('click', (event) => {
    event.preventDefault();
    exitImpersonation();
    window.location.href = 'admin.html';
  });
}

document.addEventListener('DOMContentLoaded', renderNav);
