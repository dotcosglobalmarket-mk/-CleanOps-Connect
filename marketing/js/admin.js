import { apiRequest, apiFetchBlob, requireRole, startImpersonation } from './api.js';
import { escapeHtml } from './dom.js';
import { mountJobPhotos } from './job-photos.js';
import {
  PAYMENT_STATES,
  showAlert,
  hideAlert,
  renderTable,
  statusBadge,
  paymentStatusBadge,
  formatPence,
  formatDate,
  formatVisit,
  shortId,
  setupTabs,
} from './dashboard-ui.js';

requireRole('admin');

setupTabs((panel) => {
  if (panel === 'revenue') loadRevenue();
  if (panel === 'documents') loadDocuments();
  if (panel === 'subscriptions') loadSubscriptions();
});

// --- Subscriptions ---
const SUBSCRIPTION_PLANS = { starter: 'Starter', pro: 'Pro', industrial_pro: 'Industrial Pro' };

async function refreshSubscriptionsBadge() {
  try {
    const waiting = await apiRequest('/admin/subscriptions?status=requested', { auth: true });
    const badge = document.getElementById('subscriptions-pending');
    badge.textContent = waiting.length;
    badge.hidden = waiting.length === 0;
  } catch (err) {
    // The badge is a convenience; the panel shows any real error.
  }
}

function subscriptionState(sub) {
  if (!sub.isActive) return statusBadge('Ended', 'bad');
  if (sub.cancelAtPeriodEnd) return statusBadge('Ending', 'warn');
  return statusBadge(sub.stripeStatus === 'past_due' ? 'Past due' : 'Active', sub.stripeStatus === 'past_due' ? 'warn' : 'good');
}

function subscriptionRequest(sub) {
  if (!sub.cancellationRequestedAt || sub.cancelAtPeriodEnd || !sub.isActive) return '—';
  const reason = sub.cancellationReason ? `<div class="field-help">${escapeHtml(sub.cancellationReason)}</div>` : '';
  return `<div class="sub-request">${statusBadge('Requested', 'warn')} ${formatDate(sub.cancellationRequestedAt)}${reason}</div>`;
}

function subscriptionActions(sub) {
  if (!sub.isActive) return '';
  const buttons = [];
  if (!sub.cancelAtPeriodEnd) {
    buttons.push('<button type="button" class="secondary sub-cancel-btn" data-when="period_end">Cancel at renewal</button>');
  }
  buttons.push('<button type="button" class="secondary sub-cancel-btn" data-when="now">Cancel now</button>');
  if (sub.cancellationRequestedAt && !sub.cancelAtPeriodEnd) {
    buttons.push('<button type="button" class="secondary sub-decline-btn">Decline request</button>');
  }
  return buttons.join('');
}

