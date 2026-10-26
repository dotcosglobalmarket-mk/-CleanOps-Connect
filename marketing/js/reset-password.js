import { apiRequest, setSession } from './api.js';

const token = new URLSearchParams(window.location.search).get('token');
const form = document.getElementById('reset-password-form');

if (!token) {
  document.getElementById('no-token-alert').hidden = false;
  form.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const alertBox = document.getElementById('alert');
  alertBox.hidden = true;

  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (password !== confirmPassword) {
    alertBox.textContent = 'Passwords do not match.';
    alertBox.hidden = false;
    return;
  }

  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const result = await apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } });
    setSession(result.token, result.user);
    const dashboardHref =
      { admin: 'admin.html', operator: 'ops.html', cleaner: 'cleaner.html' }[result.user.role] || 'customer.html';
    window.location.href = dashboardHref;
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
    submitButton.disabled = false;
  }
});
