// Ported from RomVault (RVWorld: RomVaultCore/FixFile/FixAZip.cs, FixAZipMove.cs, FixAZipFunctions.cs,
// FixAZipCore/FixAZipCanBeFixed.cs, FixAZipToSort.cs, FixAZipMoveToCorrupt.cs) by Gordon J. Licensed under
// Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: async file IO;
// a zip moved to ToSort\Corrupt keeps the same name in the database as on disk.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { FileType, DatStatus, GotStatus, RepStatus, FileStatus, TreeSelect, EFile, ZipStructure, ZipStructureName } = require('../enums');
const { state } = require('../settings');
const { RvFile, DB, DBHelper, DBTypeGet } = require('../rvdb');
const { ScannedFile, FileHeaderReader } = require('../scanner/fileScan');
const { ZipReturn, ZipReturnName } = require('../compress/common');
const { fileMtime } = require('../compress/zip');
const U = require('./utils');
const { getFixFileList, findSourceToUseForFix } = require('./findSourceFile');
const { caseRename, corruptDirNode } = require('./fixAFile');

const { ReturnCode, FixStyle, Report } = U;
class ZipFileException extends Error { constructor(rc, msg) { super(msg); this.returnCode = rc; } }

// ------------------------------------------------------------------------------------------------ FixAZipFunctions
async function openOutputZip(fixZip, uncompressedSize, filename) {
  if (await U.statOf(filename)) return { rc: ReturnCode.RescanNeeded, error: `Rescan needed, Unkown existing file found :${filename}` };
  let zs = (fixZip.DatStatus === DatStatus.NotInDat || fixZip.DatStatus === DatStatus.InToSort) ? fixZip.ZipStruct : fixZip.ZipDatStruct;
  if ((zs === ZipStructure.None && fixZip.FileType === FileType.SevenZip) || zs === ZipStructure.SevenZipTrrnt) zs = state.rvSettings.default7ZStruct;
  const r = await U.createOutputArchive(fixZip.FileType, filename, zs, uncompressedSize);
  if (r.zr !== ZipReturn.ZipGood) return { rc: ReturnCode.FileSystemError, error: `Error Opening Write Stream ${ZipReturnName[r.zr]}` };
  return { rc: ReturnCode.Good, out: r.out, error: '' };
}
function getUncompressedSize(z) {
  let n = 0;
  for (let i = 0; i < z.ChildCount; i++) { const c = z.child(i); if ([RepStatus.InToSort, RepStatus.Correct, RepStatus.CanBeFixed, RepStatus.CorruptCanBeFixed].includes(c.RepStatus)) n += c.FileGroup?.Size ?? 0; }
  return n;
}
function getMoveToSortUncompressedSize(z) {
  let n = 0;
  for (let i = 0; i < z.ChildCount; i++) { const c = z.child(i); if (c.RepStatus === RepStatus.MoveToSort) n += c.FileGroup?.Size ?? 0; }
  return n;
}
async function uniqueCorruptName(corruptDir, name) {
  let full = path.join(corruptDir, name); let n = name; let c = 0;
  const ext = path.extname(name); const base = path.basename(name, ext);
  while (await U.statOf(full)) { c++; n = base + c + ext; full = path.join(corruptDir, n); }
  return { full, name: n };
}
async function moveZipToCorrupt(fixZip) {
  const full = fixZip.FullName;
  const st = await U.statOf(full);
  if (!st) return { rc: ReturnCode.RescanNeeded, error: `File for move to corrupt not found ${fixZip.FullName}` };
  if (fileMtime(st) !== fixZip.FileModTimeStamp) return { rc: ReturnCode.RescanNeeded, error: `File for move to corrupt timestamp not correct ${fixZip.FullName}` };
  const corruptDir = path.join(DB.getToSortPrimary().FullName, 'Corrupt');
  await fsp.mkdir(corruptDir, { recursive: true });
  const dirNode = corruptDirNode();
  const t = await uniqueCorruptName(corruptDir, fixZip.Name);
  await U.setNormal(full);
  await fsp.rename(full, t.full);
  const g = new RvFile(FileType.Zip);
  g.Name = t.name; g.DatStatus = DatStatus.InToSort; g.FileModTimeStamp = await U.mtimeOf(t.full); g.GotStatus = GotStatus.Corrupt;
  dirNode.childAdd(g);
  await U.checkDeleteFile(fixZip);
  return { rc: ReturnCode.Good, error: '' };
}

