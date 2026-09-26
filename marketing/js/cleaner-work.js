import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';
import { showAlert, hideAlert, renderTable, statusBadge, formatPence, formatDate } from './dashboard-ui.js';

// Offers inbox, booked jobs, earnings and Stripe payouts for the cleaner
// dashboard. The profile/coverage tabs live in cleaner.js.

const FREQUENCY = { one_off: 'One-off', weekly: 'Weekly', monthly: 'Monthly', contract: 'Contract' };

const JOB_STATUS = {
  BOOKED: ['Waiting for customer payment', 'warn'],
  PAID_HELD: ['Paid — ready to start', 'good'],
  IN_PROGRESS: ['In progress', 'warn'],
  AWAITING_CONFIRMATION: ['Waiting for customer to confirm', 'warn'],
  DISPUTED: ['Problem reported — under review', 'bad'],
  CONFIRMED: ['Confirmed', 'good'],
  PAYOUT_PENDING: ['Payout processing', 'good'],
  PAYOUT_BLOCKED: ['Set up payouts to get paid', 'bad'],
  TRANSFER_FAILED: ['Payout retrying', 'warn'],
  MANUAL_REVIEW_HOLD: ['Payout on hold — our team is checking', 'warn'],
  PAID_OUT: ['Paid out', 'good'],
  CANCELLED: ['Cancelled', 'bad'],
  CANCELLED_BY_CLEANER: ['Cancelled by you', 'bad'],
  CANCELLED_BY_CUSTOMER: ['Cancelled by customer', 'bad'],
  REFUNDED: ['Refunded to customer', 'bad'],
  PARTIALLY_REFUNDED: ['Cancelled — partly refunded', 'bad'],
};

function jobStatusBadge(paymentStatus) {
  const [label, kind] = JOB_STATUS[paymentStatus] || [paymentStatus || '—', 'warn'];
  return statusBadge(label, kind);
}

