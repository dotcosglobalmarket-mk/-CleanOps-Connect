import { API_BASE_URL } from './config.js';
import { getToken } from './api.js';

// Opens a printable job document (service record, compliance pack) in a new
// tab. The API needs the Authorization header, so the page is fetched and
// shown from a temporary local address. The tab is opened straight away so a
// pop-up blocker allows it.
export async function openDocument(jobId, kind) {
  const tab = window.open('', '_blank');
  try {
    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/documents/${kind}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Could not open the document (status ${response.status})`);
    }
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}
