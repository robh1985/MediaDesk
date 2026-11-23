// Ported from RomVault (RVWorld: Compress/ZipFile/*.cs, Compress/StructuredZip/StructuredZip.cs,
// StructuredArchive.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk. Changes: async file IO; Node's zlib does the deflate and
// zstd work; the rarely seen legacy methods (shrink, reduce, implode, deflate64, bzip2, LZMA, PPMd) are
// reported as unsupported instead of being decoded.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');
const { Readable, PassThrough } = require('node:stream');
const { ZipStructure, ZipStructureName } = require('../enums');
const { Sorters } = require('../sorters');
const { ZipReturn, ZipCompression, hasZstd, crc32, hex8, CodePage437, combineDosDateTime, dosFromTicks } = require('./common');

const LocalFileStatus = { Nothing: 0, HeadersMismatch: 0x4, FilenameMisMatch: 0x10, DirectoryLengthError: 0x20, DateTimeMisMatch: 0x40 };
const TrrntzipDosDateTime = 563657728;
const TrrntzipDateTime = 629870671200000000; // .NET ticks for 1996-12-24 23:32 (only meaningful as a marker)

const zipDateType = { Undefined: 0, None: 1, TrrntZip: 2, DateTime: 3 };
const StructuredArchive = {
  getCompressionType(zs, size) {
    switch (zs) {
      case ZipStructure.None: return ZipCompression.Stored;
      case ZipStructure.ZipTrrnt: case ZipStructure.ZipTDC: case ZipStructure.ZipDTD: return ZipCompression.Deflated;
      case ZipStructure.ZipZSTD: case ZipStructure.ZipDTZ: return size === 0 ? ZipCompression.Stored : ZipCompression.ZStandard;
      case ZipStructure.SevenZipSLZMA: case ZipStructure.SevenZipNLZMA: return ZipCompression.LZMA;
      case ZipStructure.SevenZipSZSTD: case ZipStructure.SevenZipNZSTD: return ZipCompression.ZStandard;
      default: return 0xffff;
    }
  },
  isSolid(zs) { return !(zs === ZipStructure.SevenZipNLZMA || zs === ZipStructure.SevenZipNZSTD); },
  getZipCommentId(zs) {
    switch (zs) {
      case ZipStructure.ZipTrrnt: return 'TORRENTZIPPED-';
      case ZipStructure.ZipTDC: return 'TDC-';
      case ZipStructure.ZipZSTD: return 'RVZSTD-';
      case ZipStructure.ZipDTD: return 'DTD-';
      case ZipStructure.ZipDTZ: return 'DTZ-';
      default: return '';
    }
  },
  getZipStructureName(zs) {
    return ({ 0: 'Unstructured', 1: 'TrrntZip', 2: 'TDC-Zip', 3: 'DTD-Zip', 4: 'T7Z', 5: 'ZSTD-Zip', 6: 'DTZ-Zip', 8: '7Z-Solid-LZMA', 9: '7Z-NonSolid-LZMA', 10: '7Z-Solid-zSTD', 11: '7Z-NonSolid-zSTD' })[zs] || 'Undefined';
  },
  getZipDateTimeType(zs) {
    switch (zs) {
      case ZipStructure.ZipTrrnt: return zipDateType.TrrntZip;
      case ZipStructure.ZipTDC: case ZipStructure.ZipDTD: case ZipStructure.ZipDTZ: return zipDateType.DateTime;
      case ZipStructure.ZipZSTD: return zipDateType.None;
      default: return zipDateType.Undefined;
    }
  },
};
function isTzipDate(t) { return t <= 0xffffffff ? t === TrrntzipDosDateTime : t === TrrntzipDateTime; }

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return bytesRead === len ? b : b.subarray(0, bytesRead);
}

function fileMtime(st) { return Math.floor(st.mtimeMs); }

