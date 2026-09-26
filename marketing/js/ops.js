import { apiRequest, getToken, getRole } from './api.js';
import { escapeHtml } from './dom.js';
import {
  PAYMENT_STATES,
  showAlert,
  hideAlert,
  renderTable,
  statusBadge,
  paymentStatusBadge,
  deactivationBadge,
  formatPence,
  formatDate,
  shortId,
  setupTabs,
} from './dashboard-ui.js';

// UI gate only — every /ops endpoint enforces the operator's permissions.
const STAFF_ROLES = ['operator', 'admin'];
if (!getToken() || !STAFF_ROLES.includes(getRole())) {
  window.location.href = 'login.html';
}

const DISPUTE_REASONS = {
  not_completed: 'Job not completed',
  quality_issue: 'Quality issue',
  damage_caused: 'Damage caused',
  no_show: 'Cleaner did not attend',
  other: 'Other',
};

let refundLimitPence = null;

setupTabs();

// --- Today ---
async function loadToday() {
  hideAlert('today-alert');
  try {
    const s = await apiRequest('/ops/summary', { auth: true });
    refundLimitPence = s.refundLimitPence;
    document.getElementById('stat-open-disputes').textContent = s.disputes.open;
    document.getElementById('stat-pending-approvals').textContent = s.disputes.pendingApprovals;
    document.getElementById('stat-unverified').textContent = s.cleaners.unverified;
    document.getElementById('stat-stuck-payouts').textContent =
      s.paymentsOpsQueue.manualReviewHold + s.paymentsOpsQueue.payoutBlocked;
    document.getElementById('stat-under-review').textContent = s.cleaners.underReview;
    document.getElementById('stat-overdue').textContent = s.overdueConfirmations;
    document.getElementById('stat-open-jobs').textContent = s.jobs.open;
    document.getElementById('stat-refund-limit').textContent =
      getRole() === 'admin' ? 'No limit (admin)' : formatPence(s.refundLimitPence);
  } catch (err) {
    showAlert('today-alert', err.message);
  }
}

// --- Timeline (audit entries + notes) ---
function renderTimeline(listId, { audit = [], notes = [] }) {
  const items = [
    ...audit.map((e) => ({
      at: e.createdAt,
      who: e.actor?.name,
      text: `${e.action}${e.reason ? ` — ${e.reason}` : ''}`,
    })),
    ...notes.map((n) => ({ at: n.createdAt, who: n.author?.name, text: `Note: ${n.body}` })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  document.getElementById(listId).innerHTML = items.length
    ? items
        .map(
          (i) => `<li><span class="timeline-meta">${formatDate(i.at)} · ${escapeHtml(i.who || 'Staff')}</span>${escapeHtml(i.text)}</li>`
        )
        .join('')
    : '<li>No activity yet.</li>';
}

// --- Disputes ---
let currentDisputeId = null;

async function loadDisputes() {
  hideAlert('disputes-alert');
  const container = document.getElementById('disputes-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const jobs = await apiRequest('/ops/disputes', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Reason', 'Raised', 'Customer', 'Cleaner', 'Price', ''],
      emptyMessage: 'No open disputes.',
      rows: jobs.map((job) => `
        <tr>
          <td><code>${shortId(job._id)}</code></td>
          <td>${escapeHtml(DISPUTE_REASONS[job.disputeReason] || job.disputeReason || '—')}</td>
          <td>${formatDate(job.disputedAt || job.updatedAt)}</td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.cleaner?.name || '—')}</td>
          <td>${formatPence(job.pricePence)}</td>
          <td class="table-actions">
            <button type="button" class="secondary open-dispute-btn" data-id="${escapeHtml(job._id)}">Review</button>
          </td>
        </tr>
      `),
    });
    container.querySelectorAll('.open-dispute-btn').forEach((btn) => {
      btn.addEventListener('click', () => openDispute(btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('disputes-alert', err.message);
  }
}

async function openDispute(jobId) {
  hideAlert('disputes-alert');
  try {
    const { job, notes, audit, pendingApproval, refundLimitPence: limit } = await apiRequest(
      `/ops/disputes/${jobId}`,
      { auth: true }
    );
    currentDisputeId = jobId;
    refundLimitPence = limit;
    document.getElementById('dispute-id').textContent = String(job._id).slice(-8);
    document.getElementById('dispute-reason').textContent = DISPUTE_REASONS[job.disputeReason] || job.disputeReason || '—';
    document.getElementById('dispute-raised').textContent = formatDate(job.disputedAt || job.updatedAt);
    document.getElementById('dispute-price').textContent = formatPence(job.pricePence);
    document.getElementById('dispute-customer').textContent = job.customer?.name || '—';
    document.getElementById('dispute-cleaner').textContent = job.cleaner?.name || '—';
    document.getElementById('dispute-service').textContent = job.serviceType?.name || '—';
    document.getElementById('dispute-customer-detail').textContent = job.disputeDetail || 'None given.';
    document.getElementById('resolve-form').dataset.price = job.pricePence;

    const pendingEl = document.getElementById('dispute-pending');
    const resolveForm = document.getElementById('resolve-form');
    if (pendingApproval) {
      pendingEl.textContent = `A ${pendingApproval.outcome} of ${formatPence(pendingApproval.refundPence)} requested by ${
        pendingApproval.requestedBy?.name || 'staff'
      } is waiting for admin approval.`;
      pendingEl.hidden = false;
      resolveForm.hidden = true;
    } else {
      pendingEl.hidden = true;
      resolveForm.hidden = job.paymentStatus !== 'DISPUTED';
    }

    document.getElementById('resolve-limit-help').textContent =
      getRole() === 'admin'
        ? 'As an admin, your resolution is applied immediately.'
        : `Refunds above ${formatPence(limit)} are sent to an admin for approval before any money moves.`;

    renderTimeline('dispute-timeline', { audit, notes });
    const detail = document.getElementById('dispute-detail');
    detail.hidden = false;
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showAlert('disputes-alert', err.message);
  }
}

document.querySelectorAll('input[name="outcome"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.getElementById('partial-amount-row').hidden =
      document.querySelector('input[name="outcome"]:checked').value !== 'partial';
  });
});

