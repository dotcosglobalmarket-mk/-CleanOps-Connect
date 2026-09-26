import { apiRequest } from './api.js';
import { escapeHtml } from './dom.js';

// Landing page: the most recent published reviews, whatever their rating,
// plus the overall average. Every review comes from a completed booking.
async function loadLatestReviews() {
  try {
    const { averageRating, count, reviews } = await apiRequest('/reviews/latest?limit=3');
    if (!count || !reviews.length) return;

    document.getElementById('reviews-summary').textContent =
      `Rated ${averageRating.toFixed(1)} out of 5 from ${count} review${count === 1 ? '' : 's'} of completed bookings.`;
    document.getElementById('reviews-list').innerHTML = reviews
      .map((r) => {
        const initials = r.reviewer
          .split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2);
        return `
        <div class="lp-testimonial">
          <div class="lp-testimonial-head">
            <div class="lp-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
            <div>
              <div class="lp-testimonial-name">${escapeHtml(r.reviewer)}</div>
              <div class="lp-testimonial-rating" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
            </div>
          </div>
          <p class="lp-quote">“${escapeHtml(r.comment)}”</p>
          <p class="field-help">${r.cleaner ? `Cleaner: ${escapeHtml(r.cleaner.name)} · ` : ''}${new Date(r.createdAt).toLocaleDateString('en-GB')}</p>
        </div>`;
      })
      .join('');
    document.getElementById('reviews').hidden = false;
  } catch (err) {
    // No reviews section if the API is unavailable.
  }
}

loadLatestReviews();