// --- Offers ---
async function loadOffers() {
  hideAlert('offers-alert');
  const container = document.getElementById('offers-list');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const offers = await apiRequest('/cleaners/me/offers?status=sent', { auth: true });
    const open = offers.filter((o) => !o.job.booked);
    if (!open.length) {
      container.innerHTML = '<div class="table-empty">No open offers right now. We email you when a new one arrives.</div>';
      return;
    }
    container.innerHTML = open
      .map((o) => {
        const j = o.job;
        return `
        <article class="card offer-card" data-offer="${escapeHtml(o._id)}" data-job="${escapeHtml(j._id)}">
          <h3>${escapeHtml(j.serviceType?.name || 'Cleaning')} · ${escapeHtml(j.area || '')}</h3>
          <dl class="detail-grid">
            <div><dt>Distance</dt><dd>${o.distanceKm !== undefined ? `${escapeHtml(o.distanceKm)} km` : '—'}</dd></div>
            <div><dt>Customer budget</dt><dd>£${escapeHtml(j.budgetMin)}–£${escapeHtml(j.budgetMax)}</dd></div>
            <div><dt>Frequency</dt><dd>${escapeHtml(FREQUENCY[j.frequency] || 'One-off')}</dd></div>
            <div><dt>Estimated hours</dt><dd>${j.estimatedHours ? escapeHtml(j.estimatedHours) : '—'}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(j.category)}</dd></div>
            <div><dt>Offered</dt><dd>${formatDate(o.createdAt)}</dd></div>
          </dl>
          ${j.description ? `<p>${escapeHtml(j.description)}</p>` : ''}
          <form class="accept-form">
            <div class="form-row">
              <label for="price-${escapeHtml(o._id)}">Your price for this job (£)</label>
              <input id="price-${escapeHtml(o._id)}" type="number" min="1" step="0.01" inputmode="decimal" required />
            </div>
            <div style="display: flex; gap: 0.75rem;">
              <button type="submit">Accept at this price</button>
              <button type="button" class="secondary decline-btn">Decline</button>
            </div>
          </form>
        </article>`;
      })
      .join('');

    container.querySelectorAll('.offer-card').forEach((card) => {
      const { offer, job } = card.dataset;
      card.querySelector('.accept-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        hideAlert('offers-alert');
        hideAlert('offers-success');
        const pricePence = Math.round(Number(card.querySelector('input[type="number"]').value) * 100);
        if (!Number.isInteger(pricePence) || pricePence <= 0) {
          showAlert('offers-alert', 'Enter your price in pounds.');
          return;
        }
        if (!window.confirm(`Accept this job for ${formatPence(pricePence)}? The customer will be asked to pay this amount.`)) return;
        event.target.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await apiRequest(`/jobs/${job}/offers/${offer}/accept`, { method: 'POST', body: { pricePence }, auth: true });
          showAlert('offers-success', 'Job accepted. We have asked the customer to pay; you will get an email when they do.');
          await Promise.all([loadOffers(), loadMyJobs()]);
        } catch (err) {
          showAlert('offers-alert', err.message);
          event.target.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
      });
      card.querySelector('.decline-btn').addEventListener('click', async (event) => {
        event.target.disabled = true;
        try {
          await apiRequest(`/jobs/${job}/offers/${offer}/decline`, { method: 'POST', auth: true });
          await loadOffers();
        } catch (err) {
          showAlert('offers-alert', err.message);
          event.target.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    if (err.status !== 404) showAlert('offers-alert', err.message);
  }
}

// --- My Jobs ---
function jobActions(job) {
  const id = escapeHtml(job._id);
  if (job.paymentStatus === 'PAID_HELD') {
    return `<button type="button" class="job-action" data-id="${id}" data-action="check-in">Check in</button>
            <button type="button" class="secondary job-action" data-id="${id}" data-action="cancel">Cancel</button>`;
  }
  if (job.paymentStatus === 'IN_PROGRESS') {
    return `<button type="button" class="job-action" data-id="${id}" data-action="complete">Mark complete</button>`;
  }
  return '';
}

const ACTION_CONFIRM = {
  'check-in': 'Check in now? The customer will be told you have arrived.',
  complete: 'Mark this job complete? The customer will be asked to confirm within 48 hours.',
  cancel: 'Cancel this job? The customer gets a full refund, and cancellations count against your reliability.',
};

async function loadMyJobs() {
  hideAlert('jobs-alert');
  const container = document.getElementById('my-jobs-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const jobs = await apiRequest('/cleaners/me/jobs', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Customer', 'Address', 'Price', 'Status', 'Booked', ''],
      emptyMessage: 'No booked jobs yet. Accept an offer to get started.',
      rows: jobs.map((job) => `
        <tr>
          <td>${escapeHtml(job.serviceType?.name || 'Cleaning')}${job.description ? `<div class="field-help">${escapeHtml(job.description)}</div>` : ''}</td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.postcode || '—')}</td>
          <td>${formatPence(job.pricePence)}</td>
          <td>${jobStatusBadge(job.paymentStatus)}</td>
          <td>${formatDate(job.bookedAt)}</td>
          <td class="table-actions">${jobActions(job)}</td>
        </tr>
      `),
    });
    container.querySelectorAll('.job-action').forEach((btn) => {
      btn.addEventListener('click', async () => {
        hideAlert('jobs-alert');
        hideAlert('jobs-success');
        const { id, action } = btn.dataset;
        if (!window.confirm(ACTION_CONFIRM[action])) return;
        btn.disabled = true;
        try {
          await apiRequest(`/payments/jobs/${id}/${action}`, { method: 'POST', auth: true });
          showAlert('jobs-success', { 'check-in': 'Checked in.', complete: 'Marked complete.', cancel: 'Job cancelled.' }[action]);
          await Promise.all([loadMyJobs(), loadEarnings()]);
        } catch (err) {
          showAlert('jobs-alert', err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = '';
    if (err.status !== 404) showAlert('jobs-alert', err.message);
  }
}

// --- Earnings & payouts ---
async function loadEarnings() {
  hideAlert('earnings-alert');
  try {
    const e = await apiRequest('/cleaners/me/earnings', { auth: true });
    document.getElementById('earn-paid').textContent = formatPence(e.paidOutPence);
    document.getElementById('earn-on-the-way').textContent = formatPence(e.onTheWayPence);
    document.getElementById('earn-escrow').textContent = formatPence(e.inEscrowPence);
    document.getElementById('earn-rate').textContent = `${Math.round(e.commissionRate * 100)}%`;
  } catch (err) {
    if (err.status !== 404) showAlert('earnings-alert', err.message);
  }
}

async function loadPayoutStatus() {
  const text = document.getElementById('payouts-status-text');
  const setup = document.getElementById('payouts-setup-button');
  const dashboard = document.getElementById('payouts-dashboard-button');
  try {
    const status = await apiRequest('/cleaners/me/payouts/status', { auth: true });
    if (status.payoutsEnabled) {
      text.textContent = 'Payouts are set up. Money for confirmed jobs is sent to your Stripe account automatically.';
      setup.hidden = true;
      dashboard.hidden = false;
    } else if (status.connected) {
      text.textContent = 'Your payout set-up is not finished yet. Stripe needs a few more details before we can pay you.';
      setup.textContent = 'Continue payout set-up';
      setup.hidden = false;
      dashboard.hidden = true;
    } else {
      text.textContent = 'Set up payouts so we can pay you for completed jobs. It takes about 5 minutes with Stripe.';
      setup.hidden = false;
      dashboard.hidden = true;
    }
  } catch (err) {
    text.textContent = err.status === 404 ? 'Register your profile first, then set up payouts.' : err.message;
  }
}

async function goToStripe(path, button) {
  hideAlert('earnings-alert');
  button.disabled = true;
  try {
    const { url } = await apiRequest(path, { method: 'POST', auth: true });
    window.location.href = url;
  } catch (err) {
    showAlert('earnings-alert', err.message);
    button.disabled = false;
  }
}

document.getElementById('payouts-setup-button').addEventListener('click', (e) =>
  goToStripe('/cleaners/me/payouts/onboarding', e.target)
);
document.getElementById('payouts-dashboard-button').addEventListener('click', (e) =>
  goToStripe('/cleaners/me/payouts/dashboard', e.target)
);
document.getElementById('offers-refresh').addEventListener('click', loadOffers);
document.getElementById('jobs-refresh').addEventListener('click', loadMyJobs);

// Coming back from Stripe onboarding: show the Earnings tab with the
// refreshed status.
const params = new URLSearchParams(window.location.search);
if (params.get('payouts')) {
  document.querySelector('.dash-nav-item[data-panel="earnings"]')?.click();
}

loadOffers();
loadMyJobs();
loadEarnings();
loadPayoutStatus();
