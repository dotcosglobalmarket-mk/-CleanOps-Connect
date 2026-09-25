import { apiRequest, requireRole } from './api.js';
import { escapeHtml } from './dom.js';

requireRole('cleaner');

const WEEKDAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

let cleanerId = null;
let serviceTypes = [];
let selectedServiceIds = new Set();
let selectedWorkingDays = new Set();
let customServices = [];

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

function hideAlert(id) {
  document.getElementById(id).hidden = true;
}

// --- Tab switching ---
document.querySelectorAll('.dash-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dash-nav-item').forEach((b) => b.classList.remove('is-active'));
    document.querySelectorAll('.dash-panel').forEach((p) => p.classList.remove('is-active'));
    btn.classList.add('is-active');
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add('is-active');
  });
});

// --- Working days chips ---
function renderWorkingDayChips() {
  const container = document.getElementById('working-days');
  container.innerHTML = WEEKDAYS.map(
    (d) => `<button type="button" class="chip${selectedWorkingDays.has(d.value) ? ' chip-selected' : ''}" data-day="${d.value}">${d.label}</button>`
  ).join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const day = chip.dataset.day;
      if (selectedWorkingDays.has(day)) selectedWorkingDays.delete(day);
      else selectedWorkingDays.add(day);
      renderWorkingDayChips();
    });
  });
}

// --- Service type chips ---
function renderServiceTypeChips() {
  const container = document.getElementById('service-type-checkboxes');
  if (!serviceTypes.length) {
    container.innerHTML = '<span class="field-help">No service types available yet.</span>';
    return;
  }
  container.innerHTML = serviceTypes
    .map(
      (s) =>
        `<button type="button" class="chip${selectedServiceIds.has(s._id) ? ' chip-selected' : ''}" data-id="${escapeHtml(s._id)}">${escapeHtml(s.name)}</button>`
    )
    .join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id;
      if (selectedServiceIds.has(id)) selectedServiceIds.delete(id);
      else selectedServiceIds.add(id);
      renderServiceTypeChips();
    });
  });
}

// --- Custom services ---
function renderCustomServices() {
  const container = document.getElementById('custom-services-list');
  container.innerHTML = customServices
    .map((name, index) => `<button type="button" class="chip chip-selected" data-index="${index}">${escapeHtml(name)} ×</button>`)
    .join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      customServices.splice(Number(chip.dataset.index), 1);
      renderCustomServices();
    });
  });
}

document.getElementById('add-custom-service').addEventListener('click', () => {
  const input = document.getElementById('customServiceInput');
  const value = input.value.trim();
  if (!value) return;
  customServices.push(value);
  input.value = '';
  renderCustomServices();
});

// --- Load service types (public, no auth needed) ---
async function loadServiceTypes() {
  try {
    serviceTypes = await apiRequest('/service-types');
  } catch (err) {
    serviceTypes = [];
  }
  renderServiceTypeChips();
}

// --- Populate profile form + overview from a cleaner profile object ---
function populateFromProfile(cleaner) {
  cleanerId = cleaner._id || cleaner.id;

  document.getElementById('overview-welcome').textContent = `Welcome back, ${cleaner.name || 'there'}!`;
  document.getElementById('status-value').textContent = cleaner.available === false ? 'Unavailable' : 'Available';
  document.getElementById('available-toggle').checked = cleaner.available !== false;
  document.getElementById('rating-value').textContent = `${cleaner.ratingAverage ? cleaner.ratingAverage.toFixed(1) : '—'} / 5`;
  document.getElementById('services-value').textContent = (cleaner.services || []).length;
  document.getElementById('compliance-value').textContent =
    cleaner.dbsVerified && cleaner.insuranceStatus !== 'none' ? 'Verified' : 'Incomplete';

  document.getElementById('name').value = cleaner.name || '';
  document.getElementById('basePostcode').value = cleaner.basePostcode || '';
  document.getElementById('companyName').value = cleaner.companyName || '';
  document.getElementById('bio').value = cleaner.bio || '';
  document.getElementById('hourlyRate').value = cleaner.hourlyRate ?? '';
  document.getElementById('responseTime').value = cleaner.responseTime || '';
  document.getElementById('travelDistanceMiles').value = cleaner.travelDistanceMiles ?? '';
  document.getElementById('phoneNumber').value = cleaner.phoneNumber || '';
  document.getElementById('contactEmail').value = cleaner.contactEmail || '';
  document.getElementById('website').value = cleaner.website || '';
  document.getElementById('instagram').value = cleaner.instagram || '';
  document.getElementById('startTime').value = cleaner.startTime || '';
  document.getElementById('endTime').value = cleaner.endTime || '';
  document.getElementById('acceptEmergencyBookings').checked = Boolean(cleaner.acceptEmergencyBookings);
  document.getElementById('dbs-status').textContent = cleaner.dbsVerified ? 'Verified' : 'Not yet verified';
  document.getElementById('coshh-status').textContent = cleaner.coshhTrained ? 'Verified' : 'Not yet verified';
  document.getElementById('radiusKm').value = cleaner.coverageRadiusKm ?? '';

  selectedWorkingDays = new Set(cleaner.workingDays || []);
  selectedServiceIds = new Set((cleaner.services || []).map((s) => (typeof s === 'string' ? s : s._id)));
  customServices = [...(cleaner.customServices || [])];
  renderWorkingDayChips();
  renderServiceTypeChips();
  renderCustomServices();
}

