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
const { bestMatch, indexNames } = require('./artmatch');

const EJS_VERSION = '4.2.3';
const REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const ART_HOST = 'https://thumbnails.libretro.com';
// Console photos for the console sections: public-domain pictures on Wikimedia Commons (most by
// Evan Amos), downloaded the first time a console's section is opened and kept. The first title
// that exists is used; failing those, a search for the console's photos by Evan Amos.
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_UA = 'MediaDesk/1.0 (self-hosted media portal; https://github.com/robh1985/MediaDesk)';
const CONSOLE_PHOTOS = {
  nes: ['NES-Console-Set.jpg', 'NES-Console-Set.png'],
  snes: ['SNES-Mod1-Console-Set.jpg', 'Nintendo-Super-Famicom-Set-FL.jpg'],
  n64: ['N64-Console-Set.jpg', 'Nintendo-64-wController-L.jpg'],
  gb: ['Game-Boy-FL.jpg', 'Nintendo-Game-Boy-Color-FL.jpg'],
  gba: ['Nintendo-Game-Boy-Advance-Purple-FL.jpg', 'Game-Boy-Advance-Purple-FL.jpg'],
  nds: ['Nintendo-DS-Fat-Blue.jpg', 'Nintendo-DS-Lite-Black-Open.jpg'],
  vb: ['Virtual-Boy-Set.jpg', 'Virtual-Boy-wController.jpg'],
  segaMD: ['Sega-Genesis-Mod1-Set.jpg', 'Sega-Mega-Drive-JP-Mk1-Console-Set.jpg'],
  segaMS: ['Sega-Master-System-Set.jpg', 'Sega-Master-System-II-wController-L.jpg'],
  segaGG: ['Game-Gear-Handheld.jpg', 'Sega-Game-Gear-WB.png'],
  segaCD: ['Sega-CD-Model1-Set.jpg', 'Sega-CD-Model2-Set.jpg'],
  sega32x: ['Sega-Genesis-Model2-32X.jpg', 'Sega-32X-Mod1-Set.jpg'],
  segaSaturn: ['Sega-Saturn-Console-Set-Mk1.jpg', 'Sega-Saturn-JP-Mk1-Console-Set.jpg'],
  dreamcast: ['Dreamcast-Console-Set.png', 'Dreamcast-Console-Set.jpg'],
  psx: ['PSX-Console-wController.jpg', 'PlayStation-SCPH-1000-with-Controller.jpg'],
  psp: ['Sony-PSP-1000-Body.png', 'PSP-1000.jpg'],
  pce: ['TurboGrafx16-Console-Set.jpg', 'PC-Engine-Console-Set.png'],
  atari2600: ['Atari-2600-Wood-4Sw-Set.jpg', 'Atari-2600-Wood-4Sw-Console-Set.jpg'],
  atari5200: ['Atari-5200-4-Port-wController-L.jpg', 'Atari-5200-Console-Set.jpg'],
  atari7800: ['Atari-7800-Console-Set.jpg', 'Atari-7800-Console-wController-FL.jpg'],
  lynx: ['Atari-Lynx-I-Handheld.jpg', 'Atari-Lynx-II-Handheld-Angled.jpg'],
  jaguar: ['Atari-Jaguar-Console-Set.jpg', 'Atari-Jaguar-Console-wController-FL.jpg'],
  ngp: ['Neo-Geo-Pocket-Color-Blue-Left.jpg', 'Neo-Geo-Pocket-Color-Blue.jpg'],
  ws: ['WonderSwan-Color-Blue-Left.jpg', 'WonderSwan-Color-Blue.jpg'],
  coleco: ['ColecoVision-wController-L.jpg', 'ColecoVision-Console-Set.jpg'],
  '3do': ['3DO-FZ1-Console-Set.jpg', 'Panasonic-FZ-1-3DO.jpg'],
  arcade: [],
};
const PHOTO_SEARCH = {
  nes: 'Nintendo Entertainment System console', snes: 'Super Nintendo console', n64: 'Nintendo 64 console', gb: 'Game Boy', gba: 'Game Boy Advance', nds: 'Nintendo DS',
  vb: 'Virtual Boy', segaMD: 'Sega Genesis console', segaMS: 'Sega Master System', segaGG: 'Game Gear', segaCD: 'Sega CD', sega32x: 'Sega 32X', segaSaturn: 'Sega Saturn',
  dreamcast: 'Dreamcast console', psx: 'PlayStation console', psp: 'PlayStation Portable', pce: 'TurboGrafx-16 console', atari2600: 'Atari 2600', atari5200: 'Atari 5200',
  atari7800: 'Atari 7800', lynx: 'Atari Lynx', jaguar: 'Atari Jaguar console', ngp: 'Neo Geo Pocket Color', ws: 'WonderSwan Color', coleco: 'ColecoVision', '3do': '3DO console',
};
// Your own pictures: what the first bytes of a picture look like.
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

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
  dreamcast: { ext: ['gdi', 'cdi'], alias: ['dreamcast', 'dc', 'segadreamcast'], cores: ['flycast'], art: 'Sega - Dreamcast', disc: true },
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
// Cores that don't come from EmulatorJS: Flycast for the Dreamcast is the WebAssembly build by
// Nick Somers (https://github.com/nasomers/flycast-wasm, GPL-2.0), downloaded from its GitHub
// release the first time a Dreamcast game is played and checked against these hashes.
// MediaDesk packs it the way EmulatorJS packs its own cores (a zip with core.json).
const EXTERNAL_CORES = {
  flycast: {
    name: 'Flycast (flycast-wasm)',
    base: 'https://github.com/nasomers/flycast-wasm/releases/download/v1.0',
    license: 'https://raw.githubusercontent.com/nasomers/flycast-wasm/v1.0/LICENSE',
    repo: 'https://github.com/nasomers/flycast-wasm',
    files: {
      'flycast_libretro.js': '1f2ae9afafa85c8ff577ca3961be0343c2ac394ddc79285981f0d55ad75dbd7b',
      'flycast_libretro.wasm': 'db2b87d8d2742087a56c4eeed317da14e3549ee037e36de3d77c1e6e5291bead',
    },
    core: { name: 'flycast', extensions: ['cdi', 'gdi', 'chd', 'cue', 'iso', 'elf', 'bin', 'lst', 'zip', '7z', 'dat'], options: {}, save: 'state', license: 'GPLv2', repo: 'https://github.com/nasomers/flycast-wasm' },
    build: { minimumEJSVersion: '4.0.0', version: '1.0' },
    // Flycast draws with WebGL 2, so EmulatorJS must not fall back to its WebGL 1 build.
    report: { options: { defaultWebGL2: true } },
    // This build has no zip library, and opening a zip stops the emulator outright. MediaDesk
    // makes "open a zip" fail cleanly instead, so Flycast reports the problem (a zipped game, for
    // example) rather than crashing. Changing this changes `patch` below.
    patch: 1,
    patchFile(name, buf) {
      if (name !== 'flycast_libretro.js') return buf;
      let js = buf.toString('utf8');
      for (const fn of ['zip_source_buffer_create', 'zip_source_filep_create', 'zip_open_from_source']) {
        js = js.replace(`function _${fn}(){abort("missing function: ${fn}")}`, `function _${fn}(){return 0}`);
      }
      return Buffer.from(js, 'utf8');
    },
  },
};

