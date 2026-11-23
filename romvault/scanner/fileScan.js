// Ported from RomVault (RVWorld: FileScanner/ScannedFile.cs, FileScan.cs, FileHeaders.cs, Compress/File/File.cs,
// CHD/CHD.cs header reading) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk. Changes: hashing reads a Node stream instead of RomVault's
// double-buffered hashing threads; a CHD's header is read for its version and hashes, but its data is not
// deep-verified; SHA-256 is not computed.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { FileType, GotStatus, FileStatus, HeaderFileType, ZeroByteCRC, ZeroByteMD5, ZeroByteSHA1 } = require('../enums');
const { Sorters, listSearch } = require('../sorters');
const { ZipReturn, crc32, hex8 } = require('../compress/common');
const { Zip, fileMtime } = require('../compress/zip');
const { SevenZ } = require('../compress/sevenZip');

// ------------------------------------------------------------------------------------------------ ScannedFile
class ScannedFile {
  constructor(ft) {
    this.Name = null; this.FileModTimeStamp = null; this.FileType = ft; this.GotStatus = GotStatus.NotGot;
    this.ZipStruct = 0; this.Comment = null; this.LocalHeaderOffset = null; this.DeepScanned = false; this.StatusFlags = 0;
    this.Index = 0; this.HeaderFileType = HeaderFileType.Nothing;
    this.Size = null; this.CRC = null; this.SHA1 = null; this.MD5 = null;
    this.AltSize = null; this.AltCRC = null; this.AltSHA1 = null; this.AltMD5 = null; this.CHDVersion = null;
    this.SearchFound = false;
    if (this.IsDirectory) this._scannedFiles = [];
  }
  add(child) { this._scannedFiles.push(child); }
  addRange(list) { for (const c of list) this._scannedFiles.push(c); }
  get count() { return this._scannedFiles.length; }
  get Count() { return this._scannedFiles.length; }
  at(i) { return this._scannedFiles[i]; }
  fileStatusSet(flag) { this.StatusFlags |= flag; }
  get IsDirectory() { return this.FileType === FileType.Dir || this.FileType === FileType.Zip || this.FileType === FileType.SevenZip; }
  sort() {
    let cf;
    switch (this.FileType) {
      case FileType.SevenZip: cf = (a, b) => Sorters.Trrnt7ZipStringCompare(a.Name, b.Name); break;
      case FileType.Zip: cf = (a, b) => Sorters.TrrntZipStringCompareCase(a.Name, b.Name); break;
      case FileType.Dir: cf = (a, b) => Sorters.DirectoryNameCompareCase(a.Name, b.Name); break;
      default: throw new Error('Unknown Archive Type in SortArchive');
    }
    const files = this._scannedFiles; this._scannedFiles = [];
    for (const f of files) { const { index } = listSearch(this._scannedFiles, f, cf); this._scannedFiles.splice(index, 0, f); }
  }
}

// ------------------------------------------------------------------------------------------------ FileHeaderReader
const b = (...x) => Buffer.from(x);
const s = (str) => Buffer.from(str, 'latin1');
const Detectors = [
  [HeaderFileType.ZIP, 22, 0, 0, b(0x50, 0x4b, 0x03, 0x04)],
  [HeaderFileType.GZ, 18, 0, 0, b(0x1f, 0x8b, 0x08)],
  [HeaderFileType.SevenZip, 6, 0, 0, b(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)],
  [HeaderFileType.RAR, 6, 0, 0, b(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)],
  [HeaderFileType.CHD, 76, 0, 0, s('MComprHD')],
  [HeaderFileType.A7800, 128, 128, 1, s('ATARI7800')],
  [HeaderFileType.A7800, 128, 128, 100, s('ACTUAL CART DATA STARTS HERE')],
  ...[1, 2, 3, 4].map((n) => [HeaderFileType.FDS, 16, 16, 0, Buffer.concat([s('FDS\x1a'), b(n), Buffer.alloc(11)])]),
  [HeaderFileType.FDS, 16, 16, 0, s('FDS')],
  [HeaderFileType.Lynx, 64, 64, 0, s('LYNX')],
  [HeaderFileType.Lynx, 64, 64, 6, s('BS9')],
  [HeaderFileType.NES, 16, 16, 0, s('NES\x1a')],
  [HeaderFileType.PCE, 512, 512, 0, b(0x40, 0, 0, 0, 0, 0, 0, 0, 0xaa, 0xbb, 0x02)],
  [HeaderFileType.PSID, 118, 118, 0, b(0x50, 0x53, 0x49, 0x44, 0x00, 0x01, 0x00, 0x76)],
  [HeaderFileType.PSID, 118, 118, 0, b(0x50, 0x53, 0x49, 0x44, 0x00, 0x03, 0x00, 0x7c)],
  [HeaderFileType.PSID, 124, 124, 0, b(0x50, 0x53, 0x49, 0x44, 0x00, 0x02, 0x00, 0x7c)],
  [HeaderFileType.PSID, 124, 124, 0, b(0x50, 0x53, 0x49, 0x44, 0x00, 0x01, 0x00, 0x7c)],
  [HeaderFileType.PSID, 124, 124, 0, b(0x52, 0x53, 0x49, 0x44, 0x00, 0x02, 0x00, 0x7c)],
  [HeaderFileType.SNES, 512, 512, 22, b(0xaa, 0xbb, 0x04, 0, 0, 0, 0, 0)],
  [HeaderFileType.SNES, 512, 512, 22, s('SUPERUFO')],
  [HeaderFileType.SPC, 256, 256, 0, s('SNES-SPC')],
].map(([FType, HeaderLength, FileOffset, Offset, Value]) => ({ FType, HeaderLength, FileOffset, Offset, Value }));