async function loadSubscriptions() {
  hideAlert('subscriptions-alert');
  const container = document.getElementById('subscriptions-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  const status = document.getElementById('subscriptions-filter-status').value;
  try {
    const subs = await apiRequest(`/admin/subscriptions?status=${encodeURIComponent(status)}`, { auth: true });
    container.innerHTML = renderTable({
      fit: true,
      columns: ['Cleaner', 'Email', 'Plan', 'Status', 'Renews', 'Cancellation request', ''],
      emptyMessage: status === 'requested' ? 'No cancellation requests waiting.' : 'No subscriptions match this filter.',
      rows: subs.map((sub) => `
        <tr data-id="${escapeHtml(sub._id)}" data-requested-reason="${escapeHtml(sub.cancellationReason || '')}">
          <td>${escapeHtml(sub.cleaner?.name || '—')}</td>
          <td><span class="wrap-anywhere">${escapeHtml(sub.cleaner?.user?.email || '—')}</span></td>
          <td>${escapeHtml(SUBSCRIPTION_PLANS[sub.plan] || sub.plan)} · ${formatPence(sub.pricePence)}/mo</td>
          <td>${subscriptionState(sub)}</td>
          <td>${sub.renewsAt ? new Date(sub.renewsAt).toLocaleDateString('en-GB') : '—'}</td>
          <td>${subscriptionRequest(sub)}</td>
          <td class="table-actions">${subscriptionActions(sub)}</td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      const id = row.dataset.id;
      const name = row.children[0].textContent;
      row.querySelectorAll('.sub-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const now = btn.dataset.when === 'now';
          if (now && !window.confirm(`Cancel ${name}'s subscription now? Billing stops immediately and no refund is issued.`)) return;
          decideSubscription(btn, `/admin/subscriptions/${id}/cancel`, {
            prompt: now ? 'Reason for cancelling now (recorded in the audit log):' : 'Reason for cancelling at renewal (recorded in the audit log):',
            suggestion: row.dataset.requestedReason,
            body: { when: btn.dataset.when },
            done: now ? 'Subscription cancelled.' : 'Subscription will end at its next renewal.',
          });
        });
      });
      const decline = row.querySelector('.sub-decline-btn');
      if (decline) {
        decline.addEventListener('click', () =>
          decideSubscription(decline, `/admin/subscriptions/${id}/decline-cancellation`, {
            prompt: 'Reason for declining this request (recorded in the audit log):',
            body: {},
            done: 'Request declined; the subscription carries on.',
          })
        );
      }
    });
  } catch (err) {
    container.innerHTML = '';
    showAlert('subscriptions-alert', err.message);
  }
}

async function decideSubscription(button, path, { prompt, suggestion = '', body, done }) {
  hideAlert('subscriptions-alert');
  document.getElementById('subscriptions-success').hidden = true;
  const reason = window.prompt(prompt, suggestion);
  if (!reason || reason.trim().length < 3) return;
  button.disabled = true;
  try {
    await apiRequest(path, { method: 'POST', body: { ...body, reason: reason.trim() }, auth: true });
    const success = document.getElementById('subscriptions-success');
    success.textContent = done;
    success.hidden = false;
    await Promise.all([loadSubscriptions(), refreshSubscriptionsBadge()]);
  } catch (err) {
    showAlert('subscriptions-alert', err.message);
    button.disabled = false;
  }
}

document.getElementById('subscriptions-refresh').addEventListener('click', () => {
  loadSubscriptions();
  refreshSubscriptionsBadge();
});
document.getElementById('subscriptions-filter-apply').addEventListener('click', loadSubscriptions);
refreshSubscriptionsBadge();

// --- Document review ---
const DOC_LABELS = { dbs: 'DBS certificate', coshh: 'COSHH certificate', insurance: 'Insurance certificate' };
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function documentBadge(status) {
  const kind = { pending: 'warn', approved: 'good', rejected: 'bad', expired: 'bad', withdrawn: 'warn' }[status];
  return statusBadge(status === 'pending' ? 'waiting' : status, kind);
}

async function refreshPendingBadge() {
  try {
    const pending = await apiRequest('/admin/compliance-documents?status=pending', { auth: true });
    const badge = document.getElementById('documents-pending');
    badge.textContent = pending.length;
    badge.hidden = pending.length === 0;
  } catch (err) {
    // The badge is a convenience; the panel shows any real error.
  }
}

