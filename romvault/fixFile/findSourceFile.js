// Ported from RomVault (RVWorld: RomVaultCore/FixFile/FixAZipCore/FindSourceFile.cs) by Gordon J. Licensed under
// Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: an unstructured
// or ZipDTD/ZipDTZ zip source is ranked verified when deep scanned (RomVault has the two the wrong way round).
'use strict';

const { FileType, GotStatus, ZipStructure, EFixLevel } = require('../enums');
const { state } = require('../settings');
const { DBHelper } = require('../rvdb');
const { FixStyle } = require('./utils');

const S = {}; [
  'ZipTrrnt_V', 'ZipTrrnt_U', 'ZipTDC_V', 'ZipTDC_U', 'ZipZSTD_V', 'ZipZSTD_U', 'Zip_V', 'Zip_U',
  'SevenZipSLZMA_V_MF', 'SevenZipSLZMA_U_MF', 'SevenZipSLZMA_V_SF', 'SevenZipSLZMA_U_SF', 'SevenZipNLZMA_V', 'SevenZipNLZMA_U',
  'SevenZipSZSTD_V_MF', 'SevenZipSZSTD_U_MF', 'SevenZipSZSTD_V_SF', 'SevenZipSZSTD_U_SF', 'SevenZipNZSTD_V', 'SevenZipNZSTD_U',
  'SevenZipTrrnt_V_MF', 'SevenZipTrrnt_U_MF', 'SevenZipTrrnt_V_SF', 'SevenZipTrrnt_U_SF', 'SevenZip_V_MF', 'SevenZip_U_MF', 'SevenZip_V_SF', 'SevenZip_U_SF', 'File_V',
].forEach((n) => { S[n] = n; });
const D = { ZipTrrnt: 'ZipTrrnt', ZipTDC: 'ZipTDC', ZipZSTD: 'ZipZSTD', Zip: 'Zip', SevenZipNLZMA: 'SevenZipNLZMA', SevenZipSLZMA_SF: 'SevenZipSLZMA_SF', SevenZipSLZMA_MF: 'SevenZipSLZMA_MF', SevenZipNZSTD: 'SevenZipNZSTD', SevenZipSZSTD_SF: 'SevenZipSZSTD_SF', SevenZipSZSTD_MF: 'SevenZipSZSTD_MF', File: 'File' };

