// The Game Console: the game library (ROMs and disc images in one folder on this server), save
// states and battery saves kept on the server so they follow you between devices, per-console
// settings, cover art, and the emulators themselves.
//
// The emulators are EmulatorJS (https://emulatorjs.org, GPL-3.0) and the libretro cores it
// packages. MediaDesk doesn't ship them: the first time a console is played, the server
// downloads the runtime and that console's core from the npm registry and keeps them in its
// data folder, so later games start straight away and work offline.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const EJS_VERSION = '4.2.3';
const REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const ART_HOST = 'https://thumbnails.libretro.com';

// ---------------------------------------------------------------------------
// Consoles
// ---------------------------------------------------------------------------

// ext: file types that can only be this console. alias: folder names that mean this console.
// cores: EmulatorJS cores, best first. art: the libretro thumbnail set for cover art.
const SYSTEMS = {
  nes: { ext: ['nes', 'fds', 'unf', 'unif'], alias: ['nes', 'famicom', 'nintendo', 'nintendoentertainmentsystem', 'fds', 'famicomdisksystem'], cores: ['fceumm', 'nestopia'], art: 'Nintendo - Nintendo Entertainment System' },
  snes: { ext: ['sfc', 'smc', 'fig', 'swc', 'bs'], alias: ['snes', 'supernintendo', 'superfamicom', 'sfc', 'supernes'], cores: ['snes9x'], art: 'Nintendo - Super Nintendo Entertainment System' },
  n64: { ext: ['z64', 'n64', 'v64'], alias: ['n64', 'nintendo64'], cores: ['mupen64plus_next', 'parallel_n64'], art: 'Nintendo - Nintendo 64' },
  gb: { ext: ['gb', 'gbc', 'sgb'], alias: ['gb', 'gameboy', 'gbc', 'gameboycolor', 'gameboycolour'], cores: ['gambatte', 'mgba'], art: 'Nintendo - Game Boy' },
  gba: { ext: ['gba', 'agb'], alias: ['gba', 'gameboyadvance'], cores: ['mgba'], art: 'Nintendo - Game Boy Advance' },
  nds: { ext: ['nds', 'dsi'], alias: ['nds', 'ds', 'nintendods'], cores: ['melonds', 'desmume2015'], art: 'Nintendo - Nintendo DS' },
  vb: { ext: ['vb', 'vboy'], alias: ['vb', 'virtualboy'], cores: ['beetle_vb'], art: 'Nintendo - Virtual Boy' },
  segaMD: { ext: ['md', 'gen', 'smd', 'sgd'], alias: ['genesis', 'megadrive', 'md', 'segagenesis', 'segamegadrive', 'gen'], cores: ['genesis_plus_gx', 'picodrive'], art: 'Sega - Mega Drive - Genesis' },
  segaMS: { ext: ['sms'], alias: ['sms', 'mastersystem', 'segamastersystem', 'markiii', 'sg1000'], cores: ['smsplus', 'genesis_plus_gx'], art: 'Sega - Master System - Mark III' },
  segaGG: { ext: ['gg'], alias: ['gg', 'gamegear', 'segagamegear'], cores: ['genesis_plus_gx'], art: 'Sega - Game Gear' },
  segaCD: { ext: [], alias: ['segacd', 'megacd', 'scd'], cores: ['genesis_plus_gx', 'picodrive'], art: 'Sega - Mega-CD - Sega CD', disc: true },
  sega32x: { ext: ['32x'], alias: ['32x', 'sega32x'], cores: ['picodrive'], art: 'Sega - 32X' },
  segaSaturn: { ext: [], alias: ['saturn', 'segasaturn', 'ss'], cores: ['yabause'], art: 'Sega - Saturn', disc: true },
  dreamcast: { ext: ['gdi', 'cdi'], alias: ['dreamcast', 'dc', 'segadreamcast'], cores: [], art: 'Sega - Dreamcast', disc: true },
  psx: { ext: ['pbp'], alias: ['psx', 'ps1', 'ps', 'playstation', 'sonyplaystation', 'playstation1'], cores: ['pcsx_rearmed', 'mednafen_psx_hw'], art: 'Sony - PlayStation', disc: true },
  psp: { ext: ['cso'], alias: ['psp', 'playstationportable'], cores: ['ppsspp'], art: 'Sony - PlayStation Portable', disc: true },
  pce: { ext: ['pce', 'sgx'], alias: ['pce', 'pcengine', 'tg16', 'turbografx', 'turbografx16', 'tgcd', 'pcenginecd', 'supergrafx'], cores: ['mednafen_pce'], art: 'NEC - PC Engine - TurboGrafx 16' },
  atari2600: { ext: ['a26'], alias: ['atari2600', '2600', 'vcs'], cores: ['stella2014'], art: 'Atari - 2600' },
  atari5200: { ext: ['a52'], alias: ['atari5200', '5200'], cores: ['a5200'], art: 'Atari - 5200' },
  atari7800: { ext: ['a78'], alias: ['atari7800', '7800'], cores: ['prosystem'], art: 'Atari - 7800' },
  lynx: { ext: ['lnx', 'lyx'], alias: ['lynx', 'atarilynx'], cores: ['handy'], art: 'Atari - Lynx' },
  jaguar: { ext: ['j64', 'jag'], alias: ['jaguar', 'atarijaguar'], cores: ['virtualjaguar'], art: 'Atari - Jaguar' },
  ngp: { ext: ['ngp', 'ngc', 'npc'], alias: ['ngp', 'ngpc', 'neogeopocket', 'neogeopocketcolor'], cores: ['mednafen_ngp'], art: 'SNK - Neo Geo Pocket Color' },
  ws: { ext: ['ws', 'wsc', 'pc2'], alias: ['ws', 'wsc', 'wonderswan', 'wonderswancolor'], cores: ['mednafen_wswan'], art: 'Bandai - WonderSwan Color' },
  coleco: { ext: ['col', 'cv'], alias: ['coleco', 'colecovision'], cores: ['gearcoleco'], art: 'Coleco - ColecoVision' },
  '3do': { ext: [], alias: ['3do', 'panasonic3do'], cores: ['opera'], art: 'The 3DO Company - 3DO', disc: true },
  arcade: { ext: [], alias: ['arcade', 'mame', 'fbneo', 'fba', 'finalburn', 'neogeo', 'cps1', 'cps2', 'cps3'], cores: ['fbneo', 'mame2003_plus'], art: 'FBNeo - Arcade Games' },
};
const ALL_CORES = new Set(Object.values(SYSTEMS).flatMap((s) => s.cores));
// Cores that need SharedArrayBuffer (and so a cross-origin isolated page).
const THREADED = new Set(['ppsspp']);