function parseExtra(lf, extra, centralDir) {
  lf.IsZip64 = false;
  lf.ModifiedTime = null;
  let p = 0;
  while (p <= extra.length - 4) {
    const type = extra.readUInt16LE(p); const len = extra.readUInt16LE(p + 2);
    let q = p + 4;
    if (type === 0x0001) {
      lf.IsZip64 = true;
      if (lf.UncompressedSize === 0xffffffff && q + 8 <= extra.length) { lf.UncompressedSize = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (lf.CompressedSize === 0xffffffff && q + 8 <= extra.length) { lf.CompressedSize = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (centralDir && lf.RelativeOffsetOfLocalHeader === 0xffffffff && q + 8 <= extra.length) { lf.RelativeOffsetOfLocalHeader = Number(extra.readBigUInt64LE(q)); q += 8; }
    } else if (type === 0x000a) {
      lf.ExtraDataFound = true;
      q += 4;
      if (q + 4 <= extra.length) {
        const tag1 = extra.readUInt16LE(q); const size1 = extra.readUInt16LE(q + 2); q += 4;
        if (tag1 === 1 && size1 === 24 && q + 8 <= extra.length) {
          const ntfs = extra.readBigUInt64LE(q);
          lf.ModifiedTime = Math.floor(Number(ntfs / 10000n) - 11644473600000);
        }
      }
    } else if (type === 0x5455) {
      lf.ExtraDataFound = true;
      if (q < extra.length && (extra[q] & 1) && q + 5 <= extra.length) lf.ModifiedTime = extra.readInt32LE(q + 1) * 1000;
    } else {
      lf.ExtraDataFound = true;
    }
    p += 4 + len;
  }
}

class ZipFileData {
  constructor() {
    this.Filename = ''; this.UncompressedSize = 0; this.CompressedSize = 0; this.CRC = null; this.IsDirectory = false;
    this.HeaderLastModified = 0; this.ModifiedTime = null; this.GeneralPurposeBitFlag = 0; this.CompressionMethod = 0;
    this.RelativeOffsetOfLocalHeader = 0; this.DataLocation = 0; this.IsZip64 = false; this.ExtraDataFound = false; this._status = 0;
  }
  get LastModified() { return this.ModifiedTime ?? this.HeaderLastModified; }
  get LocalHead() { return (this.GeneralPurposeBitFlag & 8) === 0 ? this.RelativeOffsetOfLocalHeader : null; }
  setStatus(s) { this._status |= s; }
  getStatus(s) { return (this._status & s) !== 0; }
}

const SUPPORTED = new Set([ZipCompression.Stored, ZipCompression.Deflated, ...(hasZstd ? [ZipCompression.ZStandard, ZipCompression.ZStandardDeprecated] : [])]);

// ------------------------------------------------------------------------------------------------ reading
class Zip {
  constructor() { this.files = []; this.FileComment = ''; this.ZipStruct = ZipStructure.None; this.HeaderZipStruct = ZipStructure.None; this.offset = 0; this.fh = null; this.filename = null; }
  get LocalFilesCount() { return this.files.length; }
  getFileHeader(i) { return this.files[i]; }

  // timestamp: the file's expected time stamp, or -1 / null to skip the check.
  static async open(filename, timestamp = -1) {
    const z = new Zip();
    z.filename = filename;
    let st;
    try { st = await fsp.stat(filename); } catch { return { zr: ZipReturn.ZipErrorFileNotFound }; }
    if (timestamp != null && timestamp !== -1 && fileMtime(st) !== timestamp) return { zr: ZipReturn.ZipErrorTimeStamp };
    try { z.fh = await fsp.open(filename, 'r'); } catch (e) {
      return { zr: e.code === 'EBUSY' || e.code === 'EPERM' ? ZipReturn.ZipFileLocked : ZipReturn.ZipErrorOpeningFile };
    }
    z.size = st.size;
    let zr;
    try { zr = await z._readHeaders(); } catch { zr = ZipReturn.ZipErrorReadingFile; }
    if (zr !== ZipReturn.ZipGood) { await z.close(); return { zr }; }
    try { await z._validateStructure(); } catch { z.ZipStruct = ZipStructure.None; }
    if (z.ExtraDataFoundOnEndOfFile || z.offset !== 0) z.ZipStruct = ZipStructure.None;
    return { zr: ZipReturn.ZipGood, zip: z };
  }

  async close() { if (this.fh) { try { await this.fh.close(); } catch { /* ignore */ } this.fh = null; } }

  async _readHeaders() {
    const fileSize = this.size;
    const maxBack = Math.min(0xffff + 22, fileSize);
    const tail = await readAt(this.fh, fileSize - maxBack, maxBack);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    if (eocd < 0) return ZipReturn.ZipCentralDirError;
    let endOfCentralDir = fileSize - maxBack + eocd;
    const e = tail.subarray(eocd);
    if (e.readUInt16LE(4) !== 0 || e.readUInt16LE(6) !== 0) return ZipReturn.ZipEndOfCentralDirectoryError;
    let count = e.readUInt16LE(8);
    if (e.readUInt16LE(10) !== count) return ZipReturn.ZipEndOfCentralDirectoryError;
    let cdSize = e.readUInt32LE(12);
    let cdStart = e.readUInt32LE(16);
    const commentLen = e.readUInt16LE(20);
    this._fileComment = e.subarray(22, 22 + commentLen);
    this.FileComment = this._fileComment.toString('latin1');
    this.ExtraDataFoundOnEndOfFile = endOfCentralDir + 22 + commentLen !== fileSize;
    const zip64Required = cdStart === 0xffffffff || cdSize === 0xffffffff || count === 0xffff;
    this.zip64 = false;
    if (endOfCentralDir >= 20) {
      const loc = await readAt(this.fh, endOfCentralDir - 20, 20);
      if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50 && loc.readUInt32LE(4) === 0 && loc.readUInt32LE(16) <= 1) {
        const at = Number(loc.readBigUInt64LE(8));
        const z = await readAt(this.fh, at, 56);
        if (z.length === 56 && z.readUInt32LE(0) === 0x06064b50 && Number(z.readBigUInt64LE(4)) === 44 && z.readUInt16LE(14) === 45 && z.readUInt32LE(16) === 0 && z.readUInt32LE(20) === 0) {
          const n = Number(z.readBigUInt64LE(24));
          if (Number(z.readBigUInt64LE(32)) !== n) return ZipReturn.Zip64EndOfCentralDirError;
          count = n; cdSize = Number(z.readBigUInt64LE(40)); cdStart = Number(z.readBigUInt64LE(48));
          this.zip64 = true; endOfCentralDir = at;
        }
      }
    }
    if (zip64Required && !this.zip64) return ZipReturn.Zip64EndOfCentralDirError;
    this.offset = endOfCentralDir - cdSize - cdStart;
    cdStart += this.offset;
    if (cdStart < 0) return ZipReturn.ZipCentralDirError;
    this._centralDirStart = cdStart; this._centralDirSize = cdSize;
    const cd = await readAt(this.fh, cdStart, cdSize);
    if (cd.length !== cdSize) return ZipReturn.ZipCentralDirError;
    this._cd = cd;
    const central = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) return ZipReturn.ZipCentralDirError;
      const f = new ZipFileData();
      f.GeneralPurposeBitFlag = cd.readUInt16LE(p + 8);
      f.CompressionMethod = cd.readUInt16LE(p + 10);
      f.HeaderLastModified = combineDosDateTime(cd.readUInt16LE(p + 14), cd.readUInt16LE(p + 12));
      f.CRC = hex8(cd.readUInt32LE(p + 16));
      f.CompressedSize = cd.readUInt32LE(p + 20);
      f.UncompressedSize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28); const xl = cd.readUInt16LE(p + 30); const cl = cd.readUInt16LE(p + 32);
      f.RelativeOffsetOfLocalHeader = cd.readUInt32LE(p + 42);
      const nb = cd.subarray(p + 46, p + 46 + nl);
      f.Filename = (f.GeneralPurposeBitFlag & (1 << 11)) === 0 ? CodePage437.getString(nb) : nb.toString('utf8');
      if (xl > 0) parseExtra(f, cd.subarray(p + 46 + nl, p + 46 + nl + xl), true);
      f.RelativeOffsetOfLocalHeader += this.offset;
      p += 46 + nl + xl + cl;
      if (f.Filename.length > 0) { const c = f.Filename[f.Filename.length - 1]; f.IsDirectory = c === '/' || c === '\\'; }
      central.push(f);
    }
    for (const c of central) {
      const lh = await readAt(this.fh, c.RelativeOffsetOfLocalHeader, 30);
      if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) return ZipReturn.ZipLocalFileHeaderError;
      const l = new ZipFileData();
      l.GeneralPurposeBitFlag = lh.readUInt16LE(6);
      l.CompressionMethod = lh.readUInt16LE(8);
      l.HeaderLastModified = combineDosDateTime(lh.readUInt16LE(12), lh.readUInt16LE(10));
      l.CRC = hex8(lh.readUInt32LE(14));
      l.CompressedSize = lh.readUInt32LE(18);
      l.UncompressedSize = lh.readUInt32LE(22);
      const nl = lh.readUInt16LE(26); const xl = lh.readUInt16LE(28);
      const rest = await readAt(this.fh, c.RelativeOffsetOfLocalHeader + 30, nl + xl);
      const nb = rest.subarray(0, nl);
      l.Filename = (l.GeneralPurposeBitFlag & (1 << 11)) === 0 ? CodePage437.getString(nb) : nb.toString('utf8');
      if (xl > 0) parseExtra(l, rest.subarray(nl, nl + xl), false);
      l.DataLocation = c.RelativeOffsetOfLocalHeader + 30 + nl + xl;
      if ((l.GeneralPurposeBitFlag & 8) === 8) { l.CRC = c.CRC; l.CompressedSize = c.CompressedSize; l.UncompressedSize = c.UncompressedSize; }
      // ValidateFileHeaders
      if (c.CompressionMethod !== l.CompressionMethod) return ZipReturn.ZipLocalFileHeaderError;
      if (c.CRC !== l.CRC) return ZipReturn.ZipLocalFileHeaderError;
      if (c.CompressedSize !== l.CompressedSize) return ZipReturn.ZipLocalFileHeaderError;
      if (c.UncompressedSize !== l.UncompressedSize) return ZipReturn.ZipLocalFileHeaderError;
      if (c.GeneralPurposeBitFlag !== l.GeneralPurposeBitFlag) c.setStatus(LocalFileStatus.HeadersMismatch);
      if (c.HeaderLastModified !== l.HeaderLastModified) c.setStatus(LocalFileStatus.DateTimeMisMatch);
      if (c.Filename.replace(/\\/g, '/').toLowerCase() !== l.Filename.replace(/\\/g, '/').toLowerCase()) c.setStatus(LocalFileStatus.FilenameMisMatch);
      if (c.IsDirectory && c.UncompressedSize !== 0) c.setStatus(LocalFileStatus.DirectoryLengthError);
      if (l.ExtraDataFound) c.ExtraDataFound = true;
      if (![0, 1, 2, 3, 4, 5, 6, 8, 9, 12, 14, 20, 93, 98].includes(c.CompressionMethod)) return ZipReturn.ZipUnsupportedCompression;
      c.DataLocation = l.DataLocation;
    }
    this.files = central;
    return ZipReturn.ZipGood;
  }

  _getCRC() { return hex8(crc32(this._cd)).toUpperCase(); }

  async _validateStructure() {
    const comment = this.FileComment;
    const zcrc = this._getCRC();
    for (const val of Object.values(ZipStructure)) {
      const id = StructuredArchive.getZipCommentId(val);
      if (!id) continue;
      if (comment.length !== id.length + 8 || comment.substring(0, id.length) !== id || comment.substring(id.length) !== zcrc) continue;
      this.HeaderZipStruct = val;
      if (await this._validateFilesStructure(val)) this.ZipStruct = val;
      return;
    }
  }

  async _validateFilesStructure(zs) {
    const n = this.files.length;
    for (let i = 0; i < n; i++) {
      const f = this.files[i];
      if (f.getStatus(LocalFileStatus.HeadersMismatch | LocalFileStatus.FilenameMisMatch | LocalFileStatus.DirectoryLengthError | LocalFileStatus.DateTimeMisMatch)) return false;
      if (f.ExtraDataFound) return false;
      if (f.CompressionMethod !== StructuredArchive.getCompressionType(zs, f.UncompressedSize)) return false;
      if (f.Filename.includes('\\')) return false;
      if (CodePage437.isCodePage437(f.Filename) !== ((f.GeneralPurposeBitFlag & (1 << 11)) === 0)) return false;
      const dt = StructuredArchive.getZipDateTimeType(zs);
      if (dt === zipDateType.None) { if (f.LastModified !== 0) return false; } else if (dt === zipDateType.TrrntZip) { if (!isTzipDate(f.LastModified)) return false; } else if (dt !== zipDateType.DateTime) return false;
    }
    for (let i = 0; i < n - 1; i++) if (Sorters.TrrntZipStringCompare(this.files[i].Filename, this.files[i + 1].Filename) >= 0) return false;
    if (zs === ZipStructure.ZipTrrnt || zs === ZipStructure.ZipZSTD) {
      for (let i = 0; i < n - 1; i++) {
        const f0 = this.files[i].Filename;
        if (f0.length > 0 && !f0.endsWith('/')) continue;
        const f1 = this.files[i + 1].Filename;
        if (f1.length <= f0.length) continue;
        if (Sorters.TrrntZipStringCompare(f0, f1.substring(0, f0.length)) !== 0) continue;
        return false;
      }
    }
    if (zs === ZipStructure.ZipZSTD) {
      for (const f of this.files) {
        if (f.UncompressedSize === 0) { if (f.CompressedSize !== 0) return false; continue; }
        if (f.CompressedSize < 3) return false;
        const end = await readAt(this.fh, f.DataLocation + f.CompressedSize - 3, 3);
        if (end[0] !== 0x01 || end[1] !== 0 || end[2] !== 0) return false;
      }
    } else if (zs === ZipStructure.ZipTrrnt || zs === ZipStructure.ZipTDC) {
      for (const f of this.files) {
        if (f.UncompressedSize !== 0) continue;
        if (f.CompressedSize !== 2) return false;
        const z = await readAt(this.fh, f.DataLocation, 2);
        if (z[0] !== 0x03 || z[1] !== 0x00) return false;
      }
    }
    return true;
  }

  // A readable stream of entry i. raw = the stored bytes without decompressing them.
  openReadStream(i, raw = false) {
    const f = this.files[i];
    if (f.GeneralPurposeBitFlag & 1) return { zr: ZipReturn.ZipErrorGettingDataStream };
    const size = raw ? f.CompressedSize : f.UncompressedSize;
    if (f.CompressedSize === 0) { const pt = new PassThrough(); pt.end(); return { zr: ZipReturn.ZipGood, stream: pt, size: 0, method: f.CompressionMethod }; }
    const src = fs.createReadStream(null, { fd: this.fh.fd, autoClose: false, start: f.DataLocation, end: f.DataLocation + f.CompressedSize - 1, highWaterMark: 1 << 20 });
    if (raw || f.CompressionMethod === ZipCompression.Stored) return { zr: ZipReturn.ZipGood, stream: src, size, method: f.CompressionMethod };
    let dec;
    if (f.CompressionMethod === ZipCompression.Deflated) dec = zlib.createInflateRaw();
    else if ((f.CompressionMethod === ZipCompression.ZStandard || f.CompressionMethod === ZipCompression.ZStandardDeprecated) && hasZstd) dec = zlib.createZstdDecompress();
    else { src.destroy(); return { zr: ZipReturn.ZipUnsupportedCompression }; }
    src.on('error', (e) => dec.destroy(e));
    return { zr: ZipReturn.ZipGood, stream: src.pipe(dec), size, method: f.CompressionMethod };
  }
}

