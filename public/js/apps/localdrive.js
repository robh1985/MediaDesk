// USB drives (and other folders) on the computer you're using, in Files. The browser's File System
// Access API lets a page open a drive or folder you choose, read it and (if you allow it) change
// it: Chrome, Edge, Opera and Brave on Windows, macOS, Linux and ChromeOS, on a secure page
// (https:// or localhost). The drives you connect are remembered in this browser; the next time,
// the browser asks once more before MediaDesk can use one. Other browsers (Firefox, Safari) can
// only hand over a folder's files to read, so a drive opened that way is read-only.

export const canConnect = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
export const canPickFolder = () => 'webkitdirectory' in document.createElement('input');

// ---- Remembered drives (IndexedDB, in this browser) ----
const DB = 'mediadesk-drives';
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drives', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('drives', mode);
    const req = fn(tx.objectStore('drives'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
// The drives connected before, as roots for Files.
export async function savedDrives() {
  try { return ((await store('readonly', (s) => s.getAll())) || []).map((d) => ({ id: d.id, name: d.name, handle: d.handle, local: true, readOnly: false })); } catch { return []; }
}
export async function forgetDrive(id) { try { await store('readwrite', (s) => s.delete(id)); } catch { /* fine */ } }

// Choose a drive or folder (needs a click). Resolves with a root, or null when cancelled.
export async function connectDrive() {
  let handle;
  try { handle = await window.showDirectoryPicker({ id: 'mediadesk-drive', mode: 'readwrite' }); } catch (err) { if (err.name === 'AbortError') return null; throw friendly(err); }
  // The same drive again: the one already remembered.
  for (const d of await savedDrives()) { try { if (await d.handle.isSameEntry(handle)) return { ...d, handle }; } catch { /* different */ } }
  const id = `L${Date.now().toString(36)}`;
  const name = handle.name || 'Drive';
  try { await store('readwrite', (s) => s.put({ id, name, handle, added: Date.now() })); } catch { /* not remembered, still usable */ }
  return { id, name, handle, local: true, readOnly: false };
}

// Read-only, from a folder's files (browsers without the File System Access API).
export function pickFolderReadOnly() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', webkitdirectory: true, multiple: true, style: 'display:none' });
    input.onchange = () => {
      const files = [...input.files];
      input.remove();
      if (!files.length) return resolve(null);
      const tree = { dirs: new Map(), files: new Map() };
      const top = files[0].webkitRelativePath.split('/')[0] || 'Folder';
      for (const f of files) {
        const parts = f.webkitRelativePath.split('/').slice(1);
        let node = tree;
        for (const p of parts.slice(0, -1)) { if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: new Map() }); node = node.dirs.get(p); }
        node.files.set(parts.at(-1), f);
      }
      resolve({ id: `R${Date.now().toString(36)}`, name: top, tree, local: true, readOnly: true });
    };
    document.body.append(input);
    input.click();
  });
}

function friendly(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return Object.assign(new Error('The browser didn’t allow access to that drive. Choose it again, and allow MediaDesk to view and edit its files.'), { status: 403 });
  if (err?.name === 'NotFoundError') return Object.assign(new Error('It isn’t there any more (was the drive unplugged?)'), { status: 404 });
  if (err?.name === 'InvalidModificationError') return Object.assign(new Error('That folder isn’t empty'), { status: 409 });
  if (err?.name === 'TypeMismatchError') return Object.assign(new Error('Something with that name is already there'), { status: 409 });
  if (err?.name === 'QuotaExceededError') return Object.assign(new Error('The drive is full'), { status: 507 });
  if (err?.name === 'NoModificationAllowedError') return Object.assign(new Error('The drive is read-only, or the file is in use'), { status: 403 });
  return err;
}

// Whether MediaDesk may use a remembered drive now ('granted'), after asking ('prompt': needs a
// click), or not at all.
export async function permission(root, ask = false) {
  if (!root.handle) return 'granted';
  const opts = { mode: 'readwrite' };
  try {
    let p = await root.handle.queryPermission(opts);
    if (p !== 'granted' && ask) p = await root.handle.requestPermission(opts);
    return p;
  } catch { return 'denied'; }
}

const parts = (path) => String(path || '').split('/').filter(Boolean);

// A folder on the drive (made when create is set).
async function dirAt(root, path, create = false) {
  if (root.tree) {
    let node = root.tree;
    for (const p of parts(path)) { node = node.dirs.get(p); if (!node) throw friendly(Object.assign(new Error(), { name: 'NotFoundError' })); }
    return node;
  }
  let d = root.handle;
  try { for (const p of parts(path)) d = await d.getDirectoryHandle(p, { create }); } catch (err) { throw friendly(err); }
  return d;
}
const split = (path) => { const ps = parts(path); return [ps.slice(0, -1).join('/'), ps.at(-1)]; };

