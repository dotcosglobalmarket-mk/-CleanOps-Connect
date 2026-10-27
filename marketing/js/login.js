import { apiRequest } from './api.js';
import { continueAfterPassword } from './two-factor-ui.js';

const form = document.getElementById('login-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const alertBox = document.getElementById('alert');
  alertBox.hidden = true;

  const payload = {
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
  };

  try {
    const result = await apiRequest('/auth/login', { method: 'POST', body: payload });
    continueAfterPassword(result, { form, mount: document.getElementById('two-factor-step') });
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  }
});
