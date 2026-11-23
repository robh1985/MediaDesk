// MediaDesk ROM Manager: hosts the RomVault engine port in a worker thread, so DAT updates, scans and fixes don't
// hold up the web server. The main thread (roms.js) sends { id, cmd, args } and gets { id, ok, result | error };
// job progress comes back as { type: 'job', job } a few times a second. Cancelling sets a shared flag, so it also
// works while the engine is busy in synchronous code (DAT update, Find Fixes).
//
// Not ported from RomVault: this file is MediaDesk's own glue. What it shows follows RomVault's main window
// (ROMVault/FrmMain.cs and UIElements/*.cs): the tree text and icons, the game grid's filters and row colours, and
// the ROM grid's columns.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const {
  FileType, DatStatus, GotStatus, RepStatus: R, RepStatusName, TreeSelect, ToSortDirType, ZipStructure, ZipStructureName,
  FileStatus, HeaderFileType, EScanLevel, MergeType, FilterType, HeaderType, RemoveSubType, EFixLevel,
} = require('./enums');
const { state, Settings, newDatRule, SEP } = require('./settings');
const { RvFile, RvTreeRow, DB, DatData, GameData } = require('./rvdb');
const { DisplayOrder, reportStatusReset } = require('./repairStatus');
const { updateDat, invalidateAllDATs } = require('./readDat/datUpdate');
const { FileScanning } = require('./scanner/fileScanning');
const { findFixes } = require('./findFix/findFixes');
const { performFixes } = require('./fixFile/fix');
const { recursiveDatTree } = require('./fixDatReport');
const { generateReport, generateFixReport } = require('./report');
const sevenZip = require('./compress/sevenZip');
const { hasZstd } = require('./compress/common');

const dataDir = workerData.dataDir;
const cancelFlag = new Int32Array(workerData.cancelBuf);
const settingsFile = path.join(dataDir, 'settings.json');
const fixLogFile = path.join(dataDir, 'last-fix.json');
const tmpDir = path.join(dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

let sevenZipExe = workerData.sevenZip || null;
sevenZip.configure({ getExe: () => sevenZipExe, tempDir: tmpDir });

// ------------------------------------------------------------------------------------------------ settings and DB
function loadSettings() {
  const s = Settings.load(settingsFile);
  if (!path.isAbsolute(s.CacheFile)) s.CacheFile = path.join(dataDir, 'cache.json');
  if (!s.Presets || typeof s.Presets !== 'object') s.Presets = {};
  state.rvSettings = s;
}
function saveSettings() {
  const s = state.rvSettings;
  s.normalise();
  const json = s.toJSON();
  json.Presets = s.Presets || {};
  const tmp = settingsFile + '.temp';
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
  fs.renameSync(tmp, settingsFile);
}
loadSettings();
DB.read();

// Saving the cache is slow on big collections, so tree clicks (ticks, expanding) are saved a few seconds later.
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; if (!job || job.state !== 'running') DB.write(); else saveSoon(); }, 4000);
}
function saveNow() { clearTimeout(saveTimer); saveTimer = null; DB.write(); }

