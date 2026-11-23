// Ported from RomVault (RVWorld: DAT/DATReader/DatReader.cs, DatReader/DatXMLReader.cs, DatMessXmlReader.cs,
// DatCmpReader.cs, DatROMCenterReader.cs, DatDOSReader.cs, Utils/DatFileLoader.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { FileType, HeaderFileType, headerTypeFromFileName } = require('../enums');
const { DatFile, DatDir, DatGame, DatHeader, VarFix } = require('./datStore');
const { parseXml } = require('./xml');

// ------------------------------------------------------------------------------------------------ DatRead
function readDat(fullname, errorReport) {
  let buffer;
  try {
    buffer = fs.readFileSync(fullname);
    if (path.extname(fullname).toLowerCase() === '.datz') buffer = zlib.gunzipSync(buffer);
  } catch (e) {
    errorReport?.(fullname, `Error Occured Opening Dat:\r\n${e.message}\r\n`);
    return null;
  }
  return readDatBuffer(buffer, fullname, errorReport);
}

function readDatBuffer(buffer, fullname, errorReport) {
  const text = buffer.toString('utf8');
  const lines = text.split(/\r\n|\n|\r/);
  let first = null;
  for (const l of lines) { if (l.trim()) { first = l; break; } }
  if (first == null) return null;
  const low = first.toLowerCase();
  if (low.includes('xml')) return readXmlDat(text, fullname, errorReport);
  if (low.includes('clrmamepro') || low.includes('clrmame') || low.includes('romvault') || low.includes('game') || low.includes('machine')) return DatCmpReader.readDat(text, fullname, errorReport);
  if (low.includes('doscenter')) return DatDOSReader.readDat(text, fullname, errorReport);
  if (low.includes('[credits]')) return DatROMCenterReader.readDat(text, fullname, errorReport);
  if (low.includes('raine (680x0 arcade emulation)')) return DatCmpReader.readDat(text, fullname, errorReport);
  errorReport?.(fullname, 'Invalid DAT File');
  return null;
}

function readXmlDat(text, fullname, errorReport) {
  let doc;
  try { doc = parseXml(text); } catch (e) { errorReport?.(fullname, `Error Occured Reading Dat:\r\n${e.message}\r\n`); return null; }
  if (!doc.documentElement) return null;
  if (doc.selectSingleNode('mame') || doc.selectSingleNode('mess')) return DatXmlReader.readMameDat(doc, fullname);
  if (doc.documentElement.selectSingleNode('header')) return DatXmlReader.readDat(doc, fullname);
  if (doc.selectNodes('softwarelist').length) return DatMessXmlReader.readDat(doc, fullname);
  return null;
}

const S = (n) => (n == null ? '' : typeof n === 'string' ? n : n.innerText);
const A = (node, name) => node.attr(name) ?? '';

