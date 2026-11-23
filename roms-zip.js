// ROM Librarian's archive code: read ZIP files (stored, deflate, ZIP64), hash what's inside them
// (CRC32, SHA-1, MD5, plus the same hashes without a known copier header), write TorrentZip-style
// archives (sorted names, fixed dates, deflate level 9, "TORRENTZIPPED-xxxxxxxx" comment), and
// list, read and create 7z archives through the 7-Zip program the Archive Expander already uses.
// Plain Node, no npm packages.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Writable, PassThrough } = require('node:stream');

// --- CRC32 ------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = typeof zlib.crc32 === 'function'
  ? (buf, prev = 0) => zlib.crc32(buf, prev)
  : (buf, prev = 0) => { let c = (prev ^ 0xffffffff) >>> 0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

// --- Copier headers ---------------------------------------------------------------------------
// DATs such as No-Intro's NES, FDS, Lynx and 7800 list ROMs without the header that dumps and
// emulators keep at the start of the file. Files with one get a second set of hashes for the
// data after it, so either form matches. (The idea follows clrmamepro's header XMLs.)
const HEADERS = [
  { id: 'nes', skip: 16, test: (b) => b.length >= 16 && b.toString('latin1', 0, 4) === 'NES\x1a' },
  { id: 'fds', skip: 16, test: (b) => b.length >= 16 && b.toString('latin1', 0, 4) === 'FDS\x1a' },
  { id: 'lynx', skip: 64, test: (b) => b.length >= 64 && b.toString('latin1', 0, 4) === 'LYNX' },
  { id: 'a7800', skip: 128, test: (b) => b.length >= 128 && b.toString('latin1', 1, 10) === 'ATARI7800' },
  // 512-byte copier headers (SNES, PC Engine): only recognised by size.
  { id: 'copier512', skip: 512, test: (b, size) => size > 512 && size % 1024 === 512 },
];
function detectHeader(first, size) { return HEADERS.find((hd) => hd.test(first, size)) || null; }

// Hashes a stream of bytes. Call update() with chunks and digest() at the end. The first 512
// bytes are held back until the header is known, so headerless hashes start at the right byte.
class Hasher {
  constructor({ size = -1, deep = true } = {}) {
    this.size = size; this.deep = deep; this.len = 0; this.crc = 0;
    this.sha1 = deep ? crypto.createHash('sha1') : null; this.md5 = deep ? crypto.createHash('md5') : null;
    this.head = []; this.headLen = 0; this.decided = false; this.alt = null;
  }
  update(chunk) {
    this.len += chunk.length;
    this.crc = crc32(chunk, this.crc);
    if (this.sha1) { this.sha1.update(chunk); this.md5.update(chunk); }
    if (!this.decided) {
      this.head.push(chunk); this.headLen += chunk.length;
      if (this.headLen >= 512) this.decide();
      return;
    }
    if (this.alt) this.altUpdate(chunk);
  }
  decide() {
    this.decided = true;
    const first = Buffer.concat(this.head); this.head = null;
    const hd = detectHeader(first, this.size >= 0 ? this.size : first.length);
    if (hd && first.length >= hd.skip) {
      this.alt = { id: hd.id, skip: hd.skip, crc: 0, sha1: this.deep ? crypto.createHash('sha1') : null, md5: this.deep ? crypto.createHash('md5') : null, len: 0 };
      this.altUpdate(first.subarray(hd.skip));
    }
  }
  altUpdate(b) { const a = this.alt; a.len += b.length; a.crc = crc32(b, a.crc); if (a.sha1) { a.sha1.update(b); a.md5.update(b); } }
  digest() {
    if (!this.decided) this.decide();
    const out = { size: this.len, crc: hex8(this.crc) };
    if (this.sha1) { out.sha1 = this.sha1.digest('hex'); out.md5 = this.md5.digest('hex'); }
    if (this.alt) { const a = this.alt; out.alt = { header: a.id, skip: a.skip, size: a.len, crc: hex8(a.crc), ...(a.sha1 ? { sha1: a.sha1.digest('hex'), md5: a.md5.digest('hex') } : {}) }; }
    return out;
  }
}
const hashSink = (hasher) => new Writable({ write(chunk, _e, cb) { hasher.update(chunk); cb(); } });

async function hashFile(file, { signal } = {}) {
  const st = await fsp.stat(file);
  const hasher = new Hasher({ size: st.size });
  await pipeline(fs.createReadStream(file, { highWaterMark: 1 << 20 }), hashSink(hasher), { signal });
  return hasher.digest();
}

// --- CHD (MAME's compressed disks) -------------------------------------------------------------
// DATs list a disk by the SHA-1 stored in its header, so reading the header is enough.
async function readChd(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const b = Buffer.alloc(124);
    const { bytesRead } = await fh.read(b, 0, 124, 0);
    if (bytesRead < 16 || b.toString('latin1', 0, 8) !== 'MComprHD') return null;
    const version = b.readUInt32BE(12);
    const at = { 3: [80, 44], 4: [48, null], 5: [84, null] }[version];
    if (!at) return { version, sha1: null, md5: null };
    const sha1 = bytesRead >= at[0] + 20 ? b.toString('hex', at[0], at[0] + 20) : null;
    const md5 = at[1] != null ? b.toString('hex', at[1], at[1] + 16) : null;
    return { version, sha1: /^0+$/.test(sha1 || '0') ? null : sha1, md5 };
  } finally { await fh.close(); }
}

