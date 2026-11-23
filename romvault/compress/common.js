// Ported from RomVault (RVWorld: Compress/ZipReturn, Compress/CompressUtils.cs, Compress/CodePage/CodePage437.cs)
// by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
'use strict';

const zlib = require('node:zlib');

const ZipReturn = {};
[
  'ZipGood', 'ZipFileLocked', 'ZipFileCountError', 'ZipSignatureError', 'ZipExtraDataOnEndOfZip', 'ZipUnsupportedCompression',
  'ZipLocalFileHeaderError', 'ZipCentralDirError', 'ZipEndOfCentralDirectoryError', 'Zip64EndOfCentralDirError',
  'Zip64EndOfCentralDirectoryLocatorError', 'ZipReadingFromOutputFile', 'ZipWritingToInputFile', 'ZipErrorGettingDataStream',
  'ZipCRCDecodeError', 'ZipDecodeError', 'ZipFileNameToLong', 'ZipFileAlreadyOpen', 'ZipCannotFastOpen', 'ZipErrorOpeningFile',
  'ZipErrorFileNotFound', 'ZipErrorReadingFile', 'ZipErrorTimeStamp', 'ZipErrorRollBackFile', 'ZipTryingToAccessADirectory',
  'ZipErrorWritingToOutputStream', 'ZipTrrntzipIncorrectCompressionUsed', 'ZipTrrntzipIncorrectFileOrder',
  'ZipTrrntzipIncorrectDirectoryAddedToZip', 'ZipTrrntZipIncorrectDirectorySeparator', 'ZipUntested',
].forEach((n, i) => { ZipReturn[n] = i; });
const ZipReturnName = Object.keys(ZipReturn);

function zipErrorMessageText(zr) {
  switch (zr) {
    case ZipReturn.ZipGood: return '';
    case ZipReturn.ZipCentralDirError: return 'Corrupt Central Directory';
    case ZipReturn.ZipFileCountError: return 'Wrong File Count';
    case ZipReturn.ZipUnsupportedCompression: return 'Unsupported compression method';
    case ZipReturn.ZipLocalFileHeaderError: return 'Corrupt local file header';
    case ZipReturn.ZipEndOfCentralDirectoryError: return 'Corrupt end of central directory';
    case ZipReturn.ZipErrorReadingFile: return 'Error reading file';
    default: return ZipReturnName[zr] || String(zr);
  }
}

const ZipCompression = { Stored: 0, Shrunk: 1, Reduced1: 2, Reduced2: 3, Reduced3: 4, Reduced4: 5, Imploded: 6, Deflated: 8, Deflate64: 9, Bzip2: 12, LZMA: 14, ZStandardDeprecated: 20, ZStandard: 93, PPMd: 98 };

const hasZstd = typeof zlib.createZstdDecompress === 'function' && typeof zlib.createZstdCompress === 'function';

// --- CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = typeof zlib.crc32 === 'function'
  ? (buf, prev = 0) => zlib.crc32(buf, prev)
  : (buf, prev = 0) => { let c = (prev ^ 0xffffffff) >>> 0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

// --- Code page 437
const CP437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const CP437_REV = new Map([...CP437].map((c, i) => [c, i]));
const CodePage437 = {
  getString(buf) {
    let s = '';
    for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP437[b];
    return s;
  },
  // Returns a Buffer, or null if the name can't be written in code page 437.
  getBytes(str) {
    const out = [];
    for (const ch of str) {
      const c = ch.charCodeAt(0);
      if (c < 0x80 && ch.length === 1) { out.push(c); continue; }
      const v = CP437_REV.get(ch);
      if (v == null || v < 0x80) return null;
      out.push(v);
    }
    return Buffer.from(out);
  },
  isCodePage437(str) { return CodePage437.getBytes(str) != null; },
};

// Ticks are RomVault's time values. In this port a file system time is milliseconds since 1970 (always
// greater than 0xffffffff for any real date), and a time stored in a ZIP header is the DOS date and time
// packed into 32 bits (date << 16 | time), as RomVault does.
function combineDosDateTime(date, time) { return date * 65536 + time; }
function dosFromTicks(ticks) {
  if (ticks == null) return { date: 0, time: 0 };
  if (ticks <= 0xffffffff) return { date: Math.floor(ticks / 65536) & 0xffff, time: ticks & 0xffff };
  const d = new Date(ticks);
  const date = (d.getDate() & 0x1f) | (((d.getMonth() + 1) & 0x0f) << 5) | (((d.getFullYear() - 1980) & 0x7f) << 9);
  const time = ((d.getSeconds() >> 1) & 0x1f) | ((d.getMinutes() & 0x3f) << 5) | ((d.getHours() & 0x1f) << 11);
  return { date, time };
}
function dosToDate(v) {
  if (v == null || v === 0) return null;
  if (v > 0xffffffff) return new Date(v);
  const date = Math.floor(v / 65536); const time = v & 0xffff;
  return new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0x0f) - 1, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

module.exports = { ZipReturn, ZipReturnName, zipErrorMessageText, ZipCompression, hasZstd, crc32, hex8, CodePage437, combineDosDateTime, dosFromTicks, dosToDate };