// ------------------------------------------------------------------------------------------------ writing
class ZipWriter {
  constructor() { this.files = []; this.pos = 0; this.ZipStruct = ZipStructure.None; }

  static async create(filename, zipStruct) {
    const w = new ZipWriter();
    w.filename = filename; w.ZipStruct = zipStruct;
    w.fh = await fsp.open(filename, 'w');
    return w;
  }

  async _write(buf, pos = this.pos) {
    let off = 0;
    while (off < buf.length) { const { bytesWritten } = await this.fh.write(buf, off, buf.length - off, pos + off); off += bytesWritten; }
    if (pos === this.pos) this.pos += buf.length;
  }

  // Check the name against the structure's rules (StructuredZip.ZipFileOpenWriteStream).
  checkAdd(filename, uncompressedSize, method) {
    const zs = this.ZipStruct;
    if (zs === ZipStructure.ZipTrrnt || zs === ZipStructure.ZipTDC || zs === ZipStructure.ZipDTD || zs === ZipStructure.ZipZSTD || zs === ZipStructure.ZipDTZ) {
      if (method !== StructuredArchive.getCompressionType(zs, uncompressedSize)) return ZipReturn.ZipTrrntzipIncorrectCompressionUsed;
      if (filename.includes('\\')) return ZipReturn.ZipTrrntZipIncorrectDirectorySeparator;
      const n = this.files.length;
      if (n > 0) {
        const last = this.files[n - 1].Filename;
        if (Sorters.TrrntZipStringCompareCase(last, filename) > 0) return ZipReturn.ZipTrrntzipIncorrectFileOrder;
        if ((zs === ZipStructure.ZipTrrnt || zs === ZipStructure.ZipZSTD) && this.files[n - 1].IsDirectory && filename.length > last.length &&
          Sorters.TrrntZipStringCompareCase(last, filename.substring(0, last.length)) === 0) return ZipReturn.ZipTrrntzipIncorrectDirectoryAddedToZip;
      }
    }
    return ZipReturn.ZipGood;
  }

