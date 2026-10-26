import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';
import { formatPence, formatDate } from './dashboard-ui.js';

// A suggested range of typical local rates, from prices published on the web.
// It is a suggestion only: it is shown on request, never fills anything in
// by itself, and the person can use it, change it or ignore it.

export function fetchGuide({ serviceType, postcode, estimatedHours }) {
  const body = { serviceType, postcode };
  if (estimatedHours > 0) body.estimatedHours = Number(estimatedHours);
  return apiRequest('/pricing/guide', { method: 'POST', body, auth: true });
}

const hourly = (g) => `${formatPence(g.hourlyLowPence)}–${formatPence(g.hourlyHighPence)} per hour`;

// Renders the guide into `panel`. `audience` is 'customer' (a budget guide) or
// 'cleaner' (a price guide). `onUse(pounds | {min, max})` is called only if the
// person presses the "use" button.
export function renderGuide(panel, guide, { audience, onUse }) {
  const hasTotal = Boolean(guide.job);
  const customer = audience === 'customer';

  const headline = hasTotal
    ? `${formatPence(guide.job.lowPence)}–${formatPence(guide.job.highPence)} for ${escapeHtml(guide.job.hours)} hour${guide.job.hours === 1 ? '' : 's'}`
    : escapeHtml(hourly(guide));
  const checked = formatDate(guide.asOf);
  const sources = (guide.sources || [])
    .map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`)
    .join('');

  panel.innerHTML = `
    <p><strong>${customer ? 'Suggested budget' : 'Suggested price'}:</strong> ${headline}</p>
    ${hasTotal ? `<p class="field-help">${escapeHtml(hourly(guide))}</p>` : `<p class="field-help">Add the estimated hours to see a total.</p>`}
    <p class="field-help">
      A guide only. ${escapeHtml(guide.basis)} (${escapeHtml(guide.scope)} figures for ${escapeHtml(guide.area)}, ${escapeHtml(guide.confidence)} confidence, checked ${escapeHtml(checked)}).
      ${customer ? 'Cleaners set their own prices, so real quotes may be higher or lower.' : 'You set your own price: use this, change it or ignore it.'}
    </p>
    ${sources ? `<details><summary class="field-help">Where this comes from</summary><ul class="field-help">${sources}</ul></details>` : ''}
    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
      ${hasTotal ? `<button type="button" class="guide-use">${customer ? 'Use this range as my budget' : 'Use this price'}</button>` : ''}
      <button type="button" class="secondary guide-dismiss">No thanks</button>
    </div>`;
  panel.hidden = false;

  const use = panel.querySelector('.guide-use');
  if (use) {
    use.addEventListener('click', () => {
      const low = Math.round(guide.job.lowPence / 100);
      const high = Math.round(guide.job.highPence / 100);
      onUse(customer ? { min: low, max: high } : Math.round((low + high) / 2));
      panel.hidden = true;
    });
  }
  panel.querySelector('.guide-dismiss').addEventListener('click', () => {
    panel.hidden = true;
  });
}
