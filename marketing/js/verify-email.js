import { apiRequest, getRole, isLoggedIn } from './api.js';

// The link in the email opens this page; confirming takes a button press rather than
// happening on load, so a mail scanner that opens links cannot confirm an address by accident.
const token = new URLSearchParams(window.location.search).get('token');
const button = document.getElementById('confirm-button');

function dashboardLink() {
  if (!isLoggedIn()) return '<a href="login.html">Log in</a>';
  const role = getRole();
  const href = role === 'cleaner' ? 'cleaner.html' : role === 'customer' ? 'customer.html' : 'index.html';
  return `<a href="${href}">Go to your dashboard</a>`;
}

if (!token) {
  document.getElementById('no-token-alert').hidden = false;
  document.getElementById('confirm-step').hidden = true;
}

button.addEventListener('click', async () => {
  const alertBox = document.getElementById('alert');
  alertBox.hidden = true;
  button.disabled = true;
  try {
    await apiRequest('/auth/verify-email', { method: 'POST', body: { token } });
    document.getElementById('confirm-step').hidden = true;
    document.getElementById('success').hidden = false;
    const next = document.getElementById('next-step');
    next.innerHTML = dashboardLink();
    next.hidden = false;
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
    button.disabled = false;
  }
});