async function loadMyProfile() {
  await loadServiceTypes();
  try {
    const cleaner = await apiRequest('/cleaners/me', { auth: true });
    document.getElementById('not-registered-banner').hidden = true;
    populateFromProfile(cleaner);
  } catch (err) {
    if (err.status === 404) {
      document.getElementById('not-registered-banner').hidden = false;
      renderWorkingDayChips();
    } else {
      showAlert('profile-alert', err.message);
    }
  }
}

document.getElementById('available-toggle').addEventListener('change', async (event) => {
  if (!cleanerId) return;
  try {
    await apiRequest('/cleaners/me', { method: 'PATCH', body: { available: event.target.checked }, auth: true });
    document.getElementById('status-value').textContent = event.target.checked ? 'Available' : 'Unavailable';
  } catch (err) {
    event.target.checked = !event.target.checked;
    showAlert('profile-alert', err.message);
  }
});

// --- My Profile form submit ---
document.getElementById('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('profile-alert');
  document.getElementById('profile-success').hidden = true;

  if (!cleanerId) {
    showAlert('profile-alert', 'Register your profile first, under Coverage & Subscription.');
    return;
  }

  const payload = {
    name: document.getElementById('name').value.trim(),
    basePostcode: document.getElementById('basePostcode').value.trim(),
    bio: document.getElementById('bio').value.trim(),
    responseTime: document.getElementById('responseTime').value.trim(),
    phoneNumber: document.getElementById('phoneNumber').value.trim(),
    website: document.getElementById('website').value.trim(),
    instagram: document.getElementById('instagram').value.trim(),
    startTime: document.getElementById('startTime').value,
    endTime: document.getElementById('endTime').value,
    acceptEmergencyBookings: document.getElementById('acceptEmergencyBookings').checked,
    workingDays: Array.from(selectedWorkingDays),
    services: Array.from(selectedServiceIds),
    customServices,
  };

  const companyName = document.getElementById('companyName').value.trim();
  if (companyName) payload.companyName = companyName;
  const contactEmail = document.getElementById('contactEmail').value.trim();
  if (contactEmail) payload.contactEmail = contactEmail;
  const hourlyRate = document.getElementById('hourlyRate').value;
  if (hourlyRate) payload.hourlyRate = Number(hourlyRate);
  const travelDistanceMiles = document.getElementById('travelDistanceMiles').value;
  if (travelDistanceMiles) payload.travelDistanceMiles = Number(travelDistanceMiles);

  // Drop empty optional strings the API validates with format checks (email/url)
  // rather than sending "" and failing validation.
  if (!payload.website) delete payload.website;
  if (!payload.startTime) delete payload.startTime;
  if (!payload.endTime) delete payload.endTime;

  try {
    const cleaner = await apiRequest('/cleaners/me', { method: 'PATCH', body: payload, auth: true });
    populateFromProfile(cleaner);
    const successEl = document.getElementById('profile-success');
    successEl.textContent = 'Profile updated.';
    successEl.hidden = false;
  } catch (err) {
    showAlert('profile-alert', err.message);
  }
});

// --- Register profile (Coverage & Subscription tab) ---
document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('register-alert');
  document.getElementById('register-success').hidden = true;

  const payload = {
    name: document.getElementById('reg-name').value.trim(),
    basePostcode: document.getElementById('reg-basePostcode').value.trim(),
  };

  try {
    const cleaner = await apiRequest('/cleaners', { method: 'POST', body: payload, auth: true });
    cleanerId = cleaner._id || cleaner.id;
    document.getElementById('not-registered-banner').hidden = true;
    populateFromProfile(cleaner);

    const successEl = document.getElementById('register-success');
    successEl.textContent = 'Profile registered. Edit the rest of your details under My Profile.';
    successEl.hidden = false;
  } catch (err) {
    showAlert('register-alert', err.message);
  }
});

document.getElementById('coverage-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('coverage-alert');
  document.getElementById('coverage-success').hidden = true;

  if (!cleanerId) {
    showAlert('coverage-alert', 'Register your profile first.');
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

  if (!cleanerId) {
    showAlert('subscription-alert', 'Register your profile first.');
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

  if (!cleanerId) {
    showAlert('subscription-alert', 'Register your profile first.');
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

loadMyProfile();
