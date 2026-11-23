// ROM Librarian's DAT reader: Logiqx XML (No-Intro, Redump, TOSEC and most others), MAME's
// -listxml and software lists, ClrMamePro text DATs and RomCenter DATs. Each DAT becomes
// { header, games: [{ name, description, cloneof, romof, isBios, isDevice, year, manufacturer,
// roms: [{ name, size, crc, sha1, md5, merge, status }], disks: [{ name, sha1, md5, merge, status }] }] }.
// buildSets() then turns the games into the sets to keep on disk for a merge mode (split, merged,
// non-merged, full non-merged), the way ROM managers have long done it.

'use strict';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}));
const lowHex = (s, len) => { const v = String(s || '').trim().toLowerCase().replace(/^0x/, ''); return /^[0-9a-f]+$/.test(v) && (!len || v.length <= len) ? (len ? v.padStart(len, '0') : v) : null; };
const num = (s) => { const v = String(s ?? '').trim(); if (!v) return null; const n = /^0x/i.test(v) ? parseInt(v, 16) : Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

function cleanRom(a) {
  const status = String(a.status || a.flags || '').toLowerCase();
  const rom = { name: String(a.name || '').replace(/\\/g, '/'), size: num(a.size), crc: lowHex(a.crc, 8), sha1: lowHex(a.sha1, 40), md5: lowHex(a.md5, 32) };
  if (rom.sha1 && rom.sha1.length !== 40) rom.sha1 = null;
  if (rom.md5 && rom.md5.length !== 32) rom.md5 = null;
  if (a.merge) rom.merge = String(a.merge).replace(/\\/g, '/');
  if (/nodump/.test(status)) rom.status = 'nodump';
  else if (/baddump/.test(status)) rom.status = 'baddump';
  if (a.sha256 && lowHex(a.sha256, 64)) rom.sha256 = lowHex(a.sha256, 64);
  return rom;
}
function cleanDisk(a) {
  const status = String(a.status || a.flags || '').toLowerCase();
  const d = { name: String(a.name || '').replace(/\\/g, '/'), sha1: lowHex(a.sha1, 40), md5: lowHex(a.md5, 32) };
  if (a.merge) d.merge = String(a.merge).replace(/\\/g, '/');
  if (/nodump/.test(status)) d.status = 'nodump'; else if (/baddump/.test(status)) d.status = 'baddump';
  return d;
}

// --- XML ---------------------------------------------------------------------------------------
const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function attrs(s) { const o = {}; if (!s) return o; ATTR.lastIndex = 0; let m; while ((m = ATTR.exec(s))) o[m[1]] = unent(m[2] ?? m[3] ?? ''); return o; }

function parseXml(text) {
  const header = {};
  const games = [];
  const stack = [];
  let game = null, text0 = 0, inHeader = false, softwareList = false;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(text))) {
    if (m[0][1] === '!' || m[0][1] === '?') {
      if (m[1] !== undefined && stack.length) stack[stack.length - 1].text += m[1];
      continue;
    }
    const closing = m[2] === '/'; const name = m[3]; const selfClose = m[5] === '/';
    if (stack.length) stack[stack.length - 1].text += unent(text.slice(text0, m.index));
    text0 = TAG.lastIndex;
    if (closing) {
      const el = stack.pop();
      if (!el) continue;
      const t = el.text.trim();
      if (inHeader && stack.length && stack[stack.length - 1].name === 'header') {
        if (['name', 'description', 'version', 'date', 'author', 'homepage', 'url', 'comment', 'category', 'email'].includes(el.name)) header[el.name] = t;
      }
      if (el.name === 'header') inHeader = false;
      if (game && stack.length && /^(game|machine|software)$/.test(stack[stack.length - 1].name) && ['description', 'year', 'manufacturer', 'publisher', 'category'].includes(el.name)) game[el.name === 'publisher' ? 'manufacturer' : el.name] = t;
      if (/^(game|machine|software)$/.test(el.name) && game) { games.push(game); game = null; }
      continue;
    }
    const a = attrs(m[4]);
    if (!selfClose) stack.push({ name, text: '' });
    switch (name) {
      case 'header': inHeader = true; break;
      case 'clrmamepro': if (inHeader) { if (a.header) header.headerFile = a.header; if (a.forcemerging) header.forcemerging = a.forcemerging; if (a.forcepacking) header.forcepacking = a.forcepacking; if (a.forcenodump) header.forcenodump = a.forcenodump; } break;
      case 'romcenter': if (inHeader && a.plugin) header.plugin = a.plugin; break;
      case 'softwarelist': softwareList = true; header.name = header.name || a.name; header.description = header.description || a.description; break;
      case 'mame': header.name = header.name || 'MAME'; header.version = header.version || a.build; break;
      case 'datafile': if (a.build) header.version = header.version || a.build; break;
      case 'game': case 'machine': case 'software':
        game = { name: a.name || '', description: a.description || '', roms: [], disks: [] };
        if (a.cloneof || a.cloneOf) game.cloneof = a.cloneof || a.cloneOf;
        if (a.romof && a.romof !== a.name) game.romof = a.romof;
        if (softwareList && game.cloneof && !game.romof) game.romof = game.cloneof;
        if (a.isbios === 'yes') game.isBios = true;
        if (a.isdevice === 'yes') game.isDevice = true;
        if (a.year) game.year = a.year;
        if (a.manufacturer) game.manufacturer = a.manufacturer;
        if (selfClose) { games.push(game); game = null; }
        break;
      case 'rom':
        if (game && a.name) game.roms.push(cleanRom(a));
        break;
      case 'disk':
        if (game && a.name) game.disks.push(cleanDisk(a));
        break;
      default:
    }
  }
  return { header, games };
}

