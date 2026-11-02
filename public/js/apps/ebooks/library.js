// The eBook Reader's libraries. With user accounts there are two: the shared one (the books
// folder) and each person's own ("Mine", at /portal/ebooks/mine/…). A book's `mine` says which.

import { state as appState } from '../../api.js';

export const baseOf = (b) => (b?.mine ? 'mine/' : '');
// Where a new book goes: "folder" in the shared library, or "mine:folder" in your own.
export const uploadUrl = (dest, name) => { const mine = String(dest || '').startsWith('mine:'); return `/portal/ebooks/${mine ? 'mine/' : ''}upload?${new URLSearchParams({ name, folder: mine ? dest.slice(5) : dest || '' })}`; };

// Both libraries as one list. Admins and standard users can add to the shared library; people
// with a custom role only to their own.
export async function loadLibrary(api, refresh = false) {
  const q = refresh ? '?refresh=1' : '';
  const [shared, mine] = await Promise.all([api(`library${q}`), appState.config?.ebooks?.personal ? api(`mine/library${q}`).catch(() => null) : null]);
  if (!mine?.configured) return shared;
  const sharedWritable = Boolean(shared.configured && shared.writable && appState.me?.role !== 'custom');
  return {
    ...shared, configured: true, personal: true, sharedConfigured: shared.configured, sharedWritable, writable: true,
    books: [...shared.books, ...mine.books.map((b) => ({ ...b, mine: true }))],
    reading: { ...(shared.reading || {}), ...(mine.reading || {}) }, mineFolders: mine.folders || [],
    tools: shared.tools || mine.tools, sendToKindle: shared.sendToKindle ?? mine.sendToKindle,
  };
}

// The places a book can be added to, as [value, label] for a <select>.
export function destinations(lib) {
  if (!lib?.personal) return ['', ...(lib?.folders || [])].map((f) => [f, f ? `in ${f}` : 'in the books folder']);
  const out = [];
  if (lib.sharedWritable) out.push(['', 'Shared library'], ...(lib.folders || []).map((f) => [f, `Shared › ${f}`]));
  out.push(['mine:', 'My library'], ...(lib.mineFolders || []).map((f) => [`mine:${f}`, `Mine › ${f}`]));
  return out;
}
