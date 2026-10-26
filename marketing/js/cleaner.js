import { apiRequest, requireRole } from './api.js';
import { escapeHtml, splitSuggestion } from './dom.js';
import { setupTabs, formatPence } from './dashboard-ui.js';
import { STRIPE_PUBLISHABLE_KEY } from './config.js';

requireRole('cleaner');

// Coverage radius is stored server-side in km; the UI shows miles.
const KM_PER_MILE = 1.609344;
const kmToMiles = (km) => km / KM_PER_MILE;
const milesToKm = (miles) => miles * KM_PER_MILE;

const PLAN_LABELS = {
  starter: 'Starter',
  pro: 'Pro',
  industrial_pro: 'Industrial Pro',
};

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

// --- Subscription billing (Stripe Setup Intent; card is saved and charged
// automatically every month, not confirmed live like a one-off job payment) ---
let subStripe = null;
let subElements = null;
let subSetupClientSecret = null;

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Could not load Stripe. Check your connection and try again.'));
    document.head.appendChild(script);
  });
}

// Mounts the card-entry Payment Element once per visit to this tab. The
// same SetupIntent is reused for every click of "activate" until it's
// actually used (a used SetupIntent can't be confirmed twice).
async function ensureSubscriptionPaymentElement() {
  if (subSetupClientSecret || !cleanerId || !STRIPE_PUBLISHABLE_KEY) return;

  const { clientSecret } = await apiRequest('/subscriptions/setup-intent', {
    method: 'POST',
    body: { cleanerId },
    auth: true,
  });
  subSetupClientSecret = clientSecret;

  const StripeJs = await loadStripeJs();
  subStripe = subStripe || StripeJs(STRIPE_PUBLISHABLE_KEY);
  subElements = subStripe.elements({ clientSecret });
  const container = document.getElementById('subscription-payment-element');
  container.innerHTML = '';
  subElements.create('payment').mount(container);
}

async function loadMySubscription() {
  const statusEl = document.getElementById('subscription-status-text');
  try {
    const subscription = await apiRequest('/subscriptions/me', { auth: true });
    statusEl.textContent = subscription
      ? `Current plan: ${PLAN_LABELS[subscription.plan] || subscription.plan} — ${formatPence(subscription.pricePence)}/month.`
      : 'No active subscription.';
  } catch (err) {
    statusEl.textContent = '';
  }
}

// --- Tab switching (a ?tab= link, e.g. from an email, opens that tab) ---
const selectPanel = setupTabs((panel) => {
  if (panel === 'coverage') ensureSubscriptionPaymentElement().catch(() => {});
});
const requestedTab = new URLSearchParams(window.location.search).get('tab');
if (requestedTab) selectPanel(requestedTab);

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
  loadMySubscription();

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
  document.getElementById('radiusMiles').value =
    typeof cleaner.coverageRadiusKm === 'number' ? Math.round(kmToMiles(cleaner.coverageRadiusKm) * 10) / 10 : '';

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
// --- AI writing help for the bio ---
const bioHelpButton = document.getElementById('bio-help');
const bioHelpStatus = document.getElementById('bio-help-status');
const bioSuggestionBox = document.getElementById('bio-suggestion');
const bioSuggestionText = document.getElementById('bio-suggestion-text');

bioHelpButton.addEventListener('click', async () => {
  const body = {
    services: Array.from(selectedServiceIds),
    customServices,
    acceptEmergencyBookings: document.getElementById('acceptEmergencyBookings').checked,
  };
  const travel = document.getElementById('travelDistanceMiles').value;
  const draft = document.getElementById('bio').value.trim();
  if (travel !== '' && Number(travel) > 0) body.travelDistanceMiles = Number(travel);
  if (draft) body.draft = draft;

  bioHelpButton.disabled = true;
  bioHelpStatus.textContent = 'Writing a suggestion…';
  bioSuggestionBox.hidden = true;
  try {
    const { suggestion } = await apiRequest('/cleaners/me/describe-bio', { method: 'POST', body, auth: true });
    const parts = splitSuggestion(suggestion);
    bioSuggestionText.textContent = parts.text;
    document.getElementById('bio-tip').textContent = parts.tip;
    bioSuggestionBox.hidden = false;
    bioHelpStatus.textContent = '';
  } catch (err) {
    bioHelpStatus.textContent = err.message;
  } finally {
    bioHelpButton.disabled = false;
  }
});

document.getElementById('bio-use').addEventListener('click', () => {
  document.getElementById('bio').value = bioSuggestionText.textContent.slice(0, 2000);
  bioSuggestionBox.hidden = true;
});

document.getElementById('bio-dismiss').addEventListener('click', () => {
  bioSuggestionBox.hidden = true;
});

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
    radiusKm: Math.round(milesToKm(Number(document.getElementById('radiusMiles').value)) * 10) / 10,
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

document.getElementById('activate-subscription-button').addEventListener('click', async (event) => {
  hideAlert('subscription-alert');
  document.getElementById('subscription-success').hidden = true;

  if (!cleanerId) {
    showAlert('subscription-alert', 'Register your profile first.');
    return;
  }
  if (!STRIPE_PUBLISHABLE_KEY) {
    showAlert('subscription-alert', 'Card payments are not set up on this site yet. Please contact us.');
    return;
  }

  event.target.disabled = true;
  try {
    await ensureSubscriptionPaymentElement();
    const { error, setupIntent } = await subStripe.confirmSetup({
      elements: subElements,
      redirect: 'if_required',
    });
    if (error) {
      showAlert('subscription-alert', error.message);
      return;
    }

    await apiRequest('/subscriptions', {
      method: 'POST',
      body: { cleanerId, plan: document.getElementById('plan').value, paymentMethodId: setupIntent.payment_method },
      auth: true,
    });

    const successEl = document.getElementById('subscription-success');
    successEl.textContent = 'Subscription activated.';
    successEl.hidden = false;
    // A used SetupIntent can't be confirmed again — force a fresh one if
    // the cleaner changes plan or re-enters their card later.
    subSetupClientSecret = null;
    await loadMySubscription();
  } catch (err) {
    showAlert('subscription-alert', err.message);
  } finally {
    event.target.disabled = false;
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