const FileHeaderReader = {
  getFileHeaderLength(ft) { const d = Detectors.find((x) => x.FType === ft); return d ? d.FileOffset : 0; },
  altHeaderFile(fileType) {
    const h = fileType & HeaderFileType.HeaderMask;
    return h === HeaderFileType.A7800 || h === HeaderFileType.FDS || h === HeaderFileType.Lynx || h === HeaderFileType.NES ||
      h === HeaderFileType.PCE || h === HeaderFileType.PSID || h === HeaderFileType.SNES || h === HeaderFileType.SPC || h === HeaderFileType.CHD;
  },
  // buffer: the first bytes of the file; headerSize: how many of them were read.
  getType(buffer, headerSize) {
    for (const d of Detectors) {
      if (headerSize <= d.HeaderLength) continue;
      if (buffer.length < d.Value.length + d.Offset) continue;
      if (buffer.subarray(d.Offset, d.Offset + d.Value.length).equals(d.Value)) return { type: d.FType, offset: d.FileOffset };
    }
    return { type: HeaderFileType.Nothing, offset: 0 };
  },
};

// ------------------------------------------------------------------------------------------------ Compress.File
// A plain file seen as an archive holding one file, so it goes through the same scanning code.
class PlainFile {
  static async open(filename, timestamp = -1) {
    let st;
    try { st = await fsp.stat(filename); } catch { return { zr: ZipReturn.ZipErrorFileNotFound }; }
    if (!st.isFile()) return { zr: ZipReturn.ZipErrorFileNotFound };
    if (timestamp != null && timestamp !== -1 && fileMtime(st) !== timestamp) return { zr: ZipReturn.ZipErrorTimeStamp };
    try { const fh = await fsp.open(filename, 'r'); await fh.close(); } catch (e) {
      return { zr: e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' ? ZipReturn.ZipFileLocked : ZipReturn.ZipErrorOpeningFile };
    }
    const f = new PlainFile();
    f.filename = filename;
    f.files = [{ Filename: path.basename(filename), UncompressedSize: st.size, CRC: null, IsDirectory: false, LastModified: fileMtime(st), HeaderLastModified: fileMtime(st), LocalHead: null }];
    return { zr: ZipReturn.ZipGood, zip: f };
  }
  get LocalFilesCount() { return 1; }
  get ZipStruct() { return 0; }
  get FileComment() { return null; }
  getFileHeader() { return this.files[0]; }
  openReadStream() { return { zr: ZipReturn.ZipGood, stream: fs.createReadStream(this.filename, { highWaterMark: 1 << 22 }), size: this.files[0].UncompressedSize }; }
  async close() {}
}

// ------------------------------------------------------------------------------------------------ CHD header
// MAME's compressed disks: DATs list a disk by the SHA-1 (and for v3 the MD5) stored in its header.
async function readChdHeader(filename) {
  let fh;
  try { fh = await fsp.open(filename, 'r'); } catch { return { error: 'CHDERR_CANNOT_OPEN_FILE' }; }
  try {
    const buf = Buffer.alloc(124);
    const { bytesRead } = await fh.read(buf, 0, 124, 0);
    if (bytesRead < 16 || buf.toString('latin1', 0, 8) !== 'MComprHD') return { error: 'CHDERR_INVALID_FILE' };
    const version = buf.readUInt32BE(12);
    const at = { 3: { len: 120, sha1: 80, md5: 44, parent: 100 }, 4: { len: 108, sha1: 48, parent: 68 }, 5: { len: 124, sha1: 84, parent: 104 } }[version];
    if (!at) return { version, error: version < 3 ? 'CHDERR_REQUIRES_PARENT_OLD' : 'CHDERR_UNSUPPORTED_VERSION' };
    if (bytesRead < at.len) return { version, error: 'CHDERR_INVALID_FILE' };
    const nz = (h) => (/^0+$/.test(h) ? null : h);
    return { version, sha1: nz(buf.toString('hex', at.sha1, at.sha1 + 20)), md5: at.md5 != null ? nz(buf.toString('hex', at.md5, at.md5 + 16)) : null };
  } finally { await fh.close(); }
}

// ------------------------------------------------------------------------------------------------ FileScan
/*
 * DeepScan | Has a Header | size | crc | sha1 | md5 | altsize | altcrc | altsha1 | altmd5
 *     0    |       0      |  H   |  H  |      |     |         |        |         |
 *     0    |       1      |  H   |  H  |      |     |    V    |    V   |         |
 *     1    |       0      |  HV  |  HV |  V   |  V  |         |        |         |
 *     1    |       1      |  HV  |  HV |  V   |  V  |    V    |    V   |    V    |    V
 */
const FileScan = {
  // Returns { zr, scannedArchive }. progress(text) reports hashing progress on big archives.
  async scanArchiveFile(archiveType, filename, timeStamp, deepScan, { useDosDateTime = false, progress = null, signal } = {}) {
    let opened;
    switch (archiveType) {
      case FileType.Zip: opened = await Zip.open(filename, timeStamp); break;
      case FileType.SevenZip: opened = await SevenZ.open(filename, timeStamp, { signal }); break;
      default: deepScan = true; opened = await PlainFile.open(filename, timeStamp); break;
    }
    if (opened.zr !== ZipReturn.ZipGood) return { zr: opened.zr, scannedArchive: null };
    const file = opened.zip;
    const sa = new ScannedFile(archiveType);
    sa.Name = filename; sa.ZipStruct = file.ZipStruct; sa.Comment = file.FileComment;
    try {
      sa.addRange(await FileScan._scanFilesInArchive(file, archiveType, deepScan, useDosDateTime, progress, signal));
    } finally { await file.close(); }
    return { zr: ZipReturn.ZipGood, scannedArchive: sa };
  },

  async _scanFilesInArchive(file, archiveType, deepScan, useDosDateTime, progress, signal) {
    const scannedFileType = archiveType === FileType.Zip ? FileType.FileZip : archiveType === FileType.SevenZip ? FileType.FileSevenZip : FileType.File;
    const n = file.LocalFilesCount;
    let sizeTotal = 0; let sizeSoFar = 0;
    for (let i = 0; i < n; i++) sizeTotal += file.getFileHeader(i).UncompressedSize;
    if (sizeTotal < 400000000) sizeTotal = 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      out.push(await FileScan._scanAFileInAnArchive(file, i, scannedFileType, deepScan, useDosDateTime, progress, sizeTotal, sizeSoFar, signal));
      sizeSoFar += file.getFileHeader(i).UncompressedSize;
    }
    if (progress && sizeTotal !== 0) progress('');
    return out;
  },

