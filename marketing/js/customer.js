import { apiRequest, requireRole } from './api.js';
import { escapeHtml } from './dom.js';

requireRole('customer');

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

function hideAlert(id) {
  document.getElementById(id).hidden = true;
}

let serviceTypes = [];

function renderServiceTypeOptions() {
  const select = document.getElementById('serviceType');
  const category = document.getElementById('category').value;
  const matching = serviceTypes.filter((s) => s.category === category);

  select.innerHTML = matching.length
    ? matching.map((s) => `<option value="${escapeHtml(s._id)}">${escapeHtml(s.name)}</option>`).join('')
    : `<option value="" disabled selected>No ${escapeHtml(category)} service types available</option>`;
}

async function loadServiceTypes() {
  try {
    serviceTypes = await apiRequest('/service-types');
    renderServiceTypeOptions();
  } catch (err) {
    document.getElementById('serviceType-help').hidden = false;
    document.getElementById('serviceType').innerHTML =
      '<option value="" disabled selected>Could not load service types</option>';
  }
}

document.getElementById('category').addEventListener('change', renderServiceTypeOptions);
loadServiceTypes();

document.getElementById('create-job-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('create-alert');
  document.getElementById('create-success').hidden = true;

  const estimatedHoursRaw = document.getElementById('estimatedHours').value;
  const descriptionRaw = document.getElementById('description').value;

  const payload = {
    serviceType: document.getElementById('serviceType').value.trim(),
    category: document.getElementById('category').value,
    postcode: document.getElementById('postcode').value.trim(),
    frequency: document.getElementById('frequency').value,
    budgetMin: Number(document.getElementById('budgetMin').value),
    budgetMax: Number(document.getElementById('budgetMax').value),
  };
  if (descriptionRaw) payload.description = descriptionRaw;
  if (estimatedHoursRaw) payload.estimatedHours = Number(estimatedHoursRaw);

  try {
    const job = await apiRequest('/jobs', { method: 'POST', body: payload, auth: true });
    const successEl = document.getElementById('create-success');
    successEl.textContent = `Job created (ID: ${job._id || job.id}). Copy this ID below to view it or allocate cleaners.`;
    successEl.hidden = false;
    document.getElementById('jobId').value = job._id || job.id;
  } catch (err) {
    showAlert('create-alert', err.message);
  }
});

document.getElementById('view-job-button').addEventListener('click', async () => {
  hideAlert('view-alert');
  const jobId = document.getElementById('jobId').value.trim();
  if (!jobId) {
    showAlert('view-alert', 'Enter a job ID first.');
    return;
  }

  try {
    const job = await apiRequest(`/jobs/${encodeURIComponent(jobId)}`, { auth: true });
    const details = document.getElementById('job-details');
    details.textContent = JSON.stringify(job, null, 2);
    details.hidden = false;
  } catch (err) {
    showAlert('view-alert', err.message);
  }
});

document.getElementById('allocate-job-button').addEventListener('click', async () => {
  hideAlert('view-alert');
  const jobId = document.getElementById('jobId').value.trim();
  if (!jobId) {
    showAlert('view-alert', 'Enter a job ID first.');
    return;
  }

  try {
    const result = await apiRequest(`/jobs/${encodeURIComponent(jobId)}/allocate`, { method: 'POST', auth: true });
    const heading = document.getElementById('offers-heading');
    const list = document.getElementById('offers-list');
    heading.hidden = false;
    list.hidden = false;

    if (!result.offers || result.offers.length === 0) {
      list.innerHTML = '<li>No eligible cleaners were found for this job.</li>';
      return;
    }

    list.innerHTML = result.offers
      .map(
        (offer, index) =>
          `<li>#${index + 1} — Cleaner ${escapeHtml(offer.cleaner)} — score ${Math.round(offer.score)} — status: ${escapeHtml(offer.status)}</li>`
      )
      .join('');
  } catch (err) {
    showAlert('view-alert', err.message);
  }
});