// ------------------------------------------------------------------------------------------------ XML
const DatXmlReader = {
  readDat(doc, filename) {
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet);
    if (!this.loadHeader(doc, filename, h)) return null;
    const hft = headerTypeFromFileName(h.Header);
    const de = doc.documentElement;
    for (const n of de.selectNodes('dir')) this.loadDir(h.BaseDir, n, hft);
    for (const n of de.selectNodes('game')) this.loadGame(h.BaseDir, n, hft);
    for (const n of de.selectNodes('machine')) this.loadGame(h.BaseDir, n, hft);
    for (const n of de.selectNodes('rom')) this.loadRom(h.BaseDir, n, hft);
    for (const n of de.selectNodes('disk')) this.loadDisk(h.BaseDir, n);
    return h;
  },
  readMameDat(doc, filename) {
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet); h.MameXML = true;
    const head = doc.selectSingleNode('mame') || doc.selectSingleNode('mess');
    if (!head) return null;
    h.Filename = filename;
    h.Name = A(head, 'build'); h.Description = A(head, 'build'); h.Version = A(head, 'version'); h.Date = A(head, 'date');
    const de = doc.documentElement;
    for (const n of de.selectNodes('dir')) this.loadDir(h.BaseDir, n, HeaderFileType.Nothing);
    for (const n of de.selectNodes('game')) this.loadGame(h.BaseDir, n, HeaderFileType.Nothing);
    for (const n of de.selectNodes('machine')) this.loadGame(h.BaseDir, n, HeaderFileType.Nothing);
    return h;
  },
  loadHeader(doc, filename, h) {
    const head = doc.documentElement.selectSingleNode('header');
    h.Filename = filename;
    if (!head) return false;
    const t = (n) => S(head.selectSingleNode(n));
    h.Id = t('id'); h.Name = t('name'); h.Type = t('type'); h.RootDir = t('rootdir'); h.Description = t('description');
    h.Subset = t('subset'); h.Category = t('category'); h.Version = t('version'); h.Date = t('date'); h.Author = t('author');
    h.Email = t('email'); h.Homepage = t('homepage'); h.URL = t('url'); h.Comment = t('comment');
    const packing = head.selectSingleNode('romvault') || head.selectSingleNode('clrmamepro');
    if (packing) {
      h.Header = A(packing, 'header');
      h.Compression = A(packing, 'forcepacking').toLowerCase();
      h.MergeType = A(packing, 'forcemerging').toLowerCase();
      h.Dir = A(packing, 'dir').toLowerCase();
    }
    h.NotZipped = VarFix.stringYesNo(t('notzipped'));
    return true;
  },
  loadDir(parent, node, hft) {
    const dir = new DatDir(A(node, 'name'), FileType.UnSet);
    parent.childAdd(dir);
    for (const n of node.selectNodes('dir')) this.loadDir(dir, n, hft);
    for (const n of node.selectNodes('game')) this.loadGame(dir, n, hft);
    for (const n of node.selectNodes('machine')) this.loadGame(dir, n, hft);
  },
  loadGame(parent, node, hft) {
    const g = new DatGame();
    let ft = FileType.UnSet;
    const st = A(node, 'type').toLowerCase();
    if (st === 'dir') ft = FileType.Dir; else if (st === 'zip') ft = FileType.Zip; else if (st === '7z') ft = FileType.SevenZip;
    const d = new DatDir(A(node, 'name'), ft);
    d.DGame = g;
    const t = (n) => S(node.selectSingleNode(n));
    g.Id = A(node, 'id'); g.RomOf = A(node, 'romof'); g.CloneOf = A(node, 'cloneof'); g.CloneOfId = A(node, 'cloneofid');
    g.SampleOf = A(node, 'sampleof'); g.Description = t('description'); g.SourceFile = A(node, 'sourcefile');
    g.IsBios = A(node, 'isbios'); g.IsDevice = A(node, 'isdevice'); g.Board = A(node, 'board'); g.Year = t('year');
    g.Manufacturer = t('manufacturer'); g.Runnable = A(node, 'runnable'); g.Serial = t('serial'); g.Version = t('version');
    g.GameId = t('game_id');
    const emu = node.selectSingleNode('tea') || node.selectSingleNode('trurip') || node.selectSingleNode('EmuArc');
    if (emu) {
      const e = (n) => S(emu.selectSingleNode(n));
      g.IsEmuArc = true;
      g.Id = e('titleid'); g.Publisher = e('publisher'); g.Developer = e('developer'); g.Year = e('year'); g.Genre = e('genre');
      g.SubGenre = e('subgenre'); g.Ratings = e('ratings'); g.Score = e('score'); g.Players = e('players'); g.Enabled = e('enabled');
      g.CRC = e('crc'); g.CloneOf = e('cloneof'); g.RelatedTo = e('relatedto'); g.Source = e('source');
    }
    for (const n of node.selectNodes('rom')) this.loadRom(d, n, hft);
    for (const n of node.selectNodes('disk')) this.loadDisk(d, n);
    for (const n of node.selectNodes('category')) { const c = S(n); if (c) (g.Category = g.Category || []).push(c); }
    for (const n of node.selectNodes('device_ref')) { const c = A(n, 'name'); if (c.trim()) (g.device_ref = g.device_ref || []).push(c); }
    parent.childAdd(d);
  },
  loadRom(parent, node, hft) {
    const r = new DatFile(A(node, 'name'), FileType.UnSet);
    r.Size = VarFix.ulong(node.attr('size'));
    r.CRC = VarFix.cleanMD5SHA1(node.attr('crc'), 8);
    r.SHA1 = VarFix.cleanMD5SHA1(node.attr('sha1'), 40);
    r.SHA256 = VarFix.cleanMD5SHA1(node.attr('sha256'), 64);
    r.MD5 = VarFix.cleanMD5SHA1(node.attr('md5'), 32);
    r.Merge = A(node, 'merge');
    r.Status = A(node, 'status').toLowerCase();
    r.Region = A(node, 'region').toLowerCase();
    r.MIA = A(node, 'mia');
    r.Header = A(node, 'header');
    r.HeaderFileType = hft;
    parent.childAdd(r);
  },
  loadDisk(parent, node) {
    const r = new DatFile(VarFix.cleanCHD(node.attr('name')), FileType.UnSet);
    r.SHA1 = VarFix.cleanMD5SHA1(node.attr('sha1'), 40);
    r.SHA256 = VarFix.cleanMD5SHA1(node.attr('sha256'), 64);
    r.MD5 = VarFix.cleanMD5SHA1(node.attr('md5'), 32);
    r.Merge = VarFix.cleanCHD(A(node, 'merge'));
    r.Status = A(node, 'status').toLowerCase();
    r.MIA = A(node, 'mia');
    r.HeaderFileType = HeaderFileType.CHD;
    r.isDisk = true;
    parent.childAdd(r);
  },
};

