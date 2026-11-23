// Ported from RomVault (RVWorld: RomVaultCore/ReadDat/DatUpdate.cs, DatCompare.cs, DatTreeStatusStore.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
'use strict';

const { FileType, DatStatus, GotStatus, HeaderFileType, DatUpdateStatus, EFile } = require('../enums');
const { RvFile, RvDat, RvTreeRow, DB, DBHelper, DatData, altHeaderFile, log } = require('../rvdb');
const { reportStatusReset } = require('../repairStatus');
const { RVSorters } = require('../sorters');
const { DatImportDir, readInDatFile } = require('./datReader');

// ------------------------------------------------------------------------------------------------ DatTreeStatusStore
class DatTreeStatusStore {
  constructor() { this.rows = new Map(); }
  preStoreTreeValue(dir) {
    for (let i = 0; i < dir.ChildCount; i++) {
      const c = dir.child(i);
      if (c.Tree != null) {
        const p = c.TreeFullName;
        if (this.rows.has(p)) this.rows.set(p, null); else this.rows.set(p, c.Tree);
      }
      if (c.FileType === FileType.Dir) this.preStoreTreeValue(c);
    }
  }
  setBackTreeValues(dir) {
    for (let i = 0; i < dir.ChildCount; i++) {
      const c = dir.child(i);
      if (c.Tree != null) {
        const v = this.rows.get(c.TreeFullName);
        if (v && v !== c.Tree) { c.Tree.setChecked(v.Checked); c.Tree.setTreeExpanded(v.TreeExpanded); }
      }
      if (c.FileType === FileType.Dir) this.setBackTreeValues(c);
    }
  }
}

// ------------------------------------------------------------------------------------------------ DatCompare
const hOnly = (h) => h & HeaderFileType.HeaderMask;
const hReq = (h) => (h & HeaderFileType.Required) !== 0;

function datMergeCompare(dbFile, testFile, indexCase) {
  const retv = indexCase === 0 ? (dbFile.Name < testFile.Name ? -1 : dbFile.Name > testFile.Name ? 1 : 0) : RVSorters.CompareName(dbFile, testFile);
  if (retv !== 0) return { matched: false, altMatch: false };
  if (dbFile.FileType !== testFile.FileType) return { matched: false, altMatch: false };
  if (dbFile.IsDirectory) return { matched: true, altMatch: false };
  if (hReq(testFile.HeaderFileType) && dbFile.HeaderFileType !== hOnly(testFile.HeaderFileType)) return { matched: false, altMatch: false };
  if (dbFile.GotStatus === GotStatus.FileLocked) return { matched: true, altMatch: false };
  if (testFile.DateModified != null && testFile.DateModified !== dbFile.FileModTimeStamp) return { matched: false, altMatch: false };
  if (compareHash(testFile, dbFile)) return { matched: true, altMatch: false };
  if (compareAltHash(testFile, dbFile)) return { matched: true, altMatch: true };
  return { matched: false, altMatch: false };
}
function compareHash(d, t) {
  let found = false;
  if (d.Size != null && t.Size != null) {
    if (d.Size !== t.Size) return false;
    if (t.Size === 0 && d.CRC == null && d.SHA1 == null && d.MD5 == null) return true;
  }
  if (d.CRC != null && t.CRC != null) { found = true; if (d.CRC !== t.CRC) return false; }
  if (d.SHA1 != null && t.SHA1 != null) { found = true; if (d.SHA1 !== t.SHA1) return false; }
  if (d.MD5 != null && t.MD5 != null) { found = true; if (d.MD5 !== t.MD5) return false; }
  return found;
}
function compareAltHash(d, t) {
  if (!altHeaderFile(t.HeaderFileType)) return false;
  if (hOnly(d.HeaderFileType) !== t.HeaderFileType) return false;
  let found = false;
  if (d.Size != null && t.AltSize != null && d.Size !== t.AltSize) return false;
  if (d.CRC != null && t.AltCRC != null) { found = true; if (d.CRC !== t.AltCRC) return false; }
  if (d.SHA1 != null && t.AltSHA1 != null) { found = true; if (d.SHA1 !== t.AltSHA1) return false; }
  if (d.MD5 != null && t.AltMD5 != null) { found = true; if (d.MD5 !== t.AltMD5) return false; }
  return found;
}