// --- ZIP reading -------------------------------------------------------------------------------
class ZipError extends Error {}

async function readZipDirectory(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 22) throw new ZipError('Too small to be a ZIP file');
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new ZipError('No ZIP directory (the file is damaged or not a ZIP)');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    const commentLen = tail.readUInt16LE(eocd + 20);
    const comment = tail.toString('latin1', eocd + 22, eocd + 22 + commentLen);
    let zip64 = false;
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z64at = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const z = Buffer.alloc(56);
      await fh.read(z, 0, 56, z64at);
      if (z.readUInt32LE(0) === 0x06064b50) {
        zip64 = true;
        count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48));
      }
    }
    if (cdOffset + cdSize > size) throw new ZipError('The ZIP directory points past the end of the file');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The ZIP directory is damaged');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const cLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
      const name = flags & 0x800 ? nameBuf.toString('utf8') : decodeCp437(nameBuf);
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e); const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + len;
      }
      p = end + cLen;
      entries.push({ name, flags, method, time, date, crc: hex8(crc), csize, size: usize, offset, dir: name.endsWith('/'), encrypted: Boolean(flags & 1), extraLen });
    }
    // TorrentZip: the comment holds the CRC32 of the central directory, and the files are in
    // case-insensitive name order, deflated, with its fixed date.
    let torrentzip = false;
    const m = /^TORRENTZIPPED-([0-9A-F]{8})$/.exec(comment);
    if (m && m[1] === hex8(crc32(cd)).toUpperCase() && !zip64 === !needsZip64(entries)) {
      torrentzip = entries.every((x, i) => x.method === 8 && x.time === 0xbc00 && x.date === 0x2198 && x.extraLen === (x.size >= 0xffffffff || x.csize >= 0xffffffff || x.offset >= 0xffffffff ? x.extraLen : 0)
        && (i === 0 || tzCompare(entries[i - 1].name, x.name) < 0));
    }
    return { entries: entries.filter((x) => !x.dir), comment, torrentzip, size };
  } finally { await fh.close(); }
}
const needsZip64 = (entries) => entries.length >= 0xffff || entries.some((x) => x.size >= 0xffffffff || x.csize >= 0xffffffff || x.offset >= 0xffffffff);

const CP437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeCp437(buf) {
  let ascii = true;
  for (const b of buf) if (b >= 0x80) { ascii = false; break; }
  if (ascii) return buf.toString('latin1');
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP437[b];
  return s;
}

