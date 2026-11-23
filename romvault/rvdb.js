// Ported from RomVault (RVWorld: RomVaultCore/RvDB/*.cs, RomVaultCore/Utils/DBTypeGet.cs, IsFileOnly.cs,
// RomVaultCore/ReadDat/DatReader.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk. Changes: hashes are lower-case hex strings, the database
// cache is JSON instead of RomVault's binary cache, and MIA (missing in action) tracking is left out.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  FileType, DatStatus, GotStatus, RepStatus, FileStatus, HeaderFileType, ZipStructure, ToSortDirType, DatFlags,
  DatUpdateStatus, TreeSelect, EFile, RemoveSubType, ZeroByteCRC, ZeroByteMD5, ZeroByteSHA1,
} = require('./enums');
const { statusCheck, ReportStatus } = require('./repairStatus');
const { listSearch, RVSorters } = require('./sorters');
const { state, findDatRule, SEP } = require('./settings');

const MIN_TIME = null; // long.MinValue: "no time stamp"

const log = { errors: [], error(msg) { this.errors.push(msg); if (this.errors.length > 500) this.errors.shift(); } };

function isRooted(p) { return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/'); }
function treeJoin(a, b) { if (!a) return b; if (isRooted(b)) return b; return a + SEP + b; }

// ------------------------------------------------------------------------------------------------ RvTreeRow
class RvTreeRow {
  constructor(expanded = true, checked = TreeSelect.Selected) { this.TreeExpanded = expanded; this.Checked = checked; }
  setTreeExpanded(v) { this.TreeExpanded = v; }
  setChecked(v) { this.Checked = v; }
}

// ------------------------------------------------------------------------------------------------ RvGame
const GameData = {
  Id: 11, Description: 1, RomOf: 2, IsBios: 3, Sourcefile: 4, CloneOf: 5, CloneOfId: 24, SampleOf: 6, Board: 7,
  Year: 8, Manufacturer: 9, EmuArc: 10, Publisher: 12, Developer: 13, Genre: 14, SubGenre: 15, Ratings: 16,
  Score: 17, Players: 18, Enabled: 19, CRC: 20, RelatedTo: 21, Source: 22, Category: 23, Serial: 25, Version: 26,
  GameId: 27,
};

class RvGame {
  constructor(src) {
    this.data = []; // sorted [id, value]
    if (Array.isArray(src)) { this.data = src.map((x) => [x[0], x[1]]); return; }
    if (typeof src === 'string') { this.addData(GameData.Description, src); return; }
    if (src) {
      const g = src;
      const chk = (v, id) => { if (v != null && String(v).trim()) this.addData(id, String(v)); };
      chk(g.Id, GameData.Id);
      chk(g.Description, GameData.Description);
      chk(g.Category ? g.Category.join(' | ') : null, GameData.Category);
      chk(g.RomOf, GameData.RomOf);
      chk(g.IsBios, GameData.IsBios);
      chk(g.SourceFile, GameData.Sourcefile);
      chk(g.CloneOf, GameData.CloneOf);
      chk(g.CloneOfId, GameData.CloneOfId);
      chk(g.SampleOf, GameData.SampleOf);
      chk(g.Board, GameData.Board);
      chk(g.Year, GameData.Year);
      chk(g.Manufacturer, GameData.Manufacturer);
      chk(g.Serial, GameData.Serial);
      chk(g.Version, GameData.Version);
      chk(g.GameId, GameData.GameId);
      if (g.IsEmuArc) {
        this.addData(GameData.EmuArc, 'yes');
        for (const k of ['Publisher', 'Developer', 'Genre', 'SubGenre', 'Ratings', 'Score', 'Players', 'Enabled', 'CRC', 'RelatedTo', 'Source']) chk(g[k], GameData[k]);
      }
    }
  }
  addData(id, val) {
    if (!val) return;
    let pos = 0;
    while (pos < this.data.length && this.data[pos][0] < id) pos++;
    this.data.splice(pos, 0, [id, val]);
  }
  getData(id) {
    for (const [i, v] of this.data) { if (i === id) return v; if (id < i) return ''; }
    return '';
  }
  equals(other) {
    if (this.data.length !== other.data.length) return false;
    return this.data.every((d, i) => d[0] === other.data[i][0] && d[1] === other.data[i][1]);
  }
  toJSON() { return this.data; }
}

// ------------------------------------------------------------------------------------------------ RvDat
const DatData = {
  Id: 0, DatName: 1, DatRootFullName: 2, RootDir: 3, Description: 4, Category: 5, Version: 6, Date: 7, Author: 8,
  Email: 9, HomePage: 10, URL: 11, FileType: 12, MergeType: 13, SuperDat: 14, DirSetup: 15, Header: 16,
  SubDirType: 17, Compression: 18,
};

class RvDat {
  constructor() { this.meta = []; this.DatIndex = -1; this.Status = DatUpdateStatus.Correct; this.TimeStamp = 0; this.datFlags = 0; }

  static fromImport(fileDat) {
    const d = new RvDat();
    const h = fileDat.datHeader;
    d.Status = DatUpdateStatus.Correct;
    d.TimeStamp = fileDat.TimeStamp;
    d.setData(DatData.Id, h.Id);
    d.setData(DatData.DatName, h.Name);
    d.setData(DatData.DatRootFullName, fileDat.DatFullName);
    d.setData(DatData.RootDir, h.RootDir);
    d.setData(DatData.Description, h.Description);
    d.setData(DatData.Category, h.Category);
    d.setData(DatData.Version, h.Version);
    d.setData(DatData.Date, h.Date);
    d.setData(DatData.Author, h.Author);
    d.setData(DatData.Email, h.Email);
    d.setData(DatData.HomePage, h.Homepage);
    d.setData(DatData.URL, h.URL);
    d.setData(DatData.DirSetup, h.Dir);
    d.setData(DatData.Header, h.Header);
    d.setData(DatData.Compression, h.Compression);
    d.datFlags = fileDat.Flags;
    d.SubDirType = fileDat.SubDirType;
    return d;
  }

  static fromJSON(j) { const d = new RvDat(); d.TimeStamp = j.t; d.datFlags = j.f; d.meta = j.m.map((x) => [x[0], x[1]]); return d; }
  toJSON() { return { t: this.TimeStamp, f: this.datFlags, m: this.meta }; }

  invalidateDatTimeStamp() { this.TimeStamp = Number.MAX_SAFE_INTEGER; }
  get SubDirType() {
    const t = this.getData(DatData.SubDirType);
    return t && t.trim() ? parseInt(t, 10) : RemoveSubType.KeepAllSubDirs;
  }
  set SubDirType(v) { this.setData(DatData.SubDirType, String(v | 0)); }
  flag(f) { return (this.datFlags & f) !== 0; }
  setFlag(f, v) { this.datFlags &= ~f; if (v) this.datFlags |= f; }
  setFlags(f) { this.datFlags = f; }
  setData(id, val) {
    if (val == null || !String(val).trim()) return;
    let pos = 0;
    while (pos < this.meta.length && this.meta[pos][0] < id) pos++;
    if (pos >= this.meta.length || this.meta[pos][0] !== id) { this.meta.splice(pos, 0, [id, String(val)]); return; }
    this.meta[pos] = [id, String(val)];
  }
  getData(id) {
    for (const [i, v] of this.meta) { if (i === id) return v; if (id < i) return ''; }
    return '';
  }
}

// ------------------------------------------------------------------------------------------------ RvFile
class RvFile {
  constructor(type) {
    this.FileType = type;
    this.Name = null;
    this.FileName = null;
    this.Parent = null;
    this.Dat = null;
    this.FileModTimeStamp = MIN_TIME;
    this.SearchFound = false;
    this._headerFileType = HeaderFileType.Nothing;
    this._datStatus = DatStatus.NotInDat;
    this._gotStatus = GotStatus.NotGot;
    this._repStatus = RepStatus.UnSet;
    this._ZipDatStruct = 0;
    this.ZipStruct = ZipStructure.None;
    this.Tree = null;
    this.Game = null;
    this.UiDisplayName = null;
    this._toSortType = ToSortDirType.None;
    this.FileGroup = null;
    this.Size = null; this.CRC = null; this.SHA1 = null; this.MD5 = null;
    this.AltSize = null; this.AltCRC = null; this.AltSHA1 = null; this.AltMD5 = null;
    this.Merge = null;
    this.Status = null;
    this._fileStatus = 0;
    this.ZipFileIndex = -1;
    this.ZipFileHeaderPosition = null;
    this.CHDVersion = null;
    if (this.IsDirectory) {
      this._dirDats = [];
      this._children = [];
      this.DirStatus = new ReportStatus();
    } else {
      this._dirDats = null;
      this._children = null;
      this.DirStatus = null;
    }
  }

  // --- header type
  get HeaderFileType() { return this._headerFileType & HeaderFileType.HeaderMask; }
  get HeaderFileTypeRequired() { return (this._headerFileType & HeaderFileType.Required) !== 0; }
  set HeaderFileTypeSet(v) { this._headerFileType = v; }

  // --- zip structure
  get ZipDatStruct() { return this._ZipDatStruct & 0x7f; }
  get ZipDatStructFix() { return (this._ZipDatStruct & 0x80) === 0x80; }
  setZipDatStruct(zs, fix) { this._ZipDatStruct = zs | (fix ? 0x80 : 0); }
  get newZipStruct() {
    return (this.DatStatus === DatStatus.NotInDat || this.DatStatus === DatStatus.InToSort) ? this.ZipStruct : this.ZipDatStruct;
  }

  // --- names and paths
  get TreeFullName() { return this.Parent == null ? (this.Name || '') : treeJoin(this.Parent.TreeFullName, this.Name); }
  get TreeBarName() {
    if (this.Parent == null) return this.Name || '';
    const p = this.Parent.TreeBarName;
    return p ? p + '|' + this.Name : this.Name;
  }
  get NameCase() { return this.FileName && this.FileName.trim() ? this.FileName : this.Name; }
  get TreeFullNameCase() { return this.Parent == null ? (this.NameCase || '') : treeJoin(this.Parent.TreeFullNameCase, this.NameCase); }
  get FullName() { return RvFile.getPhysicalPath(this.TreeFullName); }
  get FullNameCase() { return RvFile.getPhysicalPath(this.TreeFullNameCase); }

  // Map a tree path to a real path, using the longest matching directory mapping.
  static getPhysicalPath(dirTree) {
    if (dirTree == null) return null;
    let full = ''; let lenFound = 0;
    for (const m of state.rvSettings.DirMappings) {
      if (!m.DirPath || !String(m.DirPath).trim()) continue;
      const key = m.DirKey;
      if (dirTree.length === key.length && dirTree === key) {
        if (lenFound < key.length) { lenFound = key.length; full = m.DirPath; continue; }
      }
      if (dirTree.length > key.length && dirTree.substring(0, key.length + 1) === key + SEP) {
        if (lenFound < key.length) { lenFound = key.length; full = treeJoin(m.DirPath, dirTree.substring(key.length + 1)); }
      }
    }
    if (full === '') full = dirTree;
    return toOsPath(full);
  }

  get DatTreeFullName() { return getDatTreePath(this.TreeFullName); }
  static getDatPhysicalPath(rootPath) {
    const datRoot = state.rvSettings.DatRoot;
    if (rootPath === '') return toOsPath(datRoot);
    if (rootPath.substring(0, 6) === 'ToSort') return 'Error';
    if (rootPath.substring(0, 7) === 'DatRoot') return toOsPath(datRoot + rootPath.substring(7));
    return toOsPath(datRoot);
  }
  get IsInToSort() { return this.DatStatus === DatStatus.InToSort; }

  static treeType(f) {
    if (f == null) return TreeSelect.Locked;
    if (f.Tree != null) return f.Tree.Checked;
    return RvFile.treeType(f.Parent);
  }

  // --- statuses
  get DatStatus() { return this._datStatus; }
  set DatStatus(v) { this._datStatus = v; this.repStatusReset(); }
  get DatStatusReal() { return this._datStatus; }
  get GotStatus() { return this._gotStatus; }
  set GotStatus(v) { this._gotStatus = v; this.repStatusReset(); }
  get RepStatus() { return this._repStatus; }
  set RepStatus(value) {
    const old = this._repStatus;
    const rs = statusCheck(this.FileType, this.DatStatus, this.GotStatus);
    if (rs == null || !rs.includes(value)) {
      log.error(`${this.FullName}: cannot set status ${value} (type ${this.FileType}, dat ${this._datStatus}, got ${this._gotStatus}, was ${this._repStatus})`);
      this._repStatus = RepStatus.Error;
    } else {
      this._repStatus = value;
    }
    if (old === this._repStatus) return;
    if (this.Parent) this.Parent._repStatusUpTreeUpdate(old, this._repStatus);
  }

  setDatGotStatus(dt, flag) { this._datStatus = dt; this._gotStatus = flag; this.repStatusReset(); }

  repStatusReset() {
    this.SearchFound = false;
    if (this.Parent != null &&
      (this.RepStatus === RepStatus.UnSet || this.RepStatus === RepStatus.Unknown || this.RepStatus === RepStatus.Ignore) &&
      this.FileType === FileType.File && this.GotStatus === GotStatus.Got && this.DatStatus === DatStatus.NotInDat) {
      const rule = findDatRule(this.DatTreeFullName);
      const list = rule ? rule.IgnoreFilesRegex : state.rvSettings.IgnoreFilesRegex;
      if (list) {
        for (const re of list) {
          if (re.test(this.Name)) { this.RepStatus = RepStatus.Ignore; return; }
        }
      }
    }
    const rs = statusCheck(this.FileType, this.DatStatus, this.GotStatus);
    this.RepStatus = rs ? rs[0] : RepStatus.Error;
  }

  // RomVault walks up until a game or DAT; a file no DAT knows has neither, so the port also stops at a tree folder.
  fileNameInsideGame() {
    if (this.Game != null || this.Dat != null || this.Parent == null || this.Parent.Tree != null) return this.Name;
    return treeJoin(this.Parent.fileNameInsideGame(), this.Name);
  }

  // --- directory
  get IsDirectory() { return this.FileType === FileType.Dir || this.FileType === FileType.Zip || this.FileType === FileType.SevenZip; }
  get DirDatCount() { return this._dirDats.length; }
  get ChildCount() { return this._children ? this._children.length : 0; }
  child(i) { return this._children[i]; }

  childAdd(c, index) {
    if (index === undefined) index = this.childNameSearch(c).index;
    if ((this.FileType === FileType.Dir && c.FileType === FileType.FileZip) ||
      (this.FileType === FileType.Zip && c.FileType !== FileType.FileZip) ||
      (this.FileType === FileType.SevenZip && c.FileType !== FileType.FileSevenZip)) {
      log.error(`Trying to add a ${c.FileType} to a ${this.FileType}`);
    }
    this._children.splice(index, 0, c);
    c.Parent = this;
    this._repStatusUpTreeAddRemove(c, 1);
    return index;
  }
  childRemove(index) {
    const c = this._children[index];
    this._repStatusUpTreeAddRemove(c, -1);
    if (c.Parent === this) c.Parent = null;
    this._children.splice(index, 1);
  }
  // returns { res, index }
  childNameSearch(typeOrFile, name) {
    const probe = typeof typeOrFile === 'number' ? { FileType: typeOrFile, Name: name } : typeOrFile;
    return listSearch(this._children, probe, RVSorters.CompareName);
  }
  findChild(f) {
    let { res, index } = this.childNameSearch(f);
    if (res !== 0) { log.error('Could not find self in parent ' + this.FullName); return { found: false, index }; }
    do {
      if (this._children[index] === f) return { found: true, index };
      index++;
    } while (index < this._children.length && RVSorters.CompareName(f, this._children[index]) === 0);
    return { found: false, index };
  }
  _repStatusUpTreeUpdate(oldS, newS) {
    for (let d = this; d; d = d.Parent) d.DirStatus.repStatusUpdate(oldS, newS);
  }
  _repStatusUpTreeAddRemove(item, dir) {
    for (let d = this; d; d = d.Parent) {
      d.DirStatus.repStatusAddRemove(item.RepStatus, dir);
      if (item.IsDirectory) d.DirStatus.repStatusArrayAddRemove(item.DirStatus, dir);
    }
  }

  toSortStatusSet(f) { this._toSortType |= f; }
  toSortStatusClear(f) { this._toSortType &= ~f; }
  toSortStatusIs(f) {
    let t = this;
    while (t.Parent && t.Parent !== DB.DirRoot) t = t.Parent;
    return (t._toSortType & f) === f;
  }

  // --- file
  get IsFile() { return this.FileType === FileType.File || this.FileType === FileType.FileZip || this.FileType === FileType.FileSevenZip; }
  fileStatusSet(flag, copyFrom) { this._fileStatus |= copyFrom ? (flag & copyFrom._fileStatus) : flag; }
  fileStatusClear(flag) { this._fileStatus &= ~flag; }
  fileStatusIs(flag) { return (this._fileStatus & flag) === flag; }

  static makeFileZero() {
    const z = new RvFile(FileType.File);
    z.Name = 'ZeroFile'; z.Size = 0; z.CRC = ZeroByteCRC; z.MD5 = ZeroByteMD5; z.SHA1 = ZeroByteSHA1;
    z.GotStatus = GotStatus.Got; z.DatStatus = DatStatus.InToSort;
    return z;
  }

  // ---------------------------------------------------------------------------------- RvFileCode (scanning)
  mergeInArchive(fileArchive) {
    this.markAsMissing();
    fileArchive.sort();
    let dbIdx = 0; let scIdx = 0;
    for (;;) {
      let dbChild = null; let sc = null; let res;
      if (dbIdx < this.ChildCount && scIdx < fileArchive.count) {
        dbChild = this.child(dbIdx); sc = fileArchive.at(scIdx); res = RVSorters.CompareName(dbChild, sc);
      } else if (scIdx < fileArchive.count) { sc = fileArchive.at(scIdx); res = 1; } else if (dbIdx < this.ChildCount) { dbChild = this.child(dbIdx); res = -1; } else break;
      if (res === 0) {
        const files = [sc]; let n = 1;
        while (scIdx + n < fileArchive.count && RVSorters.CompareName(dbChild, fileArchive.at(scIdx + n)) === 0) { files.push(fileArchive.at(scIdx + n)); n++; }
        const found = new Array(n).fill(false);
        for (let i = 0; i < n; i++) {
          const m = dbChild._compareWithAlt(files[i]);
          if (!m.matched) continue;
          found[i] = true;
          dbChild.fileMergeIn(files[i], m.altMatch);
        }
        dbIdx++;
        for (let i = 0; i < n; i++) if (!found[i]) this.fileAdd(files[i], dbIdx);
        scIdx += n;
      } else if (res === 1) {
        this.fileAdd(sc, dbIdx); dbIdx++; scIdx++;
      } else {
        dbIdx++;
      }
    }
  }

  fileAdd(scanned, index) {
    const f = RvFile.fromScanned(scanned);
    const ds = this.DatStatus === DatStatus.InToSort ? DatStatus.InToSort : DatStatus.NotInDat;
    f.setDatGotStatus(ds, scanned.GotStatus);
    this.childAdd(f, index);
    return f;
  }

  static fromScanned(s) {
    const f = new RvFile(s.FileType);
    f.Name = s.Name;
    f._headerFileType = s.HeaderFileType;
    f.ZipFileIndex = s.Index;
    f.ZipFileHeaderPosition = s.LocalHeaderOffset;
    f.Size = s.Size; f.CRC = s.CRC; f.SHA1 = s.SHA1; f.MD5 = s.MD5;
    f.AltSize = s.AltSize; f.AltCRC = s.AltCRC; f.AltSHA1 = s.AltSHA1; f.AltMD5 = s.AltMD5;
    f.FileModTimeStamp = s.FileModTimeStamp;
    f.CHDVersion = s.CHDVersion;
    f.fileStatusSet(s.StatusFlags);
    return f;
  }

  markAsMissing() {
    for (let i = 0; i < this.ChildCount; i++) {
      const c = this.child(i);
      if (c.fileRemove() === EFile.Delete) { this.childRemove(i); i--; continue; }
      if (c.FileType === FileType.Zip || c.FileType === FileType.SevenZip) c.markAsMissing();
      else if (c.FileType === FileType.Dir && c.Tree == null) c.markAsMissing();
    }
  }

  fileMergeIn(file, altFile) {
    if (file instanceof RvFile) return this._fileMergeInRv(file, altFile);
    if (altFile) this._setAsAltFile();
    this.fileCheckName(file);
    if (this.Size == null && file.Size != null) this.Size = file.Size;
    if (this.CRC == null && file.CRC != null) this.CRC = file.CRC;
    if (this.SHA1 == null && file.SHA1 != null) this.SHA1 = file.SHA1;
    if (this.MD5 == null && file.MD5 != null) this.MD5 = file.MD5;
    if (this.AltSize == null && file.AltSize != null) this.AltSize = file.AltSize;
    if (this.AltCRC == null && file.AltCRC != null) this.AltCRC = file.AltCRC;
    if (this.AltSHA1 == null && file.AltSHA1 != null) this.AltSHA1 = file.AltSHA1;
    if (this.AltMD5 == null && file.AltMD5 != null) this.AltMD5 = file.AltMD5;
    if (this.HeaderFileType === HeaderFileType.Nothing && file.HeaderFileType !== HeaderFileType.Nothing) this.HeaderFileTypeSet = file.HeaderFileType;
    this.ZipFileIndex = file.Index;
    this.ZipFileHeaderPosition = file.LocalHeaderOffset;
    this.FileModTimeStamp = file.FileModTimeStamp;
    if (file.CHDVersion != null) this.CHDVersion = file.CHDVersion;
    this.GotStatus = file.GotStatus;
    this.fileStatusSet(file.StatusFlags);
  }

  // RvFile -> ScannedFile, used to compare a cached directory against a new scan.
  fileOut(ScannedFile) {
    const s = new ScannedFile(this.FileType);
    s.Name = this.NameCase;
    s.FileModTimeStamp = this.FileModTimeStamp;
    s.GotStatus = this.GotStatus;
    s.ZipStruct = this.ZipStruct;
    s.LocalHeaderOffset = this.ZipFileHeaderPosition;
    s.DeepScanned = this.IsDeepScanned;
    s.StatusFlags = this._fileStatus & (FileStatus.HeaderFlags | FileStatus.VerifiedFlags);
    s.Index = this.ZipFileIndex;
    s.HeaderFileType = this.HeaderFileType;
    s.CHDVersion = this.CHDVersion;
    const fs_ = (a, b) => this.fileStatusIs(a) || this.fileStatusIs(b);
    if (fs_(FileStatus.SizeFromHeader, FileStatus.SizeVerified)) s.Size = this.Size;
    if (fs_(FileStatus.CRCFromHeader, FileStatus.CRCVerified)) s.CRC = this.CRC;
    if (fs_(FileStatus.SHA1FromHeader, FileStatus.SHA1Verified)) s.SHA1 = this.SHA1;
    if (fs_(FileStatus.MD5FromHeader, FileStatus.MD5Verified)) s.MD5 = this.MD5;
    if (fs_(FileStatus.AltSizeFromHeader, FileStatus.AltSizeVerified)) s.AltSize = this.AltSize;
    if (fs_(FileStatus.AltCRCFromHeader, FileStatus.AltCRCVerified)) s.AltCRC = this.AltCRC;
    if (fs_(FileStatus.AltSHA1FromHeader, FileStatus.AltSHA1Verified)) s.AltSHA1 = this.AltSHA1;
    if (fs_(FileStatus.AltMD5FromHeader, FileStatus.AltMD5Verified)) s.AltMD5 = this.AltMD5;
    if (this.IsDirectory) {
      for (let i = 0; i < this.ChildCount; i++) {
        const c = this.child(i);
        if (c.GotStatus === GotStatus.Got || c.GotStatus === GotStatus.Corrupt) s.add(c.fileOut(ScannedFile));
      }
    }
    return s;
  }

  _setAsAltFile() {
    if (this.fileStatusIs(FileStatus.SizeFromDAT)) { this.AltSize = this.Size; this.fileStatusSet(FileStatus.AltSizeFromDAT); }
    if (this.fileStatusIs(FileStatus.CRCFromDAT)) { this.AltCRC = this.CRC; this.fileStatusSet(FileStatus.AltCRCFromDAT); }
    if (this.fileStatusIs(FileStatus.SHA1FromDAT)) { this.AltSHA1 = this.SHA1; this.fileStatusSet(FileStatus.AltSHA1FromDAT); }
    if (this.fileStatusIs(FileStatus.MD5FromDAT)) { this.AltMD5 = this.MD5; this.fileStatusSet(FileStatus.AltMD5FromDAT); }
    this.Size = null; this.CRC = null; this.SHA1 = null; this.MD5 = null;
    this.fileStatusClear(FileStatus.SizeFromDAT | FileStatus.CRCFromDAT | FileStatus.SHA1FromDAT | FileStatus.MD5FromDAT);
  }

  fileCheckName(file) {
    if (this.DatStatus === DatStatus.NotInDat || this.DatStatus === DatStatus.InToSort) this.Name = file.Name;
    this.FileName = this.Name === file.Name ? null : file.Name;
  }

  fileRemove() {
    if (this.IsFile) {
      this.ZipFileIndex = -1;
      this.ZipFileHeaderPosition = null;
      if (this._testRemove() === EFile.Delete) return EFile.Delete;
      if (!this.fileStatusIs(FileStatus.DateFromDAT)) this.FileModTimeStamp = MIN_TIME;
      if (!this.fileStatusIs(FileStatus.HeaderFileTypeFromDAT)) this.HeaderFileTypeSet = HeaderFileType.Nothing;
      if (!this.fileStatusIs(FileStatus.SizeFromDAT)) this.Size = null;
      if (!this.fileStatusIs(FileStatus.CRCFromDAT)) this.CRC = null;
      if (!this.fileStatusIs(FileStatus.SHA1FromDAT)) this.SHA1 = null;
      if (!this.fileStatusIs(FileStatus.MD5FromDAT)) this.MD5 = null;
      if (this.fileStatusIs(FileStatus.AltSizeFromDAT)) { this.Size = this.AltSize; this.fileStatusSet(FileStatus.SizeFromDAT); }
      if (this.fileStatusIs(FileStatus.AltCRCFromDAT)) { this.CRC = this.AltCRC; this.fileStatusSet(FileStatus.CRCFromDAT); }
      if (this.fileStatusIs(FileStatus.AltSHA1FromDAT)) { this.SHA1 = this.AltSHA1; this.fileStatusSet(FileStatus.SHA1FromDAT); }
      if (this.fileStatusIs(FileStatus.AltMD5FromDAT)) { this.MD5 = this.AltMD5; this.fileStatusSet(FileStatus.MD5FromDAT); }
      this.AltSize = null; this.AltCRC = null; this.AltSHA1 = null; this.AltMD5 = null;
      this.CHDVersion = null;
      this.fileStatusClear(FileStatus.DatAltFlags | FileStatus.HeaderFlags | FileStatus.VerifiedFlags);
      this.ZipStruct = ZipStructure.None;
      return EFile.Keep;
    }
    if (this.IsDirectory) { this.ZipStruct = ZipStructure.None; return this._testRemove(); }
    this.GotStatus = GotStatus.NotGot;
    this.FileModTimeStamp = MIN_TIME;
    return EFile.Keep;
  }

  _testRemove() {
    if (!this.fileStatusIs(FileStatus.DateFromDAT)) this.FileModTimeStamp = MIN_TIME;
    this.FileName = null;
    this.GotStatus = this.Parent && this.Parent.GotStatus === GotStatus.FileLocked ? GotStatus.FileLocked : GotStatus.NotGot;
    switch (this.DatStatus) {
      case DatStatus.InDatCollect: case DatStatus.InDatMerged: case DatStatus.InDatNoDump: return EFile.Keep;
      default: return EFile.Delete;
    }
  }

  _compareWithAlt(t) {
    if (this.FileModTimeStamp != null && this.FileModTimeStamp !== 0 && this.FileModTimeStamp !== t.FileModTimeStamp) return { matched: false, altMatch: false };
    if (this._compareHash(t)) return { matched: true, altMatch: false };
    if (this._compareAltHash(t)) return { matched: true, altMatch: true };
    return { matched: false, altMatch: false };
  }
  _compareHash(t) {
    let found = false;
    if (this.Size != null && t.Size != null) {
      if (this.Size !== t.Size) return false;
      if (t.Size === 0 && this.CRC == null && this.SHA1 == null && this.MD5 == null) return true;
    }
    if (this.CRC != null && t.CRC != null) { found = true; if (this.CRC !== t.CRC) return false; }
    if (this.SHA1 != null && t.SHA1 != null) { found = true; if (this.SHA1 !== t.SHA1) return false; }
    if (this.MD5 != null && t.MD5 != null) { found = true; if (this.MD5 !== t.MD5) return false; }
    return found;
  }
  _compareAltHash(t) {
    if (!altHeaderFile(t.HeaderFileType)) return false;
    if (this.HeaderFileType !== t.HeaderFileType) return false;
    let found = false;
    if (this.Size != null && t.AltSize != null && this.Size !== t.AltSize) return false;
    if (this.CRC != null && t.AltCRC != null) { found = true; if (this.CRC !== t.AltCRC) return false; }
    if (this.SHA1 != null && t.AltSHA1 != null) { found = true; if (this.SHA1 !== t.AltSHA1) return false; }
    if (this.MD5 != null && t.AltMD5 != null) { found = true; if (this.MD5 !== t.AltMD5) return false; }
    return found;
  }

  // Deprecated RvFile overload, still used by the fixer when it copies a found file over a DAT entry.
  _fileMergeInRv(file, altFile) {
    if (file.GotStatus === GotStatus.NotGot) log.error('Error setting got to a NotGot File');
    if (file.IsFile) {
      if (altFile) this._setAsAltFile();
      for (const k of ['Size', 'CRC', 'SHA1', 'MD5', 'AltSize', 'AltCRC', 'AltSHA1', 'AltMD5']) if (this[k] == null && file[k] != null) this[k] = file[k];
      if (this.HeaderFileType === HeaderFileType.Nothing && file.HeaderFileType !== HeaderFileType.Nothing) this.HeaderFileTypeSet = file.HeaderFileType;
      if (this.CHDVersion == null && file.CHDVersion != null) this.CHDVersion = file.CHDVersion;
      this.fileStatusSet(FileStatus.HeaderFlags | FileStatus.VerifiedFlags, file);
      this.ZipFileIndex = file.ZipFileIndex;
      this.ZipFileHeaderPosition = file.ZipFileHeaderPosition;
    }
    this.fileCheckName(file);
    if (file.FileType === FileType.File && this.FileModTimeStamp === file.FileModTimeStamp) {
      if (file.GotStatus === GotStatus.Corrupt) this.GotStatus = file.GotStatus;
      return;
    }
    this.FileModTimeStamp = file.FileModTimeStamp;
    this.GotStatus = file.GotStatus;
  }

  get IsDeepScanned() {
    if (this.IsFile) {
      if (state.rvSettings.CheckCHDVersion && this.HeaderFileType === HeaderFileType.CHD && this.CHDVersion == null) return false;
      if (this.fileStatusIs(FileStatus.AltCRCFromHeader) && !this.fileStatusIs(FileStatus.AltCRCVerified)) return false;
      if (this.fileStatusIs(FileStatus.AltSHA1FromHeader) && !this.fileStatusIs(FileStatus.AltSHA1Verified)) return false;
      if (this.fileStatusIs(FileStatus.AltMD5FromHeader) && !this.fileStatusIs(FileStatus.AltMD5Verified)) return false;
      return this.fileStatusIs(FileStatus.SizeVerified) && this.fileStatusIs(FileStatus.CRCVerified) &&
        this.fileStatusIs(FileStatus.SHA1Verified) && this.fileStatusIs(FileStatus.MD5Verified);
    }
    for (let i = 0; i < this.ChildCount; i++) {
      const z = this.child(i);
      if (z.IsFile && z.GotStatus === GotStatus.Got && !z.IsDeepScanned) return false;
    }
    return true;
  }

  // RvFile.CopyTo: used by the zip fixer to work on a temporary copy of each entry. (MIA is not ported.)
  copyTo(c) {
    c.Size = this.Size; c.CRC = this.CRC; c.SHA1 = this.SHA1; c.MD5 = this.MD5;
    c.Merge = this.Merge; c.Status = this.Status; c._fileStatus = this._fileStatus;
    c.AltSize = this.AltSize; c.AltCRC = this.AltCRC; c.AltSHA1 = this.AltSHA1; c.AltMD5 = this.AltMD5;
    c.ZipFileIndex = this.ZipFileIndex; c.ZipFileHeaderPosition = this.ZipFileHeaderPosition; c.CHDVersion = this.CHDVersion;
    if (c._headerFileType === HeaderFileType.Nothing) c._headerFileType = this._headerFileType;
    c.Name = this.Name; c.FileName = this.FileName; c.Dat = this.Dat;
    c.FileModTimeStamp = this.FileModTimeStamp;
    c._datStatus = this._datStatus; c._gotStatus = this._gotStatus;
    c.RepStatus = this.RepStatus;
    c.FileGroup = this.FileGroup;
  }

  fileTestFix(file) {
    if (this._testMatch(file, false)) return;
    if (!this._testMatch(file, true)) return;
    this._setAsAltFile();
  }
  _testMatch(file, alt) {
    let found = false;
    const p = alt ? 'Alt' : '';
    if (this.Size != null && file[p + 'Size'] != null) { found = true; if (this.Size !== file[p + 'Size']) return false; }
    if (this.CRC != null && file[p + 'CRC'] != null) { found = true; if (this.CRC !== file[p + 'CRC']) return false; }
    if (this.SHA1 != null && file[p + 'SHA1'] != null) { found = true; if (this.SHA1 !== file[p + 'SHA1']) return false; }
    if (this.MD5 != null && file[p + 'MD5'] != null) { found = true; if (this.MD5 !== file[p + 'MD5']) return false; }
    return found;
  }

  // ---------------------------------------------------------------------------------- RvFileDatCode (DAT update)
  countDats() { return this._dirDats ? this._dirDats.length : 0; }
  dirDat(i) { return this._dirDats[i]; }
  dirDatAdd(dat) { const { index } = listSearch(this._dirDats, dat, DBHelper.datCompare); this._dirDats.splice(index, 0, dat); }
  dirDatRemove(i) { this._dirDats.splice(i, 1); return this._dirDats.length; }

  datAddDirectory(dirName, index) {
    const d = new RvFile(FileType.Dir);
    d.Name = dirName; d.Tree = new RvTreeRow(); d.DatStatus = DatStatus.InDatCollect;
    this.childAdd(d, index);
    return d;
  }
  datAdd(datBase, rvDat, index) {
    const f = RvFile.fromDat(datBase, rvDat, this.Tree != null);
    this.childAdd(f, index);
    return f;
  }
  static fromDat(datBase, rvDat, parentHasTree) {
    const f = new RvFile(datBase.FileType);
    if (!datBase.IsDirectory) {
      const d = datBase;
      f.Name = d.Name; f.Size = d.Size; f.CRC = d.CRC; f.SHA1 = d.SHA1; f.MD5 = d.MD5;
      f.Merge = d.Merge; f.Status = d.Status; f.Dat = rvDat;
      f.DatStatus = d.DatStatus;
      f.HeaderFileTypeSet = d.HeaderFileType;
      if (d.DateModified != null) { f.FileModTimeStamp = d.DateModified; f.fileStatusSet(FileStatus.DateFromDAT); }
      if (f.HeaderFileType !== HeaderFileType.Nothing) f.fileStatusSet(FileStatus.HeaderFileTypeFromDAT);
      if (f.Size != null) f.fileStatusSet(FileStatus.SizeFromDAT);
      if (f.CRC != null) f.fileStatusSet(FileStatus.CRCFromDAT);
      if (f.SHA1 != null) f.fileStatusSet(FileStatus.SHA1FromDAT);
      if (f.MD5 != null) f.fileStatusSet(FileStatus.MD5FromDAT);
      return f;
    }
    const d = datBase;
    f.Name = d.Name; f.Dat = rvDat;
    f.DatStatus = d.DatStatus;
    f.setZipDatStruct(d.DatStruct, d.DatStructFix);
    if (d.DGame != null) f.Game = new RvGame(d.DGame);
    if (parentHasTree && f.Game == null && f.Tree == null) f.Tree = new RvTreeRow();
    for (const b of d.toArray()) f.childAdd(RvFile.fromDat(b, rvDat, f.Tree != null));
    return f;
  }

  datMergeIn(datBase, rvDat, altFile) {
    if (!datBase.IsDirectory) {
      const d = datBase;
      if (this.HeaderFileType === HeaderFileType.Nothing && d.HeaderFileType !== HeaderFileType.Nothing) this.HeaderFileTypeSet = d.HeaderFileType;
      if (d.HeaderFileType !== HeaderFileType.Nothing) this.fileStatusSet(FileStatus.HeaderFileTypeFromDAT);
      const p = altFile ? 'Alt' : '';
      for (const k of ['Size', 'CRC', 'SHA1', 'MD5']) {
        if (d[k] != null) { this.fileStatusSet(FileStatus[p + k + 'FromDAT']); if (this[p + k] == null) this[p + k] = d[k]; }
      }
      this.Merge = d.Merge;
      this.Status = d.Status;
      if (d.DateModified != null) { this.FileModTimeStamp = d.DateModified; this.fileStatusSet(FileStatus.DateFromDAT); }
    } else {
      const d = datBase;
      this.setZipDatStruct(d.DatStruct, d.DatStructFix);
      if (d.DGame != null) this.Game = new RvGame(d.DGame);
      if (this.Parent?.Tree != null && this.Game == null && this.Tree == null) this.Tree = new RvTreeRow();
      if (this._dirDats.length > 0) log.error('Setting Dir with a dat list');
    }
    if (this.GotStatus === GotStatus.NotGot) log.error('Error Adding DAT to NotGot File ' + this.GotStatus);
    this.setDatGotStatus(datBase.DatStatus, this.GotStatus);
    if (this.Name === datBase.Name) this.FileName = null;
    else { this.FileName = this.Name; this.Name = datBase.Name; }
    this.Dat = rvDat;
  }

  datRemove() {
    this.Tree = null;
    this.Game = null;
    this.setZipDatStruct(ZipStructure.None, false);
    if (this._dirDats) this._dirDats.length = 0;
    this.HeaderFileTypeSet = this.HeaderFileType;
    if (!this.fileStatusIs(FileStatus.HeaderFileTypeFromHeader) && this.fileStatusIs(FileStatus.HeaderFileTypeFromDAT)) this.HeaderFileTypeSet = HeaderFileType.Nothing;
    if (!this.fileStatusIs(FileStatus.SizeFromHeader) && !this.fileStatusIs(FileStatus.SizeVerified)) this.Size = null;
    if (!this.fileStatusIs(FileStatus.CRCFromHeader) && !this.fileStatusIs(FileStatus.CRCVerified)) this.CRC = null;
    if (!this.fileStatusIs(FileStatus.SHA1FromHeader) && !this.fileStatusIs(FileStatus.SHA1Verified)) this.SHA1 = null;
    if (!this.fileStatusIs(FileStatus.MD5FromHeader) && !this.fileStatusIs(FileStatus.MD5Verified)) this.MD5 = null;
    if (!this.fileStatusIs(FileStatus.AltSHA1FromHeader) && !this.fileStatusIs(FileStatus.AltSHA1Verified)) this.AltSHA1 = null;
    if (!this.fileStatusIs(FileStatus.AltMD5FromHeader) && !this.fileStatusIs(FileStatus.AltMD5Verified)) this.AltMD5 = null;
    if (this.fileStatusIs(FileStatus.DateFromDAT) && this.IsFile && !(this.GotStatus === GotStatus.Got || this.GotStatus === GotStatus.Corrupt)) this.FileModTimeStamp = MIN_TIME;
    this.fileStatusClear(FileStatus.DatFlags);
    this.Merge = '';
    this.Status = '';
    this.Dat = null;
    if (this.GotStatus === GotStatus.NotGot) return EFile.Delete;
    if (this.FileName) { this.Name = this.FileName; this.FileName = null; }
    this.DatStatus = DatStatus.NotInDat;
    return EFile.Keep;
  }

  // ---------------------------------------------------------------------------------- JSON cache
  toCache(dirDats) {
    const o = { t: this.FileType, n: this.Name };
    if (this.FileName) o.fn = this.FileName;
    if (this.FileModTimeStamp != null) o.ts = this.FileModTimeStamp;
    if (this.Dat) o.d = dirDats.get(this.Dat);
    o.ds = this._datStatus; o.gs = this._gotStatus;
    if (this.FileType === FileType.Zip || this.FileType === FileType.SevenZip) { o.zd = this._ZipDatStruct; o.zs = this.ZipStruct; }
    if (this.Tree) o.tr = [this.Tree.TreeExpanded ? 1 : 0, this.Tree.Checked];
    if (this.Game) o.g = this.Game.data;
    if (this._toSortType) o.tst = this._toSortType;
    if (this.IsDirectory) {
      if (this._dirDats.length) {
        const map = new Map(dirDats);
        o.dd = this._dirDats.map((d, i) => { map.set(d, i); return d.toJSON(); });
        dirDats = map;
      }
      if (this._children.length) o.c = this._children.map((c) => c.toCache(dirDats));
    }
    for (const k of ['Size', 'CRC', 'SHA1', 'MD5', 'AltSize', 'AltCRC', 'AltSHA1', 'AltMD5', 'Merge', 'Status', 'ZipFileHeaderPosition', 'CHDVersion']) {
      if (this[k] != null && this[k] !== '') o[k] = this[k];
    }
    if (this._headerFileType) o.h = this._headerFileType;
    if (this.ZipFileIndex >= 0) o.zi = this.ZipFileIndex;
    if (this._fileStatus) o.fs = this._fileStatus;
    return o;
  }

  static fromCache(o, parentDirDats, parent) {
    const f = new RvFile(o.t);
    f.Parent = parent;
    f.Name = o.n; f.FileName = o.fn || null;
    f.FileModTimeStamp = o.ts ?? MIN_TIME;
    if (o.d != null) f.Dat = parentDirDats[o.d];
    f._datStatus = o.ds; f._gotStatus = o.gs;
    if (parent && parent._datStatus === DatStatus.InToSort) f._datStatus = DatStatus.InToSort;
    if (o.zd != null) f._ZipDatStruct = o.zd;
    if (o.zs != null) f.ZipStruct = o.zs;
    if (o.tr) f.Tree = new RvTreeRow(!!o.tr[0], o.tr[1]);
    if (o.g) f.Game = new RvGame(o.g);
    f._toSortType = o.tst || 0;
    if (f.IsDirectory) {
      if (o.dd) { f._dirDats = o.dd.map((j, i) => { const d = RvDat.fromJSON(j); d.DatIndex = i; return d; }); parentDirDats = f._dirDats; }
      if (o.c) f._children = o.c.map((c) => RvFile.fromCache(c, parentDirDats, f));
    }
    for (const k of ['Size', 'CRC', 'SHA1', 'MD5', 'AltSize', 'AltCRC', 'AltSHA1', 'AltMD5', 'Merge', 'Status', 'ZipFileHeaderPosition', 'CHDVersion']) {
      if (o[k] != null) f[k] = o[k];
    }
    f._headerFileType = o.h || 0;
    f.ZipFileIndex = o.zi ?? -1;
    f._fileStatus = o.fs || 0;
    return f;
  }
}

// Recompute statuses and directory counts after loading a cache (RvFile's binary reader resets every status).
function rebuildStatus(f) {
  if (f.IsDirectory) {
    f.DirStatus = new ReportStatus();
    for (const c of f._children) rebuildStatus(c);
  }
  const parent = f.Parent;
  f.Parent = null; // set the status without pushing counts up the tree; the parent adds them below
  f._repStatus = RepStatus.UnSet;
  f.Parent = parent;
  const rs = statusCheck(f.FileType, f.DatStatus, f.GotStatus);
  let s = rs ? rs[0] : RepStatus.Error;
  if (parent != null && f.FileType === FileType.File && f.GotStatus === GotStatus.Got && f.DatStatus === DatStatus.NotInDat) {
    const rule = findDatRule(f.DatTreeFullName);
    const list = rule ? rule.IgnoreFilesRegex : state.rvSettings.IgnoreFilesRegex;
    if (list && list.some((re) => re.test(f.Name))) s = RepStatus.Ignore;
  }
  f._repStatus = s;
  if (f.IsDirectory) {
    for (const c of f._children) {
      f.DirStatus.repStatusAddRemove(c._repStatus, 1);
      if (c.IsDirectory) f.DirStatus.repStatusArrayAddRemove(c.DirStatus, 1);
    }
  }
}

function altHeaderFile(h) {
  return h === HeaderFileType.A7800 || h === HeaderFileType.Lynx || h === HeaderFileType.NES || h === HeaderFileType.FDS ||
    h === HeaderFileType.PCE || h === HeaderFileType.PSID || h === HeaderFileType.SNES || h === HeaderFileType.SPC || h === HeaderFileType.CHD;
}

function getDatTreePath(rootPath) {
  if (rootPath === '') return 'DatRoot';
  if (rootPath.startsWith('RomVault')) return 'DatRoot' + rootPath.substring(8);
  return 'Error';
}

function toOsPath(p) {
  if (path.sep === '\\') return p;
  return p.split('\\').join(path.sep);
}

// ------------------------------------------------------------------------------------------------ DB
const DB = {
  DirRoot: null,

  openDefault() {
    const root = new RvFile(FileType.Dir);
    root.Tree = new RvTreeRow(); root.DatStatus = DatStatus.InDatCollect;
    DB.DirRoot = root;
    const rv = new RvFile(FileType.Dir);
    rv.Name = 'RomVault'; rv.Tree = new RvTreeRow(); rv.DatStatus = DatStatus.InDatCollect;
    root.childAdd(rv);
    const ts = new RvFile(FileType.Dir);
    ts.Name = 'ToSort'; ts.Tree = new RvTreeRow(); ts.DatStatus = DatStatus.InToSort;
    ts.toSortStatusSet(ToSortDirType.ToSortPrimary | ToSortDirType.ToSortCache);
    root.childAdd(ts, 1);
  },

  cachePath() { return toOsPath(state.rvSettings.CacheFile); },

  write() {
    const file = DB.cachePath();
    const tmp = file + '_tmp';
    const json = JSON.stringify({ v: 1, root: DB.DirRoot.toCache(new Map()) });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(tmp, json);
    if (fs.existsSync(file)) fs.renameSync(file, file + 'Backup');
    fs.renameSync(tmp, file);
  },

  read() {
    const file = DB.cachePath();
    let j = null;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
      try { j = JSON.parse(fs.readFileSync(file + 'Backup', 'utf8')); } catch { j = null; }
    }
    if (!j || !j.root) { DB.openDefault(); return; }
    const root = j.root;
    // The base dir's children after the first are ToSort directories.
    const r = new RvFile(FileType.Dir);
    r.Name = root.n || null; r._datStatus = DatStatus.InDatCollect; r._gotStatus = root.gs ?? GotStatus.NotGot;
    if (root.tr) r.Tree = new RvTreeRow(!!root.tr[0], root.tr[1]);
    r._children = (root.c || []).map((c, i) => {
      r._datStatus = i > 0 ? DatStatus.InToSort : DatStatus.InDatCollect;
      return RvFile.fromCache(c, [], r);
    });
    r._datStatus = DatStatus.InDatCollect;
    DB.DirRoot = r;
    rebuildStatus(r);
    if (r.ChildCount < 2) DB.openDefault();
  },

  getToSortCache() {
    for (let i = 0; i < DB.DirRoot.ChildCount; i++) { const t = DB.DirRoot.child(i); if (t.toSortStatusIs(ToSortDirType.ToSortCache)) return t; }
    return DB.DirRoot.child(1);
  },
  getToSortPrimary() {
    for (let i = 1; i < DB.DirRoot.ChildCount; i++) { const t = DB.DirRoot.child(i); if (t.toSortStatusIs(ToSortDirType.ToSortPrimary)) return t; }
    return DB.DirRoot.child(1);
  },
  getToSortFileOnly() {
    for (let i = 1; i < DB.DirRoot.ChildCount; i++) { const t = DB.DirRoot.child(i); if (t.toSortStatusIs(ToSortDirType.ToSortFileOnly)) return t; }
    return DB.getToSortPrimary();
  },
  moveToSortUp(t) {
    for (let i = 2; i < DB.DirRoot.ChildCount; i++) if (DB.DirRoot.child(i) === t) { DB.DirRoot.childRemove(i); DB.DirRoot.childAdd(t, i - 1); return; }
  },
  moveToSortDown(t) {
    for (let i = 1; i < DB.DirRoot.ChildCount - 1; i++) if (DB.DirRoot.child(i) === t) { DB.DirRoot.childRemove(i); DB.DirRoot.childAdd(t, i + 1); return; }
  },
};

