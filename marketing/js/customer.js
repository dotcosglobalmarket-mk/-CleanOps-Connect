import { apiRequest, requireRole } from './api.js';
import { escapeHtml, splitSuggestion } from './dom.js';
import { STRIPE_PUBLISHABLE_KEY } from './config.js';
import { openDocument } from './documents.js';
import { mountJobPhotos, uploadJobPhotos } from './job-photos.js';
import { avatarHtml, hydrateAvatars } from './avatar.js';
import { fetchGuide, renderGuide } from './price-guide.js';
import { mountChat, fetchUnread, setupConversations } from './chat.js';
import { mountSeries } from './series-ui.js';
import { showAlert, hideAlert, renderTable, statusBadge, formatPence, formatDate, formatVisit } from './dashboard-ui.js';

requireRole('customer');

const FULL_REFUND_WINDOW_HOURS = 24;
const CONFIRM_WINDOW_HOURS = 48;

// What the customer sees for each payment state: [short label, badge kind, explanation].
const STATUS = {
  none_open: ['Posted', 'warn', "Your job is posted but hasn't been sent to a cleaner yet. If no cleaner covering your area was available, press Find cleaners to try again later."],
  none_tender: ['Collecting quotes', 'warn', 'Matching cleaners have been invited to quote. Compare their quotes below and award the job to one.'],
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
  if (job.status === 'open') return 'none_open';
  return job.procurement === 'tender' ? 'none_tender' : 'none_allocated';
}

function statusInfo(job) {
  return STATUS[statusKey(job)] || [job.paymentStatus || job.status, 'warn', ''];
}

let jobs = [];
let unreadByJob = {};
let activeChat = null;
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

// Only industrial jobs can be run as a tender.
function syncTenderFields() {
  const industrial = document.getElementById('category').value === 'industrial';
  document.getElementById('tender-fields').hidden = !industrial;
  if (!industrial) document.getElementById('runTender').checked = false;
  document.getElementById('tender-details').hidden = !document.getElementById('runTender').checked;
  document.getElementById('tenderClosesAt').required = document.getElementById('runTender').checked;
}

document.getElementById('category').addEventListener('change', () => {
  renderServiceTypeOptions();
  syncTenderFields();
});
document.getElementById('runTender').addEventListener('change', syncTenderFields);
document.getElementById('show-post-job').addEventListener('click', () => {
  const card = document.getElementById('post-job-card');
  card.hidden = !card.hidden;
  if (!card.hidden) document.getElementById('postcode').focus();
});

// A postcode typed on the homepage search carries over to the post-a-job form.
try {
  const carried = sessionStorage.getItem('cleanops-postcode');
  if (carried) {
    sessionStorage.removeItem('cleanops-postcode');
    document.getElementById('postcode').value = carried;
    document.getElementById('post-job-card').hidden = false;
  }
} catch (e) {
  // Storage unavailable: they just type it again.
}

// Earliest choosable visit: now, in the browser's local time, as datetime-local expects.
const preferredStartInput = document.getElementById('preferredStart');
const soonest = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
preferredStartInput.min = soonest.toISOString().slice(0, 16);

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
  if (document.getElementById('runTender').checked) {
    payload.tender = { closesAt: new Date(document.getElementById('tenderClosesAt').value).toISOString() };
    const requirements = document.getElementById('tenderRequirements').value.trim();
    if (requirements) payload.tender.requirements = requirements;
  }
  if (estimatedHours) payload.estimatedHours = Number(estimatedHours);
  const preferredStart = document.getElementById('preferredStart').value;
  if (preferredStart) {
    payload.preferredStartAt = new Date(preferredStart).toISOString();
  } else if (!payload.tender) {
    showAlert('create-alert', 'Choose a preferred date and time.');
    return;
  }

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const job = await apiRequest('/jobs', { method: 'POST', body: payload, auth: true });
    const result = await apiRequest(`/jobs/${job._id}/allocate`, { method: 'POST', auth: true });
    event.target.reset();
    renderServiceTypeOptions();
    syncTenderFields();
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

