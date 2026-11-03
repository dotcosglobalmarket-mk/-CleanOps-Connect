const logger = require('../utils/logger');

// Text messages through Twilio. Without TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a
// sender (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM) nothing is sent: the message is only
// logged, as with email in development. Never throws: a text that fails must not undo a
// booking or a payment.
const TWILIO_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

function isConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM)
  );
}

// Turns what a person types ("07123 456789", "+44 7123 456789", "0044 (0)7123...") into
// +447123456789, or null when it is not a UK mobile number. 070 (personal numbers) and 076
// (pagers) are not mobiles that can receive texts.
function normaliseUkMobile(input) {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+44')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0044')) digits = `0${digits.slice(4)}`;
  if (digits.startsWith('00') && !digits.startsWith('0044')) digits = digits.slice(1); // "+44 (0)7..." typed as 0 + 07...
  if (!/^07[1-57-9]\d{8}$/.test(digits)) return null;
  return `+44${digits.slice(1)}`;
}

// For logs and screens: the number is personal data.
function mask(number) {
  const s = String(number || '');
  return s.length > 4 ? `${s.slice(0, 3)}${'•'.repeat(s.length - 6)}${s.slice(-3)}` : '•••';
}

async function send({ to, body }) {
  if (!to || !body) return { skipped: 'nothing to send' };

  if (!isConfigured()) {
    logger.info(`[sms] (not sent: Twilio is not set up) to=${mask(to)} text="${body}"`);
    return { skipped: 'not configured' };
  }

  const params = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set('From', process.env.TWILIO_FROM);

  try {
    const response = await fetch(`${TWILIO_BASE}/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.error(`[sms] Twilio rejected a text to ${mask(to)} (${response.status}): ${text.slice(0, 300)}`);
      return { error: response.status };
    }
    const data = await response.json();
    return { id: data.sid };
  } catch (err) {
    logger.error(`[sms] Failed to send a text to ${mask(to)}: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { send, isConfigured, normaliseUkMobile, mask };
