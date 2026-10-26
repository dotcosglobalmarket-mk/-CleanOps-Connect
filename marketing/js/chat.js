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
const MAX_LENGTH = 1000;

function formatTime(iso) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function fetchUnread() {
  try {
    return await apiRequest('/chat/unread', { auth: true });
  } catch (err) {
    return { total: 0, byJob: {} };
  }
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
    while (!stopped) {
      streamAbort = new AbortController();
      try {
        const response = await fetch(`${API_BASE_URL}/chat/jobs/${jobId}/stream`, {
          headers: { Authorization: `Bearer ${getToken()}`, Accept: 'text/event-stream' },
          signal: streamAbort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
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
      }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
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
