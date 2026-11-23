// Ported from RomVault (RVWorld: RomVaultCore/FixFile/Utils/*.cs, FixFile/Report.cs) by Gordon J. Licensed under
// Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: async file IO;
// archives are written through the port's ZipWriter / SevenZipWriter; a 7z entry can't be raw-copied, so it
// is always decompressed and recompressed.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform, PassThrough } = require('node:stream');
const { FileType, GotStatus, DatStatus, RepStatus, FileStatus, TreeSelect, EFile, EFixLevel, HeaderFileType, ZipStructure,
  ZeroByteCRC, ZeroByteMD5, ZeroByteSHA1 } = require('../enums');
const { state } = require('../settings');
const { RvFile, DB, DBHelper, DBTypeGet, isFileOnly } = require('../rvdb');
const { ZipReturn, ZipReturnName, ZipCompression, crc32, hex8 } = require('../compress/common');
const { Zip, ZipWriter, StructuredArchive, fileMtime } = require('../compress/zip');
const { SevenZ, SevenZipWriter } = require('../compress/sevenZip');

const ReturnCode = {
  Good: 'Good', RescanNeeded: 'RescanNeeded', FindFixesMissingFileGroups: 'FindFixesMissingFileGroups', FindFixesInvalidStatus: 'FindFixesInvalidStatus',
  TreeStructureError: 'TreeStructureError', LogicError: 'LogicError', FileSystemError: 'FileSystemError', SourceDataStreamCorrupt: 'SourceDataStreamCorrupt',
  SourceCheckSumMismatch: 'SourceCheckSumMismatch', DestinationCheckSumMismatch: 'DestinationCheckSumMismatch', ToSortNotFound: 'ToSortNotFound',
  CannotMove: 'CannotMove', Cancel: 'Cancel',
};
const FixStyle = { Zero: 0, RawCopy: 1, RawCopyOnceVerified: 2, Compress: 3, DecompressRecompress: 4, ExtractToCache: 5 };

// ------------------------------------------------------------------------------------------------ Report
// thWrk: { text, progress, range, error(file, msg), fix?(row), fixError?(msg), cancelled }
const Report = {
  thWrk: null,
  set(t) { Report.thWrk = t; return t != null; },
  text(s) { Report.thWrk?.text(s); },
  fix(dir, archive, file, size, action, srcDir, srcArchive, srcFile) { Report.thWrk?.fix?.({ dir, archive, file, size, action, srcDir, srcArchive, srcFile }); },
  fixError(msg) { Report.thWrk?.fixError?.(msg); },
  error(file, msg) { Report.thWrk?.error(file, msg); },
  get cancelled() { return !!Report.thWrk?.cancelled; },
};
class LogicError extends Error {}

// ------------------------------------------------------------------------------------------------ small fs helpers
async function statOf(p) { try { return await fsp.stat(p); } catch { return null; } }
async function fileExists(p) { const s = await statOf(p); return !!s && s.isFile(); }
async function dirExists(p) { const s = await statOf(p); return !!s && s.isDirectory(); }
async function mtimeOf(p) { const s = await statOf(p); return s ? fileMtime(s) : null; }
async function setNormal(p) { try { await fsp.chmod(p, 0o666); return true; } catch { return false; } }

// ------------------------------------------------------------------------------------------------ archive writers
// One interface over ZipWriter and SevenZipWriter: addEntry, close() -> { zr, ZipStruct }, closeFailed().
async function createOutputArchive(fileType, filename, zipStruct, uncompressedSize) {
  if (fileType === FileType.Zip) {
    try { await fsp.mkdir(path.dirname(filename), { recursive: true }); } catch { /* reported below */ }
    let w;
    try { w = await ZipWriter.create(filename, zipStruct); } catch { return { zr: ZipReturn.ZipErrorOpeningFile }; }
    return { zr: ZipReturn.ZipGood, out: wrapZip(w) };
  }
  const r = await SevenZipWriter.create(filename, zipStruct, uncompressedSize);
  if (r.zr !== ZipReturn.ZipGood) return r;
  return { zr: ZipReturn.ZipGood, out: wrap7z(r.zip) };
}
function wrapZip(w) {
  return {
    kind: FileType.Zip, filename: w.filename, get ZipStruct() { return w.ZipStruct; }, get LocalFilesCount() { return w.files.length; },
    getFileHeader: (i) => w.files[i], addEntry: (o, d) => w.addEntry(o, d),
    async close() { const zs = await w.close(); return { zr: ZipReturn.ZipGood, ZipStruct: zs }; }, closeFailed: () => w.closeFailed(),
  };
}
function wrap7z(w) {
  return {
    kind: FileType.SevenZip, filename: w.filename, get ZipStruct() { return w.ZipStruct; }, get LocalFilesCount() { return w.files.length; },
    getFileHeader: (i) => w.files[i], addEntry: (o, d) => w.addEntry(o, d),
    close: () => w.close({ signal: Report.thWrk?.signal }), closeFailed: () => w.closeFailed(),
  };
}

