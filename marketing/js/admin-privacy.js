import { apiRequest, apiFetchBlob } from './api.js';
import { escapeHtml } from './dom.js';
import { showAlert, hideAlert, formatDate, renderTable, statusBadge } from './dashboard-ui.js';

// Privacy Requests tab: look a person up, download a copy of their data, or erase
// their account. The server does the work and refuses anything unsafe (money still
// in flight, a wrong confirmation); this only gathers the inputs.

let person = null;

const el = (id) => document.getElementById(id);

function clearMessages() {
  hideAlert('privacy-alert');
  hideAlert('privacy-success');
}

function syncButtons() {
  const checked = el('privacy-identity').checked && person;
  el('privacy-export').disabled = !checked;
  el('privacy-erase').disabled = !(checked && person.blockers.length === 0 && !person.erasedAt);
}

function showPerson(found) {
  person = found;
  el('privacy-name').textContent = `${found.name} (${found.role})`;
  el('privacy-facts').innerHTML = [
    ['Email', escapeHtml(found.email)],
    ['Joined', escapeHtml(formatDate(found.createdAt))],
    ['Bookings on record', escapeHtml(found.jobs)],
    ['Status', found.erasedAt ? `Erased ${escapeHtml(formatDate(found.erasedAt))}` : found.active ? 'Active' : 'Closed'],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  const blockers = el('privacy-blockers');
  blockers.hidden = found.blockers.length === 0;
  blockers.innerHTML = found.blockers.length
    ? `<strong>This account cannot be erased yet:</strong><ul>${found.blockers.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '';
  el('privacy-identity').checked = false;
  el('privacy-reason').value = '';
  el('privacy-confirm').value = '';
  el('privacy-person').hidden = false;
  syncButtons();
}

el('privacy-lookup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  el('privacy-person').hidden = true;
  person = null;
  try {
    showPerson(await apiRequest(`/admin/privacy/lookup?email=${encodeURIComponent(el('privacy-email').value.trim())}`, { auth: true }));
  } catch (err) {
    showAlert('privacy-alert', err.message);
  }
});

el('privacy-identity').addEventListener('change', syncButtons);

el('privacy-export').addEventListener('click', async () => {
  clearMessages();
  if (!person) return;
  try {
    const blob = await apiFetchBlob(`/admin/privacy/${person.id}/export?identityChecked=true`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cleanops-data-${person.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showAlert('privacy-success', 'Their data was downloaded and the copy recorded in the audit log. Check the staff notes in it before you send it.');
  } catch (err) {
    showAlert('privacy-alert', err.message);
  }
});

el('privacy-erase-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessages();
  if (!person) return;
  if (!window.confirm(`Erase ${person.name}'s account? This cannot be undone.`)) return;
  el('privacy-erase').disabled = true;
  try {
    await apiRequest(`/admin/privacy/${person.id}/erase`, {
      method: 'POST',
      auth: true,
      body: { identityChecked: true, confirmEmail: el('privacy-confirm').value, reason: el('privacy-reason').value },
    });
    showAlert('privacy-success', 'The account was erased and the erasure recorded in the audit log.');
    el('privacy-person').hidden = true;
    person = null;
  } catch (err) {
    showAlert('privacy-alert', err.message);
    syncButtons();
  }
});

// --- Requests made from the account page ---

const TYPES = { export: 'Copy of their data', erase: 'Delete account' };

export async function loadPrivacyRequests() {
  const box = el('privacy-requests');
  try {
    const requests = await apiRequest('/admin/privacy/requests', { auth: true });
    box.innerHTML = renderTable({
      columns: ['Person', 'Asked for', 'Received', 'Reply by', 'Their note', 'Actions'],
      emptyMessage: 'No requests waiting.',
      fit: true,
      rows: requests.map(
        (r) => `<tr>
          <td>${r.person ? `${escapeHtml(r.person.name)}<br /><span class="field-help">${escapeHtml(r.person.email)} (${escapeHtml(r.person.role)})</span>` : 'Unknown'}</td>
          <td>${escapeHtml(TYPES[r.type] || r.type)}</td>
          <td>${escapeHtml(formatDate(r.createdAt))}</td>
          <td>${escapeHtml(formatDate(r.dueAt))} ${r.overdue ? statusBadge('Overdue', 'bad') : ''}</td>
          <td>${escapeHtml(r.note || '')}</td>
          <td>
            <button type="button" class="secondary" data-request-lookup="${escapeHtml(r.person ? r.person.email : '')}">Look up</button>
            <button type="button" data-request-done="${escapeHtml(r.id)}">Mark done</button>
            <button type="button" class="danger" data-request-decline="${escapeHtml(r.id)}">Decline</button>
          </td>
        </tr>`
      ),
    });
  } catch (err) {
    showAlert('privacy-alert', err.message);
  }
}

async function closeRequest(id, body) {
  clearMessages();
  try {
    await apiRequest(`/admin/privacy/requests/${id}/close`, { method: 'POST', auth: true, body });
    showAlert('privacy-success', 'Request closed. The person has been emailed and the decision is in the audit log.');
    await loadPrivacyRequests();
  } catch (err) {
    showAlert('privacy-alert', err.message);
  }
}

el('privacy-requests').addEventListener('click', (event) => {
  const lookup = event.target.closest('[data-request-lookup]');
  const done = event.target.closest('[data-request-done]');
  const decline = event.target.closest('[data-request-decline]');
  if (lookup) {
    el('privacy-email').value = lookup.dataset.requestLookup;
    el('privacy-lookup-form').requestSubmit();
  } else if (done) {
    if (window.confirm('Mark this request done? Only do this once you have sent the copy or erased the account.')) {
      closeRequest(done.dataset.requestDone, { outcome: 'done' });
    }
  } else if (decline) {
    const reason = window.prompt('Why is this request being declined? The person will be told.');
    if (reason && reason.trim().length >= 3) closeRequest(decline.dataset.requestDecline, { outcome: 'declined', reason: reason.trim() });
  }
});