async function loadDocuments() {
  hideAlert('documents-alert');
  document.getElementById('document-review').hidden = true;
  const container = document.getElementById('documents-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  const status = document.getElementById('documents-filter-status').value;
  try {
    const docs = await apiRequest(`/admin/compliance-documents?status=${status}`, { auth: true });
    container.innerHTML = renderTable({
      fit: true,
      columns: ['Cleaner', 'Document', 'File', 'Uploaded', 'Status', ''],
      emptyMessage: status === 'pending' ? 'Nothing waiting for review.' : 'No documents match this filter.',
      rows: docs.map((d) => `
        <tr>
          <td>${escapeHtml(d.cleaner ? d.cleaner.name : 'Unknown')}</td>
          <td>${escapeHtml(DOC_LABELS[d.type] || d.type)}</td>
          <td>${escapeHtml(d.originalName || '')}</td>
          <td>${formatDate(d.uploadedAt)}</td>
          <td>${documentBadge(d.status)}${d.status === 'approved' && d.expiresAt ? ` <span class="field-help">to ${new Date(d.expiresAt).toLocaleDateString('en-GB')}</span>` : ''}</td>
          <td class="table-actions"><button type="button" class="secondary document-open-btn" data-id="${d._id}">${d.status === 'pending' ? 'Review' : 'View'}</button></td>
        </tr>`),
    });
    container.querySelectorAll('.document-open-btn').forEach((btn) => {
      const doc = docs.find((d) => d._id === btn.dataset.id);
      btn.addEventListener('click', () => openDocumentReview(doc));
    });
    refreshPendingBadge();
  } catch (err) {
    container.innerHTML = '';
    showAlert('documents-alert', err.message);
  }
}

// Opens the file in a new tab. The tab is opened first, on the click, so the
// browser does not block it, then pointed at the file once it has downloaded.
async function viewDocumentFile(doc) {
  const tab = window.open('', '_blank');
  try {
    const blob = await apiFetchBlob(`/admin/compliance-documents/${doc._id}/file`);
    if (!ALLOWED_FILE_TYPES.includes(blob.type)) throw new Error('This file is not a PDF or image, so it was not opened.');
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (tab) tab.close();
    showAlert('documents-alert', err.message);
  }
}

function openDocumentReview(doc) {
  const box = document.getElementById('document-review');
  const c = doc.cleaner || {};
  const yes = (v) => (v ? statusBadge('yes', 'good') : statusBadge('no', 'warn'));
  const pending = doc.status === 'pending';
  box.innerHTML = `
    <div class="job-detail-head">
      <h3>${escapeHtml(DOC_LABELS[doc.type] || doc.type)} — ${escapeHtml(c.name || 'Unknown')}</h3>
      <button type="button" class="secondary" id="document-review-close">Close</button>
    </div>
    <dl class="job-detail-list">
      <dt>File</dt><dd>${escapeHtml(doc.originalName || '')} (${Math.round(doc.sizeBytes / 1024)} KB)</dd>
      <dt>Uploaded</dt><dd>${formatDate(doc.uploadedAt)}</dd>
      <dt>Status</dt><dd>${documentBadge(doc.status)}${doc.rejectionReason ? ` — ${escapeHtml(doc.rejectionReason)}` : ''}</dd>
      <dt>Cleaner today</dt><dd>DBS ${yes(c.dbsVerified)} · COSHH ${yes(c.coshhTrained)} · Insurance ${statusBadge(c.insuranceStatus || 'none', c.insuranceStatus && c.insuranceStatus !== 'none' ? 'good' : 'warn')}</dd>
    </dl>
    ${doc.fileAvailable
      ? '<p><button type="button" id="document-view-file">Open the file</button> <span class="field-help">Opening it is recorded in the audit log.</span></p>'
      : '<p class="field-help">The file has been deleted. The decision record is kept.</p>'}
    ${doc.fileAvailable ? `
      <details class="document-erase">
        <summary>Delete this file (cleaner withdrew consent or asked for erasure)</summary>
        <p class="field-help">The file is removed straight away and cannot be recovered. The decision record stays. The cleaner's badge is not changed: do that under Cleaner Verification if it should go too.</p>
        <div class="form-row"><label for="document-delete-reason">Reason</label><input id="document-delete-reason" type="text" maxlength="500" placeholder="e.g. Cleaner emailed to withdraw consent" /></div>
        <p><button type="button" class="secondary" id="document-delete">Delete the file</button></p>
      </details>` : ''}
    ${pending ? `
      <h4>Decision</h4>
      ${doc.type !== 'dbs' ? `<div class="form-row"><label for="document-expiry">Expiry date on the certificate${doc.type === 'insurance' ? '' : ' (if it has one)'}</label><input id="document-expiry" type="date" /></div>` : ''}
      <div class="form-row"><label for="document-reason">Reason (needed to reject)</label><textarea id="document-reason" rows="2" maxlength="500" placeholder="e.g. The name on the certificate does not match the profile"></textarea></div>
      <p><button type="button" id="document-approve">Approve</button> <button type="button" class="secondary" id="document-reject">Reject</button></p>` : ''}`;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('document-review-close').addEventListener('click', () => { box.hidden = true; });
  const viewBtn = document.getElementById('document-view-file');
  if (viewBtn) viewBtn.addEventListener('click', () => viewDocumentFile(doc));
  const deleteBtn = document.getElementById('document-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      hideAlert('documents-alert');
      const reason = document.getElementById('document-delete-reason').value.trim();
      if (reason.length < 3) {
        showAlert('documents-alert', 'Say why the file is being deleted.');
        return;
      }
      if (!window.confirm('Delete this file permanently? This cannot be undone.')) return;
      try {
        await apiRequest(`/admin/compliance-documents/${doc._id}/file`, { method: 'DELETE', body: { reason }, auth: true });
        const ok = document.getElementById('documents-success');
        ok.textContent = 'The file has been deleted. The decision record is kept.';
        ok.hidden = false;
        await loadDocuments();
      } catch (err) {
        showAlert('documents-alert', err.message);
      }
    });
  }
  if (pending) {
    const decide = async (decision) => {
      hideAlert('documents-alert');
      const expiry = document.getElementById('document-expiry');
      const reason = document.getElementById('document-reason').value.trim();
      if (decision === 'reject' && reason.length < 3) {
        showAlert('documents-alert', 'Say why it is being rejected.');
        return;
      }
      if (decision === 'approve' && doc.type === 'insurance' && !expiry.value) {
        showAlert('documents-alert', 'Enter the date the insurance runs out.');
        return;
      }
      const body = { decision };
      if (reason) body.reason = reason;
      if (decision === 'approve' && expiry && expiry.value) body.expiresAt = expiry.value;
      try {
        await apiRequest(`/admin/compliance-documents/${doc._id}/review`, { method: 'POST', body, auth: true });
        const ok = document.getElementById('documents-success');
        ok.textContent = decision === 'approve' ? 'Approved. The badge is now on their profile.' : 'Rejected. The cleaner has been emailed the reason.';
        ok.hidden = false;
        await loadDocuments();
      } catch (err) {
        showAlert('documents-alert', err.message);
      }
    };
    document.getElementById('document-approve').addEventListener('click', () => decide('approve'));
    document.getElementById('document-reject').addEventListener('click', () => decide('reject'));
  }
}

