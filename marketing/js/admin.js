import { apiRequest, requireRole } from './api.js';
import { escapeHtml } from './dom.js';
import {
  PAYMENT_STATES,
  showAlert,
  hideAlert,
  renderTable,
  statusBadge,
  paymentStatusBadge,
  formatPence,
  formatDate,
  shortId,
  setupTabs,
} from './dashboard-ui.js';

requireRole('admin');

setupTabs();

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

// --- Refund Approvals ---
async function loadApprovals() {
  hideAlert('approvals-alert');
  const container = document.getElementById('approvals-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';

  try {
    const approvals = await apiRequest('/admin/approvals?status=pending', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Requested by', 'Outcome', 'Refund', 'Operator reason', 'Raised', 'Your reason', ''],
      emptyMessage: 'No refunds are waiting for approval.',
      rows: approvals.map((a) => `
        <tr data-id="${escapeHtml(a._id)}">
          <td><code>${shortId(a.job?._id || a.job)}</code></td>
          <td>${escapeHtml(a.requestedBy?.name || '—')}</td>
          <td>${statusBadge(a.outcome, 'warn')}</td>
          <td>${formatPence(a.refundPence)}${a.job?.pricePence ? ` of ${formatPence(a.job.pricePence)}` : ''}</td>
          <td>${escapeHtml(a.reason)}</td>
          <td>${formatDate(a.createdAt)}</td>
          <td><input type="text" class="decision-reason" aria-label="Reason for your decision" placeholder="Required" /></td>
          <td class="table-actions">
            <button type="button" class="decide-btn" data-decision="approve">Approve</button>
            <button type="button" class="secondary decide-btn" data-decision="reject">Reject</button>
          </td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      row.querySelectorAll('.decide-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          hideAlert('approvals-alert');
          hideAlert('approvals-success');
          const reason = row.querySelector('.decision-reason').value.trim();
          if (reason.length < 3) {
            showAlert('approvals-alert', 'Give a reason for your decision.');
            return;
          }
          row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try {
            await apiRequest(`/admin/approvals/${row.dataset.id}/decision`, {
              method: 'POST',
              body: { decision: btn.dataset.decision, reason },
              auth: true,
            });
            showAlert('approvals-success', btn.dataset.decision === 'approve' ? 'Refund approved and issued.' : 'Request rejected.');
            await loadApprovals();
          } catch (err) {
            showAlert('approvals-alert', err.message);
            row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          }
        });
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('approvals-alert', err.message);
  }
}

document.getElementById('approvals-refresh').addEventListener('click', loadApprovals);

// --- Audit Log ---
function describeChange(entry) {
  const parts = [];
  if (entry.before && Object.keys(entry.before).length) parts.push(`before ${JSON.stringify(entry.before)}`);
  if (entry.after && Object.keys(entry.after).length) parts.push(`after ${JSON.stringify(entry.after)}`);
  return escapeHtml(parts.join(' → ') || '—');
}

async function loadAudit() {
  hideAlert('audit-alert');
  const container = document.getElementById('audit-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  const action = document.getElementById('audit-filter-action').value;
  const query = action ? `?action=${encodeURIComponent(action)}` : '';

  try {
    const entries = await apiRequest(`/admin/audit${query}`, { auth: true });
    container.innerHTML = renderTable({
      columns: ['When', 'Who', 'Action', 'Target', 'Change', 'Reason'],
      emptyMessage: 'No audit entries match this filter.',
      rows: entries.map((e) => `
        <tr>
          <td>${formatDate(e.createdAt)}</td>
          <td>${escapeHtml(e.actor?.name || '—')} <span class="field-help">(${escapeHtml(e.actorRole)})</span></td>
          <td><code>${escapeHtml(e.action)}</code></td>
          <td>${escapeHtml(e.targetType)} <code>${shortId(e.targetId)}</code></td>
          <td style="font-size: 0.82rem;">${describeChange(e)}</td>
          <td>${escapeHtml(e.reason)}</td>
        </tr>
      `),
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('audit-alert', err.message);
  }
}

document.getElementById('audit-refresh').addEventListener('click', loadAudit);
document.getElementById('audit-filter-apply').addEventListener('click', loadAudit);

// --- Staff Accounts ---
async function loadStaff() {
  hideAlert('staff-alert');
  const container = document.getElementById('staff-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';

  try {
    const staff = await apiRequest('/admin/users', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Name', 'Email', 'Role', 'Status', 'Created', ''],
      emptyMessage: 'No staff accounts yet.',
      rows: staff.map((u) => `
        <tr data-id="${escapeHtml(u.id)}" data-active="${u.active}">
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.role)}</td>
          <td>${u.active ? statusBadge('Active', 'good') : statusBadge('Deactivated', 'bad')}</td>
          <td>${formatDate(u.createdAt)}</td>
          <td class="table-actions">
            <button type="button" class="secondary toggle-staff-btn">${u.active ? 'Deactivate' : 'Re-activate'}</button>
          </td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      row.querySelector('.toggle-staff-btn').addEventListener('click', async (event) => {
        hideAlert('staff-alert');
        hideAlert('staff-success');
        const activate = row.dataset.active !== 'true';
        const reason = window.prompt(activate ? 'Reason for re-activating this account:' : 'Reason for deactivating this account:');
        if (!reason || reason.trim().length < 3) return;
        event.target.disabled = true;
        try {
          await apiRequest(`/admin/users/${row.dataset.id}`, {
            method: 'PATCH',
            body: { active: activate, reason: reason.trim() },
            auth: true,
          });
          showAlert('staff-success', activate ? 'Account re-activated.' : 'Account deactivated.');
          await loadStaff();
        } catch (err) {
          showAlert('staff-alert', err.message);
          event.target.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('staff-alert', err.message);
  }
}

document.getElementById('staff-refresh').addEventListener('click', loadStaff);

document.getElementById('create-staff-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('staff-alert');
  hideAlert('staff-success');
  try {
    await apiRequest('/admin/users', {
      method: 'POST',
      body: {
        name: document.getElementById('staff-name').value.trim(),
        email: document.getElementById('staff-email').value.trim(),
        password: document.getElementById('staff-password').value,
        role: document.getElementById('staff-role').value,
      },
      auth: true,
    });
    event.target.reset();
    showAlert('staff-success', 'Staff account created.');
    await loadStaff();
  } catch (err) {
    showAlert('staff-alert', err.message);
  }
});

// --- Init ---
populatePaymentStatusFilter();
loadOverview();
loadPaymentsQueue();
loadCleaners();
loadJobs();
loadServiceTypes();
loadApprovals();
loadAudit();
loadStaff();
