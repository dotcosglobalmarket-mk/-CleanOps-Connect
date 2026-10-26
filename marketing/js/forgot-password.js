import { apiRequest } from './api.js';

document.getElementById('forgot-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const alertBox = document.getElementById('alert');
  const successBox = document.getElementById('success');
  alertBox.hidden = true;
  successBox.hidden = true;

  const email = document.getElementById('email').value;
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    // The API always returns the same response whether or not the email is
    // registered — don't let an attacker use this form to find out which
    // emails have accounts.
    await apiRequest('/auth/request-password-reset', { method: 'POST', body: { email } });
    successBox.textContent = "If that email is registered, we've sent a link to reset your password.";
    successBox.hidden = false;
    event.target.reset();
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});
