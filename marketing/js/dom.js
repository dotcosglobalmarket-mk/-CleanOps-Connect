// Escape a value before interpolating it into an HTML string. Any text that
// came from a user or the API (names, service names, IDs) must go through
// this before being assigned to innerHTML.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