// --- Suggested budget (a guide from local prices published online) ---
document.getElementById('budget-guide-btn').addEventListener('click', async (event) => {
  const status = document.getElementById('budget-guide-status');
  const serviceType = document.getElementById('serviceType').value;
  const postcode = document.getElementById('postcode').value.trim();
  if (!serviceType || !postcode) {
    status.textContent = 'Choose a service type and enter your postcode first.';
    return;
  }
  const button = event.target;
  button.disabled = true;
  status.textContent = 'Looking up local rates… this can take up to a minute.';
  document.getElementById('budget-guide').hidden = true;
  try {
    const guide = await fetchGuide({ serviceType, postcode, estimatedHours: document.getElementById('estimatedHours').value });
    renderGuide(document.getElementById('budget-guide'), guide, {
      audience: 'customer',
      onUse: ({ min, max }) => {
        document.getElementById('budgetMin').value = min;
        document.getElementById('budgetMax').value = max;
      },
    });
    status.textContent = '';
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

// --- AI writing help for the job description ---
const describeButton = document.getElementById('describe-help');
const describeStatus = document.getElementById('describe-status');
const describeBox = document.getElementById('describe-suggestion');
const describeText = document.getElementById('describe-suggestion-text');

describeButton.addEventListener('click', async () => {
  const body = {
    category: document.getElementById('category').value,
    frequency: document.getElementById('frequency').value,
  };
  const serviceType = document.getElementById('serviceType').value;
  const estimatedHours = document.getElementById('estimatedHours').value;
  const draft = document.getElementById('description').value.trim();
  if (serviceType) body.serviceType = serviceType;
  if (estimatedHours && Number(estimatedHours) > 0) body.estimatedHours = Number(estimatedHours);
  if (draft) body.draft = draft;

  describeButton.disabled = true;
  describeStatus.textContent = 'Writing a suggestion…';
  describeBox.hidden = true;
  try {
    const { suggestion } = await apiRequest('/jobs/describe', { method: 'POST', body, auth: true });
    const parts = splitSuggestion(suggestion);
    describeText.textContent = parts.text;
    document.getElementById('describe-tip').textContent = parts.tip;
    describeBox.hidden = false;
    describeStatus.textContent = '';
  } catch (err) {
    describeStatus.textContent = err.message;
  } finally {
    describeButton.disabled = false;
  }
});

document.getElementById('describe-use').addEventListener('click', () => {
  document.getElementById('description').value = describeText.textContent.slice(0, 2000);
  describeBox.hidden = true;
});

document.getElementById('describe-dismiss').addEventListener('click', () => {
  describeBox.hidden = true;
});

// --- Jobs list ---
async function loadJobs() {
  hideAlert('page-alert');
  const container = document.getElementById('jobs-list');
  try {
    let unread;
    [jobs, unread] = await Promise.all([apiRequest('/jobs/mine', { auth: true }), fetchUnread()]);
    unreadByJob = unread.byJob || {};
    container.classList.add('fit');
    container.innerHTML = renderTable({
      fit: true,
      phoneOnly: true,
      columns: ['Job', 'Posted', 'Cleaner', 'Price', 'Status', 'Actions'],
      emptyMessage: "You haven't posted any jobs yet. Use Post a job to get started.",
      rows: jobs.map((job) => {
        const [label, kind] = statusInfo(job);
        const payNowButton =
          job.paymentStatus === 'BOOKED'
            ? `<button type="button" class="pay-now" data-id="${escapeHtml(job._id)}">Pay now</button>`
            : '';
        return `
          <tr>
            <td>${escapeHtml(job.serviceType?.name || 'Cleaning')} · ${escapeHtml(job.postcode)}</td>
            <td>${formatDate(job.createdAt)}</td>
            <td>${escapeHtml(job.cleaner?.name || '—')}</td>
            <td>${formatPence(job.pricePence)}</td>
            <td>${statusBadge(label, kind)}</td>
            <td class="table-actions">
              ${payNowButton}
              <button type="button" class="secondary open-job" data-id="${escapeHtml(job._id)}">Open</button>
              ${unreadByJob[job._id] ? `<span class="unread-badge" title="Unread messages" aria-label="${escapeHtml(unreadByJob[job._id])} unread messages">${escapeHtml(unreadByJob[job._id])}</span>` : ''}
            </td>
          </tr>`;
      }),
    });
    container.querySelectorAll('.open-job').forEach((btn) => btn.addEventListener('click', () => openJob(btn.dataset.id)));
    container.querySelectorAll('.pay-now').forEach((btn) =>
      btn.addEventListener('click', () => openJob(btn.dataset.id, { focusPayment: true }))
    );
  } catch (err) {
    showAlert('page-alert', err.message);
  }
}

// --- Job detail ---
function show(id, visible) {
  document.getElementById(id).hidden = !visible;
}

async function openJob(jobId, { focusReview = false, focusPayment = false } = {}) {
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
    ['Preferred date and time', formatVisit(job.preferredStartAt)],
    ['Price', formatPence(job.pricePence)],
    ['Budget', `£${job.budgetMin}–£${job.budgetMax}`],
    ['Booked', formatDate(job.bookedAt)],
    ['Posted', formatDate(job.createdAt)],
  ]
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  const status = job.paymentStatus;
  mountJobChat(job);
  show('documents-section', Boolean(job.cleaner));
  document.getElementById('compliance-pack-btn').hidden = job.category !== 'industrial';
  show('offers-section', !status);
  show('payment-section', status === 'BOOKED');
  show('confirm-section', status === 'AWAITING_CONFIRMATION');
  await mountPhotos(job);
  show('cancel-section', ['BOOKED', 'PAID_HELD'].includes(status));
  show('review-section', false);
  show('job-detail', true);

  if (!status) await renderOffers(job);
  if (status === 'BOOKED') await mountPayment(job);
  if (status === 'AWAITING_CONFIRMATION') renderConfirmDeadline(job);
  renderCancelPolicy(job);
  await renderReview(job);

  const detail = document.getElementById('job-detail');
  const target = focusReview
    ? document.getElementById('review-section')
    : focusPayment && status === 'BOOKED'
      ? document.getElementById('payment-section')
      : detail;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Photos the cleaner took, and the ones you add with a problem report. All optional.
const PHOTO_STATES = ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED', 'CONFIRMED', 'PAYOUT_PENDING', 'PAYOUT_BLOCKED', 'TRANSFER_FAILED', 'MANUAL_REVIEW_HOLD', 'PAID_OUT', 'RESOLVED_PAYOUT', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND', 'PARTIALLY_REFUNDED', 'REFUNDED'];
let activePhotos = null;

async function mountPhotos(job) {
  if (activePhotos) activePhotos.destroy();
  activePhotos = null;
  const visible = PHOTO_STATES.includes(job.paymentStatus);
  show('photos-section', visible);
  if (!visible) return;
  activePhotos = await mountJobPhotos(document.getElementById('photos-mount'), {
    jobId: job._id,
    myRole: 'customer',
    add: ['AWAITING_CONFIRMATION', 'DISPUTED'].includes(job.paymentStatus) ? [{ kind: 'problem', label: 'Add photos of the problem' }] : [],
  });
}

// Chat opens once a cleaner has accepted; the server keeps it read-only
// after the job is finished.
function mountJobChat(job) {
  if (activeChat) activeChat.destroy();
  activeChat = null;
  show('chat-section', Boolean(job.cleaner));
  if (!job.cleaner) return;
  activeChat = mountChat(document.getElementById('chat-mount'), {
    jobId: job._id,
    onRead: () => {
      delete unreadByJob[job._id];
    },
  });
}

document.querySelectorAll('.doc-btn').forEach((btn) =>
  btn.addEventListener('click', async () => {
    hideAlert('page-alert');
    try {
      await openDocument(currentJob._id, btn.dataset.kind);
    } catch (err) {
      showAlert('page-alert', err.message);
    }
  })
);

document.getElementById('close-job').addEventListener('click', () => {
  if (activeChat) activeChat.destroy();
  activeChat = null;
  show('job-detail', false);
  currentJob = null;
});

async function renderOffers(job) {
  const list = document.getElementById('offers-list');
  const find = document.getElementById('find-cleaners');
  const isTender = job.procurement === 'tender';
  const closesAt = isTender && job.tender?.closesAt ? new Date(job.tender.closesAt) : null;
  const closed = Boolean(closesAt && closesAt.getTime() <= Date.now());

  document.getElementById('offers-title').textContent = isTender ? 'Quotes' : "Cleaners we've asked";
  document.getElementById('offers-help').textContent = isTender
    ? `Cleaners send their own prices. Compare them and award the job to one; the others are told. ${
        closesAt ? (closed ? 'Quotes closed' : 'Quotes close') + ` ${formatDate(closesAt)}.` : ''
      }`
    : "The first cleaner to accept books the job at their price. You'll get an email when that happens.";

  try {
    const offers = await apiRequest(`/jobs/${job._id}/offers`, { auth: true });
    find.hidden = isTender ? closed : offers.some((o) => o.status === 'sent');
    find.textContent = offers.length ? 'Find more cleaners' : 'Find cleaners';

    // Cheapest quote first for a tender; everyone else after.
    const ordered = isTender
      ? [...offers].sort((a, b) => (a.quotePricePence ?? Infinity) - (b.quotePricePence ?? Infinity))
      : offers;

    list.innerHTML = ordered.length
      ? ordered
          .map((o) => {
            const c = o.cleaner || {};
            const badges = [c.dbsVerified && 'DBS checked', c.coshhTrained && 'COSHH trained', c.insuranceStatus && c.insuranceStatus !== 'none' && 'Insured']
              .filter(Boolean)
              .map((b) => statusBadge(b, 'good'))
              .join(' ');
            const rating = c.ratingCount ? `★ ${Number(c.ratingAverage).toFixed(1)} (${c.ratingCount})` : 'New cleaner';
            const state = {
              sent: isTender ? 'Invited, no quote yet' : 'Offer sent',
              quoted: 'Quoted',
              accepted: 'Accepted',
              declined: 'Declined',
              expired: 'Expired',
            }[o.status] || o.status;
            const face = avatarHtml({ id: c._id, name: c.companyName || c.name, updatedAt: c.photo && c.photo.updatedAt });
            const head = (extra = '') =>
              `<div class="offer-head">${face}<div class="offer-head-text"><strong>${escapeHtml(c.companyName || c.name || 'Cleaner')}</strong> · ${escapeHtml(rating)} ${badges}${extra}</div></div>`;
            if (isTender && o.status === 'quoted') {
              return `<li>
                ${head()}
                <div><strong>${escapeHtml(formatPence(o.quotePricePence))}</strong> <span class="field-help">quoted ${escapeHtml(formatDate(o.quotedAt))}</span></div>
                ${o.quoteMessage ? `<p class="field-help" style="white-space: pre-wrap">${escapeHtml(o.quoteMessage)}</p>` : ''}
                <button type="button" class="award-quote" data-offer="${escapeHtml(o._id)}" data-name="${escapeHtml(c.companyName || c.name || 'this cleaner')}" data-price="${escapeHtml(o.quotePricePence)}">Award the job</button>
              </li>`;
            }
            return `<li>${head(` <span class="field-help">— ${escapeHtml(state)}</span>`)}</li>`;
          })
          .join('')
      : '<li>No cleaners have been asked yet.</li>';
    hydrateAvatars(list);

    list.querySelectorAll('.award-quote').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const price = formatPence(Number(btn.dataset.price));
        if (!window.confirm(`Award this job to ${btn.dataset.name} at ${price}? The other cleaners will be told, and you'll be asked to pay to confirm the booking.`)) return;
        btn.disabled = true;
        try {
          await apiRequest(`/jobs/${job._id}/offers/${btn.dataset.offer}/award`, { method: 'POST', auth: true });
          await loadJobs();
          await openJob(job._id);
        } catch (err) {
          showAlert('page-alert', err.message);
          btn.disabled = false;
        }
      })
    );
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
    const photoInput = document.getElementById('dispute-photos');
    const failedPhotos = photoInput.files.length ? await uploadJobPhotos(currentJob._id, 'problem', Array.from(photoInput.files).slice(0, 4)) : [];
    event.target.reset();
    showAlert(
      'page-success',
      failedPhotos.length
        ? `We've received your report, but some photos could not be added (${failedPhotos.join(' · ')}). You can add them again under Photos.`
        : "We've received your report. Payment is on hold while our team reviews it."
    );
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

// --- Tabs: My jobs / Messages ---
const conversations = setupConversations({
  listEl: document.getElementById('conversation-list'),
  paneEl: document.getElementById('conversation-pane'),
  titleEl: document.getElementById('conversation-title'),
  chatEl: document.getElementById('conversation-chat'),
  badgeEl: document.getElementById('messages-unread'),
  // Only jobs a cleaner has accepted have a conversation.
  fetchJobs: async () => (await apiRequest('/jobs/mine', { auth: true })).filter((job) => job.cleaner),
  titleFor: (job) => `${job.serviceType?.name || 'Cleaning'} · ${job.cleaner?.name || 'Cleaner'}`,
  subtitleFor: (job) => `Booked ${formatDate(job.bookedAt || job.createdAt)}`,
  emptyText: 'No conversations yet. Chat opens when a cleaner accepts your job.',
});

// --- Saved card (Stripe Payment Element; card details go straight to Stripe) ---
let cardStripe;
let cardElements;

function cardMessage(id, text) {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.hidden = !text;
}

function closeCardForm() {
  document.getElementById('card-form').hidden = true;
  document.getElementById('card-consent').checked = false;
  document.getElementById('card-element').innerHTML = '';
  cardElements = undefined;
}

async function loadCard() {
  cardMessage('card-alert', '');
  try {
    const card = await apiRequest('/customers/me/card', { auth: true });
    const summary = document.getElementById('card-summary');
    summary.textContent = card.saved
      ? `${card.brand.toUpperCase()} ending ${card.last4}, expires ${String(card.expMonth).padStart(2, '0')}/${card.expYear}.`
      : 'No card saved.';
    document.getElementById('card-remove').hidden = !card.saved;
    document.getElementById('card-add').textContent = card.saved ? 'Replace card' : 'Add a card';
    document.getElementById('card-add').hidden = false;
    closeCardForm();
  } catch (err) {
    cardMessage('card-alert', err.message);
  }
}

document.getElementById('card-add').addEventListener('click', async (event) => {
  cardMessage('card-alert', '');
  cardMessage('card-success', '');
  if (!STRIPE_PUBLISHABLE_KEY) {
    cardMessage('card-alert', 'Card payments are not set up on this site yet. Please contact us.');
    return;
  }
  event.target.disabled = true;
  try {
    const [{ clientSecret }, StripeJs] = await Promise.all([
      apiRequest('/customers/me/card/setup-intent', { method: 'POST', auth: true }),
      loadStripeJs(),
    ]);
    cardStripe = cardStripe || StripeJs(STRIPE_PUBLISHABLE_KEY);
    cardElements = cardStripe.elements({ clientSecret });
    const container = document.getElementById('card-element');
    container.innerHTML = '';
    cardElements.create('payment').mount(container);
    document.getElementById('card-form').hidden = false;
    event.target.hidden = true;
  } catch (err) {
    cardMessage('card-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

document.getElementById('card-cancel').addEventListener('click', loadCard);

document.getElementById('card-save').addEventListener('click', async (event) => {
  cardMessage('card-alert', '');
  if (!document.getElementById('card-consent').checked) {
    cardMessage('card-alert', 'Please tick the box to agree before saving your card.');
    return;
  }
  event.target.disabled = true;
  try {
    const { error, setupIntent } = await cardStripe.confirmSetup({
      elements: cardElements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) throw new Error(error.message);
    await apiRequest('/customers/me/card', {
      method: 'POST',
      body: { paymentMethodId: setupIntent.payment_method, consent: true },
      auth: true,
    });
    await loadCard();
    cardMessage('card-success', 'Card saved.');
  } catch (err) {
    cardMessage('card-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

document.getElementById('card-remove').addEventListener('click', async (event) => {
  if (!window.confirm('Remove your saved card?')) return;
  cardMessage('card-alert', '');
  event.target.disabled = true;
  try {
    await apiRequest('/customers/me/card', { method: 'DELETE', auth: true });
    await loadCard();
    cardMessage('card-success', 'Card removed.');
  } catch (err) {
    cardMessage('card-alert', err.message);
  } finally {
    event.target.disabled = false;
  }
});

// --- Regular cleaning (series) ---
async function loadSeries() {
  hideAlert('series-alert');
  const data = await mountSeries(document.getElementById('series-list'), {
    role: 'customer',
    alertId: 'series-alert',
    successId: 'series-success',
    onSaveCard: () => showView('card'),
  });
  return data;
}

// The tab only shows once recurring bookings are on, or the customer already has one.
async function revealSeriesTab() {
  try {
    const data = await apiRequest('/series/mine', { auth: true });
    document.getElementById('tab-series').hidden = !(data.enabled || (data.series || []).length);
  } catch (err) {
    // Leave it hidden: the rest of the page works without it.
  }
}

async function showView(name, { openJobId } = {}) {
  const messages = name === 'messages';
  const cardView = name === 'card';
  const seriesView = name === 'series';
  document.querySelectorAll('.tab-button').forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  show('view-jobs', name === 'jobs');
  show('view-messages', messages);
  show('view-card', cardView);
  show('view-series', seriesView);
  document.getElementById('show-post-job').hidden = name !== 'jobs';

  if (cardView) {
    cardMessage('card-success', '');
    await loadCard();
    return;
  }
  if (seriesView) {
    if (activeChat) activeChat.destroy();
    activeChat = null;
    conversations.close();
    try {
      await loadSeries();
    } catch (err) {
      showAlert('series-alert', err.message);
    }
    return;
  }

  if (messages) {
    // Only one live chat at a time: drop the one inside the job detail.
    if (activeChat) activeChat.destroy();
    activeChat = null;
    hideAlert('messages-alert');
    try {
      await conversations.reload({ openJobId });
    } catch (err) {
      showAlert('messages-alert', err.message);
    }
  } else {
    conversations.close();
    if (currentJob) mountJobChat(currentJob);
  }
}

document.querySelectorAll('.tab-button').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));

// --- Init (supports links from emails: ?job=ID[&review=1], and Stripe's return) ---
renderRatingOptions();
loadServiceTypes();
(async () => {
  await loadJobs();
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('job');
  await revealSeriesTab();
  if (params.get('tab') === 'series') {
    await showView('series');
    return;
  }
  if (params.get('tab') === 'messages') {
    await showView('messages', { openJobId: jobId });
    return;
  }
  // Unread count for the Messages tab badge. Leave it at its default
  // (hidden) state on error rather than claiming zero unread.
  fetchUnread()
    .then((unread) => {
      const badge = document.getElementById('messages-unread');
      badge.textContent = unread.total || 0;
      badge.hidden = !unread.total;
    })
    .catch(() => {});
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
