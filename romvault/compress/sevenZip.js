// Ported from RomVault (RVWorld: Compress/StructuredZip/Structured7Zip.cs, Compress/SevenZip/*.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
// Changes: RomVault decodes and encodes 7z itself; this port lets the 7-Zip command-line tool list, extract
// and compress, and does the RomVault-specific parts here: the structure checks (RomVault7Z marker,
// torrent7z signature, file order) on reading, and on writing the RomVault file order and the 32-byte
// RomVault7Z marker block, so archives written here are recognised by RomVault and vice versa.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform, PassThrough } = require('node:stream');
const { ZipStructure } = require('../enums');
const { Sorters } = require('../sorters');
const { ZipReturn, ZipCompression, crc32, hex8 } = require('./common');
const { StructuredArchive, fileMtime } = require('./zip');

// The host sets how to find 7-Zip and where temporary folders go.
const config = { getExe: () => null, tempDir: () => os.tmpdir() };
function configure(opts) { Object.assign(config, opts); }

function run7z(args, { cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    const exe = config.getExe();
    if (!exe) { reject(Object.assign(new Error('7-Zip isn’t installed on the MediaDesk server'), { code: 'NO7Z' })); return; }
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const kill = () => child.kill();
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d) => { if (out.length < 256 << 20) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 1 << 20) err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(new Error('Cancelled'));
      else if (code === 0) resolve(out);
      else reject(new Error((err || out).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `7-Zip stopped (code ${code})`));
    });
  });
}

// ------------------------------------------------------------------------------------------------ signature header
const SIG = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
async function readSignatureHeader(fh) {
  const b = Buffer.alloc(32);
  const { bytesRead } = await fh.read(b, 0, 32, 0);
  if (bytesRead < 32 || !b.subarray(0, 6).equals(SIG)) return null;
  if (crc32(b.subarray(12, 32)) !== b.readUInt32LE(8)) return null;
  const nextHeaderOffset = Number(b.readBigUInt64LE(12));
  return { BaseOffset: 32, NextHeaderOffset: nextHeaderOffset, NextHeaderLocation: 32 + nextHeaderOffset, NextHeaderSize: Number(b.readBigUInt64LE(20)), NextHeaderCRC: b.readUInt32LE(28) };
}

// ------------------------------------------------------------------------------------------------ reading
class SevenZFileHeader {
  constructor() { this.Filename = ''; this.UncompressedSize = 0; this.CRC = null; this.IsDirectory = false; this.HeaderLastModified = 0; this.ModifiedTime = null; }
  get LastModified() { return this.ModifiedTime ?? this.HeaderLastModified; }
  get LocalHead() { return null; }
}

