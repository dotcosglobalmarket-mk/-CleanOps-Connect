import { apiRequest } from './api.js';
import { showAlert, hideAlert, formatDate } from './dashboard-ui.js';
import { setupConversations } from './chat.js';

// Messages tab of the cleaner dashboard: one conversation per accepted job.

const conversations = setupConversations({
  listEl: document.getElementById('conversation-list'),
  paneEl: document.getElementById('conversation-pane'),
  titleEl: document.getElementById('conversation-title'),
  chatEl: document.getElementById('conversation-chat'),
  badgeEl: document.getElementById('messages-unread'),
  fetchJobs: () => apiRequest('/cleaners/me/jobs', { auth: true }),
  titleFor: (job) => `${job.serviceType?.name || 'Cleaning'} · ${job.customer?.name || 'Customer'}`,
  subtitleFor: (job) => `Booked ${formatDate(job.bookedAt)}`,
  emptyText: 'No conversations yet. They start when you accept a job.',
});

async function load() {
  hideAlert('messages-alert');
  try {
    // A link from an email (?tab=messages&job=ID) opens that conversation.
    await conversations.reload({ openJobId: new URLSearchParams(window.location.search).get('job') });
  } catch (err) {
    if (err.status !== 404) showAlert('messages-alert', err.message);
  }
}

document.getElementById('messages-refresh').addEventListener('click', load);
load();
