// Ported from RomVault (RVWorld: RomVaultCore/ReadDat/DatReader.cs, Storage/DatImportDat.cs, Storage/DatImportDir.cs)
// by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FileType, ZipStructure, MergeType, FilterType, HeaderType, HeaderFileType, DatFlags, headerTypeFromFileName } = require('../enums');
const { findDatRule, SEP } = require('../settings');
const { RvFile } = require('../rvdb');
const { readDat } = require('../dat/readers');
const { DatDir, VarFix } = require('../dat/datStore');
const { DatClean, hasRomOf, setStatus, setCompressionType, moveUpCHDs } = require('../dat/datClean');
const { RVSorters, listSearch } = require('../sorters');

class DatImportDat {
  constructor() { this.DatFullName = null; this.TimeStamp = 0; this.SubDirType = 0; this.headerType = HeaderType.Optional; this.datHeader = null; this._flags = 0; }
  flag(f) { return (this._flags & f) !== 0; }
  setFlag(f, v) { this._flags &= ~f; if (v) this._flags |= f; }
  get Flags() { return this._flags; }
}

function datTreePath(rootPath) {
  if (rootPath === '') return 'DatRoot';
  if (rootPath.startsWith('RomVault')) return 'DatRoot' + rootPath.substring(8);
  return 'Error';
}

class DatImportDir {
  constructor(name) { this.Name = name; this.Parent = null; this.children = []; this.dats = []; }
  get TreeFullName() { return this.Parent == null ? (this.Name || '') : this.Parent.TreeFullName + SEP + this.Name; }
  get DatTreeFullName() { return datTreePath(this.TreeFullName); }
  get ChildDirsCount() { return this.children.length; }
  childDir(i) { return this.children[i]; }
  get DatFilesCount() { return this.dats.length; }
  dirDat(i) { return this.dats[i]; }
  childDirAdd(c) {
    const { index } = listSearch(this.children, c, RVSorters.CompareDirNameCase);
    this.children.splice(index, 0, c); c.Parent = this; return index;
  }
  dirDatAdd(d) {
    const { index } = listSearch(this.dats, d, (a, b) => RVSorters.CompareDatNameStr(a.DatFullName, b.DatFullName));
    this.dats.splice(index, 0, d);
  }

  // Walk DatRoot, collecting .dat, .xml and .datz files. Returns { ok, root, count }.
  static recursiveDatTree(report) {
    const root = new DatImportDir('RomVault');
    const r = DatImportDir._walk(root, report);
    return { ok: r.ok, root, count: r.count };
  }

  static _walk(tDir, report) {
    let count = 0;
    const p = RvFile.getDatPhysicalPath(tDir.DatTreeFullName);
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch {
      report?.(`Path: ${p} Not Found.`);
      return { ok: false, count: 0 };
    }
    const files = entries.filter((e) => e.isFile() && /\.(dat|xml|datz)$/i.test(e.name));
    count += files.length;
    for (const f of files) {
      const d = new DatImportDat();
      d.DatFullName = tDir.DatTreeFullName + SEP + f.name;
      try { d.TimeStamp = Math.floor(fs.statSync(path.join(p, f.name)).mtimeMs); } catch { d.TimeStamp = 0; }
      const rule = findDatRule(d.DatFullName);
      d.setFlag(DatFlags.MultiDatOverride, !!rule?.MultiDATDirOverride);
      d.setFlag(DatFlags.UseDescriptionAsDirName, !!rule?.UseDescriptionAsDirName);
      d.setFlag(DatFlags.SingleArchive, !!rule?.SingleArchive);
      d.setFlag(DatFlags.UseIdForName, !!rule?.UseIdForName);
      d.SubDirType = rule?.SubDirType || 0;
      tDir.dirDatAdd(d);
    }
    if (tDir.DatFilesCount > 1) for (const d of tDir.dats) d.setFlag(DatFlags.MultiDatsInDirectory, true);
    for (const e of entries.filter((x) => x.isDirectory())) {
      const c = new DatImportDir(e.name);
      const index = tDir.childDirAdd(c);
      const r = DatImportDir._walk(c, report);
      count += r.count;
      if (r.count === 0) tDir.children.splice(index, 1);
    }
    return { ok: true, count };
  }
}

function dirnameTree(p) { const i = p.lastIndexOf(SEP); return i < 0 ? '' : p.substring(0, i); }
function fileNameNoExt(p) { const b = p.replace(/^.*[\\/]/, ''); const i = b.lastIndexOf('.'); return i > 0 ? b.substring(0, i) : b; }