const EXT_TO_SYSTEM = new Map();
for (const [id, s] of Object.entries(SYSTEMS)) for (const e of s.ext) EXT_TO_SYSTEM.set(e, id);
const ALIAS_TO_SYSTEM = new Map();
for (const [id, s] of Object.entries(SYSTEMS)) for (const a of s.alias) ALIAS_TO_SYSTEM.set(a, id);
const BIOS_DIRS = new Set(['bios', 'system', 'firmware', 'biosfiles']);
const AMBIGUOUS = new Set(['bin', 'iso', 'img', 'cue', 'chd', 'm3u', 'zip', '7z', 'ccd', 'mds', 'rom', 'elf']);
const ART_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const ART_DIRS = ['boxart', 'covers', 'media', 'images', 'art', 'boxarts', 'named_boxarts'];
const SERVE_EXT = new Set([...EXT_TO_SYSTEM.keys(), ...AMBIGUOUS, 'sub', 'ccd', 'img', 'raw', 'iso', 'pbp', 'cso', 'gdi', 'cdi', 'mdf', 'toc', 'sbi', 'wav', 'ogg', 'ecm', 'ape', 'flac', 'mp3']);

// Well-known BIOS files and the console they belong to (lower-case names).
const KNOWN_BIOS = {
  'scph1001.bin': 'psx', 'scph5500.bin': 'psx', 'scph5501.bin': 'psx', 'scph5502.bin': 'psx', 'scph7001.bin': 'psx', 'scph101.bin': 'psx', 'psxonpsp660.bin': 'psx',
  'bios_cd_u.bin': 'segaCD', 'bios_cd_e.bin': 'segaCD', 'bios_cd_j.bin': 'segaCD', 'bios_md.bin': 'segaMD', 'bios_e.sms': 'segaMS', 'bios_u.sms': 'segaMS', 'bios_j.sms': 'segaMS', 'bios.gg': 'segaGG',
  'saturn_bios.bin': 'segaSaturn', 'sega_101.bin': 'segaSaturn', 'mpr-17933.bin': 'segaSaturn',
  'panafz10.bin': '3do', 'panafz1.bin': '3do', 'panafz10-norsa.bin': '3do', 'goldstar.bin': '3do',
  'lynxboot.img': 'lynx', 'colecovision.rom': 'coleco', 'coleco.rom': 'coleco', '5200.rom': 'atari5200', '7800 bios (u).rom': 'atari7800', '7800 bios (e).rom': 'atari7800',
  'syscard3.pce': 'pce', 'syscard2.pce': 'pce', 'syscard1.pce': 'pce', 'gexpress.pce': 'pce',
  'bios7.bin': 'nds', 'bios9.bin': 'nds', 'firmware.bin': 'nds', 'gba_bios.bin': 'gba', 'gb_bios.bin': 'gb', 'gbc_bios.bin': 'gb', 'disksys.rom': 'nes',
  'neogeo.zip': 'arcade', 'dc_boot.bin': 'dreamcast', 'dc_flash.bin': 'dreamcast',
};

