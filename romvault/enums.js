// Ported from RomVault (RVWorld: SharedEnum, RomVaultCore/RepairStatus.cs, RomVaultCore/Settings.cs,
// RomVaultCore/RvDB, Compress/StructuredZip) by Gordon J. Licensed under Apache-2.0; see LICENSE and NOTICE.
// Converted from C# to JavaScript for MediaDesk.
'use strict';

const FileType = { UnSet: 0, Dir: 1, Zip: 2, SevenZip: 3, File: 4, FileZip: 5, FileSevenZip: 6, FileOnly: 100 };

const DatStatus = { InDatCollect: 0, InDatMerged: 1, InDatNoDump: 2, NotInDat: 3, InToSort: 4 };

const GotStatus = { NotGot: 0, Got: 1, Corrupt: 2, FileLocked: 3 };

const RepStatus = {};
[
  'Error', 'UnSet', 'UnScanned', 'DirCorrect', 'DirMissing', 'DirUnknown', 'DirInToSort', 'DirCorrupt',
  'Missing', 'Correct', 'NotCollected', 'UnNeeded', 'Unknown', 'InToSort', 'Corrupt', 'Ignore', 'CanBeFixed',
  'MoveToSort', 'Delete', 'NeededForFix', 'Rename', 'CorruptCanBeFixed', 'MoveToCorrupt', 'Deleted',
  'IncompleteRemove', 'Incomplete', 'MissingMIA', 'CorrectMIA', 'CanBeFixedMIA', 'MissingNew', 'EndValue',
].forEach((n, i) => { RepStatus[n] = i; });
const RepStatusName = Object.keys(RepStatus);

// FileStatus flags. JavaScript bit operators are 32-bit signed; bit 29 is the highest used, so they're safe.
const FileStatus = {
  HeaderFileTypeFromDAT: 1 << 0, SizeFromDAT: 1 << 1, CRCFromDAT: 1 << 2, SHA1FromDAT: 1 << 3, MD5FromDAT: 1 << 4,
  AltSizeFromDAT: 1 << 5, AltCRCFromDAT: 1 << 6, AltSHA1FromDAT: 1 << 7, AltMD5FromDAT: 1 << 8,
  HeaderFileTypeFromHeader: 1 << 9, SizeFromHeader: 1 << 10, CRCFromHeader: 1 << 11, SHA1FromHeader: 1 << 12,
  MD5FromHeader: 1 << 13, AltSizeFromHeader: 1 << 14, AltCRCFromHeader: 1 << 15, AltSHA1FromHeader: 1 << 16,
  AltMD5FromHeader: 1 << 17, SizeVerified: 1 << 18, CRCVerified: 1 << 19, SHA1Verified: 1 << 20, MD5Verified: 1 << 21,
  AltSizeVerified: 1 << 22, AltCRCVerified: 1 << 23, AltSHA1Verified: 1 << 24, AltMD5Verified: 1 << 25,
  SHA256Verified: 1 << 26, AltSHA256Verified: 1 << 27, DateFromDAT: 1 << 28, DeepScanned: 1 << 29,
};
FileStatus.DatFlags = FileStatus.HeaderFileTypeFromDAT | FileStatus.SizeFromDAT | FileStatus.CRCFromDAT | FileStatus.SHA1FromDAT |
  FileStatus.MD5FromDAT | FileStatus.AltSizeFromDAT | FileStatus.AltCRCFromDAT | FileStatus.AltSHA1FromDAT |
  FileStatus.AltMD5FromDAT | FileStatus.DateFromDAT;
FileStatus.DatAltFlags = FileStatus.AltSizeFromDAT | FileStatus.AltCRCFromDAT | FileStatus.AltSHA1FromDAT | FileStatus.AltMD5FromDAT;
FileStatus.HeaderFlags = FileStatus.HeaderFileTypeFromHeader | FileStatus.SizeFromHeader | FileStatus.CRCFromHeader |
  FileStatus.SHA1FromHeader | FileStatus.MD5FromHeader | FileStatus.AltSizeFromHeader | FileStatus.AltCRCFromHeader |
  FileStatus.AltSHA1FromHeader | FileStatus.AltMD5FromHeader;