function parseModified(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

class SevenZ {
  constructor() { this.files = []; this.FileComment = null; this.ZipStruct = ZipStructure.None; this.HeaderZipStruct = ZipStructure.None; this.filename = null; this._extractDir = null; }
  get LocalFilesCount() { return this.files.length; }
  getFileHeader(i) { return this.files[i]; }

  static async open(filename, timestamp = -1, { signal } = {}) {
    const z = new SevenZ();
    z.filename = filename;
    let st;
    try { st = await fsp.stat(filename); } catch { return { zr: ZipReturn.ZipErrorFileNotFound }; }
    if (timestamp != null && timestamp !== -1 && fileMtime(st) !== timestamp) return { zr: ZipReturn.ZipErrorTimeStamp };
    z.size = st.size;
    let fh;
    try { fh = await fsp.open(filename, 'r'); } catch (e) { return { zr: e.code === 'EBUSY' || e.code === 'EPERM' ? ZipReturn.ZipFileLocked : ZipReturn.ZipErrorOpeningFile }; }
    try {
      z._sig = await readSignatureHeader(fh);
      if (!z._sig) return { zr: ZipReturn.ZipSignatureError };
      let out;
      try { out = await run7z(['l', '-slt', '-ba', '-sccUTF-8', '-t7z', filename], { signal }); } catch (e) {
        if (e.code === 'NO7Z' || signal?.aborted) throw e;
        return { zr: ZipReturn.ZipCentralDirError };
      }
      z.files = parseListing(out);
      await z._validateStructure(fh);
      return { zr: ZipReturn.ZipGood, zip: z };
    } finally { await fh.close(); }
  }

  async _validateStructure(fh) {
    const rv = await this._isRomVault7Z(fh);
    if (rv !== ZipStructure.None) {
      this.HeaderZipStruct = rv;
      if (this._validateFilesStructure(rv)) this.ZipStruct = rv;
      return;
    }
    this.HeaderZipStruct = await this._isTorrent7Z(fh);
    this.ZipStruct = this.HeaderZipStruct;
  }

  _validateFilesStructure(zs) {
    const n = this.files.length;
    for (let i = 0; i < n; i++) if (this.files[i].Filename.includes('\\')) return false;
    for (let i = 0; i < n - 1; i++) if (Sorters.Trrnt7ZipStringCompare(this.files[i].Filename, this.files[i + 1].Filename) >= 0) return false;
    const t = this.files.map((f) => f.Filename).sort(Sorters.StringCompare);
    for (let i = 0; i < t.length - 1; i++) {
      if (!t[i].endsWith('/')) continue;
      if (t[i + 1].length <= t[i].length) continue;
      if (t[i + 1].startsWith(t[i])) return false;
    }
    // RomVault also checks each zstd stream ends with a zstd end block; 7-Zip can't read zstd streams, so
    // zstd archives are reported as structured from their marker alone.
    return true;
  }

  async _isRomVault7Z(fh) {
    if (this.size < 32 || this._sig.NextHeaderLocation < 32) return ZipStructure.None;
    const b = Buffer.alloc(32);
    await fh.read(b, 0, 32, this._sig.NextHeaderLocation - 32);
    if (b.toString('latin1', 0, 11) !== 'RomVault7Z0') return ZipStructure.None;
    if (b.readUInt32LE(12) !== this._sig.NextHeaderCRC) return ZipStructure.None;
    if (Number(b.readBigUInt64LE(16)) !== this._sig.NextHeaderLocation) return ZipStructure.None;
    if (Number(b.readBigUInt64LE(24)) !== this._sig.NextHeaderSize) return ZipStructure.None;
    switch (b[11]) {
      case 0x31: return ZipStructure.SevenZipSLZMA;
      case 0x32: return ZipStructure.SevenZipNLZMA;
      case 0x33: return ZipStructure.SevenZipSZSTD;
      case 0x34: return ZipStructure.SevenZipNZSTD;
      default: return ZipStructure.None;
    }
  }

  async _isTorrent7Z(fh) {
    const crcsz = 128;
    const t7ZsigSize = 16 + 1 + 9 + 4 + 4;
    const t7Zid = Buffer.from('\xa9\x9f\xd1\x57\x08\xa9\xd7\xea\x29\x64\xb2\x36\x1b\x83\x52\x33\x01torrent7z_0.9beta', 'latin1');
    const buffer = Buffer.alloc(256 + t7ZsigSize + 8 + 4);
    let { bytesRead: ar } = await fh.read(buffer, 0, crcsz, 0);
    if (ar < crcsz) buffer.fill(0, ar, crcsz);
    const bufferPos = crcsz;
    const endReadLength = crcsz + t7ZsigSize + 4;
    let foffs = this.size < endReadLength ? 0 : this.size - endReadLength;
    ({ bytesRead: ar } = await fh.read(buffer, bufferPos, endReadLength, foffs));
    if (ar < endReadLength) {
      if (ar >= t7ZsigSize + 4) ar -= t7ZsigSize + 4;
      if (ar < SIG.length) ar = SIG.length;
      buffer.fill(0, bufferPos + ar, bufferPos + crcsz);
      buffer.copyWithin(crcsz * 2 + 8, bufferPos + ar, bufferPos + ar + t7ZsigSize + 4);
    } else {
      buffer.copyWithin(crcsz * 2 + 8, crcsz * 2, crcsz * 2 + t7ZsigSize + 4);
    }
    foffs = this.size - (t7ZsigSize + 4);
    buffer.writeBigUInt64LE(BigInt(Math.max(0, foffs)), crcsz * 2);
    if (!buffer.subarray(0, SIG.length).equals(SIG)) return ZipStructure.None;
    t7Zid[16] = buffer[crcsz * 2 + 4 + 8 + 16];
    if (!buffer.subarray(crcsz * 2 + 4 + 8, crcsz * 2 + 4 + 8 + t7Zid.length).equals(t7Zid)) return ZipStructure.None;
    const inCrc32 = buffer.readUInt32LE(crcsz * 2 + 8);
    buffer.fill(0xff, crcsz * 2 + 8, crcsz * 2 + 12);
    if (inCrc32 === crc32(buffer.subarray(0, crcsz * 2 + 8 + t7ZsigSize + 4))) return ZipStructure.SevenZipTrrnt;
    return ZipStructure.None;
  }

  // 7-Zip can only stream a solid archive from its start, so the first read extracts the whole archive to a
  // temporary folder, and each entry is read from there.
  async openReadStream(i, _raw = false, { signal } = {}) {
    const f = this.files[i];
    if (f.IsDirectory) return { zr: ZipReturn.ZipTryingToAccessADirectory };
    if (f.UncompressedSize === 0) { const pt = new PassThrough(); pt.end(); return { zr: ZipReturn.ZipGood, stream: pt, size: 0 }; }
    if (this._extractError) return { zr: ZipReturn.ZipDecodeError };
    if (!this._extractDir) {
      this._extractDir = await fsp.mkdtemp(path.join(config.tempDir(), '__RomVault.7z.'));
      try { await run7z(['x', '-y', '-sccUTF-8', '-t7z', `-o${this._extractDir}`, this.filename], { signal }); } catch (e) {
        if (e.code === 'NO7Z' || signal?.aborted) throw e;
        this._extractError = e.message;
      }
    }
    const p = path.join(this._extractDir, ...f.Filename.split('/'));
    try {
      const st = await fsp.stat(p);
      if (st.size !== f.UncompressedSize) return { zr: ZipReturn.ZipDecodeError };
    } catch { return { zr: ZipReturn.ZipDecodeError }; }
    return { zr: ZipReturn.ZipGood, stream: fs.createReadStream(p, { highWaterMark: 1 << 20 }), size: f.UncompressedSize };
  }

  async close() {
    if (this._extractDir) { await fsp.rm(this._extractDir, { recursive: true, force: true }).catch(() => {}); this._extractDir = null; }
  }
}

function parseListing(out) {
  const files = [];
  let cur = null; let attr = '';
  const done = () => {
    if (!cur) return;
    if (/^D/.test(attr) || cur.folder) { cur.IsDirectory = true; if (!cur.Filename.endsWith('/')) cur.Filename += '/'; }
    files.push(cur); cur = null; attr = '';
  };
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\w[\w ]*?) = (.*)$/.exec(line);
    if (!m) { if (!line.trim()) done(); continue; }
    if (m[1] === 'Path') { done(); cur = new SevenZFileHeader(); cur.Filename = m[2].replace(/\\/g, '/'); continue; }
    if (!cur) continue;
    if (m[1] === 'Size') cur.UncompressedSize = Number(m[2]) || 0;
    else if (m[1] === 'CRC' && m[2]) cur.CRC = m[2].toLowerCase().padStart(8, '0');
    else if (m[1] === 'Attributes') attr = m[2];
    else if (m[1] === 'Folder' && m[2] === '+') cur.folder = true;
    else if (m[1] === 'Modified') cur.ModifiedTime = parseModified(m[2]);
  }
  done();
  return files;
}