// ------------------------------------------------------------------------------------------------ MESS software lists
const DatMessXmlReader = {
  readDat(doc, filename) {
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet);
    const head = doc.selectNodes('softwarelist');
    if (!head.length) return null;
    h.Filename = filename; h.Name = A(head[0], 'name'); h.Description = A(head[0], 'description');
    for (const n of doc.documentElement.selectNodes('software')) this.loadGame(h.BaseDir, n);
    return h;
  },
  loadGame(parent, node) {
    const d = new DatDir(A(node, 'name'), FileType.UnSet);
    d.DGame = new DatGame();
    const g = d.DGame;
    g.Description = S(node.selectSingleNode('description'));
    g.RomOf = A(node, 'romof'); g.CloneOf = A(node, 'cloneof');
    g.Year = S(node.selectSingleNode('year')); g.Manufacturer = S(node.selectSingleNode('publisher'));
    const parts = node.selectNodes('part');
    for (const p of parts) {
      const cont = { index: -1 };
      for (const da of p.selectNodes('dataarea')) for (const r of da.selectNodes('rom')) this.loadRom(d, r, cont);
    }
    for (const p of parts) for (const da of p.selectNodes('diskarea')) for (const r of da.selectNodes('disk')) this.loadDisk(d, r);
    if (d.Count > 0) parent.childAdd(d);
  },
  loadRom(parent, node, cont) {
    const name = node.attr('name');
    const loadflag = A(node, 'loadflag');
    if (name != null) {
      const r = new DatFile(name, FileType.UnSet);
      r.Size = VarFix.ulong(node.attr('size'));
      r.CRC = VarFix.cleanMD5SHA1(node.attr('crc'), 8);
      r.SHA1 = VarFix.cleanMD5SHA1(node.attr('sha1'), 40);
      r.Status = A(node, 'status').toLowerCase();
      cont.index = parent.childAdd(r);
    } else if (/^(continue|ignore)$/i.test(loadflag) && cont.index >= 0) {
      const t = parent.at(cont.index);
      const add = VarFix.ulong(node.attr('size'));
      t.Size = t.Size == null || add == null ? null : t.Size + add;
    }
  },
  loadDisk(parent, node) {
    const r = new DatFile(VarFix.cleanCHD(node.attr('name')), FileType.UnSet);
    r.SHA1 = VarFix.cleanMD5SHA1(node.attr('sha1'), 40);
    r.Status = A(node, 'status').toLowerCase();
    r.HeaderFileType = HeaderFileType.CHD;
    r.isDisk = true;
    parent.childAdd(r);
  },
};

