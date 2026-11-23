// Ported from RomVault (RVWorld: RomVaultCore/FindFix/FindFixes.cs, FileGroup.cs, FindFixesListCheck.cs,
// CleanPartial.cs, ToSortZeroByteFilesDontFix.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and
// NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: runs on one thread, so files are grouped
// in tree order instead of in parallel; hashes are hex strings, so they are compared as strings.
'use strict';

const { RepStatus, DatStatus, GotStatus, FileType, TreeSelect, HeaderFileType, ZeroByteCRC } = require('../enums');
const { RvFile, DB, DBHelper } = require('../rvdb');
const { reportStatusReset } = require('../repairStatus');
const { findDatRule } = require('../settings');
const { FileHeaderReader } = require('../scanner/fileScan');

// RomVault's ByteArrCompare: a missing hash sorts as empty.
const hcmp = (a, b) => { a = a || ''; b = b || ''; return a < b ? -1 : a > b ? 1 : 0; };
const eqNull = (a, b) => a == null || b == null || a === b;

// ------------------------------------------------------------------------------------------------ FileGroup
class FileGroup {
  constructor(src) {
    this.Size = src.Size; this.CRC = src.CRC; this.SHA1 = src.SHA1; this.MD5 = src.MD5;
    this.HeaderFT = FileHeaderReader.altHeaderFile(src.HeaderFileType) ? src.HeaderFileType : HeaderFileType.Nothing;
    this.AltSize = src.AltSize; this.AltCRC = src.AltCRC; this.AltSHA1 = src.AltSHA1; this.AltMD5 = src.AltMD5;
    this.Files = [src];
    src.FileGroup = this;
  }
  mergeFileIntoGroup(f) {
    if (this.Size == null && f.Size != null) this.Size = f.Size;
    if (this.CRC == null && f.CRC != null) this.CRC = f.CRC;
    if (this.SHA1 == null && f.SHA1 != null) this.SHA1 = f.SHA1;
    if (this.MD5 == null && f.MD5 != null) this.MD5 = f.MD5;
    if (this.HeaderFT === HeaderFileType.Nothing && FileHeaderReader.altHeaderFile(f.HeaderFileType)) this.HeaderFT = f.HeaderFileType;
    if (this.AltSize == null && f.AltSize != null) this.AltSize = f.AltSize;
    if (this.AltCRC == null && f.AltCRC != null) this.AltCRC = f.AltCRC;
    if (this.AltSHA1 == null && f.AltSHA1 != null) this.AltSHA1 = f.AltSHA1;
    if (this.AltMD5 == null && f.AltMD5 != null) this.AltMD5 = f.AltMD5;
    this.Files.push(f); f.FileGroup = this;
  }
  mergeAltFileIntoGroup(f) {
    if (this.HeaderFT === HeaderFileType.Nothing && FileHeaderReader.altHeaderFile(f.HeaderFileType)) this.HeaderFT = f.HeaderFileType;
    if (this.AltSize == null && f.Size != null) this.AltSize = f.Size;
    if (this.AltCRC == null && f.CRC != null) this.AltCRC = f.CRC;
    if (this.AltSHA1 == null && f.SHA1 != null) this.AltSHA1 = f.SHA1;
    if (this.AltMD5 == null && f.MD5 != null) this.AltMD5 = f.MD5;
    this.Files.push(f); f.FileGroup = this;
  }
  findExactMatch(f) {
    return eqNull(f.Size, this.Size) && eqNull(f.CRC, this.CRC) && eqNull(f.SHA1, this.SHA1) && eqNull(f.MD5, this.MD5) &&
      eqNull(f.AltSize, this.AltSize) && eqNull(f.AltCRC, this.AltCRC) && eqNull(f.AltSHA1, this.AltSHA1) && eqNull(f.AltMD5, this.AltMD5);
  }
  findAltExactMatch(f) {
    return eqNull(f.Size, this.AltSize) && eqNull(f.CRC, this.AltCRC) && eqNull(f.SHA1, this.AltSHA1) && eqNull(f.MD5, this.AltMD5);
  }
}

// ------------------------------------------------------------------------------------------------ FindFixesListCheck
const isZeroGroup = (g) => g.Size === 0 && g.CRC === ZeroByteCRC;