// ------------------------------------------------------------------------------------------------ writing
const DictionarySizes = [0x10000, 0x18000, 0x20000, 0x30000, 0x40000, 0x60000, 0x80000, 0xc0000, 0x100000, 0x180000, 0x200000,
  0x300000, 0x400000, 0x600000, 0x800000, 0xc00000, 0x1000000, 0x1800000, 0x2000000, 0x3000000, 0x4000000, 0x6000000];
function getDictionarySizeFromUncompressedSize(n) { for (const v of DictionarySizes) if (v >= n) return v; return DictionarySizes[DictionarySizes.length - 1]; }

// Entries are written to a temporary folder under numbered names, then 7-Zip packs the ones that have data
// in that order (LZMA, no filters, no times, plain header). The header's file list is then rebuilt here
// with the real names in RomVault's order, and the RomVault7Z marker is written in front of it.
class SevenZipWriter {
  constructor() { this.files = []; this.ZipStruct = ZipStructure.None; }
  get LocalFilesCount() { return this.files.length; }
  getFileHeader(i) { return this.files[i]; }

  static async create(filename, zipStruct, unCompressedSize = 0) {
    const w = new SevenZipWriter();
    w.filename = filename;
    w.ZipStruct = zipStruct;
    w.dictionarySize = getDictionarySizeFromUncompressedSize(unCompressedSize);
    try {
      await fsp.mkdir(path.dirname(filename), { recursive: true });
      w.work = await fsp.mkdtemp(path.join(path.dirname(filename), '__RomVault.7zw.'));
    } catch { return { zr: ZipReturn.ZipErrorOpeningFile }; }
    return { zr: ZipReturn.ZipGood, zip: w };
  }