// ------------------------------------------------------------------------------------------------ CopyFile
let localZipFileIn = null; // the source archive kept open between copies (RomVault's localZipFileIn)
async function closeLocalZip() { if (localZipFileIn) { await localZipFileIn.close(); localZipFileIn = null; } }

function checkInputAndOutputFile(fileIn, fileOut) {
  if (fileOut.fileStatusIs(FileStatus.SizeFromDAT) && fileOut.Size != null && fileIn.Size !== fileOut.Size) return 'Source and destination Size does not match. Logic Error.';
  if (fileOut.fileStatusIs(FileStatus.CRCFromDAT) && fileOut.CRC != null && fileIn.CRC !== fileOut.CRC) return 'Source and destination CRC does not match. Logic Error.';
  if (fileOut.fileStatusIs(FileStatus.SHA1FromDAT) && fileIn.fileStatusIs(FileStatus.SHA1Verified) && fileIn.SHA1 != null && fileOut.SHA1 != null && fileIn.SHA1 !== fileOut.SHA1) return 'Source and destination SHA1 does not match. Logic Error.';
  if (fileOut.fileStatusIs(FileStatus.MD5FromDAT) && fileIn.fileStatusIs(FileStatus.MD5Verified) && fileIn.MD5 != null && fileOut.MD5 != null && fileIn.MD5 !== fileOut.MD5) return 'Source and destination MD5 does not match. Logic Error.';
  return null;
}

async function openInputStream(fileIn, rawCopy) {
  if (fileIn.FileType === FileType.FileZip || fileIn.FileType === FileType.FileSevenZip) {
    const zIn = fileIn.Parent;
    if (zIn.FileType !== DBTypeGet.dirFromFile(fileIn.FileType)) return { rc: ReturnCode.LogicError, error: 'File Open but Source File is not correct type, Logic Error.' };
    const nameIn = zIn.FullNameCase;
    if (localZipFileIn && localZipFileIn.filename !== nameIn) await closeLocalZip();
    if (!localZipFileIn) {
      const r = zIn.FileType === FileType.SevenZip ? await SevenZ.open(nameIn, zIn.FileModTimeStamp, { signal: Report.thWrk?.signal }) : await Zip.open(nameIn, zIn.FileModTimeStamp);
      switch (r.zr) {
        case ZipReturn.ZipGood: break;
        case ZipReturn.ZipErrorFileNotFound: return { rc: ReturnCode.RescanNeeded, error: `File not found, Rescan required before fixing ${fileIn.Name}` };
        case ZipReturn.ZipErrorTimeStamp: return { rc: ReturnCode.RescanNeeded, error: `File has changed, Rescan required before fixing ${fileIn.Name}` };
        case ZipReturn.ZipFileLocked: return { rc: ReturnCode.FileSystemError, error: `Source file is locked by another app ${nameIn}` };
        default: return { rc: ReturnCode.FileSystemError, error: `Error Open Zip File ${nameIn} (${ZipReturnName[r.zr]})` };
      }
      localZipFileIn = r.zip;
    }
    const zf = localZipFileIn;
    const idx = fileIn.ZipFileIndex;
    const hdr = zf.getFileHeader(idx);
    if (!hdr || hdr.Filename !== fileIn.Name) return { rc: ReturnCode.RescanNeeded, error: `Error Opening Zip File ${nameIn}, Full scan this file.` };
    const s = zIn.FileType === FileType.SevenZip ? await zf.openReadStream(idx, false, { signal: Report.thWrk?.signal }) : zf.openReadStream(idx, rawCopy);
    if (s.zr !== ZipReturn.ZipGood) return { rc: zIn.FileType === FileType.SevenZip ? ReturnCode.LogicError : ReturnCode.RescanNeeded, error: `Error Opening Zip File ${nameIn}. (${ZipReturnName[s.zr]})` };
    return { rc: ReturnCode.Good, stream: s.stream, streamSize: hdr.UncompressedSize, method: zIn.FileType === FileType.SevenZip ? null : s.method ?? hdr.CompressionMethod, zipFileIn: zf };
  }
  const nameIn = fileIn.FullName;
  const st = await statOf(nameIn);
  if (!st || !st.isFile()) return { rc: ReturnCode.RescanNeeded, error: `Rescan needed, File Not Found :${nameIn}` };
  if (fileMtime(st) !== fileIn.FileModTimeStamp) return { rc: ReturnCode.RescanNeeded, error: `Rescan needed, File Changed :${nameIn}` };
  if (fileIn.Size == null) return { rc: ReturnCode.LogicError, error: `Null File Size found in Fixing File :${nameIn}` };
  if (st.size !== fileIn.Size) return { rc: ReturnCode.RescanNeeded, error: `Rescan needed, File Length Changed :${nameIn}` };
  return { rc: ReturnCode.Good, stream: fs.createReadStream(nameIn, { highWaterMark: 1 << 22 }), streamSize: fileIn.Size, method: ZipCompression.Stored };
}

