const logger = require('../utils/logger');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// Builds a plain, accessible email from paragraphs and an optional button.
function render({ heading, paragraphs = [], action }) {
  const text = [heading, '', ...paragraphs, action ? `\n${action.label}: ${action.url}` : '', '', '— CleanOps Connect']
    .filter((line) => line !== undefined)
    .join('\n');

  const html = `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>` : ''}
<p style="color:#52606d;font-size:13px">CleanOps Connect</p>
</body></html>`;

  return { text, html };
}

// Sends one email through Resend. Without RESEND_API_KEY / EMAIL_FROM it
// only logs (local development and tests). Never throws: an email failure
// must not undo a booking or a payment.
async function send({ to, subject, heading, paragraphs, action }) {
  if (!to) return { skipped: 'no recipient' };

  if (!isConfigured()) {
    logger.info(`[email] (not sent — RESEND_API_KEY/EMAIL_FROM not set) to=${to} subject="${subject}"`);
    return { skipped: 'not configured' };
  }

  // Drop a button whose link could not be built (FRONTEND_URL not set).
  const usableAction = action && action.url ? action : undefined;
  const { text, html } = render({ heading: heading || subject, paragraphs, action: usableAction });
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      const body = await response.text();
      logger.error(`[email] Resend rejected "${subject}" (${response.status}): ${body.slice(0, 300)}`);
      return { error: response.status };
    }
    const data = await response.json();
    return { id: data.id };
  } catch (err) {
    logger.error(`[email] Failed to send "${subject}": ${err.message}`);
    return { error: err.message };
  }
}

module.exports = {
  send,
  render,
  isConfigured,
};
