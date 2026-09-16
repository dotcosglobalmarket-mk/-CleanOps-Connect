import { isLoggedIn, getRole, getUser, clearSession } from './api.js';

// Flat, geometric enterprise-SaaS mark: solid navy shield, no gradients,
// with a bold electric-blue checkmark as the sole internal accent.
export const BRAND_MARK = `
  <svg class="brand-mark" width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CleanOps Connect shield logo">
    <path d="M50 4 L90 20 V46 C90 70 73 88 50 96 C27 88 10 70 10 46 V20 Z" fill="#0A1A2F" />
    <path d="M28 52 L45 68 L74 34" fill="none" stroke="#2D8CFF" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

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
    const dashboardHref = role === 'cleaner' ? 'cleaner.html' : 'customer.html';
    links = `
      <span class="nav-user">${user ? user.name : ''} (${role})</span>
      <a href="${dashboardHref}">Dashboard</a>
      <a href="#" id="logout-link">Log out</a>
    `;
  }

  nav.innerHTML = `
    <a href="index.html" class="brand">${BRAND_MARK}<span class="brand-word"><strong>CleanOps</strong> Connect</span></a>
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
}

document.addEventListener('DOMContentLoaded', renderNav);