// fileIn -> (zipFileOut | filenameOut). Returns { rc, error }.
async function copyFile(fileIn, zipFileOut, filenameOut, fileOut, fixStyle) {
  if (zipFileOut == null && filenameOut == null) throw new LogicError('Error in CopyFile: Both Outputs are null');
  if (zipFileOut != null && filenameOut != null) throw new LogicError('Error in CopyFile: Both Outputs are set');
  const isZero = DBHelper.isZeroLengthFile(fileOut);
  // The 7-Zip tool can't hand out or take compressed streams, so 7z entries are always recompressed.
  let rawCopy = fixStyle === FixStyle.RawCopy && fileIn.FileType === FileType.FileZip && (zipFileOut == null || zipFileOut.kind === FileType.Zip);
  let input = { stream: null, streamSize: 0, method: ZipCompression.Deflated };
  if (!isZero) {
    const err = checkInputAndOutputFile(fileIn, fileOut);
    if (err) return { rc: ReturnCode.LogicError, error: err };
    input = await openInputStream(fileIn, rawCopy);
    if (input.rc !== ReturnCode.Good) return { rc: input.rc, error: input.error };
  }
  // output compression method
  let outMethod = ZipCompression.Stored;
  if (zipFileOut) {
    if (zipFileOut.ZipStruct === ZipStructure.None) {
      if (fileOut.FileType !== FileType.FileZip) return { rc: ReturnCode.LogicError, error: 'Unstructured output must be a zip' };
      outMethod = rawCopy ? input.method : ZipCompression.Deflated;
    } else {
      outMethod = StructuredArchive.getCompressionType(zipFileOut.ZipStruct, fileOut.FileGroup?.Size ?? fileIn.Size ?? 0);
    }
  }
  if (rawCopy && input.method !== outMethod) {
    // RomVault returns a logic error here; this port falls back to recompressing.
    input.stream?.destroy();
    rawCopy = false;
    input = await openInputStream(fileIn, false);
    if (input.rc !== ReturnCode.Good) return { rc: input.rc, error: input.error };
  }
  const dateTimeOut = fileOut.FileModTimeStamp != null && fileOut.fileStatusIs(FileStatus.DateFromDAT) ? fileOut.FileModTimeStamp : fileIn.FileModTimeStamp;

  let bCRC; let bMD5 = null; let bSHA1 = null;
  const fullHash = state.rvSettings.FixLevel !== EFixLevel.Level1;
  let crc = 0; const md5 = !isZero && !rawCopy && fullHash ? crypto.createHash('md5') : null; const sha1 = !isZero && !rawCopy && fullHash ? crypto.createHash('sha1') : null;
  let seen = 0;
  const hashChunk = (chunk) => { crc = crc32(chunk, crc); md5?.update(chunk); sha1?.update(chunk); seen += chunk.length; };
  const empty = () => { const p = new PassThrough(); p.end(); return p; };

  if (zipFileOut) {
    if (fileIn.Size == null && !isZero) return { rc: ReturnCode.LogicError, error: `Null File Size found in Fixing File :${fileIn.FullName}` };
    const entry = { name: fileOut.Name, size: isZero ? 0 : fileIn.Size, method: outMethod, modTime: dateTimeOut };
    if (isZero) entry.source = empty();
    else if (rawCopy) { entry.raw = input.stream; entry.crc = fileIn.CRC; } else entry.source = input.stream;
    const r = await zipFileOut.addEntry(entry, rawCopy || isZero ? undefined : hashChunk);
    if (Report.cancelled) { await zipFileOut.closeFailed(); return { rc: ReturnCode.Cancel, error: '' }; }
    if (r.zr !== ZipReturn.ZipGood) {
      if (!isZero && !rawCopy && seen !== entry.size) {
        if (fileIn.FileType === FileType.FileZip || fileIn.FileType === FileType.FileSevenZip) await closeLocalZip();
        return { rc: ReturnCode.SourceDataStreamCorrupt, error: `Unexpected corrupt archive file found:\n${fileIn.FullName}\nRun Find Fixes, and Fix to continue fixing correctly.` };
      }
      return { rc: ReturnCode.FileSystemError, error: `Error writing to the archive (${ZipReturnName[r.zr]})` };
    }
    const n = zipFileOut.LocalFilesCount - 1;
    fileOut.ZipFileIndex = n;
    const h = zipFileOut.getFileHeader(n);
    fileOut.ZipFileHeaderPosition = h.LocalHead ?? null;
    fileOut.FileModTimeStamp = h.LastModified ?? null;
  } else {
    if (await fileExists(filenameOut) && fileOut.GotStatus !== GotStatus.Corrupt) { input.stream?.destroy(); return { rc: ReturnCode.RescanNeeded, error: `Rescan needed, File Changed :${filenameOut}` }; }
    try {
      await fsp.mkdir(path.dirname(filenameOut), { recursive: true });
      const src = isZero ? empty() : input.stream;
      await pipeline(src, new Transform({ transform(chunk, _e, cb) { if (Report.cancelled) { cb(new Error('Cancelled')); return; } hashChunk(chunk); cb(null, chunk); } }), fs.createWriteStream(filenameOut));
    } catch (e) {
      await fsp.rm(filenameOut, { force: true }).catch(() => {});
      if (Report.cancelled) return { rc: ReturnCode.Cancel, error: '' };
      if (fileIn.FileType === FileType.FileZip || fileIn.FileType === FileType.FileSevenZip) {
        await closeLocalZip();
        return { rc: ReturnCode.SourceDataStreamCorrupt, error: `Unexpected corrupt archive file found:\n${fileIn.FullName}\nRun Find Fixes, and Fix to continue fixing correctly.` };
      }
      return { rc: ReturnCode.FileSystemError, error: `Copy File: Error writing out file. ${e.message}` };
    }
    if (!isZero && seen !== input.streamSize) {
      await fsp.rm(filenameOut, { force: true }).catch(() => {});
      return { rc: ReturnCode.SourceDataStreamCorrupt, error: `Unexpected corrupt archive file found:\n${fileIn.FullName}\nRun Find Fixes, and Fix to continue fixing correctly.` };
    }
    fileOut.FileModTimeStamp = await mtimeOf(filenameOut);
  }

  if (isZero) { bCRC = ZeroByteCRC; bMD5 = ZeroByteMD5; bSHA1 = ZeroByteSHA1; } else if (!rawCopy) {
    bCRC = hex8(crc); bMD5 = md5 ? md5.digest('hex') : null; bSHA1 = sha1 ? sha1.digest('hex') : null;
  } else {
    bCRC = fileIn.CRC;
    if (fileIn.fileStatusIs(FileStatus.MD5Verified)) bMD5 = fileIn.MD5;
    if (fileIn.fileStatusIs(FileStatus.SHA1Verified)) bSHA1 = fileIn.SHA1;
  }
  if (!isZero && !rawCopy) {
    const v = validateFileIn(fileIn, bCRC, bSHA1, bMD5);
    if (v.rc !== ReturnCode.Good) return v;
  }
  return validateFileOut(fileIn, fileOut, rawCopy, bCRC, bSHA1, bMD5);
}

