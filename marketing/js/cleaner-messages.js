import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';
import { showAlert, hideAlert } from './dashboard-ui.js';
import { mountChat, fetchUnread } from './chat.js';

// Messages tab of the cleaner dashboard: one conversation per accepted job.

const list = document.getElementById('conversation-list');
const pane = document.getElementById('conversation-pane');
const title = document.getElementById('conversation-title');
const tabBadge = document.getElementById('messages-unread');

let activeChat = null;
let activeJobId = null;
let unreadByJob = {};

function setTabBadge(total) {
  tabBadge.textContent = total;
  tabBadge.hidden = !total;
}

function closeConversation() {
  if (activeChat) activeChat.destroy();
  activeChat = null;
  activeJobId = null;
  pane.hidden = true;
}

function openConversation(job) {
  closeConversation();
  activeJobId = job._id;
  title.textContent = `${job.serviceType?.name || 'Cleaning'} · ${job.customer?.name || 'Customer'}`;
  pane.hidden = false;
  activeChat = mountChat(document.getElementById('conversation-chat'), {
    jobId: job._id,
    onRead: () => {
      delete unreadByJob[job._id];
      setTabBadge(Object.values(unreadByJob).reduce((sum, n) => sum + n, 0));
      renderList(currentJobs);
    },
  });
  renderList(currentJobs);
}

let currentJobs = [];

function renderList(jobs) {
  if (!jobs.length) {
    list.innerHTML = '<li class="table-empty">No conversations yet. They start when you accept a job.</li>';
    return;
  }
  list.innerHTML = jobs
    .map((job) => {
      const unread = unreadByJob[job._id];
      return `
        <li>
          <button type="button" class="conversation-item secondary${job._id === activeJobId ? ' is-active' : ''}" data-id="${escapeHtml(job._id)}">
            <span>${escapeHtml(job.serviceType?.name || 'Cleaning')}<br /><span class="field-help">${escapeHtml(job.customer?.name || 'Customer')}</span></span>
            ${unread ? `<span class="unread-badge" aria-label="${escapeHtml(unread)} unread messages">${escapeHtml(unread)}</span>` : ''}
          </button>
        </li>`;
    })
    .join('');
  list.querySelectorAll('.conversation-item').forEach((btn) =>
    btn.addEventListener('click', () => openConversation(currentJobs.find((j) => j._id === btn.dataset.id)))
  );
}

async function loadConversations() {
  hideAlert('messages-alert');
  try {
    const [jobs, unread] = await Promise.all([apiRequest('/cleaners/me/jobs', { auth: true }), fetchUnread()]);
    currentJobs = jobs;
    unreadByJob = unread.byJob || {};
    setTabBadge(unread.total || 0);
    renderList(jobs);

    // A link from an email (?tab=messages&job=ID) opens that conversation.
    const wanted = new URLSearchParams(window.location.search).get('job');
    const target = wanted && jobs.find((j) => j._id === wanted);
    if (target && activeJobId !== target._id) openConversation(target);
  } catch (err) {
    if (err.status !== 404) showAlert('messages-alert', err.message);
  }
}

document.getElementById('messages-refresh').addEventListener('click', loadConversations);
loadConversations();