// ------------------------------------------------------------------------------------------------ DatUpdate
function updateDat(thWrk) {
  const ctx = { thWrk, processed: 0, count: 0 };
  try {
    thWrk.text('Clearing DB Status');
    reportStatusReset(DB.DirRoot);
    const treeStore = new DatTreeStatusStore();
    treeStore.preStoreTreeValue(DB.DirRoot.child(0));
    thWrk.text('Finding Dats');
    const { ok, root, count } = DatImportDir.recursiveDatTree((m) => thWrk.error('DatRoot', m));
    if (!ok) { thWrk.text('Dat Update Complete'); return; }
    ctx.count = count;
    thWrk.text('Scanning Dats');
    removeOldDats(DB.DirRoot.child(0), root);
    removeOldDatsCleanUpFiles(DB.DirRoot.child(0));
    thWrk.range(Math.max(0, count - 1));
    updateDirs(ctx, DB.DirRoot.child(0), root);
    removeOldTree(DB.DirRoot.child(0));
    treeStore.setBackTreeValues(DB.DirRoot.child(0));
    thWrk.text('Updating Cache');
    DB.write();
    thWrk.text('Dat Update Complete');
  } catch (e) {
    thWrk.error('DAT update', e.stack || e.message);
    thWrk.text('Updating Cache');
    DB.write();
    thWrk.text('Complete');
  }
}

function removeOldDats(lDir, datDir) {
  if (!lDir.IsDirectory) return;
  let dbCount = lDir.DirDatCount; const datCount = datDir ? datDir.DatFilesCount : 0;
  let i = 0; let j = 0;
  for (;;) {
    let dbDat = null; let res;
    if (i < dbCount && j < datCount) { dbDat = lDir.dirDat(i); res = DBHelper.datCompare(dbDat, datDir.dirDat(j)); } else if (j < datCount) res = 1;
    else if (i < dbCount) { dbDat = lDir.dirDat(i); res = -1; } else break;
    if (res === 0) { if (dbDat) dbDat.Status = DatUpdateStatus.Correct; i++; j++; } else if (res === 1) j++;
    else { if (dbDat) dbDat.Status = DatUpdateStatus.Delete; dbCount = lDir.dirDatRemove(i); }
  }
  const dbChildCount = lDir.ChildCount; const datChildCount = datDir ? datDir.ChildDirsCount : 0;
  i = 0; j = 0;
  for (;;) {
    let dbChild = null; let fileChild = null; let res;
    if (i < dbChildCount && j < datChildCount) { dbChild = lDir.child(i); fileChild = datDir.childDir(j); res = RVSorters.CompareDirName(dbChild, fileChild); } else if (j < datChildCount) res = 1;
    else if (i < dbChildCount) { dbChild = lDir.child(i); res = -1; } else break;
    if (res === 0) { removeOldDats(dbChild, fileChild); i++; j++; } else if (res === 1) j++;
    else { if (dbChild?.FileType === FileType.Dir && dbChild.Dat == null) removeOldDats(dbChild, null); i++; }
  }
}

function removeOldDatsCleanUpFiles(dbDir) {
  if (dbDir.Dat != null) {
    if (dbDir.Dat.Status === DatUpdateStatus.Correct) return EFile.Keep;
    if (dbDir.Dat.Status === DatUpdateStatus.Delete && dbDir.datRemove() === EFile.Delete) return EFile.Delete;
  }
  const ft = dbDir.FileType;
  if (ft !== FileType.Zip && ft !== FileType.Dir && ft !== FileType.SevenZip) return EFile.Keep;
  dbDir.DatStatus = DatStatus.NotInDat;
  for (let i = 0; i < dbDir.ChildCount; i++) {
    if (removeOldDatsCleanUpFiles(dbDir.child(i)) === EFile.Keep) continue;
    dbDir.childRemove(i); i--;
  }
  if ((ft === FileType.Zip || ft === FileType.SevenZip) && dbDir.GotStatus === GotStatus.Corrupt) return EFile.Keep;
  return dbDir.ChildCount === 0 ? EFile.Delete : EFile.Keep;
}