class GameError extends Error { constructor(status, message) { super(message); this.status = status; } }

const lc = (s) => String(s).toLowerCase();
const extOf = (name) => { const m = /\.([^.]+)$/.exec(name); return m ? lc(m[1]) : ''; };
const squash = (s) => lc(s).replace(/[^a-z0-9]/g, '');
const idOf = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);

// "Legend of Zelda, The (USA) (Rev 1) [!]" -> title "The Legend of Zelda", tags ["USA", "Rev 1"]
function cleanTitle(base) {
  const tags = [];
  let t = base.replace(/\s*[([]([^)\]]*)[)\]]/g, (_, x) => { if (x && x !== '!') tags.push(x.trim()); return ''; }).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const art = /^(.*), (The|A|An|Die|Der|Das|Le|La|Les|El|Los|Las)(\s*-\s*.*|:.*)?$/i.exec(t);
  if (art) t = `${art[2]} ${art[1]}${art[3] || ''}`;
  return { title: t || base, tags };
}

// ---------------------------------------------------------------------------
// Working out what's what
// ---------------------------------------------------------------------------

async function readHead(abs, bytes) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

// Disc images say what they're for in their first sectors.
async function sniffDisc(abs) {
  let head;
  try { head = await readHead(abs, 0xA000); } catch { return null; }
  const s = head.toString('latin1');
  if (s.includes('SEGA SEGAKATANA')) return 'dreamcast';
  if (s.includes('SEGA SEGASATURN')) return 'segaSaturn';
  if (s.includes('SEGADISCSYSTEM') || s.includes('SEGA MEGA DRIVE') && s.includes('CD')) return 'segaCD';
  if (s.includes('PSP GAME')) return 'psp';
  if (s.includes('PLAYSTATION')) return 'psx';
  if (s.includes('PC Engine CD-ROM SYSTEM') || s.includes('PC-FX')) return 'pce';
  if (head.length > 7 && head[0] === 1 && head.subarray(1, 6).every((b) => b === 0x5a) && head[6] === 1) return '3do';
  return null;
}

// A raw .bin: a Genesis cartridge has "SEGA" at 0x100; tiny ones are Atari 2600 games.
async function sniffBin(abs, size) {
  const disc = size > 4 * 1024 * 1024 ? await sniffDisc(abs) : null;
  if (disc) return disc;
  let head;
  try { head = await readHead(abs, 0x200); } catch { return null; }
  if (head.subarray(0x100, 0x104).toString('latin1') === 'SEGA' || head.subarray(0x100, 0x110).toString('latin1').includes('SEGA')) return size > 4 * 1024 * 1024 + 1 && head.subarray(0x100, 0x110).toString('latin1').includes('32X') ? 'sega32x' : 'segaMD';
  if (size <= 64 * 1024) return 'atari2600';
  if (size > 32 * 1024 * 1024) return sniffDisc(abs);
  return null;
}

// The file names inside a .zip (from its central directory, without unpacking it).
async function zipNames(abs, size) {
  const tail = Math.min(size, 66000);
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(tail);
    await fh.read(buf, 0, tail, size - tail);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return [];
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (cdSize > 4 * 1024 * 1024 || cdOff + cdSize > size) return [];
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const names = [];
    for (let i = 0, p = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const n = cd.readUInt16LE(p + 28), x = cd.readUInt16LE(p + 30), c = cd.readUInt16LE(p + 32);
      names.push(cd.subarray(p + 46, p + 46 + n).toString('utf8'));
      p += 46 + n + x + c;
    }
    return names;
  } catch { return []; } finally { await fh.close(); }
}

async function classifyZip(abs, size) {
  const names = (await zipNames(abs, size)).filter((n) => !n.endsWith('/'));
  for (const n of names) { const s = EXT_TO_SYSTEM.get(extOf(n)); if (s) return s; }
  // Arcade sets are zips full of chip dumps with no recognisable extension.
  if (names.length > 1 && names.every((n) => !EXT_TO_SYSTEM.has(extOf(n)))) return 'arcade';
  return null;
}

function hintFromDirs(parts) {
  for (let i = parts.length - 2; i >= 0; i--) {
    const d = squash(parts[i]);
    if (BIOS_DIRS.has(d)) return 'bios';
    if (ALIAS_TO_SYSTEM.has(d)) return ALIAS_TO_SYSTEM.get(d);
    // "Nintendo - Super Nintendo Entertainment System", "Sony PlayStation (USA)" ...
    for (const [alias, id] of ALIAS_TO_SYSTEM) if (alias.length > 5 && d.includes(alias)) return id;
  }
  return null;
}

