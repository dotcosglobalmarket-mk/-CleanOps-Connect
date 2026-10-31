import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';
import { renderTable, statusBadge, formatPence, formatVisit, showAlert, hideAlert } from './dashboard-ui.js';

// The "regular cleaning" cards, shared by the customer and cleaner pages. The
// server decides which buttons each person may press (canSkip / canCancel); this
// file only words things and sends the request.

const FREQUENCY = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
const STATUS = {
  awaiting_card: ['Waiting to start', 'warn'],
  active: ['Running', 'good'],
  paused: ['Paused', 'warn'],
  cancelled: ['Cancelled', 'bad'],
  ended: ['Ended', 'bad'],
};
const VISIT = {
  scheduled: ['Scheduled', 'warn'],
  awaiting_payment: ['Awaiting payment', 'bad'],
  paid: ['Paid, booked', 'good'],
  in_progress: ['In progress', 'good'],
  awaiting_confirmation: ['Awaiting confirmation', 'warn'],
  disputed: ['Problem reported', 'warn'],
  done: ['Done', 'good'],
  cancelled: ['Cancelled', 'bad'],
  skipped: ['Skipped', 'bad'],
};
const CHARGE_AHEAD_HOURS = 48;
const NOTICE_DAYS = 14;

function longDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

function skipWhy(visit, role) {
  const by = { customer: role === 'customer' ? 'by you' : 'by the customer', cleaner: role === 'cleaner' ? 'by you' : 'by your cleaner' };
  if (visit.skipReason === 'customer' || visit.skipReason === 'cleaner') return `Skipped ${by[visit.skipReason]}`;
  if (visit.skipReason === 'payment') return 'Card could not be charged';
  if (visit.skipReason === 'missed') return 'Not reached while paused';
  if (visit.skipReason === 'series_ended') return 'Series ended';
  return 'Skipped';
}

function visitStatusCell(visit, role) {
  const [label, kind] = VISIT[visit.state] || [visit.state, 'warn'];
  let note = '';
  if (visit.state === 'skipped') note = skipWhy(visit, role);
  if (visit.state === 'scheduled') {
    const chargeAt = new Date(new Date(visit.startsAt).getTime() - CHARGE_AHEAD_HOURS * 3600 * 1000);
    note = role === 'customer' ? `Charged ${formatVisit(chargeAt)}` : `Paid for from ${formatVisit(chargeAt)}`;
  }
  return `<div class="visit-status">${statusBadge(label, kind)}${note ? `<div class="field-help">${escapeHtml(note)}</div>` : ''}</div>`;
}

function visitButton(visit, role) {
  if (role === 'customer' && visit.canSkip) {
    return `<button type="button" class="secondary series-skip" data-job="${escapeHtml(visit._id)}">Skip this visit</button>`;
  }
  if (role === 'cleaner' && visit.canCancel) {
    return `<button type="button" class="secondary series-cleaner-cancel" data-job="${escapeHtml(visit._id)}">I can’t attend</button>`;
  }
  return '';
}

function pausedMessage(series, role) {
  const customer = role === 'customer';
  if (series.pausedBy === 'payment') {
    return customer
      ? 'Paused: two visits in a row could not be paid for. Check your saved card, then resume.'
      : 'Paused because the customer’s card could not be charged for two visits in a row.';
  }
  if (series.pausedBy === 'cleaner_cancellations') {
    return customer
      ? 'Paused because your cleaner cancelled more than one visit. You can resume with the same cleaner, or cancel and post a new job.'
      : 'Paused after your second cancelled visit. The customer decides whether to resume.';
  }
  return customer ? 'Paused by you. No visits are charged until you resume.' : 'The customer has paused this series. Visits are not charged until they resume.';
}

function message(series, role) {
  if (series.status === 'awaiting_card') {
    if (role === 'customer' && series.needsCard) {
      return '<p class="recurring-notice"><strong>Save a card to start your regular visits.</strong> Your first visit is paid for as normal. Later visits are charged to the card 48 hours before each one, and you can skip any visit for free until then.</p>';
    }
    return `<p class="field-help">${role === 'customer' ? 'Your first visit needs to be paid for before the regular visits start.' : 'Regular visits start once the customer has paid for the first one and saved a card.'}</p>`;
  }
  if (series.status === 'paused') return `<p class="recurring-notice">${escapeHtml(pausedMessage(series, role))}</p>`;
  if (series.endNoticeGivenAt && series.status !== 'ended' && series.status !== 'cancelled') {
    return `<p class="field-help">${role === 'customer' ? 'Your cleaner has given notice.' : 'You have given notice.'} The series ends on ${escapeHtml(longDate(series.endsOn))}.</p>`;
  }
  return '';
}

function seriesButtons(series, role) {
  const live = ['awaiting_card', 'active', 'paused'].includes(series.status);
  if (!live) return '';
  const out = [];
  if (role === 'customer') {
    if (series.needsCard) out.push('<button type="button" class="series-card-btn">Save a card</button>');
    if (series.status === 'active') out.push('<button type="button" class="secondary series-pause">Pause</button>');
    if (series.status === 'paused') out.push('<button type="button" class="series-resume">Resume</button>');
    out.push('<button type="button" class="secondary series-cancel">Cancel the series</button>');
  } else if (!series.endNoticeGivenAt) {
    out.push(`<button type="button" class="secondary series-end">Give ${NOTICE_DAYS} days’ notice</button>`);
  }
  return out.length ? `<div class="series-actions">${out.join(' ')}</div>` : '';
}