// ------------------------------------------------------------------------------------------------ FixAZipMove
function checkFileMoveMatch(fixFile, usingFile) {
  if (fixFile.Name !== usingFile.Name) return false;
  if (fixFile.Size != null && fixFile.Size !== usingFile.Size) return false;
  if (FileHeaderReader.altHeaderFile(usingFile.HeaderFileType)) return false;
  if (!usingFile.fileStatusIs(FileStatus.CRCVerified) || !usingFile.fileStatusIs(FileStatus.SHA1Verified) || !usingFile.fileStatusIs(FileStatus.MD5Verified)) return false;
  if (fixFile.CRC != null && fixFile.CRC !== usingFile.CRC) return false;
  if (fixFile.MD5 != null && fixFile.MD5 !== usingFile.MD5) return false;
  if (fixFile.SHA1 != null && fixFile.SHA1 !== usingFile.SHA1) return false;
  return true;
}

// A whole archive elsewhere that already is exactly this set: move it into place.
async function checkFileMove(fixZip, filesUsedForFix, counter) {
  const cancel = { rc: ReturnCode.Cancel, error: '' };
  if (fixZip.FileType !== FileType.Zip && fixZip.FileType !== FileType.SevenZip) return cancel;
  const need = fixZip.ZipDatStruct;
  if (![ZipStructure.ZipTrrnt, ZipStructure.ZipZSTD, ZipStructure.ZipTDC, ZipStructure.SevenZipSLZMA, ZipStructure.SevenZipNLZMA, ZipStructure.SevenZipSZSTD, ZipStructure.SevenZipNZSTD].includes(need)) return cancel;
  let totalToFix = 0; let totalToMove = 0; let idx = -1;
  for (let i = 0; i < fixZip.ChildCount; i++) {
    const f = fixZip.child(i);
    if (f.RepStatus === RepStatus.CanBeFixed || f.RepStatus === RepStatus.CorruptCanBeFixed) { totalToFix++; totalToMove++; if (f.Size !== 0 && idx === -1) idx = i; continue; }
    if (f.RepStatus === RepStatus.Correct) { totalToMove++; continue; }
    if (f.RepStatus === RepStatus.Missing || f.RepStatus === RepStatus.NotCollected) continue;
    return cancel;
  }
  if (idx === -1) return cancel;
  const sources = [];
  for (const f of getFixFileList(fixZip.child(idx))) {
    if (RvFile.treeType(f) === TreeSelect.Locked) continue;
    const p = f.Parent;
    if (p == null || p.FileType !== fixZip.FileType || p.ZipStruct !== need) continue;
    if (!sources.includes(p)) sources.push(p);
  }
  if (!sources.length) return cancel;
  let src = null;
  for (const s of sources) {
    if (s.ChildCount !== totalToMove) continue;
    let ok = true; let si = 0;
    for (let i = 0; i < fixZip.ChildCount; i++) {
      const f = fixZip.child(i);
      if (f.RepStatus === RepStatus.Missing || f.RepStatus === RepStatus.NotCollected) continue;
      const u = s.child(si);
      if ((u.RepStatus !== RepStatus.NeededForFix && u.RepStatus !== RepStatus.Delete) || !checkFileMoveMatch(f, u)) { ok = false; break; }
      si++;
    }
    if (ok) { src = s; break; }
  }
  if (!src) return cancel;
  const dest = fixZip.FullName; const t = fixZip.TreeFullName; const st = src.TreeFullName;
  try {
    Report.fix(treeDir(t), treeBase(t), '', src.Size, fixZip.FileType === FileType.Zip ? '<--ZipMove' : '<--7ZMove', treeDir(st), treeBase(st), '');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (await U.statOf(dest)) {
      const tmp = path.join(path.dirname(dest), `__RomVault.${Date.now()}.tmp`);
      await fsp.rm(tmp, { force: true });
      await fsp.rename(src.FullNameCase, tmp);
      await fsp.rm(dest, { force: true });
      await fsp.rename(tmp, dest);
    } else await fsp.rename(src.FullNameCase, dest);
    fixZip.FileModTimeStamp = await U.mtimeOf(dest);
  } catch (e) { return { rc: ReturnCode.FileSystemError, error: `Error reading Source File ${e.message}` }; }
  let si = 0;
  for (let i = 0; i < fixZip.ChildCount; i++) {
    const f = fixZip.child(i);
    if (f.RepStatus === RepStatus.Missing || f.RepStatus === RepStatus.NotCollected) continue;
    f.fileMergeIn(src.child(si), false);
    if (src.child(si).fileRemove() === EFile.Delete) { src.childRemove(si); continue; }
    si++;
  }
  for (let i = 0; i < fixZip.ChildCount; i++) {
    const c = fixZip.child(i);
    if (c.Size === 0 || c.RepStatus === RepStatus.Missing || c.RepStatus === RepStatus.NotCollected) continue;
    for (const ff of getFixFileList(c)) if (!filesUsedForFix.has(ff.TreeFullName)) filesUsedForFix.set(ff.TreeFullName, ff);
  }
  fixZip.GotStatus = GotStatus.Got;
  fixZip.ZipStruct = src.ZipStruct;
  await U.checkDeleteFile(src);
  counter.totalFixed += totalToFix;
  return { rc: ReturnCode.Good, error: '' };
}

