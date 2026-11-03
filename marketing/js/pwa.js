// Registers the service worker (so the site can be installed as an app) and
// offers an "Install app" button where the browser supports it. iPhones have
// no install prompt: people use Share > Add to Home Screen instead.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the site works the same without it.
    });
  });
}

let installEvent = null;

// Every nav on the page gets the button (the landing page has a hero nav and a
// sticky nav, each with a desktop list and a phone list; only one is visible
// at a time). Phones show the icon alone so the row still fits.
function makeInstallButton() {
  const button = document.createElement('a');
  button.href = '#';
  button.className = 'install-app';
  button.setAttribute('aria-label', 'Install app');
  button.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<span class="install-label">Install app</span>';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    const prompt = installEvent;
    if (!prompt) return;
    installEvent = null;
    removeInstallButtons();
    await prompt.prompt();
  });
  return button;
}

function removeInstallButtons() {
  document.documentElement.classList.remove('can-install');
  document.querySelectorAll('.install-app').forEach((el) => {
    // A list item we wrapped it in goes too.
    if (el.parentElement && el.parentElement.dataset.installItem) el.parentElement.remove();
    else el.remove();
  });
}

function addInstallButton() {
  if (!installEvent) return;
  document.documentElement.classList.add('can-install');
  document.querySelectorAll('.nav-links').forEach((links) => {
    if (links.querySelector('.install-app')) return;
    const button = makeInstallButton();
    if (links.tagName === 'UL') {
      const item = document.createElement('li');
      item.dataset.installItem = '1';
      item.appendChild(button);
      links.appendChild(item);
    } else {
      links.appendChild(button);
    }
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  addInstallButton();
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  removeInstallButtons();
});

// The nav is drawn on DOMContentLoaded; try again once it exists.
document.addEventListener('DOMContentLoaded', () => setTimeout(addInstallButton, 0));
