import { isLoggedIn, getRole, getUser, clearSession } from './api.js';

export const BRAND_MARK = `
  <svg class="brand-mark" width="28" height="28" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CleanOps Connect shield logo">
    <defs>
      <linearGradient id="shieldFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#eaf2ff" />
        <stop offset="55%" stop-color="#eaf2ff" />
        <stop offset="56%" stop-color="#1d6fe0" />
        <stop offset="100%" stop-color="#0b3fa8" />
      </linearGradient>
    </defs>
    <path d="M50 4 L90 20 V46 C90 70 73 88 50 96 C27 88 10 70 10 46 V20 Z" fill="url(#shieldFill)" stroke="#0b2a66" stroke-width="5" />
    <g stroke="#0b2a66" stroke-width="3" opacity="0.85">
      <line x1="22" y1="24" x2="78" y2="24" />
      <line x1="22" y1="24" x2="22" y2="52" />
      <line x1="78" y1="24" x2="78" y2="52" />
      <line x1="39" y1="24" x2="39" y2="52" />
      <line x1="61" y1="24" x2="61" y2="52" />
      <line x1="22" y1="38" x2="78" y2="38" />
    </g>
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
    <a href="index.html" class="brand">${BRAND_MARK}<span>CleanOps Connect</span></a>
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
