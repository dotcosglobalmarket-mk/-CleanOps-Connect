import { apiRequest, requireRole } from './api.js';
import { escapeHtml } from './dom.js';
import { STRIPE_PUBLISHABLE_KEY } from './config.js';
import { showAlert, hideAlert, renderTable, statusBadge, formatPence, formatDate } from './dashboard-ui.js';

requireRole('customer');

const FULL_REFUND_WINDOW_HOURS = 24;
const CONFIRM_WINDOW_HOURS = 48;

// What the customer sees for each payment state: [short label, badge kind, explanation].
const STATUS = {
  none_open: ['Posted', 'warn', 'Your job is posted. Find cleaners to send it to cleaners who cover your area.'],
  none_allocated: ['Waiting for a cleaner', 'warn', "We've sent your job to cleaners nearby. The first to accept books it."],
  BOOKED: ['Pay to confirm', 'bad', 'A cleaner has accepted your job. Pay now to confirm the booking.'],
  PAID_HELD: ['Booked', 'good', 'Your booking is confirmed and your payment is held securely.'],
  IN_PROGRESS: ['Cleaner on site', 'good', 'Your cleaner has checked in.'],
  AWAITING_CONFIRMATION: ['Please confirm', 'bad', 'Your cleaner has marked the job complete. Please confirm it or report a problem.'],
  DISPUTED: ['Problem reported', 'warn', "Our team is reviewing the problem you reported. We'll email you with the outcome."],
  CONFIRMED: ['Complete', 'good', 'Job complete. Thank you!'],
  PAYOUT_PENDING: ['Complete', 'good', 'Job complete. Thank you!'],
  PAYOUT_BLOCKED: ['Complete', 'good', 'Job complete. Thank you!'],
  TRANSFER_FAILED: ['Complete', 'good', 'Job complete. Thank you!'],
  MANUAL_REVIEW_HOLD: ['Complete', 'good', 'Job complete. Thank you!'],
  PAID_OUT: ['Complete', 'good', 'Job complete. Thank you!'],
  RESOLVED_REFUND: ['Refunding', 'warn', 'We are refunding your payment.'],
  REFUNDED: ['Refunded', 'warn', 'Your payment has been refunded. Refunds usually reach your card within 5–10 working days.'],
  PARTIALLY_REFUNDED: ['Partly refunded', 'warn', 'Part of your payment has been refunded. Refunds usually reach your card within 5–10 working days.'],
  CANCELLED: ['Cancelled', 'bad', 'This booking was cancelled before payment.'],
  CANCELLED_BY_CLEANER: ['Cancelled by cleaner', 'bad', 'Your cleaner cancelled. You will get a full refund.'],
  CANCELLED_BY_CUSTOMER: ['Cancelled', 'bad', 'You cancelled this job.'],
};

function statusKey(job) {
  if (job.paymentStatus) return job.paymentStatus;
  return job.status === 'open' ? 'none_open' : 'none_allocated';
}

function statusInfo(job) {
  return STATUS[statusKey(job)] || [job.paymentStatus || job.status, 'warn', ''];
}

let jobs = [];
let currentJob = null;
let stripe = null;
let elements = null;

// --- Service types for the post-a-job form ---
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
  }
}

document.getElementById('category').addEventListener('change', renderServiceTypeOptions);
document.getElementById('show-post-job').addEventListener('click', () => {
  const card = document.getElementById('post-job-card');
  card.hidden = !card.hidden;
  if (!card.hidden) document.getElementById('postcode').focus();
});

document.getElementById('create-job-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert('create-alert');
  const payload = {
    serviceType: document.getElementById('serviceType').value,
    category: document.getElementById('category').value,
    postcode: document.getElementById('postcode').value.trim(),
    frequency: document.getElementById('frequency').value,
    budgetMin: Number(document.getElementById('budgetMin').value),
    budgetMax: Number(document.getElementById('budgetMax').value),
  };
  const description = document.getElementById('description').value.trim();
  const estimatedHours = document.getElementById('estimatedHours').value;
  if (description) payload.description = description;
  if (estimatedHours) payload.estimatedHours = Number(estimatedHours);

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const job = await apiRequest('/jobs', { method: 'POST', body: payload, auth: true });
    const result = await apiRequest(`/jobs/${job._id}/allocate`, { method: 'POST', auth: true });
    event.target.reset();
    renderServiceTypeOptions();
    document.getElementById('post-job-card').hidden = true;
    showAlert(
      'page-success',
      result.offers.length
        ? `Your job is posted and has been sent to ${result.offers.length} cleaner${result.offers.length === 1 ? '' : 's'} nearby.`
        : "Your job is posted, but no cleaners cover your area for this service yet. We'll keep it open — try Find cleaners again later."
    );
    await loadJobs();
    await openJob(job._id);
  } catch (err) {
    showAlert('create-alert', err.message);
  } finally {
    button.disabled = false;
  }
});

