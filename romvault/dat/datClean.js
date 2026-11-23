// Ported from RomVault (RVWorld: DAT/DATReader/DatClean/*.cs, DAT/DATReader/Utils/AlphanumComparator.cs,
// DatFindParentSets.cs, DatHasRomOf.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk.
'use strict';

const path = require('node:path');
const { FileType, DatStatus, HeaderFileType, ZipStructure, RemoveSubType, ZeroByteCRC, ZeroByteMD5, ZeroByteSHA1 } = require('../enums');
const { DatFile, DatDir, DatGame } = require('./datStore');

const TrrntzipDosDateTime = 563657728;
const isDir = (d) => d instanceof DatDir;
const isFile = (d) => d instanceof DatFile;
const eq = (a, b) => a != null && b != null && a === b;
const extname = (n) => { const b = n.replace(/^.*[\\/]/, ''); const i = b.lastIndexOf('.'); return i > 0 || (i === 0 && b.length > 1) ? b.substring(i) : ''; };
const nameNoExt = (n) => { const b = n.replace(/^.*[\\/]/, ''); const e = extname(b); return e ? b.substring(0, b.length - e.length) : b; };

// ------------------------------------------------------------------------------------------------ AlphanumComparator
const isDigit = (c) => c >= 48 && c <= 57;
function getChunk(s, m) {
  let out = ''; const first = isDigit(s.charCodeAt(m.i));
  do { out += s[m.i]; m.i++; } while (m.i < s.length && isDigit(s.charCodeAt(m.i)) === first);
  return out;
}
function compareTwoNumeric(s1, s2) {
  const p1 = s1.length - 1; const p2 = s2.length - 1;
  const maxlen = Math.max(p1, p2);
  let t1 = p1 - maxlen; let t2 = p2 - maxlen;
  for (;;) {
    const c1 = t1 < 0 ? '0' : s1[t1]; const c2 = t2 < 0 ? '0' : s2[t2];
    if (c1 !== c2) return c1 < c2 ? -1 : 1;
    t1++; t2++;
    if (t1 > p1) return 0;
  }
}
const AlphanumComparator = {
  compareString(s1, s2) {
    const m1 = { i: 0 }; const m2 = { i: 0 };
    while (m1.i < s1.length && m2.i < s2.length) {
      const c1 = getChunk(s1, m1); const c2 = getChunk(s2, m2);
      let r;
      if (isDigit(c1.charCodeAt(0)) && isDigit(c2.charCodeAt(0))) r = compareTwoNumeric(c1, c2);
      else r = c1.localeCompare(c2);
      if (r !== 0) return r;
    }
    return s1.length - s2.length;
  },
  compareWithDirs(s1, s2) {
    if (s1 == null || s2 == null) return 0;
    const n1 = s1.includes('\\'); const n2 = s2.includes('\\');
    if (n1 && !n2) return -1;
    if (n2 && !n1) return 1;
    if (n1 && n2) {
      let t1 = s1.substring(0, s1.indexOf('\\')); let t2 = s2.substring(0, s2.indexOf('\\'));
      if (t1 === t2) { t1 = s1.substring(s1.indexOf('\\') + 1); t2 = s2.substring(s2.indexOf('\\') + 1); }
      s1 = t1; s2 = t2;
    }
    return AlphanumComparator.compareString(s1, s2);
  },
};

// ------------------------------------------------------------------------------------------------ helpers
function findParentSet(searchGame, parentDir, includeBios, list) {
  if (searchGame.DGame == null) return;
  let parentName = searchGame.DGame.RomOf;
  if (!parentName || parentName === searchGame.Name) parentName = searchGame.DGame.CloneOf;
  if (!parentName || parentName === searchGame.Name) return;
  const s = parentDir.childNameSearch(new DatDir(parentName, searchGame.FileType));
  if (s.res !== 0) return;
  const parentGame = parentDir.at(s.index);
  if (!includeBios && parentGame.DGame?.IsBios === 'yes') return;
  if (list.includes(parentGame)) return;
  list.push(parentGame);
  findParentSet(parentGame, parentDir, includeBios, list);
}