  checkAdd(filename, uncompressedSize, method) {
    if (method !== StructuredArchive.getCompressionType(this.ZipStruct, uncompressedSize)) return ZipReturn.ZipTrrntzipIncorrectCompressionUsed;
    if (filename.includes('\\')) return ZipReturn.ZipTrrntZipIncorrectDirectorySeparator;
    const n = this.files.length;
    if (n > 0 && Sorters.Trrnt7ZipStringCompare(this.files[n - 1].Filename, filename) > 0) return ZipReturn.ZipTrrntzipIncorrectFileOrder;
    return ZipReturn.ZipGood;
  }

  // entry: { name, size, method, source (readable) }. Returns { zr, crc }.
  async addEntry(entry, onData) {
    const method = entry.method ?? StructuredArchive.getCompressionType(this.ZipStruct, entry.size);
    const zr = this.checkAdd(entry.name, entry.size, method);
    if (zr !== ZipReturn.ZipGood) { entry.source?.destroy?.(); return { zr }; }
    const isDir = entry.name.endsWith('/');
    const f = new SevenZFileHeader();
    f.Filename = entry.name; f.UncompressedSize = isDir ? 0 : entry.size; f.IsDirectory = isDir;
    if (isDir || entry.size === 0) {
      entry.source?.destroy?.();
      f.CRC = isDir ? null : '00000000';
      this.files.push(f);
      return { zr: ZipReturn.ZipGood, crc: f.CRC };
    }
    const tmp = path.join(this.work, String(this.files.length).padStart(8, '0'));
    let crc = 0; let size = 0;
    try {
      await pipeline(entry.source, new Transform({ transform(chunk, _e, cb) { crc = crc32(chunk, crc); size += chunk.length; onData?.(chunk); cb(null, chunk); } }), fs.createWriteStream(tmp));
    } catch { return { zr: ZipReturn.ZipErrorWritingToOutputStream }; }
    if (size !== entry.size) return { zr: ZipReturn.ZipErrorWritingToOutputStream };
    f.CRC = hex8(crc); f._tmp = path.basename(tmp);
    this.files.push(f);
    return { zr: ZipReturn.ZipGood, crc: f.CRC };
  }

