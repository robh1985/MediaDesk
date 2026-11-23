// Demo collection for ROM Manager (node server.js --mock): three small made-up DATs, and ROM and ToSort folders
// with something of every kind in them: complete sets, a misnamed file, files to fix from ToSort, a headered NES
// dump, parent/clone/BIOS sets, an unknown file and a damaged ZIP. The "ROMs" are a few hundred bytes of
// generated data, made fresh at every start.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { ZipWriter } = require('./romvault/compress/zip');
const { crc32, hex8 } = require('./romvault/compress/common');
const { ZipStructure, FileType, MergeType } = require('./romvault/enums');

const bytes = (seed, size) => {
  const out = Buffer.alloc(size);
  let block = Buffer.alloc(0); let i = 0;
  for (let p = 0; p < size; p++) { if (i >= block.length) { block = crypto.createHash('sha256').update(`${seed}:${p}`).digest(); i = 0; } out[p] = block[i++]; }
  return out;
};
const info = (buf) => ({ size: buf.length, crc: hex8(crc32(buf)), sha1: crypto.createHash('sha1').update(buf).digest('hex'), md5: crypto.createHash('md5').update(buf).digest('hex') });

// A TorrentZip with the given [name, data] entries (sorted the TorrentZip way: case-insensitive).
async function zipOf(file, list) {
  const w = await ZipWriter.create(file, ZipStructure.ZipTrrnt);
  for (const [name, buf] of [...list].sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1))) {
    await w.addEntry({ name, size: buf.length, method: 8, source: Readable.from([buf]) });
  }
  await w.close();
}