// Cores that need SharedArrayBuffer (and so a cross-origin isolated page).
const THREADED = new Set(['ppsspp']);

const EXT_TO_SYSTEM = new Map();
for (const [id, s] of Object.entries(SYSTEMS)) for (const e of s.ext) EXT_TO_SYSTEM.set(e, id);
// The games folder's own layout (see README): ROMS, BIOS, Saves and Box Art, each with a folder
// per console under these names. Disc games get a folder of their own inside their console's.
const FOLDER_NAMES = {
  nes: 'NES', snes: 'SNES', n64: 'N64', gb: 'Game Boy', gba: 'Game Boy Advance', nds: 'Nintendo DS', vb: 'Virtual Boy',
  segaMS: 'Master System', segaMD: 'Genesis', segaCD: 'Sega CD', sega32x: '32X', segaGG: 'Game Gear', segaSaturn: 'Saturn', dreamcast: 'Dreamcast',
  psx: 'PlayStation', psp: 'PSP', pce: 'TurboGrafx-16', atari2600: 'Atari 2600', atari5200: 'Atari 5200', atari7800: 'Atari 7800', lynx: 'Lynx',
  jaguar: 'Jaguar', ngp: 'Neo Geo Pocket', ws: 'WonderSwan', coleco: 'ColecoVision', '3do': '3DO', arcade: 'Arcade',
};
const LAYOUT = { roms: 'ROMS', bios: 'BIOS', saves: 'Saves', art: 'Box Art' };
const ALIAS_TO_SYSTEM = new Map();
for (const [id, s] of Object.entries(SYSTEMS)) for (const a of s.alias) ALIAS_TO_SYSTEM.set(a, id);
for (const [id, name] of Object.entries(FOLDER_NAMES)) if (!ALIAS_TO_SYSTEM.has(name.toLowerCase().replace(/[^a-z0-9]/g, ''))) ALIAS_TO_SYSTEM.set(name.toLowerCase().replace(/[^a-z0-9]/g, ''), id);
const BIOS_DIRS = new Set(['bios', 'system', 'firmware', 'biosfiles']);
const AMBIGUOUS = new Set(['bin', 'iso', 'img', 'cue', 'chd', 'm3u', 'zip', '7z', 'ccd', 'mds', 'rom', 'elf']);
const ART_EXT = ['png', 'jpg', 'jpeg', 'webp'];
// Files that can be a game in a console's folder (track files and the like are left out).
const PLAYABLE = new Set(['cue', 'gdi', 'cdi', 'chd', 'iso', 'pbp', 'cso', 'm3u', 'ccd', 'mds', 'img', 'bin', 'zip', '7z', 'elf', 'rom']);
// A cover picture inside a game's own folder.
const FOLDER_ART = /^(cover|boxart|box|front|folder)\.(png|jpe?g|webp)$/i;
// Names that work as file and folder names on Windows, macOS and Linux.
const safeName = (n) => String(n || 'Game').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 150) || 'Game';
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