const romRoot = () => state.rvSettings.DirMappings.find((m) => m.DirKey === 'RomVault')?.DirPath || '';
const isAbs = (p) => !!p && (path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\'));
function configured() {
  return isAbs(state.rvSettings.DatRoot) && isAbs(romRoot()) && isAbs(DB.getToSortPrimary().Name);
}

// ------------------------------------------------------------------------------------------------ finding nodes
// A node's id is its tree path (TreeFullName). ToSort roots are named by their full folder path, so match them first.
function findNode(id) {
  if (id == null || id === '') return DB.DirRoot.child(0);
  for (let i = 0; i < DB.DirRoot.ChildCount; i++) {
    const r = DB.DirRoot.child(i);
    const rn = r.Name;
    if (id === rn) return r;
    if (id.startsWith(rn + SEP)) return walk(r, id.substring(rn.length + 1).split(SEP));
  }
  return null;
}
function walk(dir, parts) {
  let d = dir;
  for (const p of parts) {
    let next = null;
    for (let i = 0; i < d.ChildCount; i++) { const c = d.child(i); if (c.Name === p && c.IsDirectory) { next = c; break; } }
    if (!next) return null;
    d = next;
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ tree (UITree.cs)
function treeIcon(t) {
  const s = t.DirStatus;
  if (s.hasInToSort()) return 4;
  if (!s.hasCorrect() && s.hasMissing()) return 1;
  if (!s.hasMissing()) return 3;
  return 2;
}
function toSortLabel(t) {
  if (t.Parent !== DB.DirRoot) return '';
  if (t.toSortStatusIs(ToSortDirType.ToSortPrimary)) return 'Primary';
  if (t.toSortStatusIs(ToSortDirType.ToSortCache)) return 'Cache';
  if (t.toSortStatusIs(ToSortDirType.ToSortFileOnly)) return 'File Only';
  return '';
}
function treeNode(t) {
  const s = t.DirStatus;
  let name = t.Name; let dats = null;
  if (t.Dat == null && t.DirDatCount === 1) name = `${t.Name}: ${t.dirDat(0).getData(DatData.Description) || ''}`;
  else if (t.Dat == null && t.DirDatCount > 1) {
    dats = [];
    for (let i = 0; i < t.DirDatCount; i++) {
      const d = t.dirDat(i);
      if (d.flag(1)) continue; // AutoAddedDirectory
      dats.push(d.getData(DatData.Description) || d.getData(DatData.DatName) || '');
    }
  }
  const n = {
    id: t.TreeFullName, name, ck: t.Tree.Checked, ex: !!t.Tree.TreeExpanded, icon: treeIcon(t),
    have: s.countCorrect(), missing: s.countMissing(), fixes: s.countFixesNeeded(), unknown: s.countUnknown(),
    tosort: t.IsInToSort, files: s.countInToSort(), role: toSortLabel(t),
    dat: t.Dat != null || t.DirDatCount > 0,
  };
  if (dats && dats.length) n.dats = dats;
  const kids = [];
  for (let i = 0; i < t.ChildCount; i++) { const c = t.child(i); if (c.IsDirectory && c.Tree != null) kids.push(treeNode(c)); }
  if (kids.length) n.kids = kids;
  return n;
}
function tree() {
  const out = [];
  for (let i = 0; i < DB.DirRoot.ChildCount; i++) { const c = DB.DirRoot.child(i); if (c.Tree) out.push(treeNode(c)); }
  return out;
}

// ------------------------------------------------------------------------------------------------ DAT info (UIDatInfo.cs)
function datInfo(t) {
  const s = t.DirStatus;
  const dat = t.Dat || (t.DirDatCount === 1 ? t.dirDat(0) : null);
  const info = { name: t.Name, path: t.FullName, have: s.countCorrect(), missing: s.countMissing(), fixes: s.countFixesNeeded(), unknown: s.countUnknown() + s.countInToSort() };
  if (dat) {
    const g = (k) => dat.getData(k) || '';
    if (g(DatData.DatName) && g(DatData.DatName) !== t.Name) info.name += `:  ${g(DatData.DatName)}`;
    if (g(DatData.Id)) info.name += ` (ID:${g(DatData.Id)})`;
    if (g(DatData.Header)) info.name += ` (${g(DatData.Header)})`;
    Object.assign(info, { description: g(DatData.Description), category: g(DatData.Category), version: g(DatData.Version), author: g(DatData.Author), date: g(DatData.Date), homepage: g(DatData.HomePage) || g(DatData.URL) });
  }
  if (t.IsInToSort) info.tosort = true;
  return info;
}

// ------------------------------------------------------------------------------------------------ game grid (UIGameGrid.cs)
const typeName = (ft, zs) => {
  if (ft === FileType.Zip) return { [ZipStructure.None]: 'Zip', [ZipStructure.ZipTrrnt]: 'ZipTrrnt', [ZipStructure.ZipTDC]: 'ZipTDC', [ZipStructure.ZipZSTD]: 'ZipZSTD', [ZipStructure.ZipDTD]: 'ZipDTD', [ZipStructure.ZipDTZ]: 'ZipDTZ' }[zs] || null;
  if (ft === FileType.SevenZip) return { [ZipStructure.None]: 'SevenZip', [ZipStructure.SevenZipTrrnt]: 'SevenZipTrrnt', [ZipStructure.SevenZipSLZMA]: 'SevenZipSLZMA', [ZipStructure.SevenZipNLZMA]: 'SevenZipNLZMA', [ZipStructure.SevenZipSZSTD]: 'SevenZipSZSTD', [ZipStructure.SevenZipNZSTD]: 'SevenZipNZSTD' }[zs] || null;
  if (ft === FileType.Dir) return 'Dir';
  return null;
};
function rowStatus(t) {
  if (t.GotStatus === GotStatus.FileLocked) return R.UnScanned;
  for (const st of DisplayOrder) if (t.DirStatus.get(st) > 0) return st;
  return null;
}
function counts(s) {
  const out = [];
  for (const st of DisplayOrder) { const n = s.get(st); if (n > 0) out.push([st, n]); }
  return out;
}
function games(id, { show = {}, q = '' } = {}) {
  const dir = findNode(id);
  if (!dir) throw Object.assign(new Error('That folder is no longer in the tree. Press Update DATs or refresh.'), { status: 404 });
  const f = { complete: true, partial: true, empty: true, fixes: true, merged: false, ...show };
  const term = String(q || '').toLowerCase();
  const rows = []; let showDescription = false;
  for (let j = 0; j < dir.ChildCount; j++) {
    const c = dir.child(j);
    if (!c.IsDirectory || c.Tree != null) continue; // tree folders are in the tree, not the game list
    if (term && !c.Name.toLowerCase().includes(term)) continue;
    const s = c.DirStatus;
    const gCorrect = s.hasCorrect(); const gMissing = s.hasMissing(); const gUnknown = s.hasUnknown(); const gInToSort = s.hasInToSort();
    const gFixes = s.hasFixesNeeded(); const gAllMerged = s.hasAllMerged();
    let ok = f.complete && gCorrect && !gMissing && !gFixes;
    ok = ok || (f.partial && gMissing && gCorrect);
    ok = ok || (f.empty && gMissing && !gCorrect);
    ok = ok || (f.fixes && gFixes);
    ok = ok || (f.merged && gAllMerged);
    ok = ok || gUnknown || gInToSort || c.GotStatus === GotStatus.Corrupt;
    ok = ok || !(gCorrect || gMissing || gUnknown || gInToSort || gFixes || gAllMerged);
    if (!ok) continue;
    let desc = c.Game ? c.Game.getData(GameData.Description) : null;
    if (desc === '¤') desc = path.parse(c.Name).name;
    if (desc && desc.trim()) showDescription = true;
    const datType = c.DatStatus !== DatStatus.NotInDat && c.DatStatus !== DatStatus.InToSort ? typeName(c.FileType, c.ZipDatStruct) : null;
    const gotType = c.GotStatus !== GotStatus.NotGot ? typeName(c.FileType, c.ZipStruct) : null;
    rows.push({
      n: c.Name, fn: c.FileName || undefined, d: desc || undefined, dt: datType, gt: gotType, conv: datType && gotType && datType !== gotType ? (c.ZipDatStructFix ? 1 : 2) : 0,
      corrupt: c.GotStatus === GotStatus.Corrupt || undefined, st: rowStatus(c), c: counts(s),
      y: c.Game?.getData(GameData.Year) || undefined, m: c.Game?.getData(GameData.Manufacturer) || undefined,
      co: c.Game?.getData(GameData.CloneOf) || undefined,
    });
  }
  let looseFiles = 0;
  for (let j = 0; j < dir.ChildCount; j++) if (dir.child(j).IsFile) looseFiles++;
  return { info: datInfo(dir), games: rows, showDescription, looseFiles };
}

// ------------------------------------------------------------------------------------------------ ROM grid (UIRomGrid.cs)
function romRows(t, showMerged) {
  const rows = [];
  const addDir = (g, pre) => {
    for (let l = 0; l < g.ChildCount; l++) {
      const f = g.child(l);
      if (f.IsFile) {
        if (f.DatStatus !== DatStatus.InDatMerged || f.RepStatus !== R.NotCollected || showMerged) rows.push(romRow(f, pre + f.Name));
        if (rows.length >= 20000) return;
      }
      if (g.Dat == null || !f.IsDirectory) continue;
      if (f.Game == null && f.Tree == null) addDir(f, `${pre}${f.Name}/`);
    }
  };
  addDir(t, '');
  return rows;
}
function flags(f, dat, file, ver) {
  let s = '';
  if (dat && f.fileStatusIs(dat)) s += 'D';
  if (file && f.fileStatusIs(file)) s += 'F';
  if (ver && f.fileStatusIs(ver)) s += 'V';
  return s || undefined;
}
function romRow(f, name) {
  const fs_ = FileStatus;
  const r = {
    n: name, fn: f.FileName || undefined, ds: f.DatStatus, st: f.RepStatus, mg: f.Merge || undefined,
    sz: f.Size ?? undefined, crc: f.CRC || undefined, sha1: f.SHA1 || undefined, md5: f.MD5 || undefined,
    fl: { sz: flags(f, fs_.SizeFromDAT, fs_.SizeFromHeader, fs_.SizeVerified), crc: flags(f, fs_.CRCFromDAT, fs_.CRCFromHeader, fs_.CRCVerified), sha1: flags(f, fs_.SHA1FromDAT, fs_.SHA1FromHeader, fs_.SHA1Verified), md5: flags(f, fs_.MD5FromDAT, fs_.MD5FromHeader, fs_.MD5Verified) },
    status: f.Status || undefined, zi: f.ZipFileIndex >= 0 ? f.ZipFileIndex : undefined, dup: f.FileGroup ? f.FileGroup.Files.length : undefined,
  };
  if (f.AltSize != null || f.AltCRC || f.AltSHA1 || f.AltMD5) Object.assign(r, { asz: f.AltSize ?? undefined, acrc: f.AltCRC || undefined, asha1: f.AltSHA1 || undefined, amd5: f.AltMD5 || undefined });
  if (f.CHDVersion != null) r.chd = f.CHDVersion;
  if (f.HeaderFileType !== HeaderFileType.Nothing) r.hdr = Object.keys(HeaderFileType).find((k) => HeaderFileType[k] === f.HeaderFileType) + (f.HeaderFileTypeRequired ? ',Required' : '');
  const ts = f.FileModTimeStamp;
  if (ts != null && ts !== 0 && f.FileType === FileType.File) r.mt = ts;
  return r;
}
function roms(id, game, { showMerged = false } = {}) {
  const dir = findNode(id);
  if (!dir) throw Object.assign(new Error('That folder is no longer in the tree.'), { status: 404 });
  let t = dir;
  if (game != null && game !== '') {
    t = null;
    for (let i = 0; i < dir.ChildCount; i++) { const c = dir.child(i); if (c.Name === game && c.IsDirectory) { t = c; break; } }
    if (!t) throw Object.assign(new Error('That set is no longer here.'), { status: 404 });
  }
  const g = t.Game;
  const info = { name: t.Name, path: t.FullNameCase, type: typeName(t.FileType, t.ZipStruct) };
  if (g) for (const [k, id_] of Object.entries(GameData)) { const v = g.getData(id_); if (v != null && v !== '') info[k] = v; }
  return { info, roms: romRows(t, showMerged) };
}

// ------------------------------------------------------------------------------------------------ tree ticks
function setChecked(id, value, shift) {
  const t = findNode(id);
  if (!t || !t.Tree) throw Object.assign(new Error('Not found'), { status: 404 });
  if (value === TreeSelect.Locked && t.Parent === DB.DirRoot && (t.toSortStatusIs(ToSortDirType.ToSortPrimary) || t.toSortStatusIs(ToSortDirType.ToSortCache))) {
    throw Object.assign(new Error('The primary and cache ToSort folders can’t be locked.'), { status: 400 });
  }
  const rec = (d, first) => {
    d.Tree.setChecked(value);
    if (shift && first) return;
    for (let i = 0; i < d.ChildCount; i++) { const c = d.child(i); if (c.IsDirectory && c.Tree) rec(c, false); }
  };
  rec(t, true);
  saveSoon();
}
function setExpanded(id, value, children) {
  const t = findNode(id);
  if (!t || !t.Tree) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!children) t.Tree.setTreeExpanded(!!value);
  else {
    let first = null;
    for (let i = 0; i < t.ChildCount; i++) { const c = t.child(i); if (c.IsDirectory && c.Tree) { first = c.Tree; break; } }
    if (first) { const v = !first.TreeExpanded; for (let i = 0; i < t.ChildCount; i++) { const c = t.child(i); if (c.IsDirectory && c.Tree) c.Tree.setTreeExpanded(v); } }
  }
  saveSoon();
}

// Tree pre-sets (UISideButtons): remember and restore which folders are ticked.
function presetSave(n) {
  const map = {};
  const rec = (d) => { for (let i = 0; i < d.ChildCount; i++) { const c = d.child(i); if (c.IsDirectory && c.Tree) { map[c.TreeFullName] = [c.Tree.Checked, c.Tree.TreeExpanded ? 1 : 0]; rec(c); } } };
  rec(DB.DirRoot);
  state.rvSettings.Presets[n] = map;
  saveSettings();
}
function presetLoad(n) {
  const map = state.rvSettings.Presets[n];
  if (!map) throw Object.assign(new Error('Nothing is saved in that pre-set yet. Right-click (or long-press) it to save the ticks you have now.'), { status: 400 });
  const rec = (d) => { for (let i = 0; i < d.ChildCount; i++) { const c = d.child(i); if (c.IsDirectory && c.Tree) { const v = map[c.TreeFullName]; if (v) { c.Tree.setChecked(v[0]); c.Tree.setTreeExpanded(!!v[1]); } rec(c); } } };
  rec(DB.DirRoot);
  saveSoon();
}

// ------------------------------------------------------------------------------------------------ settings
function publicSettings() {
  const s = state.rvSettings;
  return {
    DatRoot: s.DatRoot, RomRoot: romRoot(), FixLevel: s.FixLevel, DoubleCheckDelete: s.DoubleCheckDelete, DetailedFixReporting: s.DetailedFixReporting,
    CacheSaveTimerEnabled: s.CacheSaveTimerEnabled, CacheSaveTimePeriod: s.CacheSaveTimePeriod, sevenZDefaultStruct: s.sevenZDefaultStruct,
    FixDatOutPath: s.FixDatOutPath || '', IgnoreFiles: s.IgnoreFiles, DeleteOldCueFiles: s.DeleteOldCueFiles,
    DatRules: s.DatRules.map((r) => ({ ...r })), DirMappings: s.DirMappings.map((m) => ({ ...m })),
    Presets: Object.keys(s.Presets || {}).map(Number),
    toSort: toSortList(), sevenZip: !!sevenZipExe, zstd: hasZstd, configured: configured(),
    show: { complete: s.chkBoxShowComplete, partial: s.chkBoxShowPartial, empty: s.chkBoxShowEmpty, fixes: s.chkBoxShowFixes, merged: s.chkBoxShowMerged },
  };
}
function toSortList() {
  const out = [];
  for (let i = 1; i < DB.DirRoot.ChildCount; i++) {
    const t = DB.DirRoot.child(i);
    out.push({ path: t.Name, primary: t.toSortStatusIs(ToSortDirType.ToSortPrimary), cache: t.toSortStatusIs(ToSortDirType.ToSortCache), fileOnly: t.toSortStatusIs(ToSortDirType.ToSortFileOnly) });
  }
  return out;
}
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const intIn = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

function absFolder(p, label, { mustExist = true, create = false } = {}) {
  const v = String(p ?? '').trim();
  if (!v) throw bad(`${label}: give the full path of a folder`);
  if (!isAbs(v)) throw bad(`${label}: give the full path of a folder (for example D:\\ROMs), not ${v}`);
  if (create) { try { fs.mkdirSync(v, { recursive: true }); } catch { /* checked below */ } }
  if (mustExist) { let st = null; try { st = fs.statSync(v); } catch { st = null; } if (!st || !st.isDirectory()) throw bad(`${label}: ${v} isn’t a folder MediaDesk can reach`); }
  return path.resolve(v);
}

function saveGeneral(b) {
  const s = state.rvSettings;
  if (b.DatRoot !== undefined) {
    const v = absFolder(b.DatRoot, 'DAT folder', { create: true });
    if (v !== s.DatRoot) { s.DatRoot = v; }
  }
  if (b.RomRoot !== undefined) {
    const v = absFolder(b.RomRoot, 'ROM folder', { create: true });
    const m = s.DirMappings.find((x) => x.DirKey === 'RomVault');
    if (m) m.DirPath = v; else s.DirMappings.push({ DirKey: 'RomVault', DirPath: v });
  }
  if (b.ToSort !== undefined) {
    const v = absFolder(b.ToSort, 'ToSort folder', { create: true });
    const t = DB.getToSortPrimary();
    if (t.Name !== v) {
      if (toSortList().some((x) => x.path === v)) throw bad('That folder is already a ToSort folder. Make it the primary one from its right-click menu.');
      renameToSort(t, v);
    }
  }
  s.FixLevel = intIn(b.FixLevel, 0, 2, s.FixLevel);
  s.DoubleCheckDelete = bool(b.DoubleCheckDelete, s.DoubleCheckDelete);
  s.DetailedFixReporting = bool(b.DetailedFixReporting, s.DetailedFixReporting);
  s.CacheSaveTimerEnabled = bool(b.CacheSaveTimerEnabled, s.CacheSaveTimerEnabled);
  s.CacheSaveTimePeriod = intIn(b.CacheSaveTimePeriod, 1, 600, s.CacheSaveTimePeriod);
  s.sevenZDefaultStruct = intIn(b.sevenZDefaultStruct, 0, 1, s.sevenZDefaultStruct);
  s.DeleteOldCueFiles = bool(b.DeleteOldCueFiles, s.DeleteOldCueFiles);
  if (b.FixDatOutPath !== undefined) s.FixDatOutPath = String(b.FixDatOutPath).trim() ? absFolder(b.FixDatOutPath, 'Fix DAT folder', { create: true }) : null;
  if (Array.isArray(b.IgnoreFiles)) s.IgnoreFiles = b.IgnoreFiles.map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
  if (b.show && typeof b.show === 'object') {
    s.chkBoxShowComplete = bool(b.show.complete, s.chkBoxShowComplete); s.chkBoxShowPartial = bool(b.show.partial, s.chkBoxShowPartial);
    s.chkBoxShowEmpty = bool(b.show.empty, s.chkBoxShowEmpty); s.chkBoxShowFixes = bool(b.show.fixes, s.chkBoxShowFixes); s.chkBoxShowMerged = bool(b.show.merged, s.chkBoxShowMerged);
  }
  saveSettings();
  saveNow();
  return publicSettings();
}

// The ToSort root's name is its folder. Renaming it keeps its tick state; its files are found again by the next scan.
function renameToSort(t, v) {
  for (let i = 1; i < DB.DirRoot.ChildCount; i++) {
    if (DB.DirRoot.child(i) !== t) continue;
    const fresh = new RvFile(FileType.Dir);
    fresh.Name = v; fresh.Tree = new RvTreeRow(true, t.Tree ? t.Tree.Checked : TreeSelect.Selected); fresh.DatStatus = DatStatus.InToSort;
    fresh.toSortStatusSet(t._toSortType);
    DB.DirRoot.childRemove(i);
    DB.DirRoot.childAdd(fresh, i);
    reportStatusReset(DB.DirRoot);
    return;
  }
}

function ruleKey(k) {
  let key = String(k ?? '').trim();
  if (key.endsWith(SEP)) key = key.slice(0, -1);
  if (key !== 'RomVault' && !key.startsWith('RomVault' + SEP)) throw bad('Rules are for folders in the DAT tree (RomVault\\…)');
  return key;
}
function saveRule(b) {
  const s = state.rvSettings;
  const key = ruleKey(b.DirKey);
  const old = s.DatRules.find((r) => r.DirKey === key);
  const r = newDatRule({ DirKey: key });
  const comp = b.Compression;
  r.Compression = [FileType.Dir, FileType.Zip, FileType.SevenZip, FileType.FileOnly].includes(comp) ? comp : FileType.Zip;
  const subs = r.Compression === FileType.Zip ? [ZipStructure.ZipTrrnt, ...(hasZstd ? [ZipStructure.ZipZSTD] : [])]
    : r.Compression === FileType.SevenZip ? [ZipStructure.SevenZipSLZMA, ZipStructure.SevenZipNLZMA] : [ZipStructure.None];
  r.CompressionSub = subs.includes(b.CompressionSub) ? b.CompressionSub : subs[0];
  r.CompressionOverrideDAT = r.Compression !== FileType.FileOnly && !!b.CompressionOverrideDAT;
  r.ConvertWhileFixing = bool(b.ConvertWhileFixing, true);
  r.Merge = intIn(b.Merge, 0, 3, MergeType.None);
  r.MergeOverrideDAT = !!b.MergeOverrideDAT;
  r.Filter = intIn(b.Filter, 0, 2, FilterType.KeepAll);
  r.HeaderType = intIn(b.HeaderType, 0, 2, HeaderType.Optional);
  r.SingleArchive = !!b.SingleArchive;
  r.SubDirType = intIn(b.SubDirType, 0, 4, RemoveSubType.KeepAllSubDirs);
  r.MultiDATDirOverride = !!b.MultiDATDirOverride;
  r.UseDescriptionAsDirName = !!b.UseDescriptionAsDirName;
  r.UseIdForName = !!b.UseIdForName;
  r.CompleteOnly = !!b.CompleteOnly;
  r.IgnoreFiles = Array.isArray(b.IgnoreFiles) ? b.IgnoreFiles.map((x) => String(x).trim()).filter(Boolean).slice(0, 500) : [];
  if (old) s.DatRules[s.DatRules.indexOf(old)] = r; else s.DatRules.push(r);
  saveSettings();
  invalidateAllDATs(DB.DirRoot.child(0), key);
  return publicSettings();
}
function deleteRule(k) {
  const key = ruleKey(k);
  if (key === 'RomVault') throw bad('The RomVault rule is the default for everything and can’t be deleted.');
  invalidateAllDATs(DB.DirRoot.child(0), key);
  state.rvSettings.DatRules = state.rvSettings.DatRules.filter((r) => r.DirKey !== key);
  saveSettings();
  return publicSettings();
}
function saveMapping(b) {
  const key = ruleKey(b.DirKey);
  const p = absFolder(b.DirPath, 'Folder for this mapping', { create: true });
  const s = state.rvSettings;
  const m = s.DirMappings.find((x) => x.DirKey === key);
  if (m) m.DirPath = p; else s.DirMappings.push({ DirKey: key, DirPath: p });
  saveSettings();
  return publicSettings();
}
function deleteMapping(k) {
  const key = ruleKey(k);
  if (key === 'RomVault') throw bad('The RomVault mapping is your ROM folder; change it in Settings instead.');
  state.rvSettings.DirMappings = state.rvSettings.DirMappings.filter((m) => m.DirKey !== key);
  saveSettings();
  return publicSettings();
}

// ToSort menu (FrmMain.cs, ToSortTreeMenu)
function toSortAction(b) {
  if (b.action === 'add') {
    const v = absFolder(b.path, 'ToSort folder', { create: true });
    if (toSortList().some((x) => x.path === v)) throw bad('That folder is already a ToSort folder.');
    if (v === state.rvSettings.DatRoot || v === romRoot()) throw bad('Pick a folder that isn’t the DAT or ROM folder.');
    const t = new RvFile(FileType.Dir);
    t.Name = v; t.Tree = new RvTreeRow(); t.DatStatus = DatStatus.InToSort;
    DB.DirRoot.childAdd(t, DB.DirRoot.ChildCount);
    saveNow();
    return publicSettings();
  }
  const t = findNode(b.id);
  if (!t || t.Parent !== DB.DirRoot || t === DB.DirRoot.child(0)) throw bad('That isn’t a ToSort folder.');
  const T = ToSortDirType;
  const unlock = () => { if (t.Tree.Checked === TreeSelect.Locked) t.Tree.setChecked(TreeSelect.Selected); };
  switch (b.action) {
    case 'primary': {
      unlock();
      const p = DB.getToSortPrimary(); const wasCache = p.toSortStatusIs(T.ToSortCache);
      p.toSortStatusClear(T.ToSortPrimary | T.ToSortCache);
      t.toSortStatusClear(T.ToSortFileOnly);
      t.toSortStatusSet(T.ToSortPrimary); if (wasCache) t.toSortStatusSet(T.ToSortCache);
      break;
    }
    case 'cache': unlock(); DB.getToSortCache().toSortStatusClear(T.ToSortCache); t.toSortStatusClear(T.ToSortFileOnly); t.toSortStatusSet(T.ToSortCache); break;
    case 'fileOnly':
      if (t.toSortStatusIs(T.ToSortPrimary)) throw bad('The primary ToSort folder can’t be File Only.');
      if (t.toSortStatusIs(T.ToSortCache)) throw bad('The cache ToSort folder can’t be File Only.');
      unlock(); t.toSortStatusSet(T.ToSortFileOnly); break;
    case 'clearFileOnly': t.toSortStatusClear(T.ToSortFileOnly); break;
    case 'remove':
      if (t.toSortStatusIs(T.ToSortPrimary) || t.toSortStatusIs(T.ToSortCache)) throw bad('Make another ToSort folder the primary (and cache) one first.');
      for (let i = 1; i < DB.DirRoot.ChildCount; i++) if (DB.DirRoot.child(i) === t) { DB.DirRoot.childRemove(i); reportStatusReset(DB.DirRoot); break; }
      break;
    case 'up': DB.moveToSortUp(t); break;
    case 'down': DB.moveToSortDown(t); break;
    default: throw bad('Unknown ToSort action');
  }
  saveNow();
  return publicSettings();
}

// ------------------------------------------------------------------------------------------------ jobs
let job = null;
let fixRows = readFixLog();
function readFixLog() { try { return JSON.parse(fs.readFileSync(fixLogFile, 'utf8')); } catch { return { finished: null, rows: [] }; } }

const LABEL = { updateDats: 'Updating DATs', refreshDats: 'Refreshing all DATs', scan: 'Scanning ROMs', findFixes: 'Finding fixes', fix: 'Fixing ROMs', auto: 'Scan, find fixes and fix' };
let lastPost = 0;
function post(force) {
  const now = Date.now();
  if (!force && now - lastPost < 250) return;
  lastPost = now;
  parentPort.postMessage({ type: 'job', job: publicJob() });
}
function publicJob() {
  if (!job) return null;
  const { errors, ac, fixRows: _rows, ...rest } = job;
  return { ...rest, errors: errors.slice(-200), errorCount: errors.length };
}

function makeThWrk() {
  const j = job;
  return {
    text(s) { j.text = s; post(); }, text2(s) { j.text2 = s; post(); }, text3(s) { j.text3 = s; post(); },
    progress(n) { j.value = n; post(); }, range(n) { j.range = n; j.value = 0; post(); },
    value2(n) { j.value2 = n; post(); }, range2(n) { j.range2 = n; post(); },
    error(file, msg) { j.errors.push({ file, msg }); post(); },
    fix(row) { j.fixes++; if (j.fixRows.length < 50000) j.fixRows.push(row); post(); },
    fixError(msg) { const last = j.fixRows[j.fixRows.length - 1]; if (last) last.error = msg; },
    get cancelled() { return Atomics.load(cancelFlag, 0) === 1; },
    signal: j.ac.signal,
  };
}

async function runJob(type, args) {
  if (job && job.state === 'running') throw Object.assign(new Error(`Busy: ${job.label}. Wait for it to finish or cancel it.`), { status: 409 });
  if (!configured()) throw bad('Choose the DAT, ROM and ToSort folders first (Settings).');
  Atomics.store(cancelFlag, 0, 0);
  job = { id: Date.now(), type, label: LABEL[type], state: 'running', started: Date.now(), text: '', text2: '', text3: '', value: 0, range: 0, value2: 0, range2: 0, errors: [], fixes: 0, fixRows: [], phase: '', ac: new AbortController() };
  const j = job;
  const th = makeThWrk();
  const watch = setInterval(() => { if (th.cancelled && !j.ac.signal.aborted) j.ac.abort(); }, 200);
  const level = [EScanLevel.Level1, EScanLevel.Level2, EScanLevel.Level3].includes(args.level) ? args.level : EScanLevel.Level2;
  const startAt = args.id ? findNode(args.id) : null;
  if (args.id && !startAt) throw bad('That folder is no longer in the tree.');
  const steps = {
    dats: () => { j.phase = 'Update DATs'; updateDat(th); },
    scan: async () => { j.phase = 'Scan ROMs'; await new FileScanning(th, { startAt, scanLevel: level }).scanFiles(); },
    find: () => { j.phase = 'Find Fixes'; findFixes(th); },
    fix: async () => { j.phase = 'Fix ROMs'; j.result = await performFixes(th); },
  };
  const plan = {
    updateDats: ['dats'], refreshDats: ['dats'], scan: ['scan'], findFixes: ['find'], fix: ['fix'], auto: ['scan', 'find', 'fix'],
  }[type];
  (async () => {
    try {
      if (type === 'refreshDats') invalidateAllDATs(DB.DirRoot.child(0), 'RomVault');
      for (const step of plan) {
        if (th.cancelled) break;
        await steps[step]();
        if (step === 'fix' && j.result?.failed) break;
      }
      j.state = th.cancelled ? 'cancelled' : 'done';
    } catch (e) {
      j.state = 'error'; j.error = e.message; j.errors.push({ file: j.phase, msg: e.stack || e.message });
    } finally {
      clearInterval(watch);
      j.finished = Date.now();
      if (j.fixRows.length) {
        fixRows = { finished: j.finished, rows: j.fixRows };
        try { fs.writeFileSync(fixLogFile, JSON.stringify(fixRows)); } catch { /* the log is a convenience */ }
      }
      j.fixRows = [];
      post(true);
    }
  })();
  return publicJob();
}

function fixDats(args) {
  const t = args.id ? findNode(args.id) : DB.DirRoot.child(0);
  if (!t) throw bad('That folder is no longer in the tree.');
  const out = args.save ? state.rvSettings.FixDatOutPath : fs.mkdtempSync(path.join(tmpDir, 'fixdat-'));
  if (!out) throw bad('Choose a folder for fix DATs first (Settings → Fix DAT folder).');
  const files = recursiveDatTree(out, t, !!args.redOnly);
  if (args.save) return { saved: files.length, folder: out };
  const list = files.map((f) => ({ name: path.basename(f), xml: fs.readFileSync(f, 'utf8') }));
  fs.rmSync(out, { recursive: true, force: true });
  return { files: list };
}

// ------------------------------------------------------------------------------------------------ messages
const handlers = {
  status: () => ({ configured: configured(), job: publicJob(), settings: publicSettings(), fixLog: { finished: fixRows.finished, count: fixRows.rows.length } }),
  tree: () => ({ tree: tree(), job: publicJob() }),
  games: (a) => games(a.id, a),
  roms: (a) => roms(a.id, a.game, a),
  check: (a) => { setChecked(a.id, intIn(a.value, 0, 2, TreeSelect.Selected), !!a.shift); return { tree: tree() }; },
  expand: (a) => { setExpanded(a.id, a.value, !!a.children); return { ok: true }; },
  preset: (a) => { const n = intIn(a.n, 1, 4, 0); if (!n) throw bad('Pick a pre-set from 1 to 4'); if (a.save) presetSave(n); else presetLoad(n); return { tree: tree(), settings: publicSettings() }; },
  job: (a) => runJob(a.type, a),
  set7z: (a) => { sevenZipExe = a.path || null; return { ok: true }; },
  settings: () => publicSettings(),
  saveSettings: (a) => saveGeneral(a),
  saveRule: (a) => saveRule(a),
  deleteRule: (a) => deleteRule(a.DirKey),
  saveMapping: (a) => saveMapping(a),
  deleteMapping: (a) => deleteMapping(a.DirKey),
  toSort: (a) => toSortAction(a),
  report: (a) => (a.kind === 'fix' ? generateFixReport(DB.DirRoot.child(0)) : generateReport(DB.DirRoot.child(0))),
  fixDats: (a) => fixDats(a),
  fixLog: () => fixRows,
  errors: () => (job ? job.errors : []),
  flush: () => { if (!job || job.state !== 'running') saveNow(); return { ok: true }; },
};
const NEEDS_IDLE = new Set(['saveSettings', 'saveRule', 'deleteRule', 'saveMapping', 'deleteMapping', 'toSort', 'check', 'preset']);

parentPort.on('message', async (m) => {
  if (!m || m.id == null) return;
  try {
    const h = handlers[m.cmd];
    if (!h) throw bad(`Unknown command ${m.cmd}`);
    if (NEEDS_IDLE.has(m.cmd) && job?.state === 'running') throw Object.assign(new Error('Wait for the job that’s running to finish first.'), { status: 409 });
    const result = await h(m.args || {});
    parentPort.postMessage({ id: m.id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: e.message, status: e.status || 500 });
  }
});

// Exposed for tests and the demo only.
module.exports = { RepStatusName, ZipStructureName, EFixLevel };