  async close({ signal } = {}) {
    try {
      const streams = this.files.filter((f) => f._tmp);
      const out = `${this.filename}`;
      await fsp.rm(out, { force: true });
      let body; let packedEnd = 32; let mainStreams = null;
      if (streams.length) {
        const solid = StructuredArchive.isSolid(this.ZipStruct);
        const dict = solid ? this.dictionarySize : getDictionarySizeFromUncompressedSize(Math.max(...streams.map((f) => f.UncompressedSize)));
        const list = path.join(this.work, 'list.txt');
        await fsp.writeFile(list, streams.map((f) => f._tmp).join('\n'), 'utf8');
        const packed = path.join(this.work, 'packed.7z');
        await run7z(['a', '-t7z', `-m0=LZMA:d=${dict}b:fb=64`, '-mf=off', '-mqs=off', '-mhc=off', '-mhe=off', `-ms=${solid ? 'on' : 'off'}`,
          '-mtm=off', '-mtc=off', '-mta=off', '-mtr=off', '-bd', '-y', packed, `@${list}`], { cwd: this.work, signal });
        const listed = parseListing(await run7z(['l', '-slt', '-ba', packed], { signal }));
        if (listed.map((f) => f.Filename).join('\n') !== streams.map((f) => f._tmp).join('\n')) throw new Error('7-Zip changed the file order');
        body = await fsp.readFile(packed);
        const sig = { NextHeaderOffset: Number(body.readBigUInt64LE(12)), NextHeaderSize: Number(body.readBigUInt64LE(20)) };
        packedEnd = 32 + sig.NextHeaderOffset;
        const header = body.subarray(packedEnd, packedEnd + sig.NextHeaderSize);
        mainStreams = headerMainStreams(header);
      }
      const header = buildHeader(mainStreams, this.files);
      const headerCRC = crc32(header);
      const rv = this.files.length ? Buffer.alloc(32) : Buffer.alloc(0);
      const headerLocation = packedEnd + rv.length;
      if (rv.length) {
        const index = { [ZipStructure.SevenZipSLZMA]: '1', [ZipStructure.SevenZipNLZMA]: '2', [ZipStructure.SevenZipSZSTD]: '3', [ZipStructure.SevenZipNZSTD]: '4' }[this.ZipStruct] || '0';
        rv.write(`RomVault7Z0${index}`, 0, 'latin1');
        rv.writeUInt32LE(headerCRC, 12);
        rv.writeBigUInt64LE(BigInt(headerLocation), 16);
        rv.writeBigUInt64LE(BigInt(this.files.length ? header.length : 0), 24);
      }
      const sigHead = Buffer.alloc(32);
      SIG.copy(sigHead, 0); sigHead[6] = 0; sigHead[7] = 4;
      if (this.files.length) {
        sigHead.writeBigUInt64LE(BigInt(headerLocation - 32), 12);
        sigHead.writeBigUInt64LE(BigInt(header.length), 20);
        sigHead.writeUInt32LE(headerCRC, 28);
      }
      sigHead.writeUInt32LE(crc32(sigHead.subarray(12, 32)), 8);
      const parts = [sigHead];
      if (body) parts.push(body.subarray(32, packedEnd));
      if (this.files.length) parts.push(rv, header);
      await fsp.writeFile(out, Buffer.concat(parts));
      return { zr: ZipReturn.ZipGood, ZipStruct: this.ZipStruct };
    } catch (e) {
      if (e.code === 'NO7Z' || signal?.aborted) throw e;
      await fsp.rm(this.filename, { force: true }).catch(() => {});
      return { zr: ZipReturn.ZipErrorWritingToOutputStream, error: e.message };
    } finally {
      await fsp.rm(this.work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async closeFailed() {
    await fsp.rm(this.work, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(this.filename, { force: true }).catch(() => {});
  }
}

// --- 7z header helpers (plain, unencoded headers only) ---
class HReader {
  constructor(b) { this.b = b; this.p = 0; }
  byte() { if (this.p >= this.b.length) throw new Error('7z header ended early'); return this.b[this.p++]; }
  num() {
    const first = this.byte(); let mask = 0x80; let value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) { const high = first & (mask - 1); return value + high * 2 ** (8 * i); }
      value += this.byte() * 2 ** (8 * i); mask >>= 1;
    }
    return value;
  }
  skip(n) { this.p += n; if (this.p > this.b.length) throw new Error('7z header ended early'); }
  bits(n) { const out = []; let mask = 0; let byte = 0; for (let i = 0; i < n; i++) { if (mask === 0) { byte = this.byte(); mask = 0x80; } out.push((byte & mask) !== 0); mask >>= 1; } return out; }
  digests(n) { const all = this.byte(); const def = all ? new Array(n).fill(true) : this.bits(n); for (const d of def) if (d) this.skip(4); return def; }
}

// Returns the bytes of the header's MainStreamsInfo (from its 0x04 id to its 0x00 end).
function headerMainStreams(header) {
  const r = new HReader(header);
  if (r.byte() !== 0x01) throw new Error('7-Zip wrote an encoded header');
  let id = r.num();
  if (id === 0x02) { for (;;) { const t = r.num(); if (t === 0) break; r.skip(r.num()); } id = r.num(); }
  if (id === 0x03) { skipStreamsInfo(r); id = r.num(); }
  if (id !== 0x04) throw new Error('7z header has no streams');
  const start = r.p - 1;
  skipStreamsInfo(r);
  return header.subarray(start, r.p);
}

function skipStreamsInfo(r) {
  let folders = []; let id;
  while ((id = r.num()) !== 0) {
    if (id === 0x06) {
      r.num(); const n = r.num();
      let t;
      while ((t = r.num()) !== 0) { if (t === 0x09) for (let i = 0; i < n; i++) r.num(); else if (t === 0x0a) r.digests(n); else throw new Error('7z pack info'); }
    } else if (id === 0x07) {
      if (r.num() !== 0x0b) throw new Error('7z unpack info');
      const n = r.num(); if (r.byte() !== 0) throw new Error('7z external folders');
      folders = [];
      for (let i = 0; i < n; i++) {
        let totalIn = 0; let totalOut = 0;
        const coders = r.num();
        for (let c = 0; c < coders; c++) {
          const flag = r.byte(); r.skip(flag & 0x0f);
          if (flag & 0x10) { totalIn += r.num(); totalOut += r.num(); } else { totalIn++; totalOut++; }
          if (flag & 0x20) r.skip(r.num());
        }
        for (let b = 0; b < totalOut - 1; b++) { r.num(); r.num(); }
        const packed = totalIn - (totalOut - 1);
        if (packed > 1) for (let p = 0; p < packed; p++) r.num();
        folders.push({ totalOut, crc: false, sub: 1 });
      }
      if (r.num() !== 0x0c) throw new Error('7z unpack sizes');
      for (const f of folders) for (let o = 0; o < f.totalOut; o++) r.num();
      let t;
      while ((t = r.num()) !== 0) { if (t === 0x0a) r.digests(folders.length).forEach((d, i) => { folders[i].crc = d; }); else throw new Error('7z unpack info'); }
    } else if (id === 0x08) {
      let t;
      while ((t = r.num()) !== 0) {
        if (t === 0x0d) for (const f of folders) f.sub = r.num();
        else if (t === 0x09) for (const f of folders) for (let s = 1; s < f.sub; s++) r.num();
        else if (t === 0x0a) r.digests(folders.reduce((a, f) => a + (f.sub === 1 && f.crc ? 0 : f.sub), 0));
        else throw new Error('7z substreams info');
      }
    } else throw new Error('7z streams info');
  }
}

function writeNum(out, v) {
  if (v < 0x80) { out.push(v); return; }
  let i = 1; while (i < 8 && v >= 2 ** (7 * (i + 1))) i++;
  if (i >= 8) { out.push(0xff); for (let k = 0; k < 8; k++) out.push(Math.floor(v / 2 ** (8 * k)) & 0xff); return; }
  const high = Math.floor(v / 2 ** (8 * i));
  out.push(((0xff00 >> i) & 0xff) | high);
  for (let k = 0; k < i; k++) out.push(Math.floor(v / 2 ** (8 * k)) & 0xff);
}
function bitBytes(bits) { const out = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) if (bits[i + j]) b |= 0x80 >> j; out.push(b); } return out; }