// The whole archive is going to ToSort: move it in one go.
async function checkFileMoveToSort(fixZip) {
  const cancel = { rc: ReturnCode.Cancel, error: '' };
  if (fixZip.FileType !== FileType.Zip && fixZip.FileType !== FileType.SevenZip) return cancel;
  for (let i = 0; i < fixZip.ChildCount; i++) {
    const rs = fixZip.child(i).RepStatus;
    if (rs !== RepStatus.MoveToSort && rs !== RepStatus.Missing && rs !== RepStatus.NotCollected) return cancel;
  }
  const t = await U.createToSortDirs(fixZip);
  if (t.rc !== ReturnCode.Good) return { rc: t.rc, error: 'Error Creating ToSortDirs' };
  const tree = fixZip.TreeFullName;
  const dest = path.join(t.outDir.FullName, t.filename);
  Report.fix(treeDir(tree), treeBase(tree), '', null, fixZip.FileType === FileType.Zip ? 'ZipMove-->' : '7ZMove-->', t.outDir.TreeFullName, t.filename, '');
  let mod;
  try { await fsp.rename(fixZip.FullNameCase, dest); mod = await U.mtimeOf(dest); } catch (e) { return { rc: ReturnCode.FileSystemError, error: `Error reading Source File ${e.message}` }; }
  const moving = fixZip.fileOut(ScannedFile);
  const g = new RvFile(fixZip.FileType);
  g.Name = t.filename; g.DatStatus = DatStatus.InToSort; g.GotStatus = GotStatus.Got; g.ZipStruct = fixZip.ZipStruct; g.FileModTimeStamp = mod;
  t.outDir.childAdd(g);
  g.mergeInArchive(moving);
  fixZip.markAsMissing();
  await U.checkDeleteFile(fixZip);
  return { rc: ReturnCode.Good, error: '' };
}

const treeDir = (t) => { const i = t.lastIndexOf('\\'); return i >= 0 ? t.substring(0, i) : ''; };
const treeBase = (t) => { const i = t.lastIndexOf('\\'); return i >= 0 ? t.substring(i + 1) : t; };