function hasRomOf(tDat) {
  for (let g = 0; g < tDat.Count; g++) {
    const m = tDat.at(g);
    if (!isDir(m)) continue;
    if (m.DGame == null) { if (hasRomOf(m)) return true; } else {
      if (m.DGame.RomOf && m.DGame.RomOf.trim()) return true;
      if (m.DGame.CloneOf && m.DGame.CloneOf.trim()) return true;
      if (m.DGame.CloneOfId && m.DGame.CloneOfId.trim()) return true;
    }
  }
  return false;
}

function findRomInParent(dr0, parents) {
  for (const p of parents) {
    for (let r1 = 0; r1 < p.Count; r1++) {
      const dr1 = p.at(r1);
      if (dr0.Size != null && dr1.Size != null && dr0.Size !== dr1.Size) continue;
      if (dr0.CRC != null && dr1.CRC != null && dr0.CRC !== dr1.CRC) continue;
      if (dr0.SHA1 != null && dr1.SHA1 != null && dr0.SHA1 !== dr1.SHA1) continue;
      if (dr0.SHA256 != null && dr1.SHA256 != null && dr0.SHA256 !== dr1.SHA256) continue;
      if (dr0.MD5 != null && dr1.MD5 != null && dr0.MD5 !== dr1.MD5) continue;
      if (dr0.HeaderFileType !== dr1.HeaderFileType) continue;
      return true;
    }
  }
  return false;
}

function findCategory(mGame, catOrder) {
  const cats = mGame.DGame?.Category;
  if (!cats || !cats.length) return null;
  if (cats.length === 1 && cats[0] && cats[0].trim()) return cats[0];
  let best = 9999;
  for (const cat of cats) {
    if (!cat || !cat.trim()) continue;
    for (let i = 0; i < (catOrder || []).length; i++) {
      if (catOrder[i].toLowerCase() === cat.toLowerCase()) { if (i < best) best = i; break; }
    }
  }
  return best !== 9999 ? catOrder[best] : null;
}

