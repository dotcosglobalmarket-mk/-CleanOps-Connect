import { apiFetchBlob } from './api.js';
import { escapeHtml } from './dom.js';

// A cleaner's optional profile picture or company logo. Where there is none, the
// circle shows their initials. Pictures are fetched with the login token (the
// server only shows them to the people allowed to see them) and cached by
// cleaner and upload time, so a new upload shows straight away.

const SIZE = 400;
const cache = new Map();

export function initials(name) {
  const words = String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// `updatedAt` present means the cleaner has a picture to fetch.
export function avatarHtml({ id, name, updatedAt, size = 'md' }) {
  const photo = id && updatedAt ? ` data-cleaner="${escapeHtml(id)}" data-v="${escapeHtml(updatedAt)}"` : '';
  return `<span class="avatar avatar-${size}"${photo} aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function pictureUrl(id, version) {
  const key = `${id}:${version}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      apiFetchBlob(`/cleaners/${id}/photo`)
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => null)
    );
  }
  return cache.get(key);
}

export async function hydrateAvatars(root = document) {
  const targets = Array.from(root.querySelectorAll('.avatar[data-v]'));
  await Promise.all(
    targets.map(async (el) => {
      const url = await pictureUrl(el.dataset.cleaner, el.dataset.v);
      if (url) el.innerHTML = `<img src="${url}" alt="" />`;
    })
  );
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture we can read')); };
    img.src = url;
  });
}

// Crops to a centred square, 400px, on white (so a logo with a see-through
// background does not turn black), and returns a JPEG file well under 1 MB.
export async function prepareAvatar(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Could not prepare that picture');
  return new File([blob], 'profile.jpg', { type: 'image/jpeg' });
}
