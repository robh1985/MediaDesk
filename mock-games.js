// Demo-mode game library for The Game Console: one real (tiny) NES cartridge that MediaDesk
// builds itself — the screen changes colour with each button, handy for checking controller
// mappings — plus sample titles for the other consoles so every screen has something to show.

'use strict';

const crypto = require('node:crypto');

// 6502 code: read controller 1 and set the backdrop colour to one per button (none: light blue).
const CODE = '78d8a2ff9aa9008d00208d01202c022010fb2c022010fba9018d1640a9008d1640a208a9008500ad16404a2600cad0f7a000a500f00c0ab003c8d0fab966c04c44c0a92185012c022010fba93f8d0620a9008d0620a5018d0720a9008d06208d06204c17c040162a282411001a27';
const VECTORS = '65c000c065c0';

function testCart() {
  const prg = Buffer.alloc(0x4000, 0xea);
  Buffer.from(CODE, 'hex').copy(prg, 0);
  Buffer.from(VECTORS, 'hex').copy(prg, 0x3ffa);
  return Buffer.concat([Buffer.from([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), prg, Buffer.alloc(0x2000)]);
}

const SAMPLES = {
  nes: ['Pixel Knight', 'Moon Courier', 'Brick Garden', 'Turbo Tanuki', 'Castle of Echoes'],
  snes: ['Sky Rails', 'Chrono Garden', 'Super Bean Bros.', 'Mana Lantern', 'Rocket Raccoon Racing'],
  n64: ['Kart Canyon 64', 'Star Pilots', 'Wildwood Adventure', 'Golden Lens'],
  segaMD: ['Sonic Dash Zone', 'Streets of Neon', 'Ecco Reef', 'Thunder Blade X'],
  psx: ['Final Odyssey VII', 'Crash Bay', 'Metal Shadow', 'Ridge Runner Type 4'],
  gb: ['Pocket Monsters Mint', 'Tetromino', 'Link’s Little Dream'],
  gba: ['Metroid Drift', 'Golden Sun Rise', 'Advance Wars Lite'],
  segaGG: ['Columns Deluxe', 'Shinobi Shade'],
  segaMS: ['Alex Kid Again', 'Phantasy Path'],
  nds: ['Dual Screen Detective', 'Nintendogs & Cats'],
  pce: ['Bonk’s Head', 'Blazing Lazers II'],
  atari2600: ['Pitfall Trail', 'Space Invaders Redux'],
  segaSaturn: ['Panzer Sky', 'Nights in Dreams'],
  arcade: ['Street Brawler II', 'Metal Slug Squad', 'Galaxian Returns'],
  dreamcast: ['Crazy Cab', 'Jet Set Rollers', 'Soul Blade Calibur'],
};
const EXT = { nes: 'nes', snes: 'sfc', n64: 'z64', segaMD: 'md', psx: 'chd', gb: 'gbc', gba: 'gba', segaGG: 'gg', segaMS: 'sms', nds: 'nds', pce: 'pce', atari2600: 'a26', segaSaturn: 'chd', arcade: 'zip', dreamcast: 'gdi' };
const id = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);

function createSample() {
  const cart = testCart();
  const cartEntry = { id: id('NES/Controller Test Cart.nes'), path: 'NES/Controller Test Cart.nes', file: 'Controller Test Cart.nes', base: 'Controller Test Cart', title: 'Controller Test Cart', tags: ['MediaDesk'], system: 'nes', size: cart.length };
  const games = [cartEntry];
  for (const [system, titles] of Object.entries(SAMPLES)) {
    for (const t of titles) {
      const rel = `${system}/${t} (USA).${EXT[system]}`;
      games.push({ id: id(rel), path: rel, file: `${t} (USA).${EXT[system]}`, base: `${t} (USA)`, title: t, tags: ['USA'], system, size: 1 << 20, sample: true });
    }
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  const lib = { folder: '(demo games)', demo: true, games, bios: [{ path: 'BIOS/scph5501.bin', name: 'scph5501.bin', system: 'psx' }], art: new Map(), at: Date.now() };
  const sample = () => lib;
  sample.send = (req, res, rel, sendJson) => {
    if (rel !== cartEntry.path) return sendJson(res, 404, { error: 'This is a sample entry in demo mode — add your own games to play them' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': cart.length });
    return res.end(req.method === 'HEAD' ? undefined : cart);
  };
  return sample;
}

module.exports = { createSample, testCart };