function buildHeader(mainStreams, files) {
  const out = [0x01];
  const parts = [Buffer.from(out)];
  if (mainStreams) parts.push(mainStreams);
  const fi = [0x05];
  writeNum(fi, files.length);
  const empty = files.map((f) => !f._tmp);
  if (empty.some(Boolean)) {
    const eb = bitBytes(empty); fi.push(0x0e); writeNum(fi, eb.length); fi.push(...eb);
    const emptyFiles = files.filter((f) => !f._tmp).map((f) => !f.IsDirectory);
    if (emptyFiles.some(Boolean)) { const fb = bitBytes(emptyFiles); fi.push(0x0f); writeNum(fi, fb.length); fi.push(...fb); }
  }
  const names = Buffer.concat(files.map((f) => Buffer.from(`${f.IsDirectory ? f.Filename.replace(/\/$/, '') : f.Filename}\0`, 'utf16le')));
  fi.push(0x11); writeNum(fi, names.length + 1); fi.push(0x00);
  parts.push(Buffer.from(fi), names);
  const dirs = files.map((f) => f.IsDirectory);
  if (dirs.some(Boolean)) {
    // Attributes, so 7-Zip shows folders as folders (FILE_ATTRIBUTE_DIRECTORY / FILE_ATTRIBUTE_ARCHIVE).
    const at = Buffer.alloc(2 + 4 * files.length);
    at[0] = 1; at[1] = 0;
    files.forEach((f, i) => at.writeUInt32LE(f.IsDirectory ? 0x10 : 0x20, 2 + 4 * i));
    const h = [0x15]; writeNum(h, at.length);
    parts.push(Buffer.from(h), at);
  }
  parts.push(Buffer.from([0x00, 0x00]));
  return Buffer.concat(parts);
}

module.exports = { SevenZ, SevenZipWriter, configure, run7z, getDictionarySizeFromUncompressedSize, ZipCompression };