function validateFileIn(fileIn, bCRC, bSHA1, bMD5) {
  if (bCRC !== fileIn.CRC) { fileIn.GotStatus = GotStatus.Corrupt; return { rc: ReturnCode.SourceDataStreamCorrupt, error: 'Source CRC does not match Source Data stream, corrupt Zip' }; }
  fileIn.fileStatusSet(FileStatus.CRCVerified | FileStatus.SizeVerified);
  if (bMD5 != null) {
    if (fileIn.fileStatusIs(FileStatus.MD5FromDAT)) {
      if (fileIn.MD5 == null) return { rc: ReturnCode.LogicError, error: 'Should have an filein MD5 from Dat but not found. Logic Error.' };
      if (fileIn.MD5 !== bMD5) return { rc: ReturnCode.SourceCheckSumMismatch, error: 'Source file did not match MD5' };
      fileIn.fileStatusSet(FileStatus.MD5Verified);
    } else if (fileIn.MD5 != null) {
      if (fileIn.MD5 !== bMD5) return { rc: ReturnCode.LogicError, error: 'The MD5 found does not match a previously scanned MD5, this should not happen, unless something got corrupt.' };
    } else { fileIn.MD5 = bMD5; fileIn.fileStatusSet(FileStatus.MD5Verified); }
  }
  if (bSHA1 != null) {
    if (fileIn.fileStatusIs(FileStatus.SHA1FromDAT)) {
      if (fileIn.SHA1 == null) return { rc: ReturnCode.LogicError, error: 'Should have an filein SHA1 from Dat but not found. Logic Error.' };
      if (fileIn.SHA1 !== bSHA1) return { rc: ReturnCode.SourceCheckSumMismatch, error: 'Source file did not match SHA1' };
      fileIn.fileStatusSet(FileStatus.SHA1Verified);
    } else if (fileIn.SHA1 != null) {
      if (fileIn.SHA1 !== bSHA1) return { rc: ReturnCode.LogicError, error: 'The SHA1 found does not match a previously scanned SHA1, this should not happen, unless something got corrupt.' };
    } else { fileIn.SHA1 = bSHA1; fileIn.fileStatusSet(FileStatus.SHA1Verified); }
  }
  return { rc: ReturnCode.Good, error: '' };
}

