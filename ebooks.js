// The eBook Reader's library: EPUB, PDF and comic book (CBZ) files in one folder on this server
// (and its subfolders), with each book's title, author and cover, and where each reader is up to
// (page, bookmarks) kept on the server so a book opens where it was left on any device.
//
// Titles, authors and covers come from inside EPUB and CBZ files (they're zip files, read here
// with a small zip reader); a PDF's cover is drawn by the browser the first time it's shown and
// sent back to be kept.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const FORMATS = { epub: 'epub', pdf: 'pdf', cbz: 'cbz' };
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };
const MAX_META_FILE = 400 * 1024 * 1024; // bigger books are listed without reading inside them
const MAX_COVER = 4 * 1024 * 1024;

class BookError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// --- A small zip reader (central directory; stored and deflated entries) ---------------------

function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new BookError(422, 'This isn’t a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, { name, method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function zipRead(buf, entry, limit = 50 * 1024 * 1024) {
  if (!entry) return null;
  const lp = entry.local;
  if (buf.readUInt32LE(lp) !== 0x04034b50) throw new BookError(422, 'Damaged zip entry');
  const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: limit });
  throw new BookError(422, 'Unsupported zip compression');
}

const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
}).replace(/<[^>]+>/g, '').trim();
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(2).find((x) => x != null) ?? null;
const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Title, author and cover from an EPUB.
function epubMeta(buf) {
  const zip = zipEntries(buf);
  const container = zipRead(buf, zip.get('META-INF/container.xml'))?.toString('utf8') || '';
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] || '', 'full-path');
  const opf = opfPath ? zipRead(buf, zip.get(opfPath))?.toString('utf8') || '' : '';
  const base = opfPath && opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = decode(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]);
  const authors = [...opf.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi)].map((m) => decode(m[1])).filter(Boolean);
  const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map((m) => ({ id: attr(m[0], 'id'), href: attr(m[0], 'href'), type: attr(m[0], 'media-type') || '', props: attr(m[0], 'properties') || '' }));
  const coverId = attr([...opf.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'name') === 'cover') || '', 'content');
  let cover = items.find((i) => /cover-image/.test(i.props)) || items.find((i) => coverId && i.id === coverId && i.type.startsWith('image/'))
    || items.find((i) => i.type.startsWith('image/') && /cover/i.test(`${i.id} ${i.href}`));
  let coverData = null;
  let coverExt = null;
  if (cover?.href) {
    const href = decodeURIComponent(cover.href);
    const entry = zip.get(path.posix.normalize(base + href)) || zip.get(href);
    coverData = zipRead(buf, entry, MAX_COVER * 4);
    coverExt = (href.split('.').pop() || '').toLowerCase();
  }
  return { title, author: authors.join(', '), coverData, coverExt };
}

// A comic book: its first picture is the cover.
function cbzMeta(buf) {
  const zip = zipEntries(buf);
  const pics = [...zip.keys()].filter((n) => IMAGE_TYPES[n.split('.').pop().toLowerCase()] && !/(^|\/)(__MACOSX|\.)/.test(n)).sort(naturalSort);
  return { title: '', author: '', pages: pics.length, coverData: pics.length ? zipRead(buf, zip.get(pics[0]), MAX_COVER * 4) : null, coverExt: pics[0]?.split('.').pop().toLowerCase() };
}

// "The_Hobbit - J.R.R. Tolkien" → title and author guessed from a file name.
function fromFileName(file) {
  const stem = path.basename(file).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const m = /^(.+?)\s+-\s+(.+)$/.exec(stem);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: stem, author: '' };
}

