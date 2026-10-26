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

// The AI helpers may end a suggestion with a "Worth adding: ..." tip for the
// writer. It is shown beside the suggestion but never inserted into the form.
export function splitSuggestion(text) {
  const match = text.match(/\n*\s*Worth adding:/i);
  if (!match) return { text: text.trim(), tip: '' };
  return { text: text.slice(0, match.index).trim(), tip: text.slice(match.index).trim() };
}