// ------------------------------------------------------------------------------------------------ DatClean
const DatClean = {
  directoryFlattern(dDir) {
    const list = [];
    const flat = (d, sub) => {
      for (const db of d.toArray()) {
        if (isFile(db)) continue;
        if (db.DGame != null) { db.Name = (sub && sub.trim() ? sub + '/' : '') + db.Name; list.push(db); } else flat(db, (sub && sub.trim() ? sub + '/' : '') + db.Name);
      }
    };
    flat(dDir, '');
    dDir.childrenClear();
    for (const d of list) dDir.childAdd(d);
  },

  archiveDirectoryFlattern(dDir) {
    if (dDir.DGame != null) {
      const list = [];
      const flat = (d, sub) => {
        for (const db of d.toArray()) {
          const thisName = (sub && sub.trim() ? sub + '/' : '') + db.Name;
          if (isFile(db)) { db.Name = thisName; list.push(db); continue; }
          const f = new DatFile(thisName + '/', FileType.UnSet); f.Size = 0; f.CRC = ZeroByteCRC;
          list.push(f);
          flat(db, thisName);
        }
      };
      flat(dDir, '');
      dDir.childrenClear();
      for (const d of list) dDir.childAdd(d);
      return;
    }
    for (const db of dDir.toArray()) if (isDir(db)) DatClean.archiveDirectoryFlattern(db);
  },

  directoryExpand(dDir) {
    let arr = dDir.toArray();
    const checkDir = (db) => db.FileType !== FileType.FileSevenZip && db.FileType !== FileType.FileZip;
    const found = arr.some((db) => checkDir(db) && db.Name.includes('/'));
    if (found) {
      dDir.childrenClear();
      for (const db of arr) {
        if (checkDir(db) && db.Name.includes('/')) {
          const split = db.Name.indexOf('/');
          const part0 = db.Name.substring(0, split); const part1 = db.Name.substring(split + 1);
          db.Name = part1;
          const dirFind = dDir.childNameSearchAdd(new DatDir(part0, FileType.Dir));
          if (part1.length > 0) dirFind.childAdd(db);
          continue;
        }
        dDir.childAdd(db);
      }
      arr = dDir.toArray();
    }
    for (const db of arr) if (isDir(db)) DatClean.directoryExpand(db);
  },

  removeDeviceRef(dDir) {
    for (const db of dDir.toArray()) if (isDir(db)) { if (db.DGame) db.DGame.device_ref = null; DatClean.removeDeviceRef(db); }
  },

  checkDeDuped(dDir) {
    for (const db of dDir.toArray()) {
      if (isFile(db) && (db.Status || '').toLowerCase() === 'deduped') db.DatStatus = DatStatus.InDatMerged;
      if (isDir(db)) DatClean.checkDeDuped(db);
    }
  },

  checkZeroCRC(dDir) {
    for (let g = 0; g < dDir.Count; g++) {
      const d = dDir.at(g);
      if (isDir(d)) { DatClean.checkZeroCRC(d); continue; }
      if (d.CRC == null || d.CRC !== ZeroByteCRC) continue;
      if (d.Size != null && d.Size !== 0) { d.CRC = null; continue; }
      if (d.MD5 != null && d.MD5 !== ZeroByteMD5) { d.CRC = null; continue; }
      if (d.SHA1 != null && d.SHA1 !== ZeroByteSHA1) { d.CRC = null; continue; }
    }
  },

  addCategory(tDat, catOrder) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) { DatClean.addCategory(m, catOrder); continue; }
      const cat = findCategory(m, catOrder);
      if (cat != null) m.Name = cat + '/' + m.Name;
    }
  },

  // DatSetCleanFilenames
  removeDateTime(dDir) { for (const db of dDir.toArray()) { if (isFile(db)) db.DateModified = null; else DatClean.removeDateTime(db); } },
  removeMD5(dDir) { for (const db of dDir.toArray()) { if (isFile(db)) db.MD5 = null; else DatClean.removeMD5(db); } },
  removeSHA256(dDir) { for (const db of dDir.toArray()) { if (isFile(db)) db.SHA256 = null; else DatClean.removeSHA256(db); } },
  cleanFilenames(dDir) {
    for (const db of dDir.toArray()) {
      if (db.Name) {
        let n = db.Name.replace(/\\/g, '/').replace(/\.\//g, '/');
        n = n.replace(/[:*?<>|"\x00-\x1f]/g, '-');
        db.Name = n;
      }
      if (isDir(db)) DatClean.cleanFilenames(db);
    }
  },
  cleanFileNamesFull(inDat) {
    if (!isDir(inDat)) return;
    for (const child of inDat.toArray()) {
      const original = child.Name;
      if (child.Name != null) {
        switch (child.FileType) {
          case FileType.UnSet: case FileType.File: case FileType.Dir:
            child.Name = child.Name.replace(/^ +/, '').replace(/[. ]+$/, ''); break;
          case FileType.Zip: case FileType.SevenZip:
            child.Name = child.Name.replace(/^ +/, '').replace(/ +$/, ''); break;
          default: break;
        }
      }
      if (!child.Name || !child.Name.trim()) child.Name = '_';
      if (original !== child.Name) { inDat.childRemove(child); inDat.childAdd(child); }
      if (child.FileType === FileType.Dir) DatClean.cleanFileNamesFull(child);
    }
  },
  fixDupes(dDir) {
    let lastName = ''; let lastType = FileType.UnSet; let matchCount = 0;
    for (const db of dDir.toArray()) {
      const thisName = db.Name; const ft = db.FileType;
      if (lastType === ft && lastName.toLowerCase() === thisName.toLowerCase()) {
        switch (lastType) {
          case FileType.Dir: case FileType.Zip: case FileType.SevenZip: db.Name = thisName + '_' + matchCount; break;
          default: {
            const e = extname(thisName);
            db.Name = thisName.substring(0, thisName.length - e.length) + '_' + matchCount + e;
          }
        }
        matchCount++;
        dDir.childRemove(db);
        dDir.childAdd(db);
      } else { matchCount = 0; lastName = thisName; lastType = ft; }
      if (isDir(db)) DatClean.fixDupes(db);
    }
  },

  // DatSetRemove
  removeDupes(tDat, testName = true, testWithMergeName = false) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) { DatClean.removeDupes(m, testName); continue; }
      let found = true;
      while (found) {
        found = false;
        for (let r = 0; r < m.Count; r++) {
          const df0 = m.at(r);
          for (let t = r + 1; t < m.Count; t++) {
            const df1 = m.at(t);
            if (!isFile(df0) || !isFile(df1)) continue;
            if (testName && df0.Name !== df1.Name) continue;
            const hasCRC = df0.CRC != null && df1.CRC != null;
            if (hasCRC && df0.CRC !== df1.CRC) continue;
            const hasSHA1 = df0.SHA1 != null && df1.SHA1 != null;
            if (hasSHA1 && df0.SHA1 !== df1.SHA1) continue;
            const hasSHA256 = df0.SHA256 != null && df1.SHA256 != null;
            if (hasSHA256 && df0.SHA256 !== df1.SHA256) continue;
            const hasMD5 = df0.MD5 != null && df1.MD5 != null;
            if (hasMD5 && df0.MD5 !== df1.MD5) continue;
            if (!hasCRC && !hasSHA1 && !hasMD5) continue;
            found = true;
            const n0 = df0.Name; const n1 = df1.Name;
            const s0 = n0.includes('/'); const s1 = n1.includes('/');
            if (s0 && !s1) m.childRemove(df0);
            else if (!s0 && s1) m.childRemove(df1);
            else if (s0 && s1) {
              const p0 = n0.substring(0, n0.indexOf('/')); const p1 = n1.substring(0, n1.indexOf('/'));
              if (p0 !== p1) m.childRemove(df1);
              else m.childRemove(AlphanumComparator.compareWithDirs(n0, n1) >= 0 ? df0 : df1);
            } else if (n0 === n1 || (testWithMergeName && n0 === df1.Merge)) m.childRemove(df1);
            else { found = false; continue; }
            r = m.Count; t = m.Count;
          }
        }
      }
    }
  },
  removeEmptySets(inDat) {
    if (isFile(inDat)) return true;
    const children = inDat.toArray();
    if (!children.length) return false;
    inDat.childrenClear();
    let found = false;
    for (const c of children) if (DatClean.removeEmptySets(c)) { found = true; inDat.childAdd(c); }
    return found;
  },
  removeNotCollected(inDat) {
    if (isFile(inDat)) return inDat.DatStatus === DatStatus.InDatCollect || inDat.DatStatus === DatStatus.InDatNoDump;
    const children = inDat.toArray();
    if (!children.length) return false;
    inDat.childrenClear();
    let found = false;
    for (const c of children) if (DatClean.removeNotCollected(c)) { found = true; inDat.childAdd(c); }
    return found;
  },
  removeNoDumps(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) DatClean.removeNoDumps(m);
      else for (const t of m.toArray()) if (isFile(t) && t.Status === 'nodump') m.childRemove(t);
    }
  },
  removeCHD(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) DatClean.removeCHD(m);
      else for (const t of m.toArray()) if (isFile(t) && t.HeaderFileType === HeaderFileType.CHD) m.childRemove(t);
    }
  },
  removeNonCHD(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) DatClean.removeNonCHD(m);
      else for (const t of m.toArray()) if (isFile(t) && t.HeaderFileType !== HeaderFileType.CHD) m.childRemove(t);
    }
  },
  removeAllDateTime(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const d = tDat.at(g);
      d.DateModified = null;
      if (isDir(d)) {
        if (d.DatStruct === ZipStructure.ZipTDC || d.DatStruct === ZipStructure.ZipDTD || d.DatStruct === ZipStructure.ZipDTZ) continue;
        DatClean.removeAllDateTime(d);
      }
    }
  },
  removeUnNeededDirectories(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.FileType === FileType.Dir || (m.FileType === FileType.UnSet && m.DGame == null)) DatClean.removeUnNeededDirectories(m);
      else {
        if (m.DatStruct === ZipStructure.ZipTDC || m.DatStruct === ZipStructure.ZipDTD || m.DatStruct === ZipStructure.ZipDTZ) continue;
        DatClean.removeUnNeededDirectoriesFromZip(m);
      }
    }
  },
  removeUnNeededDirectoriesFromZip(m) {
    for (let r = 0; r < m.Count; r++) {
      const df1 = m.at(r);
      if (!isFile(df1) || df1.Size !== 0 || df1.Name.length === 0 || !df1.Name.endsWith('/')) continue;
      let found = false;
      for (let r1 = 0; r1 < m.Count; r1++) {
        if (r === r1) continue;
        const c = m.at(r1).Name;
        if (c.length <= df1.Name.length) continue;
        if (c.substring(0, df1.Name.length) === df1.Name) { found = true; break; }
      }
      if (!found) continue;
      m.childRemove(df1);
      r--;
    }
  },
  removeFilesNotInGames(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const d = tDat.at(g);
      if (isFile(d)) { tDat.childRemove(d); g--; continue; }
      if (d.DGame == null) DatClean.removeFilesNotInGames(d);
    }
  },
  removeEmptyDirectories(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const d = tDat.at(g);
      if (!isDir(d)) continue;
      if (d.DGame == null) DatClean.removeEmptyDirectories(d);
      else if (d.Count === 0) { tDat.childRemove(d); g--; }
    }
  },

  // DatID
  datSetAddIdNumbers(tDat, id) {
    for (let g = 0; g < tDat.Count; g++) {
      const d = tDat.at(g);
      const m = isDir(d) ? d : null;
      if (m?.DGame?.Id) id = m.DGame.Id;
      d.Name = id + ' - ' + d.Name;
      if (m) DatClean.datSetAddIdNumbers(m, id);
    }
  },
  datSetMatchIDs(tDat) {
    const lookup = new Map();
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m) || m.DGame == null) continue;
      if (m.DGame.Id && !lookup.has(m.DGame.Id)) lookup.set(m.DGame.Id, m.Name);
    }
    if (!lookup.size) return;
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m) || m.DGame == null) continue;
      if (m.DGame.CloneOfId && lookup.has(m.DGame.CloneOfId)) m.DGame.CloneOf = lookup.get(m.DGame.CloneOfId);
    }
  },

  // Merge, split and non-merged sets
  datSetMakeMergeSet(tDat, mergeWithGameName = true) {
    const sortThis = [];
    for (let g = 0; g < tDat.Count; g++) sortThis.push(tDat.childSorted(g));
    sortThis.sort((a, b) => (isDir(a) && isDir(b) ? AlphanumComparator.compareString(a.Name, b.Name) : 0));
    for (const mGame of sortThis) {
      if (!isDir(mGame)) continue;
      if (mGame.DGame == null) { DatClean.datSetMakeMergeSet(mGame, mergeWithGameName); continue; }
      const parents = [];
      findParentSet(mGame, tDat, true, parents);
      if (!parents.length) continue;
      const pGames = []; const pBios = [];
      for (const dd of parents) ((dd.DGame.IsBios || '').toLowerCase() === 'yes' ? pBios : pGames).push(dd);
      const keep = [];
      for (const t of mGame.toArray()) {
        if (t.Status === 'nodump') { keep.push(t); continue; }
        if (!findRomInParent(t, pBios)) keep.push(t);
      }
      mGame.childrenClear();
      if (!pGames.length) { for (const t of keep) mGame.childAdd(t); continue; }
      const top = pGames[pGames.length - 1];
      for (const t of keep) {
        if (mergeWithGameName && t.HeaderFileType !== HeaderFileType.CHD) t.Name = mGame.Name + '/' + t.Name;
        top.childAdd(t);
      }
    }
  },
  datSetMakeNonMergeSet(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) { DatClean.datSetMakeNonMergeSet(m); continue; }
      if (m.DGame.device_ref == null) continue;
      const devices = [m];
      const addDevice = (device) => {
        const s = tDat.childNameSearch(new DatDir(device, tDat.FileType));
        if (s.res !== 0) return;
        const dc = tDat.at(s.index);
        if (!dc || devices.includes(dc)) return;
        devices.push(dc);
        for (const c of dc.DGame?.device_ref || []) addDevice(c);
      };
      for (const d of m.DGame.device_ref) addDevice(d);
      devices.shift();
      for (const device of devices) {
        for (let i = 0; i < device.Count; i++) {
          const df0 = device.at(i);
          let found = false;
          for (let j = 0; j < m.Count; j++) { const df1 = m.at(j); if (eq(df0.SHA1, df1.SHA1) && df0.Name === df1.Name) { found = true; break; } }
          if (!found) m.childAdd(df0.clone());
        }
      }
    }
  },
  removeDevices(tDat) {
    const children = tDat.toArray();
    tDat.childrenClear();
    for (const c of children) {
      if (c.DGame == null) { if (isDir(c)) DatClean.removeDevices(c); tDat.childAdd(c); continue; }
      if (c.DGame.IsDevice === 'yes' && c.DGame.Runnable === 'no') continue;
      tDat.childAdd(c);
    }
  },
  datSetMakeSplitSet(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const m = tDat.at(g);
      if (!isDir(m)) continue;
      if (m.DGame == null) { DatClean.datSetMakeSplitSet(m); continue; }
      const parents = [];
      findParentSet(m, tDat, true, parents);
      if (!parents.length) continue;
      for (let r0 = 0; r0 < m.Count; r0++) {
        const dr0 = m.at(r0);
        if (dr0.Status === 'nodump') continue;
        if (findRomInParent(dr0, parents)) {
          if (!dr0.Merge) dr0.Merge = '(Auto Merged)';
          dr0.DatStatus = DatStatus.InDatMerged;
        }
      }
    }
  },

  makeDatSingleLevel(h, useDescription, subDirType, isFiles, addCategory, catOrder) {
    const original = h.BaseDir.toArray();
    h.Dir = 'noautodir';
    let rootDirName = '';
    if (!rootDirName && useDescription && h.Description && h.Description.trim()) rootDirName = h.Description;
    if (!rootDirName) rootDirName = h.Name;
    if (subDirType === RemoveSubType.RemoveAllIfNoConflicts) {
      const rootTest = new DatDir(rootDirName, FileType.UnSet);
      let repeat = false;
      for (const set of original) {
        if (!isDir(set)) continue;
        for (const rom of set.toArray()) {
          if (rootTest.childNameSearch(rom).res === 0) { repeat = true; subDirType = RemoveSubType.KeepAllSubDirs; break; }
          rootTest.childAdd(rom);
        }
        if (repeat) break;
      }
    }
    h.BaseDir.childrenClear();
    const dGame = new DatGame(); dGame.Description = h.Description;
    let outDir;
    if (isFiles) outDir = h.BaseDir;
    else { outDir = new DatDir(rootDirName, FileType.UnSet); outDir.DGame = dGame; h.BaseDir.childAdd(outDir); }
    const addBackDir = (dirSet, rom) => {
      if (isFiles) {
        const f = new DatDir(dirSet.Name, FileType.UnSet); f.DGame = dirSet.DGame;
        outDir.childNameSearchAdd(f).childAdd(rom);
        return;
      }
      rom.Name = dirSet.Name + '/' + rom.Name;
      outDir.childAdd(rom);
    };
    for (const dirSet of original) {
      if (!isDir(dirSet)) continue;
      let setCategory = '-';
      const dbr = dirSet.toArray();
      for (const rom of dbr) {
        if (subDirType === RemoveSubType.KeepAllSubDirs) { addBackDir(dirSet, rom); continue; }
        if (subDirType === RemoveSubType.RemoveSubIfSingleFiles) { if (dbr.length !== 1) { addBackDir(dirSet, rom); continue; } }
        else if (subDirType === RemoveSubType.RemoveSubIfNameMatches) {
          if (dbr.length !== 1) { addBackDir(dirSet, rom); continue; }
          let testRomName = nameNoExt(rom.Name);
          if (addCategory) {
            if (setCategory === '-') setCategory = findCategory(dirSet, catOrder);
            if (setCategory) testRomName = setCategory + '/' + testRomName;
          }
          if (testRomName !== dirSet.Name) { addBackDir(dirSet, rom); continue; }
        }
        if (addCategory) {
          if (setCategory === '-') setCategory = findCategory(dirSet, catOrder);
          if (setCategory) rom.Name = setCategory + '/' + rom.Name;
        }
        outDir.childAdd(rom);
      }
    }
  },

  setHeaderType(tDat, hft) {
    for (const d of tDat.toArray()) {
      if (isFile(d)) { if (d.HeaderFileType !== HeaderFileType.CHD) d.HeaderFileType = hft; } else DatClean.setHeaderType(d, hft);
    }
  },

  setExt(tDat) {
    const arr = tDat.toArray();
    tDat.childrenClear();
    for (const d of arr) {
      if (isFile(d)) {
        if (d.HeaderFileType === HeaderFileType.CHD) { d.Name += '.chd'; if (d.Merge) d.Merge += '.chd'; }
        tDat.childAdd(d);
      } else {
        d.Name += d.FileType === FileType.Zip ? '.zip' : d.FileType === FileType.SevenZip ? '.7z' : '';
        tDat.childAdd(d);
        DatClean.setExt(d);
      }
    }
  },

  clearDescription(dDir) {
    for (const d of dDir.toArray()) {
      if (!isDir(d)) continue;
      if (d.DGame != null) { if (nameNoExt(d.Name) === d.DGame.Description) d.DGame.Description = '¤'; continue; }
      DatClean.clearDescription(d);
    }
  },

  setFilesAsGames(tDat) {
    const newDirs = new Map();
    for (const b of tDat.toArray()) {
      if (isDir(b)) { if (b.FileType === FileType.Dir && b.DGame == null) DatClean.setFilesAsGames(b); continue; }
      const gameName = nameNoExt(b.Name);
      const out = newDirs.get(gameName.toLowerCase());
      if (out) { tDat.childRemove(b); out.childAdd(b); continue; }
      const g = new DatDir(gameName, FileType.UnSet); g.DGame = new DatGame(); g.DGame.Description = gameName;
      if (tDat.childNameSearch(g).res === 0) continue;
      tDat.childRemove(b);
      g.childAdd(b);
      tDat.childAdd(g);
      newDirs.set(gameName.toLowerCase(), g);
    }
  },
  setArchivesAsGames(tDat) {
    for (let g = 0; g < tDat.Count; g++) {
      const d = tDat.at(g);
      if (!isDir(d)) continue;
      if (d.FileType === FileType.Dir) DatClean.setArchivesAsGames(d);
      else if (d.FileType === FileType.Zip || d.FileType === FileType.SevenZip) { d.DGame = new DatGame(); d.DGame.Description = d.Name; }
    }
  },
  setFirstLevelDirsAsGames(tDat) {
    for (let g = 0; g < tDat.Count; g++) { const d = tDat.at(g); if (isDir(d)) { d.DGame = new DatGame(); d.DGame.Description = d.Name; } }
  },
};