// --- Jobs list ---
async function loadJobs() {
  hideAlert('page-alert');
  const container = document.getElementById('jobs-list');
  try {
    jobs = await apiRequest('/jobs/mine', { auth: true });
    container.innerHTML = renderTable({
      columns: ['Job', 'Posted', 'Cleaner', 'Price', 'Status', ''],
      emptyMessage: "You haven't posted any jobs yet. Use Post a job to get started.",
      rows: jobs.map((job) => {
        const [label, kind] = statusInfo(job);
        return `
          <tr>
            <td>${escapeHtml(job.serviceType?.name || 'Cleaning')} · ${escapeHtml(job.postcode)}</td>
            <td>${formatDate(job.createdAt)}</td>
            <td>${escapeHtml(job.cleaner?.name || '—')}</td>
            <td>${formatPence(job.pricePence)}</td>
            <td>${statusBadge(label, kind)}</td>
            <td class="table-actions"><button type="button" class="secondary open-job" data-id="${escapeHtml(job._id)}">Open</button></td>
          </tr>`;
      }),
    });
    container.querySelectorAll('.open-job').forEach((btn) => btn.addEventListener('click', () => openJob(btn.dataset.id)));
  } catch (err) {
    showAlert('page-alert', err.message);
  }
}

// --- Job detail ---
function show(id, visible) {
  document.getElementById(id).hidden = !visible;
}