  async _scanAFileInAnArchive(file, index, scannedFileType, deepScan, useDosDateTime, progress, sizeTotal, sizeSoFar, signal) {
    const lf = file.getFileHeader(index);
    const sf = new ScannedFile(scannedFileType);
    sf.Name = lf.Filename; sf.DeepScanned = deepScan; sf.Index = index; sf.LocalHeaderOffset = lf.LocalHead;
    sf.FileModTimeStamp = useDosDateTime ? lf.HeaderLastModified : lf.LastModified;
    if (lf.IsDirectory) {
      sf.HeaderFileType = HeaderFileType.Nothing; sf.GotStatus = GotStatus.Got; sf.Size = 0;
      sf.CRC = ZeroByteCRC; sf.SHA1 = ZeroByteSHA1; sf.MD5 = ZeroByteMD5;
      sf.StatusFlags |= FileStatus.CRCFromHeader | FileStatus.SizeVerified | FileStatus.CRCVerified | FileStatus.SHA1Verified | FileStatus.MD5Verified | FileStatus.SHA256Verified;
      return sf;
    }
    const r = await file.openReadStream(index, false, { signal });
    sf.Size = r.size ?? lf.UncompressedSize;
    sf.StatusFlags |= FileStatus.SizeFromHeader;
    if (r.zr !== ZipReturn.ZipGood) { sf.GotStatus = GotStatus.Corrupt; return sf; }
    const res = await FileScan.checkSumRead(r.stream, sf, lf.UncompressedSize, deepScan, progress, sizeTotal, sizeSoFar, signal);
    if (res !== 0) {
      sf.GotStatus = GotStatus.Corrupt;
      if (sf.CRC == null) { sf.CRC = lf.CRC; sf.StatusFlags |= FileStatus.CRCFromHeader; }
      return sf;
    }
    if (!deepScan) { sf.CRC = lf.CRC; sf.StatusFlags |= FileStatus.CRCFromHeader; }
    if (lf.CRC == null) { sf.StatusFlags |= FileStatus.SizeVerified; sf.GotStatus = GotStatus.Got; } else if (lf.CRC === sf.CRC) {
      sf.StatusFlags |= FileStatus.SizeVerified | FileStatus.CRCFromHeader; sf.GotStatus = GotStatus.Got;
    } else sf.GotStatus = GotStatus.Corrupt;
    return sf;
  },