async function createDemo(base) {
  const root = path.join(base, 'demo');
  await fsp.rm(root, { recursive: true, force: true });
  const dats = path.join(root, 'DATs'); const roms = path.join(root, 'ROMs'); const tosort = path.join(root, 'ToSort');
  for (const d of [path.join(dats, 'Nintendo'), path.join(dats, 'Arcade'), roms, tosort]) await fsp.mkdir(d, { recursive: true });
  const x = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // Game Boy (Logiqx XML, like No-Intro).
  const gb = ['Alpha Quest (USA)', 'Bravo Racing (Europe)', 'Comet Puzzle (Japan)', 'Delta Force Kids (USA)', 'Echo Island (USA, Europe)', 'Fox Run (World)'];
  const gbData = gb.map((g, i) => bytes(`gb${i}`, 512 + i * 64));
  await fsp.writeFile(path.join(dats, 'Nintendo', 'Nintendo - Game Boy (Demo).dat'), [
    '<?xml version="1.0"?>', '<datafile>', '\t<header>', '\t\t<name>Nintendo - Game Boy (Demo)</name>', '\t\t<description>Nintendo - Game Boy (Demo)</description>', '\t\t<version>20261123</version>', '\t\t<author>MediaDesk demo</author>', '\t</header>',
    ...gb.map((g, i) => { const h = info(gbData[i]); return `\t<game name="${x(g)}">\n\t\t<description>${x(g)}</description>\n\t\t<rom name="${x(g)}.gb" size="${h.size}" crc="${h.crc}" md5="${h.md5}" sha1="${h.sha1}"/>\n\t</game>`; }),
    '</datafile>', ''].join('\n'));
  const gbDir = path.join(roms, 'Nintendo', 'Nintendo - Game Boy (Demo)');
  await fsp.mkdir(gbDir, { recursive: true });
  await zipOf(path.join(gbDir, `${gb[0]}.zip`), [[`${gb[0]}.gb`, gbData[0]]]);
  await zipOf(path.join(gbDir, `${gb[1]}.zip`), [[`${gb[1]}.gb`, gbData[1]]]);
  await zipOf(path.join(gbDir, `${gb[2]}.zip`), [['comet.gb', gbData[2]]]);                  // wrong name inside
  await fsp.writeFile(path.join(tosort, 'delta.gb'), gbData[3]);                             // loose in ToSort
  await zipOf(path.join(tosort, 'stuff.zip'), [['echo.bin', gbData[4]], ['notes.txt', Buffer.from('not a ROM')]]);
  await fsp.writeFile(path.join(gbDir, 'broken.zip'), bytes('broken', 300));                 // damaged
  // Fox Run is missing.

  // NES (No-Intro lists the data without the 16-byte iNES header).
  const nes = ['Gamma Ball (USA)', 'Hyper Jump (Japan)'];
  const nesData = nes.map((g, i) => bytes(`nes${i}`, 1024));
  await fsp.writeFile(path.join(dats, 'Nintendo', 'Nintendo - NES (Demo).dat'), [
    '<?xml version="1.0"?>', '<datafile>', '\t<header>', '\t\t<name>Nintendo - NES (Demo)</name>', '\t\t<description>Nintendo - Entertainment System (Demo, headerless)</description>', '\t\t<version>20261123</version>', '\t\t<clrmamepro header="No-Intro_NES.xml"/>', '\t</header>',
    ...nes.map((g, i) => { const h = info(nesData[i]); return `\t<game name="${x(g)}">\n\t\t<description>${x(g)}</description>\n\t\t<rom name="${x(g)}.nes" size="${h.size}" crc="${h.crc}" sha1="${h.sha1}"/>\n\t</game>`; }),
    '</datafile>', ''].join('\n'));
  const ines = Buffer.concat([Buffer.from('NES\x1a\x02\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1'), nesData[0]]);
  await fsp.writeFile(path.join(tosort, 'gamma ball.nes'), ines);

  // Arcade (ClrMamePro text DAT with a BIOS, a parent and a clone).
  const r = (s, n) => bytes(`arc-${s}`, n);
  const files = { bios1: r('bios1', 256), bios2: r('bios2', 256), prog: r('prog', 768), gfx: r('gfx', 640), snd: r('snd', 384), progj: r('progj', 768), cometp: r('cometp', 900) };
  const rom = (name, key, extra = '') => { const h = info(files[key]); return `\trom ( name ${name} size ${h.size} crc ${h.crc} sha1 ${h.sha1}${extra} )`; };
  await fsp.writeFile(path.join(dats, 'Arcade', 'Demo Arcade.dat'), [
    'clrmamepro (', '\tname "Demo Arcade"', '\tdescription "Demo Arcade (parent, clone and BIOS)"', '\tversion 0.270', '\tforcemerging split', ')', '',
    'resource (', '\tname demobios', '\tdescription "Demo BIOS"', rom('bios-a.bin', 'bios1'), rom('bios-b.bin', 'bios2'), ')', '',
    'game (', '\tname blaster', '\tdescription "Blaster (World)"', '\tyear 1987', '\tmanufacturer "Demo Games"', '\tromof demobios', rom('bios-a.bin', 'bios1', ' merge bios-a.bin'), rom('bios-b.bin', 'bios2', ' merge bios-b.bin'), rom('prog.bin', 'prog'), rom('gfx.bin', 'gfx'), rom('snd.bin', 'snd'), ')', '',
    'game (', '\tname blasterj', '\tdescription "Blaster (Japan)"', '\tyear 1987', '\tmanufacturer "Demo Games"', '\tcloneof blaster', '\tromof blaster', rom('bios-a.bin', 'bios1', ' merge bios-a.bin'), rom('bios-b.bin', 'bios2', ' merge bios-b.bin'), rom('progj.bin', 'progj'), rom('gfx.bin', 'gfx', ' merge gfx.bin'), rom('snd.bin', 'snd', ' merge snd.bin'), ')', '',
    'game (', '\tname comet', '\tdescription "Comet Patrol"', '\tyear 1989', rom('comet.bin', 'cometp'), ')', ''].join('\n'));
  const arc = path.join(roms, 'Arcade');
  await fsp.mkdir(arc, { recursive: true });
  await zipOf(path.join(arc, 'blaster.zip'), [['prog.bin', files.prog], ['gfx.bin', files.gfx], ['snd.bin', files.snd]]);
  await zipOf(path.join(arc, 'blasterj.zip'), [['progj.bin', files.progj], ['gfx.bin', files.gfx], ['snd.bin', files.snd]]); // parent's files too
  await zipOf(path.join(arc, 'demobios.zip'), [['bios-a.bin', files.bios1]]);
  await fsp.writeFile(path.join(tosort, 'bios-b.bin'), files.bios2);
  await fsp.writeFile(path.join(arc, 'old-readme.txt'), 'Nothing asked for this file.\n');
  // comet is missing.

  return {
    datRoot: dats, romRoot: roms, toSort: tosort,
    rules: [{ DirKey: 'RomVault\\Arcade', Compression: FileType.Zip, CompressionSub: ZipStructure.ZipTrrnt, Merge: MergeType.Split, MergeOverrideDAT: true }],
  };
}

module.exports = { createDemo };