// A readable stream of one entry's uncompressed bytes.
async function zipEntryStream(file, entry) {
  if (entry.encrypted) throw new ZipError(`${entry.name} is encrypted`);
  if (![0, 8].includes(entry.method)) throw new ZipError(`${entry.name} uses a compression method this reader doesn't know (${entry.method})`);
  const fh = await fsp.open(file, 'r');
  let start;
  try {
    const lh = Buffer.alloc(30);
    await fh.read(lh, 0, 30, entry.offset);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new ZipError(`${entry.name}: damaged local header`);
    start = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  } finally { await fh.close(); }
  if (entry.csize === 0) { const pt = new PassThrough(); pt.end(); return pt; }
  const raw = fs.createReadStream(file, { start, end: start + entry.csize - 1, highWaterMark: 1 << 20 });
  if (entry.method === 0) return raw;
  const inflate = zlib.createInflateRaw();
  raw.on('error', (e) => inflate.destroy(e));
  return raw.pipe(inflate);
}

// Hash every file inside a ZIP. Damaged entries come back with `corrupt`.
async function hashZip(file, dirInfo, { signal, onEntry } = {}) {
  const out = [];
  for (const e of dirInfo.entries) {
    if (signal?.aborted) throw new Error('Cancelled');
    onEntry?.(e.name);
    try {
      const hasher = new Hasher({ size: e.size });
      await pipeline(await zipEntryStream(file, e), hashSink(hasher), { signal });
      const d = hasher.digest();
      if (d.crc !== e.crc || d.size !== e.size) out.push({ name: e.name, size: e.size, crc: e.crc, corrupt: 'CRC check failed' });
      else out.push({ name: e.name, ...d });
    } catch (err) {
      if (signal?.aborted) throw err;
      out.push({ name: e.name, size: e.size, crc: e.crc, corrupt: err.message });
    }
  }
  return out;
}

// --- TorrentZip writing ------------------------------------------------------------------------
// Names compare case-insensitively (lower case) as TorrentZip does; ties keep byte order.
const tzCompare = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0; };