// RomVault's MasterPriorityList, written as [source, style] runs. R = RawCopy, V = RawCopyOnceVerified,
// C = Compress, X = DecompressRecompress, E = ExtractToCache.
const st = { R: FixStyle.RawCopy, V: FixStyle.RawCopyOnceVerified, C: FixStyle.Compress, X: FixStyle.DecompressRecompress, E: FixStyle.ExtractToCache };
const tail7zMF = 'E:SevenZipSZSTD_V_MF,SevenZipSZSTD_U_MF,SevenZipSLZMA_V_MF,SevenZipSLZMA_U_MF,SevenZipTrrnt_V_MF,SevenZipTrrnt_U_MF,SevenZip_V_MF,SevenZip_U_MF';
const zstdX = 'X:ZipZSTD_V,SevenZipNZSTD_V,SevenZipSZSTD_V_SF,ZipZSTD_U,SevenZipNZSTD_U,SevenZipSZSTD_U_SF';
const tzipX = 'X:ZipTrrnt_V,ZipTDC_V,ZipTrrnt_U,ZipTDC_U,Zip_V,Zip_U';
const lzmaX = 'X:SevenZipSLZMA_V_SF,SevenZipNLZMA_V,SevenZipSLZMA_U_SF,SevenZipNLZMA_U';
const t7zX = 'X:SevenZipTrrnt_V_SF,SevenZipTrrnt_U_SF,SevenZip_V_SF,SevenZip_U_SF';
const Master = {
  [D.ZipTrrnt]: ['R:ZipTrrnt_V,ZipTDC_V', 'V:ZipTrrnt_U,ZipTDC_U', 'C:File_V', zstdX, 'X:Zip_V,Zip_U', lzmaX, t7zX, tail7zMF],
  [D.ZipTDC]: ['R:ZipTDC_V,ZipTrrnt_V', 'V:ZipTDC_U,ZipTrrnt_U', 'C:File_V', zstdX, 'X:Zip_V,Zip_U', lzmaX, t7zX, tail7zMF],
  [D.ZipZSTD]: ['R:ZipZSTD_V,SevenZipNZSTD_V,SevenZipSZSTD_V_SF', 'V:ZipZSTD_U,SevenZipNZSTD_U,SevenZipSZSTD_U_SF', 'C:File_V', tzipX, lzmaX, t7zX, tail7zMF],
  [D.Zip]: ['R:Zip_V,ZipTDC_V,ZipTrrnt_V,ZipZSTD_V', 'V:Zip_U,ZipTDC_U,ZipTrrnt_U,ZipZSTD_U', 'C:File_V', 'X:SevenZipNZSTD_V,SevenZipSZSTD_V_SF,SevenZipNZSTD_U,SevenZipSZSTD_U_SF', lzmaX, t7zX, tail7zMF],
  [D.SevenZipNLZMA]: ['R:SevenZipSLZMA_V_SF,SevenZipNLZMA_V', 'V:SevenZipSLZMA_U_SF,SevenZipNLZMA_U', 'C:File_V', zstdX, tzipX, t7zX, tail7zMF],
  [D.SevenZipSLZMA_SF]: ['R:SevenZipSLZMA_V_SF,SevenZipNLZMA_V', 'V:SevenZipSLZMA_U_SF,SevenZipNLZMA_U', 'C:File_V', zstdX, tzipX, t7zX, tail7zMF],
  [D.SevenZipSLZMA_MF]: ['C:File_V', zstdX, tzipX, lzmaX, t7zX, tail7zMF],
  [D.SevenZipNZSTD]: ['R:ZipZSTD_V,SevenZipNZSTD_V,SevenZipSZSTD_V_SF', 'V:ZipZSTD_U,SevenZipNZSTD_U,SevenZipSZSTD_U_SF', 'C:File_V', tzipX, lzmaX, t7zX, tail7zMF],
  [D.SevenZipSZSTD_SF]: ['R:ZipZSTD_V,SevenZipNZSTD_V,SevenZipSZSTD_V_SF', 'V:ZipZSTD_U,SevenZipNZSTD_U,SevenZipSZSTD_U_SF', 'C:File_V', tzipX, lzmaX, t7zX, tail7zMF],
  [D.SevenZipSZSTD_MF]: ['C:File_V', zstdX, tzipX, lzmaX, t7zX, tail7zMF],
  [D.File]: ['C:File_V', zstdX, tzipX, lzmaX, t7zX, tail7zMF],
};
// FixOrderPriority / FixOrderStyle: dest -> source -> { p, s }
const FixOrder = {};
for (const [dest, runs] of Object.entries(Master)) {
  FixOrder[dest] = {};
  let i = 0;
  for (const run of runs) {
    const [k, list] = run.split(':');
    for (const src of list.split(',')) { FixOrder[dest][src] = { p: i++, s: st[k] }; }
  }
}

function getFixFileList(fixFile) {
  return fixFile.FileGroup.Files.filter((f) => f.GotStatus === GotStatus.Got && DBHelper.checkIfMissingFileCanBeFixedByGotFile(fixFile, f));
}