function validateFileOut(fileIn, fileOut, rawCopy, bCRC, bSHA1, bMD5) {
  if (fileOut.FileType === FileType.FileZip || fileOut.FileType === FileType.FileSevenZip) fileOut.fileStatusSet(FileStatus.SizeFromHeader | FileStatus.CRCFromHeader);
  if (fileOut.fileStatusIs(FileStatus.CRCFromDAT) && fileOut.CRC != null && fileOut.CRC !== bCRC) return { rc: ReturnCode.DestinationCheckSumMismatch, error: 'CRC checksum error. Level 2 scan your files' };
  fileOut.CRC = bCRC;
  if (!rawCopy || fileIn.fileStatusIs(FileStatus.CRCVerified)) fileOut.fileStatusSet(FileStatus.CRCVerified);
  if (bSHA1 != null) {
    if (fileOut.fileStatusIs(FileStatus.SHA1FromDAT) && fileOut.SHA1 != null && fileOut.SHA1 !== bSHA1) return { rc: ReturnCode.DestinationCheckSumMismatch, error: 'SHA1 checksum error. Level 2 scan your files' };
    fileOut.SHA1 = bSHA1; fileOut.fileStatusSet(FileStatus.SHA1Verified);
  }
  if (bMD5 != null) {
    if (fileOut.fileStatusIs(FileStatus.MD5FromDAT) && fileOut.MD5 != null && fileOut.MD5 !== bMD5) return { rc: ReturnCode.DestinationCheckSumMismatch, error: 'MD5 checksum error. Level 2 scan your files' };
    fileOut.MD5 = bMD5; fileOut.fileStatusSet(FileStatus.MD5Verified);
  }
  if (fileIn.Size != null) { fileOut.Size = fileIn.Size; fileOut.fileStatusSet(FileStatus.SizeVerified); }
  fileOut.GotStatus = fileIn.GotStatus === GotStatus.Corrupt ? GotStatus.Corrupt : GotStatus.Got;
  fileOut.fileStatusSet(FileStatus.SizeVerified);
  if (fileOut.AltSize == null && fileIn.AltSize != null) fileOut.AltSize = fileIn.AltSize;
  if (fileOut.AltCRC == null && fileIn.AltCRC != null) fileOut.AltCRC = fileIn.AltCRC;
  if (fileOut.AltSHA1 == null && fileIn.AltSHA1 != null) fileOut.AltSHA1 = fileIn.AltSHA1;
  if (fileOut.AltMD5 == null && fileIn.AltMD5 != null) fileOut.AltMD5 = fileIn.AltMD5;
  if (fileOut.HeaderFileType === HeaderFileType.Nothing && fileIn.HeaderFileType !== HeaderFileType.Nothing) fileOut.HeaderFileTypeSet = fileIn.HeaderFileType;
  fileOut.CHDVersion = fileIn.CHDVersion;
  fileOut.fileStatusSet(FileStatus.HeaderFileTypeFromHeader | FileStatus.AltSizeFromHeader | FileStatus.AltSizeVerified |
    FileStatus.AltCRCFromHeader | FileStatus.AltCRCVerified | FileStatus.AltSHA1FromHeader | FileStatus.AltSHA1Verified |
    FileStatus.AltMD5FromHeader | FileStatus.AltMD5Verified, fileIn);
  return { rc: ReturnCode.Good, error: '' };
}

// ------------------------------------------------------------------------------------------------ MoveFile
function testFileMove(fileIn, fileOut) {
  if (fileIn == null) return false;
  if (fileIn.FileType !== FileType.File || fileOut.FileType !== FileType.File) return false;
  if (RvFile.treeType(fileIn) === TreeSelect.Locked) return false;
  return fileIn.RepStatus === RepStatus.NeededForFix || fileIn.RepStatus === RepStatus.MoveToSort || fileIn.RepStatus === RepStatus.Rename || fileIn.RepStatus === RepStatus.MoveToCorrupt;
}

async function moveFile(fileIn, fileOut, outFilename) {
  if (!testFileMove(fileIn, fileOut)) return { rc: ReturnCode.Good, moved: false, error: '' };
  const nameIn = fileIn.FullNameCase;
  const st = await statOf(nameIn);
  if (!st) return { rc: ReturnCode.RescanNeeded, moved: false, error: `Rescan needed, File Not Found :${nameIn}` };
  if (fileMtime(st) !== fileIn.FileModTimeStamp) return { rc: ReturnCode.RescanNeeded, moved: false, error: `Rescan needed, File Changed :${nameIn}` };
  const nameOut = outFilename ?? fileOut.FullName;
  try { await fsp.mkdir(path.dirname(nameOut), { recursive: true }); await fsp.rename(nameIn, nameOut); } catch { return { rc: ReturnCode.CannotMove, moved: false, error: `Could not move file :${nameIn}` }; }
  const bCRC = fileIn.CRC;
  const bMD5 = fileIn.fileStatusIs(FileStatus.MD5Verified) ? fileIn.MD5 : null;
  const bSHA1 = fileIn.fileStatusIs(FileStatus.SHA1Verified) ? fileIn.SHA1 : null;
  fileOut.FileModTimeStamp = await mtimeOf(nameOut);
  const v = validateFileOut(fileIn, fileOut, true, bCRC, bSHA1, bMD5);
  if (v.rc !== ReturnCode.Good) return { ...v, moved: false };
  await checkDeleteFile(fileIn);
  return { rc: ReturnCode.Good, moved: true, error: '' };
}

// ------------------------------------------------------------------------------------------------ directories
async function checkCreateDirectories(file) {
  if (file === DB.DirRoot) return;
  const dir = file.FullName;
  if (await dirExists(dir) && file.GotStatus === GotStatus.Got) return;
  await checkCreateDirectories(file.Parent);
  await fsp.mkdir(dir, { recursive: true });
  file.GotStatus = GotStatus.Got;
  file.FileModTimeStamp = await mtimeOf(dir);
}

