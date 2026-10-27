import { apiRequest, apiUpload, apiFetchBlob } from './api.js';
import { escapeHtml } from './dom.js';

// Optional photos on a job: the cleaner's before/after pictures and the pictures
// a customer sends with a problem report. Phone photos are shrunk in the browser
// first (the server accepts up to 5 MB of JPG or PNG). Staff see the same
// pictures, but only when they choose to open them, because each one opened is
// written to the audit log.

const MAX_SIDE = 1600;
const KIND_LABELS = { before: 'Before', after: 'After', problem: 'Problem' };

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name || 'That file'} is not a photo we can read`)); };
    img.src = url;
  });
}

// Returns a JPEG no larger than MAX_SIDE on its longest edge.
export async function prepareImage(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not prepare that photo');
  return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

// Uploads one at a time. Returns the messages for any that failed; the rest stay uploaded.
export async function uploadJobPhotos(jobId, kind, files) {
  const failed = [];
  for (const file of Array.from(files)) {
    try {
      const ready = await prepareImage(file);
      await apiUpload(`/jobs/${jobId}/photos`, ready, { kind, filename: ready.name });
    } catch (err) {
      failed.push(`${file.name || 'Photo'}: ${err.message}`);
    }
  }
  return failed;
}

const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Draws the photos of one job into `container`.
//   add:        [{ kind, label }] buttons that let this person add photos (none to just view)
//   myRole:     'cleaner' or 'customer': lets this person remove the photos they added
//   staff:      true waits for a click before opening any picture (opening is audited)
//   onChange:   called after a photo is added or removed
export async function mountJobPhotos(container, { jobId, add = [], staff = false, myRole = null, onChange = () => {} }) {
  const urls = [];
  const release = () => { urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); };

  async function render() {
    release();
    container.innerHTML = '<p class="field-help">Loading photos…</p>';
    let photos;
    try {
      photos = await apiRequest(`/jobs/${jobId}/photos`, { auth: true });
    } catch (err) {
      container.innerHTML = `<p class="field-help">${escapeHtml(err.message)}</p>`;
      return;
    }

    const adders = add
      .map(
        ({ kind, label }) => `
        <label class="photo-add">
          <span class="secondary button-like">${escapeHtml(label)}</span>
          <input type="file" accept="image/*" multiple data-kind="${escapeHtml(kind)}" />
        </label>`
      )
      .join('');
    container.innerHTML = `
      <div class="photo-grid" role="list"></div>
      ${photos.length ? '' : '<p class="field-help">No photos have been added to this job.</p>'}
      ${adders ? `<div class="photo-adders">${adders}</div><p class="field-help">Photos are optional. They are shared with the customer, the cleaner and our team, and deleted 90 days after the job is closed.</p>` : ''}
      <div class="alert alert-error" data-photo-alert hidden></div>`;

    const grid = container.querySelector('.photo-grid');
    const alertBox = container.querySelector('[data-photo-alert]');
    const fail = (message) => { alertBox.textContent = message; alertBox.hidden = false; };

    async function open(photo, figure) {
      try {
        const blob = await apiFetchBlob(`/jobs/${jobId}/photos/${photo._id}/file`);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        figure.querySelector('.photo-slot').innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(KIND_LABELS[photo.kind])} photo" loading="lazy" /></a>`;
      } catch (err) {
        figure.querySelector('.photo-slot').innerHTML = `<span class="field-help">${escapeHtml(err.message)}</span>`;
      }
    }

    photos.forEach((photo) => {
      const figure = document.createElement('figure');
      figure.className = 'job-photo';
      figure.setAttribute('role', 'listitem');
      const mine = !staff && myRole && photo.uploaderRole === myRole;
      figure.innerHTML = `
        <div class="photo-slot">${staff ? '<button type="button" class="secondary photo-open">Open photo</button>' : '<span class="field-help">Loading…</span>'}</div>
        <figcaption>${escapeHtml(KIND_LABELS[photo.kind])} · ${photo.uploaderRole === 'cleaner' ? 'Cleaner' : 'Customer'} · ${escapeHtml(when(photo.uploadedAt))}
          ${mine ? '<button type="button" class="secondary photo-remove">Remove</button>' : ''}</figcaption>`;
      grid.appendChild(figure);
      if (staff) figure.querySelector('.photo-open').addEventListener('click', () => open(photo, figure));
      else open(photo, figure);
      const remove = figure.querySelector('.photo-remove');
      if (remove) {
        remove.addEventListener('click', async () => {
          if (!window.confirm('Remove this photo?')) return;
          try {
            await apiRequest(`/jobs/${jobId}/photos/${photo._id}`, { method: 'DELETE', auth: true });
            await render();
            onChange();
          } catch (err) {
            fail(err.message);
          }
        });
      }
    });

    container.querySelectorAll('input[type="file"]').forEach((input) => {
      input.addEventListener('change', async () => {
        if (!input.files.length) return;
        alertBox.hidden = true;
        input.disabled = true;
        const failed = await uploadJobPhotos(jobId, input.dataset.kind, input.files);
        await render();
        onChange();
        if (failed.length) {
          const box = container.querySelector('[data-photo-alert]');
          box.textContent = failed.join(' · ');
          box.hidden = false;
        }
      });
    });
  }

  await render();
  return { refresh: render, destroy: release };
}