// A console from a folder name ("SNES", "Super Nintendo", "Nintendo - Game Boy" ...).
function systemFromFolder(name) {
  const d = squash(name || '');
  if (ALIAS_TO_SYSTEM.has(d)) return ALIAS_TO_SYSTEM.get(d);
  for (const [alias, id] of ALIAS_TO_SYSTEM) if (alias.length > 5 && d.includes(alias)) return id;
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

// A zip of the given files (deflated), for EmulatorJS to unpack in the browser.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = zlib.crc32 || ((buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; });
function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

function createGames({ dataDir, getFolder, mock = false, sample = null }) {
  const gamesData = path.join(dataDir, 'games');
  const savesDir = path.join(gamesData, 'saves');
  const artDir = path.join(gamesData, 'art');
  const customDir = path.join(gamesData, 'custom-art');     // your own box art and console pictures
  const photoDir = path.join(gamesData, 'console-photos');  // downloaded console photos
  const settingsFile = path.join(gamesData, 'settings.json');
  const emuDir = path.join(dataDir, 'emulator', EJS_VERSION);
  let cache = null; // { folder, at, games, bios }
  let scanning = null;

  // everything: the whole folder, even with the layout (to move games into it).
  async function scan(everything = false) {
    const folder = getFolder();
    if (!folder) return { folder: '', games: [], bios: [], art: new Map() };
    const root = path.resolve(folder);
    const st = await fsp.stat(root).catch(() => null);
    if (!st?.isDirectory()) throw new GameError(404, `The games folder ${root} can’t be found on the MediaDesk server`);
    const files = [];
    const art = new Map(); // lower-case base name -> rel path of a picture
    const folderArt = new Map(); // a game folder's rel path -> its cover picture
    let count = 0;
    // The folder's own layout, when it has a ROMS folder (names in any letter case).
    const top = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    const findDir = (n) => top.find((e) => e.isDirectory() && lc(e.name) === lc(n))?.name || null;
    const dirs = { roms: findDir(LAYOUT.roms), bios: findDir(LAYOUT.bios), saves: findDir(LAYOUT.saves), art: findDir(LAYOUT.art) };
    const structured = Boolean(dirs.roms);
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || count > 50000) continue;
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < 8 && !(depth === 0 && dirs.saves && e.name === dirs.saves)) await walk(abs, r, depth + 1); continue; }
        if (!e.isFile() && !e.isSymbolicLink()) continue;
        count++;
        const ext = extOf(e.name);
        if (ART_EXT.includes(ext)) {
          if (FOLDER_ART.test(e.name)) folderArt.set(rel, r);
          art.set(lc(e.name.slice(0, -(ext.length + 1))), r);
          continue;
        }
        if (!SERVE_EXT.has(ext) && !KNOWN_BIOS[lc(e.name)]) continue;
        files.push({ abs, rel: r, name: e.name, ext });
      }
    };
    if (structured && !everything) {
      for (const d of [dirs.roms, dirs.bios, dirs.art]) if (d) await walk(path.join(root, d), d, 1);
    } else await walk(root, '', 0);

    const consumed = new Set();
    for (const f of files) if (['cue', 'gdi', 'm3u'].includes(f.ext)) for (const r of await referencedFiles(f.abs, f.ext)) consumed.add(r);
    // In the layout, a game folder (ROMS/<console>/<game>/) holding one game takes its name from
    // the folder; holding several (the discs of one game), each disc keeps its file's name.
    const isPlayable = (f) => EXT_TO_SYSTEM.has(f.ext) || PLAYABLE.has(f.ext);
    const gameFolderOf = (parts) => (structured && parts[0] === dirs.roms && parts.length >= 4 ? parts.slice(0, 3).join('/') : null);
    const perFolder = new Map();
    for (const f of files) {
      const gf = gameFolderOf(f.rel.split('/'));
      if (gf && !consumed.has(f.abs) && isPlayable(f) && !KNOWN_BIOS[lc(f.name)]) perFolder.set(gf, (perFolder.get(gf) || 0) + 1);
    }
    const games = [], bios = [];
    for (const f of files) {
      if (consumed.has(f.abs)) continue;
      const parts = f.rel.split('/');
      const known = KNOWN_BIOS[lc(f.name)];
      if (structured && parts[0] === dirs.bios) {
        bios.push({ path: f.rel, name: f.name, system: (parts.length > 2 && systemFromFolder(parts[1])) || known || null });
        continue;
      }
      if (structured && parts[0] !== dirs.roms && (!everything || parts[0] === dirs.art)) continue;
      const consoleSys = structured && parts.length > 2 ? systemFromFolder(parts[1]) : null;
      const hint = consoleSys || hintFromDirs(parts);
      if (hint === 'bios' || (known && !EXT_TO_SYSTEM.has(f.ext))) { bios.push({ path: f.rel, name: f.name, system: known || null }); continue; }
      let system = EXT_TO_SYSTEM.get(f.ext) || null;
      let guessed = false;
      const size = (await fsp.stat(f.abs).catch(() => ({ size: 0 }))).size;
      // In a console's folder, that console (unless the file type can only be another one's).
      if (consoleSys && !system) {
        if (!isPlayable(f)) continue;
        system = consoleSys;
      }
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
      const fileBase = f.name.slice(0, f.name.length - (f.ext.length + 1));
      const gf = gameFolderOf(parts);
      const folderName = gf ? gf.split('/').pop() : null;
      const base = gf && perFolder.get(gf) === 1 ? folderName : fileBase;
      const { title, tags } = cleanTitle(base);
      const pic = art.get(lc(base)) || (gf && folderArt.get(parts.slice(0, -1).join('/'))) || null;
      if (pic && !art.has(lc(base))) art.set(lc(base), pic);
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
        // Where its saves and box art go in the layout: Saves/<console>/<saveFolder>/<saveName> - …
        saveFolder: folderName || fileBase, saveName: base, fileBase,
      });
    }
    games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
    return { folder: root, games, bios, art, structured, dirs };
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
    settingsCache.systems ||= {}; settingsCache.favorites ||= []; settingsCache.played ||= {}; settingsCache.art ||= {};
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
    if (['auto', 'photo', 'drawn', 'custom', 'none'].includes(v.background)) out.background = v.background;
    if (Number.isInteger(v.backgroundV)) out.backgroundV = v.backgroundV;
    return out;
  }

  // ---- Save states and battery saves ----

  const saveDir = (id) => path.join(savesDir, id.replace(/[^a-f0-9]/g, ''));
  const SLOT = /^(auto|[1-9])$/;
  const SLOTS = ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  // Saves kept with MediaDesk's settings (no layout, or a folder MediaDesk can't write to).
  const LEGACY_NAMES = { battery: 'battery.sav', backup: 'battery.sav.bak', state: (n) => `state-${n}.state`, shot: (n) => `state-${n}.png` };
  // Saves in the games folder: Saves/<console>/<game>/<game> - Save slot 1.state and so on.
  const folderNames = (game) => {
    const n = safeName(game.saveName);
    const slot = (x) => (x === 'auto' ? 'Auto save' : `Save slot ${x}`);
    return { battery: `${n} - Battery save.sav`, backup: `${n} - Battery save (previous).sav`, state: (x) => `${n} - ${slot(x)}.state`, shot: (x) => `${n} - ${slot(x)} (picture).png` };
  };
  const writable = new Map(); // folder -> { ok, at }
  async function canWrite(dir) {
    const c = writable.get(dir);
    if (c && Date.now() - c.at < 60e3) return c.ok;
    let ok = false;
    try { await fsp.mkdir(dir, { recursive: true }); await fsp.access(dir, fs.constants.W_OK); ok = true; } catch { ok = false; }
    writable.set(dir, { ok, at: Date.now() });
    return ok;
  }
  const savesRoot = (lib) => path.join(lib.folder, lib.dirs?.saves || LAYOUT.saves);
  // Where a game's saves are, and what they're called. Saves made before the layout (kept with
  // MediaDesk's settings) move across the first time; `legacyId` is the game's id from before
  // its files were moved into the layout.
  async function savePlace(id, legacyId = id) {
    const lib = await library();
    const game = lib.games.find((g) => g.id === id);
    if (!lib.structured || !game || mock || !(await canWrite(savesRoot(lib)))) return { dir: saveDir(id), names: LEGACY_NAMES, inFolder: false };
    const dir = path.join(savesRoot(lib), safeName(FOLDER_NAMES[game.system] || game.system), safeName(game.saveFolder));
    const names = folderNames(game);
    const old = saveDir(legacyId);
    if (fs.existsSync(old)) {
      await fsp.mkdir(dir, { recursive: true });
      const pairs = [[LEGACY_NAMES.battery, names.battery], [LEGACY_NAMES.backup, names.backup], ...SLOTS.flatMap((x) => [[LEGACY_NAMES.state(x), names.state(x)], [LEGACY_NAMES.shot(x), names.shot(x)]])];
      for (const [a, b] of pairs) {
        const from = path.join(old, a);
        if (fs.existsSync(from) && !fs.existsSync(path.join(dir, b))) await fsp.copyFile(from, path.join(dir, b));
      }
      await fsp.rm(old, { recursive: true, force: true });
    }
    return { dir, names, inFolder: true };
  }
  async function listStates(id) {
    const { dir, names } = await savePlace(id);
    const out = [];
    for (const x of SLOTS) {
      const st = await fsp.stat(path.join(dir, names.state(x))).catch(() => null);
      if (!st) continue;
      out.push({ slot: x, at: st.mtimeMs, size: st.size, shot: fs.existsSync(path.join(dir, names.shot(x))) });
    }
    const sram = await fsp.stat(path.join(dir, names.battery)).catch(() => null);
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
  // Box art you chose (or "no picture") comes first.
  async function findCustom(name) {
    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
      const f = path.join(customDir, `${name}.${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
  async function saveCustom(name, buf) {
    const type = imageType(buf);
    if (!type) throw new GameError(415, 'That isn’t a picture MediaDesk can use (PNG, JPEG, WebP or GIF)');
    await fsp.mkdir(customDir, { recursive: true });
    for (const ext of ['png', 'jpg', 'webp', 'gif']) await fsp.rm(path.join(customDir, `${name}.${ext}`), { force: true });
    await fsp.writeFile(path.join(customDir, `${name}.${type}`), buf);
  }
  async function removeCustom(name) {
    for (const ext of ['png', 'jpg', 'webp', 'gif']) await fsp.rm(path.join(customDir, `${name}.${ext}`), { force: true });
  }
  // In the layout, box art you choose is kept as Box Art/<console>/<game>.png.
  async function layoutArtBase(game) {
    const lib = await library();
    if (!lib.structured || mock) return null;
    const dir = path.join(lib.folder, lib.dirs.art || LAYOUT.art, safeName(FOLDER_NAMES[game.system] || game.system));
    return (await canWrite(dir)) ? path.join(dir, safeName(game.saveName)) : null;
  }
  async function saveGameArt(game, buf) {
    const base = await layoutArtBase(game);
    if (!base) return saveCustom(`game-${game.id}`, buf);
    const type = imageType(buf);
    if (!type || type === 'gif') throw new GameError(415, 'That isn’t a picture MediaDesk can use (PNG, JPEG or WebP)');
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) await fsp.rm(`${base}.${ext}`, { force: true });
    await fsp.writeFile(`${base}.${type}`, buf);
    await removeCustom(`game-${game.id}`);
    cache = null;
  }
  async function removeGameArt(game) {
    await removeCustom(`game-${game.id}`);
    const base = await layoutArtBase(game);
    if (base) { for (const ext of ['png', 'jpg', 'jpeg', 'webp']) await fsp.rm(`${base}.${ext}`, { force: true }); cache = null; }
  }
  const libretroFile = (game) => {
    const sys = SYSTEMS[game.system];
    const set = game.system === 'gb' && (game.color || extOf(game.file) === 'gbc') ? 'Nintendo - Game Boy Color' : sys?.art;
    return set ? path.join(artDir, squash(set), `${idOf(game.base)}.png`) : null;
  };

  async function sendArt(res, game) {
    const prefs = (await readSettings()).art[game.id] || {};
    if (prefs.none) throw new GameError(404, 'No cover');
    const mine = await findCustom(`game-${game.id}`);
    if (mine) return sendPlain(res, mine, 'max-age=31536000');
    const lib = await library();
    // The layout's Box Art/<console>/<game> picture.
    if (lib.structured && !mock) {
      const b = path.join(lib.folder, lib.dirs.art || LAYOUT.art, safeName(FOLDER_NAMES[game.system] || game.system), safeName(game.saveName));
      for (const ext of ['png', 'jpg', 'jpeg', 'webp']) if (fs.existsSync(`${b}.${ext}`)) return sendPlain(res, `${b}.${ext}`, 'no-cache');
    }
    // A picture next to the game (same name) wins.
    if (game.art) {
      const rel = lib.art.get(lc(game.base));
      if (rel) return sendPlain(res, await resolveFile(rel), 'max-age=3600');
    }
    const sys = SYSTEMS[game.system];
    if (!sys?.art || mock) throw new GameError(404, 'No cover');
    const set = game.system === 'gb' && (game.color || extOf(game.file) === 'gbc') ? 'Nintendo - Game Boy Color' : sys.art;
    const file = libretroFile(game);
    const miss = `${file}.nomatch`;
    if (fs.existsSync(file)) return sendPlain(res, file, 'max-age=604800');
    // Don't keep asking for covers that don't exist (try again after a week).
    const missed = await fsp.stat(miss).catch(() => null);
    if (missed && Date.now() - missed.mtimeMs < 7 * 864e5) throw new GameError(404, 'No cover');
    // The closest name in libretro's list for this console, then the game's own names as they are.
    const index = await artIndex(set);
    const match = index ? bestMatch(index, [...new Set([game.base, game.fileBase || game.base])]) : null;
    const names = [match, game.base, game.base.replace(/\s*\[[^\]]*\]/g, '').trim(), game.fileBase].filter(Boolean);
    for (const n of [...new Set(names)]) {
      try {
        // From libretro's thumbnail server, or the same picture from its GitHub repository.
        let buf = null;
        for (const url of [`${ART_HOST}/${encodeURIComponent(set)}/Named_Boxarts/${encodeURIComponent(artName(n))}.png`,
          `https://raw.githubusercontent.com/libretro-thumbnails/${encodeURIComponent(set.replace(/ /g, '_'))}/master/Named_Boxarts/${encodeURIComponent(artName(n))}.png`]) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(15e3) });
            if (!r.ok || !/image|text\/plain/.test(r.headers.get('content-type') || 'image/png')) continue;
            let b = Buffer.from(await r.arrayBuffer());
            // In the repository, some pictures are links: the file holds the real picture's name.
            for (let hop = 0; hop < 2 && !imageType(b) && b.length < 512 && /\.png\s*$/i.test(b.toString('utf8')); hop++) {
              const target = b.toString('utf8').trim().split('/').pop();
              const r2 = await fetch(url.slice(0, url.lastIndexOf('/') + 1) + encodeURIComponent(target), { signal: AbortSignal.timeout(15e3) });
              if (!r2.ok) break;
              b = Buffer.from(await r2.arrayBuffer());
            }
            if (imageType(b)) { buf = b; break; }
          } catch { /* the next one */ }
        }
        if (!buf) continue;
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, buf);
        return sendPlain(res, file, 'max-age=604800');
      } catch { /* offline or blocked: fall back to drawn covers */ }
    }
    await fsp.mkdir(path.dirname(miss), { recursive: true }).catch(() => {});
    await fsp.writeFile(miss, '').catch(() => {});
    throw new GameError(404, 'No cover');
  }

  // libretro-thumbnails' list of box art names for a console, kept for a month.
  const indexes = new Map(); // set -> { at, index } or a pending promise
  async function artIndex(set) {
    const mem = indexes.get(set);
    if (mem && !(mem instanceof Promise) && Date.now() - mem.at < 864e5) return mem.index;
    if (mem instanceof Promise) return mem;
    const work = (async () => {
      const file = path.join(artDir, squash(set), 'boxart-names.json');
      const st = await fsp.stat(file).catch(() => null);
      let names = null;
      if (st && Date.now() - st.mtimeMs < 30 * 864e5) names = JSON.parse(await fsp.readFile(file, 'utf8').catch(() => 'null'));
      if (!names) {
        try {
          const r = await fetch(`${ART_HOST}/${encodeURIComponent(set)}/Named_Boxarts/`, { signal: AbortSignal.timeout(30e3) });
          if (r.ok) {
            const html = await r.text();
            names = [...new Set([...html.matchAll(/href="([^"?#]+?)\.png"/gi)].map((m) => { try { return decodeURIComponent(m[1]).split('/').pop(); } catch { return null; } }).filter(Boolean))];
            if (names.length) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(names)); }
          }
        } catch { /* try GitHub */ }
        // The same names from libretro-thumbnails' repository on GitHub.
        if (!names?.length) {
          try {
            const api = `https://api.github.com/repos/libretro-thumbnails/${encodeURIComponent(set.replace(/ /g, '_'))}/git/trees`;
            const opts = { headers: { Accept: 'application/vnd.github+json', 'User-Agent': COMMONS_UA }, signal: AbortSignal.timeout(30e3) };
            const root = await (await fetch(`${api}/HEAD`, opts)).json();
            const sha = root.tree?.find((t) => t.path === 'Named_Boxarts')?.sha;
            if (sha) {
              const tree = await (await fetch(`${api}/${sha}`, opts)).json();
              names = (tree.tree || []).map((t) => t.path).filter((n) => /\.png$/i.test(n)).map((n) => n.slice(0, -4));
              if (names.length) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(names)); }
            }
          } catch { /* offline: try the game's own names */ }
        }
        // An older list is better than none.
        if (!names?.length && st) names = JSON.parse(await fsp.readFile(file, 'utf8').catch(() => 'null'));
      }
      const index = names?.length ? indexNames(names) : null;
      indexes.set(set, { at: index ? Date.now() : Date.now() - 864e5 + 10 * 60e3, index });
      return index;
    })();
    indexes.set(set, work);
    return work;
  }

  // ---- Console pictures ----

  const photoPending = new Map();
  async function consolePhoto(system) {
    const meta = path.join(photoDir, `${system}.json`);
    try {
      const info = JSON.parse(await fsp.readFile(meta, 'utf8'));
      if (info.file && fs.existsSync(path.join(photoDir, info.file))) return info;
      if (info.missed && Date.now() - info.missed < 864e5) return null;
    } catch { /* not fetched yet */ }
    if (!photoPending.has(system)) photoPending.set(system, downloadPhoto(system, meta).finally(() => photoPending.delete(system)));
    return photoPending.get(system);
  }
  async function commons(params) {
    const r = await fetch(`${COMMONS}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: { 'User-Agent': COMMONS_UA }, signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`Wikimedia Commons: HTTP ${r.status}`);
    return r.json();
  }
  async function downloadPhoto(system, meta) {
    await fsp.mkdir(photoDir, { recursive: true });
    const ii = { prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '1600' };
    const free = (p) => {
      const info = p?.imageinfo?.[0];
      const lic = stripHtml(info?.extmetadata?.LicenseShortName?.value);
      return info && /^image\/(jpeg|png|webp)$/.test(info.mime || '') && /public domain|^pd|cc0|cc[- ]by/i.test(lic) ? info : null;
    };
    let pages = [];
    try {
      const titles = (CONSOLE_PHOTOS[system] || []).map((t) => `File:${t}`);
      if (titles.length) {
        const j = await commons({ action: 'query', titles: titles.join('|'), ...ii });
        // Keep the order of the list (the API doesn't).
        const norm = (t) => t.replace(/_/g, ' ');
        pages = titles.map((t) => (j.query?.pages || []).find((p) => norm(p.title) === norm(t))).filter((p) => free(p));
      }
      if (!pages.length && PHOTO_SEARCH[system]) {
        const j = await commons({ action: 'query', generator: 'search', gsrsearch: `${PHOTO_SEARCH[system]} Evan-Amos`, gsrnamespace: '6', gsrlimit: '6', ...ii });
        pages = (j.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).filter((p) => free(p) && /evan/i.test(stripHtml(p.imageinfo[0].extmetadata?.Artist?.value)));
      }
      for (const p of pages) {
        const info = free(p);
        const r = await fetch(info.thumburl || info.url, { headers: { 'User-Agent': COMMONS_UA }, signal: AbortSignal.timeout(30e3) });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const type = imageType(buf);
        if (!type || buf.length > 15 * 1024 * 1024) continue;
        const file = `${system}.${type}`;
        await fsp.writeFile(path.join(photoDir, file), buf);
        const md = info.extmetadata || {};
        const out = { file, title: p.title, credit: stripHtml(md.Artist?.value) || 'Wikimedia Commons', license: stripHtml(md.LicenseShortName?.value), page: info.descriptionurl, at: Date.now() };
        await fsp.writeFile(meta, JSON.stringify(out));
        return out;
      }
    } catch { /* offline or blocked: the app draws the console instead */ }
    await fsp.writeFile(meta, JSON.stringify({ missed: Date.now() })).catch(() => {});
    return null;
  }

  async function sendPlain(res, abs, cache) {
    const st = await fsp.stat(abs);
    const ext = extOf(abs);
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'application/octet-stream';
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

  // A core from its own project's release (see EXTERNAL_CORES): download, check, pack.
  async function fetchExternalCore(core) {
    const ext = EXTERNAL_CORES[core];
    const entries = [];
    for (const [file, sha] of Object.entries(ext.files)) {
      const res = await fetch(`${ext.base}/${file}`, { signal: AbortSignal.timeout(300e3), redirect: 'follow' });
      if (!res.ok) throw new GameError(502, `Couldn’t download ${ext.name} (GitHub said HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) throw new GameError(502, `${ext.name} failed its integrity check (${file} isn’t the expected file)`);
      entries.push([file, ext.patchFile ? ext.patchFile(file, buf) : buf]);
    }
    let license = `${ext.name} is licensed under the GNU General Public License, version 2. Source: ${ext.repo}\n`;
    try {
      const res = await fetch(ext.license, { signal: AbortSignal.timeout(30e3) });
      if (res.ok) license = await res.text();
    } catch { /* keep the short notice */ }
    entries.push(['core.json', Buffer.from(JSON.stringify(ext.core))], ['build.json', Buffer.from(JSON.stringify(ext.build))], ['license.txt', Buffer.from(license)]);
    const coresDir = path.join(emuDir, 'data', 'cores');
    // The report's buildStart is EmulatorJS's cache key for the core: the files' hashes.
    const report = { ...ext.report, buildStart: parseInt(crypto.createHash('sha1').update(`${Object.values(ext.files).join()}|${ext.patch || 0}`).digest('hex').slice(0, 12), 16) };
    await writeAll(new Map([
      [`${core}-wasm.data`, makeZip(entries)],
      [`reports/${core}.json`, Buffer.from(JSON.stringify(report))],
      [`licenses/${core}.txt`, Buffer.from(license)],
    ]), () => true, (n) => path.join(coresDir, n));
  }

  async function ensureCore(core) {
    if (!ALL_CORES.has(core)) throw new GameError(404, 'Unknown emulator core');
    await ensureRuntime();
    if (coreReady(core)) return;
    if (EXTERNAL_CORES[core]) { await once(`core:${core}`, () => fetchExternalCore(core)); return; }
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
    const m = /^data\/cores\/(?:reports\/)?([a-z0-9_]+?)(?:-thread)?(?:-legacy)?(?:-wasm\.data|\.json)$/.exec(parts.join('/'));
    try {
      if (m) await ensureCore(m[1]);
      else await ensureRuntime();
    } catch (err) {
      return sendJson(res, err.status || 502, { error: `${err.message}. MediaDesk downloads emulators from ${m && EXTERNAL_CORES[m[1]] ? 'github.com' : REGISTRY} the first time; check the server’s internet connection.` });
    }
    // Cores from elsewhere come in one build: asked for its threaded or WebGL 1 variant, send that.
    const variant = /^data\/cores\/([a-z0-9_]+?)(?:-thread)?(?:-legacy)?-wasm\.data$/.exec(parts.join('/'));
    if (variant && EXTERNAL_CORES[variant[1]]) parts.splice(0, parts.length, 'data', 'cores', `${variant[1]}-wasm.data`);
    const abs = path.join(emuDir, ...parts);
    if (!abs.startsWith(emuDir + path.sep) || !fs.existsSync(abs)) return sendJson(res, 404, { error: 'Not found' });
    const st = await fsp.stat(abs);
    res.writeHead(200, { 'Content-Type': EMU_TYPES[extOf(abs)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    await pipeline(fs.createReadStream(abs), res).catch(() => {});
  }

  // ---- The folder layout ----

  // Make ROMS, BIOS, Saves and Box Art, with a folder for each console in ROMS and BIOS.
  async function setupLayout() {
    const folder = getFolder();
    if (!folder || mock) throw new GameError(400, 'Choose the games folder first');
    const root = path.resolve(folder);
    const top = await fsp.readdir(root, { withFileTypes: true }).catch(() => { throw new GameError(404, `The games folder ${root} can’t be found`); });
    const existing = (n) => top.find((e) => e.isDirectory() && lc(e.name) === lc(n))?.name || n;
    const biosConsoles = new Set([...Object.values(KNOWN_BIOS), 'psx', 'segaCD', 'segaSaturn', 'dreamcast', '3do', 'nds', 'gba', 'atari5200', 'lynx', 'coleco', 'pce']);
    try {
      for (const [id, name] of Object.entries(FOLDER_NAMES)) {
        await fsp.mkdir(path.join(root, existing(LAYOUT.roms), name), { recursive: true });
        if (biosConsoles.has(id)) await fsp.mkdir(path.join(root, existing(LAYOUT.bios), name), { recursive: true });
      }
      await fsp.mkdir(path.join(root, existing(LAYOUT.saves)), { recursive: true });
      await fsp.mkdir(path.join(root, existing(LAYOUT.art)), { recursive: true });
    } catch (err) {
      throw new GameError(403, `MediaDesk can’t make folders in ${root} (${err.code === 'EROFS' ? 'it’s read-only' : err.code || err.message}). Give it permission to write there.`);
    }
    writable.clear();
    cache = null;
  }

  // Move games, their track files and pictures, and BIOS files found elsewhere in the games folder
  // into the layout; their saves, favourites, play history and box art go with them.
  async function organize() {
    await setupLayout();
    const before = await scan(true);
    const root = before.folder;
    const romsDir = before.dirs.roms || LAYOUT.roms;
    const biosDir = before.dirs.bios || LAYOUT.bios;
    const artDir2 = before.dirs.art || LAYOUT.art;
    const inside = (rel, d) => lc(rel.split('/')[0]) === lc(d);
    const moved = [];
    const skipped = [];
    const emptied = new Set();
    const move = async (from, to) => {
      if (from === to) return;
      await fsp.mkdir(path.dirname(to), { recursive: true });
      try { await fsp.rename(from, to); } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fsp.copyFile(from, to);
        await fsp.rm(from);
      }
      emptied.add(path.dirname(from));
    };
    for (const g of before.games) {
      if (inside(g.path, romsDir)) continue;
      const primary = path.join(root, ...g.path.split('/'));
      const all = [primary, ...(g.parts || []).map((r) => path.join(root, ...r.split('/')))];
      const baseDir = path.dirname(primary);
      if (all.some((f) => path.relative(baseDir, f).startsWith('..'))) { skipped.push({ path: g.path, reason: 'its track files are in another folder' }); continue; }
      const consoleDir = path.join(root, romsDir, FOLDER_NAMES[g.system] || g.system);
      const disc = SYSTEMS[g.system]?.disc && (g.parts?.length || ['cue', 'gdi', 'cdi', 'chd', 'iso', 'pbp', 'cso', 'm3u', 'ccd', 'mds', 'img', 'bin'].includes(extOf(g.file)));
      const target = disc ? path.join(consoleDir, safeName(g.title)) : consoleDir;
      const dest = all.map((f) => path.join(target, path.relative(baseDir, f)));
      if (dest.some((d, i) => d !== all[i] && fs.existsSync(d))) { skipped.push({ path: g.path, reason: 'a file with the same name is already there' }); continue; }
      try {
        for (let i = 0; i < all.length; i++) await move(all[i], dest[i]);
      } catch (err) { skipped.push({ path: g.path, reason: err.message }); continue; }
      const newRel = path.relative(root, dest[0]).split(path.sep).join('/');
      moved.push({ oldId: g.id, newRel, system: g.system });
      // Its picture (same name, next to it or in a covers folder) goes to Box Art.
      const pic = g.art ? before.art.get(lc(g.base)) : null;
      if (pic && !inside(pic, artDir2) && !inside(pic, romsDir)) {
        const from = path.join(root, ...pic.split('/'));
        const to = path.join(root, artDir2, FOLDER_NAMES[g.system] || g.system, `${safeName(disc ? g.title : g.base)}.${extOf(pic)}`);
        if (!fs.existsSync(to)) await move(from, to).catch(() => {});
      }
    }
    let biosMoved = 0;
    for (const b of before.bios) {
      // Into BIOS/<console>/ (one already in its console's folder, or of no known console, stays).
      if (inside(b.path, biosDir) && (b.path.split('/').length > 2 || !b.system)) continue;
      const to = path.join(root, biosDir, ...(b.system ? [FOLDER_NAMES[b.system] || b.system] : []), b.name);
      if (fs.existsSync(to)) continue;
      try { await move(path.join(root, ...b.path.split('/')), to); biosMoved++; } catch { /* leave it */ }
    }
    // Folders left empty go (never the games folder itself or the layout's folders).
    const keep = new Set([root, ...[romsDir, biosDir, artDir2, LAYOUT.saves].map((d) => path.join(root, d))]);
    for (const d of [...emptied].sort((a, b) => b.length - a.length)) {
      let cur = d;
      while (cur.startsWith(root + path.sep) && !keep.has(cur)) {
        try { await fsp.rmdir(cur); } catch { break; }
        cur = path.dirname(cur);
      }
    }
    // The games' new places: carry over saves, favourites, play history and box art choices.
    const after = await library(true);
    const s = await readSettings();
    const remap = new Map();
    for (const m of moved) {
      const g = after.games.find((x) => x.path === m.newRel);
      if (!g) continue;
      remap.set(m.oldId, g.id);
      await savePlace(g.id, m.oldId).catch(() => {});
      const mine = await findCustom(`game-${m.oldId}`);
      if (mine) { await saveGameArt(g, await fsp.readFile(mine)).catch(() => {}); await removeCustom(`game-${m.oldId}`); }
    }
    s.favorites = s.favorites.map((id) => remap.get(id) || id);
    for (const [from, to] of remap) {
      if (s.played[from]) { s.played[to] = s.played[from]; delete s.played[from]; }
      if (s.art[from]) { s.art[to] = { ...s.art[from], v: Date.now() }; delete s.art[from]; }
    }
    for (const sys of Object.values(s.systems)) {
      if (sys.bios && !after.bios.some((b) => b.path === sys.bios)) {
        const name = sys.bios.split('/').pop();
        const found = after.bios.find((b) => b.name === name);
        if (found) sys.bios = found.path;
      }
    }
    await writeSettings(s);
    cache = null;
    return { moved: moved.length, skipped, bios: biosMoved };
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
          favorites: s.favorites, played: s.played, systems: s.systems, emulator: emulatorStatus(), artPrefs: s.art,
          layout: lib.structured ? { dirs: lib.dirs, savesInFolder: !mock && await canWrite(savesRoot(lib)) } : null,
          folderNames: FOLDER_NAMES,
        });
      }
      if (p === '/layout' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.organize) return sendJson(res, 200, await organize());
        await setupLayout();
        return sendJson(res, 200, { ok: true });
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
      // Your own box art: PUT the picture; DELETE goes back to the downloaded / folder one.
      if (p === '/art' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const { game } = await findGame(q.get('id') || '');
        const s = await readSettings();
        if (req.method === 'PUT') await saveGameArt(game, await readBody(req, 15 * 1024 * 1024));
        else await removeGameArt(game);
        s.art[game.id] = { ...s.art[game.id], none: false, v: Date.now() };
        await writeSettings(s);
        return sendJson(res, 200, { art: s.art });
      }
      // How box art is shown: fit (whole picture) or fill (cropped), what's behind it, none at
      // all, or fetch the downloaded one again.
      if (p === '/art-settings' && req.method === 'POST') {
        const body = await readJson(req);
        const { game } = await findGame(String(body.id || ''));
        const s = await readSettings();
        const cur = { ...s.art[game.id] };
        if (['fit', 'fill'].includes(body.fit)) cur.fit = body.fit;
        if (['blur', 'console', 'black', 'white'].includes(body.bg)) cur.bg = body.bg;
        if (typeof body.none === 'boolean') cur.none = body.none;
        if (body.refetch) {
          const f = libretroFile(game);
          if (f) { await fsp.rm(f, { force: true }); await fsp.rm(`${f}.nomatch`, { force: true }); }
          await removeGameArt(game);
          cur.none = false;
        }
        cur.v = Date.now();
        s.art[game.id] = cur;
        await writeSettings(s);
        return sendJson(res, 200, { art: s.art });
      }
      // Console pictures: /console-art/<console>?kind=photo|custom, /console-art/<console>/photo
      // (downloads it if need be; says who took it), PUT / DELETE your own.
      const cm = /^\/console-art\/([A-Za-z0-9]+)(\/photo)?$/.exec(p);
      if (cm && SYSTEMS[cm[1]]) {
        const system = cm[1];
        if (cm[2]) {
          const info = await consolePhoto(system);
          return sendJson(res, 200, info ? { ok: true, credit: info.credit, license: info.license, page: info.page, v: info.at } : { ok: false });
        }
        if (req.method === 'GET') {
          if (q.get('kind') === 'custom') {
            const f = await findCustom(`console-${system}`);
            if (!f) return sendJson(res, 404, { error: 'No picture' });
            return await sendPlain(res, f, 'max-age=31536000');
          }
          const info = await consolePhoto(system);
          if (!info) return sendJson(res, 404, { error: 'No photo' });
          return await sendPlain(res, path.join(photoDir, info.file), 'max-age=31536000');
        }
        if (req.method === 'PUT' || req.method === 'DELETE') {
          const s = await readSettings();
          if (req.method === 'PUT') await saveCustom(`console-${system}`, await readBody(req, 15 * 1024 * 1024));
          else await removeCustom(`console-${system}`);
          const cur = s.systems[system] || {};
          s.systems[system] = cleanSystemSettings(system, { ...cur, background: req.method === 'PUT' ? 'custom' : 'auto', backgroundV: Date.now() });
          await writeSettings(s);
          return sendJson(res, 200, { systems: s.systems });
        }
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
        const { dir, names } = await savePlace(id);
        if (!kind && req.method === 'GET') return sendJson(res, 200, await listStates(id));
        if (kind === 'battery') {
          const file = path.join(dir, names.battery);
          if (req.method === 'GET') { if (!fs.existsSync(file)) { res.writeHead(204); return res.end(); } return await sendRange(req, res, file); }
          if (req.method === 'PUT') {
            const data = await readBody(req, 64 * 1024 * 1024);
            await fsp.mkdir(dir, { recursive: true });
            // Keep the previous one, in case a game wipes its own save.
            if (fs.existsSync(file)) await fsp.copyFile(file, path.join(dir, names.backup)).catch(() => {});
            await fsp.writeFile(file, data);
            return sendJson(res, 200, { ok: true, size: data.length });
          }
        }
        if ((kind === 'state' || kind === 'shot') && SLOT.test(slot || '')) {
          const file = path.join(dir, kind === 'state' ? names.state(slot) : names.shot(slot));
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
            await fsp.rm(path.join(dir, names.state(slot)), { force: true });
            await fsp.rm(path.join(dir, names.shot(slot)), { force: true });
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