// ------------------------------------------------------------------------------------------------ DBHelper
const DBHelper = {
  getSelectedDirListStart(lst, thisDir) {
    if (thisDir == null) thisDir = DB.DirRoot;
    else if (thisDir.Tree != null) lst.push(thisDir);
    DBHelper.getSelectedDirList(lst, thisDir);
  },
  getSelectedDirList(lst, thisDir) {
    for (let i = 0; i < thisDir.ChildCount; i++) {
      if (thisDir.DatStatus !== DatStatus.InDatCollect) continue;
      const t = thisDir.child(i);
      if (!t.IsDirectory || t.Tree == null) continue;
      if (t.Tree.Checked !== TreeSelect.UnSelected) lst.push(t);
      DBHelper.getSelectedDirList(lst, t);
    }
  },
  // Works for RvDat against RvDat or DatImportDat (both expose the DAT's full name, TimeStamp, flags and SubDirType).
  datCompare(a, b) {
    const name = (x) => (x instanceof RvDat ? x.getData(DatData.DatRootFullName) : x.DatFullName);
    let r = RVSorters.CompareDatNameStr(name(a), name(b));
    if (r) return r;
    r = Math.sign(a.TimeStamp - b.TimeStamp);
    if (r) return r;
    for (const f of [DatFlags.MultiDatsInDirectory, DatFlags.MultiDatOverride, DatFlags.UseDescriptionAsDirName, DatFlags.SingleArchive]) {
      r = Math.sign(Number(a.flag(f)) - Number(b.flag(f)));
      if (r) return r;
    }
    return Math.sign(a.SubDirType - b.SubDirType);
  },
  checkIfMissingFileCanBeFixedByGotFile(missing, got) {
    if (missing.HeaderFileType !== HeaderFileType.Nothing && got.HeaderFileType !== HeaderFileType.Nothing && missing.HeaderFileType !== got.HeaderFileType) return false;
    if (missing.HeaderFileTypeRequired && (got.HeaderFileType === HeaderFileType.Nothing || !got.fileStatusIs(FileStatus.HeaderFileTypeFromHeader))) return false;
    if (missing.fileStatusIs(FileStatus.SHA1FromDAT) && got.fileStatusIs(FileStatus.SHA1Verified) && missing.SHA1 !== got.SHA1) {
      if (got.fileStatusIs(FileStatus.AltSHA1Verified) && missing.SHA1 !== got.AltSHA1) return false;
    }
    if (missing.fileStatusIs(FileStatus.MD5FromDAT) && got.fileStatusIs(FileStatus.MD5Verified) && missing.MD5 !== got.MD5) {
      if (got.fileStatusIs(FileStatus.AltMD5Verified) && missing.MD5 !== got.AltMD5) return false;
    }
    return true;
  },
  checkIfGotfileAndMatchingFileAreFullMatches(got, matching) {
    if (got.fileStatusIs(FileStatus.SHA1Verified) && matching.fileStatusIs(FileStatus.SHA1Verified) && got.SHA1 !== matching.SHA1) return false;
    if (got.fileStatusIs(FileStatus.MD5Verified) && matching.fileStatusIs(FileStatus.MD5Verified) && got.MD5 !== matching.MD5) return false;
    return true;
  },
  isZeroLengthFile(t) {
    let found = false;
    if (t.MD5 != null) { if (t.MD5 !== ZeroByteMD5) return false; found = true; }
    if (t.SHA1 != null) { if (t.SHA1 !== ZeroByteSHA1) return false; found = true; }
    if (t.CRC != null) { if (t.CRC !== ZeroByteCRC) return false; found = true; }
    if (t.Size != null) { if (t.Size !== 0) return false; found = true; }
    if (found) return true;
    return t.Name.length > 1 && t.Name.endsWith('/');
  },
  romFromSameGame(a, b) { if (a.Parent == null || b.Parent == null) return false; return a.Parent === b.Parent; },
};

