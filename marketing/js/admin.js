import { apiRequest, requireRole } from './api.js';
import { escapeHtml } from './dom.js';

requireRole('admin');

// Mirrors src/services/payment-state-machine.js STATES on the backend —
// duplicated here only to populate the payment-status filter dropdown.
const PAYMENT_STATES = [
  'BOOKED',
  'PAID_HELD',
  'CANCELLED',
  'CANCELLED_BY_CLEANER',
  'CANCELLED_BY_CUSTOMER',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'DISPUTED',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_PAYOUT',
  'CONFIRMED',
  'PAYOUT_PENDING',
  'PAYOUT_BLOCKED',
  'TRANSFER_FAILED',
  'MANUAL_REVIEW_HOLD',
  'PAID_OUT',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

function hideAlert(id) {
  document.getElementById(id).hidden = true;
}


function renderTable({ columns, rows, emptyMessage }) {
  if (!rows.length) {
    return `<div class="table-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <table class="data-table">
      <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

function statusBadge(value, kind) {
  const classes = { good: 'badge-success', bad: 'badge-error', warn: 'badge-warning' };
  return `<span class="badge ${classes[kind] || ''}">${escapeHtml(value)}</span>`;
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

// --- Overview ---
async function loadOverview() {
  hideAlert('overview-alert');
  try {
    const summary = await apiRequest('/admin/summary', { auth: true });
    document.getElementById('stat-cleaners-total').textContent = summary.cleaners.total;
    document.getElementById('stat-cleaners-unverified').textContent = summary.cleaners.unverified;
    document.getElementById('stat-cleaners-under-review').textContent = summary.cleaners.underReview;
    document.getElementById('stat-cleaners-suspended').textContent = summary.cleaners.suspended;
    document.getElementById('stat-jobs-total').textContent = summary.jobs.total;
    document.getElementById('stat-jobs-open').textContent = summary.jobs.open;
    document.getElementById('stat-manual-review-hold').textContent = summary.paymentsOpsQueue.manualReviewHold;
    document.getElementById('stat-payout-blocked').textContent = summary.paymentsOpsQueue.payoutBlocked;
  } catch (err) {
    showAlert('overview-alert', err.message);
  }
}

// --- Payments Ops Queue ---
function paymentStatusBadge(status) {
  return statusBadge(status, status === 'MANUAL_REVIEW_HOLD' ? 'bad' : 'warn');
}

async function loadPaymentsQueue() {
  hideAlert('payments-alert');
  const container = document.getElementById('payments-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const jobs = await apiRequest('/payments/ops/queue', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Status', 'Customer', 'Cleaner', 'Attempts', 'Updated', ''],
      emptyMessage: 'Nothing in the ops queue — no stuck payouts right now.',
      rows: jobs.map((job) => {
        const canRetry = job.paymentStatus === 'MANUAL_REVIEW_HOLD';
        return `
          <tr>
            <td><code>${escapeHtml((job._id || '').slice(-8))}</code></td>
            <td>${paymentStatusBadge(job.paymentStatus)}</td>
            <td>${escapeHtml(job.customer?.name || job.customer || '—')}</td>
            <td>${escapeHtml(job.cleaner?.name || job.cleaner || '—')}</td>
            <td>${job.payoutAttemptCount ?? 0}</td>
            <td>${job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</td>
            <td class="table-actions">
              ${canRetry ? `<button type="button" class="secondary manual-retry-btn" data-id="${job._id}">Retry transfer</button>` : ''}
            </td>
          </tr>
        `;
      }),
    });

    container.querySelectorAll('.manual-retry-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await apiRequest(`/payments/ops/jobs/${btn.dataset.id}/manual-retry`, { method: 'POST', auth: true });
          await loadPaymentsQueue();
        } catch (err) {
          showAlert('payments-alert', err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('payments-alert', err.message);
  }
}

document.getElementById('payments-refresh').addEventListener('click', loadPaymentsQueue);

// --- Cleaner Verification ---
function deactivationBadge(status) {
  const kind = status === 'suspended' ? 'bad' : status === 'under_review' ? 'warn' : 'good';
  return statusBadge(status, kind);
}

async function loadCleaners() {
  hideAlert('cleaners-alert');
  const container = document.getElementById('cleaners-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';

  const params = new URLSearchParams();
  const verified = document.getElementById('cleaners-filter-verified').value;
  const deactivationStatus = document.getElementById('cleaners-filter-deactivation').value;
  if (verified) params.set('verified', verified);
  if (deactivationStatus) params.set('deactivationStatus', deactivationStatus);
  const query = params.toString() ? `?${params.toString()}` : '';

  try {
    const cleaners = await apiRequest(`/admin/cleaners${query}`, { auth: true });
    container.innerHTML = renderTable({
      columns: ['Name', 'Email', 'DBS', 'COSHH', 'Insurance', 'Payouts', 'Status', ''],
      emptyMessage: 'No cleaners match this filter.',
      rows: cleaners.map((c) => `
        <tr data-cleaner-id="${c._id}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.user?.email || '—')}</td>
          <td><input type="checkbox" class="dbs-checkbox" ${c.dbsVerified ? 'checked' : ''} /></td>
          <td><input type="checkbox" class="coshh-checkbox" ${c.coshhTrained ? 'checked' : ''} /></td>
          <td>
            <select class="insurance-select">
              <option value="none" ${c.insuranceStatus === 'none' ? 'selected' : ''}>None</option>
              <option value="own" ${c.insuranceStatus === 'own' ? 'selected' : ''}>Own</option>
              <option value="platform" ${c.insuranceStatus === 'platform' ? 'selected' : ''}>Platform</option>
            </select>
          </td>
          <td>${c.payoutsEnabled ? statusBadge('Enabled', 'good') : statusBadge('Disabled', 'bad')}</td>
          <td>
            <select class="deactivation-select">
              <option value="active" ${c.deactivationStatus === 'active' ? 'selected' : ''}>Active</option>
              <option value="under_review" ${c.deactivationStatus === 'under_review' ? 'selected' : ''}>Under review</option>
              <option value="suspended" ${c.deactivationStatus === 'suspended' ? 'selected' : ''}>Suspended</option>
            </select>
          </td>
          <td class="table-actions">
            <button type="button" class="save-verification-btn">Save</button>
          </td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-cleaner-id]').forEach((row) => {
      const id = row.dataset.cleanerId;

      row.querySelector('.save-verification-btn').addEventListener('click', async (event) => {
        const btn = event.target;
        btn.disabled = true;
        hideAlert('cleaners-alert');
        document.getElementById('cleaners-success').hidden = true;
        try {
          const dbsVerified = row.querySelector('.dbs-checkbox').checked;
          const coshhTrained = row.querySelector('.coshh-checkbox').checked;
          const insuranceStatus = row.querySelector('.insurance-select').value;
          const deactivationStatus = row.querySelector('.deactivation-select').value;

          await apiRequest(`/admin/cleaners/${id}/verification`, {
            method: 'PATCH',
            body: { dbsVerified, coshhTrained, insuranceStatus },
            auth: true,
          });
          await apiRequest(`/admin/cleaners/${id}/deactivation`, {
            method: 'PATCH',
            body: { deactivationStatus },
            auth: true,
          });

          const successEl = document.getElementById('cleaners-success');
          successEl.textContent = 'Cleaner updated.';
          successEl.hidden = false;
        } catch (err) {
          showAlert('cleaners-alert', err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('cleaners-alert', err.message);
  }
}

document.getElementById('cleaners-refresh').addEventListener('click', loadCleaners);
document.getElementById('cleaners-filter-apply').addEventListener('click', loadCleaners);

// --- Jobs ---
function populatePaymentStatusFilter() {
  const select = document.getElementById('jobs-filter-payment-status');
  PAYMENT_STATES.forEach((state) => {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    select.appendChild(option);
  });
}

async function loadJobs() {
  hideAlert('jobs-alert');
  document.getElementById('job-detail').hidden = true;
  const container = document.getElementById('jobs-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';

  const params = new URLSearchParams();
  const status = document.getElementById('jobs-filter-status').value;
  const paymentStatus = document.getElementById('jobs-filter-payment-status').value;
  if (status) params.set('status', status);
  if (paymentStatus) params.set('paymentStatus', paymentStatus);
  const query = params.toString() ? `?${params.toString()}` : '';

  try {
    const jobs = await apiRequest(`/admin/jobs${query}`, { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Customer', 'Cleaner', 'Service', 'Status', 'Payment status', 'Price', ''],
      emptyMessage: 'No jobs match this filter.',
      rows: jobs.map((job) => `
        <tr>
          <td><code>${escapeHtml((job._id || '').slice(-8))}</code></td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.cleaner?.name || '—')}</td>
          <td>${escapeHtml(job.serviceType?.name || '—')}</td>
          <td>${statusBadge(job.status, job.status === 'cancelled' ? 'bad' : job.status === 'completed' ? 'good' : 'warn')}</td>
          <td>${job.paymentStatus ? statusBadge(job.paymentStatus, 'warn') : '—'}</td>
          <td>${job.pricePence ? `£${(job.pricePence / 100).toFixed(2)}` : '—'}</td>
          <td class="table-actions"><button type="button" class="secondary view-job-btn" data-id="${job._id}">View</button></td>
        </tr>
      `),
    });

    container.querySelectorAll('.view-job-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const job = await apiRequest(`/admin/jobs/${btn.dataset.id}`, { auth: true });
          const pre = document.getElementById('job-detail');
          pre.textContent = JSON.stringify(job, null, 2);
          pre.hidden = false;
        } catch (err) {
          showAlert('jobs-alert', err.message);
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('jobs-alert', err.message);
  }
}

document.getElementById('jobs-refresh').addEventListener('click', loadJobs);
document.getElementById('jobs-filter-apply').addEventListener('click', loadJobs);

// --- Service Types ---
async function loadServiceTypes() {
  hideAlert('service-types-alert');
  const container = document.getElementById('service-types-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';

  try {
    const serviceTypes = await apiRequest('/service-types');
    container.innerHTML = renderTable({
      columns: ['Name', 'Category', 'Requires COSHH', ''],
      emptyMessage: 'No service types yet.',
      rows: serviceTypes.map((s) => `
        <tr data-id="${s._id}">
          <td><input type="text" class="st-name-input" value="${escapeHtml(s.name)}" /></td>
          <td>
            <select class="st-category-select">
              <option value="domestic" ${s.category === 'domestic' ? 'selected' : ''}>Domestic</option>
              <option value="industrial" ${s.category === 'industrial' ? 'selected' : ''}>Industrial</option>
            </select>
          </td>
          <td><input type="checkbox" class="st-coshh-checkbox" ${s.requiresCoshh ? 'checked' : ''} /></td>
          <td class="table-actions"><button type="button" class="save-service-type-btn">Save</button></td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      row.querySelector('.save-service-type-btn').addEventListener('click', async (event) => {
        const btn = event.target;
        btn.disabled = true;
        hideAlert('service-types-alert');
        document.getElementById('service-types-success').hidden = true;
        try {
          await apiRequest(`/service-types/${row.dataset.id}`, {
            method: 'PATCH',
            body: {
              name: row.querySelector('.st-name-input').value.trim(),
              category: row.querySelector('.st-category-select').value,
              requiresCoshh: row.querySelector('.st-coshh-checkbox').checked,
            },
            auth: true,
          });
          const successEl = document.getElementById('service-types-success');
          successEl.textContent = 'Service type updated.';
          successEl.hidden = false;
        } catch (err) {
          showAlert('service-types-alert', err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('service-types-alert', err.message);
  }
}

document.getElementById('service-types-refresh').addEventListener('click', loadServiceTypes);

document.getElementById('create-service-type-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('service-types-alert');
  document.getElementById('service-types-success').hidden = true;

  const payload = {
    name: document.getElementById('st-name').value.trim(),
    category: document.getElementById('st-category').value,
    requiresCoshh: document.getElementById('st-requires-coshh').checked,
  };
  const description = document.getElementById('st-description').value.trim();
  if (description) payload.description = description;

  try {
    await apiRequest('/service-types', { method: 'POST', body: payload, auth: true });
    document.getElementById('create-service-type-form').reset();
    const successEl = document.getElementById('service-types-success');
    successEl.textContent = 'Service type added.';
    successEl.hidden = false;
    await loadServiceTypes();
  } catch (err) {
    showAlert('service-types-alert', err.message);
  }
});

// --- Init ---
populatePaymentStatusFilter();
loadOverview();
loadPaymentsQueue();
loadCleaners();
loadJobs();
loadServiceTypes();
