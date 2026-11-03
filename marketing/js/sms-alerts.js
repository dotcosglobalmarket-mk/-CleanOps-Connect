import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';

// "Text message alerts" card, used on the customer and cleaner dashboards. Off by default;
// the person gives a UK mobile number and ticks the exact wording shown, and can turn it off
// again at any time (which deletes the number). Until text sending is set up on the server the
// form is not shown, so no number is collected for nothing.

const TITLE = '<h2>Text message alerts</h2>';

function shell(inner) {
  return `<div class="card">${TITLE}${inner}</div>`;
}

function render(root, settings) {
  if (!settings.configured) {
    root.innerHTML = shell('<p class="field-help">Text alerts are not available yet. You will still get an email for everything that needs your attention.</p>');
    return;
  }

  const on = settings.enabled;
  root.innerHTML = shell(`
    <p class="field-help">
      Get a short text when something needs your attention, such as a new job offer or a payment step. It is never
      advertising and never says anything about the job itself: it only tells you to open your dashboard.
    </p>
    <div class="alert alert-error" data-sms="alert" hidden></div>
    <div class="alert alert-success" data-sms="success" hidden></div>
    <p data-sms="status">${on ? `Text alerts are <strong>on</strong> for ${escapeHtml(settings.mobile)}.` : 'Text alerts are <strong>off</strong>.'}</p>
    <form data-sms="form" novalidate>
      <div class="form-row">
        <label for="sms-mobile">UK mobile number</label>
        <input id="sms-mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="07123 456789" value="${escapeHtml(on ? settings.mobile : '')}" />
      </div>
      <label class="check-row">
        <input id="sms-consent" type="checkbox" />
        <span>${escapeHtml(settings.consent.text)}</span>
      </label>
      <div class="cta-row">
        <button type="submit">${on ? 'Save number' : 'Turn on text alerts'}</button>
        <button type="button" class="secondary" data-sms="off" ${on ? '' : 'hidden'}>Turn off and delete my number</button>
      </div>
    </form>`);

  const q = (name) => root.querySelector(`[data-sms="${name}"]`);
  const alertBox = q('alert');
  const successBox = q('success');
  const say = (box, text) => {
    alertBox.hidden = true;
    successBox.hidden = true;
    box.textContent = text;
    box.hidden = false;
  };

  q('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    successBox.hidden = true;
    const button = event.submitter || q('form').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const updated = await apiRequest('/sms-alerts/me', {
        method: 'PUT',
        auth: true,
        body: {
          mobile: root.querySelector('#sms-mobile').value,
          consent: root.querySelector('#sms-consent').checked,
          consentVersion: settings.consent.version,
        },
      });
      render(root, updated);
      say(root.querySelector('[data-sms="success"]'), 'Text alerts are on.');
    } catch (err) {
      say(alertBox, err.message);
      button.disabled = false;
    }
  });

  q('off').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const updated = await apiRequest('/sms-alerts/me', { method: 'DELETE', auth: true });
      render(root, updated);
      say(root.querySelector('[data-sms="success"]'), 'Text alerts are off and your number has been deleted.');
    } catch (err) {
      say(alertBox, err.message);
      event.currentTarget.disabled = false;
    }
  });
}

export async function mountSmsAlerts(root) {
  root.innerHTML = shell('<p class="field-help">Loading…</p>');
  try {
    render(root, await apiRequest('/sms-alerts/me', { auth: true }));
  } catch (err) {
    root.innerHTML = shell(`<div class="alert alert-error">${escapeHtml(err.message)}</div>`);
  }
}