// ------------------------------------------------------------------------------------------------ Utils
const DBTypeGet = {
  dirFromFile(ft) { return ft === FileType.File ? FileType.Dir : ft === FileType.FileZip ? FileType.Zip : ft === FileType.FileSevenZip ? FileType.SevenZip : FileType.Zip; },
  fileFromDir(ft) { return ft === FileType.Dir ? FileType.File : ft === FileType.Zip ? FileType.FileZip : ft === FileType.SevenZip ? FileType.FileSevenZip : FileType.Zip; },
  isCompressedDir(ft) { return ft === FileType.Zip || ft === FileType.SevenZip; },
  fromExtention(ext) { const e = ext.toLowerCase(); return e === '.7z' ? FileType.SevenZip : e === '.zip' ? FileType.Zip : FileType.File; },
};

function isFileOnly(inFile) {
  if (state.rvSettings.FilesOnly) return true;
  let datPath = inFile.DatTreeFullName;
  if (!inFile.IsFile) datPath += SEP;
  const rule = findDatRule(datPath);
  if (rule == null) return inFile.toSortStatusIs(ToSortDirType.ToSortFileOnly);
  let datHeaderType = null;
  for (let t = inFile; t != null; t = t.Parent) {
    if (t.Dat != null) { datHeaderType = t.Dat.getData(DatData.Compression); break; }
    const n = t.countDats();
    if (n > 0) {
      for (let i = 0; i < n; i++) { const c = t.dirDat(i).getData(DatData.Compression); if (c === 'fileonly') { datHeaderType = c; break; } }
      break;
    }
  }
  if (rule.CompressionOverrideDAT) return rule.Compression === FileType.FileOnly;
  if (datHeaderType != null && datHeaderType.toLowerCase() === 'fileonly') return true;
  return rule.Compression === FileType.FileOnly;
}

module.exports = {
  RvFile, RvDat, RvGame, RvTreeRow, DB, DBHelper, DBTypeGet, DatData, GameData, isFileOnly, altHeaderFile,
  rebuildStatus, toOsPath, treeJoin, log, MIN_TIME,
};
