// Ported from RomVault (RVWorld: DAT/DATReader/DatStore/*.cs, DAT/DATReader/Utils/VarFix.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
// Hashes are lower-case hex strings.
'use strict';

const { FileType, DatStatus, HeaderFileType } = require('../enums');
const { Sorters } = require('../sorters');

class DatBase {
  constructor(name, type) { this.Name = name; this.FileType = type; this.DatStatus = DatStatus.InDatCollect; this.DateModified = null; }
  get IsDirectory() { return this instanceof DatDir; }
}

class DatFile extends DatBase {
  constructor(name, type) {
    super(name, type);
    this.Size = null; this.CRC = null; this.SHA1 = null; this.MD5 = null; this.SHA256 = null;
    this.Merge = null; this.Status = null; this.Region = null; this.MIA = null; this.Header = null;
    this.HeaderFileType = HeaderFileType.Nothing;
    this.isDisk = false;
  }
  clone() { const c = new DatFile(this.Name, this.FileType); Object.assign(c, this); return c; }
}

class DatGame {
  constructor(src) {
    this.Id = null; this.Description = null; this.Manufacturer = null; this.History = null; this.CloneOf = null;
    this.CloneOfId = null; this.RomOf = null; this.SampleOf = null; this.SourceFile = null; this.IsBios = null;
    this.IsDevice = null; this.Board = null; this.Year = null; this.Runnable = null; this.Serial = null;
    this.Version = null; this.GameId = null; this.Category = null; this.device_ref = null; this.IsEmuArc = false;
    this.Publisher = null; this.Developer = null; this.Genre = null; this.SubGenre = null; this.Ratings = null;
    this.Score = null; this.Players = null; this.Enabled = null; this.CRC = null; this.Source = null;
    this.RelatedTo = null; this.gameHash = null; this.found = false;
    if (src) {
      Object.assign(this, src);
      if (src.Category) this.Category = [...src.Category];
      if (src.device_ref) this.device_ref = [...src.device_ref];
    }
  }
}

class DatDir extends DatBase {
  constructor(name, type) {
    super(name, type);
    this._datStruct = 0;
    this.DGame = null;
    this._children = [];
    this._childrenNameIndex = [];
  }
  get DatStruct() { return this._datStruct & 0x7f; }
  get DatStructFix() { return (this._datStruct & 0x80) === 0x80; }
  setDatStruct(zs, fix) { this._datStruct = zs | (fix ? 0x80 : 0); }

  clone() {
    const d = new DatDir(this.Name, this.FileType);
    d.DatStatus = this.DatStatus; d.DateModified = this.DateModified; d._datStruct = this._datStruct;
    d.DGame = this.DGame ? new DatGame(this.DGame) : null;
    d._children = this._children.map((c) => c.clone());
    d._childrenNameIndex = [...this._childrenNameIndex];
    return d;
  }

  get Count() { return this._children.length; }
  at(i) { return this._children[i]; }
  childSorted(i) { return this.FileType === FileType.UnSet ? this._children[this._childrenNameIndex[i]] : this._children[i]; }
  toArray() { return [...this._children]; }

  childAdd(item) {
    if (this.FileType === FileType.UnSet) {
      const s = this._binarySearch(item, true, false);
      this._children.push(item);
      const index = this._children.length - 1;
      this._childrenNameIndex.splice(s.index, 0, index);
      return index;
    }
    const s = this._binarySearch(item, false, false);
    this._children.splice(s.index, 0, item);
    return s.index;
  }

  childRemove(item) {
    const i = this._children.indexOf(item);
    if (i < 0) return;
    this._children.splice(i, 1);
    if (this.FileType !== FileType.UnSet) return;
    const idx = this._childrenNameIndex;
    for (let j = 0; j < idx.length; j++) {
      if (idx[j] === i) { idx.splice(j, 1); j--; } else if (idx[j] > i) idx[j]--;
    }
  }

  childrenClear() { this._children = []; this._childrenNameIndex = []; }

  // returns { res, index } where index is into _children (or -1 if not found for UnSet dirs)
  childNameSearch(item) {
    if (this.FileType !== FileType.UnSet) return this._binarySearch(item, false, true);
    const s = this._binarySearch(item, true, true);
    return { res: s.res, index: s.res === 0 ? this._childrenNameIndex[s.index] : -1 };
  }