export async function list(root, path, showHidden = false) {
  const d = await dirAt(root, path);
  const entries = [];
  if (root.tree) {
    for (const name of d.dirs.keys()) entries.push({ name, dir: true, size: null, modified: null });
    for (const [name, f] of d.files) entries.push({ name, dir: false, size: f.size, modified: f.lastModified });
  } else {
    try {
      for await (const [name, h] of d.entries()) {
        if (h.kind === 'directory') entries.push({ name, dir: true, size: null, modified: null });
        else {
          try { const f = await h.getFile(); entries.push({ name, dir: false, size: f.size, modified: f.lastModified }); } catch { entries.push({ name, dir: false, size: null, modified: null, error: true }); }
        }
      }
    } catch (err) { throw friendly(err); }
  }
  return entries.filter((e) => showHidden || !e.name.startsWith('.'));
}

export async function getFile(root, path) {
  const [dir, name] = split(path);
  const d = await dirAt(root, dir);
  if (root.tree) { const f = d.files.get(name); if (!f) throw friendly(Object.assign(new Error(), { name: 'NotFoundError' })); return f; }
  try { return await (await d.getFileHandle(name)).getFile(); } catch (err) { throw friendly(err); }
}
export async function isDir(root, path) {
  const [dir, name] = split(path);
  const d = await dirAt(root, dir);
  if (root.tree) return d.dirs.has(name);
  try { await d.getDirectoryHandle(name); return true; } catch { return false; }
}

const writable = (root) => { if (root.readOnly) throw Object.assign(new Error('This folder was opened read-only (this browser can’t change files on your computer). Use Chrome or Edge to copy onto a USB drive.'), { status: 403 }); };

export async function mkdir(root, path, name) {
  writable(root);
  const d = await dirAt(root, path);
  try { await d.getDirectoryHandle(name); throw Object.assign(new Error('Something with that name already exists'), { status: 409 }); } catch (err) { if (err.status) throw err; }
  try { await d.getDirectoryHandle(name, { create: true }); } catch (err) { throw friendly(err); }
}
export async function remove(root, paths) {
  writable(root);
  for (const p of paths) {
    const [dir, name] = split(p);
    try { await (await dirAt(root, dir)).removeEntry(name, { recursive: true }); } catch (err) { throw friendly(err); }
  }
}

// Write a file (a File, Blob or a Response's body) into a folder, reporting bytes written.
export async function writeFile(root, dirPath, name, source, { size = source?.size || 0, onProgress, overwrite = true } = {}) {
  writable(root);
  const d = await dirAt(root, dirPath, true);
  if (!overwrite) { try { await d.getFileHandle(name); throw Object.assign(new Error(`“${name}” is already there`), { status: 409 }); } catch (err) { if (err.status) throw err; } }
  let fh, w;
  try { fh = await d.getFileHandle(name, { create: true }); w = await fh.createWritable(); } catch (err) { throw friendly(err); }
  try {
    const stream = source instanceof Response ? source.body : source.stream();
    const reader = stream.getReader();
    let done = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      await w.write(value);
      done += value.byteLength;
      onProgress?.(done, size);
    }
    await w.close();
  } catch (err) {
    try { await w.abort(); } catch { /* gone */ }
    try { await d.removeEntry(name); } catch { /* fine */ }
    throw friendly(err);
  }
}

// Rename: files and folders the browser can move (Chrome 110+), otherwise copied and the old one
// removed.
export async function rename(root, path, newName) {
  writable(root);
  const [dir, name] = split(path);
  const d = await dirAt(root, dir);
  for (const probe of [() => d.getFileHandle(newName), () => d.getDirectoryHandle(newName)]) {
    try { await probe(); throw Object.assign(new Error('Something with that name already exists'), { status: 409 }); } catch (err) { if (err.status) throw err; }
  }
  let h;
  try { h = await d.getFileHandle(name); } catch { h = await d.getDirectoryHandle(name).catch((err) => { throw friendly(err); }); }
  if (typeof h.move === 'function') { try { await h.move(newName); return; } catch { /* copy instead */ } }
  await copyWithin(root, path, root, dir, newName);
  await d.removeEntry(name, { recursive: true });
}

// Copy a file or folder from one drive (or place) to another folder, as newName (or its own name).
export async function copyWithin(src, path, dest, destDir, newName, onFile) {
  const [, name] = split(path);
  const target = newName || name;
  if (await isDir(src, path)) {
    await (await dirAt(dest, destDir)).getDirectoryHandle(target, { create: true });
    for (const e of await list(src, path, true)) await copyWithin(src, `${path}/${e.name}`, dest, `${destDir ? `${destDir}/` : ''}${target}`, null, onFile);
  } else {
    const f = await getFile(src, path);
    onFile?.(f);
    await writeFile(dest, destDir, target, f);
  }
}

// Every file under a path on the drive: [{ file, rel }] (rel: the folders inside, "a/b").
export async function walk(root, path) {
  const out = [];
  const go = async (p, rel) => {
    if (!(await isDir(root, p))) { out.push({ file: await getFile(root, p), rel }); return; }
    const [, name] = split(p);
    const here = rel ? `${rel}/${name}` : name;
    out.push({ dir: here });
    for (const e of await list(root, p, true)) await go(`${p}/${e.name}`, here);
  };
  await go(path, '');
  return out;
}