function getDestinationFileType(parent, file) {
  if (file.FileType === FileType.File) return D.File;
  if (file.FileType === FileType.FileZip || file.FileType === FileType.FileSevenZip) {
    let zs = parent.newZipStruct;
    if (parent.FileType === FileType.SevenZip && (zs === ZipStructure.None || zs === ZipStructure.SevenZipTrrnt)) zs = state.rvSettings.default7ZStruct;
    switch (zs) {
      case ZipStructure.None: case ZipStructure.ZipDTD: case ZipStructure.ZipDTZ: return D.Zip;
      case ZipStructure.ZipTrrnt: return D.ZipTrrnt;
      case ZipStructure.ZipTDC: return D.ZipTDC;
      case ZipStructure.ZipZSTD: return D.ZipZSTD;
      case ZipStructure.SevenZipSLZMA: return D.SevenZipSLZMA_MF;
      case ZipStructure.SevenZipNLZMA: return D.SevenZipNLZMA;
      case ZipStructure.SevenZipSZSTD: return D.SevenZipSZSTD_MF;
      case ZipStructure.SevenZipNZSTD: return D.SevenZipNZSTD;
      default: throw new Error(`Cannot figure out fix file type ${parent.ZipDatStruct}`);
    }
  }
  throw new Error(`Cannot figure out fix file type ${file.FileType}`);
}

function isSingleFile(dir) {
  let n = 0;
  for (let i = 0; i < dir.ChildCount; i++) {
    const g = dir.child(i).GotStatus;
    if (g !== GotStatus.Got && g !== GotStatus.Corrupt) continue;
    if (++n > 1) return false;
  }
  return n === 1;
}

function getSourceFileType(file) {
  const v = file.IsDeepScanned;
  const zs = file.Parent.ZipStruct;
  switch (file.FileType) {
    case FileType.File: return S.File_V;
    case FileType.FileZip:
      if (zs === ZipStructure.ZipTrrnt) return v ? S.ZipTrrnt_V : S.ZipTrrnt_U;
      if (zs === ZipStructure.ZipTDC) return v ? S.ZipTDC_V : S.ZipTDC_U;
      if (zs === ZipStructure.ZipZSTD) return v ? S.ZipZSTD_V : S.ZipZSTD_U;
      return v ? S.Zip_V : S.Zip_U;
    case FileType.FileSevenZip: {
      const sf = isSingleFile(file.Parent);
      const pick = (base, single) => S[`${base}_${v ? 'V' : 'U'}${single ? (sf ? '_SF' : '_MF') : ''}`];
      if (zs === ZipStructure.SevenZipSLZMA) return pick('SevenZipSLZMA', true);
      if (zs === ZipStructure.SevenZipNLZMA) return pick('SevenZipNLZMA', false);
      if (zs === ZipStructure.SevenZipSZSTD) return pick('SevenZipSZSTD', true);
      if (zs === ZipStructure.SevenZipNZSTD) return pick('SevenZipNZSTD', false);
      if (zs === ZipStructure.SevenZipTrrnt) return pick('SevenZipTrrnt', true);
      return pick('SevenZip', true);
    }
    default: throw new Error(`Cannot figure out fix file type ${file.FileType}`);
  }
}

// Returns { files: RvFile[], fixStyle }
function findSourceToUseForFix(fixZip, fixZippedFile, fixFiles) {
  if (DBHelper.isZeroLengthFile(fixZippedFile)) return { files: [], fixStyle: FixStyle.Zero };
  const dest = getDestinationFileType(fixZip, fixZippedFile);
  let best = 99; let fixStyle = FixStyle.DecompressRecompress; let fixWith = [];
  for (const f of fixFiles) {
    const o = FixOrder[dest][getSourceFileType(f)];
    const p = o ? o.p : 99;
    if (p < best) { best = p; fixStyle = o.s; fixWith = [f]; } else if (p === best) fixWith.push(f);
  }
  if (state.rvSettings.FixLevel === EFixLevel.Level1 && fixStyle === FixStyle.RawCopyOnceVerified) fixStyle = FixStyle.RawCopy;
  if (state.rvSettings.FixLevel === EFixLevel.Level3 && fixStyle === FixStyle.RawCopy) fixStyle = FixStyle.DecompressRecompress;
  if (fixStyle === FixStyle.RawCopyOnceVerified) fixStyle = FixStyle.DecompressRecompress;
  if (fixStyle === FixStyle.Compress) fixStyle = FixStyle.DecompressRecompress;
  return { files: fixWith, fixStyle };
}

module.exports = { getFixFileList, findSourceToUseForFix, getSourceFileType, getDestinationFileType };
