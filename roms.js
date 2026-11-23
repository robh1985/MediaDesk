// ROM Librarian: keeps a ROM collection matched to DAT files (No-Intro, Redump, MAME, TOSEC…).
//
//  • DATs live in a DAT folder; its sub-folders make the tree. A folder with several DATs gets a
//    sub-folder per DAT. Each tree folder maps to a ROM folder (under the ROM root, or a folder
//    picked for it), with its own rules: merge mode, archive format, TorrentZip, what to keep.
//  • Scanning reads every file in the ROM folders and the ToSort folders, inside ZIP and 7z too,
//    and keeps the hashes (CRC32, SHA-1, MD5, and the same without a copier header) in a cache.
//  • Finding fixes matches every file a DAT lists against what was found: correct, missing,
//    can be fixed (from somewhere else), to rename, unknown (move to ToSort), a duplicate (delete).
//  • Fixing builds each set's archive (TorrentZip ZIP, 7z or a plain folder) from wherever its
//    files were found, moves files nobody needs to the primary ToSort folder and removes
//    duplicates once a verified copy is in place.
//
// Everything runs on the MediaDesk server; one job at a time, with progress and Cancel.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const Z = require('./roms-zip');
const D = require('./roms-dat');

const isWin = process.platform === 'win32';
const keyOf = (p) => (isWin ? path.resolve(p).toLowerCase() : path.resolve(p));
const sameName = (a, b) => a === b;
const sameFsName = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
const posix = (p) => p.split(path.sep).join('/');
const safeName = (s) => String(s).replace(/[<>:"\\|?*\u0000-\u001f]/g, '_').replace(/\//g, '_').replace(/[. ]+$/, '').trim() || '_';
const safeRel = (s) => String(s).split('/').map(safeName).join('/');
const sleep0 = () => new Promise((r) => setImmediate(r));

const MERGES = ['auto', 'split', 'merged', 'nonmerged', 'fullnonmerged'];
const FORMATS = ['zip', '7z', 'folder'];
const FILTERS = ['all', 'roms', 'disks'];
const LEVELS = ['quick', 'normal', 'full'];
const RULE_DEFAULTS = { merge: 'auto', format: 'zip', torrentzip: true, filter: 'all' };
const SETTINGS_DEFAULTS = {
  datRoot: '', romRoot: '', toSort: [], fixDatFolder: '',
  ignore: ['Thumbs.db', 'desktop.ini', '.DS_Store', '._*'],
  rules: {}, scanLevel: 'normal', deleteToSortDupes: true, removeEmptyFolders: true,
};

class RomError extends Error { constructor(status, message) { super(message); this.status = status; } }

function globRe(list) {
  const parts = (list || []).map((g) => String(g).trim()).filter(Boolean).map((g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
  return parts.length ? new RegExp(`^(?:${parts.join('|')})$`, 'i') : null;
}

function createRoms({ dataDir, mock = false, getSevenZip = () => null, demo = null }) {
  const dir = path.join(dataDir, 'roms');
  fs.mkdirSync(dir, { recursive: true });
  const files = { settings: path.join(dir, 'settings.json'), dats: path.join(dir, 'dats.json'), scan: path.join(dir, 'scan.json'), log: path.join(dir, 'last-job.txt') };
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJ = async (f, v) => { const tmp = `${f}.tmp`; await fsp.writeFile(tmp, JSON.stringify(v)); await fsp.rename(tmp, f); };

  let settings = { ...SETTINGS_DEFAULTS, ...readJ(files.settings, {}) };
  let datCache = readJ(files.dats, { files: {} });        // rel DAT path → { size, mtime, dats: [parsed] }
  let scanCache = readJ(files.scan, { files: {} });       // abs path → { size, mtime, kind, deep, tz, corrupt, entries }
  let datList = [];                                       // loaded DATs (see loadDatList)
  let analysis = null;
  let job = null;
  let lastLog = (() => { try { return fs.readFileSync(files.log, 'utf8'); } catch { return ''; } })();
  let ready = null;

  // --- Settings ---------------------------------------------------------------------------------
  function cleanRule(r) {
    const o = {};
    if (!r || typeof r !== 'object') return o;
    if (MERGES.includes(r.merge)) o.merge = r.merge;
    if (FORMATS.includes(r.format)) o.format = r.format;
    if (typeof r.torrentzip === 'boolean') o.torrentzip = r.torrentzip;
    if (FILTERS.includes(r.filter)) o.filter = r.filter;
    if (typeof r.romFolder === 'string' && r.romFolder.trim()) o.romFolder = path.resolve(r.romFolder.trim());
    return o;
  }
  async function checkFolder(p, label, { create = false } = {}) {
    if (!p) return '';
    const abs = String(p).trim();
    if (!path.isAbsolute(abs)) throw new RomError(400, `${label}: give the full path of a folder (for example D:\\ROMs)`);
    if (create) await fsp.mkdir(abs, { recursive: true }).catch(() => {});
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isDirectory()) throw new RomError(400, `${label}: ${abs} isn’t a folder MediaDesk can reach`);
    return path.resolve(abs);
  }
  async function saveSettings(body) {
    if (mock && (body.datRoot !== undefined || body.romRoot !== undefined || body.toSort !== undefined)) throw new RomError(400, 'Folders can’t be changed in demo mode');
    const next = { ...settings };
    if (typeof body.datRoot === 'string') next.datRoot = await checkFolder(body.datRoot, 'DAT folder');
    if (typeof body.romRoot === 'string') next.romRoot = await checkFolder(body.romRoot, 'ROM folder', { create: true });
    if (typeof body.fixDatFolder === 'string') next.fixDatFolder = body.fixDatFolder.trim() ? await checkFolder(body.fixDatFolder, 'Fix DAT folder', { create: true }) : '';
    if (Array.isArray(body.toSort)) {
      const list = [];
      for (const t of body.toSort.slice(0, 20)) {
        const p = typeof t === 'string' ? t : t?.path;
        if (!p || !String(p).trim()) continue;
        list.push({ path: await checkFolder(p, 'ToSort folder', { create: true }), primary: Boolean(t?.primary) });
      }
      if (list.length && !list.some((t) => t.primary)) list[0].primary = true;
      let seen = false;
      for (const t of list) { if (t.primary && seen) t.primary = false; if (t.primary) seen = true; }
      next.toSort = list;
    }
    if (Array.isArray(body.ignore)) next.ignore = body.ignore.map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 100);
    if (LEVELS.includes(body.scanLevel)) next.scanLevel = body.scanLevel;
    if (typeof body.deleteToSortDupes === 'boolean') next.deleteToSortDupes = body.deleteToSortDupes;
    if (typeof body.removeEmptyFolders === 'boolean') next.removeEmptyFolders = body.removeEmptyFolders;
    if (body.rules && typeof body.rules === 'object') {
      next.rules = { ...next.rules };
      for (const [k, v] of Object.entries(body.rules)) {
        const key = String(k).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (v === null) { delete next.rules[key]; continue; }
        if (v.romFolder) v.romFolder = await checkFolder(v.romFolder, 'ROM folder for this DAT folder', { create: true });
        const r = cleanRule(v);
        if (Object.keys(r).length) next.rules[key] = r; else delete next.rules[key];
      }
    }
    settings = next;
    await writeJ(files.settings, settings);
    if (datList.length) analysis = analyze();
    return publicSettings();
  }
  const publicSettings = () => ({ ...settings, sevenZip: Boolean(getSevenZip()) });

  // Rules for a tree path: defaults, then each folder from the root down.
  function ruleFor(treePath) {
    const out = { ...RULE_DEFAULTS };
    const parts = treePath ? treePath.split('/') : [];
    for (let i = 0; i <= parts.length; i++) {
      const r = settings.rules[parts.slice(0, i).join('/')];
      if (r) { const { romFolder, ...rest } = r; Object.assign(out, rest); }
    }
    return out;
  }
  // The ROM folder for a tree path: the nearest folder with its own ROM folder, plus the rest.
  function romDirFor(treePath) {
    const parts = treePath ? treePath.split('/') : [];
    for (let i = parts.length; i >= 0; i--) {
      const r = settings.rules[parts.slice(0, i).join('/')];
      if (r?.romFolder) return path.join(r.romFolder, ...parts.slice(i).map(safeName));
    }
    return settings.romRoot ? path.join(settings.romRoot, ...parts.map(safeName)) : null;
  }

  // --- DATs ---------------------------------------------------------------------------------------
  const DAT_RE = /\.(dat|xml)$/i;
  async function walk(root, onFile, { skip } = {}) {
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      let list;
      try { list = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        if (e.name.startsWith('.rl-')) continue;
        const abs = path.join(d, e.name);
        if (skip?.(abs, e)) continue;
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) await onFile(abs, e.name);
      }
    }
  }
  async function readDatFile(abs) {
    const ext = path.extname(abs).toLowerCase();
    const texts = [];
    if (ext === '.zip') {
      const zd = await Z.readZipDirectory(abs);
      for (const e of zd.entries.filter((x) => DAT_RE.test(x.name))) {
        const chunks = [];
        for await (const c of await Z.zipEntryStream(abs, e)) chunks.push(c);
        texts.push([e.name, Buffer.concat(chunks).toString('utf8')]);
      }
    } else if (ext === '.7z') {
      const exe = getSevenZip();
      if (!exe) throw new Error('7-Zip is needed to read DATs inside 7z archives');
      for (const e of (await Z.list7z(exe, abs)).filter((x) => DAT_RE.test(x.name))) {
        const chunks = [];
        for await (const c of Z.sevenZipEntryStream(exe, abs, e.name)) chunks.push(c);
        texts.push([e.name, Buffer.concat(chunks).toString('utf8')]);
      }
    } else texts.push([path.basename(abs), await fsp.readFile(abs, 'utf8')]);
    return texts.map(([name, t]) => ({ inner: name, ...D.parseDat(t) }));
  }

  async function updateDats(ctx) {
    if (!settings.datRoot) throw new RomError(400, 'Choose the DAT folder first (Settings in ROM Librarian)');
    const found = [];
    await walk(settings.datRoot, async (abs, name) => { if (/\.(dat|xml|zip|7z)$/i.test(name)) found.push(abs); });
    found.sort();
    const nextCache = { files: {} };
    let added = 0, changed = 0, failed = 0;
    ctx.total = found.length;
    for (const abs of found) {
      ctx.check();
      const rel = posix(path.relative(settings.datRoot, abs));
      ctx.step(rel);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      const prev = datCache.files[rel];
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) { nextCache.files[rel] = prev; continue; }
      try {
        const dats = await readDatFile(abs);
        if (!dats.length) continue;
        nextCache.files[rel] = { size: st.size, mtime: st.mtimeMs, dats, loaded: Date.now() };
        if (prev) changed++; else added++;
      } catch (err) {
        if (/\.(zip|7z)$/i.test(abs) && /No games found|No ZIP directory/.test(err.message)) continue;
        failed++;
        ctx.log(`Couldn’t read ${rel}: ${err.message}`);
        if (prev) nextCache.files[rel] = prev;
      }
      await sleep0();
    }
    const removed = Object.keys(datCache.files).filter((k) => !nextCache.files[k]).length;
    datCache = nextCache;
    await writeJ(files.dats, datCache);
    loadDatList();
    ctx.log(`DATs: ${datList.length} loaded (${added} new, ${changed} changed, ${removed} removed${failed ? `, ${failed} couldn’t be read` : ''}).`);
  }

  // Each DAT's place in the tree: its folder, plus a sub-folder named after it when the folder
  // holds more than one DAT.
  function loadDatList() {
    const byDir = new Map();
    for (const [rel, f] of Object.entries(datCache.files)) {
      const dirKey = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
      for (const d of f.dats) {
        const list = byDir.get(dirKey) || [];
        list.push({ rel, inner: d.inner, dat: d });
        byDir.set(dirKey, list);
      }
    }
    const out = [];
    for (const [dirKey, list] of byDir) {
      const used = new Set();
      for (const x of list.sort((a, b) => a.rel.localeCompare(b.rel))) {
        let sub = '';
        if (list.length > 1) {
          sub = safeName(x.dat.header.name || path.posix.basename(x.inner).replace(/\.(dat|xml)$/i, ''));
          for (let n = 2; used.has(sub.toLowerCase()); n++) sub = `${safeName(x.dat.header.name || x.inner)} (${n})`;
          used.add(sub.toLowerCase());
        }
        const treePath = [dirKey, sub].filter(Boolean).join('/');
        out.push({ id: crypto.createHash('sha1').update(`${x.rel}|${x.inner}`).digest('hex').slice(0, 12), file: x.rel, inner: x.inner, treePath, header: x.dat.header, dat: x.dat });
      }
    }
    datList = out.sort((a, b) => a.treePath.localeCompare(b.treePath));
  }
  loadDatList();

  // --- Scanning -------------------------------------------------------------------------------------
  function scanRoots() {
    const roots = [];
    if (settings.romRoot) roots.push({ path: settings.romRoot, region: 'rom' });
    for (const r of Object.values(settings.rules)) if (r.romFolder && !roots.some((x) => keyOf(x.path) === keyOf(r.romFolder) || isInside(r.romFolder, x.path))) roots.push({ path: r.romFolder, region: 'rom' });
    settings.toSort.forEach((t, i) => roots.push({ path: t.path, region: 'tosort', index: i }));
    return roots;
  }
  const isInside = (p, root) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  const ignoreRe = () => globRe(settings.ignore);
  const kindOf = (name) => { const e = path.extname(name).toLowerCase(); return e === '.zip' ? 'zip' : e === '.7z' ? '7z' : e === '.chd' ? 'chd' : 'file'; };

  async function scan(ctx, level = settings.scanLevel, { only } = {}) {
    const roots = scanRoots();
    if (!roots.length) throw new RomError(400, 'Choose a ROM folder first (Settings in ROM Librarian)');
    const ign = ignoreRe();
    const list = [];
    const tosortKeys = settings.toSort.map((t) => keyOf(t.path));
    // DATs and fix DATs kept inside the ROM folder aren't part of the collection.
    const keepOut = [settings.datRoot, settings.fixDatFolder, dataDir].filter(Boolean).map(keyOf);
    for (const r of roots) {
      ctx.step(`Looking in ${r.path}`);
      await walk(r.path, async (abs, name) => {
        if (ign?.test(name)) return;
        if (only && !only.has(keyOf(abs))) return;
        list.push(abs);
      }, { skip: (abs, e) => (ign?.test(e.name)) || (r.region === 'rom' && e.isDirectory() && (tosortKeys.includes(keyOf(abs)) || keepOut.includes(keyOf(abs)))) });
    }
    ctx.total = list.length;
    const exe = getSevenZip();
    const next = only ? { files: { ...scanCache.files } } : { files: {} };
    let hashed = 0, problems = 0;
    for (const abs of list) {
      ctx.check();
      ctx.step(abs);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      const prev = scanCache.files[abs];
      const kind = kindOf(abs);
      const deepWanted = level !== 'quick' || kind === 'file' || kind === 'chd';
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs && level !== 'full' && (prev.deep || !deepWanted) && !(prev.corrupt && level === 'full')) { next.files[abs] = prev; continue; }
      const rec = { size: st.size, mtime: st.mtimeMs, kind, deep: deepWanted, entries: [] };
      try {
        if (kind === 'zip') {
          const zd = await Z.readZipDirectory(abs);
          rec.tz = zd.torrentzip;
          rec.entries = deepWanted ? await Z.hashZip(abs, zd, { signal: ctx.signal, onEntry: (n) => ctx.sub(n) }) : zd.entries.map((e) => ({ name: e.name, size: e.size, crc: e.crc }));
        } else if (kind === '7z') {
          if (!exe) { rec.corrupt = '7-Zip isn’t installed, so this 7z wasn’t read'; rec.unreadable = true; } else {
            const l = await Z.list7z(exe, abs, { signal: ctx.signal });
            rec.entries = deepWanted ? await Z.hash7z(exe, abs, l, { signal: ctx.signal, onEntry: (n) => ctx.sub(n) }) : l.map((e) => ({ name: e.name, size: e.size, crc: e.crc }));
          }
        } else if (kind === 'chd') {
          const c = await Z.readChd(abs);
          rec.entries = [{ name: path.basename(abs), size: st.size, chd: c && c.sha1 ? { sha1: c.sha1, md5: c.md5 } : null, ...(c ? {} : { corrupt: 'Not a CHD file' }) }];
        } else {
          rec.entries = [{ name: path.basename(abs), ...(await Z.hashFile(abs, { signal: ctx.signal })) }];
        }
        if (rec.entries.some((e) => e.corrupt)) problems++;
        hashed++;
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        rec.corrupt = err.message; rec.entries = []; problems++;
      }
      next.files[abs] = rec;
      if (hashed % 50 === 0) await sleep0();
    }
    scanCache = next;
    await writeJ(files.scan, scanCache);
    ctx.log(`Scan (${level}): ${list.length} files, ${hashed} read${problems ? `, ${problems} damaged or unreadable` : ''}.`);
  }

  // --- Finding fixes ----------------------------------------------------------------------------------
  const matchOne = (it, x) => {
    if (it.disk) {
      if (!x.chd) return false;
      if (it.sha1 && x.chd.sha1) return it.sha1 === x.chd.sha1;
      if (it.md5 && x.chd.md5) return it.md5 === x.chd.md5;
      return false;
    }
    if (x.chd !== undefined) return false;
    if (it.size != null && x.size !== it.size) return false;
    if (it.sha1 && x.sha1) return it.sha1 === x.sha1;
    if (it.md5 && x.md5) return it.md5 === x.md5;
    if (it.crc && x.crc) return it.crc === x.crc;
    return false;
  };
  const matches = (it, e) => !e.corrupt && (matchOne(it, e) || (e.alt && !it.disk ? matchOne(it, e.alt) : false));
  const keysOfEntry = (e) => {
    const k = [];
    if (e.chd) { if (e.chd.sha1) k.push(`d:${e.chd.sha1}`); else if (e.chd.md5) k.push(`dm:${e.chd.md5}`); return k; }
    for (const x of [e, e.alt].filter(Boolean)) { if (x.crc) k.push(`c:${x.size}:${x.crc}`); if (x.sha1) k.push(`s:${x.sha1}`); if (x.md5) k.push(`m:${x.md5}`); }
    return k;
  };
  const keyOfItem = (it) => (it.disk ? (it.sha1 ? `d:${it.sha1}` : it.md5 ? `dm:${it.md5}` : null) : it.crc && it.size != null ? `c:${it.size}:${it.crc}` : it.sha1 ? `s:${it.sha1}` : it.md5 ? `m:${it.md5}` : null);

  function analyze() {
    const t0 = Date.now();
    const tosortIdx = settings.toSort.map((t) => keyOf(t.path));
    const regionOf = (abs) => {
      const k = keyOf(abs);
      for (let i = 0; i < tosortIdx.length; i++) if (k === tosortIdx[i] || k.startsWith(tosortIdx[i] + path.sep)) return { region: 'tosort', index: i };
      return { region: 'rom' };
    };
    // Sets, with where each one lives.
    const dats = [];
    const homes = new Map();      // key of archive path or folder → { set, role: 'archive'|'folder'|'disks' }
    for (const d of datList) {
      const rule = ruleFor(d.treePath);
      const romDir = romDirFor(d.treePath);
      const { mode, sets } = D.buildSets(d.dat, { mode: rule.merge, filter: rule.filter });
      const info = { id: d.id, treePath: d.treePath, file: d.file, header: d.header, rule, mode, romDir, sets: [] };
      for (const s of sets) {
        const base = romDir ? path.join(romDir, safeName(s.name)) : null;
        const S = { name: s.name, description: s.description, parent: s.parent, bios: s.bios, year: s.year, manufacturer: s.manufacturer, dat: info,
          items: s.items.map((it) => ({ ...it, state: null })), archive: null, folder: base, extras: [] };
        const romsAreFolder = rule.format === 'folder';
        if (base && !romsAreFolder) { S.archive = `${base}.${rule.format}`; homes.set(keyOf(S.archive), { set: S, role: 'archive' }); }
        if (base) homes.set(keyOf(base), { set: S, role: 'folder' });
        info.sets.push(S);
      }
      dats.push(info);
    }
    // What was found: containers (archives, loose files, set folders) and the entries in them.
    const containers = new Map();
    const entries = [];
    const addEntry = (C, raw, extra) => { const e = { ...raw, ...extra, c: C, state: null }; C.entries.push(e); entries.push(e); return e; };
    const folderHome = (abs) => {
      // A file inside a set's folder (or a sub-folder of it), up to its ROM folder.
      let d = path.dirname(abs);
      for (let i = 0; i < 6; i++) { const h = homes.get(keyOf(d)); if (h && h.role === 'folder') return { h, dir: d }; const up = path.dirname(d); if (up === d) break; d = up; }
      return null;
    };
    for (const [abs, rec] of Object.entries(scanCache.files)) {
      const reg = regionOf(abs);
      const fh = reg.region === 'rom' && (rec.kind === 'file' || rec.kind === 'chd') ? folderHome(abs) : null;
      if (fh) {
        const ck = keyOf(fh.dir);
        let C = containers.get(ck);
        if (!C) { C = { path: fh.dir, kind: 'folder', region: 'rom', entries: [], home: fh.h.set }; containers.set(ck, C); }
        const e = rec.entries[0];
        if (e) addEntry(C, e, { name: posix(path.relative(fh.dir, abs)), file: abs });
        else if (rec.corrupt) addEntry(C, { size: rec.size, corrupt: rec.corrupt }, { name: posix(path.relative(fh.dir, abs)), file: abs });
        continue;
      }
      const C = { path: abs, kind: rec.kind === 'chd' ? 'file' : rec.kind, region: reg.region, tsIndex: reg.index, entries: [], corrupt: rec.corrupt || null, unreadable: rec.unreadable, tz: rec.tz, size: rec.size };
      const h = reg.region === 'rom' && (rec.kind === 'zip' || rec.kind === '7z') ? homes.get(keyOf(abs)) : null;
      if (h && h.role === 'archive') C.home = h.set;
      containers.set(keyOf(abs), C);
      for (const e of rec.entries) addEntry(C, e, C.kind === 'file' ? { file: abs } : {});
    }
    for (const C of containers.values()) {
      if (!C.home) continue;
      if (C.kind === 'folder') C.home.folderC = C; else C.home.archiveC = C;
    }
    // 1. Correct files, in the right place with the right name.
    const allSets = dats.flatMap((d) => d.sets);
    for (const S of allSets) {
      const homeEntries = (it) => (it.disk || S.dat.rule.format === 'folder' ? S.folderC : S.archiveC)?.entries || [];
      for (const it of S.items) {
        if (it.nodump) { it.state = 'nodump'; continue; }
        const nameEq = it.disk || S.dat.rule.format === 'folder' ? sameFsName : sameName;
        const e = homeEntries(it).find((x) => !x.state && nameEq(x.name, it.name) && matches(it, x));
        if (e) { it.state = 'correct'; it.at = e; e.state = 'correct'; e.item = it; e.set = S; }
      }
      // 2. Right file, wrong name, in the same archive or folder.
      for (const it of S.items) {
        if (it.state) continue;
        const e = homeEntries(it).find((x) => !x.state && matches(it, x));
        if (e) { it.state = 'rename'; it.from = e; e.state = 'rename'; e.item = it; e.set = S; }
      }
    }
    // 3. Everything else that's missing: look for it anywhere.
    const index = new Map();
    for (const e of entries) { if (e.corrupt) continue; for (const k of keysOfEntry(e)) { const l = index.get(k); if (l) l.push(e); else index.set(k, [e]); } }
    const rank = (e) => (e.state === null ? (e.c.region === 'tosort' ? 0 : 1) : e.state === 'needed' ? 2 : 3);
    for (const S of allSets) {
      for (const it of S.items) {
        if (it.state) continue;
        const k = keyOfItem(it);
        const cands = (k ? index.get(k) || [] : []).filter((e) => matches(it, e) && e.state !== 'rename' && !(e.item === it));
        if (!cands.length) { it.state = 'missing'; continue; }
        cands.sort((a, b) => rank(a) - rank(b));
        const src = cands[0];
        it.state = 'fixable'; it.from = src;
        if (src.state === null) src.state = 'needed';
        (src.usedBy ||= []).push({ set: S, item: it });
      }
    }
    // 4. What's left over: duplicates, unknown files, damaged files.
    const kept = (it) => it.state === 'correct' || it.state === 'fixable' || it.state === 'rename';
    const haveKey = new Set();
    for (const S of allSets) for (const it of S.items) if (kept(it)) { const k = keyOfItem(it); if (k) haveKey.add(k); }
    for (const e of entries) {
      if (e.state) continue;
      if (e.corrupt || e.c.corrupt) { e.state = 'corrupt'; continue; }
      const dup = keysOfEntry(e).some((k) => haveKey.has(k));
      if (e.c.region === 'rom') e.state = dup ? 'delete' : 'tosort';
      else e.state = dup && settings.deleteToSortDupes ? 'delete' : 'intosort';
    }
    for (const C of containers.values()) if (C.corrupt && !C.entries.length) C.state = C.unreadable ? 'unreadable' : 'corrupt';
    // 5. Sets: counts and whether the archive itself needs rebuilding (TorrentZip, leftovers).
    for (const S of allSets) {
      const c = { total: 0, have: 0, fix: 0, missing: 0 };
      for (const it of S.items) {
        if (it.state === 'nodump') continue;
        c.total++;
        if (it.state === 'correct') c.have++; else if (it.state === 'missing') c.missing++; else c.fix++;
      }
      const leftovers = [S.archiveC, S.folderC].filter(Boolean).flatMap((C) => C.entries.filter((e) => e.state !== 'correct' && e.state !== 'rename'));
      S.extras = leftovers;
      S.rezip = Boolean(S.archiveC && S.dat.rule.format === 'zip' && S.dat.rule.torrentzip && !S.archiveC.tz && c.have > 0);
      S.counts = c;
      S.status = c.total === 0 ? 'empty' : c.have === c.total ? (S.rezip || leftovers.length ? 'fixable' : 'complete') : c.have + c.fix === c.total ? 'fixable' : c.have + c.fix > 0 ? 'partial' : 'missing';
      S.needsWork = c.fix > 0 || S.rezip || leftovers.length > 0 || (S.archiveC?.corrupt && c.total > 0);
    }
    const a = { dats, containers, entries, at: Date.now(), ms: Date.now() - t0 };
    a.tree = buildTree(a);
    return a;
  }

  // The tree the app shows: DAT folders with counts, then ToSort folders and the rest of the
  // ROM folder (files no DAT asked for).
  function buildTree(a) {
    const nodes = new Map();
    const blank = () => ({ sets: 0, complete: 0, partial: 0, missing: 0, fixable: 0, have: 0, total: 0, fix: 0, need: 0, unknown: 0, del: 0, corrupt: 0 });
    const node = (p) => {
      if (nodes.has(p)) return nodes.get(p);
      const n = { path: p, name: p ? p.split('/').pop() : 'DATs', kind: 'dir', counts: blank(), children: [] };
      nodes.set(p, n);
      if (p) { const parent = node(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''); parent.children.push(n); }
      return n;
    };
    const root = node('');
    const bump = (p, f) => { for (let q = p; ; q = q.includes('/') ? q.slice(0, q.lastIndexOf('/')) : '') { f(node(q).counts); if (!q) break; } };
    const romDirs = [];
    for (const d of a.dats) {
      const n = node(d.treePath);
      n.kind = 'dat'; n.datId = d.id; n.title = d.header.description || d.header.name || n.name; n.version = d.header.version || ''; n.mode = d.mode;
      if (d.romDir) romDirs.push({ key: keyOf(d.romDir), p: d.treePath });
      for (const S of d.sets) {
        bump(d.treePath, (c) => {
          c.sets++; c.have += S.counts.have; c.total += S.counts.total; c.fix += S.counts.fix;
          if (S.status === 'complete') c.complete++; else if (S.status === 'missing') c.missing++; else if (S.status === 'fixable') c.fixable++; else c.partial++;
          if (S.needsWork) c.need++;
        });
      }
    }
    // Leftover files, counted on the deepest DAT folder whose ROM folder holds them.
    romDirs.sort((x, y) => y.key.length - x.key.length);
    for (const C of a.containers.values()) {
      if (C.region !== 'rom') continue;
      const ck = keyOf(C.path);
      const owner = romDirs.find((r) => ck.startsWith(r.key + path.sep));
      C.treePath = owner ? owner.p : null;
      for (const e of C.entries) {
        if (!['tosort', 'delete', 'corrupt'].includes(e.state)) continue;
        bump(owner ? owner.p : '', (c) => { if (e.state === 'tosort') c.unknown++; else if (e.state === 'delete') c.del++; else c.corrupt++; });
      }
      if (C.state === 'corrupt') bump(owner ? owner.p : '', (c) => c.corrupt++);
    }
    const sortKids = (n) => { n.children.sort((x, y) => (x.kind === 'dat') - (y.kind === 'dat') || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })); n.children.forEach(sortKids); };
    sortKids(root);
    const toSort = settings.toSort.map((t, i) => {
      const c = { files: 0, needed: 0, del: 0, stay: 0, corrupt: 0 };
      for (const C of a.containers.values()) {
        if (C.region !== 'tosort' || C.tsIndex !== i) continue;
        for (const e of C.entries) { c.files++; if (e.state === 'needed') c.needed++; else if (e.state === 'delete') c.del++; else if (e.state === 'corrupt') c.corrupt++; else c.stay++; }
        if (C.state) c.corrupt++;
      }
      return { path: `tosort:${i}`, name: path.basename(t.path) || t.path, folder: t.path, primary: t.primary, kind: 'tosort', counts: c };
    });
    return { root, toSort };
  }

  // --- Fixing -------------------------------------------------------------------------------------------
  const primaryToSort = () => settings.toSort.find((t) => t.primary)?.path || settings.toSort[0]?.path || null;
  // Where something moved to ToSort goes: its path under the ROM folder, kept under ToSort.
  function toSortPath(abs, sub = '') {
    const ts = primaryToSort();
    const roots = scanRoots().filter((r) => r.region === 'rom').map((r) => r.path);
    const root = roots.find((r) => isInside(abs, r));
    const rel = root ? path.relative(root, abs) : path.basename(abs);
    return uniquePath(path.join(ts, sub, rel));
  }
  function uniquePath(p) {
    if (!fs.existsSync(p)) return p;
    const ext = path.extname(p); const stem = p.slice(0, p.length - ext.length);
    for (let n = 2; ; n++) { const c = `${stem} (${n})${ext}`; if (!fs.existsSync(c)) return c; }
  }
  const zipDirs = new Map();
  const zipDir = async (p) => { if (!zipDirs.has(p)) zipDirs.set(p, await Z.readZipDirectory(p)); return zipDirs.get(p); };
  const openEntry = (e) => async () => {
    if (e.staged) return fs.createReadStream(e.staged, { highWaterMark: 1 << 20 });
    if (e.c.kind === 'zip') { const zd = await zipDir(e.c.path); const z = zd.entries.find((x) => x.name === e.name); if (!z) throw new Error(`${e.name} is no longer in ${e.c.path}`); return Z.zipEntryStream(e.c.path, z); }
    if (e.c.kind === '7z') return Z.sevenZipEntryStream(getSevenZip(), e.c.path, e.name);
    return fs.createReadStream(e.file, { highWaterMark: 1 << 20 });
  };
  async function moveFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try { await fsp.rename(from, to); } catch (err) { if (err.code !== 'EXDEV') throw err; await fsp.copyFile(from, to); await fsp.unlink(from); }
  }
  async function writeEntryTo(e, dest, signal) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const hasher = new Z.Hasher({ size: e.size ?? -1 });
    await pipeline(await openEntry(e)(), new (require('node:stream').Transform)({ transform(c, _e, cb) { hasher.update(c); cb(null, c); } }), fs.createWriteStream(dest), { signal });
    return hasher.digest();
  }
  const verify = (it, got) => (it.disk ? true : got.size === it.size || (got.alt && got.alt.size === it.size)) && (it.disk || matchOne(it, got) || (got.alt ? matchOne(it, got.alt) : false));

  async function fix(ctx, scope = '') {
    if (!analysis) analysis = analyze();
    const a = analysis;
    if (!primaryToSort()) throw new RomError(400, 'Add a ToSort folder first (Settings in ROM Librarian): files no DAT needs are moved there');
    const exe = getSevenZip();
    const inScope = (tp) => !scope || tp === scope || (tp || '').startsWith(`${scope}/`);
    const targets = a.dats.filter((d) => inScope(d.treePath) && d.romDir).flatMap((d) => d.sets).filter((S) => S.needsWork);
    if (targets.some((S) => S.dat.rule.format === '7z') && !exe) throw new RomError(400, 'These DAT folders are set to 7z, which needs 7-Zip on the MediaDesk server');
    const work = path.join(primaryToSort(), `.rl-work-${Date.now()}`);
    await fsp.mkdir(work, { recursive: true });
    const report = [];
    const stats = { built: 0, failed: 0, moved: 0, deleted: 0, toSort: 0, renamed: 0 };
    const touched = new Set();          // containers whose contents change
    const failedEntries = new Set();
    ctx.total = targets.length + 1;
    try {
      // Archives that will be rebuilt: anything another set needs from them is copied out first.
      const rebuilt = new Set(targets.flatMap((S) => [S.archiveC].filter(Boolean)));
      const willVanish = (C) => rebuilt.has(C) || C.kind === '7z';
      let n = 0;
      for (const S of targets) {
        for (const it of S.items) {
          const e = it.state === 'fixable' ? it.from : null;
          if (!e || e.staged || e.c.kind === 'file' || e.c.kind === 'folder') continue;
          if (!willVanish(e.c) && e.c.kind !== '7z') continue;
          ctx.check();
          ctx.step(`Copying out ${e.name}`);
          e.staged = path.join(work, `s${n++}`);
          await writeEntryTo({ ...e, staged: null }, e.staged, ctx.signal);
        }
      }
      // Build each set.
      for (const S of targets) {
        ctx.check();
        ctx.step(S.name);
        const rule = S.dat.rule;
        try {
          if (S.dat.rule.format !== 'folder') await buildArchive(S, rule, ctx, work, exe, report, stats, targets);
          await buildFolder(S, rule, ctx, report, stats);
          for (const it of S.items) if (it.state === 'fixable') it.from.okUses = (it.from.okUses || 0) + 1;
          if (S.archiveC) touched.add(S.archiveC);
          if (S.folderC) touched.add(S.folderC);
          stats.built++;
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          stats.failed++;
          for (const it of S.items) if (it.state === 'fixable') failedEntries.add(it.from);
          report.push(`✗ ${S.dat.treePath}/${S.name}: ${err.message}`);
          ctx.log(`Couldn’t fix ${S.name}: ${err.message}`);
        }
      }
      // Files copied out of a rebuilt archive that no set took in the end are kept in ToSort.
      for (const e of a.entries) {
        if (!e.staged || !rebuilt.has(e.c) || e.okUses) continue;
        const to = uniquePath(path.join(toSortPath(e.c.path).replace(/\.(zip|7z)$/i, ''), ...e.name.split('/')));
        await moveFile(e.staged, to); delete e.staged; report.push(`→ ToSort: ${e.name} from ${e.c.path}`); stats.toSort++;
      }
      zipDirs.clear();
      // Clean up where things came from and what nobody needs.
      ctx.step('Tidying up');
      const leaving = (e) => (e.state === 'needed' && e.okUses && !failedEntries.has(e)) || e.state === 'delete' || e.state === 'tosort' || (e.state === 'corrupt' && e.c.region === 'rom');
      const scopeOk = (C) => C.region === 'tosort' || inScope(C.treePath ?? '') || (C.treePath == null && !scope);
      for (const C of a.containers.values()) {
        ctx.check();
        if (C.home && targets.includes(C.home) && C.kind !== 'folder') continue; // rebuilt above
        if (!scopeOk(C)) continue;
        if (C.kind === 'folder') {
          // Set folders: files used elsewhere, and (for sets that weren't fixed) leftovers.
          const isTarget = targets.includes(C.home);
          for (const e of C.entries) {
            if (e.movedAway || !leaving(e)) continue;
            if (isTarget && e.state !== 'needed') continue;
            if (e.state === 'tosort' || e.state === 'corrupt') { await moveFile(e.file, toSortPath(e.file, e.state === 'corrupt' ? 'Corrupt' : '')); stats.toSort++; report.push(`→ ToSort: ${e.file}`); }
            else { await fsp.unlink(e.file).catch(() => {}); e.state === 'delete' ? stats.deleted++ : stats.moved++; report.push(`${e.state === 'delete' ? '✗ Deleted duplicate' : '✓ Used'}: ${e.file}`); }
          }
          touched.add(C); continue;
        }
        if (C.state === 'corrupt' && C.region === 'rom') {
          const to = toSortPath(C.path, 'Corrupt');
          await moveFile(C.path, to); report.push(`→ ToSort/Corrupt: ${C.path}`); stats.toSort++; touched.add(C); continue;
        }
        const out = C.entries.filter((e) => leaving(e) && !e.movedAway);
        if (!out.length) continue;
        const keep = C.entries.filter((e) => !out.includes(e));
        const toSort = out.filter((e) => e.state === 'tosort' || e.state === 'corrupt');
        if (C.kind === 'file') {
          const e = C.entries[0];
          if (e.movedAway) { stats.moved++; report.push(`✓ Moved into place: ${C.path}`); continue; }
          if (toSort.length) { const to = toSortPath(C.path, e.state === 'corrupt' ? 'Corrupt' : ''); await moveFile(C.path, to); report.push(`→ ToSort: ${C.path}`); stats.toSort++; }
          else { await fsp.unlink(C.path); report.push(`${e.state === 'delete' ? '✗ Deleted duplicate' : '✓ Used'}: ${C.path}`); e.state === 'delete' ? stats.deleted++ : stats.moved++; }
          touched.add(C); continue;
        }
        if (!keep.length && toSort.length === out.length) {
          const to = toSortPath(C.path); await moveFile(C.path, to); report.push(`→ ToSort: ${C.path}`); stats.toSort++; touched.add(C); continue;
        }
        if (toSort.length) {
          const dest = uniquePath(toSortPath(C.path).replace(/\.(zip|7z)$/i, '') + '.zip');
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await Z.writeTorrentZip(dest, toSort.map((e) => ({ name: e.name, open: openEntry(e), sizeHint: e.size })), { signal: ctx.signal });
          report.push(`→ ToSort: ${toSort.length} file(s) from ${C.path} into ${dest}`); stats.toSort += toSort.length;
        }
        if (keep.length) {
          const tmp = path.join(path.dirname(C.path), `.rl-tmp-${path.basename(C.path)}`);
          if (C.kind === '7z') {
            await Z.run7z(exe, ['d', '-sccUTF-8', '-y', C.path, ...out.map((e) => e.name)], { signal: ctx.signal });
          } else {
            await Z.writeTorrentZip(tmp, keep.map((e) => ({ name: e.name, open: openEntry(e), sizeHint: e.size })), { signal: ctx.signal });
            await fsp.rename(tmp, C.path);
          }
        } else await fsp.unlink(C.path);
        for (const e of out) if (e.state === 'delete') stats.deleted++; else if (e.state === 'needed') stats.moved++;
        report.push(`${keep.length ? '✎ Updated' : '✗ Removed'}: ${C.path}`);
        touched.add(C);
      }
      if (settings.removeEmptyFolders) for (const r of scanRoots()) await removeEmpty(r.path, true);
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
      for (const e of a.entries) delete e.staged;
    }
    const summary = `Fix: ${stats.built} set(s) fixed${stats.failed ? `, ${stats.failed} couldn’t be` : ''}, ${stats.toSort} moved to ToSort, ${stats.deleted} duplicate(s) deleted.`;
    ctx.log(summary);
    lastLog = [summary, '', ...report].join('\n');
    await fsp.writeFile(files.log, `\uFEFF${lastLog}`).catch(() => {});
    // Read back what changed (new archives are hashed again, which checks them too).
    await scan(ctx, 'normal');
  }

  async function buildArchive(S, rule, ctx, work, exe, report, stats, targets) {
    if (S.archiveC?.corrupt && fs.existsSync(S.archiveC.path)) {
      const to = toSortPath(S.archiveC.path, 'Corrupt');
      await moveFile(S.archiveC.path, to); report.push(`→ ToSort/Corrupt: ${S.archiveC.path}`); stats.toSort++;
      S.archiveC = null;
    }
    const items = S.items.filter((it) => !it.disk && (it.state === 'correct' || it.state === 'rename' || it.state === 'fixable'));
    const changed = S.items.some((it) => !it.disk && (it.state === 'rename' || it.state === 'fixable')) || S.rezip
      || (S.archiveC && (S.archiveC.entries.some((e) => !['correct', 'rename'].includes(e.state)) || S.archiveC.corrupt));
    if (!changed || !items.length) {
      if (!items.length && S.archiveC) {
        // Nothing of this set's is in its archive any more: what's there has gone elsewhere.
        const out = S.archiveC.entries.filter((e) => e.state === 'tosort' || e.state === 'corrupt' || (e.state === 'needed' && !e.staged));
        if (out.length) await keepInToSort(S.archiveC, out, ctx);
        await fsp.unlink(S.archiveC.path).catch(() => {});
        report.push(`✗ Removed: ${S.archiveC.path}`);
      }
      return;
    }
    const dest = S.archive;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // Leftovers in the old archive that go to ToSort are saved before it's replaced.
    if (S.archiveC) {
      // Needed by a set that isn't being fixed now (outside the folder being fixed): kept in ToSort.
      const toSort = S.archiveC.entries.filter((e) => e.state === 'tosort' || e.state === 'corrupt' || (e.state === 'needed' && !e.staged && !(e.usedBy || []).some((u) => u.set === S || targets.includes(u.set))));
      if (toSort.length) { await keepInToSort(S.archiveC, toSort, ctx); stats.toSort += toSort.length; }
    }
    const src = items.map((it) => ({ name: it.name, open: openEntry(it.state === 'fixable' ? it.from : it.state === 'rename' ? it.from : it.at), sizeHint: it.size, it }));
    const tmp = path.join(path.dirname(dest), `.rl-tmp-${crypto.randomUUID().slice(0, 8)}.${rule.format}`);
    try {
      const got = rule.format === '7z' ? await Z.write7z(exe, tmp, src, { signal: ctx.signal, workDir: work }) : await Z.writeTorrentZip(tmp, src, { signal: ctx.signal });
      for (const g of got) { const s = src.find((x) => x.name === g.name); if (!verify(s.it, g)) throw new Error(`${g.name} didn’t come out as the DAT says (CRC ${g.crc})`); }
      await fsp.rename(tmp, dest);
    } catch (err) { await fsp.rm(tmp, { force: true }); throw err; }
    if (S.archiveC) stats.deleted += S.archiveC.entries.filter((e) => e.state === 'delete').length;
    // The set used to be in another format (7z instead of zip, say) under the same name: that copy has been used.
    const nFix = items.filter((it) => it.state === 'fixable').length; const nRen = items.filter((it) => it.state === 'rename').length;
    report.push(`✓ ${S.dat.treePath ? `${S.dat.treePath}/` : ''}${path.basename(dest)}: ${nFix ? `${nFix} added` : ''}${nFix && nRen ? ', ' : ''}${nRen ? `${nRen} renamed` : ''}${!nFix && !nRen ? (S.rezip ? 'rebuilt as TorrentZip' : 'tidied') : ''}`);
  }
  async function keepInToSort(C, list, ctx) {
    const dest = uniquePath(toSortPath(C.path).replace(/\.(zip|7z)$/i, '') + '.zip');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await Z.writeTorrentZip(dest, list.map((e) => ({ name: e.name, open: openEntry(e), sizeHint: e.size })), { signal: ctx.signal });
  }

  // Plain-folder sets, and every set's CHD disks: files in <ROM folder>/<set>/.
  async function buildFolder(S, rule, ctx, report, stats) {
    const asFolder = (it) => it.disk || rule.format === 'folder';
    const items = S.items.filter(asFolder);
    const C = S.folderC;
    const leftovers = C ? C.entries.filter((e) => !['correct', 'rename'].includes(e.state)) : [];
    if (!items.some((it) => it.state === 'fixable' || it.state === 'rename') && !leftovers.length) return;
    const base = S.folder;
    // Leftovers: needed elsewhere (copied out first if another set takes them), to ToSort, or deleted.
    for (const e of leftovers) {
      ctx.check();
      if (e.state === 'needed' && e.usedBy?.length) continue; // moved by the set that needs it, below or later
      if (e.state === 'tosort' || e.state === 'corrupt') { await moveFile(e.file, toSortPath(e.file, e.state === 'corrupt' ? 'Corrupt' : '')); stats.toSort++; report.push(`→ ToSort: ${e.file}`); }
      else if (e.state === 'delete') { await fsp.unlink(e.file).catch(() => {}); stats.deleted++; report.push(`✗ Deleted duplicate: ${e.file}`); }
    }
    // Renames go through a temporary name, so two files can swap names.
    const ren = items.filter((it) => it.state === 'rename');
    const tmpNames = [];
    for (const it of ren) { const t = `${it.from.file}.rl-ren`; await fsp.rename(it.from.file, t); tmpNames.push([t, path.join(base, ...it.name.split('/'))]); }
    for (const [t, to] of tmpNames) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(t, to); stats.renamed++; }
    for (const it of items.filter((x) => x.state === 'fixable')) {
      ctx.check();
      const e = it.from;
      const to = path.join(base, ...it.name.split('/'));
      // A loose file only this set needs is moved, not copied (fast for big disc images).
      const onlyUse = e.state === 'needed' && (e.usedBy || []).length === 1 && (e.c.kind === 'file' || e.c.kind === 'folder') && !e.staged;
      if (onlyUse) { await moveFile(e.file, `${to}.rl-part`); e.movedAway = true; } else {
        const got = await writeEntryTo(e, `${to}.rl-part`, ctx.signal);
        if (!verify(it, got)) { await fsp.rm(`${to}.rl-part`, { force: true }); throw new Error(`${it.name} didn’t come out as the DAT says`); }
      }
      await fsp.rename(`${to}.rl-part`, to);
    }
    report.push(`✓ ${S.dat.treePath ? `${S.dat.treePath}/` : ''}${S.name}/ (folder)`);
  }

  async function removeEmpty(d, isRoot) {
    let list;
    try { list = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) if (e.isDirectory()) await removeEmpty(path.join(d, e.name), false);
    if (!isRoot && !(await fsp.readdir(d).catch(() => ['x'])).length) await fsp.rmdir(d).catch(() => {});
  }

  // --- Jobs -----------------------------------------------------------------------------------------------
  function startJob(type, opts, run) {
    if (job && job.state === 'running') throw new RomError(409, `Busy: ${job.label}. Wait for it to finish or cancel it.`);
    const ac = new AbortController();
    const labels = { dats: 'Updating DATs', scan: 'Scanning ROMs', update: 'Updating DATs and scanning', fix: 'Fixing ROMs', all: 'Update, scan and fix' };
    job = { id: crypto.randomUUID(), type, label: labels[type], state: 'running', started: Date.now(), done: 0, total: 0, phase: '', current: '', sub: '', log: [], ac };
    const j = job;
    const ctx = {
      signal: ac.signal,
      check: () => { if (ac.signal.aborted) throw new Error('Cancelled'); },
      step: (cur) => { j.current = cur; j.sub = ''; j.done++; },
      sub: (s) => { j.sub = s; },
      log: (line) => { j.log.push(line); console.log(`ROM Librarian: ${line}`); },
      set total(n) { j.total = n; j.done = 0; },
      phase: (p) => { j.phase = p; },
    };
    (async () => {
      try { await run(ctx); j.state = 'done'; } catch (err) {
        j.state = ac.signal.aborted ? 'cancelled' : 'error'; j.error = err.message;
        if (!ac.signal.aborted) console.error(`ROM Librarian: ${err.stack || err.message}`);
      } finally {
        try { analysis = analyze(); } catch (err) { console.error(`ROM Librarian: ${err.message}`); }
        j.finished = Date.now();
      }
    })();
    return publicJob();
  }
  const publicJob = () => job && { id: job.id, type: job.type, label: job.label, state: job.state, started: job.started, finished: job.finished, done: job.done, total: job.total, phase: job.phase, current: job.current, sub: job.sub, log: job.log.slice(-50), error: job.error };
  function runJob(type, body = {}) {
    const level = LEVELS.includes(body.level) ? body.level : settings.scanLevel;
    const scope = typeof body.path === 'string' ? body.path : '';
    return startJob(type, body, async (ctx) => {
      if (type === 'dats' || type === 'update' || type === 'all') { ctx.phase('Reading DATs'); await updateDats(ctx); }
      if (type === 'scan' || type === 'update' || type === 'all') { ctx.phase('Scanning'); await scan(ctx, level); }
      if (type === 'fix' || type === 'all') { ctx.phase('Finding fixes'); analysis = analyze(); ctx.phase('Fixing'); await fix(ctx, scope); }
    });
  }

  // --- Views for the app ------------------------------------------------------------------------------------
  function ensure() {
    if (!analysis) analysis = analyze();
    return analysis;
  }
  const datOf = (p) => ensure().dats.find((d) => d.treePath === p);
  const setRow = (S) => ({ name: S.name, description: S.description, parent: S.parent, bios: S.bios, year: S.year, manufacturer: S.manufacturer, status: S.status, ...S.counts, rezip: S.rezip, extras: S.extras.length, archive: Boolean(S.archiveC || S.folderC) });
  const entryRow = (e) => ({ name: e.name, size: e.size, crc: e.crc, sha1: e.sha1 || e.chd?.sha1, md5: e.md5 || e.chd?.md5, state: e.state, corrupt: e.corrupt, header: e.alt?.header,
    usedBy: e.usedBy?.slice(0, 5).map((u) => `${u.set.dat.treePath ? `${u.set.dat.treePath}/` : ''}${u.set.name}`), dupOf: undefined });
  const where = (e) => e && ({ file: e.c.path, name: e.c.kind === 'zip' || e.c.kind === '7z' || e.c.kind === 'folder' ? e.name : null, region: e.c.region });

  function listSets(q) {
    const d = datOf(q.get('path') || '');
    if (!d) throw new RomError(404, 'That DAT isn’t loaded');
    const show = q.get('show') || 'all';
    const term = (q.get('q') || '').trim().toLowerCase();
    let sets = d.sets;
    if (show === 'have') sets = sets.filter((S) => S.status === 'complete');
    else if (show === 'missing') sets = sets.filter((S) => S.status === 'missing' || S.status === 'partial');
    else if (show === 'fixable') sets = sets.filter((S) => S.needsWork);
    else if (show === 'incomplete') sets = sets.filter((S) => S.status !== 'complete');
    if (term) sets = sets.filter((S) => S.name.toLowerCase().includes(term) || (S.description || '').toLowerCase().includes(term));
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    const limit = Math.min(1000, Math.max(1, Number(q.get('limit')) || 300));
    return { path: d.treePath, title: d.header.description || d.header.name, header: d.header, file: d.file, mode: d.mode, rule: d.rule, romDir: d.romDir, total: sets.length, offset, sets: sets.slice(offset, offset + limit).map(setRow) };
  }
  function setDetail(q) {
    const d = datOf(q.get('path') || '');
    const S = d?.sets.find((s) => s.name === q.get('name'));
    if (!S) throw new RomError(404, 'That set isn’t in the DAT');
    return {
      ...setRow(S), dat: d.treePath, format: d.rule.format, location: S.archive || S.folder, found: S.archiveC?.path || S.folderC?.path || null, tz: S.archiveC?.tz,
      items: S.items.map((it) => ({ name: it.name, size: it.size, crc: it.crc, sha1: it.sha1, md5: it.md5, disk: it.disk, baddump: it.baddump, state: it.state, from: it.state === 'fixable' || it.state === 'rename' ? where(it.from) : null, header: (it.at || it.from)?.alt?.header })),
      extras: S.extras.map((e) => ({ ...entryRow(e), file: e.c.path })),
    };
  }
  // Files no DAT asked for under a DAT folder's ROM folder, or everything in a ToSort folder.
  function listFiles(q) {
    const a = ensure();
    const p = q.get('path') || '';
    const ts = /^tosort:(\d+)$/.exec(p);
    const out = [];
    for (const C of a.containers.values()) {
      if (ts ? C.region !== 'tosort' || C.tsIndex !== Number(ts[1]) : C.region !== 'rom' || !(C.treePath === p || (!p && C.treePath == null) || (p && (C.treePath || '').startsWith(`${p}/`)))) continue;
      const list = ts ? C.entries : C.entries.filter((e) => ['tosort', 'delete', 'corrupt', 'needed'].includes(e.state) && !(C.home && e.state === 'needed'));
      if (!list.length && !C.state) continue;
      if (!ts && !list.some((e) => e.state !== 'needed') && !C.state) continue;
      out.push({ file: C.path, kind: C.kind, state: C.state || null, corrupt: C.corrupt || null, entries: list.slice(0, 500).map(entryRow), more: Math.max(0, list.length - 500) });
      if (out.length >= 2000) break;
    }
    out.sort((x, y) => x.file.localeCompare(y.file));
    return { path: p, files: out };
  }

  function overview() {
    const a = analysis;
    return {
      configured: Boolean(settings.datRoot && settings.romRoot), settings: publicSettings(), dats: datList.length, job: publicJob(), mock,
      scanned: Object.keys(scanCache.files).length, analysedAt: a?.at || null, lastLog: Boolean(lastLog),
      tree: a ? stripTree(a.tree) : null,
    };
  }
  const stripTree = (t) => {
    const walkN = (n) => ({ path: n.path, name: n.name, kind: n.kind, title: n.title, version: n.version, mode: n.mode, counts: n.counts, children: n.children.map(walkN), rule: settings.rules[n.path] || null, romDir: romDirFor(n.path) });
    return { root: walkN(t.root), toSort: t.toSort };
  };

  // Reports: plain text about a folder (or everything), and fix DATs of what's missing.
  function report(q) {
    const a = ensure();
    const kind = q.get('kind') || 'fix';
    const p = q.get('path') || '';
    const inScope = (tp) => !p || tp === p || tp.startsWith(`${p}/`);
    const lines = [`ROM Librarian ${kind === 'full' ? 'full report' : kind === 'missing' ? 'missing files' : 'fix report'}${p ? ` for ${p}` : ''}`, `Made ${new Date().toLocaleString()}`, ''];
    for (const d of a.dats.filter((x) => inScope(x.treePath))) {
      const c = d.sets.reduce((s, S) => { s[S.status] = (s[S.status] || 0) + 1; return s; }, {});
      const sets = kind === 'full' ? d.sets : kind === 'missing' ? d.sets.filter((S) => S.counts.missing) : d.sets.filter((S) => S.counts.missing || S.needsWork);
      lines.push(`== ${d.treePath || '(top)'} — ${d.header.description || d.header.name || ''} ${d.header.version || ''}`.trimEnd(),
        `   ${d.sets.length} sets: ${c.complete || 0} complete, ${c.fixable || 0} fixable, ${c.partial || 0} partial, ${c.missing || 0} missing (${d.mode}, ${d.rule.format}${d.rule.format === 'zip' && d.rule.torrentzip ? ', TorrentZip' : ''})`);
      for (const S of sets) {
        lines.push(`  ${S.status === 'complete' ? '✓' : S.status === 'missing' ? '✗' : S.status === 'fixable' ? '⚑' : '◐'} ${S.name}${S.description && S.description !== S.name ? `  (${S.description})` : ''}  ${S.counts.have}/${S.counts.total}`);
        if (kind === 'full' && S.status === 'complete') continue;
        for (const it of S.items) {
          if (it.state === 'correct' || it.state === 'nodump') continue;
          if (kind === 'missing' && it.state !== 'missing') continue;
          const f = it.from ? ` ← ${it.from.c.path}${it.from.c.kind === 'zip' || it.from.c.kind === '7z' ? ` : ${it.from.name}` : ''}` : '';
          lines.push(`      ${it.state === 'missing' ? 'missing ' : it.state === 'rename' ? 'rename  ' : 'can fix '} ${it.name}  ${it.size ?? ''} ${it.crc || ''} ${it.sha1 || ''}${f}`.trimEnd());
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  function fixDatsFor(p) {
    const a = ensure();
    const inScope = (tp) => !p || tp === p || tp.startsWith(`${p}/`);
    return a.dats.filter((d) => inScope(d.treePath)).map((d) => {
      const sets = d.sets.filter((S) => S.counts.missing).map((S) => ({ name: S.name, description: S.description, items: S.items.filter((it) => it.state === 'missing') }));
      const title = d.header.name || path.posix.basename(d.file).replace(/\.\w+$/, '');
      return { name: `fix_${safeName(title)}.dat`, title, sets, xml: D.writeFixDat(title, sets, { version: d.header.version }) };
    }).filter((x) => x.sets.length);
  }

  async function init() {
    // The demo starts afresh each time: new files, so nothing old is remembered about them.
    if (demo) { const s = await demo(dir); settings = { ...SETTINGS_DEFAULTS, ...s }; datCache = { files: {} }; scanCache = { files: {} }; datList = []; analysis = null; await writeJ(files.settings, settings); }
    if (!analysis && (datList.length || Object.keys(scanCache.files).length)) analysis = analyze();
    if (demo && !datList.length) {
      await new Promise((resolve) => { runJob('update', {}); const t = setInterval(() => { if (job.state !== 'running') { clearInterval(t); resolve(); } }, 50); });
    }
  }

  async function handle(req, res, url, { sendJson, readJson, canChange }) {
    await (ready ||= init().catch((err) => console.error(`ROM Librarian: ${err.message}`)));
    const p = url.pathname.replace(/^\/portal\/roms/, '') || '/';
    const q = url.searchParams;
    const change = () => { if (!canChange) throw new RomError(403, 'Only a parent or an admin can change the ROM collection'); };
    try {
      if (p === '/state' && req.method === 'GET') return sendJson(res, 200, { ...overview(), canChange });
      if (p === '/sets') return sendJson(res, 200, listSets(q));
      if (p === '/set') return sendJson(res, 200, setDetail(q));
      if (p === '/files') return sendJson(res, 200, listFiles(q));
      if (p === '/job' && req.method === 'GET') return sendJson(res, 200, { job: publicJob() });
      if (p === '/job/cancel' && req.method === 'POST') { change(); job?.ac.abort(); return sendJson(res, 200, { job: publicJob() }); }
      if (p === '/jobs' && req.method === 'POST') {
        change();
        const body = await readJson(req);
        if (!['dats', 'scan', 'update', 'fix', 'all'].includes(body.type)) throw new RomError(400, 'Unknown job');
        if (body.type !== 'dats' && !scanRoots().length) throw new RomError(400, 'Choose a ROM folder first');
        return sendJson(res, 200, { job: runJob(body.type, body) });
      }
      if (p === '/settings' && req.method === 'GET') return sendJson(res, 200, publicSettings());
      if (p === '/settings' && req.method === 'POST') {
        change();
        if (job?.state === 'running') throw new RomError(409, 'Wait for the job that’s running to finish first');
        return sendJson(res, 200, await saveSettings(await readJson(req)));
      }
      if (p === '/log') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(lastLog || 'Nothing has been fixed yet.'); }
      if (p === '/report') {
        const text = report(q);
        const name = `rom-${q.get('kind') || 'fix'}-report.txt`;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(q.get('download') ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) });
        return res.end(`\uFEFF${text}`);
      }
      if (p === '/fixdat') {
        const list = fixDatsFor(q.get('path') || '');
        if (!list.length) throw new RomError(404, 'Nothing is missing there, so there’s no fix DAT to make');
        if (list.length === 1) {
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${list[0].name.replace(/"/g, '')}"` });
          return res.end(list[0].xml);
        }
        const tmp = path.join(dir, `.rl-fixdats-${crypto.randomUUID().slice(0, 8)}.zip`);
        const { Readable } = require('node:stream');
        await Z.writeTorrentZip(tmp, list.map((x) => ({ name: x.name, open: async () => Readable.from([Buffer.from(x.xml)]) })));
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="fixdats.zip"' });
        const s = fs.createReadStream(tmp);
        s.pipe(res);
        s.on('close', () => fsp.rm(tmp, { force: true }));
        return undefined;
      }
      if (p === '/fixdats' && req.method === 'POST') {
        change();
        if (!settings.fixDatFolder) throw new RomError(400, 'Choose a folder for fix DATs first (ROM Librarian → Settings)');
        const body = await readJson(req);
        const list = fixDatsFor(typeof body.path === 'string' ? body.path : '');
        for (const x of list) await fsp.writeFile(path.join(settings.fixDatFolder, x.name), x.xml);
        return sendJson(res, 200, { saved: list.length, folder: settings.fixDatFolder });
      }
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  return { handle, init, _test: { analyze: () => (analysis = analyze()), runJob, getJob: () => job, saveSettings, settings: () => settings } };
}

module.exports = { createRoms };
