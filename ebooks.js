// The eBook Reader's library: the books in one folder on this server (and its subfolders), with
// each book's title, author and cover, and where each reader is up to (page, bookmarks) kept on
// the server so a book opens where it was left on any device. Books can be uploaded into it.
//
// Formats: EPUB, PDF and CBZ comics are read by the browser as they are, and so are Kindle MOBI /
// AZW, FictionBook (FB2) and plain text. Comics in other archives (CBR is RAR, CB7, CBT) are
// repacked as CBZ by 7-Zip on this server; AZW3, Word, RTF, ODT and LIT books are converted to
// EPUB by Calibre's ebook-convert, when it's installed. Conversions are kept, so each happens once.
//
// Titles, authors and covers come from inside the books (EPUB and CBZ are zip files, read with a
// small zip reader; MOBI from its header; FB2 from its XML; other comics through 7-Zip); a PDF's
// cover is drawn by the browser the first time it's shown and sent back to be kept.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Every kind of file the library takes (by extension) and the format it is.
const FORMATS = {
  epub: 'epub', pdf: 'pdf', cbz: 'cbz', cbr: 'cbr', cb7: 'cb7', cbt: 'cbt',
  mobi: 'mobi', azw: 'mobi', prc: 'mobi', azw3: 'azw3', fb2: 'fb2', txt: 'txt',
  rtf: 'rtf', docx: 'docx', odt: 'odt', lit: 'lit',
};
const COMIC_ARCHIVES = new Set(['cbr', 'cb7', 'cbt']);
const CALIBRE_FORMATS = new Set(['azw3', 'rtf', 'docx', 'odt', 'lit']);
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;
const formatOfName = (name) => FORMATS[String(name).split('.').pop().toLowerCase()] || null;
// How the browser reads a format: as it is, or after the server converts it (as).
function viewOf(format, tools) {
  if (['epub', 'pdf', 'cbz', 'mobi', 'fb2', 'txt'].includes(format)) return { view: format };
  if (COMIC_ARCHIVES.has(format)) return tools.sevenZip ? { view: 'cbz', as: 'cbz' } : { view: null, need: '7-Zip' };
  if (format === 'azw3') return tools.calibre ? { view: 'epub', as: 'epub' } : { view: 'mobi' }; // many AZW3 files also hold a MOBI copy
  if (CALIBRE_FORMATS.has(format)) return tools.calibre ? { view: 'epub', as: 'epub' } : { view: null, need: 'Calibre' };
  return { view: null };
}
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
const isImageName = (n) => Boolean(IMAGE_TYPES[n.split('.').pop().toLowerCase()]) && !/(^|\/)(__MACOSX|\.)/.test(n);

// Run a program; stdout as a Buffer (up to a limit).
function runTool(cmd, args, { timeout = 60e3, limit = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: Buffer.alloc(0), err: e.message }); return; }
    const out = [];
    let size = 0;
    let err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (c) => { size += c.length; if (size <= limit) out.push(c); else child.kill('SIGKILL'); });
    child.stderr.on('data', (c) => { if (err.length < 8000) err += c; });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: Buffer.alloc(0), err: e.message }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out: Buffer.concat(out), err }); });
  });
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// Pictures into a zip (stored: they're compressed already), one file at a time.
async function writeStoredZip(out, files) {
  const fh = await fsp.open(out, 'w');
  const central = [];
  let offset = 0;
  try {
    for (const f of files) {
      const data = await fsp.readFile(f.abs);
      const name = Buffer.from(f.name);
      const crc = crc32(data);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
      head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
      await fh.write(head); await fh.write(name); await fh.write(data);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
      cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
      central.push(cen, name);
      offset += 30 + name.length + data.length;
    }
    const cenBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
    await fh.write(cenBuf); await fh.write(end);
  } finally { await fh.close(); }
}