function createEbooks({ dataDir, getFolder, mock = false, sample = null }) {
  const stateFile = path.join(dataDir, 'ebooks.json');
  const coverDir = path.join(dataDir, 'ebook-covers');
  let state = null;
  let writing = Promise.resolve();
  let cache = { at: 0, folder: null, books: [] };

  const folder = () => (sample ? sample.dir : getFolder());

  function load() {
    if (state) return state;
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = null; }
    if (!state || typeof state !== 'object') state = {};
    state.books ||= {};
    state.meta ||= {};
    return state;
  }
  function save() {
    const snapshot = JSON.stringify(state);
    writing = writing.then(async () => {
      await fsp.mkdir(path.dirname(stateFile), { recursive: true });
      await fsp.writeFile(`${stateFile}.tmp`, snapshot);
      await fsp.rename(`${stateFile}.tmp`, stateFile);
    }).catch((err) => console.error(`eBook Reader: could not save (${err.message})`));
    return writing;
  }

  const idFor = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);

  async function walk(root, rel = '', depth = 0, out = []) {
    if (depth > 8 || out.length > 20000) return out;
    let entries;
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(root, r, depth + 1, out);
      else if (e.isFile() && FORMATS[e.name.split('.').pop().toLowerCase()]) out.push(r);
    }
    return out;
  }

  // Title, author and cover, read once per version of each file.
  async function metaFor(abs, id, format, st) {
    const stamp = `${st.size}:${Math.floor(st.mtimeMs)}`;
    const s = load();
    if (s.meta[id]?.stamp === stamp) return s.meta[id];
    let meta = { stamp, title: '', author: '', cover: null };
    if ((format === 'epub' || format === 'cbz') && st.size <= MAX_META_FILE) {
      try {
        const buf = await fsp.readFile(abs);
        const m = format === 'epub' ? epubMeta(buf) : cbzMeta(buf);
        meta = { ...meta, title: m.title, author: m.author, pages: m.pages };
        if (m.coverData?.length && IMAGE_TYPES[m.coverExt]) {
          await fsp.mkdir(coverDir, { recursive: true });
          const name = `${id}.${m.coverExt}`;
          await fsp.writeFile(path.join(coverDir, name), m.coverData);
          meta.cover = name;
        }
      } catch (err) { meta.error = err.message; }
    }
    // A PDF's cover drawn earlier by a browser stays while the file is unchanged.
    if (format === 'pdf' && s.meta[id]?.cover && s.meta[id].stamp === stamp) meta.cover = s.meta[id].cover;
    s.meta[id] = meta;
    save();
    return meta;
  }

  async function library(force = false) {
    const dir = folder();
    if (!dir) return { configured: false, books: [] };
    if (!force && cache.folder === dir && Date.now() - cache.at < 30e3) return { configured: true, folder: dir, books: cache.books };
    try { await fsp.access(dir); } catch { return { configured: true, folder: dir, error: `Can’t open the books folder (${dir})`, books: [] }; }
    const rels = await walk(dir);
    const books = [];
    for (const rel of rels) {
      const abs = path.join(dir, rel);
      let st;
      try { st = await fsp.stat(abs); } catch { continue; }
      const format = FORMATS[rel.split('.').pop().toLowerCase()];
      const id = idFor(rel);
      const meta = await metaFor(abs, id, format, st);
      const guess = fromFileName(rel);
      books.push({
        id, path: rel, format, size: st.size, modified: st.mtimeMs,
        title: meta.title || guess.title, author: meta.author || guess.author,
        folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
        cover: Boolean(meta.cover), pages: meta.pages || null,
      });
    }
    books.sort((a, b) => naturalSort(a.title, b.title));
    cache = { at: Date.now(), folder: dir, books };
    return { configured: true, folder: dir, books };
  }

  async function bookFile(id) {
    const lib = await library();
    const b = lib.books.find((x) => x.id === id);
    if (!b) {
      const again = await library(true);
      const b2 = again.books.find((x) => x.id === id);
      if (!b2) throw new BookError(404, 'That book isn’t in the library any more');
      return { book: b2, abs: path.join(folder(), b2.path) };
    }
    return { book: b, abs: path.join(folder(), b.path) };
  }

  async function sendRange(req, res, abs, type) {
    const st = await fsp.stat(abs);
    let start = 0, end = st.size - 1, status = 200;
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && st.size) {
      if (range[1] === '') start = Math.max(0, st.size - Number(range[2]));
      else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size ? end - start + 1 : 0;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !st.size) return res.end();
    await pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {});
  }

  const TYPES = { epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' };

  // Reading state: where each book is up to, bookmarks and when it was last read. Keys are
  // library ids, "f:<shared folder>:<path>" for books opened from Files, or "l:<name>:<size>".
  const cleanKey = (k) => String(k || '').slice(0, 600);
  function cleanState(prev, body) {
    const next = { ...(prev || {}) };
    if (body.page != null) next.page = Math.max(0, Math.floor(Number(body.page) || 0));
    if (body.pages != null) next.pages = Math.max(0, Math.floor(Number(body.pages) || 0));
    if (body.progress != null) next.progress = Math.min(1, Math.max(0, Number(body.progress) || 0));
    if (body.anchor != null) next.anchor = String(body.anchor).slice(0, 300); // EPUB: chapter + position, survives a new page size
    if (Array.isArray(body.bookmarks)) next.bookmarks = body.bookmarks.slice(0, 500).map((b) => ({ page: Math.max(0, Math.floor(Number(b.page) || 0)), anchor: b.anchor ? String(b.anchor).slice(0, 300) : undefined, label: String(b.label || '').slice(0, 200), at: Number(b.at) || Date.now() }));
    if (body.title) next.title = String(body.title).slice(0, 300);
    if (body.author != null) next.author = String(body.author).slice(0, 300);
    if (body.format) next.format = FORMATS[body.format] || next.format;
    if (body.finished != null) next.finished = Boolean(body.finished);
    next.at = Date.now();
    return next;
  }

  async function handle(req, res, url, { sendJson, readJson, readBody }) {
    const p = url.pathname.replace(/^\/portal\/ebooks/, '') || '/';
    try {
      if (p === '/library' && req.method === 'GET') {
        const lib = await library(url.searchParams.get('refresh') === '1');
        return sendJson(res, 200, { ...lib, mock, reading: load().books });
      }
      let m = /^\/file\/([0-9a-f]{16})$/.exec(p);
      if (m && (req.method === 'GET' || req.method === 'HEAD')) {
        const { book, abs } = await bookFile(m[1]);
        return await sendRange(req, res, abs, TYPES[book.format]);
      }
      m = /^\/cover\/([0-9a-f]{16})$/.exec(p);
      if (m && req.method === 'GET') {
        const meta = load().meta[m[1]];
        if (!meta?.cover) return sendJson(res, 404, { error: 'No cover' });
        const file = path.join(coverDir, path.basename(meta.cover));
        try {
          const buf = await fsp.readFile(file);
          res.writeHead(200, { 'Content-Type': IMAGE_TYPES[file.split('.').pop()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
          return res.end(buf);
        } catch { return sendJson(res, 404, { error: 'No cover' }); }
      }
      // A PDF's cover, drawn by the browser.
      if (m && req.method === 'POST') {
        const { book, abs } = await bookFile(m[1]);
        if (book.format !== 'pdf') throw new BookError(400, 'Only PDF covers are sent');
        const buf = await readBody(req, MAX_COVER).catch(() => { throw new BookError(413, 'That cover is too big'); });
        const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.slice(0, 4).toString() === 'RIFF' ? 'webp' : null;
        if (!type) throw new BookError(415, 'Covers are PNG, JPEG or WebP');
        await fsp.mkdir(coverDir, { recursive: true });
        await fsp.writeFile(path.join(coverDir, `${book.id}.${type}`), buf);
        const st = await fsp.stat(abs);
        load().meta[book.id] = { ...(load().meta[book.id] || {}), stamp: `${st.size}:${Math.floor(st.mtimeMs)}`, cover: `${book.id}.${type}` };
        await save();
        cache.at = 0;
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/state' && req.method === 'GET') return sendJson(res, 200, { books: load().books });
      if (p === '/state' && req.method === 'POST') {
        const body = await readJson(req);
        const key = cleanKey(body.key);
        if (!key) throw new BookError(400, 'Which book?');
        const s = load();
        if (body.forget) delete s.books[key];
        else s.books[key] = cleanState(s.books[key], body);
        // Keep the 1000 most recently read.
        const keys = Object.keys(s.books);
        if (keys.length > 1000) keys.sort((a, b) => (s.books[a].at || 0) - (s.books[b].at || 0)).slice(0, keys.length - 1000).forEach((k) => delete s.books[k]);
        await save();
        return sendJson(res, 200, { state: s.books[key] || null });
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!(err instanceof BookError)) console.error('eBook Reader:', err);
      return sendJson(res, err.status || 500, { error: err.status ? err.message : 'The eBook Reader had a problem' });
    }
  }

  return { handle, invalidate: () => { cache.at = 0; }, library };
}

module.exports = { createEbooks, zipEntries, zipRead, epubMeta, cbzMeta };