// ------------------------------------------------------------------------------------------------ FixAZipCanBeFixed
async function canBeFixed(copyOriginal, fixZip, fixZippedFile, ctx, iRom, filesUsedForFix, counter) {
  if (ctx.tempFixZip == null) {
    let tmpName = path.join(fixZip.Parent.FullName, '__RomVault.tmp');
    let o = await openOutputZip(fixZip, getUncompressedSize(fixZip), tmpName);
    if (o.rc !== ReturnCode.Good) {
      tmpName = path.join(fixZip.Parent.FullName, `__RomVault.${Date.now()}.tmp`);
      o = await openOutputZip(fixZip, getUncompressedSize(fixZip), tmpName);
      if (o.rc !== ReturnCode.Good) return o;
    }
    ctx.tempFixZip = o.out;
  }
  let lst = null;
  const isZero = DBHelper.isZeroLengthFile(fixZippedFile);
  if (!isZero) {
    lst = getFixFileList(fixZippedFile);
    if (lst.length === 0) { fixZippedFile.GotStatus = GotStatus.NotGot; return { rc: ReturnCode.Good, error: '' }; }
  }
  let source; let fixStyle;
  if (isZero) { source = new RvFile(FileType.File); source.Size = 0; fixStyle = FixStyle.Zero; } else if (copyOriginal && fixZip.FileType === FileType.Zip && fixZip.newZipStruct === ZipStructure.None) {
    source = fixZip.child(iRom); fixStyle = FixStyle.RawCopy;
  } else {
    let found = findSourceToUseForFix(fixZip, fixZippedFile, lst);
    fixStyle = found.fixStyle;
    source = copyOriginal && found.files.includes(fixZip.child(iRom)) ? fixZip.child(iRom) : found.files[0];
    if (fixStyle === FixStyle.ExtractToCache) {
      const d = await U.decompressSource7ZipFile(source.Parent, copyOriginal, filesUsedForFix);
      if (d.rc !== ReturnCode.Good) return d;
      lst = getFixFileList(fixZippedFile);
      found = findSourceToUseForFix(fixZip, fixZippedFile, lst);
      fixStyle = found.fixStyle;
      source = found.files[0];
      if (fixStyle === FixStyle.ExtractToCache) fixStyle = FixStyle.DecompressRecompress; // a 7z that couldn't be cached is read directly
    }
  }
  if (!isZero && (!copyOriginal || state.rvSettings.DetailedFixReporting)) {
    const t = fixZip.TreeFullName; const s = U.getSourceDir(source); const m = copyOriginal ? '<' : '';
    Report.fix(treeDir(t), treeBase(t), fixZippedFile.Name, fixZippedFile.Size, fixStyle === FixStyle.RawCopy ? `${m}<--Raw` : `<${m}--Compress`, s.sourceDir, s.sourceFile, source.Name);
  }
  if (!copyOriginal) fixZippedFile.fileTestFix(source);
  const originalStatus = fixZippedFile.RepStatus;
  const r = await U.copyFile(source, ctx.tempFixZip, null, fixZippedFile, fixStyle);
  switch (r.rc) {
    case ReturnCode.Good: if (copyOriginal && originalStatus === RepStatus.NeededForFix) fixZippedFile.RepStatus = RepStatus.NeededForFix; break;
    case ReturnCode.RescanNeeded: return r;
    case ReturnCode.SourceDataStreamCorrupt: Report.fixError('CRC Error'); source.GotStatus = GotStatus.Corrupt; return r;
    case ReturnCode.SourceCheckSumMismatch: Report.fixError('Fix file CRC was not as expected'); return r;
    case ReturnCode.DestinationCheckSumMismatch: Report.fixError('Destination file CRC was not as expected'); return r;
    case ReturnCode.FileSystemError: Report.fixError(`Source File Error ${r.error}`); return r;
    case ReturnCode.Cancel: return r;
    default: throw new ZipFileException(r.rc, `${fixZippedFile.FullName} ${fixZippedFile.RepStatus} ${r.rc}\n${r.error}`);
  }
  if (lst) for (const f of lst) if (!filesUsedForFix.has(f.TreeFullName)) filesUsedForFix.set(f.TreeFullName, f);
  if (!copyOriginal) counter.totalFixed++;
  return { rc: ReturnCode.Good, error: '' };
}

