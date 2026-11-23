// Ported from RomVault (RVWorld: RomVaultCore/FixFile/FixAFile.cs) by Gordon J. Licensed under Apache-2.0; see
// LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: async file IO.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { FileType, DatStatus, GotStatus, RepStatus } = require('../enums');
const { state } = require('../settings');
const { RvFile, DB, DBHelper } = require('../rvdb');
const { RVSorters } = require('../sorters');
const U = require('./utils');
const { getFixFileList, findSourceToUseForFix } = require('./findSourceFile');

const { ReturnCode, FixStyle, Report } = U;

async function fixFile(f, fileProcessQueue, counter) {
  switch (f.RepStatus) {
    case RepStatus.Unknown: return { rc: ReturnCode.FindFixesInvalidStatus, error: '' };
    case RepStatus.UnScanned: case RepStatus.Missing: case RepStatus.Incomplete: case RepStatus.NotCollected: case RepStatus.Ignore:
    case RepStatus.InToSort: case RepStatus.NeededForFix: case RepStatus.Corrupt: case RepStatus.Rename:
      return { rc: ReturnCode.Good, error: '' };
    case RepStatus.Correct: return fixFileCheckName(f);
    case RepStatus.Delete: return fixFileDelete(f);
    case RepStatus.MoveToSort: return fixFileMoveToSort(f);
    case RepStatus.MoveToCorrupt: return fixFileMoveToCorrupt(f);
    case RepStatus.CanBeFixed: case RepStatus.CorruptCanBeFixed: return fixFileCanBeFixed(f, fileProcessQueue, counter);
    default: return { rc: ReturnCode.LogicError, error: `Unknown fix file type ${f.RepStatus} Dat Status = ${f.DatStatus} GotStatus ${f.GotStatus}` };
  }
}

async function fixFileCheckName(f) {
  if (!f.FileName) return { rc: ReturnCode.Good, error: '' };
  const src = path.join(f.Parent.FullName, f.FileName);
  await U.setNormal(src);
  try { await caseRename(src, f.FullName); } catch (e) {
    Report.error(src, `Error Renaming file to correct case. ${e.message}`);
    return { rc: ReturnCode.FileSystemError, error: `Error Renaming file to correct case. ${e.message}` };
  }
  f.FileName = null;
  return { rc: ReturnCode.Good, error: '' };
}

// A rename that only changes case goes through a temporary name, for case-insensitive file systems.
async function caseRename(from, to) {
  if (from.toLowerCase() === to.toLowerCase() && from !== to) {
    const tmp = path.join(path.dirname(to), `__RomVault.${Date.now()}.tmp`);
    await fsp.rename(from, tmp); await fsp.rename(tmp, to);
  } else await fsp.rename(from, to);
}

async function fixFileDelete(f) {
  const d = await U.doubleCheckDelete(f);
  if (d.rc !== ReturnCode.Good) return d;
  const filename = f.FullName;
  if (await U.fileExists(filename)) {
    if (state.rvSettings.DetailedFixReporting) Report.fix(path.dirname(filename), '', path.basename(filename), f.Size, 'Delete', '', '', '');
    await U.setNormal(filename);
    try { await fsp.unlink(filename); } catch (e) {
      Report.error(filename, `Error Deleting File. ${e.message}`);
      return { rc: ReturnCode.FileSystemError, error: `Error Deleting File. ${e.message}` };
    }
  }
  await U.checkDeleteFile(f);
  return { rc: ReturnCode.Good, error: '' };
}

async function fixFileMoveToSort(f) {
  const t = await U.createToSortDirs(f);
  if (t.rc !== ReturnCode.Good) return { rc: t.rc, error: '' };
  const toSortRom = new RvFile(FileType.File);
  toSortRom.Name = t.filename; toSortRom.Size = f.Size; toSortRom.CRC = f.CRC; toSortRom.DatStatus = DatStatus.InToSort;
  const full = f.FullNameCase;
  Report.fix(path.dirname(full), '', path.basename(full), f.Size, '-->', t.outDir.FullName, '', full);
  const m = await U.moveFile(f, toSortRom, path.join(t.outDir.FullName, t.filename));
  if (m.rc !== ReturnCode.Good) return m;
  if (!m.moved) { Report.error(f.FullName, 'Logic error moving this file to ToSort'); return { rc: ReturnCode.LogicError, error: '' }; }
  t.outDir.childAdd(toSortRom);
  return { rc: ReturnCode.Good, error: '' };
}

// Finds or adds ToSort\Corrupt in the DB.
function corruptDirNode() {
  const toSort = DB.getToSortPrimary();
  const dir = new RvFile(FileType.Dir);
  dir.Name = 'Corrupt'; dir.DatStatus = DatStatus.InToSort;
  let { res, index } = toSort.childNameSearch(dir);
  if (res !== 0) { dir.GotStatus = GotStatus.Got; index = toSort.childAdd(dir); }
  return toSort.child(index);
}

async function fixFileMoveToCorrupt(f) {
  const corruptDir = path.join(DB.getToSortPrimary().FullName, 'Corrupt');
  await fsp.mkdir(corruptDir, { recursive: true });
  let name = f.Name;
  let full = path.join(corruptDir, f.NameCase);
  let c = 0;
  while (await U.statOf(full)) { c++; name = f.Name + c; full = path.join(corruptDir, name); }
  const rom = new RvFile(FileType.File);
  rom.Name = name; rom.Size = f.Size; rom.CRC = f.CRC; rom.DatStatus = DatStatus.InToSort;
  const ffn = f.FullNameCase;
  Report.fix(path.dirname(ffn), '', path.basename(ffn), f.Size, '-->', 'Corrupt', '', f.Name);
  const m = await U.moveFile(f, rom, full);
  if (m.rc !== ReturnCode.Good) return m;
  if (!m.moved) { Report.error(f.FullName, 'Logic error moving this file to ToSort'); return { rc: ReturnCode.LogicError, error: '' }; }
  corruptDirNode().childAdd(rom);
  return { rc: ReturnCode.Good, error: '' };
}