// ------------------------------------------------------------------------------------------------ DatFileLoader
class DatFileLoader {
  constructor(text, filename) { this.lines = text.split(/\r\n|\n|\r/); this.pos = 0; this._line = ''; this.Next = ''; this.LineNumber = 0; this.Filename = filename; }
  endOfStream() { return this.pos >= this.lines.length || (this.pos === this.lines.length - 1 && this.lines[this.pos] === ''); }
  readLine() { return this.pos < this.lines.length ? this.lines[this.pos++] : null; }
  gnRest() { const r = this._line.replace(/"/g, ''); this._line = ''; this.Next = r; return r; }
  gnRestQ() { const r = this._line; this._line = ''; this.Next = r; return r; }
  gnNameToSize() {
    const sizePos = this._line.toLowerCase().indexOf(' size ');
    const r = sizePos === 0 ? '' : this._line.substring(0, sizePos);
    this._line = this._line.substring(sizePos + 1);
    this.Next = r; return r;
  }
  gn() {
    let ret;
    while (this._line.trim().length === 0 && !this.endOfStream()) {
      this._line = this.readLine();
      this.LineNumber++;
      this._line = (this._line ?? '').replace(/\t/g, ' ');
      const c = this._line.indexOf('//');
      if (c >= 0) this._line = this._line.substring(0, c);
      const ts = this._line.trimStart();
      if (ts.length > 1 && (ts[0] === '#' || ts[0] === ';')) this._line = '';
      this._line = this._line.trim() + ' ';
    }
    if (this._line.trim().length > 0) {
      if (this._line[0] === '"') {
        const intS = (this._line + '"').indexOf('"', 1);
        ret = this._line.substring(1, intS);
        this._line = (this._line + ' ').substring(intS + 1).replace(/^ +| +$/g, '');
      } else {
        const intS = (this._line + ' ').indexOf(' ');
        ret = this._line.substring(0, intS);
        this._line = (this._line + ' ').substring(intS).replace(/^ +| +$/g, '');
      }
    } else ret = '';
    this.Next = ret;
    return ret;
  }
}

// ------------------------------------------------------------------------------------------------ ClrMamePro
const ROM_KEYS = new Set(['rom', 'badrom', 'unusedrom', 'znbiosrom', 's16sndrom', 's16gfxrom', 'neosndrom']);
const SKIP_GAME_KEYS = new Set(['serial', 'rebuildto', 'sample', 'biosset', 'chip', 'video', 'sound', 'input', 'dipswitch', 'driver',
  'display', 'comment', 'releaseyear', 'releasemonth', 'releaseday', 'genre', 'developer', 'publisher', 'homepage', 'users',
  'version', 'license', 'device_ref', 'driverstatus', 'ismechanical', 'note', '#']);

const DatCmpReader = {
  readDat(text, filename, err) {
    const dfl = new DatFileLoader(text, filename);
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet);
    let hft = HeaderFileType.Nothing;
    dfl.gn();
    if (dfl.endOfStream()) return null;
    if (/^clrmame(pro)?$/i.test(dfl.Next)) {
      if (!this.loadHeader(dfl, filename, h, err)) return null;
      hft = headerTypeFromFileName(h.Header);
      dfl.gn();
    }
    if (/^raine$/i.test(dfl.Next)) {
      while (!/^emulator$/i.test(dfl.Next) && !dfl.endOfStream()) dfl.gn();
      if (!this.loadHeader(dfl, filename, h, err)) return null;
      dfl.gn();
    }
    if (/^romvault$/i.test(dfl.Next)) {
      if (!this.loadHeader(dfl, filename, h, err)) return null;
      dfl.gn();
    }
    while (!dfl.endOfStream()) {
      if (!this.readNextBlock(dfl, h.BaseDir, err, hft)) return null;
    }
    return h;
  },
  readNextBlock(dfl, parent, err, hft) {
    switch (dfl.Next.toLowerCase()) {
      case 'dir': if (!this.loadDir(dfl, parent, err, hft)) return false; break;
      case 'game': case 'machine': case 'resource': if (!this.loadGame(dfl, parent, err, hft)) return false; break;
      case 'emulator': if (!this.loadEmulator(dfl, err)) return false; break;
      case '#': dfl.gnRest(); break;
      default: err?.(dfl.Filename, 'Error Keyword ' + dfl.Next + ' not know in dir, on line ' + dfl.LineNumber);
    }
    dfl.gn();
    return true;
  },
  loadHeader(dfl, filename, h, err) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after clrmamepro, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    h.Filename = filename;
    while (dfl.Next !== ')') {
      switch (dfl.Next.toLowerCase()) {
        case 'name': h.Name = dfl.gnRest(); break;
        case 'description': h.Description = dfl.gnRest(); break;
        case 'category': h.Category = dfl.gnRest(); break;
        case 'version': h.Version = dfl.gnRest(); break;
        case 'date': h.Date = dfl.gnRest(); break;
        case 'author': h.Author = dfl.gnRest(); break;
        case 'email': h.Email = dfl.gnRest(); break;
        case 'homepage': h.Homepage = dfl.gnRest(); break;
        case 'url': h.URL = dfl.gnRest(); break;
        case 'comment': h.Comment = dfl.gnRest(); break;
        case 'header': h.Header = dfl.gnRest(); break;
        case 'forcezipping': case 'forcepacking': h.Compression = dfl.gnRest(); break;
        case 'forcemerging': h.MergeType = dfl.gnRest(); break;
        case 'forcenodump': h.NoDump = dfl.gnRest(); break;
        case 'dir': h.Dir = dfl.gnRest(); break;
        case 'games': dfl.gnRest(); break;
        default: err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in clrmamepro, on line " + dfl.LineNumber);
      }
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    return true;
  },
  loadEmulator(dfl, err) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after emulator, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    while (dfl.Next !== ')') {
      const k = dfl.Next.toLowerCase();
      if (k === 'name' || k === 'version' || k === 'debug') dfl.gnRest();
      else err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in emulator, on line " + dfl.LineNumber);
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    return true;
  },
  loadDir(dfl, parent, err, hft) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after game, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    if (!/^name$/i.test(dfl.Next)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    const dir = new DatDir(dfl.gnRest(), FileType.UnSet);
    dfl.gn();
    parent.childAdd(dir);
    while (dfl.Next !== ')') {
      if (!this.readNextBlock(dfl, dir, err, hft)) return false;
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    return true;
  },
  loadGame(dfl, parent, err, hft) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after game, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    let snext = dfl.Next;
    let pathextra = '';
    if (/^rebuildto$/i.test(snext)) { pathextra = dfl.gn(); dfl.gn(); snext = dfl.Next; }
    if (!/^name$/i.test(snext)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    let name = dfl.gnRest();
    if (pathextra) name = pathextra + '\\' + name;
    dfl.gn();
    const d = new DatDir(name, FileType.UnSet);
    d.DGame = new DatGame();
    const g = d.DGame;
    while (dfl.Next !== ')' && !dfl.endOfStream()) {
      const k = dfl.Next.toLowerCase();
      if (k === 'romof') g.RomOf = dfl.gnRest();
      else if (k === 'description') {
        let desc = dfl.gnRestQ();
        const i1 = desc.indexOf('"');
        if (i1 !== -1) { const i2 = desc.indexOf('"', i1 + 1); if (i2 !== -1) desc = desc.substring(i1 + 1, i2); }
        g.Description = desc;
      } else if (k === 'sourcefile') g.SourceFile = dfl.gnRest();
      else if (k === 'cloneof') g.CloneOf = dfl.gnRest();
      else if (k === 'sampleof') g.SampleOf = dfl.gnRest();
      else if (k === 'board') g.Board = dfl.gnRest();
      else if (k === 'year') g.Year = dfl.gnRest();
      else if (k === 'manufacturer') g.Manufacturer = dfl.gnRest();
      else if (k === 'history') g.History = dfl.gnRest();
      else if (k === 'isdevice') g.IsDevice = dfl.gnRest();
      else if (SKIP_GAME_KEYS.has(k)) dfl.gnRest();
      else if (k === '/*') { let nx = dfl.gn(); while (nx !== '*/' && !dfl.endOfStream()) nx = dfl.gn(); }
      else if (k === 'name') { const t = dfl.gnRest(); err?.(dfl.Filename, "Error: multiple names found in one game '" + t + "' will be ignored, on line " + dfl.LineNumber); }
      else if (ROM_KEYS.has(k)) { if (!this.loadRom(dfl, d, err, hft)) return false; }
      else if (k === 'disk') { if (!this.loadDisk(dfl, d, err)) return false; }
      else if (k === 'archive') { if (!this.loadArchive(dfl, err)) return false; }
      else err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in game, on line " + dfl.LineNumber);
      dfl.gn();
    }
    parent.childAdd(d);
    return true;
  },
  loadRom(dfl, parent, err, hft) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after rom, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    if (!/^name$/i.test(dfl.Next)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    const r = new DatFile(dfl.gn(), FileType.UnSet);
    r.HeaderFileType = hft;
    dfl.gn();
    while (dfl.Next !== ')') {
      const k = dfl.Next.toLowerCase();
      switch (k) {
        case 'size': r.Size = VarFix.ulong(dfl.gn()); break;
        case 'hash': case 'date': case 'bios': case 'region': case 'offs': dfl.gn(); break;
        case 'crc': case 'crc32': r.CRC = VarFix.cleanMD5SHA1(dfl.gn(), 8); break;
        case 'sha1': r.SHA1 = VarFix.cleanMD5SHA1(dfl.gn(), 40); break;
        case 'md5': r.MD5 = VarFix.cleanMD5SHA1(dfl.gn(), 32); break;
        case 'merge': r.Merge = dfl.gn(); break;
        case 'flags': { const f = dfl.gn().toLowerCase(); if (!r.Status || !r.Status.trim()) r.Status = f; break; }
        case 'regiona': case 'regionb':
          while (dfl.Next !== ')' && !dfl.endOfStream()) dfl.gn();
          continue;
        case 'nodump': r.Status = 'nodump'; break;
        case 'baddump': r.Status = 'baddump'; break;
        default: err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in rom, on line " + dfl.LineNumber);
      }
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    parent.childAdd(r);
    return true;
  },
  loadDisk(dfl, parent, err) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after rom, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    if (!/^name$/i.test(dfl.Next)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    const r = new DatFile(VarFix.cleanCHD(dfl.gn()), FileType.UnSet);
    r.HeaderFileType = HeaderFileType.CHD;
    r.isDisk = true;
    dfl.gn();
    while (dfl.Next !== ')') {
      switch (dfl.Next.toLowerCase()) {
        case 'sha1': r.SHA1 = VarFix.cleanMD5SHA1(dfl.gn(), 40); break;
        case 'md5': r.MD5 = VarFix.cleanMD5SHA1(dfl.gn(), 32); break;
        case 'region': r.Region = dfl.gn(); break;
        case 'merge': r.Merge = VarFix.cleanCHD(dfl.gn()); break;
        case 'index': dfl.gn(); break;
        case 'flags': r.Status = dfl.gn().toLowerCase(); break;
        case 'nodump': r.Status = 'nodump'; break;
        default: err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in rom, on line " + dfl.LineNumber);
      }
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    parent.childAdd(r);
    return true;
  },
  loadArchive(dfl, err) {
    dfl.gn();
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after Archive, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    while (dfl.Next !== ')') {
      if (/^name$/i.test(dfl.Next)) dfl.gn();
      else err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not know in Archive, on line " + dfl.LineNumber);
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    return true;
  },
};

// ------------------------------------------------------------------------------------------------ ROMCenter
const DatROMCenterReader = {
  readDat(text, filename, err) {
    const lines = text.split(/\r\n|\n|\r/);
    let p = 0; let lineNo = 0;
    const eos = () => p >= lines.length;
    const gn = () => {
      let l = lines[p++] ?? ''; lineNo++;
      while (!l.trim() && !eos()) { l = lines[p++]; lineNo++; }
      return l;
    };
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet); h.Filename = filename;
    let next = gn();
    const split = (s) => { const i = s.indexOf('='); return i < 0 ? null : [s.substring(0, i), s.substring(i + 1)]; };
    const section = (fn) => {
      while (!eos()) {
        const line = gn();
        if (!line.trim()) continue;
        if (line[0] === '[') { next = line; return true; }
        if (fn(line) === false) return false;
      }
      next = '';
      return true;
    };
    const games = (isDisk) => section((line) => {
      let parts;
      if (line.includes('�')) parts = line.split('�');
      else if (line.includes('¬')) parts = line.split('¬');
      else return true;
      const [, parentName, , gameName, gameDesc, romName, romCRC, romSize, , merge] = parts;
      const search = new DatDir(gameName, isDisk ? FileType.Dir : FileType.UnSet);
      const s = h.BaseDir.childNameSearch(search);
      let d;
      if (s.res !== 0) {
        d = new DatDir(gameName, FileType.UnSet); d.DGame = new DatGame();
        d.DGame.Description = gameDesc;
        if (parentName !== gameName) d.DGame.CloneOf = parentName;
        h.BaseDir.childAdd(d);
      } else d = h.BaseDir.at(s.index);
      if (isDisk) {
        const r = new DatFile(VarFix.cleanCHD(romName), FileType.UnSet);
        r.HeaderFileType = HeaderFileType.CHD; r.SHA1 = VarFix.cleanMD5SHA1(romCRC, 40); r.Merge = VarFix.cleanCHD(merge); r.isDisk = true;
        d.childAdd(r);
      } else {
        const r = new DatFile(romName, FileType.UnSet);
        r.CRC = VarFix.cleanMD5SHA1(romCRC, 8); r.Size = VarFix.ulong(romSize); r.Merge = merge;
        d.childAdd(r);
      }
      return true;
    });
    while (next) {
      const k = next.trim().toLowerCase();
      let ok;
      if (k === '[credits]') {
        ok = section((line) => {
          const kv = split(line); if (!kv) return false;
          const [e, v] = kv;
          switch (e.toLowerCase()) {
            case 'author': h.Author = v; break;
            case 'email': h.Email = v; break;
            case 'homepage': case 'url': h.URL = v; break;
            case 'version': h.Version = v; break;
            case 'date': h.Date = v; break;
            case 'comment': h.Comment = v; break;
            default: err?.(filename, 'Unknown Line ' + line + ' found in [CREDITS], ' + lineNo); return false;
          }
          return true;
        });
      } else if (k === '[dat]') {
        ok = section((line) => {
          const kv = split(line); if (!kv) return false;
          const [e, v] = kv;
          switch (e.toLowerCase()) {
            case 'version': case 'plugin': break;
            case 'split': h.Split = v; break;
            case 'merge': h.MergeType = v; break;
            default: err?.(filename, 'Unknown Line ' + line + ' found in [DAT], ' + lineNo); return false;
          }
          return true;
        });
      } else if (k === '[emulator]') {
        ok = section((line) => {
          const kv = split(line); if (!kv) return false;
          const [e, v] = kv;
          switch (e.toLowerCase()) {
            case 'refname': h.Name = v; break;
            case 'version': h.Description = v; break;
            case 'category': h.Category = v; break;
            case 'exe': case 'runcmd': case 'romspaths': break;
            default: err?.(filename, 'Unknown Line ' + line + ' found in [EMULATOR], ' + lineNo); return false;
          }
          return true;
        });
      } else if (k === '[games]' || k === '[resources]') ok = games(false);
      else if (k === '[disks]') ok = games(true);
      else { err?.(filename, 'Unknown Line ' + next + ' , ' + lineNo); return null; }
      if (!ok) return null;
    }
    return h;
  },
};

// ------------------------------------------------------------------------------------------------ DOSCenter
function dosDateToStamp(s) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [year, month, day, hours, minutes, seconds] = m.slice(1).map(Number);
  if (year - 1980 < 0 || year - 1980 > 0x7f) return Date.UTC(year, month - 1, day, hours, minutes, seconds); // out of DOS range
  const dosDate = (day & 0x1f) | ((month & 0x0f) << 5) | (((year - 1980) & 0x7f) << 9);
  const dosTime = ((seconds >> 1) & 0x1f) | ((minutes & 0x3f) << 5) | ((hours & 0x1f) << 11);
  return dosDate * 65536 + dosTime;
}

const DatDOSReader = {
  readDat(text, filename, err) {
    const dfl = new DatFileLoader(text, filename);
    const h = new DatHeader(); h.BaseDir = new DatDir('', FileType.UnSet);
    dfl.gn();
    if (dfl.endOfStream()) return null;
    if (/^doscenter$/i.test(dfl.Next)) {
      dfl.gn();
      if (!this.loadHeader(dfl, filename, h, err)) return null;
      dfl.gn();
    }
    while (!dfl.endOfStream()) {
      if (dfl.Next.toLowerCase() === 'game') {
        dfl.gn();
        if (!this.loadGame(dfl, h.BaseDir, err)) return null;
        dfl.gn();
      } else {
        err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known, on line " + dfl.LineNumber);
        dfl.gn();
      }
    }
    return h;
  },
  loadHeader(dfl, filename, h, err) {
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after DOSCenter, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    h.Filename = filename;
    h.Compression = 'TDC';
    while (dfl.Next !== ')') {
      const k = dfl.Next.toLowerCase();
      if (k.length > 5 && k.startsWith('name:')) { h.Name = (dfl.Next.substring(5) + ' ' + dfl.gnRest()).trim(); dfl.gn(); continue; }
      switch (k.replace(/:$/, '')) {
        case 'name': h.Name = dfl.gnRest(); break;
        case 'description': h.Description = dfl.gnRest(); break;
        case 'version': h.Version = dfl.gnRest(); break;
        case 'date': h.Date = dfl.gnRest(); break;
        case 'author': h.Author = dfl.gnRest(); break;
        case 'homepage': h.Homepage = dfl.gnRest(); break;
        case 'comment': h.Comment = dfl.gnRest(); break;
        default: err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in DOSReader, on line " + dfl.LineNumber);
      }
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    return true;
  },
  loadGame(dfl, parent, err) {
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after game, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    if (!/^name$/i.test(dfl.Next)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    let name = dfl.gnRest();
    if (name.length > 4 && name.toLowerCase().endsWith('.zip')) name = name.substring(0, name.length - 4);
    dfl.gn();
    const d = new DatDir(name, FileType.UnSet); d.DGame = new DatGame();
    while (dfl.Next !== ')') {
      const k = dfl.Next.toLowerCase();
      if (k === 'file' || k === 'rom') {
        dfl.gn();
        if (!this.loadFile(dfl, d, err)) return false;
        dfl.gn();
      } else {
        err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in game, on line " + dfl.LineNumber);
        dfl.gn();
      }
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    parent.childAdd(d);
    return true;
  },
  loadFile(dfl, parent, err) {
    if (dfl.Next !== '(') { err?.(dfl.Filename, '( not found after file, on line ' + dfl.LineNumber); return false; }
    dfl.gn();
    if (!/^name$/i.test(dfl.Next)) { err?.(dfl.Filename, 'Name not found as first object in ( ), on line ' + dfl.LineNumber); return false; }
    const r = new DatFile(dfl.gnNameToSize(), FileType.UnSet);
    dfl.gn();
    while (dfl.Next !== ')') {
      switch (dfl.Next.toLowerCase()) {
        case 'size': r.Size = VarFix.ulong(dfl.gn()); break;
        case 'crc': r.CRC = VarFix.cleanMD5SHA1(dfl.gn(), 8); break;
        case 'sha1': r.SHA1 = VarFix.cleanMD5SHA1(dfl.gn(), 40); break;
        case 'date': r.DateModified = dosDateToStamp(dfl.gn() + ' ' + dfl.gn()); break;
        default: err?.(dfl.Filename, "Error: key word '" + dfl.Next + "' not known in rom, on line " + dfl.LineNumber);
      }
      dfl.gn();
      if (dfl.endOfStream() && dfl.Next === '') return false;
    }
    parent.childAdd(r);
    return true;
  },
};

module.exports = { readDat, readDatBuffer, DatFileLoader };