async function checkDeleteFile(f) {
  if (f.RepStatus === RepStatus.Deleted) return;
  if (f.FileType === FileType.Dir) {
    if (f.GotStatus !== GotStatus.Got) return;
    if (f.DirStatus.hasAnyFiles() || f.DirStatus.hasFixable()) return;
    if (RvFile.treeType(f) === TreeSelect.Locked) return;
    if (f.Parent === DB.DirRoot) return;
    try { if (await dirExists(f.FullName)) await fsp.rmdir(f.FullName); } catch { /* not empty */ }
  }
  if (f.fileRemove() === EFile.Delete) {
    const parent = f.Parent;
    if (parent == null) throw new LogicError(`Item being deleted had no parent ${f.FullName}`);
    const { found, index } = parent.findChild(f);
    if (!found) throw new LogicError(`Could not find self in delete code ${parent.FullName}`);
    parent.childRemove(index);
    await checkDeleteFile(parent);
  }
}

function checkFilesUsedForFix(lstFixRomTable, fileProcessQueue, checkingAFile) {
  const parentCheckList = [];
  for (const fixRom of lstFixRomTable) {
    if (fixRom.RepStatus !== RepStatus.NeededForFix && (!checkingAFile || fixRom.RepStatus !== RepStatus.Rename)) continue;
    if (RvFile.treeType(fixRom) === TreeSelect.Locked) { fixRom.RepStatus = fixRom.IsInToSort ? RepStatus.InToSort : RepStatus.Unknown; continue; }
    if (fixRom.FileGroup.Files.some((g) => g.RepStatus === RepStatus.CanBeFixed)) continue;
    fixRom.RepStatus = RepStatus.Delete;
    switch (fixRom.FileType) {
      case FileType.File: if (fixRom.RepStatus === RepStatus.Delete && !fileProcessQueue.includes(fixRom)) fileProcessQueue.push(fixRom); break;
      case FileType.FileZip: case FileType.FileSevenZip: if (!parentCheckList.includes(fixRom.Parent)) parentCheckList.push(fixRom.Parent); break;
      default: Report.error(fixRom.FullName, 'Unknown repair fixRom type recheck.');
    }
  }
  for (const checkFile of parentCheckList) {
    if (fileProcessQueue.includes(checkFile)) continue;
    let hasDelete = false; let hasNeeded = false;
    for (let i = 0; i < checkFile.ChildCount; i++) {
      const f = checkFile.child(i);
      if (f.RepStatus === RepStatus.Delete) hasDelete = true;
      else if (f.RepStatus === RepStatus.NeededForFix || f.RepStatus === RepStatus.Rename) { hasNeeded = true; break; }
    }
    if (!hasDelete || hasNeeded) continue;
    fileProcessQueue.push(checkFile);
  }
}

// Returns { rc, outDir, filename }
async function createToSortDirs(inFile) {
  const dirTree = [];
  let r = inFile;
  while (r.Parent != null) { r = r.Parent; dirTree.unshift(r); }
  dirTree.shift();
  const toSort = isFileOnly(inFile) ? DB.getToSortFileOnly() : DB.getToSortPrimary();
  try { await fsp.mkdir(toSort.FullName, { recursive: true }); } catch { return { rc: ReturnCode.ToSortNotFound }; }
  dirTree[0] = toSort;
  for (let i = 1; i < dirTree.length; i++) {
    const baseDir = dirTree[i - 1];
    let tDir = new RvFile(FileType.Dir);
    tDir.Name = dirTree[i].Name; tDir.DatStatus = DatStatus.InToSort;
    const { res, index } = baseDir.childNameSearch(tDir);
    if (res === 0) tDir = baseDir.child(index); else baseDir.childAdd(tDir, index);
    await fsp.mkdir(tDir.FullName, { recursive: true });
    tDir.setDatGotStatus(DatStatus.InToSort, GotStatus.Got);
    tDir.FileModTimeStamp = await mtimeOf(tDir.FullName);
    dirTree[i] = tDir;
  }
  const outDir = dirTree[dirTree.length - 1];
  let filename = inFile.NameCase;
  let full = path.join(outDir.FullName, filename);
  let fileC = 0; let name = null; let ext = null;
  while (await statOf(full)) {
    if (name == null) { const p = inFile.Name.lastIndexOf('.'); if (p >= 0) { name = inFile.Name.substring(0, p); ext = inFile.Name.substring(p + 1); } else { name = inFile.Name; ext = ''; } }
    filename = `${name}_${fileC}.${ext}`;
    full = path.join(outDir.FullName, filename);
    fileC++;
  }
  return { rc: ReturnCode.Good, outDir, filename };
}