FileStatus.VerifiedFlags = FileStatus.SizeVerified | FileStatus.CRCVerified | FileStatus.SHA1Verified | FileStatus.MD5Verified |
  FileStatus.AltSizeVerified | FileStatus.AltCRCVerified | FileStatus.AltSHA1Verified | FileStatus.AltMD5Verified |
  FileStatus.SHA256Verified | FileStatus.AltSHA256Verified;

const HeaderFileType = {
  Nothing: 0, ZIP: 1, GZ: 2, SevenZip: 3, RAR: 4, CHD: 5, A7800: 6, Lynx: 7, NES: 8, FDS: 9, PCE: 10, PSID: 11,
  SNES: 12, SPC: 13, HeaderMask: 0x1f, Required: 0x80,
};

function headerTypeFromFileName(header) {
  if (!header || !String(header).trim()) return HeaderFileType.Nothing;
  switch (String(header).toLowerCase()) {
    case 'a7800.xml': case 'no-intro_a7800.xml': return HeaderFileType.A7800;
    case 'fds.xml': case 'no-intro_fds.xml': return HeaderFileType.FDS;
    case 'lynx.xml': case 'no-intro_lynx.xml': return HeaderFileType.Lynx;
    case 'nes.xml': case 'nes0.xml': case 'no-intro_nes.xml': case 'nongoodnes.xml': return HeaderFileType.NES;
    case 'pce.xml': return HeaderFileType.PCE;
    case 'psid.xml': return HeaderFileType.PSID;
    case 'snes.xml': return HeaderFileType.SNES;
    case 'spc.xml': return HeaderFileType.SPC;
    default: return HeaderFileType.Nothing;
  }
}

const ZipStructure = {
  None: 0, ZipTrrnt: 1, ZipTDC: 2, ZipDTD: 3, SevenZipTrrnt: 4, ZipZSTD: 5, ZipDTZ: 6,
  SevenZipSLZMA: 8, SevenZipNLZMA: 9, SevenZipSZSTD: 10, SevenZipNZSTD: 11,
};
const ZipStructureName = Object.fromEntries(Object.entries(ZipStructure).map(([k, v]) => [v, k]));

const ToSortDirType = { None: 0, ToSortPrimary: 1, ToSortCache: 2, ToSortFileOnly: 4 };

const DatFlags = {
  AutoAddedDirectory: 1, MultiDatOverride: 2, MultiDatsInDirectory: 4, UseDescriptionAsDirName: 8,
  SingleArchive: 16, UseIdForName: 32,
};

const DatUpdateStatus = { Delete: 0, Correct: 1 };
const TreeSelect = { UnSelected: 0, Selected: 1, Locked: 2 };
const EFile = { Keep: 0, Delete: 1 };

const EScanLevel = { Level1: 0, Level2: 1, Level3: 2 };
const EFixLevel = { Level1: 0, Level2: 1, Level3: 2 };
const MergeType = { None: 0, Split: 1, Merge: 2, NonMerged: 3, CHDsMerge: 4 };
const FilterType = { KeepAll: 0, RomsOnly: 1, CHDsOnly: 2 };
const HeaderType = { Optional: 0, Headered: 1, Headerless: 2 };
const RemoveSubType = {
  KeepAllSubDirs: 0, RemoveAllSubDirs: 1, RemoveAllIfNoConflicts: 2, RemoveSubIfSingleFiles: 3, RemoveSubIfNameMatches: 4,
};

// ByteUtils zero-length file hashes (hashes are lower-case hex strings in this port).
const ZeroByteCRC = '00000000';
const ZeroByteMD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const ZeroByteSHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

module.exports = {
  FileType, DatStatus, GotStatus, RepStatus, RepStatusName, FileStatus, HeaderFileType, headerTypeFromFileName,
  ZipStructure, ZipStructureName, ToSortDirType, DatFlags, DatUpdateStatus, TreeSelect, EFile, EScanLevel, EFixLevel,
  MergeType, FilterType, HeaderType, RemoveSubType, ZeroByteCRC, ZeroByteMD5, ZeroByteSHA1,
};
