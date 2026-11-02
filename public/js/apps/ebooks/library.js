// The eBook Reader's library: one, shared by everyone. "Mine" is each person's own list of the
// books they like and want close at hand (a book's `mine`); books you add go on it.

export const baseOf = () => '';
// Where a new book goes: a folder of the library.
export const uploadUrl = (dest, name) => `/portal/ebooks/upload?${new URLSearchParams({ name, folder: String(dest || '').replace(/^mine:/, '') })}`;

export async function loadLibrary(api, refresh = false) {
  const lib = await api(`library${refresh ? '?refresh=1' : ''}`);
  const mine = new Set(lib.mine || []);
  return { ...lib, books: (lib.books || []).map((b) => ({ ...b, mine: mine.has(b.id) })) };
}

// Add a book to Mine, or take it off; returns the new list.
export async function setMine(api, lib, book, on) {
  const r = await api('mine', { method: 'POST', body: JSON.stringify({ id: book.id, on }) });
  lib.mine = r.mine;
  for (const b of lib.books) b.mine = r.mine.includes(b.id);
  return r.mine;
}

// The places a book can be added to, as [value, label] for a <select>.
export function destinations(lib) {
  return ['', ...(lib?.folders || [])].map((f) => [f, f ? `in ${f}` : 'in the books folder']);
}