async function doubleCheckDelete(fileDeleting) {
  const ok = { rc: ReturnCode.Good, error: '' };
  if (!state.rvSettings.DoubleCheckDelete) return ok;
  if (fileDeleting.IsInToSort && path.extname(fileDeleting.Name).toLowerCase() === '.cue') return ok;
  if (DBHelper.isZeroLengthFile(fileDeleting)) return ok;
  const family = fileDeleting.FileGroup ? fileDeleting.FileGroup.Files : [];
  const lst = family.filter((f) => f.GotStatus === GotStatus.Got && DBHelper.checkIfMissingFileCanBeFixedByGotFile(fileDeleting, f));
  let fileToCheck = null;
  for (const f of lst) {
    if (f.RepStatus === RepStatus.Delete) continue;
    if ([RepStatus.Unknown, RepStatus.Correct, RepStatus.InToSort, RepStatus.Rename, RepStatus.NeededForFix, RepStatus.MoveToSort, RepStatus.Ignore].includes(f.RepStatus)) { fileToCheck = f; break; }
    throw new LogicError(`Unknown double check delete status ${f.RepStatus}`);
  }
  if (fileToCheck == null) return { rc: ReturnCode.LogicError, error: `Double Check Delete could not find the correct file. (${fileDeleting.FullName})` };
  const isArchived = fileToCheck.FileType === FileType.FileZip || fileToCheck.FileType === FileType.FileSevenZip;
  const checkOn = isArchived ? fileToCheck.Parent : fileToCheck;
  const p = checkOn.FullNameCase;
  const st = await statOf(p);
  if (!st || !st.isFile()) return { rc: ReturnCode.RescanNeeded, error: `Deleting ${fileDeleting.FullName} Correct file not found. Rescan for ${p}` };
  if (fileMtime(st) !== checkOn.FileModTimeStamp) return { rc: ReturnCode.RescanNeeded, error: `Deleting ${fileDeleting.FullName} Correct file timestamp not found. Rescan for ${fileToCheck.FullName}` };
  if (isArchived && fileToCheck.Parent === fileDeleting.Parent) return ok;
  const del = isArchived ? fileDeleting.Parent.FullNameCase : fileDeleting.FullNameCase;
  if (path.resolve(p) === path.resolve(del)) {
    const a = isArchived ? fileDeleting.Parent.TreeFullName : fileDeleting.TreeFullName;
    const b = isArchived ? fileToCheck.Parent.TreeFullName : fileToCheck.TreeFullName;
    return { rc: ReturnCode.TreeStructureError, error: `Delete Check found multiple tree paths to the same file.\nTree structure should be fixed:\n\n1st Path = ${a}\n\n2nd Path = ${b}` };
  }
  return ok;
}

function getSourceDir(fileIn) {
  const ts = fileIn.Parent.TreeFullName;
  if (fileIn.FileType === FileType.FileZip || fileIn.FileType === FileType.FileSevenZip) {
    const i = ts.lastIndexOf('\\');
    return { sourceDir: i >= 0 ? ts.substring(0, i) : '', sourceFile: i >= 0 ? ts.substring(i + 1) : ts };
  }
  return { sourceDir: ts, sourceFile: '' };
}

