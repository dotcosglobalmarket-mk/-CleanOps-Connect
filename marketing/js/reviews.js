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
        <div class="testimonial-card">
          <div class="testimonial-stars" role="img" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
          <p class="testimonial-text">“${escapeHtml(r.comment)}”</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
            <div>
              <div class="testimonial-name">${escapeHtml(r.reviewer)}</div>
              <div class="testimonial-loc">${r.cleaner ? `Cleaner: ${escapeHtml(r.cleaner.name)} · ` : ''}${new Date(r.createdAt).toLocaleDateString('en-GB')}</div>
            </div>
          </div>
        </div>`;
      })
      .join('');
    document.getElementById('reviews').hidden = false;
  } catch (err) {
    // No reviews section if the API is unavailable.
  }
}

loadLatestReviews();
