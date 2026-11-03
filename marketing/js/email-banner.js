import { apiRequest, getRole } from './api.js';
import { escapeHtml } from './dom.js';

// A notice at the top of the customer and cleaner dashboards while the email address is not
// confirmed, with a button to send the link again. Shown only when the server can send email.
export async function mountEmailBanner(root) {
  if (!root) return;
  let status;
  try {
    status = await apiRequest('/auth/email-status', { auth: true });
  } catch (err) {
    return;
  }
  if (status.verified || !status.canSend) {
    root.innerHTML = '';
    return;
  }

  const blockedText = getRole() === 'cleaner'
    ? 'Until you do, you cannot accept offers, send quotes or start a subscription.'
    : 'Until you do, you cannot post a job.';
  root.innerHTML = `
    <div class="recurring-notice" role="status">
      <p><strong>Please confirm your email address.</strong> We emailed you a link when you registered.
      ${status.blocked ? escapeHtml(blockedText) : 'It lets us reach you about bookings and payments.'}</p>
      <p data-email="message" hidden></p>
      <button type="button" class="secondary" data-email="resend">Send me a new link</button>
    </div>`;

  const message = root.querySelector('[data-email="message"]');
  const resend = root.querySelector('[data-email="resend"]');
  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      const result = await apiRequest('/auth/resend-verification', { method: 'POST', auth: true });
      message.textContent = result.verified ? 'Your address is already confirmed.' : 'We have sent a new link. Check your inbox and spam folder.';
    } catch (err) {
      message.textContent = err.message;
    }
    message.hidden = false;
    setTimeout(() => { resend.disabled = false; }, 15000);
  });
}