// ------------------------------------------------------------------------------------------------ FixAZipToSort
async function moveToSort(fixZip, fixZippedFile, ctx, iRom, filesUsedForFix) {
  let toSortFullName;
  if (ctx.toSortGame == null) {
    const t = await U.createToSortDirs(fixZip);
    if (t.rc !== ReturnCode.Good) return { rc: t.rc, error: 'Error Creating ToSortDirs' };
    let zs = fixZip.ZipStruct;
    if ((fixZip.ZipStruct === ZipStructure.None && fixZip.FileType === FileType.SevenZip) || zs === ZipStructure.SevenZipTrrnt) zs = state.rvSettings.default7ZStruct;
    const g = new RvFile(fixZip.FileType);
    ctx.toSortGameParent = t.outDir; g.Name = t.filename; g.DatStatus = DatStatus.InToSort; g.GotStatus = GotStatus.Got; g.ZipStruct = zs;
    ctx.toSortGame = g;
    toSortFullName = path.join(t.outDir.FullName, g.Name);
  } else toSortFullName = ctx.toSortZipOut.filename;
  const rom = new RvFile(fixZippedFile.FileType);
  fixZippedFile.copyTo(rom);
  rom.Dat = null;
  rom.setDatGotStatus(DatStatus.InToSort, GotStatus.Got);
  if (ctx.toSortZipOut == null) {
    const o = await openOutputZip(ctx.toSortGame, getMoveToSortUncompressedSize(fixZip), toSortFullName);
    if (o.rc !== ReturnCode.Good) throw new ZipFileException(o.rc, `${fixZippedFile.FullName} ${fixZippedFile.RepStatus} ${o.rc}\n${o.error}`);
    ctx.toSortZipOut = o.out;
  }
  let lst = getFixFileList(fixZippedFile);
  let found = findSourceToUseForFix(fixZip, fixZippedFile, lst);
  let fixStyle = found.fixStyle;
  let fileIn = null;
  if (fixZip.FileType === FileType.Zip && fixZip.ZipStruct === ZipStructure.None) { fileIn = fixZip.child(iRom); fixStyle = FixStyle.RawCopy; }
  if (fileIn == null) fileIn = found.files.includes(fixZip.child(iRom)) ? fixZip.child(iRom) : found.files[0];
  if (fixStyle === FixStyle.ExtractToCache) {
    const d = await U.decompressSource7ZipFile(fileIn.Parent, true, filesUsedForFix);
    if (d.rc !== ReturnCode.Good) return d;
    lst = getFixFileList(fixZippedFile);
    found = findSourceToUseForFix(fixZip, fixZippedFile, lst);
    fileIn = found.files[0]; fixStyle = found.fixStyle;
    if (fixStyle === FixStyle.ExtractToCache) fixStyle = FixStyle.DecompressRecompress;
  }
  const t = fixZip.TreeFullName;
  Report.fix(treeDir(t), treeBase(t), fixZippedFile.Name, fixZippedFile.Size, 'Raw-->', path.dirname(toSortFullName), path.basename(toSortFullName), rom.Name);
  const r = await U.copyFile(fileIn, ctx.toSortZipOut, null, rom, fixStyle);
  if (r.rc !== ReturnCode.Good) throw new ZipFileException(r.rc, `${fixZippedFile.FullName} ${fixZippedFile.RepStatus} ${r.rc}\n${r.error}`);
  fixZippedFile.GotStatus = GotStatus.NotGot;
  fixZippedFile.FileGroup?.Files.push(rom);
  ctx.toSortGame.childAdd(rom);
  for (const f of lst) if (!filesUsedForFix.has(f.TreeFullName)) filesUsedForFix.set(f.TreeFullName, f);
  return { rc: ReturnCode.Good, error: '' };
}

// ------------------------------------------------------------------------------------------------ FixAZipMoveToCorrupt
async function moveToCorrupt(fixZip, fixZippedFile, ctx, iRom) {
  if (fixZippedFile.FileType === FileType.FileSevenZip) { fixZippedFile.GotStatus = GotStatus.NotGot; return { rc: ReturnCode.Good, error: '' }; }
  const corruptDir = path.join(DB.getToSortPrimary().FullName, 'Corrupt');
  let full;
  if (ctx.toSortCorruptGame == null) {
    await fsp.mkdir(corruptDir, { recursive: true });
    const t = await uniqueCorruptName(corruptDir, fixZip.Name);
    full = t.full;
    const g = new RvFile(FileType.Zip);
    g.Name = t.name; g.DatStatus = DatStatus.InToSort; g.GotStatus = GotStatus.Got;
    ctx.toSortCorruptGame = g;
  } else full = path.join(corruptDir, ctx.toSortCorruptGame.Name);
  const rom = new RvFile(FileType.FileZip);
  rom.Name = fixZippedFile.Name; rom.Size = fixZippedFile.Size; rom.CRC = fixZippedFile.CRC;
  rom.setDatGotStatus(DatStatus.InToSort, GotStatus.Corrupt);
  ctx.toSortCorruptGame.childAdd(rom);
  if (ctx.toSortCorruptOut == null) {
    const o = await openOutputZip(ctx.toSortCorruptGame, 0, full);
    if (o.rc !== ReturnCode.Good) throw new ZipFileException(o.rc, `${fixZippedFile.FullName} ${fixZippedFile.RepStatus} ${o.rc}\n${o.error}`);
    ctx.toSortCorruptOut = o.out;
  }
  const t = fixZip.TreeFullName;
  Report.fix(treeDir(t), treeBase(t), fixZippedFile.Name, fixZippedFile.Size, 'Raw-->', 'Corrupt', path.basename(full), fixZippedFile.Name);
  const r = await U.copyFile(fixZip.child(iRom), ctx.toSortCorruptOut, null, rom, FixStyle.RawCopy);
  if (r.rc === ReturnCode.Cancel) return r;
  if (r.rc !== ReturnCode.Good && r.rc !== ReturnCode.SourceDataStreamCorrupt) throw new ZipFileException(r.rc, `${fixZippedFile.FullName} ${fixZippedFile.RepStatus} ${r.rc}\n${r.error}`);
  fixZippedFile.GotStatus = GotStatus.NotGot;
  return { rc: ReturnCode.Good, error: '' };
}

