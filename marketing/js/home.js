import { isLoggedIn, getRole, getUser, clearSession } from './api.js';
import { escapeHtml } from './dom.js';
import { COVERAGE_CITIES } from './map.js';
import { renderImpersonationBanner } from './nav.js';

// --- Nav: logged-out visitors see Log in / Register, signed-in users see their dashboard ---
function renderAuthLinks() {
  let html;
  if (isLoggedIn()) {
    const role = getRole();
    const user = getUser();
    const dashboard = { admin: 'admin.html', operator: 'ops.html', cleaner: 'cleaner.html' }[role] || 'customer.html';
    html = `<a href="${dashboard}" class="nav-strong">Dashboard</a><a href="#" data-logout>Log out</a>`;
    if (user && user.name) html = `<span class="nav-user">${escapeHtml(user.name)}</span>` + html;
  } else {
    html = '<a href="login.html" class="nav-strong">Log in</a><a href="register.html" class="btn-nav">Register</a>';
  }
  document.querySelectorAll('.nav-auth').forEach((el) => {
    el.style.display = 'contents';
    el.innerHTML = html;
  });
  document.querySelectorAll('[data-logout]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      clearSession();
      window.location.href = 'index.html';
    });
  });
}

// --- Light / dark toggle (saved choice; otherwise follows the device) ---
const SUN = '<svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON = '<svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function currentTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set) return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setupThemeToggle() {
  // One toggle in each desktop menu (hero nav and sticky nav), one beside the mobile Log in / Register.
  document.querySelectorAll('.nav-desktop').forEach((desktop) => {
    if (desktop.querySelector('[data-theme-toggle]')) return;
    const li = document.createElement('li');
    li.innerHTML = '<button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch between light and dark mode"></button>';
    desktop.appendChild(li);
  });
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = SUN + MOON;
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cleanops-theme', next); } catch (e) { /* private mode */ }
    });
  });
}

// --- Coverage chips, from the same list the cleaner map uses ---
function renderCoverage() {
  const chips = document.getElementById('coverage-chips');
  if (chips) chips.innerHTML = COVERAGE_CITIES.map((c) => `<span class="city-chip">${escapeHtml(c.name)}</span>`).join('');
}

// --- Hero postcode: carried into the post-a-job form once they have an account ---
function setupHeroSearch() {
  const form = document.getElementById('hero-search');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const postcode = document.getElementById('hero-postcode').value.trim().toUpperCase();
    if (!postcode) return;
    try { sessionStorage.setItem('cleanops-postcode', postcode); } catch (e) { /* private mode */ }
    window.location.href = isLoggedIn() && getRole() === 'customer' ? 'customer.html' : 'register.html';
  });
}

// --- FAQ accordion: one open at a time ---
function setupFaq() {
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((el) => {
        el.classList.remove('open');
        el.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// --- Sticky nav: the transparent nav sits over the hero; this one takes over once the hero scrolls away ---
function setupStickyNav() {
  const hero = document.querySelector('.hero');
  const stickyNav = document.getElementById('stickyNav');
  if (!hero || !stickyNav || !('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver((entries) => {
    stickyNav.style.display = entries[0].isIntersecting ? 'none' : 'block';
  }, { threshold: 0.1 });
  obs.observe(hero);
}

renderAuthLinks();
setupThemeToggle();
renderCoverage();
setupHeroSearch();
setupFaq();
setupStickyNav();
renderImpersonationBanner();
