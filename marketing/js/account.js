import { apiRequest, getRole, getToken, setSession } from './api.js';
import { escapeHtml } from './dom.js';
import { formatDate } from './dashboard-ui.js';

// Account settings for customers and cleaners: change password, and ask for a copy of
// their data or for their account to be deleted. The server does the checking.

const role = getRole();
if (!getToken() || (role !== 'customer' && role !== 'cleaner')) {
  window.location.href = 'login.html';
}
document.getElementById('back-link').href = role === 'cleaner' ? 'cleaner.html' : 'customer.html';

const el = (id) => document.getElementById(id);
function say(prefix, kind, text) {
  el(`${prefix}-alert`).hidden = true;
  el(`${prefix}-success`).hidden = true;
  if (!text) return;
  const box = el(`${prefix}-${kind}`);
  box.textContent = text;
  box.hidden = false;
}

el('pw-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  say('pw', 'alert');
  const button = event.submitter;
  button.disabled = true;
  try {
    const out = await apiRequest('/account/change-password', {
      method: 'POST',
      auth: true,
      body: { currentPassword: el('pw-current').value, newPassword: el('pw-new').value },
    });
    // Keep this device signed in with the fresh session; others have been signed out.
    setSession(out.token, out.user);
    el('pw-form').reset();
    say('pw', 'success', 'Your password has been changed. Other devices have been signed out.');
  } catch (err) {
    say('pw', 'alert', err.message);
  } finally {
    button.disabled = false;
  }
});

const TYPES = { export: 'Copy of my data', erase: 'Delete my account' };
const STATUS = { pending: 'Waiting', done: 'Done', declined: 'Declined' };

function renderList(requests) {
  el('dr-list').innerHTML = requests.length
    ? `<ul>${requests
        .map(
          (r) =>
            `<li><strong>${escapeHtml(TYPES[r.type] || r.type)}</strong>: ${escapeHtml(STATUS[r.status] || r.status)}` +
            ` (asked ${escapeHtml(formatDate(r.createdAt))}` +
            `${r.status === 'pending' ? `, we will reply by ${escapeHtml(formatDate(r.dueAt))}` : ''})` +
            `${r.outcomeNote ? ` — ${escapeHtml(r.outcomeNote)}` : ''}</li>`
        )
        .join('')}</ul>`
    : '<p class="field-help">You have not made any requests.</p>';
}

async function loadList() {
  try {
    renderList(await apiRequest('/account/data-requests', { auth: true }));
  } catch (err) {
    say('dr', 'alert', err.message);
  }
}

const chosen = () => document.querySelector('input[name="dr-type"]:checked').value;
document.querySelectorAll('input[name="dr-type"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    el('dr-password-row').hidden = chosen() !== 'erase';
  })
);

el('dr-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  say('dr', 'alert');
  const type = chosen();
  if (type === 'erase' && !window.confirm('Ask us to delete your account? This cannot be undone once we have done it.')) return;
  el('dr-submit').disabled = true;
  try {
    const out = await apiRequest('/account/data-requests', {
      method: 'POST',
      auth: true,
      body: { type, note: el('dr-note').value, currentPassword: type === 'erase' ? el('dr-password').value : undefined },
    });
    el('dr-form').reset();
    el('dr-password-row').hidden = true;
    say('dr', 'success', out.alreadyOpen ? 'You already have this request open. We will reply by the date shown below.' : 'Thank you. We have your request and will reply within one month.');
    await loadList();
  } catch (err) {
    say('dr', 'alert', err.message);
  } finally {
    el('dr-submit').disabled = false;
  }
});

loadList();