function updateDirs(ctx, dbDir, datDir) {
  addTheDatsInThisDir(ctx, dbDir, datDir);
  let dbCount = dbDir.ChildCount; const datCount = datDir.ChildDirsCount;
  let i = 0; let j = 0;
  dbDir.DatStatus = DatStatus.InDatCollect;
  if (dbDir.Tree == null) dbDir.Tree = new RvTreeRow();
  for (;;) {
    let dbChild = null; let fileChild = null; let res;
    if (i < dbCount && j < datCount) { dbChild = dbDir.child(i); fileChild = datDir.childDir(j); res = RVSorters.CompareDirName(dbChild, fileChild); } else if (j < datCount) { fileChild = datDir.childDir(j); res = 1; }
    else if (i < dbCount) { dbChild = dbDir.child(i); res = -1; } else break;
    if (res === 0) {
      if (dbChild.DatStatus === DatStatus.InDatCollect) {
        ctx.thWrk.error(dbChild.DatTreeFullName, 'DAT directory conflict: an auto-created virtual directory is using the same name as a real directory. Resolve the conflict and refresh DATs.');
      } else {
        if (dbChild.GotStatus === GotStatus.Got) {
          if (dbChild.Name !== fileChild.Name) {
            if (dbChild.FileName) dbChild.FileName = dbChild.Name;
            else if (dbChild.FileName === fileChild.Name) dbChild.FileName = null;
            dbChild.Name = fileChild.Name;
          }
        } else dbChild.Name = fileChild.Name;
        if (dbDir.Tree == null) dbDir.Tree = new RvTreeRow();
        updateDirs(ctx, dbChild, fileChild);
      }
      i++; j++;
    } else if (res === 1) {
      const t = dbDir.datAddDirectory(fileChild.Name, i);
      updateDirs(ctx, t, fileChild);
      dbCount++; i++; j++;
    } else i++;
  }
}

function addTheDatsInThisDir(ctx, dbDir, datDir) {
  let dbCount = dbDir.DirDatCount; const datCount = datDir.DatFilesCount;
  let i = 0; let j = 0;
  for (;;) {
    let dbDat = null; let fileDat = null; let res;
    if (i < dbCount && j < datCount) { dbDat = dbDir.dirDat(i); fileDat = datDir.dirDat(j); res = DBHelper.datCompare(dbDat, fileDat); } else if (j < datCount) { fileDat = datDir.dirDat(j); res = 1; }
    else if (i < dbCount) { dbDat = dbDir.dirDat(i); res = -1; } else break;
    const short = fileDat ? fileDat.DatFullName.replace(/^.*\\/, '').replace(/\.[^.]*$/, '') : '';
    if (res === 0) {
      ctx.processed++; ctx.thWrk.progress(ctx.processed); ctx.thWrk.text('Dat : ' + short);
      if (dbDat) dbDat.Status = DatUpdateStatus.Correct;
      i++; j++;
    } else if (res === 1) {
      ctx.processed++; ctx.thWrk.progress(ctx.processed); ctx.thWrk.text('Scanning New Dat : ' + short);
      if (loadNewDat(ctx, dbDir, fileDat)) { i++; dbCount++; }
      j++;
    } else {
      ctx.thWrk.error(dbDir.FullName, 'ERROR Deleting a DAT that should already be deleted.');
      i++;
    }
  }
}

function loadNewDat(ctx, dbDir, fileDat) {
  let ok = false;
  try { ok = readInDatFile(fileDat, (f, e) => ctx.thWrk.error(f, e)); } catch (e) { ctx.thWrk.error(fileDat.DatFullName, e.message); ok = false; }
  if (!ok) { ctx.thWrk.error(fileDat.DatFullName, 'Error reading Dat ' + fileDat.DatFullName); return false; }
  if (fileDat.datHeader.BaseDir.Count === 0) return false;
  if (dbDir.Tree == null) dbDir.Tree = new RvTreeRow();
  const thisDat = RvDat.fromImport(fileDat);
  const chk = mergeInDat(ctx, dbDir, fileDat.datHeader.BaseDir, thisDat, true);
  if (chk.conflict) {
    ctx.thWrk.error(fileDat.DatFullName, `DAT merge conflict: the cache contains ${chk.conflictDat?.getData(DatData.DatRootFullName)}, and this DAT is trying to use the same directory, so it will be ignored.\n${chk.message}`);
    return false;
  }
  dbDir.dirDatAdd(thisDat);
  mergeInDat(ctx, dbDir, fileDat.datHeader.BaseDir, thisDat, false);
  return true;
}