document.getElementById('documents-refresh').addEventListener('click', loadDocuments);
document.getElementById('documents-filter-apply').addEventListener('click', loadDocuments);
refreshPendingBadge();

// --- Revenue ---
let revenueRange = '30d';
let revenueData = null;

function revenueTile(label, value, note, kind, tone, icon) {
  return `
    <div class="stat-tile${tone ? ` stat-tile-${tone}` : ''}">
      ${icon ? `<span class="stat-tile-icon">${icon}</span>` : ''}
      <div class="stat-tile-label">${escapeHtml(label)}</div>
      <div class="stat-tile-value${kind ? ` revenue-${kind}` : ''}">${escapeHtml(value)}</div>
      <div class="field-help">${escapeHtml(note)}</div>
    </div>`;
}

function changeNote(total, previous) {
  if (!previous) return total ? 'No earlier period to compare' : 'Nothing yet this period';
  const pct = Math.round(((total - previous) / previous) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs the previous period`;
}

function renderRevenue(data) {
  const t = data.totals;
  document.getElementById('revenue-tiles').innerHTML = [
    revenueTile('Total platform revenue', formatPence(t.totalPence), changeNote(t.totalPence, t.previousTotalPence), t.totalPence >= t.previousTotalPence && t.previousTotalPence ? 'good' : '', 'green', '💷'),
    revenueTile(
      'Commission on jobs',
      formatPence(t.commissionPence),
      `from ${t.jobsCount} confirmed job${t.jobsCount === 1 ? '' : 's'}${t.recurringVisitsCount ? `, ${formatPence(t.recurringCommissionPence)} of it from ${t.recurringVisitsCount} regular visit${t.recurringVisitsCount === 1 ? '' : 's'}` : ''}${t.activeSeriesCount ? ` · ${t.activeSeriesCount} regular booking${t.activeSeriesCount === 1 ? '' : 's'} running` : ''}`,
      '',
      'teal',
      '🧾'
    ),
    revenueTile('Subscription income', formatPence(t.subscriptionBilledPence), `${formatPence(t.mrrPence)} a month from ${t.activeSubscribers} active cleaner${t.activeSubscribers === 1 ? '' : 's'}`, '', 'purple', '🔁'),
    revenueTile('Failed payments', String(t.failedCount), `${formatPence(t.atRiskPence)} a month at risk`, t.failedCount ? 'bad' : '', t.failedCount ? 'red' : 'blue', '⚠️'),
  ].join('');

  const top = Math.max(1, ...data.weeks.map((w) => w.commissionPence + w.subscriptionPence));
  document.getElementById('revenue-chart').innerHTML = data.weeks
    .map((w) => {
      const label = new Date(w.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const total = formatPence(w.commissionPence + w.subscriptionPence);
      const c = Math.round((w.commissionPence / top) * 120);
      const sub = Math.round((w.subscriptionPence / top) * 120);
      return `<div title="Week from ${label}: ${total}"><span class="bar-sub" style="height:${sub}px"></span><span class="bar-com" style="height:${c}px"></span>${escapeHtml(label)}</div>`;
    })
    .join('');

  document.getElementById('revenue-plans').innerHTML = renderTable({
      fit: true,
    columns: ['Plan', 'Cleaners', 'Monthly'],
    emptyMessage: 'No active subscriptions yet.',
    rows: data.plans.map((p) => `<tr><td>${escapeHtml(p.label)}</td><td>${p.cleaners}</td><td>${formatPence(p.monthlyPence)}</td></tr>`),
  });

  document.getElementById('revenue-atrisk').innerHTML = renderTable({
      fit: true,
    columns: ['Cleaner', 'Plan', 'Status', 'Failed on', 'Next retry', 'At risk', ''],
    emptyMessage: 'No failed subscription payments right now.',
    rows: data.atRisk.map((r) => `
      <tr>
        <td>${escapeHtml(r.cleaner)}</td>
        <td>${escapeHtml(r.planLabel)}</td>
        <td>${statusBadge(r.status.replace('_', ' '), 'bad')}</td>
        <td>${r.failedOn ? formatDate(r.failedOn) : '—'}</td>
        <td>${r.nextRetryAt ? formatDate(r.nextRetryAt) : '—'}</td>
        <td>${formatPence(r.amountPence)}</td>
        <td class="table-actions"><button type="button" class="secondary revenue-view-cleaner">View cleaner</button></td>
      </tr>`),
  });
  document.querySelectorAll('.revenue-view-cleaner').forEach((btn) =>
    btn.addEventListener('click', () => document.querySelector('[data-panel="cleaners"]').click())
  );

  document.getElementById('revenue-recent-note').textContent = data.recentPayments.length
    ? 'Latest charges recorded from Stripe.'
    : 'Payments appear here from the moment Stripe starts sending invoice events to this site. Nothing recorded yet.';
  document.getElementById('revenue-recent').innerHTML = renderTable({
      fit: true,
    columns: ['Date', 'Cleaner', 'Plan', 'Result', 'Amount'],
    emptyMessage: 'No subscription payments recorded yet.',
    rows: data.recentPayments.map((p) => `
      <tr>
        <td>${formatDate(p.occurredAt)}</td>
        <td>${escapeHtml(p.cleaner)}</td>
        <td>${escapeHtml(p.planLabel)}</td>
        <td>${statusBadge(p.status, p.status === 'paid' ? 'good' : 'bad')}</td>
        <td>${formatPence(p.amountPence)}</td>
      </tr>`),
  });
}

async function loadRevenue() {
  hideAlert('revenue-alert');
  try {
    revenueData = await apiRequest(`/admin/revenue?range=${revenueRange}`, { auth: true });
    renderRevenue(revenueData);
  } catch (err) {
    showAlert('revenue-alert', err.message);
  }
}

// A cleaner name can start with =, +, - or @, which a spreadsheet would run as a formula.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportRevenueCsv() {
  if (!revenueData) return;
  const money = (p) => (typeof p === 'number' ? (p / 100).toFixed(2) : '');
  const rows = [['Section', 'Date', 'Cleaner', 'Plan', 'Status', 'Commission (GBP)', 'Subscriptions (GBP)', 'Amount (GBP)']];
  revenueData.weeks.forEach((w) =>
    rows.push(['Week', new Date(w.from).toISOString().slice(0, 10), '', '', '', money(w.commissionPence), money(w.subscriptionPence), money(w.commissionPence + w.subscriptionPence)])
  );
  revenueData.atRisk.forEach((r) =>
    rows.push(['At risk', r.failedOn ? new Date(r.failedOn).toISOString().slice(0, 10) : '', r.cleaner, r.planLabel, r.status, '', '', money(r.amountPence)])
  );
  revenueData.recentPayments.forEach((p) =>
    rows.push(['Payment', new Date(p.occurredAt).toISOString().slice(0, 10), p.cleaner, p.planLabel, p.status, '', '', money(p.amountPence)])
  );
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `cleanops-revenue-${revenueRange}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelectorAll('.revenue-range [data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    revenueRange = btn.dataset.range;
    document.querySelectorAll('.revenue-range [data-range]').forEach((b) => b.classList.toggle('is-active', b === btn));
    loadRevenue();
  });
});
document.getElementById('revenue-export').addEventListener('click', exportRevenueCsv);

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
      fit: true,
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
      fit: true,
      columns: ['Name', 'Email', 'DBS', 'COSHH', 'Insurance', 'Payouts', 'Status', ''],
      emptyMessage: 'No cleaners match this filter.',
      rows: cleaners.map((c) => `
        <tr data-cleaner-id="${c._id}">
          <td>${escapeHtml(c.name)}</td>
          <td><span class="wrap-anywhere">${escapeHtml(c.user?.email || '—')}</span></td>
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
            <button type="button" class="secondary view-as-cleaner-btn">View as cleaner</button>
            ${c.stripeConnectedAccountId ? '<button type="button" class="secondary reset-payouts-btn">Reset payout set-up</button>' : ''}
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

      row.querySelector('.reset-payouts-btn')?.addEventListener('click', async (event) => {
        const btn = event.target;
        const reason = window.prompt(
          'Reset this cleaner’s payout set-up? They will have to set up payouts again. Reason (e.g. account created in test mode):'
        );
        if (!reason || reason.trim().length < 3) return;
        btn.disabled = true;
        hideAlert('cleaners-alert');
        document.getElementById('cleaners-success').hidden = true;
        try {
          await apiRequest(`/admin/cleaners/${id}/reset-payouts`, { method: 'POST', body: { reason: reason.trim() }, auth: true });
          await loadCleaners();
          const successEl = document.getElementById('cleaners-success');
          successEl.textContent = 'Payout set-up reset. The cleaner can set it up again from Earnings & Payouts.';
          successEl.hidden = false;
        } catch (err) {
          showAlert('cleaners-alert', err.message);
          btn.disabled = false;
        }
      });

      row.querySelector('.view-as-cleaner-btn').addEventListener('click', async (event) => {
        const btn = event.target;
        const reason = window.prompt(
          'Why are you viewing this cleaner’s dashboard? (e.g. a support ticket reference)'
        );
        if (!reason || !reason.trim()) return;

        btn.disabled = true;
        hideAlert('cleaners-alert');
        try {
          const { token, cleaner } = await apiRequest(`/admin/cleaners/${id}/impersonate`, {
            method: 'POST',
            body: { reason: reason.trim() },
            auth: true,
          });
          startImpersonation(token, cleaner);
          window.location.href = 'cleaner.html';
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

const FREQUENCY_LABELS = { one_off: 'One-off', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };

function renderJobDetail(job) {
  const pence = (n) => (typeof n === 'number' ? formatPence(n) : '—');
  const budget = typeof job.budgetMin === 'number' ? `£${job.budgetMin} – £${job.budgetMax}` : '—';
  const sections = [
    ['Job', [
      ['Reference', `<code>${escapeHtml(String(job._id || '').slice(-8))}</code>`],
      ['Service', escapeHtml(job.serviceType?.name || '—')],
      ['Category', escapeHtml(job.category || '—')],
      ['Status', statusBadge(job.status, job.status === 'cancelled' ? 'bad' : job.status === 'completed' ? 'good' : 'warn')],
      ['Booking type', job.procurement === 'tender' ? 'Tender (quotes)' : 'Standard'],
      ['Created', formatDate(job.createdAt)],
    ]],
    ['Customer and cleaner', [
      ['Customer', `${escapeHtml(job.customer?.name || '—')}${job.customer?.email ? ` (${escapeHtml(job.customer.email)})` : ''}`],
      ['Cleaner', job.cleaner ? escapeHtml(job.cleaner.name || '—') : 'Not yet assigned'],
    ]],
    ['The work', [
      ['Postcode', escapeHtml((job.postcode || '—').toUpperCase())],
      ['Description', escapeHtml(job.description || '—')],
      ['Estimated hours', escapeHtml(job.estimatedHours ?? '—')],
      ['Preferred date and time', escapeHtml(formatVisit(job.preferredStartAt))],
      ['Frequency', escapeHtml(FREQUENCY_LABELS[job.frequency] || job.frequency || '—')],
      ['Customer budget', budget],
    ]],
    ['Payment', [
      ['Payment status', job.paymentStatus ? paymentStatusBadge(job.paymentStatus) : 'No payment yet'],
      ['Agreed price', pence(job.pricePence)],
      ['Platform commission', pence(job.commissionPence)],
      ['Cleaner payout', pence(job.cleanerPayoutPence)],
    ]],
  ];
  const offers = job.offers || [];
  const canRerun = !job.cleaner && !job.paymentStatus && !['completed', 'cancelled'].includes(job.status);
  sections.push([`Cleaners allocated (${offers.length})`, offers.length
    ? offers.map((o, i) => [
        `${i + 1}. ${escapeHtml(o.cleaner?.companyName || o.cleaner?.name || 'Unknown cleaner')}`,
        `${statusBadge(o.status, o.status === 'accepted' ? 'good' : o.status === 'declined' || o.status === 'expired' ? 'bad' : 'warn')} ` +
          `match score ${escapeHtml(Math.round(o.score ?? 0))}` +
          `${o.cleaner?.basePostcode ? ` · base ${escapeHtml(o.cleaner.basePostcode.toUpperCase())}` : ''}` +
          `${typeof o.quotePricePence === 'number' ? ` · quote ${formatPence(o.quotePricePence)}` : ''}`,
      ])
    : [['—', 'No cleaners were matched to this job.']]]);
  if (job.allocation) sections.push(['Why cleaners were or were not matched', allocationRows(job.allocation)]);
  if (job.disputeReason) {
    sections.push(['Dispute', [
      ['Reason', escapeHtml(job.disputeReason)],
      ['Detail', escapeHtml(job.disputeDetail || '—')],
      ['Raised', formatDate(job.disputedAt)],
    ]]);
  }
  const box = document.getElementById('job-detail');
  box.innerHTML = `
    <div class="job-detail-head">
      <h3>Job details</h3>
      <div class="job-detail-actions">
        ${canRerun ? '<button type="button" id="job-detail-rerun">Re-run allocation</button>' : ''}
        <button type="button" class="secondary" id="job-detail-close">Close</button>
      </div>
    </div>
    ${sections.map(([title, rows]) => `
      <h4>${title}</h4>
      <dl class="job-detail-list">
        ${rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}
      </dl>`).join('')}
    <h4>Photos</h4>
    <div id="job-detail-photos"></div>`;
  box.hidden = false;
  mountJobPhotos(document.getElementById('job-detail-photos'), { jobId: job._id, staff: true });
  document.getElementById('job-detail-close').addEventListener('click', () => { box.hidden = true; });
  const rerun = document.getElementById('job-detail-rerun');
  if (rerun) {
    rerun.addEventListener('click', async () => {
      rerun.disabled = true;
      hideAlert('jobs-alert');
      try {
        const result = await apiRequest(`/admin/jobs/${job._id}/allocate`, { method: 'POST', auth: true });
        const sent = result.offers.length;
        showAlert('jobs-alert', sent ? `Sent to ${sent} cleaner${sent === 1 ? '' : 's'}.` : 'Still no cleaner matches. See the reasons below.');
        renderJobDetail(await apiRequest(`/admin/jobs/${job._id}`, { auth: true }));
      } catch (err) {
        showAlert('jobs-alert', err.message);
        rerun.disabled = false;
      }
    });
  }
}

// One line per rule that can stop a cleaner who offers the service. Each
// cleaner is counted once, against the first rule that stopped them.
function allocationRows(a) {
  const rows = [['Offer this service', `${a.offeringService} cleaner${a.offeringService === 1 ? '' : 's'}`]];
  const reasons = [
    [a.suspended, 'Suspended'],
    [a.unavailable, 'Switched to unavailable'],
    [a.alreadyOffered, 'Already offered this job'],
    [a.outOfCoverage - a.coverageNotSet, 'Job is outside their coverage area'],
    [a.coverageNotSet, 'No coverage radius or location saved on their profile'],
    [a.uninsured, 'No insurance, which this job requires'],
  ];
  reasons.forEach(([count, label]) => {
    if (count > 0) rows.push([escapeHtml(label), String(count)]);
  });
  rows.push(['Could be offered the job now', String(a.eligible)]);
  if (a.offeringService === 0) rows.push(['Note', 'No cleaner has this service ticked on their profile.']);
  return rows;
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
      fit: true,
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
          renderJobDetail(job);
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
      fit: true,
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
      fit: true,
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
      fit: true,
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
      fit: true,
      columns: ['Name', 'Email', 'Role', 'Status', 'Two-step login', 'Created', ''],
      emptyMessage: 'No staff accounts yet.',
      rows: staff.map((u) => `
        <tr data-id="${escapeHtml(u.id)}" data-active="${u.active}">
          <td>${escapeHtml(u.name)}</td>
          <td><span class="wrap-anywhere">${escapeHtml(u.email)}</span></td>
          <td>${escapeHtml(u.role)}</td>
          <td>${u.active ? statusBadge('Active', 'good') : statusBadge('Deactivated', 'bad')}</td>
          <td>${u.twoFactorEnabled ? statusBadge('On', 'good') : statusBadge(u.role === 'admin' ? 'Not set up' : 'Off', u.role === 'admin' ? 'warn' : '')}</td>
          <td>${formatDate(u.createdAt)}</td>
          <td class="table-actions">
            ${u.twoFactorEnabled ? '<button type="button" class="secondary reset-2fa-btn">Reset two-step</button>' : ''}
            <button type="button" class="secondary toggle-staff-btn">${u.active ? 'Deactivate' : 'Re-activate'}</button>
          </td>
        </tr>
      `),
    });

    container.querySelectorAll('tr[data-id]').forEach((row) => {
      const resetBtn = row.querySelector('.reset-2fa-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
          hideAlert('staff-alert');
          hideAlert('staff-success');
          const reason = window.prompt('Reason for resetting this person\'s two-step login (they will set it up again at their next sign-in):');
          if (!reason || reason.trim().length < 3) return;
          resetBtn.disabled = true;
          try {
            await apiRequest(`/admin/users/${row.dataset.id}/reset-two-factor`, { method: 'POST', body: { reason: reason.trim() }, auth: true });
            showAlert('staff-success', 'Two-step login reset. They will set it up again when they next sign in.');
            await loadStaff();
          } catch (err) {
            showAlert('staff-alert', err.message);
            resetBtn.disabled = false;
          }
        });
      }
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
