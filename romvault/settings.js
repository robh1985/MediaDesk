// Ported from RomVault (RVWorld: RomVaultCore/Settings.cs, RomVaultCore/ReadDat/DatReader.cs FindDatRule,
// RomVaultCore/Utils/IsFileOnly.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk. Settings are stored as JSON instead of RomVault3cfg.xml.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FileType, ZipStructure, EFixLevel, MergeType, FilterType, HeaderType, RemoveSubType } = require('./enums');

// RomVault's tree paths use the Windows separator. The port keeps that inside the tree and in DAT rule keys,
// and converts to the OS separator only when it turns a tree path into a real path.
const SEP = '\\';

function newDatRule(over = {}) {
  return {
    DirKey: 'RomVault',
    Compression: FileType.Zip,
    CompressionOverrideDAT: false,
    CompressionSub: ZipStructure.ZipTrrnt,
    ConvertWhileFixing: true,
    Merge: MergeType.None,
    Filter: FilterType.KeepAll,
    HeaderType: HeaderType.Optional,
    MergeOverrideDAT: false,
    SingleArchive: false,
    SubDirType: RemoveSubType.KeepAllSubDirs,
    MultiDATDirOverride: false,
    UseDescriptionAsDirName: false,
    UseIdForName: false,
    CompleteOnly: false,
    IgnoreFiles: [],
    AddCategorySubDirs: false,
    CategoryOrder: [],
    ...over,
  };
}

function defaults() {
  return {
    FilesOnly: false,
    DatRoot: 'DatRoot',
    CacheFile: 'RomVault3_3.json',
    FixLevel: EFixLevel.Level2,
    DatRules: [newDatRule()],
    DirMappings: [{ DirKey: 'RomVault', DirPath: 'RomRoot' }],
    IgnoreFiles: [],
    DoubleCheckDelete: true,
    DetailedFixReporting: true,
    CacheSaveTimerEnabled: true,
    CacheSaveTimePeriod: 10,
    chkBoxShowComplete: true,
    chkBoxShowPartial: true,
    chkBoxShowEmpty: true,
    chkBoxShowFixes: true,
    chkBoxShowMIA: true,
    chkBoxShowMerged: false,
    FixDatOutPath: null,
    DeleteOldCueFiles: false,
    CheckCHDVersion: false,
    sevenZDefaultStruct: 3,
    // ToSort directories: the first is the primary. RomVault keeps these in its cache; the port keeps them here too
    // so they can be edited in Settings before a cache exists.
  };
}

function wildcardToRegex(pattern) {
  if (/^regex:/i.test(pattern)) return new RegExp(pattern.substring(6), 'i');
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$', 'i');
}

const ordinalCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class Settings {
  constructor(values) {
    Object.assign(this, defaults(), values || {});
    this.normalise();
  }

  // Settings.SetDefaults: tidy rule keys, sort, drop duplicates and build the regex lists.
  normalise() {
    this.DatRules = (this.DatRules || []).map((r) => newDatRule(r));
    for (const r of this.DatRules) {
      if (r.DirKey.endsWith(SEP)) r.DirKey = r.DirKey.slice(0, -1);
      if (r.Merge === MergeType.CHDsMerge) { r.Merge = MergeType.Merge; r.Filter = FilterType.CHDsOnly; }
    }
    this.DatRules.sort((a, b) => ordinalCompare(a.DirKey, b.DirKey));
    this.DatRules = this.DatRules.filter((r, i, a) => i === 0 || a[i - 1].DirKey !== r.DirKey);
    if (!this.DatRules.some((r) => r.DirKey === 'RomVault')) this.DatRules.unshift(newDatRule());
    this.DirMappings = (this.DirMappings || []).filter((m) => m && m.DirKey);
    this.DirMappings.sort((a, b) => ordinalCompare(a.DirKey, b.DirKey));
    this.DirMappings = this.DirMappings.filter((m, i, a) => i === 0 || a[i - 1].DirKey !== m.DirKey);
    if (!Array.isArray(this.IgnoreFiles)) this.IgnoreFiles = [];
    this.setRegExRules();
  }

  setRegExRules() {
    const split = (list) => {
      const normal = []; const scan = [];
      for (const str of list || []) {
        if (/^ignore:/i.test(str)) scan.push(wildcardToRegex(str.substring(7)));
        else normal.push(wildcardToRegex(str));
      }
      return [normal, scan];
    };
    [this.IgnoreFilesRegex, this.IgnoreFilesScanRegex] = split(this.IgnoreFiles);
    for (const r of this.DatRules) {
      Object.defineProperty(r, 'IgnoreFilesRegex', { value: split(r.IgnoreFiles)[0], enumerable: false, writable: true, configurable: true });
      Object.defineProperty(r, 'IgnoreFilesScanRegex', { value: split(r.IgnoreFiles)[1], enumerable: false, writable: true, configurable: true });
    }
  }

  get default7ZStruct() {
    switch (this.sevenZDefaultStruct) {
      case 0: return ZipStructure.SevenZipSLZMA;
      case 1: return ZipStructure.SevenZipNLZMA;
      case 2: return ZipStructure.SevenZipSZSTD;
      case 3: return ZipStructure.SevenZipNZSTD;
      default: return ZipStructure.SevenZipNLZMA;
    }
  }

  toJSON() {
    const out = {};
    for (const k of Object.keys(defaults())) out[k] = this[k];
    return out;
  }

  static load(file) {
    try { return new Settings(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return new Settings(); }
  }

  save(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.temp';
    fs.writeFileSync(tmp, JSON.stringify(this, null, 2));
    fs.renameSync(tmp, file);
  }
}

// The live settings, like RomVault's static Settings.rvSettings.
const state = { rvSettings: new Settings() };

// ReadDat.DatReader.FindDatRule: the longest rule key that prefixes the DAT tree path.
function findDatRule(datName) {
  let use = null; let longest = -1;
  for (const s of state.rvSettings.DatRules) {
    if (s.DirKey.length < 8 || s.DirKey.substring(0, 8) !== 'RomVault') continue;
    const dirKey = 'DatRoot' + s.DirKey.substring(8) + SEP;
    if (dirKey.length > datName.length) continue;
    if (datName.substring(0, dirKey.length) !== dirKey) continue;
    if (dirKey.length < longest) continue;
    longest = dirKey.length;
    use = s;
  }
  return use;
}

module.exports = { Settings, state, findDatRule, newDatRule, wildcardToRegex, SEP };