async function openJob(jobId, { focusReview = false } = {}) {
  hideAlert('page-alert');
  try {
    currentJob = await apiRequest(`/jobs/${jobId}`, { auth: true });
  } catch (err) {
    showAlert('page-alert', err.message);
    return;
  }
  const job = currentJob;
  const listed = jobs.find((j) => j._id === job._id) || {};
  const [label, , explanation] = statusInfo(job);

  document.getElementById('job-title').textContent = `${listed.serviceType?.name || 'Cleaning'} · ${job.postcode}`;
  document.getElementById('job-status-text').innerHTML = `${statusBadge(label, statusInfo(job)[1])} ${escapeHtml(explanation)}`;
  document.getElementById('job-facts').innerHTML = [
    ['Cleaner', listed.cleaner?.name ? `${listed.cleaner.name}${listed.cleaner.ratingCount ? ` (★ ${Number(listed.cleaner.ratingAverage).toFixed(1)} from ${listed.cleaner.ratingCount})` : ''}` : '—'],
    ['Price', formatPence(job.pricePence)],
    ['Budget', `£${job.budgetMin}–£${job.budgetMax}`],
    ['Booked', formatDate(job.bookedAt)],
    ['Posted', formatDate(job.createdAt)],
  ]
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  const status = job.paymentStatus;
  show('offers-section', !status);
  show('payment-section', status === 'BOOKED');
  show('confirm-section', status === 'AWAITING_CONFIRMATION');
  show('cancel-section', ['BOOKED', 'PAID_HELD'].includes(status));
  show('review-section', false);
  show('job-detail', true);

  if (!status) await renderOffers(job);
  if (status === 'BOOKED') await mountPayment(job);
  if (status === 'AWAITING_CONFIRMATION') renderConfirmDeadline(job);
  renderCancelPolicy(job);
  await renderReview(job);

  const detail = document.getElementById('job-detail');
  const target = focusReview ? document.getElementById('review-section') : detail;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('close-job').addEventListener('click', () => {
  show('job-detail', false);
  currentJob = null;
});

async function renderOffers(job) {
  const list = document.getElementById('offers-list');
  const find = document.getElementById('find-cleaners');
  try {
    const offers = await apiRequest(`/jobs/${job._id}/offers`, { auth: true });
    find.hidden = offers.some((o) => o.status === 'sent');
    find.textContent = offers.length ? 'Find more cleaners' : 'Find cleaners';
    list.innerHTML = offers.length
      ? offers
          .map((o) => {
            const c = o.cleaner || {};
            const badges = [c.dbsVerified && 'DBS checked', c.coshhTrained && 'COSHH trained', c.insuranceStatus && c.insuranceStatus !== 'none' && 'Insured']
              .filter(Boolean)
              .map((b) => statusBadge(b, 'good'))
              .join(' ');
            const rating = c.ratingCount ? `★ ${Number(c.ratingAverage).toFixed(1)} (${c.ratingCount})` : 'New cleaner';
            const state = { sent: 'Offer sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' }[o.status] || o.status;
            return `<li><strong>${escapeHtml(c.companyName || c.name || 'Cleaner')}</strong> · ${escapeHtml(rating)} ${badges} <span class="field-help">— ${escapeHtml(state)}</span></li>`;
          })
          .join('')
      : '<li>No cleaners have been asked yet.</li>';
  } catch (err) {
    list.innerHTML = '';
    showAlert('page-alert', err.message);
  }
}

document.getElementById('find-cleaners').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try {
    const result = await apiRequest(`/jobs/${currentJob._id}/allocate`, { method: 'POST', auth: true });
    showAlert('page-success', result.offers.length ? `Sent to ${result.offers.length} cleaners.` : 'No cleaners cover your area for this service yet.');
    await openJob(currentJob._id);
  } catch (err) {
    showAlert('page-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

// --- Payment (Stripe Payment Element; card details go straight to Stripe) ---
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

async function mountPayment(job) {
  hideAlert('payment-alert');
  const payButton = document.getElementById('pay-button');
  payButton.textContent = `Pay ${formatPence(job.pricePence)}`;
  payButton.disabled = true;
  if (!STRIPE_PUBLISHABLE_KEY) {
    showAlert('payment-alert', 'Card payments are not set up on this site yet. Please contact us.');
    return;
  }
  try {
    const [{ clientSecret }, StripeJs] = await Promise.all([
      apiRequest(`/payments/jobs/${job._id}/intent`, { auth: true }),
      loadStripeJs(),
    ]);
    stripe = stripe || StripeJs(STRIPE_PUBLISHABLE_KEY);
    elements = stripe.elements({ clientSecret });
    const container = document.getElementById('payment-element');
    container.innerHTML = '';
    elements.create('payment').mount(container);
    payButton.disabled = false;
  } catch (err) {
    showAlert('payment-alert', err.message);
  }
}

document.getElementById('pay-button').addEventListener('click', async (event) => {
  hideAlert('payment-alert');
  event.target.disabled = true;
  const returnUrl = new URL(window.location.href);
  returnUrl.search = `?job=${currentJob._id}`;
  const { error } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: returnUrl.toString() },
    redirect: 'if_required',
  });
  if (error) {
    showAlert('payment-alert', error.message);
    event.target.disabled = false;
    return;
  }
  await afterPayment(currentJob._id);
});

// Stripe tells us about the payment by webhook, which can take a few
// seconds; poll briefly so the page updates on its own.
async function afterPayment(jobId) {
  showAlert('page-success', 'Payment received. Confirming your booking…');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const job = await apiRequest(`/jobs/${jobId}`, { auth: true }).catch(() => null);
    if (job && job.paymentStatus !== 'BOOKED') break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  showAlert('page-success', 'Payment received. Your booking is confirmed.');
  await loadJobs();
  await openJob(jobId);
}

// --- Confirm / dispute ---
function renderConfirmDeadline(job) {
  const deadline = job.awaitingConfirmationAt
    ? new Date(new Date(job.awaitingConfirmationAt).getTime() + CONFIRM_WINDOW_HOURS * 3600 * 1000)
    : null;
  document.getElementById('confirm-deadline').textContent = deadline
    ? `If you don't confirm or report a problem by ${deadline.toLocaleString('en-GB')}, the job is confirmed automatically and the cleaner is paid.`
    : '';
}