// Files a .cue / .gdi / .m3u points at (so they aren't listed as games of their own).
async function referencedFiles(abs, ext) {
  let text;
  try { text = (await readHead(abs, 64 * 1024)).toString('utf8'); } catch { return []; }
  const dir = path.dirname(abs);
  const out = [];
  if (ext === 'cue') for (const m of text.matchAll(/^\s*FILE\s+"?([^"\r\n]+?)"?\s+\w+\s*$/gim)) out.push(path.resolve(dir, m[1]));
  if (ext === 'gdi') for (const line of text.split(/\r?\n/).slice(1)) { const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+"?([^"]+?)"?\s+\d+\s*$/.exec(line); if (m) out.push(path.resolve(dir, m[1])); }
  if (ext === 'm3u') for (const line of text.split(/\r?\n/)) { const l = line.trim(); if (l && !l.startsWith('#')) out.push(path.resolve(dir, l)); }
  return out;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function createGames({ dataDir, getFolder, mock = false, sample = null }) {
  const gamesData = path.join(dataDir, 'games');
  const savesDir = path.join(gamesData, 'saves');
  const artDir = path.join(gamesData, 'art');
  const settingsFile = path.join(gamesData, 'settings.json');
  const emuDir = path.join(dataDir, 'emulator', EJS_VERSION);
  let cache = null; // { folder, at, games, bios }
  let scanning = null;

  async function scan() {
    const folder = getFolder();
    if (!folder) return { folder: '', games: [], bios: [], art: new Map() };
    const root = path.resolve(folder);
    const st = await fsp.stat(root).catch(() => null);
    if (!st?.isDirectory()) throw new GameError(404, `The games folder ${root} can’t be found on the MediaDesk server`);
    const files = [];
    const art = new Map(); // lower-case base name -> rel path of a picture
    let count = 0;
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || count > 50000) continue;
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < 8) await walk(abs, r, depth + 1); continue; }
        if (!e.isFile() && !e.isSymbolicLink()) continue;
        count++;
        const ext = extOf(e.name);
        if (ART_EXT.includes(ext)) { art.set(lc(e.name.slice(0, -(ext.length + 1))), r); continue; }
        if (!SERVE_EXT.has(ext) && !KNOWN_BIOS[lc(e.name)]) continue;
        files.push({ abs, rel: r, name: e.name, ext });
      }
    };
    await walk(root, '', 0);

    const consumed = new Set();
    for (const f of files) if (['cue', 'gdi', 'm3u'].includes(f.ext)) for (const r of await referencedFiles(f.abs, f.ext)) consumed.add(r);
    const games = [], bios = [];
    for (const f of files) {
      if (consumed.has(f.abs)) continue;
      const parts = f.rel.split('/');
      const hint = hintFromDirs(parts);
      const known = KNOWN_BIOS[lc(f.name)];
      if (hint === 'bios' || (known && !EXT_TO_SYSTEM.has(f.ext))) { bios.push({ path: f.rel, name: f.name, system: known || null }); continue; }
      let system = EXT_TO_SYSTEM.get(f.ext) || null;
      let guessed = false;
      const size = (await fsp.stat(f.abs).catch(() => ({ size: 0 }))).size;
      if (!system && AMBIGUOUS.has(f.ext)) {
        if (hint) system = hint;
        else if (f.ext === 'zip') system = await classifyZip(f.abs, size);
        else if (f.ext === 'bin') system = await sniffBin(f.abs, size);
        else if (['iso', 'img'].includes(f.ext)) system = await sniffDisc(f.abs);
        else if (['cue', 'gdi', 'm3u'].includes(f.ext)) {
          const first = (await referencedFiles(f.abs, f.ext))[0];
          if (first) system = f.ext === 'm3u' ? null : await sniffDisc(first);
          if (!system && f.ext === 'gdi') system = 'dreamcast';
        }
        if (!system && ['chd', 'cue', 'pbp', 'm3u', 'iso', 'ccd', 'mds'].includes(f.ext)) { system = 'psx'; guessed = true; }
      } else if (system === 'gb' && hint && ['gb', 'gba'].includes(hint)) system = hint === 'gba' && f.ext === 'gba' ? 'gba' : system;
      if (!system) continue;
      // Genesis and Atari also use .bin; a folder name settles it.
      if (hint && SYSTEMS[hint] && f.ext === 'bin') system = hint;
      const base = f.name.slice(0, f.name.length - (f.ext.length + 1));
      const { title, tags } = cleanTitle(base);
      const pic = art.get(lc(base));
      // Track files a .cue / .gdi / .m3u needs alongside it (one level of .m3u -> .cue).
      let tracks;
      if (['cue', 'gdi', 'm3u'].includes(f.ext)) {
        const seen = new Set();
        const add = async (abs, ext, depth) => {
          for (const r of await referencedFiles(abs, ext)) {
            if (seen.has(r) || !r.startsWith(root + path.sep) || seen.size > 60) continue;
            if (!(await fsp.stat(r).catch(() => null))?.isFile()) continue;
            seen.add(r);
            const e = extOf(r);
            if (depth < 1 && ['cue', 'gdi'].includes(e)) await add(r, e, depth + 1);
          }
        };
        await add(f.abs, f.ext, 0);
        tracks = [...seen].map((r) => path.relative(root, r).split(path.sep).join('/'));
      }
      games.push({
        id: idOf(f.rel), path: f.rel, file: f.name, base, title, tags, system, size, guessed,
        color: f.ext === 'gbc' || /\bcolor\b/i.test(tags.join(' ')) ? true : undefined,
        art: pic ? true : undefined, parts: tracks,
      });
    }
    games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
    return { folder: root, games, bios, art };
  }

  async function library(refresh = false) {
    if (mock && sample) return sample();
    const folder = getFolder();
    if (!refresh && cache && cache.folder === path.resolve(folder || '.') && Date.now() - cache.at < 5 * 60e3) return cache;
    if (!scanning) scanning = scan().then((r) => { cache = { ...r, at: Date.now() }; return cache; }).finally(() => { scanning = null; });
    return scanning;
  }

  async function findGame(id) {
    const lib = await library();
    const g = lib.games.find((x) => x.id === id);
    if (!g) throw new GameError(404, 'That game is no longer in the games folder');
    return { lib, game: g };
  }

  // Only files the scan found can be read, and only from inside the folder.
  async function resolveFile(rel) {
    const lib = await library();
    const parts = String(rel || '').split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.some((p) => p === '..' || p === '.')) throw new GameError(400, 'Invalid path');
    const abs = path.resolve(lib.folder, ...parts);
    if (!abs.startsWith(lib.folder + path.sep)) throw new GameError(400, 'Path is outside the games folder');
    const ext = extOf(abs);
    if (!SERVE_EXT.has(ext) && !KNOWN_BIOS[lc(path.basename(abs))] && !ART_EXT.includes(ext)) throw new GameError(403, 'Not a game file');
    const real = await fsp.realpath(abs).catch(() => { throw new GameError(404, 'File not found'); });
    const realRoot = await fsp.realpath(lib.folder);
    if (!(real === realRoot || real.startsWith(realRoot + path.sep))) throw new GameError(403, 'That link points outside the games folder');
    return abs;
  }

  // ---- Settings, favourites, play history ----

  let settingsCache = null;
  async function readSettings() {
    if (settingsCache) return settingsCache;
    try { settingsCache = JSON.parse(await fsp.readFile(settingsFile, 'utf8')); } catch { settingsCache = {}; }
    settingsCache.systems ||= {}; settingsCache.favorites ||= []; settingsCache.played ||= {};
    return settingsCache;
  }
  async function writeSettings(s) {
    settingsCache = s;
    await fsp.mkdir(gamesData, { recursive: true });
    const tmp = `${settingsFile}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(s, null, 1));
    await fsp.rename(tmp, settingsFile);
  }
  const SHADERS = ['disabled', 'crt-easymode.glslp', 'crt-aperture.glslp', 'crt-geom.glslp', 'crt-mattias.glslp', 'crt-lottes', 'crt-zfast', 'crt-beam', 'sabr', '2xScaleHQ.glslp', 'bicubic', 'mix-frames'];
  function cleanSystemSettings(id, v) {
    const s = SYSTEMS[id];
    const out = {};
    if (typeof v.core === 'string' && s.cores.includes(v.core)) out.core = v.core;
    if (typeof v.bios === 'string') out.bios = v.bios.slice(0, 500);
    if (SHADERS.includes(v.shader)) out.shader = v.shader;
    for (const k of ['rewind', 'autosave', 'hidden', 'fastForwardAudio', 'touchControls']) if (typeof v[k] === 'boolean') out[k] = v[k];
    if (['1.5', '2.0', '3.0', '4.0', '6.0', '8.0'].includes(String(v.ffRatio))) out.ffRatio = String(v.ffRatio);
    if (Number.isInteger(v.volume) && v.volume >= 0 && v.volume <= 100) out.volume = v.volume;
    return out;
  }

  // ---- Save states and battery saves ----

  const saveDir = (id) => path.join(savesDir, id.replace(/[^a-f0-9]/g, ''));
  const SLOT = /^(auto|[1-9])$/;
  async function listStates(id) {
    const dir = saveDir(id);
    const names = await fsp.readdir(dir).catch(() => []);
    const out = [];
    for (const n of names) {
      const m = /^state-(auto|[1-9])\.state$/.exec(n);
      if (!m) continue;
      const st = await fsp.stat(path.join(dir, n));
      out.push({ slot: m[1], at: st.mtimeMs, size: st.size, shot: names.includes(`state-${m[1]}.png`) });
    }
    const sram = await fsp.stat(path.join(dir, 'battery.sav')).catch(() => null);
    return { states: out.sort((a, b) => b.at - a.at), battery: sram ? { at: sram.mtimeMs, size: sram.size } : null };
  }

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw new GameError(413, 'That save is too large'); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  // ---- Cover art ----

  const artName = (s) => s.replace(/[&*/:`<>?\\|"]/g, '_');
  async function sendArt(res, game) {
    const lib = await library();
    // A picture next to the game (same name) wins.
    if (game.art) {
      const rel = lib.art.get(lc(game.base));
      if (rel) return sendPlain(res, await resolveFile(rel), 'max-age=3600');
    }
    const sys = SYSTEMS[game.system];
    if (!sys?.art || mock) throw new GameError(404, 'No cover');
    const set = game.system === 'gb' && (game.color || extOf(game.file) === 'gbc') ? 'Nintendo - Game Boy Color' : sys.art;
    const file = path.join(artDir, squash(set), `${idOf(game.base)}.png`);
    const miss = `${file}.miss`;
    if (fs.existsSync(file)) return sendPlain(res, file, 'max-age=604800');
    // Don't keep asking for covers that don't exist (try again after a week).
    const missed = await fsp.stat(miss).catch(() => null);
    if (missed && Date.now() - missed.mtimeMs < 7 * 864e5) throw new GameError(404, 'No cover');
    const names = [game.base, game.base.replace(/\s*\[[^\]]*\]/g, '').trim()];
    for (const n of [...new Set(names)]) {
      try {
        const r = await fetch(`${ART_HOST}/${encodeURIComponent(set)}/Named_Boxarts/${encodeURIComponent(artName(n))}.png`, { signal: AbortSignal.timeout(10e3) });
        if (!r.ok || !/image/.test(r.headers.get('content-type') || 'image/png')) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, buf);
        return sendPlain(res, file, 'max-age=604800');
      } catch { /* offline or blocked: fall back to drawn covers */ }
    }
    await fsp.mkdir(path.dirname(miss), { recursive: true }).catch(() => {});
    await fsp.writeFile(miss, '').catch(() => {});
    throw new GameError(404, 'No cover');
  }

  async function sendPlain(res, abs, cache) {
    const st = await fsp.stat(abs);
    const ext = extOf(abs);
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': `private, ${cache}`, 'X-Content-Type-Options': 'nosniff' });
    await pipeline(fs.createReadStream(abs), res).catch(() => {});
  }

  async function sendRange(req, res, abs) {
    const st = await fsp.stat(abs);
    let start = 0, end = st.size - 1, status = 200;
    const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && st.size) {
      if (range[1] === '') start = Math.max(0, st.size - Number(range[2]));
      else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size ? end - start + 1 : 0;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !st.size) return res.end();
    await pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {});
  }

  // ---- Emulators (downloaded from npm on first use) ----

  const inflight = new Map();
  async function fetchPackage(name) {
    const meta = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, { signal: AbortSignal.timeout(30e3) });
    if (!meta.ok) throw new GameError(502, `Couldn’t download ${name} (npm said HTTP ${meta.status})`);
    const info = await meta.json();
    const v = info.versions?.[EJS_VERSION] || info.versions?.[info['dist-tags']?.latest];
    if (!v) throw new GameError(502, `${name} has no usable version`);
    const tgz = await fetch(v.dist.tarball, { signal: AbortSignal.timeout(300e3) });
    if (!tgz.ok) throw new GameError(502, `Couldn’t download ${name} (HTTP ${tgz.status})`);
    const buf = Buffer.from(await tgz.arrayBuffer());
    if (v.dist.integrity?.startsWith('sha512-')) {
      const got = crypto.createHash('sha512').update(buf).digest('base64');
      if (got !== v.dist.integrity.slice(7)) throw new GameError(502, `${name} failed its integrity check`);
    }
    return untar(zlib.gunzipSync(buf));
  }

  // Minimal tar reader (npm packages: ustar, maybe with pax headers).
  function untar(buf) {
    const out = new Map();
    let paxPath = null;
    for (let p = 0; p + 512 <= buf.length;) {
      const h = buf.subarray(p, p + 512);
      if (h.every((b) => b === 0)) break;
      const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
      const size = parseInt(str(124, 136).trim() || '0', 8);
      const type = String.fromCharCode(h[156] || 48);
      let name = str(0, 100);
      const prefix = str(345, 500);
      if (prefix) name = `${prefix}/${name}`;
      const data = buf.subarray(p + 512, p + 512 + size);
      if (type === 'x') { const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8')); paxPath = m ? m[1] : null; }
      else if (type === '0' || type === '\0') { out.set((paxPath || name).replace(/^package\//, ''), Buffer.from(data)); paxPath = null; }
      else paxPath = null;
      p += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
  }

  async function writeAll(files, filter, destFor) {
    for (const [name, data] of files) {
      if (!filter(name)) continue;
      const dest = destFor(name);
      if (!dest.startsWith(emuDir + path.sep)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(`${dest}.tmp`, data);
      await fsp.rename(`${dest}.tmp`, dest);
    }
  }

  function once(key, fn) {
    if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
    return inflight.get(key);
  }

  const runtimeReady = () => fs.existsSync(path.join(emuDir, 'data', 'emulator.min.js'));
  async function ensureRuntime() {
    if (runtimeReady()) return;
    await once('runtime', async () => {
      const files = await fetchPackage('@emulatorjs/emulatorjs');
      await writeAll(files, (n) => n.startsWith('data/') && !n.startsWith('data/cores/'), (n) => path.join(emuDir, n));
      await writeAll(files, (n) => /^LICENSE/i.test(n), () => path.join(emuDir, 'LICENSE.txt'));
      // EmulatorJS's loader wants single bundled files; join the sources in its load order.
      const order = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js'];
      const js = order.map((f) => files.get(`data/src/${f}`)?.toString('utf8') || '').join('\n;\n');
      // Don't phone home for updates; MediaDesk picks the version.
      const patched = js.replace(/this\.checkForUpdates\(\);/, '/* update check off in MediaDesk */');
      await fsp.writeFile(path.join(emuDir, 'data', 'emulator.min.js'), patched);
      await fsp.copyFile(path.join(emuDir, 'data', 'emulator.css'), path.join(emuDir, 'data', 'emulator.min.css'));
    });
  }

  const coreReady = (core) => fs.existsSync(path.join(emuDir, 'data', 'cores', `${core}-wasm.data`)) || fs.existsSync(path.join(emuDir, 'data', 'cores', `${core}-thread-wasm.data`));
  async function ensureCore(core) {
    if (!ALL_CORES.has(core)) throw new GameError(404, 'Unknown emulator core');
    await ensureRuntime();
    if (coreReady(core)) return;
    await once(`core:${core}`, async () => {
      const files = await fetchPackage(`@emulatorjs/core-${core}`);
      await writeAll(files, (n) => /\.data$/.test(n) || /^reports\/.*\.json$/.test(n), (n) => path.join(emuDir, 'data', 'cores', n));
      const lic = [...files.keys()].find((n) => /^(copying|license)/i.test(n.split('/').pop()));
      if (lic) await writeAll(new Map([[lic, files.get(lic)]]), () => true, () => path.join(emuDir, 'data', 'cores', 'licenses', `${core}.txt`));
    });
  }

  function emulatorStatus() {
    const out = {};
    for (const [id, s] of Object.entries(SYSTEMS)) out[id] = s.cores.map((c) => ({ core: c, ready: coreReady(c) }));
    let bytes = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
    try { walk(emuDir); } catch { /* nothing downloaded yet */ }
    return { version: EJS_VERSION, runtime: runtimeReady(), systems: out, bytes };
  }

  const EMU_TYPES = { js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', data: 'application/octet-stream', svg: 'image/svg+xml', png: 'image/png', txt: 'text/plain' };
  async function serveEmulator(req, res, rel, sendJson) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.some((p) => p === '..' || p.startsWith('.'))) return sendJson(res, 400, { error: 'Invalid path' });
    try {
      const m = /^data\/cores\/(?:reports\/)?([a-z0-9_]+?)(?:-thread)?(?:-legacy)?(?:-wasm\.data|\.json)$/.exec(parts.join('/'));
      if (m) await ensureCore(m[1]);
      else await ensureRuntime();
    } catch (err) {
      return sendJson(res, err.status || 502, { error: `${err.message}. MediaDesk downloads emulators from ${REGISTRY} the first time; check the server’s internet connection.` });
    }
    const abs = path.join(emuDir, ...parts);
    if (!abs.startsWith(emuDir + path.sep) || !fs.existsSync(abs)) return sendJson(res, 404, { error: 'Not found' });
    const st = await fsp.stat(abs);
    res.writeHead(200, { 'Content-Type': EMU_TYPES[extOf(abs)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    await pipeline(fs.createReadStream(abs), res).catch(() => {});
  }

  // ---- HTTP ----

  async function handle(req, res, url, { sendJson, readJson }) {
    const p = url.pathname.replace(/^\/portal\/games/, '') || '/';
    const q = url.searchParams;
    try {
      if (p.startsWith('/emulator/')) return await serveEmulator(req, res, p.slice('/emulator/'.length).replace(/^[^/]+\//, ''), sendJson);
      if (p === '/library' && req.method === 'GET') {
        if (!getFolder() && !mock) return sendJson(res, 200, { configured: false, games: [], bios: [] });
        const lib = await library(q.get('refresh') === '1');
        const s = await readSettings();
        return sendJson(res, 200, {
          configured: true, folder: lib.folder, demo: Boolean(lib.demo), games: lib.games, bios: lib.bios,
          favorites: s.favorites, played: s.played, systems: s.systems, emulator: emulatorStatus(),
        });
      }
      // /file/<path> (the emulator names the game after the end of the address) or /file?path=
      if (p.startsWith('/file') && (req.method === 'GET' || req.method === 'HEAD')) {
        const rel = p.startsWith('/file/') ? decodeURIComponent(p.slice(6)) : q.get('path');
        if (mock && sample) return sample.send(req, res, rel, sendJson);
        return await sendRange(req, res, await resolveFile(rel));
      }
      if (p === '/art' && req.method === 'GET') {
        const { game } = await findGame(q.get('id') || '');
        return await sendArt(res, game);
      }
      if (p === '/settings' && req.method === 'POST') {
        const body = await readJson(req);
        const s = await readSettings();
        if (body.system && SYSTEMS[body.system] && body.values) s.systems[body.system] = cleanSystemSettings(body.system, { ...s.systems[body.system], ...body.values });
        if (typeof body.favorite === 'string' && /^[a-f0-9]{16}$/.test(body.favorite)) {
          s.favorites = s.favorites.filter((x) => x !== body.favorite);
          if (body.on) s.favorites.unshift(body.favorite);
        }
        if (typeof body.played === 'string' && /^[a-f0-9]{16}$/.test(body.played)) {
          const prev = s.played[body.played] || { count: 0, seconds: 0 };
          s.played[body.played] = { at: Date.now(), count: prev.count + (body.start ? 1 : 0), seconds: prev.seconds + Math.max(0, Math.min(86400, Number(body.seconds) || 0)) };
          // Keep the history to the most recent 500 games.
          const keys = Object.keys(s.played).sort((a, b) => s.played[b].at - s.played[a].at);
          for (const k of keys.slice(500)) delete s.played[k];
        }
        await writeSettings(s);
        return sendJson(res, 200, { favorites: s.favorites, played: s.played, systems: s.systems });
      }
      if (p === '/emulator-install' && req.method === 'POST') {
        const { system } = await readJson(req);
        const sys = SYSTEMS[system];
        if (!sys) return sendJson(res, 400, { error: 'Unknown console' });
        const s = await readSettings();
        const core = s.systems[system]?.core || sys.cores[0];
        if (!core) return sendJson(res, 400, { error: 'This console can’t be played in a browser yet' });
        await ensureCore(core);
        return sendJson(res, 200, emulatorStatus());
      }
      if (p === '/emulator-status') return sendJson(res, 200, emulatorStatus());
      if (p === '/emulator-cache' && req.method === 'DELETE') {
        await fsp.rm(path.dirname(emuDir), { recursive: true, force: true });
        return sendJson(res, 200, emulatorStatus());
      }
      const sm = /^\/saves\/([a-f0-9]{16})(?:\/(state|shot|battery)(?:\/(auto|[1-9]))?)?$/.exec(p);
      if (sm) {
        const [, id, kind, slot] = sm;
        const dir = saveDir(id);
        if (!kind && req.method === 'GET') return sendJson(res, 200, await listStates(id));
        if (kind === 'battery') {
          const file = path.join(dir, 'battery.sav');
          if (req.method === 'GET') { if (!fs.existsSync(file)) { res.writeHead(204); return res.end(); } return await sendRange(req, res, file); }
          if (req.method === 'PUT') {
            const data = await readBody(req, 64 * 1024 * 1024);
            await fsp.mkdir(dir, { recursive: true });
            // Keep the previous one, in case a game wipes its own save.
            if (fs.existsSync(file)) await fsp.copyFile(file, `${file}.bak`).catch(() => {});
            await fsp.writeFile(file, data);
            return sendJson(res, 200, { ok: true, size: data.length });
          }
        }
        if ((kind === 'state' || kind === 'shot') && SLOT.test(slot || '')) {
          const file = path.join(dir, `state-${slot}.${kind === 'state' ? 'state' : 'png'}`);
          if (req.method === 'GET') {
            if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Nothing saved in that slot' });
            return kind === 'shot' ? await sendPlain(res, file, 'no-cache') : await sendRange(req, res, file);
          }
          if (req.method === 'PUT') {
            const data = await readBody(req, kind === 'state' ? 256 * 1024 * 1024 : 8 * 1024 * 1024);
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(`${file}.tmp`, data);
            await fsp.rename(`${file}.tmp`, file);
            return sendJson(res, 200, await listStates(id));
          }
          if (req.method === 'DELETE') {
            await fsp.rm(path.join(dir, `state-${slot}.state`), { force: true });
            await fsp.rm(path.join(dir, `state-${slot}.png`), { force: true });
            return sendJson(res, 200, await listStates(id));
          }
        }
      }
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      if (res.headersSent) return res.end();
      return sendJson(res, status, { error: err.message });
    }
  }

  return { handle, library, emulatorStatus, invalidate: () => { cache = null; } };
}

module.exports = { createGames, SYSTEMS, THREADED, EJS_VERSION, cleanTitle, GameError };