function listCheck(family) {
  const files = family.Files;
  if (isZeroGroup(family)) {
    for (const t of files) {
      if (RvFile.treeType(t) === TreeSelect.Locked) continue;
      switch (t.RepStatus) {
        case RepStatus.Missing: t.RepStatus = RepStatus.CanBeFixed; break;
        case RepStatus.Corrupt: t.RepStatus = t.DatStatus === DatStatus.InDatCollect ? RepStatus.CanBeFixed : RepStatus.Delete; break;
        case RepStatus.UnNeeded: case RepStatus.Unknown: case RepStatus.IncompleteRemove: case RepStatus.InToSort: t.RepStatus = RepStatus.Delete; break;
        default: break;
      }
    }
    return;
  }
  const missingFiles = []; const correctFiles = []; const unNeededFiles = []; const inToSortFiles = []; const corruptFiles = [];
  for (const t of files) {
    switch (t.RepStatus) {
      case RepStatus.Missing: missingFiles.push(t); break;
      case RepStatus.Correct: correctFiles.push(t); break;
      case RepStatus.Corrupt: (t.DatStatus === DatStatus.InDatCollect ? missingFiles : corruptFiles).push(t); break;
      case RepStatus.UnNeeded: case RepStatus.Unknown: case RepStatus.IncompleteRemove: unNeededFiles.push(t); break;
      case RepStatus.InToSort: inToSortFiles.push(t); break;
      default: break;
    }
  }
  const allGotFiles = [...correctFiles, ...unNeededFiles, ...inToSortFiles];

  for (const m of missingFiles) {
    if (RvFile.treeType(m) === TreeSelect.Locked) continue;
    for (const g of allGotFiles) {
      if (!DBHelper.checkIfMissingFileCanBeFixedByGotFile(m, g)) continue;
      m.RepStatus = m.RepStatus === RepStatus.Corrupt ? RepStatus.CorruptCanBeFixed : RepStatus.CanBeFixed;
      break;
    }
    if (m.RepStatus === RepStatus.Corrupt) m.RepStatus = RepStatus.MoveToCorrupt;
  }

  for (const c of corruptFiles) {
    if (RvFile.treeType(c) === TreeSelect.Locked) continue;
    if (allGotFiles.length > 0) c.RepStatus = RepStatus.Delete;
    if (c.RepStatus === RepStatus.Corrupt && c.DatStatus !== DatStatus.InToSort) c.RepStatus = RepStatus.MoveToCorrupt;
  }

  for (const u of unNeededFiles) {
    for (const m of missingFiles) {
      if (!DBHelper.checkIfMissingFileCanBeFixedByGotFile(m, u)) continue;
      u.RepStatus = RepStatus.NeededForFix;
      break;
    }
    if (u.RepStatus === RepStatus.NeededForFix) continue;
    if (RvFile.treeType(u) === TreeSelect.Locked) continue;
    for (const c of correctFiles) {
      if (!DBHelper.checkIfGotfileAndMatchingFileAreFullMatches(u, c)) continue;
      u.RepStatus = RepStatus.Delete;
      break;
    }
    if (u.RepStatus === RepStatus.Delete) continue;
    for (const s of inToSortFiles) {
      if (!DBHelper.checkIfGotfileAndMatchingFileAreFullMatches(u, s)) continue;
      u.RepStatus = RepStatus.Delete;
      break;
    }
    if (u.RepStatus === RepStatus.Delete) continue;
    u.RepStatus = RepStatus.MoveToSort;
  }

  for (const s of inToSortFiles) {
    for (const m of missingFiles) {
      if (RvFile.treeType(m) === TreeSelect.Locked) continue;
      if (!DBHelper.checkIfMissingFileCanBeFixedByGotFile(m, s)) continue;
      s.RepStatus = RepStatus.NeededForFix;
      break;
    }
    if (s.RepStatus === RepStatus.NeededForFix) continue;
    if (RvFile.treeType(s) === TreeSelect.Locked) continue;
    for (const c of correctFiles) {
      if (!DBHelper.checkIfGotfileAndMatchingFileAreFullMatches(s, c)) continue;
      s.RepStatus = RepStatus.Delete;
      break;
    }
  }

  const canBeFixed = files.filter((f) => f.RepStatus === RepStatus.CanBeFixed);
  for (const out of files) {
    if (out.RepStatus !== RepStatus.NeededForFix) continue;
    for (const inn of canBeFixed) {
      if (!DBHelper.romFromSameGame(out, inn)) continue;
      if (!DBHelper.checkIfMissingFileCanBeFixedByGotFile(inn, out)) continue;
      out.RepStatus = RepStatus.Rename;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ClearPartial
const ClearPartial = {
  checkGroups: new Set(),
  resetCorrupt(basePath) {
    for (let i = 0; i < basePath.ChildCount; i++) {
      const c = basePath.child(i);
      if (c.Game != null) { if (c.FileType === FileType.Zip && c.GotStatus === GotStatus.Corrupt) c.FileModTimeStamp = null; } else ClearPartial.resetCorrupt(c);
    }
  },
  checkRemovePartial(basePath) {
    const nextSelect = basePath.Tree != null ? basePath.Tree.Checked === TreeSelect.Selected : false;
    const datRule = nextSelect ? findDatRule(basePath.DatTreeFullName + '\\') : null;
    for (let i = 0; i < basePath.ChildCount; i++) {
      const c = basePath.child(i);
      if (c.Game != null) { if (nextSelect && datRule != null && datRule.CompleteOnly) ClearPartial._removePartialSets(c); } else ClearPartial.checkRemovePartial(c);
    }
  },
  _statusCheckDir(f, st) {
    for (let i = 0; i < f.ChildCount; i++) {
      const c = f.child(i);
      if (c.IsDirectory) { ClearPartial._statusCheckDir(c, st); continue; }
      if (c.RepStatus === RepStatus.Missing) st.missing = true;
      else if (c.RepStatus === RepStatus.Correct || c.RepStatus === RepStatus.CanBeFixed) st.got = true;
    }
  },
  _statusSetDir(f) {
    for (let i = 0; i < f.ChildCount; i++) {
      const c = f.child(i);
      if (c.IsDirectory) { ClearPartial._statusSetDir(c); continue; }
      if (c.RepStatus === RepStatus.CanBeFixed) { c.RepStatus = RepStatus.Incomplete; if (c.FileGroup) ClearPartial.checkGroups.add(c.FileGroup); } else if (c.RepStatus === RepStatus.Correct) {
        c.RepStatus = RepStatus.IncompleteRemove; if (c.FileGroup) ClearPartial.checkGroups.add(c.FileGroup);
      }
    }
  },
  _removePartialSets(dbDir) {
    if (dbDir.Game == null) return;
    const st = { missing: false, got: false };
    ClearPartial._statusCheckDir(dbDir, st);
    if (!st.missing || !st.got) return;
    ClearPartial._statusSetDir(dbDir);
  },
  checkAllGroups() {
    for (const g of ClearPartial.checkGroups) {
      for (const f of g.Files) { if (f.RepStatus === RepStatus.Incomplete || f.RepStatus === RepStatus.IncompleteRemove) continue; f.repStatusReset(); }
      listCheck(g);
    }
  },
};

// ------------------------------------------------------------------------------------------------ ToSortZeroByteFilesDontFix
function toSortZeroByteFilesDontFix(zeroGroup) {
  if (!isZeroGroup(zeroGroup)) throw new Error('This is not a zero byte file group');
  const parents = new Map();
  for (const f of zeroGroup.Files) {
    if (!f.IsInToSort) continue;
    if (f.FileType !== FileType.FileSevenZip && f.FileType !== FileType.FileZip) continue;
    const k = f.Parent.TreeFullName;
    if (!parents.has(k)) parents.set(k, f.Parent);
  }
  for (const p of parents.values()) {
    let fixable = false; let nonZero = false;
    for (let i = 0; i < p.ChildCount; i++) {
      const c = p.child(i);
      if (c.Size !== 0) nonZero = true;
      if (c.Size === 0) continue;
      if (c.RepStatus !== RepStatus.InToSort && c.RepStatus !== RepStatus.Corrupt) { fixable = true; break; }
    }
    if (fixable || !nonZero) continue;
    for (let i = 0; i < p.ChildCount; i++) { const c = p.child(i); if (c.Size === 0) c.RepStatus = RepStatus.InToSort; }
  }
}

// ------------------------------------------------------------------------------------------------ FindFixes
function getSelectedFiles(val, selected, gotFiles, missingFiles) {
  if (selected && val.IsFile) {
    if (val.GotStatus === GotStatus.Got || val.GotStatus === GotStatus.Corrupt) gotFiles.push(val);
    else if (val.GotStatus === GotStatus.NotGot) missingFiles.push(val);
  }
  if (!val.IsDirectory) return;
  for (let i = 0; i < val.ChildCount; i++) {
    const next = val.Tree != null ? val.Tree.Checked !== TreeSelect.UnSelected : selected;
    getSelectedFiles(val.child(i), next, gotFiles, missingFiles);
  }
}

// RomVault's ByteSortedList keyed on CRC: a file joins the first group with its CRC it fully matches, otherwise
// starts a new group. Groups come out sorted by CRC, in creation order within a CRC.
function mergeGotFiles(gotFiles) {
  const byCrc = new Map();
  const add = (f, exact) => {
    let list = byCrc.get(f.CRC);
    if (!list) { list = []; byCrc.set(f.CRC, list); }
    if (exact) { const g = list.find((x) => x.findExactMatch(f)); if (g) { g.mergeFileIntoGroup(f); return; } } else if (list.length) { list[0].mergeFileIntoGroup(f); return; }
    list.push(new FileGroup(f));
  };
  add(RvFile.makeFileZero(), false);
  for (const f of gotFiles) if (f.CRC != null) add(f, true);
  const keys = [...byCrc.keys()].sort(hcmp);
  return keys.flatMap((k) => byCrc.get(k));
}

const sortWithFilter = (arr, key) => arr.filter((g) => g[key] != null).sort((a, b) => hcmp(a[key], b[key]));

// FindMatch: binary search on one hash, then the groups with that hash that match exactly.
function findMatch(groups, file, fileKey, groupKey, match) {
  let lo = 0; let hi = groups.length;
  const v = file[fileKey] || '';
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hcmp(groups[mid][groupKey], v) < 0) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < groups.length && hcmp(groups[i][groupKey], v) === 0; i++) if (match(groups[i], file)) return groups[i];
  return null;
}

function mergeInMissingFiles(idx, missingFiles, thWrk) {
  for (const f of missingFiles) {
    if (thWrk.cancelled) return;
    if (f.AltSize != null || f.AltCRC != null || f.AltSHA1 != null || f.AltMD5 != null) throw new Error('Missing files cannot have alt values');
    const alt = (fk, gk, list) => { const g = findMatch(list, f, fk, gk, (x, y) => x.findAltExactMatch(y)); if (g) { g.mergeAltFileIntoGroup(f); return true; } return false; };
    const main = (k, list) => { const g = findMatch(list, f, k, k, (x, y) => x.findExactMatch(y)); if (g) { g.mergeFileIntoGroup(f); return true; } return false; };
    if (f.HeaderFileType !== HeaderFileType.Nothing) {
      if (f.CRC != null && alt('CRC', 'AltCRC', idx.altCrc)) continue;
      if (f.SHA1 != null && alt('SHA1', 'AltSHA1', idx.altSha1)) continue;
      if (f.MD5 != null && alt('MD5', 'AltMD5', idx.altMd5)) continue;
    }
    if (f.CRC != null && main('CRC', idx.crc)) continue;
    if (f.SHA1 != null && main('SHA1', idx.sha1)) continue;
    if (f.MD5 != null && main('MD5', idx.md5)) continue;
    if (f.CRC == null && f.SHA1 == null && f.MD5 == null) {
      if (f.Size === 0) idx.crc[0].mergeFileIntoGroup(f);
      else if (f.Size == null && f.Name.length > 1 && f.Name.endsWith('/')) idx.crc[0].mergeFileIntoGroup(f);
    }
  }
}

// thWrk: { text(s), progress(n), range(n), cancelled }
function findFixes(thWrk) {
  let n = 0;
  const cancel = () => { if (!thWrk.cancelled) return false; thWrk.text('Cancelling'); reportStatusReset(DB.DirRoot); thWrk.text('Cancelled'); return true; };
  thWrk.range(5);
  thWrk.text('Clearing DB Status'); thWrk.progress(n++);
  reportStatusReset(DB.DirRoot);
  if (cancel()) return null;
  thWrk.text('Getting Selected Files'); thWrk.progress(n++);
  const got = []; const missing = [];
  getSelectedFiles(DB.DirRoot, true, got, missing);
  if (cancel()) return null;
  thWrk.text('Group all files by CRC (Sorted)'); thWrk.progress(n++);
  const crc = mergeGotFiles(got);
  if (cancel()) return null;
  thWrk.text('Creating Secondary Indexes'); thWrk.progress(n++);
  const idx = { crc, sha1: sortWithFilter(crc, 'SHA1'), md5: sortWithFilter(crc, 'MD5'), altCrc: sortWithFilter(crc, 'AltCRC'), altSha1: sortWithFilter(crc, 'AltSHA1'), altMd5: sortWithFilter(crc, 'AltMD5') };
  if (cancel()) return null;
  thWrk.text('Merging in missing file list'); thWrk.progress(n++);
  mergeInMissingFiles(idx, missing, thWrk);
  if (cancel()) return null;
  thWrk.text('Finding Fixes'); thWrk.progress(n++);
  for (const g of crc) listCheck(g);
  ClearPartial.checkGroups.clear();
  ClearPartial.checkRemovePartial(DB.DirRoot.child(0));
  ClearPartial.checkAllGroups();
  toSortZeroByteFilesDontFix(crc[0]);
  thWrk.text(`Complete (Unique Files ${crc.length})`);
  return { uniqueFiles: crc.length };
}

module.exports = { findFixes, FileGroup, listCheck, ClearPartial, getSelectedFiles };