// --- ClrMamePro text ---------------------------------------------------------------------------
function tokens(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|([()])|([^\s()"]+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? { s: m[1].replace(/\\(.)/g, '$1') } : m[2] ? m[2] : { s: m[3] });
  return out;
}
function parseCmp(text) {
  const t = tokens(text);
  let i = 0;
  const block = () => { // after '(' : list of [key, value|block]
    const items = [];
    while (i < t.length && t[i] !== ')') {
      const k = t[i++]; if (typeof k !== 'object') continue;
      if (t[i] === '(') { i++; items.push([k.s.toLowerCase(), block()]); i++; } else if (i < t.length && typeof t[i] === 'object') { items.push([k.s.toLowerCase(), t[i++].s]); } else items.push([k.s.toLowerCase(), '']);
    }
    return items;
  };
  const header = {};
  const games = [];
  const toObj = (items) => { const o = {}; for (const [k, v] of items) if (typeof v === 'string') { if (k === 'flags' && o.flags) o.flags += ` ${v}`; else o[k] = v; } return o; };
  while (i < t.length) {
    const k = t[i++]; if (typeof k !== 'object') continue;
    if (t[i] !== '(') continue;
    i++;
    const items = block(); i++;
    const kind = k.s.toLowerCase();
    if (kind === 'clrmamepro' || kind === 'emulator') {
      const o = toObj(items);
      for (const f of ['name', 'description', 'version', 'date', 'author', 'homepage', 'url', 'comment', 'category']) if (o[f] && !header[f]) header[f] = o[f];
      if (o.forcemerging) header.forcemerging = o.forcemerging;
      if (o.forcepacking) header.forcepacking = o.forcepacking;
      if (o.header) header.headerFile = o.header;
    } else if (['game', 'machine', 'resource', 'set'].includes(kind)) {
      const o = toObj(items);
      const g = { name: o.name || '', description: o.description || '', roms: [], disks: [] };
      if (o.cloneof) g.cloneof = o.cloneof;
      if (o.romof && o.romof !== o.name) g.romof = o.romof;
      if (kind === 'resource') g.isBios = true;
      if (o.year) g.year = o.year;
      if (o.manufacturer) g.manufacturer = o.manufacturer;
      for (const [ik, iv] of items) {
        if (ik === 'rom' && Array.isArray(iv)) { const a = toObj(iv); if (a.name) g.roms.push(cleanRom(a)); }
        if (ik === 'disk' && Array.isArray(iv)) { const a = toObj(iv); if (a.name) g.disks.push(cleanDisk(a)); }
      }
      if (g.name) games.push(g);
    }
  }
  return { header, games };
}

// --- RomCenter ---------------------------------------------------------------------------------
function parseRomCenter(text) {
  const header = {};
  const byName = new Map();
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    if (section === 'CREDITS' || section === 'DAT' || section === 'EMULATOR') {
      const kv = /^(\w+)=(.*)$/.exec(line);
      if (kv) { const k = kv[1].toLowerCase(); const v = kv[2].trim(); if (k === 'refname' || (k === 'name' && !header.name)) header.name = v; else if (['version', 'author', 'homepage', 'comment', 'date', 'email', 'url'].includes(k)) header[k] = v; else if (k === 'merge' || k === 'split') header.forcemerging = v === '1' ? (k === 'split' ? 'split' : 'full') : header.forcemerging; }
      continue;
    }
    if (section !== 'GAMES' || !line.startsWith('¬')) continue;
    const f = line.split('¬');
    // ¬parent¬parent description¬game¬game description¬rom¬crc¬size¬romof¬merge¬
    const [, parent, , name, desc, rom, crc, size, romof, merge] = f;
    if (!name) continue;
    let g = byName.get(name);
    if (!g) { g = { name, description: desc || name, roms: [], disks: [] }; if (parent && parent !== name) g.cloneof = parent; if (romof && romof !== name) g.romof = romof; else if (g.cloneof) g.romof = g.cloneof; byName.set(name, g); }
    if (rom) g.roms.push(cleanRom({ name: rom, crc, size, merge }));
  }
  return { header, games: [...byName.values()] };
}

function parseDat(text) {
  const t = text.replace(/^﻿/, '');
  const start = t.slice(0, 4096).trimStart();
  let dat;
  if (start.startsWith('<')) dat = parseXml(t);
  else if (/^\[(CREDITS|DAT|EMULATOR)\]/im.test(start)) dat = parseRomCenter(t);
  else dat = parseCmp(t);
  if (!dat.games.length) throw new Error('No games found (not a DAT this reader knows)');
  dat.games = dat.games.filter((g) => g.name);
  return dat;
}
const looksLikeDat = (head) => {
  const s = head.replace(/^﻿/, '').trimStart();
  return /^<\?xml|^<(datafile|mame|softwarelist|!DOCTYPE)/i.test(s) || /^(clrmamepro|emulator|game|resource)\s*\(/i.test(s) || /^\[(CREDITS|DAT|EMULATOR)\]/i.test(s);
};

// --- Sets for a merge mode --------------------------------------------------------------------
// Modes: 'split' (each set holds only its own files; clones need their parent, games need their
// BIOS), 'merged' (clones live inside their parent's archive), 'nonmerged' (every set holds the
// parent's files too, but not the BIOS), 'fullnonmerged' (everything, BIOS included) and 'auto'
// (what the DAT's forcemerging asks for; non-merged if nothing).
const sameHash = (a, b) => {
  if (a.sha1 && b.sha1) return a.sha1 === b.sha1;
  if (a.md5 && b.md5) return a.md5 === b.md5;
  if (a.crc && b.crc) return a.crc === b.crc && (a.size == null || b.size == null || a.size === b.size);
  return false;
};
function resolveMode(mode, header) {
  if (mode && mode !== 'auto') return mode;
  const f = String(header?.forcemerging || '').toLowerCase();
  return f === 'split' ? 'split' : f === 'full' || f === 'merged' ? 'merged' : 'nonmerged';
}

function buildSets(dat, { mode = 'auto', filter = 'all' } = {}) {
  const m = resolveMode(mode, dat.header);
  const byName = new Map(dat.games.map((g) => [g.name, g]));
  const parentOf = (g) => (g.cloneof && byName.has(g.cloneof) && g.cloneof !== g.name ? byName.get(g.cloneof) : null);
  const romofOf = (g) => { const n = g.romof || g.cloneof; return n && byName.has(n) && n !== g.name ? byName.get(n) : null; };
  // Where a file of game g really belongs: 'own', 'parent' or 'bios', found by walking up romof
  // (the parent, then its BIOS) for a file with the merge name (or the same name) and hash.
  const origin = (g, item, kind, depth = 0) => {
    const want = item.merge || item.name;
    const seen = new Set([g.name]);
    for (let cur = romofOf(g); cur && !seen.has(cur.name) && depth < 20; cur = romofOf(cur)) {
      seen.add(cur.name);
      const list = kind === 'disk' ? cur.disks : cur.roms;
      const hit = list.find((r) => r.name === want && (sameHash(r, item) || (item.merge && !item.crc && !item.sha1 && !item.md5)));
      if (!hit) continue;
      if (cur.isBios || origin(cur, hit, kind, depth + 1) === 'bios') return 'bios';
      return 'parent';
    }
    if (!item.merge) return 'own';
    return g.cloneof ? 'parent' : 'bios';
  };
  const itemOf = (r, disk) => {
    const it = { name: disk ? `${r.name}.chd` : r.name, size: disk ? null : r.size, crc: disk ? null : r.crc, sha1: r.sha1, md5: r.md5 };
    if (disk) it.disk = true;
    if (r.status === 'baddump') it.baddump = true;
    if (r.status === 'nodump' || (!disk && !r.crc && !r.sha1 && !r.md5 && r.size !== 0) || (disk && !r.sha1 && !r.md5)) it.nodump = true;
    if (!disk && r.size === 0 && !r.crc) it.crc = '00000000';
    return it;
  };
  const wanted = (disk) => filter === 'all' || (filter === 'roms' && !disk) || (filter === 'disks' && disk);
  const ownItems = (g, keep) => {
    const out = [];
    const add = (list, disk) => {
      for (const r of list) {
        if (!wanted(disk)) continue;
        const o = m === 'fullnonmerged' ? 'own' : origin(g, r, disk ? 'disk' : 'rom');
        if (keep(o)) out.push(itemOf(r, disk));
      }
    };
    add(g.roms, false); add(g.disks, true);
    return out;
  };
  const dedupe = (items) => {
    const seen = new Map();
    const out = [];
    for (const it of items) {
      const prev = seen.get(it.name);
      if (prev && (sameHash(prev, it) || it.nodump)) continue;
      if (prev) it.name = uniqueName(it.name, seen);
      seen.set(it.name, it); out.push(it);
    }
    return out;
  };
  const clonesOf = new Map();
  for (const g of dat.games) { const p = parentOf(g); if (p) { const l = clonesOf.get(p) || []; l.push(g); clonesOf.set(p, l); } }
  const sets = [];
  for (const g of dat.games) {
    const parent = parentOf(g);
    const base = { name: g.name, description: g.description || g.name, parent: parent ? parent.name : null, bios: g.isBios || undefined, device: g.isDevice || undefined, year: g.year, manufacturer: g.manufacturer };
    if (m === 'merged') {
      if (parent) continue;
      const items = ownItems(g, (o) => o !== 'bios');
      const seen = new Map(items.map((it) => [it.name, it]));
      const clones = clonesOf.get(g) || [];
      for (const c of clones) {
        for (const it of ownItems(c, (o) => o === 'own')) {
          const prev = seen.get(it.name);
          if (prev && sameHash(prev, it)) continue;
          if (prev) it.name = `${c.name}/${it.name}`;
          seen.set(it.name, it); items.push(it);
        }
      }
      sets.push({ ...base, clones: clones.map((c) => c.name), items: dedupe(items) });
    } else if (m === 'split') {
      sets.push({ ...base, items: dedupe(ownItems(g, (o) => o === 'own')) });
    } else {
      sets.push({ ...base, items: dedupe(ownItems(g, (o) => m === 'fullnonmerged' || o !== 'bios')) });
    }
  }
  return { mode: m, sets: sets.filter((s) => s.items.length) };
}
function uniqueName(name, seen) {
  const dot = name.lastIndexOf('.');
  for (let n = 2; ; n++) { const c = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`; if (!seen.has(c)) return c; }
}

// A fix DAT (Logiqx XML) of what's missing: [{ name, description, items }].
function writeFixDat(title, sets, { version } = {}) {
  const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lines = ['<?xml version="1.0"?>', '<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROM Management Datafile//EN" "http://www.logiqx.com/Dats/datafile.dtd">', '<datafile>', '\t<header>',
    `\t\t<name>fix_${x(title)}</name>`, `\t\t<description>fix_${x(title)}</description>`, `\t\t<version>${x(version || new Date().toISOString().slice(0, 10))}</version>`, '\t\t<author>ROM Librarian (MediaDesk)</author>', '\t</header>'];
  for (const s of sets) {
    lines.push(`\t<game name="${x(s.name)}">`, `\t\t<description>${x(s.description || s.name)}</description>`);
    for (const it of s.items) {
      if (it.disk) lines.push(`\t\t<disk name="${x(it.name.replace(/\.chd$/i, ''))}"${it.sha1 ? ` sha1="${it.sha1}"` : ''}${it.md5 ? ` md5="${it.md5}"` : ''}/>`);
      else lines.push(`\t\t<rom name="${x(it.name)}" size="${it.size ?? 0}"${it.crc ? ` crc="${it.crc}"` : ''}${it.md5 ? ` md5="${it.md5}"` : ''}${it.sha1 ? ` sha1="${it.sha1}"` : ''}/>`);
    }
    lines.push('\t</game>');
  }
  lines.push('</datafile>', '');
  return lines.join('\n');
}

module.exports = { parseDat, parseXml, parseCmp, parseRomCenter, looksLikeDat, buildSets, resolveMode, writeFixDat, sameHash };