async function fixFilePreCheckFixFile(f) {
  const parent = f.Parent;
  let { res, index } = parent.childNameSearch(f);
  if (res !== 0) return { rc: ReturnCode.LogicError, error: `Logic error trying to find the file we are fixing ${f.FullName}` };
  const testList = [parent.child(index++)];
  while (index < parent.ChildCount && RVSorters.CompareName(f, parent.child(index)) === 0) testList.push(parent.child(index++));
  if (testList.length > 1) {
    for (const t of testList) {
      if (t === f) continue;
      if (t.DatStatus !== DatStatus.NotInDat) return { rc: ReturnCode.LogicError, error: `Trying to fix a file that already exists ${f.FullName}` };
      if (!t.IsFile) return { rc: ReturnCode.LogicError, error: 'Did not find a file logic error while fixing duplicate named file. in FixFile' };
      let r;
      switch (t.RepStatus) {
        case RepStatus.Delete: r = await fixFileDelete(t); if (r.rc !== ReturnCode.Good) return r; break;
        case RepStatus.MoveToSort: r = await fixFileMoveToSort(t); if (r.rc !== ReturnCode.Good) return r; break;
        case RepStatus.MoveToCorrupt: r = await fixFileMoveToCorrupt(t); if (r.rc !== ReturnCode.Good) return r; break;
        case RepStatus.NeededForFix: case RepStatus.Rename: {
          await U.setNormal(t.FullName);
          try { await fsp.rename(t.FullName, t.FullName + '.tmp'); } catch (e) {
            Report.error(t.FullName, `Error Movingfile to .tmp location. ${e.message}`);
            return { rc: ReturnCode.FileSystemError, error: `Error Movingfile to .tmp location. ${e.message}` };
          }
          const fc = parent.findChild(t);
          if (!fc.found) return { rc: ReturnCode.LogicError, error: `Unknown file status in Matching File found of ${t.RepStatus}` };
          parent.childRemove(fc.index);
          t.Name += '.tmp';
          parent.childAdd(t);
          break;
        }
        default: return { rc: ReturnCode.LogicError, error: `Unknown file status in Matching File found of ${t.RepStatus}` };
      }
    }
  } else if (testList[0] !== f) return { rc: ReturnCode.LogicError, error: `Logic error trying to find the file we are fixing ${f.FullName} DB found file does not match` };
  return { rc: ReturnCode.Good, error: '' };
}

async function fixFileCanBeFixed(f, fileProcessQueue, counter) {
  const fixFileFullName = f.FullName;
  await U.checkCreateDirectories(f.Parent);
  let r = await fixFilePreCheckFixFile(f);
  if (r.rc !== ReturnCode.Good) return r;
  let fixFiles = getFixFileList(f);
  if (DBHelper.isZeroLengthFile(f)) {
    const fileIn = new RvFile(FileType.File); fileIn.Size = 0;
    r = await U.copyFile(fileIn, null, f.FullName, f, FixStyle.Zero);
    if (r.rc !== ReturnCode.Good) return { rc: r.rc, error: `${f.FullName} ${f.RepStatus} ${r.rc} : ${r.error}` };
    U.checkFilesUsedForFix(fixFiles, fileProcessQueue, true);
    counter.totalFixed++;
    return { rc: ReturnCode.Good, error: '' };
  }
  let found = findSourceToUseForFix(null, f, fixFiles);
  let fixing = found.files[0];
  if (found.fixStyle === FixStyle.ExtractToCache) {
    const d = await U.decompressSource7ZipFile(fixing.Parent, false, null);
    if (d.rc !== ReturnCode.Good) return d;
    fixFiles = getFixFileList(f);
    found = findSourceToUseForFix(null, f, fixFiles);
    fixing = found.files[0];
    // A single-file 7z is not extracted; it is decompressed straight from the archive below.
  }
  if (!fixing) return { rc: ReturnCode.FindFixesInvalidStatus, error: `No source found to fix ${f.FullName}` };
  const fileMove = U.testFileMove(fixing, f);
  const fts = fixing.FullName;
  Report.fix(path.dirname(fixFileFullName), '', path.basename(fixFileFullName), f.Size, `<--${fileMove ? 'Move' : 'Copy'}`, path.dirname(fts), path.basename(fts), fixing.Name);
  f.fileTestFix(fixing);
  const m = await U.moveFile(fixing, f, null);
  if (m.rc !== ReturnCode.Good) { f.fileRemove(); return m; }
  if (m.moved) { U.checkFilesUsedForFix(fixFiles, fileProcessQueue, true); counter.totalFixed++; return { rc: ReturnCode.Good, error: '' }; }
  r = await U.copyFile(fixing, null, f.FullName, f, FixStyle.Zero);
  switch (r.rc) {
    case ReturnCode.Good: break;
    case ReturnCode.SourceDataStreamCorrupt: Report.fixError('CRC Error'); fixing.GotStatus = GotStatus.Corrupt; return r;
    case ReturnCode.Cancel: Report.fixError('Cancelled'); return r;
    case ReturnCode.RescanNeeded: f.fileRemove(); return r;
    default: Report.fixError('Failed'); return r;
  }
  U.checkFilesUsedForFix(fixFiles, fileProcessQueue, true);
  counter.totalFixed++;
  return { rc: ReturnCode.Good, error: '' };
}

module.exports = { fixFile, caseRename, corruptDirNode };
