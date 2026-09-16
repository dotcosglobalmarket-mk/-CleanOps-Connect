import { apiRequest, setSession } from './api.js';

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const alertBox = document.getElementById('alert');
  alertBox.hidden = true;

  const payload = {
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
  };

  try {
    const result = await apiRequest('/auth/login', { method: 'POST', body: payload });
    setSession(result.token, result.user);
    window.location.href = result.user.role === 'cleaner' ? 'cleaner.html' : 'customer.html';
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  }
});