function mergeInDat(ctx, dbDir, fileDir, thisRvDat, checkOnly) {
  let dbCount = dbDir.ChildCount; const fCount = fileDir.Count;
  let i = 0; let j = 0;
  for (;;) {
    let dbChild = null; let nd = null; let res;
    if (i < dbCount && j < fCount) { dbChild = dbDir.child(i); nd = fileDir.at(j); res = RVSorters.CompareName(dbChild, nd); } else if (j < fCount) { nd = fileDir.at(j); res = 1; }
    else if (i < dbCount) { dbChild = dbDir.child(i); res = -1; } else break;
    if (res === 0) {
      const dbDats = [dbChild]; let n = 1;
      while (i + n < dbCount && RVSorters.CompareName(dbChild, dbDir.child(i + n)) === 0) { dbDats.push(dbDir.child(i + n)); n++; }
      for (let k = 0; k < n; k++) {
        if (dbDats[k].DatStatus === DatStatus.NotInDat) continue;
        if (checkOnly) return { conflict: true, conflictDat: dbChild.Dat, message: `Found Status: ${dbDats[k].DatStatus}\n datName: ${dbDats[k].TreeFullName}\n` };
        ctx.thWrk.error(dbDir.FullName, 'Unknown Update Dat Status ' + dbChild.DatStatus);
        break;
      }
      if (!checkOnly) {
        const caseTest = dbDats.length > 1;
        let found = false;
        for (let ic = caseTest ? 0 : 1; ic < 2 && !found; ic++) {
          for (let k = 0; k < n; k++) {
            if (dbDats[k].SearchFound) continue;
            const m = datMergeCompare(dbDats[k], nd, ic);
            if (!m.matched) continue;
            dbDats[k].datMergeIn(nd, thisRvDat, m.altMatch);
            if (dbDats[k].IsDirectory) mergeInDat(ctx, dbDats[k], nd, thisRvDat, false);
            dbDats[k].SearchFound = true;
            found = true;
            break;
          }
        }
        if (!found) {
          const c = dbDir.datAdd(nd, thisRvDat, i);
          setMissingStatus(c);
          dbCount++; i++;
        }
      }
      i += n; j++;
    } else if (res === 1) {
      if (!checkOnly) {
        const c = dbDir.datAdd(nd, thisRvDat, i);
        setMissingStatus(c);
        dbCount++; i++;
      }
      j++;
    } else i++;
  }
  return { conflict: false };
}

function setMissingStatus(c) {
  if (c.fileRemove() === EFile.Delete) { log.error('Error is Set Missing Status in DatUpdate'); return; }
  if (c.IsDirectory) for (let i = 0; i < c.ChildCount; i++) setMissingStatus(c.child(i));
}

function removeOldTree(d) {
  if (!d.IsDirectory) return;
  if (d.DatStatus === DatStatus.NotInDat && d.Tree != null) d.Tree = null;
  for (let i = 0; i < d.ChildCount; i++) removeOldTree(d.child(i));
}

function invalidateAllDATs(dbFile, romVaultPath) {
  const datPath = 'DatRoot' + romVaultPath.substring(8);
  const walk = (f) => {
    if (!f.IsDirectory) return;
    if (f.DirDatCount > 0) {
      const full = f.DatTreeFullName;
      if (datPath.length <= full.length && full.substring(0, datPath.length) === datPath) for (let i = 0; i < f.DirDatCount; i++) f.dirDat(i).invalidateDatTimeStamp();
    }
    if (f.Dat != null) {
      const n = f.Dat.getData(DatData.DatRootFullName);
      if (datPath.length <= n.length && n.substring(0, datPath.length) === datPath) f.Dat.invalidateDatTimeStamp();
    }
    for (let i = 0; i < f.ChildCount; i++) walk(f.child(i));
  };
  walk(dbFile);
}

module.exports = { updateDat, invalidateAllDATs, DatTreeStatusStore };