// Kindle MOBI / AZW / AZW3: a Palm database whose first record has the title, and an EXTH block
// with the author and which picture is the cover.
function mobiMeta(buf) {
  if (buf.length < 78 || buf.toString('latin1', 60, 68) !== 'BOOKMOBI') throw new BookError(422, 'This isn’t a Kindle book');
  const n = buf.readUInt16BE(76);
  const rec = (i) => (i < n ? [buf.readUInt32BE(78 + i * 8), i + 1 < n ? buf.readUInt32BE(78 + (i + 1) * 8) : buf.length] : null);
  const [r0] = rec(0);
  if (buf.toString('latin1', r0 + 16, r0 + 20) !== 'MOBI') throw new BookError(422, 'This isn’t a Kindle book');
  const hlen = buf.readUInt32BE(r0 + 20);
  const enc = buf.readUInt32BE(r0 + 28) === 65001 ? 'utf8' : 'latin1';
  const nameOff = buf.readUInt32BE(r0 + 84);
  const nameLen = buf.readUInt32BE(r0 + 88);
  const firstImage = buf.readUInt32BE(r0 + 108);
  let title = buf.toString(enc, r0 + nameOff, r0 + nameOff + nameLen).trim();
  const authors = [];
  let cover = null;
  if (buf.readUInt32BE(r0 + 128) & 0x40) {
    let p = r0 + 16 + hlen;
    if (buf.toString('latin1', p, p + 4) === 'EXTH') {
      const count = buf.readUInt32BE(p + 8);
      p += 12;
      for (let i = 0; i < count && p + 8 <= buf.length; i++) {
        const type = buf.readUInt32BE(p);
        const len = buf.readUInt32BE(p + 4);
        const data = buf.subarray(p + 8, p + len);
        if (type === 100) authors.push(data.toString(enc).trim());
        if (type === 503) title = data.toString(enc).trim() || title;
        if (type === 201 && data.length >= 4) cover = data.readUInt32BE(0);
        p += len;
      }
    }
  }
  let coverData = null;
  let coverExt = null;
  const r = cover != null && firstImage < 0xffffffff ? rec(firstImage + cover) : null;
  if (r) {
    coverData = buf.subarray(r[0], r[1]);
    coverExt = coverData[0] === 0xff ? 'jpg' : coverData[0] === 0x89 ? 'png' : coverData.toString('latin1', 0, 3) === 'GIF' ? 'gif' : null;
  }
  return { title, author: authors.join(', '), coverData: coverExt ? coverData : null, coverExt };
}