// Writes a ZIP to `dest` from [{ name, open: async () => Readable }]. Each entry's bytes are
// deflated (level 9) and hashed as they're written; returns [{ name, size, crc, sha1, md5 }].
async function writeTorrentZip(dest, items, { signal, onEntry } = {}) {
  const sorted = [...items].sort((a, b) => tzCompare(a.name, b.name));
  const fh = await fsp.open(dest, 'w');
  const central = [];
  const results = [];
  let pos = 0;
  try {
    for (const it of sorted) {
      if (signal?.aborted) throw new Error('Cancelled');
      onEntry?.(it.name);
      const name = Buffer.from(it.name.replace(/\\/g, '/'), 'utf8');
      const utf8 = /[^\x00-\x7f]/.test(it.name);
      const flags = 2 | (utf8 ? 0x800 : 0);
      const offset = pos;
      // Room for a ZIP64 extra field is only kept when the entry turns out to need it, so the
      // header is written after the data (sizes known) at the reserved position.
      const big = (it.sizeHint || 0) >= 0xfffffff0;
      const extraLen = big ? 20 : 0;
      const headerLen = 30 + name.length + extraLen;
      pos += headerLen;
      const hasher = new Hasher({ size: it.sizeHint ?? -1 });
      let csize = 0;
      const deflate = zlib.createDeflateRaw({ level: 9, memLevel: 8, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
      const counter = new Writable({
        write(chunk, _e, cb) { const at = pos; pos += chunk.length; csize += chunk.length; fh.write(chunk, 0, chunk.length, at).then(() => cb(), cb); },
      });
      const src = await it.open();
      await pipeline(src, new (require('node:stream').Transform)({ transform(chunk, _e, cb) { hasher.update(chunk); cb(null, chunk); } }), deflate, counter, { signal });
      const d = hasher.digest();
      if (!big && (d.size >= 0xffffffff || csize >= 0xffffffff)) throw new ZipError(`${it.name} is too big for this ZIP (over 4 GB)`);
      const lh = Buffer.alloc(headerLen);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(big ? 45 : 20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(8, 8);
      lh.writeUInt16LE(0xbc00, 10); lh.writeUInt16LE(0x2198, 12); lh.writeUInt32LE(parseInt(d.crc, 16), 14);
      lh.writeUInt32LE(big ? 0xffffffff : csize, 18); lh.writeUInt32LE(big ? 0xffffffff : d.size, 22);
      lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(extraLen, 28); name.copy(lh, 30);
      if (big) { const q = 30 + name.length; lh.writeUInt16LE(1, q); lh.writeUInt16LE(16, q + 2); lh.writeBigUInt64LE(BigInt(d.size), q + 4); lh.writeBigUInt64LE(BigInt(csize), q + 12); }
      await fh.write(lh, 0, headerLen, offset);
      central.push({ name, flags, crc: parseInt(d.crc, 16), csize, size: d.size, offset });
      results.push({ name: it.name, ...d });
    }
    const z64 = central.length >= 0xffff || central.some((c) => c.size >= 0xffffffff || c.csize >= 0xffffffff || c.offset >= 0xffffffff);
    const parts = central.map((c) => {
      const need = [c.size >= 0xffffffff, c.csize >= 0xffffffff, c.offset >= 0xffffffff];
      const extraLen = need.some(Boolean) ? 4 + 8 * need.filter(Boolean).length : 0;
      const b = Buffer.alloc(46 + c.name.length + extraLen);
      b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(0, 4); b.writeUInt16LE(extraLen ? 45 : 20, 6); b.writeUInt16LE(c.flags, 8); b.writeUInt16LE(8, 10);
      b.writeUInt16LE(0xbc00, 12); b.writeUInt16LE(0x2198, 14); b.writeUInt32LE(c.crc, 16);
      b.writeUInt32LE(need[1] ? 0xffffffff : c.csize, 20); b.writeUInt32LE(need[0] ? 0xffffffff : c.size, 24);
      b.writeUInt16LE(c.name.length, 28); b.writeUInt16LE(extraLen, 30); b.writeUInt32LE(need[2] ? 0xffffffff : c.offset, 42);
      c.name.copy(b, 46);
      if (extraLen) {
        let q = 46 + c.name.length; b.writeUInt16LE(1, q); b.writeUInt16LE(extraLen - 4, q + 2); q += 4;
        if (need[0]) { b.writeBigUInt64LE(BigInt(c.size), q); q += 8; }
        if (need[1]) { b.writeBigUInt64LE(BigInt(c.csize), q); q += 8; }
        if (need[2]) { b.writeBigUInt64LE(BigInt(c.offset), q); q += 8; }
      }
      return b;
    });
    const cd = Buffer.concat(parts);
    const cdOffset = pos;
    await fh.write(cd, 0, cd.length, pos); pos += cd.length;
    const comment = Buffer.from(`TORRENTZIPPED-${hex8(crc32(cd)).toUpperCase()}`, 'latin1');
    const tail = [];
    if (z64) {
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(central.length), 24); z.writeBigUInt64LE(BigInt(central.length), 32); z.writeBigUInt64LE(BigInt(cd.length), 40); z.writeBigUInt64LE(BigInt(cdOffset), 48);
      const l = Buffer.alloc(20);
      l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(pos), 8); l.writeUInt32LE(1, 16);
      tail.push(z, l);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(Math.min(central.length, 0xffff), 8); e.writeUInt16LE(Math.min(central.length, 0xffff), 10);
    e.writeUInt32LE(z64 ? 0xffffffff : cd.length, 12); e.writeUInt32LE(z64 ? 0xffffffff : cdOffset, 16); e.writeUInt16LE(comment.length, 20);
    tail.push(e, comment);
    const t = Buffer.concat(tail);
    await fh.write(t, 0, t.length, pos);
  } finally { await fh.close(); }
  return results;
}

// --- 7z, through 7-Zip --------------------------------------------------------------------------
function run7z(exe, args, { cwd, signal, stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!exe) { reject(new Error('7-Zip isn’t installed on the MediaDesk server (Settings → Files)')); return; }
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', stdout ? 'pipe' : 'pipe', 'pipe'] });
    let out = '', err = '';
    const kill = () => child.kill();
    signal?.addEventListener('abort', kill, { once: true });
    if (stdout) child.stdout.pipe(stdout); else child.stdout.on('data', (d) => { if (out.length < 64 << 20) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 1 << 20) err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(new Error('Cancelled'));
      else if (code === 0 || code === 1) resolve(out);
      else reject(new Error((err || out).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `7-Zip stopped (code ${code})`));
    });
  });
}

