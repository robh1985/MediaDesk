// Ported from RomVault (RVWorld: libraries/SortMethods/Sorters.cs, Libraries/StorageList/BinarySearch.cs,
// RomVaultCore/RVSorters.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk.
'use strict';

const { FileType } = require('./enums');

// JavaScript string comparison is by UTF-16 code unit, the same as .NET's StringComparison.Ordinal.
function ordinal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

const Sorters = {
  StringCompare: ordinal,

  // (trrnt)Zips are sorted case-insensitively for A to Z only, then case-sensitively.
  TrrntZipStringCompare(s1, s2) {
    let p1 = 0; let p2 = 0;
    for (;;) {
      if (p1 === s1.length) return p2 === s2.length ? 0 : -1;
      if (p2 === s2.length) return 1;
      let b1 = s1.charCodeAt(p1++); let b2 = s2.charCodeAt(p2++);
      if (b1 >= 65 && b1 <= 90) b1 += 0x20;
      if (b2 >= 65 && b2 <= 90) b2 += 0x20;
      if (b1 < b2) return -1;
      if (b1 > b2) return 1;
    }
  },
  TrrntZipStringCompareCase(s1, s2) {
    const res = Sorters.TrrntZipStringCompare(s1, s2);
    return res !== 0 ? res : ordinal(s1, s2);
  },
  DirectoryNameCompare(s1, s2) { return ordinal(s1.toLowerCase(), s2.toLowerCase()); },
  DirectoryNameCompareCase(s1, s2) {
    const res = Sorters.DirectoryNameCompare(s1, s2);
    return res !== 0 ? res : ordinal(s1, s2);
  },
  // SevenZip files are sorted case-sensitively by extension, then name, then path.
  Trrnt7ZipStringCompare(s1, s2) {
    const a = splitFilename(s1); const b = splitFilename(s2);
    return ordinal(a.ext, b.ext) || ordinal(a.name, b.name) || ordinal(a.path, b.path);
  },
};

function splitFilename(filename) {
  let path = ''; let name = filename;
  const dirIndex = filename.lastIndexOf('/');
  if (dirIndex >= 0) { path = filename.substring(0, dirIndex); name = filename.substring(dirIndex + 1); }
  let ext = '';
  const extIndex = name.lastIndexOf('.');
  if (extIndex >= 0) { ext = name.substring(extIndex + 1); name = name.substring(0, extIndex); }
  return { path, name, ext };
}

// StorageList.BinarySearch.ListSearch: returns { res, index }. index is the first match, or the insert point.
function listSearch(list, item, compare) {
  let bottom = 0; let top = list.length; let mid = 0; let res = -1;
  while (bottom < top && res !== 0) {
    mid = (bottom + top) >> 1;
    res = compare(item, list[mid]);
    if (res < 0) top = mid;
    else if (res > 0) bottom = mid + 1;
  }
  let index = mid;
  if (res === 0) {
    while (index > 0 && compare(item, list[index - 1]) === 0) index--;
  } else if (res > 0) {
    index++;
  }
  return { res, index };
}

// RVSorters
function compareNameRaw(f1, name1, f2, name2) {
  if (f1 === FileType.FileZip || f2 === FileType.FileZip) return Sorters.TrrntZipStringCompareCase(name1, name2);
  if (f1 === FileType.FileSevenZip || f2 === FileType.FileSevenZip) return Sorters.Trrnt7ZipStringCompare(name1, name2);
  const res = Sorters.DirectoryNameCompare(name1, name2);
  if (res !== 0) return res;
  return Math.sign(f1 - f2);
}

const RVSorters = {
  // Works for RvFile, DatBase and ScannedFile: all have FileType and Name.
  CompareName(a, b) { return compareNameRaw(a.FileType, a.Name, b.FileType, b.Name); },
  CompareDirName(a, b) { return Sorters.DirectoryNameCompare(a.Name, b.Name); },
  CompareDirNameCase(a, b) { return Sorters.DirectoryNameCompareCase(a.Name, b.Name); },
  // string.Compare(..., CurrentCultureIgnoreCase)
  CompareDatNameStr(a, b) { return Math.sign(String(a).localeCompare(String(b), undefined, { sensitivity: 'accent' })); },
};

module.exports = { Sorters, listSearch, RVSorters, ordinal };