// ------------------------------------------------------------------------------------------------ FixAZip
async function closeToSortGame(ctx) {
  try {
    if (ctx.toSortGame != null) {
      const r = await ctx.toSortZipOut.close();
      if (r.zr !== ZipReturn.ZipGood) return ReturnCode.FileSystemError;
      const g = ctx.toSortGame;
      g.FileModTimeStamp = await U.mtimeOf(ctx.toSortZipOut.filename);
      g.DatStatus = DatStatus.InToSort; g.GotStatus = GotStatus.Got; g.ZipStruct = r.ZipStruct;
      ctx.toSortGameParent.childAdd(g);
    }
    return ReturnCode.Good;
  } catch { return ReturnCode.FileSystemError; } finally { ctx.toSortZipOut = null; }
}
async function closeToSortCorruptGame(ctx) {
  try {
    if (ctx.toSortCorruptGame != null) {
      const r = await ctx.toSortCorruptOut.close();
      if (r.zr !== ZipReturn.ZipGood) return ReturnCode.FileSystemError;
      const g = ctx.toSortCorruptGame;
      g.FileModTimeStamp = await U.mtimeOf(ctx.toSortCorruptOut.filename);
      g.DatStatus = DatStatus.InToSort; g.GotStatus = GotStatus.Got;
      corruptDirNode().childAdd(g);
    }
    return ReturnCode.Good;
  } catch { return ReturnCode.FileSystemError; } finally { ctx.toSortCorruptOut = null; }
}
async function closeAllFailed(ctx) {
  await U.closeLocalZip();
  for (const k of ['tempFixZip', 'toSortZipOut', 'toSortCorruptOut']) { try { await ctx[k]?.closeFailed(); } catch { /* ignore */ } ctx[k] = null; }
}

async function renameZipFileIfCaseRenameNeeded(fixZip) {
  if (!fixZip.FileName) return;
  const dir = fixZip.Parent.FullNameCase;
  Report.fix(dir, fixZip.Name, null, null, 'Rename', null, fixZip.FileName, null);
  const fixed = path.join(dir, fixZip.Name);
  await caseRename(path.join(dir, fixZip.FileName), fixed);
  fixZip.FileModTimeStamp = await U.mtimeOf(fixed);
  fixZip.FileName = null;
}

const okStates = [
  [DatStatus.NotInDat, GotStatus.Got], [DatStatus.NotInDat, GotStatus.Corrupt], [DatStatus.InDatMerged, GotStatus.Got], [DatStatus.InToSort, GotStatus.Got],
  [DatStatus.InToSort, GotStatus.Corrupt], [DatStatus.InDatCollect, GotStatus.NotGot], [DatStatus.InDatNoDump, GotStatus.NotGot], [DatStatus.InDatMerged, GotStatus.NotGot],
  [DatStatus.InDatCollect, GotStatus.Got],
];