document.getElementById('confirm-button').addEventListener('click', async (event) => {
  if (!window.confirm('Confirm the job is done? The cleaner will be paid.')) return;
  event.target.disabled = true;
  try {
    await apiRequest(`/payments/jobs/${currentJob._id}/confirm`, { method: 'POST', auth: true });
    showAlert('page-success', 'Thanks — the job is confirmed and the cleaner is being paid.');
    await loadJobs();
    await openJob(currentJob._id, { focusReview: true });
  } catch (err) {
    showAlert('page-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

document.getElementById('dispute-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    await apiRequest(`/payments/jobs/${currentJob._id}/dispute`, {
      method: 'POST',
      body: {
        reasonCode: document.getElementById('dispute-reason').value,
        detail: document.getElementById('dispute-detail').value.trim(),
      },
      auth: true,
    });
    event.target.reset();
    showAlert('page-success', "We've received your report. Payment is on hold while our team reviews it.");
    await loadJobs();
    await openJob(currentJob._id);
  } catch (err) {
    showAlert('page-alert', err.message);
  } finally {
    button.disabled = false;
  }
});

// --- Cancel ---
function renderCancelPolicy(job) {
  const text = document.getElementById('cancel-policy');
  if (job.paymentStatus === 'PAID_HELD') {
    const bookedAt = new Date(job.bookedAt || job.createdAt);
    const fullRefundUntil = new Date(bookedAt.getTime() + FULL_REFUND_WINDOW_HOURS * 3600 * 1000);
    text.textContent =
      Date.now() <= fullRefundUntil.getTime()
        ? `Cancel before ${fullRefundUntil.toLocaleString('en-GB')} for a full refund. After that, you get 50% back.`
        : 'You booked more than 24 hours ago, so cancelling now refunds 50% of the price.';
  } else {
    text.textContent = "You haven't paid yet, so you can cancel at no cost.";
  }
}

document.getElementById('cancel-button').addEventListener('click', async (event) => {
  if (!window.confirm('Cancel this job?')) return;
  event.target.disabled = true;
  try {
    await apiRequest(`/payments/jobs/${currentJob._id}/cancel`, { method: 'POST', auth: true });
    showAlert('page-success', 'Your job has been cancelled.');
    await loadJobs();
    await openJob(currentJob._id);
  } catch (err) {
    showAlert('page-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

// --- Review ---
function renderRatingOptions() {
  document.getElementById('rating-options').innerHTML = [5, 4, 3, 2, 1]
    .map(
      (n) =>
        `<label><input type="radio" name="rating" value="${n}" ${n === 5 ? 'required' : ''} /> ${'★'.repeat(n)}<span class="visually-hidden"> ${n} out of 5</span></label>`
    )
    .join('');
}

async function renderReview(job) {
  if (!job.cleaner) return;
  try {
    const { review, canReview } = await apiRequest(`/jobs/${job._id}/review`, { auth: true });
    const existing = document.getElementById('existing-review');
    if (review) {
      existing.innerHTML = `<p>You rated this job ${'★'.repeat(review.rating)} (${review.rating}/5)${review.comment ? `: “${escapeHtml(review.comment)}”` : ''}. Thank you!</p>`;
      existing.hidden = false;
      show('review-form', false);
      show('review-section', true);
    } else if (canReview) {
      existing.hidden = true;
      show('review-form', true);
      show('review-section', true);
    }
  } catch (err) {
    // Reviews are optional; never block the rest of the job view.
  }
}

document.getElementById('review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const rating = Number(new FormData(event.target).get('rating'));
  const comment = document.getElementById('review-comment').value.trim();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    await apiRequest(`/jobs/${currentJob._id}/review`, {
      method: 'POST',
      body: comment ? { rating, comment } : { rating },
      auth: true,
    });
    event.target.reset();
    showAlert('page-success', 'Thanks for your review.');
    await openJob(currentJob._id);
  } catch (err) {
    showAlert('page-alert', err.message);
  } finally {
    button.disabled = false;
  }
});

// --- Init (supports links from emails: ?job=ID[&review=1], and Stripe's return) ---
renderRatingOptions();
loadServiceTypes();
(async () => {
  await loadJobs();
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('job');
  if (!jobId) return;
  if (params.get('redirect_status') === 'succeeded') {
    await afterPayment(jobId);
  } else if (params.get('redirect_status') === 'failed') {
    showAlert('page-alert', 'Your payment did not go through. Please try again.');
    await openJob(jobId);
  } else {
    await openJob(jobId, { focusReview: params.get('review') === '1' });
  }
})();