document.getElementById('resolve-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('disputes-alert');
  hideAlert('disputes-success');

  const outcome = document.querySelector('input[name="outcome"]:checked').value;
  const reason = document.getElementById('resolve-reason').value.trim();
  const body = { outcome, reason };
  if (outcome === 'partial') {
    const pounds = Number(document.getElementById('partial-amount').value);
    const refundPence = Math.round(pounds * 100);
    const pricePence = Number(event.target.dataset.price);
    if (!Number.isInteger(refundPence) || refundPence <= 0 || refundPence >= pricePence) {
      showAlert('disputes-alert', `Enter a refund between £0.01 and ${formatPence(pricePence - 1)}.`);
      return;
    }
    body.refundPence = refundPence;
  }

  const labels = { payout: 'pay the cleaner in full', partial: 'issue a partial refund', refund: 'refund the customer in full' };
  if (!window.confirm(`Confirm: ${labels[outcome]}? This is recorded against your name.`)) return;

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await apiRequest(`/ops/disputes/${currentDisputeId}/resolve`, { method: 'POST', body, auth: true });
    showAlert(
      'disputes-success',
      result.status === 'pending_approval'
        ? 'This refund is above your limit, so it has been sent to an admin for approval.'
        : 'Dispute resolved.'
    );
    event.target.reset();
    document.getElementById('partial-amount-row').hidden = true;
    await Promise.all([loadDisputes(), loadToday()]);
    await openDispute(currentDisputeId);
  } catch (err) {
    showAlert('disputes-alert', err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('dispute-note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('disputes-alert');
  try {
    await apiRequest(`/ops/jobs/${currentDisputeId}/notes`, {
      method: 'POST',
      body: { body: document.getElementById('dispute-note').value.trim() },
      auth: true,
    });
    event.target.reset();
    await openDispute(currentDisputeId);
  } catch (err) {
    showAlert('disputes-alert', err.message);
  }
});

document.getElementById('disputes-refresh').addEventListener('click', loadDisputes);

// --- Verification ---
async function loadVerification() {
  hideAlert('verification-alert');
  const container = document.getElementById('verification-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const cleaners = await apiRequest('/ops/cleaners?verified=false', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Name', 'Email', 'DBS', 'COSHH', 'Insurance', 'Evidence checked (reason)', ''],
      emptyMessage: 'Every cleaner is verified.',
      rows: cleaners.map((c) => `
        <tr data-id="${escapeHtml(c._id)}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.user?.email || '—')}</td>
          <td><input type="checkbox" class="dbs-checkbox" aria-label="DBS verified" ${c.dbsVerified ? 'checked' : ''} /></td>
          <td><input type="checkbox" class="coshh-checkbox" aria-label="COSHH trained" ${c.coshhTrained ? 'checked' : ''} /></td>
          <td>
            <select class="insurance-select" aria-label="Insurance status">
              <option value="none" ${c.insuranceStatus === 'none' ? 'selected' : ''}>None</option>
              <option value="own" ${c.insuranceStatus === 'own' ? 'selected' : ''}>Own</option>
              <option value="platform" ${c.insuranceStatus === 'platform' ? 'selected' : ''}>Platform</option>
            </select>
          </td>
          <td><input type="text" class="evidence-reason" aria-label="Evidence checked" placeholder="Certificate / policy details" /></td>
          <td class="table-actions"><button type="button" class="save-verification-btn">Save</button></td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      row.querySelector('.save-verification-btn').addEventListener('click', async (event) => {
        hideAlert('verification-alert');
        hideAlert('verification-success');
        const reason = row.querySelector('.evidence-reason').value.trim();
        if (reason.length < 3) {
          showAlert('verification-alert', 'Record the evidence you checked before saving.');
          return;
        }
        event.target.disabled = true;
        try {
          await apiRequest(`/ops/cleaners/${row.dataset.id}/verification`, {
            method: 'PATCH',
            body: {
              dbsVerified: row.querySelector('.dbs-checkbox').checked,
              coshhTrained: row.querySelector('.coshh-checkbox').checked,
              insuranceStatus: row.querySelector('.insurance-select').value,
              reason,
            },
            auth: true,
          });
          showAlert('verification-success', 'Verification saved.');
          await Promise.all([loadVerification(), loadToday()]);
        } catch (err) {
          showAlert('verification-alert', err.message);
          event.target.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('verification-alert', err.message);
  }
}

document.getElementById('verification-refresh').addEventListener('click', loadVerification);

// --- Payments Queue ---
async function loadPayments() {
  hideAlert('payments-alert');
  const container = document.getElementById('payments-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const jobs = await apiRequest('/payments/ops/queue', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Status', 'Customer', 'Cleaner', 'Attempts', 'Updated', ''],
      emptyMessage: 'No stuck payouts right now.',
      rows: jobs.map((job) => `
        <tr>
          <td><code>${shortId(job._id)}</code></td>
          <td>${paymentStatusBadge(job.paymentStatus)}</td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.cleaner?.name || '—')}</td>
          <td>${job.payoutAttemptCount ?? 0}</td>
          <td>${formatDate(job.updatedAt)}</td>
          <td class="table-actions">
            ${job.paymentStatus === 'MANUAL_REVIEW_HOLD'
              ? `<button type="button" class="secondary retry-btn" data-id="${escapeHtml(job._id)}">Retry payout</button>`
              : ''}
          </td>
        </tr>
      `),
    });
    container.querySelectorAll('.retry-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reason = window.prompt('Why is it safe to retry this payout now?');
        if (!reason || reason.trim().length < 3) return;
        btn.disabled = true;
        try {
          await apiRequest(`/payments/ops/jobs/${btn.dataset.id}/manual-retry`, {
            method: 'POST',
            body: { reason: reason.trim() },
            auth: true,
          });
          await Promise.all([loadPayments(), loadToday()]);
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

document.getElementById('payments-refresh').addEventListener('click', loadPayments);

// --- Jobs ---
let currentJobId = null;

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
  const container = document.getElementById('jobs-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  const paymentStatus = document.getElementById('jobs-filter-payment-status').value;
  const query = paymentStatus ? `?paymentStatus=${encodeURIComponent(paymentStatus)}` : '';
  try {
    const jobs = await apiRequest(`/ops/jobs${query}`, { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Customer', 'Cleaner', 'Service', 'Status', 'Payment', 'Price', ''],
      emptyMessage: 'No jobs match this filter.',
      rows: jobs.map((job) => `
        <tr>
          <td><code>${shortId(job._id)}</code></td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.cleaner?.name || '—')}</td>
          <td>${escapeHtml(job.serviceType?.name || '—')}</td>
          <td>${escapeHtml(job.status)}</td>
          <td>${job.paymentStatus ? statusBadge(job.paymentStatus, 'warn') : '—'}</td>
          <td>${formatPence(job.pricePence)}</td>
          <td class="table-actions"><button type="button" class="secondary view-job-btn" data-id="${escapeHtml(job._id)}">View</button></td>
        </tr>
      `),
    });
    container.querySelectorAll('.view-job-btn').forEach((btn) => btn.addEventListener('click', () => openJob(btn.dataset.id)));
  } catch (err) {
    container.innerHTML = '';
    showAlert('jobs-alert', err.message);
  }
}

async function openJob(jobId) {
  hideAlert('jobs-alert');
  try {
    const { job, notes } = await apiRequest(`/ops/jobs/${jobId}`, { auth: true });
    currentJobId = jobId;
    document.getElementById('job-detail-id').textContent = String(job._id).slice(-8);
    const fields = [
      ['Customer', job.customer?.name],
      ['Cleaner', job.cleaner?.name],
      ['Service', job.serviceType?.name],
      ['Postcode', job.postcode],
      ['Status', job.status],
      ['Payment', job.paymentStatus],
      ['Price', formatPence(job.pricePence)],
      ['Booked', formatDate(job.bookedAt)],
    ];
    document.getElementById('job-detail-grid').innerHTML = fields
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`)
      .join('');
    renderTimeline('job-notes', { notes });
    document.getElementById('job-detail').hidden = false;
  } catch (err) {
    showAlert('jobs-alert', err.message);
  }
}