// FictionBook: XML with the title, authors and a cover picture (base64) inside.
function fb2Meta(buf) {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  const enc = /encoding=["']([^"']+)/i.exec(head)?.[1]?.toLowerCase();
  const text = enc && /1251|cp1251/.test(enc) ? new TextDecoder('windows-1251').decode(buf) : enc && /1252|latin/.test(enc) ? buf.toString('latin1') : buf.toString('utf8');
  const info = /<title-info>([\s\S]*?)<\/title-info>/i.exec(text)?.[1] || '';
  const title = decode(/<book-title>([\s\S]*?)<\/book-title>/i.exec(info)?.[1]);
  const authors = [...info.matchAll(/<author>([\s\S]*?)<\/author>/gi)].map((m) => ['first-name', 'middle-name', 'last-name'].map((t) => decode(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i').exec(m[1])?.[1])).filter(Boolean).join(' ')).filter(Boolean);
  const coverRef = /<coverpage>[\s\S]*?href\s*=\s*["']#([^"']+)["']/i.exec(info)?.[1];
  let coverData = null;
  let coverExt = null;
  if (coverRef) {
    const bin = new RegExp(`<binary[^>]*id=["']${coverRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</binary>`, 'i').exec(text);
    if (bin) {
      coverData = Buffer.from(bin[1].replace(/\s+/g, ''), 'base64');
      coverExt = coverData[0] === 0xff ? 'jpg' : coverData[0] === 0x89 ? 'png' : coverData.toString('latin1', 0, 3) === 'GIF' ? 'gif' : null;
    }
  }
  return { title, author: authors.join(', '), coverData: coverExt ? coverData : null, coverExt };
}

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

function createEbooks({ dataDir, getFolder, mock = false, sample = null, getSevenZip = () => null, getConvertPath = () => '', resolveShared = null, filesEnabled = () => false }) {
  const stateFile = path.join(dataDir, 'ebooks.json');
  const coverDir = path.join(dataDir, 'ebook-covers');
  const convDir = path.join(dataDir, 'ebook-converted');
  const inflight = new Map();

  // Calibre's ebook-convert: where it's set, on the PATH, or where Calibre installs it.
  let calibre = null;
  async function detectCalibre() {
    const isWin = process.platform === 'win32';
    const set = getConvertPath();
    const list = [set, process.env.EBOOK_CONVERT_PATH, isWin ? 'ebook-convert.exe' : 'ebook-convert',
      ...(isWin ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).flatMap((b) => [path.join(b, 'Calibre2', 'ebook-convert.exe'), path.join(b, 'Calibre', 'ebook-convert.exe')])
        : ['/usr/bin/ebook-convert', '/opt/calibre/ebook-convert', '/Applications/calibre.app/Contents/MacOS/ebook-convert'])].filter(Boolean);
    calibre = null;
    for (const cmd of [...new Set(list)]) {
      if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) continue;
      const r = await runTool(cmd, ['--version'], { timeout: 30e3 });
      if (r.code === 0 && /calibre/i.test(r.out.toString())) { calibre = cmd; break; }
    }
    return calibre;
  }
  detectCalibre().catch(() => {});
  const tools = () => ({ sevenZip: Boolean(getSevenZip()), calibre: Boolean(calibre) });
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

  async function walk(root, rel = '', depth = 0, out = [], dirs = []) {
    if (depth > 8 || out.length > 20000) return out;
    let entries;
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.endsWith('.part')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { dirs.push(r); await walk(root, r, depth + 1, out, dirs); } else if (e.isFile() && formatOfName(e.name)) out.push(r);
    }
    return out;
  }

  // Title, author and cover, read once per version of each file.
  async function metaFor(abs, id, format, st) {
    const stamp = `${st.size}:${Math.floor(st.mtimeMs)}`;
    const s = load();
    if (s.meta[id]?.stamp === stamp) return s.meta[id];
    let meta = { stamp, title: '', author: '', cover: null };
    if (['epub', 'cbz', 'mobi', 'azw3', 'fb2'].includes(format) && st.size <= MAX_META_FILE) {
      try {
        const buf = await fsp.readFile(abs);
        const m = format === 'epub' ? epubMeta(buf) : format === 'cbz' ? cbzMeta(buf) : format === 'fb2' ? fb2Meta(buf) : mobiMeta(buf);
        meta = { ...meta, title: m.title, author: m.author, pages: m.pages };
        if (m.coverData?.length && IMAGE_TYPES[m.coverExt]) {
          await fsp.mkdir(coverDir, { recursive: true });
          const name = `${id}.${m.coverExt}`;
          await fsp.writeFile(path.join(coverDir, name), m.coverData);
          meta.cover = name;
        }
      } catch (err) { meta.error = err.message; }
    } else if (COMIC_ARCHIVES.has(format) && getSevenZip()) {
      // Other comic archives: the first picture, through 7-Zip.
      try {
        const names = await archiveImages(abs);
        meta.pages = names.length;
        if (names[0]) {
          const r = await runTool(getSevenZip(), ['e', '-so', '-pnone', '--', abs, names[0]], { timeout: 60e3, limit: MAX_COVER * 4 });
          const ext = names[0].split('.').pop().toLowerCase();
          if (r.code === 0 && r.out.length && IMAGE_TYPES[ext]) {
            await fsp.mkdir(coverDir, { recursive: true });
            await fsp.writeFile(path.join(coverDir, `${id}.${ext}`), r.out);
            meta.cover = `${id}.${ext}`;
          }
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
    if (!force && cache.folder === dir && Date.now() - cache.at < 30e3) return withViews({ configured: true, folder: dir, books: cache.books, folders: cache.folders, writable: cache.writable });
    try { await fsp.access(dir); } catch { return { configured: true, folder: dir, error: `Can’t open the books folder (${dir})`, books: [] }; }
    const dirs = [];
    const rels = await walk(dir, '', 0, [], dirs);
    const books = [];
    for (const rel of rels) {
      const abs = path.join(dir, rel);
      let st;
      try { st = await fsp.stat(abs); } catch { continue; }
      const format = formatOfName(rel);
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
    let writable = true;
    try { await fsp.access(dir, fs.constants.W_OK); } catch { writable = false; }
    cache = { at: Date.now(), folder: dir, books, folders: dirs.sort(naturalSort).slice(0, 500), writable };
    return withViews({ configured: true, folder: dir, books, folders: cache.folders, writable });
  }
  // How each book is read, with the tools there are now.
  function withViews(lib) {
    const t = tools();
    return { ...lib, tools: t, books: lib.books.map((b) => ({ ...b, ...viewOf(b.format, t) })) };
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

  // The pictures in a comic archive, in reading order.
  async function archiveImages(abs) {
    const r = await runTool(getSevenZip(), ['l', '-slt', '-ba', '-pnone', '--', abs], { timeout: 120e3 });
    if (r.code !== 0 && !r.out.length) throw new BookError(422, 'This comic book couldn’t be opened');
    const blocks = r.out.toString('utf8').split(/\r?\n\r?\n/);
    return blocks.map((b) => ({ p: /^Path = (.+)$/m.exec(b)?.[1]?.trim(), dir: /^Folder = \+/m.test(b) || /^Attributes = D/m.test(b) })).filter((x) => x.p && !x.dir && isImageName(x.p.replace(/\\/g, '/'))).map((x) => x.p).sort(naturalSort);
  }

  // Convert a book once (comics to CBZ with 7-Zip, others to EPUB with Calibre) and keep it.
  async function converted(abs, key, as) {
    const st = await fsp.stat(abs);
    const tag = crypto.createHash('sha1').update(`${key}|${st.size}|${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 20);
    const out = path.join(convDir, `${tag}.${as}`);
    if (fs.existsSync(out)) return out;
    if (inflight.has(out)) return inflight.get(out);
    const job = (async () => {
      await fsp.mkdir(convDir, { recursive: true });
      const part = path.join(convDir, `${tag}.part.${as}`);
      if (as === 'cbz') {
        const seven = getSevenZip();
        if (!seven) throw new BookError(503, '7-Zip is needed to open this comic book. See Settings → Files for how to add it.');
        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mediadesk-comic-'));
        try {
          const r = await runTool(seven, ['x', '-y', '-pnone', `-o${tmp}`, '--', abs], { timeout: 15 * 60e3, limit: 1024 * 1024 });
          const pics = [];
          const scan = async (rel) => {
            for (const e of await fsp.readdir(path.join(tmp, rel), { withFileTypes: true })) {
              const r2 = rel ? `${rel}/${e.name}` : e.name;
              if (e.isDirectory()) await scan(r2); else if (isImageName(r2)) pics.push(r2);
            }
          };
          await scan('');
          if (!pics.length) throw new BookError(422, r.code ? 'This comic book couldn’t be opened (it may be damaged or need a password)' : 'There are no pictures in this comic book');
          pics.sort(naturalSort);
          const width = String(pics.length).length;
          await writeStoredZip(part, pics.map((rel, i) => ({ abs: path.join(tmp, rel), name: `${String(i + 1).padStart(width, '0')}.${rel.split('.').pop().toLowerCase()}` })));
        } finally { await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
      } else {
        if (!calibre) await detectCalibre();
        if (!calibre) throw new BookError(503, 'Calibre is needed to open this kind of book. Install Calibre on the MediaDesk server (or set EBOOK_CONVERT_PATH).');
        const r = await runTool(calibre, [abs, part], { timeout: 15 * 60e3, limit: 4 * 1024 * 1024 });
        if (r.code !== 0 || !fs.existsSync(part)) throw new BookError(422, `Calibre couldn’t convert this book${/drm/i.test(r.err + r.out) ? ' (it has DRM)' : ''}`);
      }
      await fsp.rename(part, out);
      return out;
    })().finally(() => inflight.delete(out));
    inflight.set(out, job);
    return job;
  }

  // An upload, written to a file as it arrives.
  async function receive(req, dest, limit = MAX_UPLOAD) {
    let size = 0;
    const counter = new Transform({ transform(chunk, enc, cb) { size += chunk.length; if (size > limit) cb(new BookError(413, 'That file is too big')); else cb(null, chunk); } });
    const part = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
    try {
      await pipeline(req, counter, fs.createWriteStream(part, { flags: 'wx' }));
      if (!size) throw new BookError(400, 'That file is empty');
      return part;
    } catch (err) { await fsp.rm(part, { force: true }).catch(() => {}); throw err; }
  }
  const cleanName = (name) => path.basename(String(name || '')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

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
        const as = url.searchParams.get('as');
        if (as === 'cbz' || as === 'epub') return await sendRange(req, res, await converted(abs, book.id, as), TYPES[as]);
        return await sendRange(req, res, abs, TYPES[book.format] || 'application/octet-stream');
      }
      // A book in a shared folder (Files), converted if it needs to be.
      if (p === '/shared' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (!filesEnabled() || !resolveShared) throw new BookError(403, 'Files isn’t set up');
        const rel = url.searchParams.get('path') || '';
        const abs = await resolveShared(url.searchParams.get('root'), rel);
        const as = url.searchParams.get('as');
        if (as !== 'cbz' && as !== 'epub') throw new BookError(400, 'Convert to what?');
        return await sendRange(req, res, await converted(abs, `shared:${url.searchParams.get('root')}:${rel}`, as), TYPES[as]);
      }
      // A book from this device that needs converting: sent, converted, sent back, not kept.
      if (p === '/convert' && req.method === 'POST') {
        const name = cleanName(url.searchParams.get('name'));
        const format = formatOfName(name);
        const as = url.searchParams.get('as');
        if (!format || (as !== 'cbz' && as !== 'epub')) throw new BookError(400, 'That isn’t a book MediaDesk can convert');
        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mediadesk-book-'));
        try {
          const file = path.join(tmpDir, `book.${name.split('.').pop().toLowerCase()}`);
          await fsp.rename(await receive(req, file), file);
          const out = await converted(file, `upload:${name}:${crypto.randomBytes(6).toString('hex')}`, as);
          await sendRange(req, res, out, TYPES[as]);
          await fsp.rm(out, { force: true });
        } finally { await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); }
        return;
      }
      // Add a book to the library: written into the books folder (or one of its folders).
      if (p === '/upload' && req.method === 'POST') {
        const dir = folder();
        if (!dir) throw new BookError(400, 'Choose a books folder in Settings → eBook Reader first');
        const name = cleanName(url.searchParams.get('name'));
        if (!formatOfName(name)) throw new BookError(415, 'That isn’t a book the library takes');
        const sub = String(url.searchParams.get('folder') || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').map(cleanName).filter(Boolean).join('/');
        const target = path.join(dir, sub);
        if (!path.resolve(target).startsWith(path.resolve(dir))) throw new BookError(400, 'That folder isn’t in the books folder');
        try { await fsp.mkdir(target, { recursive: true }); await fsp.access(target, fs.constants.W_OK); } catch { throw new BookError(403, 'MediaDesk can’t write to the books folder (it may be read-only)'); }
        const size = Number(req.headers['content-length']) || 0;
        // The same book already there: nothing to do.
        let dest = path.join(target, name);
        try {
          const st = await fsp.stat(dest);
          if (st.size === size) {
            req.resume();
            const lib = await library(true);
            return sendJson(res, 200, { book: lib.books.find((b) => b.path === path.relative(dir, dest).split(path.sep).join('/')), existed: true });
          }
          const stem = name.replace(/\.[^.]+$/, '');
          const ext = name.slice(stem.length);
          for (let n = 2; fs.existsSync(dest); n++) dest = path.join(target, `${stem} (${n})${ext}`);
        } catch { /* a new book */ }
        const part = await receive(req, dest);
        await fsp.rename(part, dest);
        const lib = await library(true);
        const rel = path.relative(dir, dest).split(path.sep).join('/');
        return sendJson(res, 200, { book: lib.books.find((b) => b.path === rel) || null });
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
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'That book can’t be found' });
      if (!(err instanceof BookError) && !err.status) console.error('eBook Reader:', err);
      if (res.headersSent) return res.end();
      return sendJson(res, err.status || 500, { error: err.status ? err.message : 'The eBook Reader had a problem' });
    }
  }

  return { handle, invalidate: () => { cache.at = 0; }, library, detectCalibre };
}

module.exports = { createEbooks, zipEntries, zipRead, epubMeta, cbzMeta, mobiMeta, fb2Meta, writeStoredZip, FORMATS };