function card(series, role) {
  const [label, kind] = STATUS[series.status] || [series.status, 'warn'];
  const table = renderTable({
    fit: true,
    phoneOnly: true,
    columns: ['Visit', 'When', 'Status', ''],
    emptyMessage: 'No visits yet. They appear a couple of weeks ahead.',
    rows: series.visits.map(
      (v) => `
        <tr data-job="${escapeHtml(v._id)}">
          <td>#${escapeHtml(v.visitNumber)}</td>
          <td>${escapeHtml(formatVisit(v.startsAt))}</td>
          <td>${visitStatusCell(v, role)}</td>
          <td class="table-actions">${visitButton(v, role)}</td>
        </tr>`
    ),
  });
  return `
    <article class="card series-card" data-series="${escapeHtml(series._id)}">
      <div class="section-heading">
        <h3>${escapeHtml(series.serviceType?.name || 'Regular clean')} with ${escapeHtml(series.with || '—')}</h3>
        ${statusBadge(label, kind)}
      </div>
      <p class="field-help">${escapeHtml(FREQUENCY[series.frequency] || series.frequency)} · ${escapeHtml(formatPence(series.pricePence))} per visit · until ${escapeHtml(longDate(series.endsOn))}</p>
      ${message(series, role)}
      ${seriesButtons(series, role)}
      <div class="table-wrap fit">${table}</div>
    </article>`;
}

// What the person is told before each action goes ahead.
function confirmSkip(visit) {
  const when = formatVisit(visit.startsAt);
  if (visit.state === 'scheduled') return `Skip the visit on ${when}? You will not be charged for it.`;
  return `The visit on ${when} has already been charged. If you skip it, half of ${formatPence(visit.pricePence)} is refunded to your card. Skip it?`;
}
function confirmCleanerCancel(visit) {
  const refund = visit.state === 'scheduled' ? '' : ' The customer is refunded in full.';
  return `Cancel the visit on ${formatVisit(visit.startsAt)}?${refund} A second cancelled visit pauses the whole series.`;
}

// Loads the person's series into `container`. Returns what the server said, so the
// page can decide whether to show its tab at all.
export async function mountSeries(container, { role, alertId, successId, onSaveCard }) {
  const data = await apiRequest('/series/mine', { auth: true });
  const all = data.series || [];
  container.innerHTML = all.length
    ? all.map((s) => card(s, role)).join('')
    : `<div class="table-empty">${role === 'customer' ? 'Regular cleaning appears here once a cleaner accepts a weekly, fortnightly or monthly job.' : 'Regular bookings appear here once you accept a weekly, fortnightly or monthly job.'}</div>`;

  const flash = (text) => {
    if (!successId) return;
    const el = document.getElementById(successId);
    el.textContent = text;
    el.hidden = !text;
  };
  const act = async (path, done, button) => {
    hideAlert(alertId);
    flash('');
    button.disabled = true;
    try {
      await apiRequest(path, { method: 'POST', auth: true });
      await mountSeries(container, { role, alertId, successId, onSaveCard });
      flash(done);
    } catch (err) {
      showAlert(alertId, err.message);
      button.disabled = false;
    }
  };

  container.querySelectorAll('.series-card').forEach((el) => {
    const series = all.find((s) => String(s._id) === el.dataset.series);
    const base = `/series/${series._id}`;
    const find = (jobId) => series.visits.find((v) => String(v._id) === jobId);

    el.querySelector('.series-card-btn')?.addEventListener('click', () => onSaveCard && onSaveCard());
    el.querySelector('.series-pause')?.addEventListener('click', (e) => {
      if (window.confirm('Pause your regular cleaning? No visits are charged until you resume.')) act(`${base}/pause`, 'Paused.', e.currentTarget);
    });
    el.querySelector('.series-resume')?.addEventListener('click', (e) => act(`${base}/resume`, 'Resumed.', e.currentTarget));
    el.querySelector('.series-cancel')?.addEventListener('click', (e) => {
      if (window.confirm('Cancel the whole series? Visits that have not been charged are cancelled. A visit already paid for stays booked, and you can skip it separately.')) {
        act(`${base}/cancel`, 'Series cancelled.', e.currentTarget);
      }
    });
    el.querySelector('.series-end')?.addEventListener('click', (e) => {
      const ends = longDate(new Date(Date.now() + NOTICE_DAYS * 24 * 3600 * 1000));
      if (window.confirm(`Give ${NOTICE_DAYS} days' notice? The series will end on ${ends}. Visits up to then still go ahead.`)) {
        act(`${base}/end`, `Notice given. The series ends on ${ends}.`, e.currentTarget);
      }
    });
    el.querySelectorAll('.series-skip').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        const visit = find(btn.dataset.job);
        if (window.confirm(confirmSkip(visit))) act(`${base}/visits/${visit._id}/skip`, 'Visit skipped.', e.currentTarget);
      })
    );
    el.querySelectorAll('.series-cleaner-cancel').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        const visit = find(btn.dataset.job);
        if (window.confirm(confirmCleanerCancel(visit))) act(`${base}/visits/${visit._id}/cleaner-cancel`, 'Visit cancelled.', e.currentTarget);
      })
    );
  });
  return data;
}
