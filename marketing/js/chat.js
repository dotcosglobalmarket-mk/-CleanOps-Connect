import { API_BASE_URL } from './config.js';
import { apiRequest, getToken } from './api.js';
import { escapeHtml } from './dom.js';

// In-app chat between a customer and the cleaner booked on their job.
// Contact details (phone numbers, emails, postcodes, links) are hidden by the
// server before a message is stored; this file only displays what it gets.
//
// Live updates use a server-sent-events stream read with fetch() (so the
// normal Authorization header is used), plus a slow poll as a safety net for
// dropped connections or a second server instance.

const POLL_MS = 15 * 1000;
const RECONNECT_MS = 5 * 1000;
const MAX_RECONNECT_MS = 60 * 1000;
const MAX_LENGTH = 1000;

function formatTime(iso) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function fetchUnread() {
  return apiRequest('/chat/unread', { auth: true });
}

export function mountChat(container, { jobId, onRead } = {}) {
  let role = null;
  let writable = false;
  let lastId = null;
  let stopped = false;
  let streamAbort = null;
  let firstRender = true;
  const seen = new Set();

  container.innerHTML = `
    <div class="chat">
      <p class="chat-readonly field-help" hidden></p>
      <div class="chat-log" role="log" aria-live="polite" aria-label="Messages"></div>
      <div class="chat-notice alert alert-error" hidden></div>
      <form class="chat-form" autocomplete="off">
        <label class="visually-hidden" for="chat-input-${escapeHtml(jobId)}">Write a message</label>
        <textarea id="chat-input-${escapeHtml(jobId)}" rows="2" maxlength="${MAX_LENGTH}" placeholder="Write a message…" required></textarea>
        <button type="submit">Send</button>
      </form>
      <p class="chat-safety field-help">Phone numbers, emails, postcodes and links are hidden in chat to keep bookings and payments protected on CleanOps Connect.</p>
    </div>`;

  const log = container.querySelector('.chat-log');
  const form = container.querySelector('.chat-form');
  const input = form.querySelector('textarea');
  const sendButton = form.querySelector('button');
  const notice = container.querySelector('.chat-notice');
  const readonlyEl = container.querySelector('.chat-readonly');

  function setWritable(isWritable, reason) {
    writable = isWritable;
    form.hidden = !isWritable;
    readonlyEl.hidden = isWritable || !reason;
    readonlyEl.textContent = reason || '';
  }

  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function addMessages(messages) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let added = false;
    messages.forEach((m) => {
      if (seen.has(m._id)) return;
      seen.add(m._id);
      added = true;
      if (!lastId || m._id > lastId) lastId = m._id;
      const mine = m.senderRole === role;
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${mine ? 'chat-mine' : 'chat-theirs'}`;
      bubble.innerHTML = `
        <div class="chat-text">${escapeHtml(m.body)}</div>
        <div class="chat-meta">${mine ? 'You' : role === 'customer' ? 'Cleaner' : 'Customer'} · ${escapeHtml(formatTime(m.createdAt))}</div>`;
      log.appendChild(bubble);
    });
    if (added && (nearBottom || firstRender)) log.scrollTop = log.scrollHeight;
    if (added) firstRender = false;
    return added;
  }

  function renderEmptyState() {
    if (log.querySelector('.chat-bubble')) {
      log.querySelector('.chat-empty')?.remove();
      return;
    }
    if (!log.querySelector('.chat-empty')) {
      log.innerHTML = '<p class="chat-empty field-help">No messages yet. Say hello!</p>';
    }
  }

  async function load() {
    const query = lastId ? `?after=${encodeURIComponent(lastId)}` : '';
    const data = await apiRequest(`/chat/jobs/${jobId}/messages${query}`, { auth: true });
    role = data.role;
    setWritable(data.writable, data.reason);
    if (data.messages.length) log.querySelector('.chat-empty')?.remove();
    const added = addMessages(data.messages);
    renderEmptyState();
    if (added && onRead) onRead();
  }

  async function poll() {
    if (stopped) return;
    try {
      await load();
    } catch (err) {
      // A transient failure is retried on the next tick.
    }
  }

  async function openStream() {
    let reconnectDelay = RECONNECT_MS;
    while (!stopped) {
      streamAbort = new AbortController();
      try {
        const response = await fetch(`${API_BASE_URL}/chat/jobs/${jobId}/stream`, {
          headers: { Authorization: `Bearer ${getToken()}`, Accept: 'text/event-stream' },
          signal: streamAbort.signal,
        });
        if (!response.ok || !response.body) {
          const err = new Error(`stream ${response.status}`);
          err.status = response.status;
          throw err;
        }
        // Connected: reset backoff and clear any "still trying" notice.
        reconnectDelay = RECONNECT_MS;
        showNotice('');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
            if (frame.includes('event: message') && dataLine) {
              // Reload from the server so the message is marked read and
              // the read-only state stays correct.
              await poll();
            }
          }
        }
      } catch (err) {
        if (stopped) return;
        // 401/403 won't clear on retry (expired session or chat access
        // revoked, e.g. by a dispute) — stop hammering the server and tell
        // the user, instead of retrying forever. The 15s poll fallback
        // will still pick up new messages once the underlying issue (login,
        // access) is resolved and the page is reloaded.
        if (err.status === 401 || err.status === 403) {
          showNotice('Live updates stopped — refresh the page to reconnect.');
          return;
        }
      }
      if (!stopped) {
        showNotice('Reconnecting to live updates…');
        await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body || !writable) return;
    sendButton.disabled = true;
    showNotice('');
    try {
      const result = await apiRequest(`/chat/jobs/${jobId}/messages`, { method: 'POST', body: { body }, auth: true });
      input.value = '';
      log.querySelector('.chat-empty')?.remove();
      addMessages([result.message]);
      log.scrollTop = log.scrollHeight;
      if (result.notice) showNotice(result.notice);
    } catch (err) {
      showNotice(err.message);
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });

  // Enter sends, Shift+Enter adds a new line.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  const pollTimer = setInterval(poll, POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') poll();
  };
  document.addEventListener('visibilitychange', onVisible);

  poll().then(() => {
    if (!stopped) openStream();
  });

  return {
    destroy() {
      stopped = true;
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (streamAbort) streamAbort.abort();
      container.innerHTML = '';
    },
  };
}

// A conversation list (one entry per job) beside a chat pane, with unread
// badges. Shared by the customer and cleaner dashboards.
export function setupConversations({ listEl, paneEl, titleEl, chatEl, badgeEl, fetchJobs, titleFor, subtitleFor, emptyText }) {
  let jobs = [];
  let unreadByJob = {};
  let activeChat = null;
  let activeJobId = null;

  function setBadge() {
    const total = Object.values(unreadByJob).reduce((sum, n) => sum + n, 0);
    badgeEl.textContent = total;
    badgeEl.hidden = !total;
  }

  function close() {
    if (activeChat) activeChat.destroy();
    activeChat = null;
    activeJobId = null;
    paneEl.hidden = true;
    renderList();
  }

  function open(jobId) {
    const job = jobs.find((j) => j._id === jobId);
    if (!job) return;
    if (activeChat) activeChat.destroy();
    activeJobId = jobId;
    titleEl.textContent = titleFor(job);
    paneEl.hidden = false;
    activeChat = mountChat(chatEl, {
      jobId,
      onRead: () => {
        delete unreadByJob[jobId];
        setBadge();
        renderList();
      },
    });
    renderList();
  }

  function renderList() {
    if (!jobs.length) {
      listEl.innerHTML = `<li class="table-empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    listEl.innerHTML = jobs
      .map((job) => {
        const unread = unreadByJob[job._id];
        return `
          <li>
            <button type="button" class="conversation-item secondary${job._id === activeJobId ? ' is-active' : ''}" data-id="${escapeHtml(job._id)}">
              <span>${escapeHtml(titleFor(job))}<br /><span class="field-help">${escapeHtml(subtitleFor(job))}</span></span>
              ${unread ? `<span class="unread-badge" aria-label="${escapeHtml(unread)} unread messages">${escapeHtml(unread)}</span>` : ''}
            </button>
          </li>`;
      })
      .join('');
    listEl.querySelectorAll('.conversation-item').forEach((btn) => btn.addEventListener('click', () => open(btn.dataset.id)));
  }

  async function reload({ openJobId } = {}) {
    const [fetched, unread] = await Promise.all([fetchJobs(), fetchUnread()]);
    jobs = fetched;
    unreadByJob = unread.byJob || {};
    setBadge();
    renderList();
    if (openJobId && activeJobId !== openJobId) open(openJobId);
  }

  return { reload, close };
}
