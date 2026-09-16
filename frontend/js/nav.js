import { isLoggedIn, getRole, getUser, clearSession } from './api.js';

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
    <a href="index.html" class="brand">CleanOps Connect</a>
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
