import { apiRequest, requireRole } from './api.js';

requireRole('cleaner');

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

function hideAlert(id) {
  document.getElementById(id).hidden = true;
}

document.getElementById('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('profile-alert');
  document.getElementById('profile-success').hidden = true;

  const payload = {
    name: document.getElementById('name').value.trim(),
    basePostcode: document.getElementById('basePostcode').value.trim(),
    dbsVerified: document.getElementById('dbsVerified').checked,
    coshhTrained: document.getElementById('coshhTrained').checked,
  };
  const companyName = document.getElementById('companyName').value.trim();
  if (companyName) payload.companyName = companyName;

  try {
    const cleaner = await apiRequest('/cleaners', { method: 'POST', body: payload, auth: true });
    const cleanerId = cleaner._id || cleaner.id;
    document.getElementById('cleanerId').value = cleanerId;

    const successEl = document.getElementById('profile-success');
    successEl.textContent = `Profile created (ID: ${cleanerId}). Continue below to set your coverage area.`;
    successEl.hidden = false;
  } catch (err) {
    showAlert('profile-alert', err.message);
  }
});

document.getElementById('coverage-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('coverage-alert');
  document.getElementById('coverage-success').hidden = true;

  const cleanerId = document.getElementById('cleanerId').value.trim();
  if (!cleanerId) {
    showAlert('coverage-alert', 'Register your profile first, or enter your cleaner profile ID above.');
    return;
  }

  const payload = {
    cleanerId,
    coverageType: 'radius',
    radiusKm: Number(document.getElementById('radiusKm').value),
  };

  try {
    await apiRequest('/cleaners/coverage', { method: 'POST', body: payload, auth: true });
    const successEl = document.getElementById('coverage-success');
    successEl.textContent = 'Coverage updated.';
    successEl.hidden = false;
  } catch (err) {
    showAlert('coverage-alert', err.message);
  }
});

document.getElementById('activate-subscription-button').addEventListener('click', async () => {
  hideAlert('subscription-alert');
  document.getElementById('subscription-success').hidden = true;

  const cleanerId = document.getElementById('cleanerId').value.trim();
  if (!cleanerId) {
    showAlert('subscription-alert', 'Register your profile first, or enter your cleaner profile ID above.');
    return;
  }

  try {
    await apiRequest('/subscriptions', {
      method: 'POST',
      body: { cleanerId, plan: document.getElementById('plan').value },
      auth: true,
    });
    const successEl = document.getElementById('subscription-success');
    successEl.textContent = 'Subscription activated.';
    successEl.hidden = false;
  } catch (err) {
    showAlert('subscription-alert', err.message);
  }
});

document.getElementById('add-insurance-button').addEventListener('click', async () => {
  hideAlert('subscription-alert');
  document.getElementById('subscription-success').hidden = true;

  const cleanerId = document.getElementById('cleanerId').value.trim();
  if (!cleanerId) {
    showAlert('subscription-alert', 'Register your profile first, or enter your cleaner profile ID above.');
    return;
  }

  try {
    await apiRequest('/subscriptions/insurance', { method: 'POST', body: { cleanerId }, auth: true });
    const successEl = document.getElementById('subscription-success');
    successEl.textContent = 'Insurance add-on activated.';
    successEl.hidden = false;
  } catch (err) {
    showAlert('subscription-alert', err.message);
  }
});