  // Hashes a stream into scannedFile. Returns 0, or 0x17 when reading failed.
  async checkSumRead(stream, sf, totalSize, fullScan, progress, sizeTotal = 0, sizeSoFar = 0, signal) {
    sf.MD5 = null; sf.SHA1 = null; sf.CRC = null;
    const it = stream[Symbol.asyncIterator]();
    let crc = null; let md5 = null; let sha1 = null; let acrc = null; let amd5 = null; let asha1 = null;
    let headerSize = 0; let pos = 0;
    const feed = (buf) => {
      if (crc != null) crc = crc32(buf, crc);
      md5?.update(buf); sha1?.update(buf);
      if (acrc != null && pos + buf.length > headerSize) {
        const part = pos >= headerSize ? buf : buf.subarray(headerSize - pos);
        acrc = crc32(part, acrc); amd5?.update(part); asha1?.update(part);
      }
      pos += buf.length;
    };
    try {
      const want = Math.min(512, totalSize);
      let first = Buffer.alloc(0);
      while (first.length < want) { const { value, done } = await it.next(); if (done) break; first = first.length ? Buffer.concat([first, value]) : value; }
      const rest = first.length > want ? first.subarray(want) : null;
      if (rest) first = first.subarray(0, want);
      const { type, offset } = FileHeaderReader.getType(first, first.length);
      sf.HeaderFileType = type;
      if (type === HeaderFileType.Nothing || offset === 0) {
        if (!fullScan) { stream.destroy(); return 0; }
        crc = 0; md5 = crypto.createHash('md5'); sha1 = crypto.createHash('sha1');
      } else {
        sf.StatusFlags |= FileStatus.HeaderFileTypeFromHeader;
        sf.AltSize = totalSize - offset;
        sf.StatusFlags |= FileStatus.AltSizeFromHeader | FileStatus.AltSizeVerified;
        headerSize = offset; acrc = 0;
        if (fullScan) { crc = 0; md5 = crypto.createHash('md5'); sha1 = crypto.createHash('sha1'); amd5 = crypto.createHash('md5'); asha1 = crypto.createHash('sha1'); }
      }
      feed(first);
      if (rest) feed(rest);
      const doReporting = progress && sizeTotal > 0;
      let reported = -1;
      for (;;) {
        if (signal?.aborted) throw new Error('Cancelled');
        const { value, done } = await it.next();
        if (done) break;
        feed(value);
        if (doReporting) {
          const p = Math.floor(((sizeSoFar + pos) * 100) / sizeTotal);
          if (p > reported) { progress(`Hashing: ${p}%`); reported = p; }
        }
      }
      if (pos !== totalSize) return 0x17;
    } catch (e) {
      stream.destroy();
      if (signal?.aborted) throw e;
      return 0x17;
    }
    if (crc != null) { sf.StatusFlags |= FileStatus.CRCVerified; sf.CRC = hex8(crc); }
    if (md5) { sf.StatusFlags |= FileStatus.MD5Verified; sf.MD5 = md5.digest('hex'); }
    if (sha1) { sf.StatusFlags |= FileStatus.SHA1Verified; sf.SHA1 = sha1.digest('hex'); }
    if (acrc != null) { sf.StatusFlags |= FileStatus.AltCRCVerified; sf.AltCRC = hex8(acrc); }
    if (amd5) { sf.StatusFlags |= FileStatus.AltMD5Verified; sf.AltMD5 = amd5.digest('hex'); }
    if (asha1) { sf.StatusFlags |= FileStatus.AltSHA1Verified; sf.AltSHA1 = asha1.digest('hex'); }
    return 0;
  },
};

module.exports = { ScannedFile, FileHeaderReader, FileScan, PlainFile, readChdHeader };
