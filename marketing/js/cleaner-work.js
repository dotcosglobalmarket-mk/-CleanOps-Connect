import { apiRequest } from './api.js';
import { openDocument } from './documents.js';
import { fetchGuide, renderGuide } from './price-guide.js';
import { escapeHtml } from './dom.js';
import { mountJobPhotos } from './job-photos.js';
import { showAlert, hideAlert, renderTable, statusBadge, formatPence, formatDate, formatVisit } from './dashboard-ui.js';

// Offers inbox, booked jobs, earnings and Stripe payouts for the cleaner
// dashboard. The profile/coverage tabs live in cleaner.js.

const FREQUENCY = { one_off: 'One-off', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', contract: 'Contract' };

// Distance comes from the API in km; the UI shows miles.
const KM_PER_MILE = 1.609344;
const kmToMiles = (km) => Math.round((km / KM_PER_MILE) * 10) / 10;

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
const isOpenTender = (job) => job.procurement === 'tender' && job.tender?.closesAt && new Date(job.tender.closesAt).getTime() > Date.now();

function offerForm(o) {
  const id = escapeHtml(o._id);
  if (o.job.procurement === 'tender') {
    const quote = o.quote;
    return `
      <form class="quote-form">
        ${quote ? `<p class="field-help">Your quote: <strong>${escapeHtml(formatPence(quote.pricePence))}</strong> (sent ${escapeHtml(formatDate(quote.quotedAt))}). You can change it until the tender closes.</p>` : ''}
        <div class="form-row">
          <label for="price-${id}">${quote ? 'New price' : 'Your quote'} for this job (£)</label>
          <input id="price-${id}" type="number" min="1" step="0.01" inputmode="decimal" required />
        </div>
        <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem;">
          <button type="button" class="secondary guide-btn">See local rates</button>
          <span class="field-help guide-status" aria-live="polite"></span>
        </div>
        <div class="card guide-panel" hidden></div>
        <div class="form-row">
          <label for="note-${id}">Note to the customer (optional)</label>
          <textarea id="note-${id}" rows="2" maxlength="1500" placeholder="What's included, when you could start…"></textarea>
          <span class="field-help">Phone numbers, emails, postcodes and links are hidden to keep the work on CleanOps Connect.</span>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button type="submit">${quote ? 'Update quote' : 'Send quote'}</button>
          <button type="button" class="secondary decline-btn">Not interested</button>
        </div>
      </form>`;
  }
  const recurring = o.job.recurring;
  const recurringNotice = recurring
    ? `<p class="recurring-notice"><strong>This is a recurring booking.</strong> ${escapeHtml(FREQUENCY[recurring.frequency] || recurring.frequency)} until ${escapeHtml(formatDate(recurring.endsOn).split(',')[0])}, about ${escapeHtml(recurring.visits)} visits. The price you set applies to every visit and stays the same for the whole series. Cancelling a series later needs 14 days' notice.</p>`
    : '';
  return `
    <form class="accept-form"${recurring ? ` data-recurring="${escapeHtml(recurring.visits)}"` : ''}>
      ${recurringNotice}
      <div class="form-row">
        <label for="price-${id}">${recurring ? 'Your price per visit (£)' : 'Your price for this job (£)'}</label>
        <input id="price-${id}" type="number" min="1" step="0.01" inputmode="decimal" required />
      </div>
      <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem;">
          <button type="button" class="secondary guide-btn">See local rates</button>
          <span class="field-help guide-status" aria-live="polite"></span>
        </div>
        <div class="card guide-panel" hidden></div>
      <div style="display: flex; gap: 0.75rem;">
        <button type="submit">Accept at this price</button>
        <button type="button" class="secondary decline-btn">Decline</button>
      </div>
    </form>`;
}

async function loadOffers() {
  hideAlert('offers-alert');
  const container = document.getElementById('offers-list');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const offers = await apiRequest('/cleaners/me/offers', { auth: true });
    // Open offers, plus quotes still waiting on a tender's result.
    const open = offers.filter(
      (o) =>
        !o.job.booked &&
        (o.status === 'quoted' || (o.status === 'sent' && (o.job.procurement !== 'tender' || isOpenTender(o.job))))
    );
    if (!open.length) {
      container.innerHTML = '<div class="table-empty">No open offers right now. We email you when a new one arrives.</div>';
      return;
    }
    container.innerHTML = open
      .map((o) => {
        const j = o.job;
        const tender = j.procurement === 'tender';
        const tenderOpen = isOpenTender(j);
        return `
        <article class="card offer-card" data-offer="${escapeHtml(o._id)}" data-job="${escapeHtml(j._id)}">
          <h3>${escapeHtml(j.serviceType?.name || 'Cleaning')} · ${escapeHtml(j.area || '')} ${tender ? statusBadge('Tender', 'warn') : ''}</h3>
          <dl class="detail-grid">
            <div><dt>Distance</dt><dd>${o.distanceKm !== undefined ? `${escapeHtml(kmToMiles(o.distanceKm))} mi` : '—'}</dd></div>
            <div><dt>Customer budget</dt><dd>£${escapeHtml(j.budgetMin)}–£${escapeHtml(j.budgetMax)}</dd></div>
            <div><dt>Preferred date and time</dt><dd>${escapeHtml(formatVisit(j.preferredStartAt))}</dd></div>
            <div><dt>Frequency</dt><dd>${escapeHtml(FREQUENCY[j.frequency] || 'One-off')}</dd></div>
            <div><dt>Estimated hours</dt><dd>${j.estimatedHours ? escapeHtml(j.estimatedHours) : '—'}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(j.category)}</dd></div>
            ${tender ? `<div><dt>Quotes close</dt><dd>${formatDate(j.tender.closesAt)}</dd></div>` : `<div><dt>Offered</dt><dd>${formatDate(o.createdAt)}</dd></div>`}
          </dl>
          ${j.description ? `<p>${escapeHtml(j.description)}</p>` : ''}
          ${tender && j.tender.requirements ? `<p><strong>Site and requirements:</strong> ${escapeHtml(j.tender.requirements)}</p>` : ''}
          ${tender && !tenderOpen ? `<p class="field-help">Quotes have closed. You sent ${escapeHtml(formatPence(o.quote?.pricePence))}; we'll tell you if the customer awards you the job.</p>` : offerForm(o)}
        </article>`;
      })
      .join('');

    container.querySelectorAll('.offer-card').forEach((card) => {
      const { offer, job } = card.dataset;

      const acceptForm = card.querySelector('.accept-form');
      if (acceptForm) {
        acceptForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          hideAlert('offers-alert');
          hideAlert('offers-success');
          const pricePence = Math.round(Number(card.querySelector('input[type="number"]').value) * 100);
          if (!Number.isInteger(pricePence) || pricePence <= 0) {
            showAlert('offers-alert', 'Enter your price in pounds.');
            return;
          }
          const visits = acceptForm.dataset.recurring;
          const question = visits
            ? `Accept this recurring booking at ${formatPence(pricePence)} per visit, for about ${visits} visits? This price applies to every visit. The customer will be asked to pay for the first visit now.`
            : `Accept this job for ${formatPence(pricePence)}? The customer will be asked to pay this amount.`;
          if (!window.confirm(question)) return;
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
      }

      const quoteForm = card.querySelector('.quote-form');
      if (quoteForm) {
        quoteForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          hideAlert('offers-alert');
          hideAlert('offers-success');
          const pricePence = Math.round(Number(card.querySelector('input[type="number"]').value) * 100);
          if (!Number.isInteger(pricePence) || pricePence <= 0) {
            showAlert('offers-alert', 'Enter your quote in pounds.');
            return;
          }
          const message = card.querySelector('textarea').value.trim();
          event.target.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try {
            await apiRequest(`/jobs/${job}/offers/${offer}/quote`, {
              method: 'POST',
              body: message ? { pricePence, message } : { pricePence },
              auth: true,
            });
            showAlert('offers-success', `Quote of ${formatPence(pricePence)} sent. The customer will compare quotes and award the job.`);
            await loadOffers();
          } catch (err) {
            showAlert('offers-alert', err.message);
            event.target.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          }
        });
      }

      // Local rate guide: shown on request, never fills the price by itself.
      const guideBtn = card.querySelector('.guide-btn');
      if (guideBtn) {
        const offerData = open.find((o) => o._id === offer);
        guideBtn.addEventListener('click', async () => {
          const status = card.querySelector('.guide-status');
          const panel = card.querySelector('.guide-panel');
          guideBtn.disabled = true;
          status.textContent = 'Looking up local rates… this can take up to a minute.';
          panel.hidden = true;
          try {
            const guide = await fetchGuide({
              serviceType: offerData.job.serviceType?._id,
              postcode: offerData.job.area,
              estimatedHours: offerData.job.estimatedHours,
            });
            renderGuide(panel, guide, {
              audience: 'cleaner',
              onUse: (pounds) => {
                card.querySelector('input[type="number"]').value = pounds;
              },
            });
            status.textContent = '';
          } catch (err) {
            status.textContent = err.message;
          } finally {
            guideBtn.disabled = false;
          }
        });
      }

      const decline = card.querySelector('.decline-btn');
      if (decline) {
        decline.addEventListener('click', async (event) => {
          event.target.disabled = true;
          try {
            await apiRequest(`/jobs/${job}/offers/${offer}/decline`, { method: 'POST', auth: true });
            await loadOffers();
          } catch (err) {
            showAlert('offers-alert', err.message);
            event.target.disabled = false;
          }
        });
      }
    });
  } catch (err) {
    container.innerHTML = '';
    if (err.status === 402) {
      container.innerHTML = '<div class="table-empty">Job offers appear here once your monthly platform fee is paid. Go to Coverage &amp; Subscription to activate your plan.</div>';
    } else if (err.status !== 404) {
      showAlert('offers-alert', err.message);
    }
  }
}

// --- My Jobs ---
function jobActions(job) {
  const id = escapeHtml(job._id);
  let actions = '';
  if (job.paymentStatus === 'PAID_HELD') {
    actions = `<button type="button" class="job-action" data-id="${id}" data-action="check-in">Check in</button>
            <button type="button" class="secondary job-action" data-id="${id}" data-action="cancel">Cancel</button>`;
  } else if (job.paymentStatus === 'IN_PROGRESS') {
    actions = `<button type="button" class="job-action" data-id="${id}" data-action="complete">Mark complete</button>`;
  }
  // Printable records for every booked job; the compliance pack is for industrial work.
  const docs = `<button type="button" class="secondary doc-btn" data-id="${id}" data-kind="service-record">Service record</button>${
    job.category === 'industrial'
      ? ` <button type="button" class="secondary doc-btn" data-id="${id}" data-kind="compliance-pack">Compliance pack</button>`
      : ''
  }`;
  const photos = PHOTO_STATES.includes(job.paymentStatus)
    ? ` <button type="button" class="secondary photo-btn" data-id="${id}">Photos</button>`
    : '';
  return `${actions} ${docs}${photos}`;
}

// Photos are optional. The cleaner can add them while the job is under way and to answer a
// problem report; after that they can still be looked at until the 90 days are up.
const PHOTO_STATES = ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CONFIRMED', 'PAYOUT_PENDING', 'PAYOUT_BLOCKED', 'TRANSFER_FAILED', 'MANUAL_REVIEW_HOLD', 'PAID_OUT', 'RESOLVED_PAYOUT', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const PHOTO_ADD_STATES = ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'];
let openPhotos = null;

async function showPhotos(job) {
  if (openPhotos) openPhotos.destroy();
  const card = document.getElementById('job-photos-card');
  document.getElementById('job-photos-title').textContent = `Photos — ${job.serviceType?.name || 'Cleaning'} · ${job.postcode || ''}`;
  card.hidden = false;
  openPhotos = await mountJobPhotos(document.getElementById('job-photos-mount'), {
    jobId: job._id,
    myRole: 'cleaner',
    add: PHOTO_ADD_STATES.includes(job.paymentStatus)
      ? [{ kind: 'before', label: 'Add before photos' }, { kind: 'after', label: 'Add after photos' }]
      : [],
  });
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('job-photos-close').addEventListener('click', () => {
  if (openPhotos) openPhotos.destroy();
  openPhotos = null;
  document.getElementById('job-photos-card').hidden = true;
});

const ACTION_CONFIRM = {
  'check-in': 'Check in now? The customer will be told you have arrived.',
  complete: 'Mark this job complete? The customer will be asked to confirm within 48 hours. (You can add "after" photos with the Photos button first. They are optional.)',
  cancel: 'Cancel this job? The customer gets a full refund, and cancellations count against your reliability.',
};

async function loadMyJobs() {
  hideAlert('jobs-alert');
  const container = document.getElementById('my-jobs-table');
  container.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const jobs = await apiRequest('/cleaners/me/jobs', { auth: true });
    container.classList.add('fit');
    container.innerHTML = renderTable({
      fit: true,
      columns: ['Job', 'When', 'Customer', 'Address', 'Price', 'Status', 'Booked', 'Actions'],
      emptyMessage: 'No booked jobs yet. Accept an offer to get started.',
      rows: jobs.map((job) => `
        <tr>
          <td>${escapeHtml(job.serviceType?.name || 'Cleaning')}${job.description ? `<div class="field-help">${escapeHtml(job.description)}</div>` : ''}</td>
          <td>${escapeHtml(formatVisit(job.preferredStartAt))}</td>
          <td>${escapeHtml(job.customer?.name || '—')}</td>
          <td>${escapeHtml(job.postcode || '—')}</td>
          <td>${formatPence(job.pricePence)}</td>
          <td>${jobStatusBadge(job.paymentStatus)}</td>
          <td>${formatDate(job.bookedAt)}</td>
          <td class="table-actions">${jobActions(job)}</td>
        </tr>
      `),
    });
    container.querySelectorAll('.photo-btn').forEach((btn) =>
      btn.addEventListener('click', () => showPhotos(jobs.find((j) => String(j._id) === btn.dataset.id)))
    );
    container.querySelectorAll('.doc-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        hideAlert('jobs-alert');
        try {
          await openDocument(btn.dataset.id, btn.dataset.kind);
        } catch (err) {
          showAlert('jobs-alert', err.message);
        }
      })
    );
    container.querySelectorAll('.job-action').forEach((btn) => {
      btn.addEventListener('click', async () => {
        hideAlert('jobs-alert');
        hideAlert('jobs-success');
        const { id, action } = btn.dataset;
        if (!window.confirm(ACTION_CONFIRM[action])) return;
        btn.disabled = true;
        try {
          await apiRequest(`/payments/jobs/${id}/${action}`, { method: 'POST', auth: true });
          showAlert('jobs-success', { 'check-in': 'Checked in. You can add before photos with the Photos button (optional).', complete: 'Marked complete.', cancel: 'Job cancelled.' }[action]);
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