async function fixZip(fixZip, fileProcessQueue, counter) {
  if (fixZip.DirStatus.hasUnknown()) return { rc: ReturnCode.FindFixesInvalidStatus, error: '' };
  const needsTrrntzipped = fixZip.GotStatus === GotStatus.Got && fixZip.DatStatus === DatStatus.InDatCollect && fixZip.ZipDatStructFix && fixZip.ZipStruct !== fixZip.ZipDatStruct;
  if (fixZip.GotStatus === GotStatus.Corrupt && fixZip.DatStatus !== DatStatus.InToSort && !fixZip.DirStatus.hasFixable()) {
    const m = await moveZipToCorrupt(fixZip);
    if (m.rc !== ReturnCode.Good) return { rc: m.rc, error: `Move Zip To Corrupt Error with ${m.rc}` };
  }
  if (!fixZip.DirStatus.fixCheckFilesCanBeFixed()) {
    if (fixZip.DirStatus.fixCheckHasNeededForFix()) return { rc: ReturnCode.Good, error: '' };
    if (!fixZip.DirStatus.fixCheckHasFilesToBeRemoved() && !needsTrrntzipped) { await renameZipFileIfCaseRenameNeeded(fixZip); return { rc: ReturnCode.Good, error: '' }; }
  }
  const tree = fixZip.TreeFullName;
  if (!fixZip.DirStatus.hasFixable() && needsTrrntzipped) Report.fix(treeDir(tree), treeBase(tree), '', null, ZipStructureName[fixZip.ZipDatStruct] || String(fixZip.ZipDatStruct), '', '', '');
  await U.checkCreateDirectories(fixZip.Parent);
  const filename = fixZip.FullName;
  if (fixZip.GotStatus === GotStatus.NotGot && await U.statOf(filename)) return { rc: ReturnCode.RescanNeeded, error: `Unexpected file found in directory. Rescan needed.\n${filename}` };

  const filesUsedForFix = new Map();
  let r = await checkFileMove(fixZip, filesUsedForFix, counter);
  if (r.rc === ReturnCode.Good) { U.checkFilesUsedForFix([...filesUsedForFix.values()], fileProcessQueue, false); return r; }
  if (r.rc !== ReturnCode.Cancel) return { rc: r.rc, error: `Check File Move Error with ${r.rc}-${r.error}` };
  r = await checkFileMoveToSort(fixZip);
  if (r.rc === ReturnCode.Good) return r;
  if (r.rc !== ReturnCode.Cancel) return { rc: r.rc, error: `Check File MovetoSort Error with ${r.rc}` };
  for (let i = 0; i < fixZip.ChildCount; i++) {
    const c = fixZip.child(i);
    if (c.RepStatus === RepStatus.Missing || c.RepStatus === RepStatus.NotCollected) continue;
    if (c.FileGroup == null) return { rc: ReturnCode.FindFixesMissingFileGroups, error: '' };
  }

  const ctx = { tempFixZip: null, toSortZipOut: null, toSortCorruptOut: null, toSortGame: null, toSortCorruptGame: null };
  try {
    const temp = [];
    const fileType = DBTypeGet.fileFromDir(fixZip.FileType);
    for (let iRom = 0; iRom < fixZip.ChildCount; iRom++) {
      const t = new RvFile(fileType);
      const orig = fixZip.child(iRom);
      orig.copyTo(t);
      temp.push(t);
      const fail = async (res, what) => { await closeAllFailed(ctx); return { rc: res.rc, error: `${res.error}\n${what} Error with ${res.rc}` }; };
      switch (t.RepStatus) {
        case RepStatus.Missing: case RepStatus.NotCollected: case RepStatus.Rename: case RepStatus.Delete: case RepStatus.Incomplete:
          if (!okStates.some(([d, g]) => t.DatStatus === d && t.GotStatus === g)) Report.error(t.FullName, `Error in Fix Rom Status ${t.RepStatus} : ${t.DatStatus} : ${t.GotStatus}`);
          if (t.RepStatus === RepStatus.Delete) {
            if (state.rvSettings.DetailedFixReporting) Report.fix(treeDir(tree), treeBase(tree), t.Name, t.Size, 'Delete', '', '', '');
            const d = await U.doubleCheckDelete(orig);
            if (d.rc !== ReturnCode.Good) return fail(d, 'Double Check Delete');
            t.GotStatus = GotStatus.NotGot;
          }
          break;
        case RepStatus.Correct: case RepStatus.InToSort: case RepStatus.NeededForFix: case RepStatus.Corrupt: {
          if (t.GotStatus === GotStatus.Corrupt && t.FileType === FileType.FileSevenZip) { t.GotStatus = GotStatus.NotGot; break; }
          const c = await canBeFixed(true, fixZip, t, ctx, iRom, filesUsedForFix, counter);
          if (c.rc !== ReturnCode.Good) return fail(c, 'CorrectZipFile');
          break;
        }
        case RepStatus.CanBeFixed: case RepStatus.CorruptCanBeFixed: {
          const c = await canBeFixed(false, fixZip, t, ctx, 0, filesUsedForFix, counter);
          if (c.rc !== ReturnCode.Good) return fail(c, 'CanBeFixed');
          break;
        }
        case RepStatus.MoveToSort: {
          const c = await moveToSort(fixZip, t, ctx, iRom, filesUsedForFix);
          if (c.rc !== ReturnCode.Good) return fail(c, 'MoveToSort');
          break;
        }
        case RepStatus.MoveToCorrupt: {
          const c = await moveToCorrupt(fixZip, t, ctx, iRom);
          if (c.rc !== ReturnCode.Good) return fail(c, 'MoveToCorrupt');
          break;
        }
        default: throw new U.LogicError(`Unknown file status found ${t.RepStatus} while fixing file ${fixZip.Name} Dat Status = ${t.DatStatus} GotStatus ${t.GotStatus}`);
      }
      if (Report.cancelled) { await closeAllFailed(ctx); return { rc: ReturnCode.Cancel, error: 'Cancel' }; }
    }
    await U.closeLocalZip();
    let rc = await closeToSortGame(ctx);
    if (rc !== ReturnCode.Good) { await closeAllFailed(ctx); return { rc, error: `ErrorClosing ToSort Game ${rc}` }; }
    rc = await closeToSortCorruptGame(ctx);
    if (rc !== ReturnCode.Good) { await closeAllFailed(ctx); return { rc, error: `MoveToCorrupt Corrupt Game ${rc}` }; }

    // Close the new archive first (7z is only written on close), then swap it in.
    let tempName = null; let tempStruct = null; let tempCount = 0;
    if (ctx.tempFixZip) {
      tempName = ctx.tempFixZip.filename; tempCount = ctx.tempFixZip.LocalFilesCount;
      const c = await ctx.tempFixZip.close();
      ctx.tempFixZip = null;
      if (c.zr !== ZipReturn.ZipGood) { await fsp.rm(tempName, { force: true }).catch(() => {}); return { rc: ReturnCode.FileSystemError, error: c.error || 'Error writing the new archive' }; }
      tempStruct = c.ZipStruct;
    }
    if (await U.statOf(filename)) {
      await U.setNormal(filename);
      try { await fsp.unlink(filename); } catch (e) {
        if (tempName) await fsp.rm(tempName, { force: true }).catch(() => {});
        return { rc: ReturnCode.RescanNeeded, error: `Error While trying to delete file ${filename}. ${e.message}` };
      }
    }
    let checkDelete = false;
    if (tempName) {
      if (tempCount > 0) {
        await fsp.rename(tempName, filename);
        const tmpZip = new RvFile(FileType.Zip);
        tmpZip.Name = path.basename(filename); tmpZip.FileModTimeStamp = await U.mtimeOf(filename);
        tmpZip.setDatGotStatus(fixZip.DatStatus, GotStatus.Got);
        fixZip.fileMergeIn(tmpZip, false);
        fixZip.ZipStruct = tempStruct;
      } else { await fsp.rm(tempName, { force: true }); checkDelete = true; }
    } else checkDelete = true;

    let li = 0;
    for (const t of temp) {
      t.copyTo(fixZip.child(li));
      if (fixZip.child(li).GotStatus === GotStatus.NotGot && fixZip.child(li).fileRemove() === EFile.Delete) { fixZip.childRemove(li); continue; }
      li++;
    }
    U.checkFilesUsedForFix([...filesUsedForFix.values()], fileProcessQueue, false);
    if (checkDelete) await U.checkDeleteFile(fixZip);
    return { rc: ReturnCode.Good, error: '' };
  } catch (ex) {
    await closeAllFailed(ctx);
    if (ex instanceof ZipFileException) return { rc: ex.returnCode, error: `In Fix Zip, ZipFileException:\n${ex.message}` };
    return { rc: ex.code ? ReturnCode.FileSystemError : ReturnCode.LogicError, error: `In Fix Zip:\n${ex.message}` };
  }
}

module.exports = { fixZip };