  childNameSearchAdd(dirFind) {
    const s = this.childNameSearch(dirFind);
    if (s.res !== 0) { this.childAdd(dirFind); return dirFind; }
    return this._children[s.index];
  }

  _binarySearch(item, useIndex, findFirst) {
    const ch = this._children; const idx = this._childrenNameIndex;
    const get = (k) => ch[useIndex ? idx[k] : k];
    let bottom = 0; let top = ch.length; let mid = 0; let res = -1;
    while (bottom < top && res !== 0) {
      mid = (bottom + top) >> 1;
      res = this._sortCompareName(item, get(mid));
      if (res < 0) top = mid; else if (res > 0) bottom = mid + 1;
    }
    let index = mid;
    if (res === 0) {
      if (findFirst) {
        while (index > 0 && this._sortCompareName(item, get(index - 1)) === 0) index--;
      } else {
        let r1 = 0;
        while (index < ch.length - 1 && r1 === 0) { r1 = this._sortCompareName(item, get(index + 1)); if (r1 === 0) index++; }
        if (r1 === 0) index++;
      }
    } else if (res > 0) index++;
    return { res, index };
  }

  _sortCompareName(a, b) {
    let res;
    switch (this.FileType) {
      case FileType.UnSet: res = Sorters.StringCompare(a.Name, b.Name); break;
      case FileType.Dir: res = Sorters.DirectoryNameCompareCase(a.Name, b.Name); break;
      case FileType.Zip: res = Sorters.TrrntZipStringCompareCase(a.Name, b.Name); break;
      case FileType.SevenZip: res = Sorters.Trrnt7ZipStringCompare(a.Name, b.Name); break;
      default: throw new Error('Invalid directory compare type ' + this.FileType);
    }
    if (res !== 0) return res;
    return Math.sign(a.FileType - b.FileType);
  }
}

class DatHeader {
  constructor() {
    this.Id = null; this.Filename = null; this.MameXML = false; this.Name = null; this.Type = null; this.RootDir = null;
    this.Description = null; this.Subset = null; this.Category = null; this.Version = null; this.Date = null;
    this.Author = null; this.Email = null; this.Homepage = null; this.URL = null; this.Comment = null;
    this.Header = null; this.Compression = null; this.MergeType = null; this.Split = null; this.NoDump = null;
    this.Dir = null; this.NotZipped = false; this.BaseDir = null;
  }
}

// ------------------------------------------------------------------------------------------------ VarFix
const VarFix = {
  stringYesNo(b) { return b != null && (/^yes$/i.test(b) || /^true$/i.test(b)); },
  ulong(n) {
    if (n == null) return null;
    n = String(n);
    if (!n || n === '-') return null;
    if (n.length >= 2 && /^0x/i.test(n)) { const v = parseInt(n.substring(2), 16); return Number.isFinite(v) ? v : null; }
    if (!/^\s*\+?\d+\s*$/.test(n)) return null;
    return Number(n.trim());
  },
  cleanCHD(n) { let d = n ?? ''; if (/\.chd$/i.test(d)) d = d.substring(0, d.length - 4); return d; },
  string(n) { return n ?? ''; },
  cleanMD5SHA1(checksum, length) {
    if (checksum == null || checksum === '') return null;
    checksum = String(checksum).toLowerCase().trim();
    if (checksum.startsWith('0x')) checksum = checksum.substring(2);
    if (!checksum || checksum === '-') return null;
    while (checksum.length < length) checksum = '0' + checksum;
    if (checksum.length % 2) checksum = checksum.slice(0, -1);
    if (!/^[0-9a-f]*$/.test(checksum)) return null;
    return checksum;
  },
  cleanFileName(name, crep = '-') {
    if (!name) return '';
    let r = name.replace(/^\s+/, '').replace(/[. ]+$/, '');
    let out = '';
    for (const ch of r) {
      const c = ch.charCodeAt(0);
      out += (ch === ':' || ch === '*' || ch === '?' || ch === '<' || ch === '>' || ch === '|' || ch === '"' || ch === '\\' || ch === '/' || c < 32) ? crep : ch;
    }
    return out;
  },
  toLower(n) { return (n ?? '').toLowerCase(); },
};

module.exports = { DatBase, DatFile, DatDir, DatGame, DatHeader, VarFix };