document.getElementById('job-note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiRequest(`/ops/jobs/${currentJobId}/notes`, {
      method: 'POST',
      body: { body: document.getElementById('job-note').value.trim() },
      auth: true,
    });
    event.target.reset();
    await openJob(currentJobId);
  } catch (err) {
    showAlert('jobs-alert', err.message);
  }
});

document.getElementById('jobs-refresh').addEventListener('click', loadJobs);
document.getElementById('jobs-filter-apply').addEventListener('click', loadJobs);

// --- Cleaners ---
async function loadCleaners() {
  hideAlert('cleaners-alert');
  const container = document.getElementById('cleaners-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  const status = document.getElementById('cleaners-filter-status').value;
  const query = status ? `?deactivationStatus=${encodeURIComponent(status)}` : '';
  try {
    const cleaners = await apiRequest(`/ops/cleaners${query}`, { auth: true });
    container.innerHTML = renderTable({
      columns: ['Name', 'Email', 'Rating', 'DBS', 'Insurance', 'Status', ''],
      emptyMessage: 'No cleaners match this filter.',
      rows: cleaners.map((c) => {
        const action =
          c.deactivationStatus === 'suspended'
            ? '<span class="field-help">Admin only</span>'
            : `<button type="button" class="secondary status-btn" data-id="${escapeHtml(c._id)}" data-next="${
                c.deactivationStatus === 'under_review' ? 'active' : 'under_review'
              }">${c.deactivationStatus === 'under_review' ? 'Re-activate' : 'Put under review'}</button>`;
        return `
          <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.user?.email || '—')}</td>
            <td>${c.ratingAverage ? `${Number(c.ratingAverage).toFixed(1)} (${c.ratingCount || 0})` : '—'}</td>
            <td>${c.dbsVerified ? statusBadge('Verified', 'good') : statusBadge('Not verified', 'bad')}</td>
            <td>${escapeHtml(c.insuranceStatus || 'none')}</td>
            <td>${deactivationBadge(c.deactivationStatus || 'active')}</td>
            <td class="table-actions">${action}</td>
          </tr>
        `;
      }),
    });
    container.querySelectorAll('.status-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        hideAlert('cleaners-alert');
        hideAlert('cleaners-success');
        const reason = window.prompt(
          btn.dataset.next === 'under_review' ? 'Why are you putting this cleaner under review?' : 'Why is it safe to re-activate this cleaner?'
        );
        if (!reason || reason.trim().length < 3) return;
        btn.disabled = true;
        try {
          await apiRequest(`/ops/cleaners/${btn.dataset.id}/review`, {
            method: 'PATCH',
            body: { deactivationStatus: btn.dataset.next, reason: reason.trim() },
            auth: true,
          });
          showAlert('cleaners-success', 'Cleaner status updated.');
          await Promise.all([loadCleaners(), loadToday()]);
        } catch (err) {
          showAlert('cleaners-alert', err.message);
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

// --- Init ---
populatePaymentStatusFilter();
loadToday();
loadDisputes();
loadVerification();
loadPayments();
loadJobs();
loadCleaners();
