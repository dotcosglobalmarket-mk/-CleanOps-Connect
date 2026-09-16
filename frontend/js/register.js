import { apiRequest, setSession } from './api.js';

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const alertBox = document.getElementById('alert');
  alertBox.hidden = true;

  const payload = {
    role: document.getElementById('role').value,
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value || undefined,
    password: document.getElementById('password').value,
  };

  try {
    const result = await apiRequest('/auth/register', { method: 'POST', body: payload });
    setSession(result.token, result.user);
    window.location.href = result.user.role === 'cleaner' ? 'cleaner.html' : 'customer.html';
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  }
});
