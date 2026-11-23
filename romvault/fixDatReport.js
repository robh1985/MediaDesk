// Ported from RomVault (RVWorld: RomVaultCore/FixDatReport.cs, ReadDat/ExternalDatConverterTo.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: the
// fix DAT is written straight from the database tree as Logiqx XML (RomVault converts to a DatHeader first and
// writes it with DatXMLWriter); MIA flags are not written.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FileType, DatStatus, GotStatus, RepStatus, HeaderFileType } = require('./enums');
const { DatData, GameData } = require('./rvdb');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Writes one fixDat_*.dat per DAT that has missing files. redOnly: leave out files that can be fixed.
// Returns the list of files written.
function recursiveDatTree(outDirectory, tDir, redOnly, out = []) {
  if (!tDir.IsDirectory) return out;
  if (tDir.Dat != null) { extractDat(outDirectory, tDir.Dat, tDir, redOnly, out); return out; }
  for (let i = 0; i < tDir.DirDatCount; i++) extractDat(outDirectory, tDir.dirDat(i), tDir, redOnly, out);
  for (let i = 0; i < tDir.ChildCount; i++) { const c = tDir.child(i); if (c.IsDirectory && c.Dat == null) recursiveDatTree(outDirectory, c, redOnly, out); }
  return out;
}

function isMissing(f, redOnly) {
  return f.DatStatus === DatStatus.InDatCollect && f.GotStatus !== GotStatus.Got &&
    (!redOnly || !(f.RepStatus === RepStatus.CanBeFixed || f.RepStatus === RepStatus.CorruptCanBeFixed));
}

// Collects { gameName, game, roms: [{ name, file }] } for one DAT.
function collect(rvDat, dir, redOnly, prefix, games, currentGame) {
  for (let i = 0; i < dir.ChildCount; i++) {
    const c = dir.child(i);
    if (c.Dat !== rvDat) continue;
    if (c.IsDirectory) {
      if (c.Game != null || c.FileType !== FileType.Dir) {
        let name = c.Name;
        if (c.FileType === FileType.Zip) name = name.slice(0, -4); else if (c.FileType === FileType.SevenZip) name = name.slice(0, -3);
        const g = { gameName: prefix + name, game: c.Game, roms: [] };
        collect(rvDat, c, redOnly, '', null, g);
        if (g.roms.length) games.push(g);
      } else if (currentGame) collect(rvDat, c, redOnly, prefix + c.Name + '/', games, currentGame);
      else collect(rvDat, c, redOnly, prefix + c.Name + '/', games, null);
      continue;
    }
    if (!isMissing(c, redOnly)) continue;
    if (currentGame) currentGame.roms.push({ name: prefix + c.Name, file: c });
    else {
      // FixSingleLevelDat: a loose file becomes a game named after it
      const gameName = prefix + path.parse(c.Name).name;
      let g = games.find((x) => x.gameName === gameName);
      if (!g) { g = { gameName, game: null, roms: [] }; games.push(g); }
      g.roms.push({ name: c.Name, file: c });
    }
  }
}

function extractDat(outDirectory, rvDat, tDir, redOnly, out) {
  const games = [];
  collect(rvDat, tDir, redOnly, '', games, null);
  if (!games.length) return;
  const name = rvDat.getData(DatData.DatName) || '';
  const desc = rvDat.getData(DatData.Description) || name;
  const lines = ['<?xml version="1.0"?>', '<datafile>', '\t<header>',
    `\t\t<name>${esc('FixDat_' + name)}</name>`, `\t\t<description>${esc('FixDat_' + desc)}</description>`];
  for (const [k, tag] of [[DatData.Category, 'category'], [DatData.Version, 'version']]) { const v = rvDat.getData(k); if (v) lines.push(`\t\t<${tag}>${esc(v)}</${tag}>`); }
  lines.push(`\t\t<date>${new Date().toISOString().slice(0, 10)}</date>`, '\t\t<author>RomVault</author>', '\t</header>');
  for (const g of games) {
    const gd = (id) => g.game?.getData(id);
    const attrs = [`name="${esc(g.gameName)}"`];
    if (gd(GameData.CloneOf)) attrs.push(`cloneof="${esc(gd(GameData.CloneOf))}"`);
    if (gd(GameData.RomOf)) attrs.push(`romof="${esc(gd(GameData.RomOf))}"`);
    lines.push(`\t<machine ${attrs.join(' ')}>`);
    let d = gd(GameData.Description);
    if (d === '¤' || !d) d = g.gameName;
    lines.push(`\t\t<description>${esc(d)}</description>`);
    if (gd(GameData.Year)) lines.push(`\t\t<year>${esc(gd(GameData.Year))}</year>`);
    if (gd(GameData.Manufacturer)) lines.push(`\t\t<manufacturer>${esc(gd(GameData.Manufacturer))}</manufacturer>`);
    for (const r of g.roms) {
      const f = r.file;
      const disk = f.HeaderFileType === HeaderFileType.CHD;
      const useAlt = f.AltMD5 != null || f.AltSHA1 != null;
      const size = useAlt ? f.AltSize : f.Size; const crc = useAlt ? f.AltCRC : f.CRC; const sha1 = useAlt ? f.AltSHA1 : f.SHA1; const md5 = useAlt ? f.AltMD5 : f.MD5;
      const a = [`name="${esc(disk ? r.name.replace(/\.chd$/i, '') : r.name)}"`];
      if (!disk && size != null) a.push(`size="${size}"`);
      if (!disk && crc) a.push(`crc="${crc}"`);
      if (sha1) a.push(`sha1="${sha1}"`);
      if (md5) a.push(`md5="${md5}"`);
      if (f.Merge) a.push(`merge="${esc(disk ? f.Merge.replace(/\.chd$/i, '') : f.Merge)}"`);
      if (f.Status) a.push(`status="${esc(f.Status)}"`);
      lines.push(`\t\t<${disk ? 'disk' : 'rom'} ${a.join(' ')}/>`);
    }
    lines.push('\t</machine>');
  }
  lines.push('</datafile>', '');
  const datFullName = rvDat.getData(DatData.DatRootFullName) || name;
  const rel = datFullName.replace(/^DatRoot\\?/, '');
  const datDir = rel.includes('\\') ? rel.substring(0, rel.lastIndexOf('\\')).replace(/\\/g, '_') : '';
  const datName = path.parse(rel.split('\\').pop()).name;
  fs.mkdirSync(outDirectory, { recursive: true });
  let file = path.join(outDirectory, `fixDat_${datDir}_${datName}.dat`);
  for (let n = 1; fs.existsSync(file); n++) file = path.join(outDirectory, `fixDat_${datDir}_${datName}(${n}).dat`);
  fs.writeFileSync(file, lines.join('\n'));
  out.push(file);
}

module.exports = { recursiveDatTree };
