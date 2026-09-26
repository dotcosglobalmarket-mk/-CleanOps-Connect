import { escapeHtml } from './dom.js';

// Shared helpers for the staff dashboards (admin.html, ops.html).

// Mirrors src/services/payment-state-machine.js STATES on the backend —
// duplicated here only to populate the payment-status filter dropdown.
export const PAYMENT_STATES = [
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

export function showAlert(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.hidden = false;
}

export function hideAlert(id) {
  document.getElementById(id).hidden = true;
}

export function showSuccess(id, message) {
  showAlert(id, message);
}

export function renderTable({ columns, rows, emptyMessage }) {
  if (!rows.length) {
    return `<div class="table-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <table class="data-table">
      <thead><tr>${columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

export function statusBadge(value, kind) {
  const classes = { good: 'badge-success', bad: 'badge-error', warn: 'badge-warning' };
  return `<span class="badge ${classes[kind] || ''}">${escapeHtml(value)}</span>`;
}

export function paymentStatusBadge(status) {
  return statusBadge(status, status === 'MANUAL_REVIEW_HOLD' ? 'bad' : 'warn');
}

export function deactivationBadge(status) {
  const kind = status === 'suspended' ? 'bad' : status === 'under_review' ? 'warn' : 'good';
  return statusBadge(status, kind);
}

export function formatPence(pence) {
  return typeof pence === 'number' ? `£${(pence / 100).toFixed(2)}` : '—';
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-GB') : '—';
}

export function shortId(id) {
  return escapeHtml(String(id || '').slice(-8));
}

// Sidebar tabs with ARIA tab semantics. `onShow(panelName)` runs each time a
// tab is selected so panels can load lazily.
export function setupTabs(onShow) {
  const tabs = Array.from(document.querySelectorAll('.dash-nav-item'));
  const sidebar = document.querySelector('.dash-sidebar');
  if (sidebar) sidebar.setAttribute('role', 'tablist');

  function select(tab) {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(`panel-${t.dataset.panel}`);
      panel.classList.toggle('is-active', active);
    });
    if (onShow) onShow(tab.dataset.panel);
  }

  tabs.forEach((tab, index) => {
    const panel = document.getElementById(`panel-${tab.dataset.panel}`);
    tab.id = tab.id || `tab-${tab.dataset.panel}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.setAttribute('aria-selected', String(tab.classList.contains('is-active')));
    tab.tabIndex = tab.classList.contains('is-active') ? 0 : -1;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);

    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  });

  document.querySelectorAll('.alert').forEach((el) => el.setAttribute('aria-live', 'polite'));
}