async function list7z(exe, file, { signal } = {}) {
  const out = await run7z(exe, ['l', '-slt', '-ba', '-sccUTF-8', '--', file], { signal });
  const entries = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\w[\w ]*?) = (.*)$/.exec(line);
    if (!m) { if (!line.trim() && cur) { entries.push(cur); cur = null; } continue; }
    if (m[1] === 'Path') { if (cur) entries.push(cur); cur = { name: m[2].replace(/\\/g, '/') }; continue; }
    if (!cur) continue;
    if (m[1] === 'Size') cur.size = Number(m[2]) || 0;
    if (m[1] === 'CRC') cur.crc = m[2].toLowerCase().padStart(8, '0');
    if (m[1] === 'Attributes' && /D/.test(m[2].split(' ')[0])) cur.dir = true;
    if (m[1] === 'Folder' && m[2] === '+') cur.dir = true;
  }
  if (cur) entries.push(cur);
  return entries.filter((e) => !e.dir).map((e) => ({ ...e, crc: e.crc || (e.size === 0 ? '00000000' : undefined) }));
}

// Streams one file out of a 7z. 7-Zip treats * and ? in names as wildcards, so those can't be read singly.
function sevenZipEntryStream(exe, file, name) {
  if (/[*?]/.test(name)) throw new Error(`${name}: names with * or ? can’t be read from a 7z one at a time`);
  const pt = new PassThrough({ highWaterMark: 1 << 20 });
  run7z(exe, ['e', '-so', '-sccUTF-8', '--', file, name], { stdout: pt }).catch((err) => pt.destroy(err));
  return pt;
}

async function hash7z(exe, file, entries, { signal, onEntry } = {}) {
  const out = [];
  for (const e of entries) {
    if (signal?.aborted) throw new Error('Cancelled');
    onEntry?.(e.name);
    try {
      const hasher = new Hasher({ size: e.size });
      await pipeline(sevenZipEntryStream(exe, file, e.name), hashSink(hasher), { signal });
      const d = hasher.digest();
      if ((e.crc && d.crc !== e.crc) || d.size !== e.size) out.push({ name: e.name, size: e.size, crc: e.crc, corrupt: 'CRC check failed' });
      else out.push({ name: e.name, ...d });
    } catch (err) {
      if (signal?.aborted) throw err;
      out.push({ name: e.name, size: e.size, crc: e.crc, corrupt: err.message });
    }
  }
  return out;
}

// Builds a 7z from [{ name, open }]: the files are written to a work folder first, then 7-Zip
// packs them (LZMA2, ultra, solid) in sorted name order.
async function write7z(exe, dest, items, { signal, onEntry, workDir } = {}) {
  dest = path.resolve(dest);
  const work = await fsp.mkdtemp(path.join(workDir || path.dirname(dest), '.rl-7z-'));
  try {
    const results = [];
    const names = [];
    for (const it of [...items].sort((a, b) => tzCompare(a.name, b.name))) {
      if (signal?.aborted) throw new Error('Cancelled');
      onEntry?.(it.name);
      const target = path.join(work, ...it.name.split('/'));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const hasher = new Hasher({ size: it.sizeHint ?? -1 });
      const src = await it.open();
      await pipeline(src, new (require('node:stream').Transform)({ transform(chunk, _e, cb) { hasher.update(chunk); cb(null, chunk); } }), fs.createWriteStream(target), { signal });
      results.push({ name: it.name, ...hasher.digest() });
      names.push(it.name);
    }
    const listFile = path.join(work, '.rl-list.txt');
    await fsp.writeFile(listFile, names.join('\n'), 'utf8');
    const tmp = `${dest}.rl-tmp.7z`;
    await fsp.rm(tmp, { force: true });
    await run7z(exe, ['a', '-t7z', '-mx=9', '-ms=on', '-mtm=off', '-mtc=off', '-mta=off', '-sccUTF-8', '-scsUTF-8', '-bd', '-y', tmp, `@${listFile}`], { cwd: work, signal });
    await fsp.rename(tmp, dest);
    return results;
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}

module.exports = { crc32, hex8, Hasher, hashSink, hashFile, readChd, readZipDirectory, zipEntryStream, hashZip, writeTorrentZip, tzCompare, list7z, sevenZipEntryStream, hash7z, write7z, run7z, ZipError, detectHeader };
