import { apiRequest, requireRole } from './api.js';

requireRole('customer');

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

function hideAlert(id) {
  document.getElementById(id).hidden = true;
}

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
    const job = await apiRequest(`/jobs/${jobId}`);
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
    const result = await apiRequest(`/jobs/${jobId}/allocate`, { method: 'POST', auth: true });
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
          `<li>#${index + 1} — Cleaner ${offer.cleaner} — score ${Math.round(offer.score)} — status: ${offer.status}</li>`
      )
      .join('');
  } catch (err) {
    showAlert('view-alert', err.message);
  }
});
