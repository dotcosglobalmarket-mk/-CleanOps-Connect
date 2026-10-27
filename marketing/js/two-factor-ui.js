import { apiRequest, setSession } from './api.js';
import { escapeHtml } from './dom.js';

// Everything that can follow a correct password: signed in at once, or a
// second step (a code from the authenticator app) first, or, for an admin who
// has never set it up, the set-up screen.

const DASHBOARDS = { admin: 'admin.html', operator: 'ops.html', cleaner: 'cleaner.html' };
const dashboardFor = (role) => DASHBOARDS[role] || 'customer.html';

function signIn(result) {
  setSession(result.token, result.user);
  window.location.href = dashboardFor(result.user.role);
}

function errorBox(mount) {
  const box = mount.querySelector('.alert');
  return {
    show(message) {
      box.textContent = message;
      box.hidden = false;
    },
    hide() {
      box.hidden = true;
    },
  };
}

function askForCode(mount, { challengeToken }) {
  mount.innerHTML = `
    <h2>Two-step login</h2>
    <p>Open your authenticator app and enter the 6-digit code for CleanOps Connect.</p>
    <div class="alert alert-error" hidden></div>
    <form id="two-factor-form">
      <div class="form-row">
        <label for="two-factor-code">Code</label>
        <input id="two-factor-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required />
      </div>
      <button type="submit">Continue</button>
    </form>
    <p class="field-help" style="margin-top:1rem">Lost your phone? Enter one of your recovery codes instead.</p>`;
  const alertBox = errorBox(mount);
  const input = mount.querySelector('#two-factor-code');
  input.focus();
  mount.querySelector('#two-factor-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hide();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await apiRequest('/auth/2fa/verify', { method: 'POST', body: { challengeToken, code: input.value } });
      if (result.recoveryUsed) {
        window.alert(`You used a recovery code. You have ${result.recoveryCodesLeft} left. Ask another admin to reset your two-step login if you need a new set.`);
      }
      signIn(result);
    } catch (err) {
      alertBox.show(err.message);
      button.disabled = false;
    }
  });
}

function showRecoveryCodes(mount, result) {
  mount.innerHTML = `
    <h2>Save your recovery codes</h2>
    <p>If you lose your phone, each of these codes lets you in once. They are shown <strong>only now</strong>. Keep them somewhere safe, apart from your phone.</p>
    <pre id="recovery-codes" style="font-size:1.05rem;line-height:1.8">${result.recoveryCodes.map(escapeHtml).join('\n')}</pre>
    <p>
      <button type="button" class="secondary" id="copy-codes">Copy</button>
      <button type="button" class="secondary" id="download-codes">Download</button>
    </p>
    <label style="display:block;margin:1rem 0"><input type="checkbox" id="codes-saved" /> I have saved these codes</label>
    <button type="button" id="finish-setup" disabled>Continue to my dashboard</button>`;
  const text = result.recoveryCodes.join('\n');
  mount.querySelector('#copy-codes').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(text));
  mount.querySelector('#download-codes').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`CleanOps Connect recovery codes\n\n${text}\n`], { type: 'text/plain' }));
    link.download = 'cleanops-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  const finish = mount.querySelector('#finish-setup');
  mount.querySelector('#codes-saved').addEventListener('change', (e) => {
    finish.disabled = !e.target.checked;
  });
  finish.addEventListener('click', () => signIn(result));
}

async function setUp(mount, { setupToken }) {
  mount.innerHTML = '<p>Setting up…</p>';
  let setup;
  try {
    setup = await apiRequest('/auth/2fa/setup', { method: 'POST', body: { setupToken } });
  } catch (err) {
    mount.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    return;
  }
  const grouped = setup.secret.match(/.{1,4}/g).join(' ');
  mount.innerHTML = `
    <h2>Set up two-step login</h2>
    <p>Admin accounts need a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and others) as well as the password.</p>
    <ol>
      <li>In your app, add an account and choose <em>enter a setup key</em>. On a phone you can also <a href="${escapeHtml(setup.otpauthUri)}">open it in your app</a>.</li>
      <li>Key: <code style="font-size:1rem;user-select:all">${escapeHtml(grouped)}</code> (time-based)</li>
      <li>Enter the 6-digit code the app shows.</li>
    </ol>
    <div class="alert alert-error" hidden></div>
    <form id="two-factor-enable-form">
      <div class="form-row">
        <label for="two-factor-code">Code</label>
        <input id="two-factor-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required />
      </div>
      <button type="submit">Turn on</button>
    </form>`;
  const alertBox = errorBox(mount);
  mount.querySelector('#two-factor-enable-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hide();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await apiRequest('/auth/2fa/enable', {
        method: 'POST',
        body: { setupToken, code: mount.querySelector('#two-factor-code').value },
      });
      showRecoveryCodes(mount, result);
    } catch (err) {
      alertBox.show(err.message);
      button.disabled = false;
    }
  });
}

// `form` is the password (or new-password) form, hidden while a later step shows in `mount`.
export function continueAfterPassword(result, { form, mount }) {
  if (result.token) return signIn(result);
  form.hidden = true;
  document.querySelectorAll('[data-hide-on-step]').forEach((el) => { el.hidden = true; });
  mount.hidden = false;
  if (result.twoFactorRequired) return askForCode(mount, result);
  if (result.twoFactorSetupRequired) return setUp(mount, result);
  mount.innerHTML = '<div class="alert alert-error">Something went wrong. Please log in again.</div>';
  return undefined;
}