// DatSetStatus
function setStatus(tDat) {
  for (let g = 0; g < tDat.Count; g++) {
    const nf = tDat.at(g);
    if (isDir(nf)) { setStatus(nf); continue; }
    if (nf.DatStatus === DatStatus.InDatMerged) continue;
    if (nf.Merge) nf.Merge = '(No-Merge) ' + nf.Merge;
    if (nf.Status === 'nodump') { nf.DatStatus = DatStatus.InDatNoDump; continue; }
    nf.DatStatus = DatStatus.InDatCollect;
  }
}

// DatSetCompressionType
const FileTypeFromDir = [FileType.UnSet, FileType.File, FileType.FileZip, FileType.FileSevenZip];
function setCompressionType(inDat, fileType, zs, fix) {
  if (isFile(inDat)) { inDat.FileType = FileTypeFromDir[fileType]; return; }
  const d = inDat;
  if (d.DGame == null || fileType === FileType.Dir) d.FileType = FileType.Dir;
  else {
    if (d.FileType !== FileType.UnSet) {
      if (d.FileType === FileType.Dir) { fileType = FileType.Dir; zs = ZipStructure.None; }
      if (d.FileType === FileType.Zip) { fileType = FileType.Zip; zs = ZipStructure.ZipTrrnt; }
      if (d.FileType === FileType.SevenZip) { fileType = FileType.SevenZip; zs = ZipStructure.SevenZipNZSTD; }
    }
    d.FileType = fileType;
    let trrnt = false;
    if (d.FileType === FileType.Zip && zs === ZipStructure.ZipTDC) {
      trrnt = d.toArray().every((c) => isFile(c) && c.DateModified === TrrntzipDosDateTime);
    }
    d.setDatStruct(trrnt ? ZipStructure.ZipTrrnt : zs, fix);
  }
  const children = d.toArray();
  d.childrenClear();
  for (const c of children) { setCompressionType(c, fileType, zs, fix); d.childAdd(c); }
}

// DatSetMoveCHDs
function moveUpCHDs(inDat, parents = []) {
  const n = parents.length;
  if (isFile(inDat)) {
    if (inDat.FileType !== FileType.File && inDat.HeaderFileType === HeaderFileType.CHD) {
      const dir = parents[Math.max(0, n - 2)];
      const zipDir = parents[n - 1];
      zipDir.childRemove(inDat);
      const tmp = new DatDir(zipDir.Name, FileType.Dir); tmp.DGame = zipDir.DGame;
      const target = dir.childNameSearchAdd(tmp);
      inDat.FileType = FileType.File;
      target.childAdd(inDat);
    }
    return;
  }
  parents.push(inDat);
  for (const c of inDat.toArray()) moveUpCHDs(c, parents);
  parents.splice(n, 1);
}

module.exports = {
  DatClean, AlphanumComparator, findParentSet, hasRomOf, findCategory, setStatus, setCompressionType, moveUpCHDs,
  TrrntzipDosDateTime, extname, nameNoExt,
};
