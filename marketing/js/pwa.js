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
  button.textContent = 'Install app';
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