// Decompress7ZipFile.DecompressSource7ZipFile: extracts the useful files of a solid 7z into the ToSort cache, so
// later fixes can copy them one at a time. Returns { rc, error }.
async function decompressSource7ZipFile(db7z, includeGood, filesUsedForFix) {
  if (db7z.ChildCount === 1) return { rc: ReturnCode.Good, error: 'Single File' };
  const cacheDir = DB.getToSortCache();
  const r = await SevenZ.open(db7z.FullNameCase, db7z.FileModTimeStamp, { signal: Report.thWrk?.signal });
  if (r.zr !== ZipReturn.ZipGood) return { rc: ReturnCode.RescanNeeded, error: `Error opening 7zip file (${db7z.FullNameCase}) for caching ${ZipReturnName[r.zr]}` };
  const sz = r.zip;
  try {
    const outDir = new RvFile(FileType.Dir);
    outDir.Name = `${db7z.Name}.cache`; outDir.Parent = cacheDir; outDir.DatStatus = DatStatus.InToSort; outDir.GotStatus = GotStatus.Got;
    let n = 0;
    while (cacheDir.childNameSearch(outDir).res === 0) { n++; outDir.Name = `${db7z.Name}.cache (${n})`; }
    try { await fsp.mkdir(outDir.FullName, { recursive: true }); } catch (e) { return { rc: ReturnCode.FileSystemError, error: `Error creating directory (${outDir.FullName}) for caching: ${e.message}` }; }
    cacheDir.childAdd(outDir);
    for (let i = 0; i < sz.LocalFilesCount; i++) {
      const fh = sz.getFileHeader(i);
      if (fh.IsDirectory || fh.UncompressedSize === 0) continue;
      let thisFile = null;
      for (let j = 0; j < db7z.ChildCount; j++) if (db7z.child(j).ZipFileIndex === i) { thisFile = db7z.child(j); break; }
      if (thisFile == null) return { rc: ReturnCode.RescanNeeded, error: 'Error opening 7zip file for caching' };
      if (thisFile.FileGroup && thisFile.FileGroup.Files.some((f) => f.FileType === FileType.File && f.GotStatus === GotStatus.Got)) continue;
      let extract = includeGood && [RepStatus.Correct, RepStatus.InToSort, RepStatus.MoveToSort].includes(thisFile.RepStatus);
      if (thisFile.FileGroup && thisFile.FileGroup.Files.some((f) => f.RepStatus === RepStatus.CanBeFixed)) extract = true;
      if (!extract) continue;
      let cleaned = thisFile.Name.replace(/[/\\?]/g, '-');
      if (cleaned.length >= 248) { const ext = path.extname(cleaned); cleaned = path.basename(cleaned, ext).substring(0, 248 - ext.length) + ext; }
      const outFile = new RvFile(FileType.File);
      Object.assign(outFile, { Name: cleaned, Size: thisFile.Size, CRC: thisFile.CRC, SHA1: thisFile.SHA1, MD5: thisFile.MD5, AltSize: thisFile.AltSize, AltCRC: thisFile.AltCRC, AltSHA1: thisFile.AltSHA1, AltMD5: thisFile.AltMD5, FileGroup: thisFile.FileGroup });
      outFile.GotStatus = GotStatus.Got;
      outFile.HeaderFileTypeSet = thisFile.HeaderFileType;
      let tryname = 0;
      while (outDir.childNameSearch(outFile).res === 0) { tryname++; const ext = path.extname(cleaned); outFile.Name = `${path.basename(cleaned, ext)}_${tryname}${ext}`; }
      outFile.setDatGotStatus(DatStatus.InToSort, GotStatus.Got);
      outFile.fileStatusSet(FileStatus.HeaderFileTypeFromHeader | FileStatus.SizeFromHeader | FileStatus.SizeVerified | FileStatus.CRCFromHeader | FileStatus.CRCVerified |
        FileStatus.SHA1FromHeader | FileStatus.SHA1Verified | FileStatus.MD5FromHeader | FileStatus.MD5Verified | FileStatus.AltSizeFromHeader | FileStatus.AltSizeVerified |
        FileStatus.AltCRCFromHeader | FileStatus.AltCRCVerified | FileStatus.AltSHA1FromHeader | FileStatus.AltSHA1Verified | FileStatus.AltMD5FromHeader | FileStatus.AltMD5Verified, thisFile);
      outFile.RepStatus = RepStatus.NeededForFix;
      const out = path.join(outDir.FullName, outFile.Name);
      if (state.rvSettings.DetailedFixReporting) { const t = db7z.TreeFullName; Report.fix(path.dirname(t), path.basename(t), thisFile.Name, thisFile.Size, '-->', outDir.FullName, '', outFile.Name); }
      const s = await sz.openReadStream(i, false, { signal: Report.thWrk?.signal });
      if (s.zr !== ZipReturn.ZipGood) { thisFile.GotStatus = GotStatus.Corrupt; return { rc: ReturnCode.SourceDataStreamCorrupt, error: `Unexpected corrupt archive file found:\n${db7z.FullName}\nRun Find Fixes, and Fix to continue fixing correctly.` }; }
      let crc = 0; const full = state.rvSettings.FixLevel !== EFixLevel.Level1; const md5 = full ? crypto.createHash('md5') : null; const sha1 = full ? crypto.createHash('sha1') : null;
      try {
        await pipeline(s.stream, new Transform({ transform(c, _e, cb) { crc = crc32(c, crc); md5?.update(c); sha1?.update(c); cb(null, c); } }), fs.createWriteStream(out));
      } catch (e) { return { rc: ReturnCode.FileSystemError, error: `Decompress7Zip File: Error writing out file. ${e.message}` }; }
      outFile.FileModTimeStamp = await mtimeOf(out);
      if (thisFile.CRC != null && hex8(crc) !== thisFile.CRC) return { rc: ReturnCode.SourceCheckSumMismatch, error: 'Error found in cache extract CRC' };
      if (md5 && thisFile.MD5 != null && md5.digest('hex') !== thisFile.MD5) return { rc: ReturnCode.SourceCheckSumMismatch, error: 'Error found in cache extract MD5' };
      if (sha1 && thisFile.SHA1 != null && sha1.digest('hex') !== thisFile.SHA1) return { rc: ReturnCode.SourceCheckSumMismatch, error: 'Error found in cache extract SHA1' };
      thisFile.FileGroup.Files.push(outFile);
      outDir.childAdd(outFile);
      if (filesUsedForFix && !filesUsedForFix.has(outFile.TreeFullName)) filesUsedForFix.set(outFile.TreeFullName, outFile);
    }
    return { rc: ReturnCode.Good, error: '' };
  } finally { await sz.close(); }
}

module.exports = {
  ReturnCode, FixStyle, Report, LogicError, statOf, fileExists, dirExists, mtimeOf, setNormal, createOutputArchive, closeLocalZip, copyFile,
  testFileMove, moveFile, checkCreateDirectories, checkDeleteFile, checkFilesUsedForFix, createToSortDirs, doubleCheckDelete, getSourceDir,
  decompressSource7ZipFile,
};