// ReadDat.DatReader.ReadInDatFile: read a DAT and apply the DAT rule's clean-up, merge and compression settings.
function readInDatFile(datFile, readError) {
  let extraDirName = null;
  const datRootFullName = datFile.DatFullName;
  const fullPath = RvFile.getDatPhysicalPath(datRootFullName);
  const h = readDat(fullPath, readError);
  if (!h) { datFile.datHeader = null; return false; }
  let dirNameRule = dirnameTree(datRootFullName) + SEP;
  if (!datFile.flag(DatFlags.MultiDatOverride) && h.Dir !== 'noautodir' &&
    (datFile.flag(DatFlags.MultiDatsInDirectory) || h.RootDir)) {
    extraDirName = '';
    if (!extraDirName && datFile.flag(DatFlags.UseDescriptionAsDirName) && h.Description && h.Description.trim()) extraDirName = h.Description;
    if (!extraDirName) extraDirName = h.RootDir;
    if (!extraDirName) extraDirName = h.Name;
    if (!extraDirName) extraDirName = fileNameNoExt(fullPath);
    dirNameRule += VarFix.cleanFileName(extraDirName) + SEP;
  }
  const rule = findDatRule(dirNameRule);
  DatClean.cleanFilenames(h.BaseDir);
  if (rule.Filter === FilterType.CHDsOnly) DatClean.removeNonCHD(h.BaseDir);
  else if (rule.Filter === FilterType.RomsOnly) DatClean.removeCHD(h.BaseDir);
  DatClean.removeNoDumps(h.BaseDir);
  if (rule.UseIdForName) DatClean.datSetAddIdNumbers(h.BaseDir, '');
  if (rule.AddCategorySubDirs) DatClean.addCategory(h.BaseDir, rule.CategoryOrder);
  setMergeType(rule, h);
  setStatus(h.BaseDir);
  if (rule.Merge !== MergeType.NonMerged) DatClean.checkDeDuped(h.BaseDir);
  let { ft, zs } = getCompressionMethod(rule, h);
  if (rule.Compression === FileType.FileOnly) { ft = FileType.Dir; zs = ZipStructure.None; }
  if (rule.SingleArchive) {
    DatClean.directoryFlattern(h.BaseDir);
    DatClean.makeDatSingleLevel(h, rule.UseDescriptionAsDirName, rule.SubDirType, ft === FileType.Dir, rule.AddCategorySubDirs, rule.CategoryOrder);
  }
  setCompressionType(h.BaseDir, ft, zs, rule.ConvertWhileFixing);
  DatClean.removeUnNeededDirectories(h.BaseDir);
  DatClean.removeAllDateTime(h.BaseDir);
  moveUpCHDs(h.BaseDir);
  DatClean.directoryExpand(h.BaseDir);
  DatClean.cleanFileNamesFull(h.BaseDir);
  DatClean.fixDupes(h.BaseDir);
  DatClean.removeEmptyDirectories(h.BaseDir);
  if (extraDirName && extraDirName.trim()) {
    h.BaseDir.Name = VarFix.cleanFileName(extraDirName);
    const nd = new DatDir('', FileType.Dir);
    nd.childAdd(h.BaseDir);
    h.BaseDir = nd;
    datFile.setFlag(DatFlags.AutoAddedDirectory, true);
  } else datFile.setFlag(DatFlags.AutoAddedDirectory, false);
  datFile.headerType = rule.HeaderType;
  datFile.datHeader = h;
  let hft = headerTypeFromFileName(h.Header);
  if (hft !== HeaderFileType.Nothing) {
    if (datFile.headerType === HeaderType.Headerless) { hft = HeaderFileType.Nothing; DatClean.setHeaderType(h.BaseDir, hft); } else if (datFile.headerType === HeaderType.Headered) { hft |= HeaderFileType.Required; DatClean.setHeaderType(h.BaseDir, hft); }
  }
  DatClean.setExt(h.BaseDir);
  DatClean.clearDescription(h.BaseDir);
  return true;
}

function setMergeType(rule, h) {
  if (!hasRomOf(h.BaseDir)) return;
  let mt = rule.Merge;
  if (!rule.MergeOverrideDAT) {
    switch ((h.MergeType || '').toLowerCase()) {
      case 'full': mt = MergeType.Merge; break;
      case 'nonmerge': mt = MergeType.NonMerged; break;
      case 'split': mt = MergeType.Split; break;
      default: break;
    }
  }
  DatClean.datSetMatchIDs(h.BaseDir);
  if (mt === MergeType.Merge) DatClean.datSetMakeMergeSet(h.BaseDir, h.MameXML);
  else if (mt === MergeType.NonMerged) DatClean.datSetMakeNonMergeSet(h.BaseDir);
  else if (mt === MergeType.Split) DatClean.datSetMakeSplitSet(h.BaseDir);
  DatClean.removeDeviceRef(h.BaseDir);
  DatClean.removeDupes(h.BaseDir, !h.MameXML, mt !== MergeType.NonMerged);
  DatClean.removeEmptySets(h.BaseDir);
}

function getCompressionMethod(rule, h) {
  let ft = rule.Compression === FileType.FileOnly ? FileType.File : rule.Compression;
  let zs = rule.CompressionSub;
  if (!rule.CompressionOverrideDAT && rule.Compression !== FileType.FileOnly) {
    switch ((h.Compression || '').toLowerCase()) {
      case 'tdc': ft = FileType.Zip; zs = ZipStructure.ZipTDC; break;
      case 'unzip': case 'file': case 'fileonly': ft = FileType.Dir; zs = ZipStructure.None; break;
      case '7zip': case '7z': ft = FileType.SevenZip; zs = ZipStructure.SevenZipSLZMA; break;
      case 'zip': ft = FileType.Zip; zs = ZipStructure.ZipTrrnt; break;
      default: break;
    }
  }
  return { ft, zs };
}

module.exports = { DatImportDat, DatImportDir, readInDatFile };
