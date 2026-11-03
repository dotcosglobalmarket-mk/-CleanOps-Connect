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

function addInstallButton() {
  if (!installEvent || document.getElementById('install-app')) return;
  const links = document.querySelector('.nav-links');
  if (!links) return;
  const button = document.createElement('a');
  button.href = '#';
  button.id = 'install-app';
  button.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Install app';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    const prompt = installEvent;
    installEvent = null;
    button.remove();
    await prompt.prompt();
  });
  links.appendChild(button);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  addInstallButton();
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  document.getElementById('install-app')?.remove();
});

// The nav is drawn on DOMContentLoaded; try again once it exists.
document.addEventListener('DOMContentLoaded', () => setTimeout(addInstallButton, 0));