  // Add an entry. opts: { name, size (uncompressed), method, modTime, source: Readable of uncompressed bytes }
  // or a raw copy: { name, size, method, modTime, raw: Readable of already-compressed bytes, crc }.
  // Returns { zr, crc, compressedSize }. onData sees the uncompressed bytes (for hashing).
  async addEntry(opts, onData) {
    const { name, size } = opts;
    let method = opts.method;
    const zr0 = this.checkAdd(name, size, method);
    if (zr0 !== ZipReturn.ZipGood) return { zr: zr0 };
    let modTime = opts.modTime ?? 0;
    if (this.ZipStruct === ZipStructure.ZipTrrnt) modTime = TrrntzipDosDateTime;
    else if (this.ZipStruct === ZipStructure.ZipZSTD) modTime = 0;
    const f = new ZipFileData();
    f.Filename = name; f.UncompressedSize = size; f.CompressionMethod = method; f.HeaderLastModified = modTime;
    f.GeneralPurposeBitFlag = method === ZipCompression.Deflated ? 2 : 0;
    f.IsDirectory = name.endsWith('/');
    let nameBuf = CodePage437.getBytes(name);
    if (!nameBuf) { f.GeneralPurposeBitFlag |= 1 << 11; nameBuf = Buffer.from(name, 'utf8'); }
    f.RelativeOffsetOfLocalHeader = this.pos;
    const zip64 = size >= 0xffffffff;
    f.IsZip64 = zip64;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(method === ZipCompression.ZStandard ? 63 : zip64 ? 45 : 20, 4);
    lh.writeUInt16LE(f.GeneralPurposeBitFlag, 6);
    lh.writeUInt16LE(method, 8);
    const { date, time } = dosFromTicks(modTime);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(0xffffffff, 14); lh.writeUInt32LE(0xffffffff, 18); lh.writeUInt32LE(0xffffffff, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    lh.writeUInt16LE(extra.length, 28);
    await this._write(Buffer.concat([lh, nameBuf, extra]));
    const dataStart = this.pos;
    let crc = 0;
    let written = 0;
    try {
      if (opts.raw) {
        for await (const chunk of opts.raw) { await this._write(chunk); }
        crc = parseInt(opts.crc, 16) >>> 0;
      } else {
        let enc = null;
        if (method === ZipCompression.Deflated) enc = zlib.createDeflateRaw({ level: 9, memLevel: 8, windowBits: 15 });
        else if (method === ZipCompression.ZStandard) enc = zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } });
        const src = opts.source;
        if (enc) {
          const pump = (async () => {
            for await (const chunk of src) {
              crc = crc32(chunk, crc); written += chunk.length; onData?.(chunk);
              if (!enc.write(chunk)) await new Promise((r) => enc.once('drain', r));
            }
            enc.end();
          })();
          pump.catch((e) => enc.destroy(e));
          for await (const out of enc) await this._write(out);
          await pump;
        } else {
          for await (const chunk of src) { crc = crc32(chunk, crc); written += chunk.length; onData?.(chunk); await this._write(chunk); }
        }
        if (written !== size) return { zr: ZipReturn.ZipErrorWritingToOutputStream };
      }
    } catch {
      return { zr: ZipReturn.ZipErrorWritingToOutputStream };
    }
    let compressed = this.pos - dataStart;
    if (compressed === 0 && size === 0 && method === ZipCompression.Deflated) { await this._write(Buffer.from([3, 0])); compressed = 2; }
    else if (compressed === 0 && size !== 0) return { zr: ZipReturn.ZipErrorWritingToOutputStream };
    f.CompressedSize = compressed;
    f.CRC = hex8(crc);
    const fix = Buffer.alloc(12);
    fix.writeUInt32LE(crc >>> 0, 0);
    fix.writeUInt32LE(zip64 ? 0xffffffff : compressed, 4);
    fix.writeUInt32LE(zip64 ? 0xffffffff : size, 8);
    await this._write(fix, f.RelativeOffsetOfLocalHeader + 14);
    if (zip64) {
      const x = Buffer.alloc(20);
      x.writeUInt16LE(1, 0); x.writeUInt16LE(16, 2); x.writeBigUInt64LE(BigInt(size), 4); x.writeBigUInt64LE(BigInt(compressed), 12);
      await this._write(x, f.RelativeOffsetOfLocalHeader + 30 + nameBuf.length);
    }
    f._nameBuf = nameBuf;
    this.files.push(f);
    return { zr: ZipReturn.ZipGood, crc: f.CRC, compressedSize: compressed };
  }

  _validateFileHeader() {
    for (const f of this.files) {
      if (f.CompressionMethod !== StructuredArchive.getCompressionType(this.ZipStruct, f.UncompressedSize)) return false;
      if (f.Filename.includes('\\')) return false;
    }
    return true;
  }

  async close() {
    const cdStart = this.pos;
    const parts = [];
    for (const f of this.files) {
      const ex = [];
      let hu = f.UncompressedSize; let hc = f.CompressedSize; let ho = f.RelativeOffsetOfLocalHeader;
      if (hu >= 0xffffffff) { ex.push(u64(hu)); hu = 0xffffffff; }
      if (hc >= 0xffffffff) { ex.push(u64(hc)); hc = 0xffffffff; }
      if (ho >= 0xffffffff) { ex.push(u64(ho)); ho = 0xffffffff; }
      let extra = Buffer.alloc(0);
      if (ex.length) { const body = Buffer.concat(ex); extra = Buffer.alloc(4 + body.length); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(body.length, 2); body.copy(extra, 4); f.IsZip64 = true; }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(0, 4);
      h.writeUInt16LE(f.CompressionMethod === ZipCompression.ZStandard ? 63 : f.IsZip64 ? 45 : 20, 6);
      h.writeUInt16LE(f.GeneralPurposeBitFlag, 8);
      h.writeUInt16LE(f.CompressionMethod, 10);
      const { date, time } = dosFromTicks(f.HeaderLastModified);
      h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14);
      h.writeUInt32LE(parseInt(f.CRC, 16) >>> 0, 16);
      h.writeUInt32LE(hc, 20); h.writeUInt32LE(hu, 24);
      h.writeUInt16LE(f._nameBuf.length, 28); h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(ho, 42);
      parts.push(h, f._nameBuf, extra);
    }
    const cd = Buffer.concat(parts);
    await this._write(cd);
    const cdSize = cd.length;
    const crc = hex8(crc32(cd)).toUpperCase();
    let comment = '';
    if (this._validateFileHeader()) { const id = StructuredArchive.getZipCommentId(this.ZipStruct); if (id) comment = id + crc; } else this.ZipStruct = ZipStructure.None;
    const count = this.files.length;
    const zip64 = this.files.some((f) => f.IsZip64) || count >= 0xffff || cdStart >= 0xffffffff || cdSize >= 0xffffffff;
    if (zip64) {
      const eocd64At = this.pos;
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(count), 24); z.writeBigUInt64LE(BigInt(count), 32); z.writeBigUInt64LE(BigInt(cdSize), 40); z.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(eocd64At), 8); loc.writeUInt32LE(1, 16);
      await this._write(Buffer.concat([z, loc]));
    }
    const cb = Buffer.from(comment, 'latin1');
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(Math.min(count, 0xffff), 8); e.writeUInt16LE(Math.min(count, 0xffff), 10);
    e.writeUInt32LE(Math.min(cdSize, 0xffffffff), 12); e.writeUInt32LE(Math.min(cdStart, 0xffffffff), 16);
    e.writeUInt16LE(cb.length, 20);
    await this._write(Buffer.concat([e, cb]));
    await this.fh.truncate(this.pos);
    await this.fh.close();
    this.fh = null;
    return this.ZipStruct;
  }

  async closeFailed() {
    try { if (this.fh) await this.fh.close(); } catch { /* ignore */ }
    this.fh = null;
    try { await fsp.unlink(this.filename); } catch { /* ignore */ }
  }
}
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }

module.exports = { Zip, ZipWriter, ZipFileData, StructuredArchive, LocalFileStatus, TrrntzipDosDateTime, isTzipDate, fileMtime };
