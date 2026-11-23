// Ported from RomVault (RVWorld: RomVaultCore/Scanner/FileScanning.cs, Compare.cs, Populate.cs) by Gordon J.
// Licensed under Apache-2.0; see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk.
// Changes: async; directory entries are stat'ed a few at a time; CHD data is not deep-verified, so a CHD's
// header hashes are never marked as verified; Compare.CompareAltHash's inverted MD5 check is corrected.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { FileType, GotStatus, FileStatus, HeaderFileType, EScanLevel, EFile, ToSortDirType } = require('../enums');
const { RVSorters } = require('../sorters');
const { state, findDatRule } = require('../settings');
const { DB, DBHelper, DBTypeGet, isFileOnly } = require('../rvdb');
const { reportStatusReset } = require('../repairStatus');
const { ZipReturn, ZipReturnName, zipErrorMessageText } = require('../compress/common');
const { fileMtime } = require('../compress/zip');
const { ScannedFile, FileHeaderReader, FileScan, readChdHeader } = require('./fileScan');

// ------------------------------------------------------------------------------------------------ Populate
const Populate = {
  async fromAZipFileArchive(dbDir, eScanLevel, thWrk) {
    const filename = dbDir.FullNameCase;
    const deep = eScanLevel === EScanLevel.Level2 || eScanLevel === EScanLevel.Level3;
    const { zr, scannedArchive } = await FileScan.scanArchiveFile(dbDir.FileType, filename, dbDir.FileModTimeStamp, deep, { progress: (t) => thWrk.text3?.(t), signal: thWrk.signal });
    if (zr === ZipReturn.ZipGood) { dbDir.ZipStruct = scannedArchive.ZipStruct; return scannedArchive; }
    if (zr === ZipReturn.ZipFileLocked || zr === ZipReturn.ZipErrorOpeningFile || zr === ZipReturn.ZipErrorTimeStamp) {
      thWrk.error(filename, zr === ZipReturn.ZipFileLocked ? 'Zip File Locked' : zr === ZipReturn.ZipErrorOpeningFile ? 'Zip Error Opening File' : 'Zip Error File Modified');
      dbDir.FileModTimeStamp = null;
      dbDir.GotStatus = GotStatus.FileLocked;
    } else {
      thWrk.error(filename, zipErrorMessageText(zr));
      dbDir.GotStatus = GotStatus.Corrupt;
    }
    return null;
  },

  async fromADir(dbDir, eScanLevel, thWrk, fileIndex, abort) {
    const fullName = dbDir.FullName;
    const fullNameCase = dbDir.FullNameCase;
    const fileDir = new ScannedFile(FileType.Dir);
    thWrk.text(`Scanning Dir : ${fullName}`);
    let entries;
    try { entries = await fsp.readdir(fullNameCase, { withFileTypes: true }); } catch (e) {
      thWrk.error(fullNameCase, `Could not read directory: ${e.code || e.message}`);
      return fileDir;
    }
    // stat everything (following links) a few at a time
    const stats = new Array(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, async () => {
      while (next < entries.length) { const i = next++; try { stats[i] = await fsp.stat(path.join(fullNameCase, entries[i].name)); } catch { stats[i] = null; } }
    }));
    const datRule = findDatRule(dbDir.DatTreeFullName + '\\');
    const regexList = (datRule && datRule.IgnoreFilesRegex && datRule.IgnoreFilesScanRegex.length > 0) ? datRule.IgnoreFilesScanRegex : state.rvSettings.IgnoreFilesScanRegex;
    const fileOnly = isFileOnly(dbDir);
    const files = [];
    entries.forEach((e, i) => {
      const st = stats[i];
      if (!st) return;
      if (st.isDirectory()) {
        const t = new ScannedFile(FileType.Dir);
        t.Name = e.name; t.FileModTimeStamp = fileMtime(st); t.GotStatus = GotStatus.Got;
        fileDir.add(t);
      } else if (st.isFile()) files.push([e.name, st]);
    });
    for (const [fName, st] of files) {
      if (fName.startsWith('__RomVault.') && fName.endsWith('.tmp')) {
        try { await fsp.rm(path.join(fullNameCase, fName), { force: true }); } catch { thWrk.error(path.join(fullNameCase, fName), 'Could not delete, un-needed tmp file.'); }
        continue;
      }
      if (regexList.some((r) => r.test(fName))) continue;
      let ft = DBTypeGet.fromExtention(path.extname(fName));
      if (state.rvSettings.FilesOnly || dbDir.toSortStatusIs(ToSortDirType.ToSortFileOnly) || fileOnly) ft = FileType.File;
      const t = new ScannedFile(ft);
      t.Name = fName; t.Size = st.size; t.FileModTimeStamp = fileMtime(st); t.GotStatus = GotStatus.Got;
      t.fileStatusSet(FileStatus.SizeVerified);
      if (eScanLevel === EScanLevel.Level3 && t.FileType === FileType.File) {
        if (fileIndex != null) thWrk.value2?.(fileIndex);
        thWrk.text2?.(t.Name);
        await Populate.fromAFile(t, fullNameCase, eScanLevel, thWrk, abort);
      }
      fileDir.add(t);
    }
    return fileDir;
  },

  async fromAFile(file, directory, eScanLevel, thWrk, abort) {
    const filename = path.join(directory, file.Name);
    thWrk.text2?.(file.Name);
    const { zr, scannedArchive } = await FileScan.scanArchiveFile(FileType.Dir, filename, file.FileModTimeStamp, true, { progress: (t) => thWrk.text3?.(t), signal: thWrk.signal });
    if (zr === ZipReturn.ZipFileLocked) { thWrk.error(filename, 'File Locked'); file.GotStatus = GotStatus.FileLocked; return; }
    if (zr === ZipReturn.ZipErrorOpeningFile) { thWrk.error(filename, 'Error Opening File'); file.GotStatus = GotStatus.FileLocked; return; }
    if (zr !== ZipReturn.ZipGood) {
      let error = ZipReturnName[zr] || String(zr);
      if (error.toLowerCase().startsWith('zip')) error = error.substring(3);
      thWrk.error(filename, `File: ${filename} Error: ${error}. Scan Aborted.`);
      file.GotStatus = GotStatus.FileLocked;
      abort.value = true;
      return;
    }
    const fr = scannedArchive.at(0);
    if (fr.GotStatus !== GotStatus.Got) { thWrk.error(filename, 'Error Scanning File'); file.GotStatus = fr.GotStatus; return; }
    file.DeepScanned = fr.DeepScanned; file.HeaderFileType = fr.HeaderFileType;
    file.Size = fr.Size; file.CRC = fr.CRC; file.SHA1 = fr.SHA1; file.MD5 = fr.MD5;
    file.AltSize = fr.AltSize; file.AltCRC = fr.AltCRC; file.AltSHA1 = fr.AltSHA1; file.AltMD5 = fr.AltMD5;
    file.GotStatus = fr.GotStatus;
    file.fileStatusSet(FileStatus.SizeVerified |
      (file.HeaderFileType !== HeaderFileType.Nothing ? FileStatus.HeaderFileTypeFromHeader : 0) |
      (file.CRC != null ? FileStatus.CRCVerified : 0) | (file.SHA1 != null ? FileStatus.SHA1Verified : 0) | (file.MD5 != null ? FileStatus.MD5Verified : 0) |
      (file.AltSize != null ? FileStatus.AltSizeVerified : 0) | (file.AltCRC != null ? FileStatus.AltCRCVerified : 0) |
      (file.AltSHA1 != null ? FileStatus.AltSHA1Verified : 0) | (file.AltMD5 != null ? FileStatus.AltMD5Verified : 0));
    if (fr.HeaderFileType === HeaderFileType.CHD) {
      const chd = await readChdHeader(filename);
      if (chd.error === 'CHDERR_CANNOT_OPEN_FILE') { thWrk.error(filename, `File: ${filename} Error: File Could not be opened.`); abort.value = true; } else if (chd.error === 'CHDERR_INVALID_FILE') {
        thWrk.error(filename, 'CHD ERROR : CHDERR_INVALID_FILE');
        file.GotStatus = GotStatus.Corrupt;
      }
      file.CHDVersion = chd.version ?? null;
      if (chd.sha1) { file.AltSHA1 = chd.sha1; file.fileStatusSet(FileStatus.AltSHA1FromHeader); }
      if (chd.md5) { file.AltMD5 = chd.md5; file.fileStatusSet(FileStatus.AltMD5FromHeader); }
      thWrk.text3?.('');
    }
  },
};

// ------------------------------------------------------------------------------------------------ Compare
const FileCompare = {
  phase1Test(dbFile, testFile, eScanLevel, indexCase) {
    const no = { matched: false, altMatch: false };
    const retv = indexCase === 0 ? ordinalCompare(dbFile.Name, testFile.Name) : RVSorters.CompareName(dbFile, testFile);
    if (retv !== 0) return no;
    if (dbFile.FileType !== testFile.FileType) return no;
    if (dbFile.FileType === FileType.Dir || dbFile.FileType === FileType.Zip || dbFile.FileType === FileType.SevenZip) return { matched: true, altMatch: false };
    if (dbFile.HeaderFileTypeRequired && dbFile.HeaderFileType !== testFile.HeaderFileType) return no;
    if (testFile.CRC != null) return FileCompare.compareWithAlt(dbFile, testFile);
    if (eScanLevel !== EScanLevel.Level1 && !dbFile.IsDeepScanned) return no;
    if (dbFile.FileModTimeStamp !== testFile.FileModTimeStamp) return no;
    if (dbFile.Size === testFile.Size) return { matched: true, altMatch: false };
    if ((dbFile.Size ?? 0) + FileHeaderReader.getFileHeaderLength(dbFile.HeaderFileType) !== testFile.Size) return no;
    return { matched: true, altMatch: true };
  },

  async phase2Test(dbFile, testFile, eScanLevel, indexCase, fullDir, thWrk, fileIndex, abort) {
    const no = { matched: false, altMatch: false };
    const retv = indexCase === 0 ? ordinalCompare(dbFile.Name, testFile.Name) : RVSorters.CompareName(dbFile, testFile);
    if (retv !== 0) return no;
    if (dbFile.FileType !== FileType.File || testFile.FileType !== FileType.File) return no;
    thWrk.value2?.(fileIndex);
    thWrk.text2?.(testFile.Name);
    await Populate.fromAFile(testFile, fullDir, eScanLevel, thWrk, abort);
    if (abort.value) return no;
    if (testFile.GotStatus === GotStatus.FileLocked) return { matched: true, altMatch: false };
    return FileCompare.compareWithAlt(dbFile, testFile);
  },

  compareWithAlt(dbFile, testFile) {
    if (FileCompare.compareHash(dbFile, testFile)) return { matched: true, altMatch: false };
    if (FileCompare.compareAltHash(dbFile, testFile)) return { matched: true, altMatch: true };
    return { matched: false, altMatch: false };
  },

  compareHash(dbFile, t) {
    let found = false;
    if (dbFile.Size != null && t.Size != null) {
      if (dbFile.Size !== t.Size) return false;
      if (t.Size === 0 && dbFile.CRC == null && dbFile.SHA1 == null && dbFile.MD5 == null) return true;
    }
    if (dbFile.CRC != null && t.CRC != null) { found = true; if (dbFile.CRC !== t.CRC) return false; }
    if (dbFile.SHA1 != null && t.SHA1 != null) { found = true; if (dbFile.SHA1 !== t.SHA1) return false; }
    if (dbFile.MD5 != null && t.MD5 != null) { found = true; if (dbFile.MD5 !== t.MD5) return false; }
    return found;
  },

  compareAltHash(dbFile, t) {
    if (!FileHeaderReader.altHeaderFile(t.HeaderFileType)) return false;
    if (dbFile.HeaderFileType !== t.HeaderFileType) return false;
    let found = false;
    if (dbFile.Size != null && t.AltSize != null && dbFile.Size !== t.AltSize) return false;
    if (dbFile.CRC != null && t.AltCRC != null) { found = true; if (dbFile.CRC !== t.AltCRC) return false; }
    if (dbFile.SHA1 != null && t.AltSHA1 != null) { found = true; if (dbFile.SHA1 !== t.AltSHA1) return false; }
    // RomVault returns false here when the MD5s are equal; the port returns false when they differ.
    if (dbFile.MD5 != null && t.AltMD5 != null) { found = true; if (dbFile.MD5 !== t.AltMD5) return false; }
    return found;
  },
};

function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// ------------------------------------------------------------------------------------------------ FileScanning
class FileScanning {
  constructor(thWrk, { startAt = null, scanLevel = EScanLevel.Level2 } = {}) {
    this.thWrk = thWrk; this.StartAt = startAt; this.EScanLevel = scanLevel; this.abort = { value: false };
  }

  get cancelled() { return this.thWrk.cancelled || this.abort.value; }

  async scanFiles() {
    const thWrk = this.thWrk;
    this._cacheSaveAt = state.rvSettings.CacheSaveTimerEnabled ? Date.now() : null;
    try {
      thWrk.text('Clearing DB Status');
      reportStatusReset(DB.DirRoot);
      thWrk.text("Finding Dir's to Scan");
      const lstDir = [];
      DBHelper.getSelectedDirListStart(lstDir, this.StartAt);
      thWrk.text("Scanning Dir's");
      thWrk.range(lstDir.length);
      for (let i = 0; i < lstDir.length; i++) {
        thWrk.progress(i + 1);
        thWrk.text(`Scanning Dir : ${lstDir[i].FullName}`);
        let exists = false;
        try { exists = (await fsp.stat(lstDir[i].FullName)).isDirectory(); } catch { exists = false; }
        if (exists) { lstDir[i].GotStatus = GotStatus.Got; await this.checkADir(lstDir[i], null); } else lstDir[i].markAsMissing();
        if (this.cancelled) break;
      }
    } finally {
      thWrk.text('Updating Cache');
      DB.write();
      thWrk.text('File Scan Complete');
    }
  }

  _maybeSaveCache() {
    if (this._cacheSaveAt != null && Date.now() - this._cacheSaveAt > state.rvSettings.CacheSaveTimePeriod * 60000) {
      this.thWrk.text('Saving Cache'); DB.write(); this.thWrk.text('Saving Cache Complete');
      this._cacheSaveAt = Date.now();
    }
  }

  async checkAnArchive(dbDir, report, checkIndex) {
    const ft = dbDir.FileType;
    if (!(ft === FileType.Zip || ft === FileType.SevenZip)) { this.thWrk.error(dbDir.FullName, `Un supported file type in CheckADir ${ft}`); return; }
    this._maybeSaveCache();
    if (checkIndex != null) this.thWrk.value2?.(checkIndex);
    this.thWrk.text2?.(dbDir.FullName);
    const fileArchive = await Populate.fromAZipFileArchive(dbDir, this.EScanLevel, this.thWrk);
    if (fileArchive == null) { dbDir.markAsMissing(); return; }
    if (report) this.thWrk.range2?.(fileArchive.count);
    dbDir.mergeInArchive(fileArchive);
  }

  async checkADir(dbDir, checkIndex) {
    const thWrk = this.thWrk;
    if (dbDir.FileType !== FileType.Dir) { thWrk.error(dbDir.FullName, `Un supported file type in CheckADir ${dbDir.FileType}`); return; }
    this._maybeSaveCache();
    if (checkIndex != null) thWrk.value2?.(checkIndex);
    thWrk.text2?.(dbDir.FullName);
    const fileDir = await Populate.fromADir(dbDir, this.EScanLevel, thWrk, checkIndex, this.abort);
    thWrk.range2?.(fileDir.count);
    if (thWrk.cancelled) return;
    fileDir.sort();
    const reportDir = () => { if (checkIndex != null) thWrk.value2?.(checkIndex); thWrk.text2?.(dbDir.FullName); thWrk.range2?.(fileDir.count); };
    const ref = { dbIndex: 0 };
    let fileIndex = 0;
    for (;;) {
      let dbChild = null; let fileChild = null; let res = 0;
      if (ref.dbIndex < dbDir.ChildCount && fileIndex < fileDir.count) {
        dbChild = dbDir.child(ref.dbIndex); fileChild = fileDir.at(fileIndex); res = RVSorters.CompareName(dbChild, fileChild);
      } else if (fileIndex < fileDir.count) { fileChild = fileDir.at(fileIndex); res = 1; } else if (ref.dbIndex < dbDir.ChildCount) { dbChild = dbDir.child(ref.dbIndex); res = -1; } else break;

      if (res === 0) {
        const dbs = [dbChild]; const files = [fileChild];
        while (ref.dbIndex + dbs.length < dbDir.ChildCount && RVSorters.CompareName(dbChild, dbDir.child(ref.dbIndex + dbs.length)) === 0) dbs.push(dbDir.child(ref.dbIndex + dbs.length));
        while (fileIndex + files.length < fileDir.count && RVSorters.CompareName(fileChild, fileDir.at(fileIndex + files.length)) === 0) files.push(fileDir.at(fileIndex + files.length));
        const caseTest = files.length > 1;
        for (let indexCase = caseTest ? 0 : 1; indexCase < 2; indexCase++) {
          for (const file of files) {
            if (file.SearchFound) continue;
            for (const db of dbs) {
              if (db.SearchFound) continue;
              const m = FileCompare.phase1Test(db, file, this.EScanLevel, indexCase);
              if (!m.matched) continue;
              if (await this.matchFound(db, file, m.altMatch, fileIndex)) reportDir();
              db.SearchFound = true; file.SearchFound = true;
              break;
            }
            if (file.SearchFound) continue;
            for (const db of dbs) {
              if (db.SearchFound) continue;
              const m = await FileCompare.phase2Test(db, file, this.EScanLevel, indexCase, dbDir.FullNameCase, thWrk, fileIndex, this.abort);
              if (!m.matched) continue;
              if (await this.matchFound(db, file, m.altMatch, fileIndex)) reportDir();
              db.SearchFound = true; file.SearchFound = true;
              break;
            }
          }
        }
        for (const db of dbs) {
          if (db.SearchFound) { db.SearchFound = false; ref.dbIndex++; continue; }
          this.dbFileNotFound(db, dbDir, ref);
        }
        for (const file of files) {
          if (file.SearchFound) continue;
          if (await this.newFileFound(file, dbDir, ref.dbIndex, fileIndex)) reportDir();
          ref.dbIndex++;
        }
        fileIndex += files.length;
      } else if (res === 1) {
        if (await this.newFileFound(fileChild, dbDir, ref.dbIndex, fileIndex)) reportDir();
        ref.dbIndex++; fileIndex++;
      } else {
        this.dbFileNotFound(dbChild, dbDir, ref);
      }
      if (this.abort.value || thWrk.cancelled) return;
    }
  }

  async matchFound(dbChild, fileChild, altMatch, fileIndex) {
    let retDirFound = false;
    switch (dbChild.FileType) {
      case FileType.Zip: case FileType.SevenZip:
        if (dbChild.FileModTimeStamp !== fileChild.FileModTimeStamp || this.EScanLevel === EScanLevel.Level3 || (this.EScanLevel === EScanLevel.Level2 && !dbChild.IsDeepScanned)) {
          dbChild.markAsMissing();
          dbChild.fileMergeIn(fileChild, false);
          await this.checkAnArchive(dbChild, false, fileIndex);
        } else dbChild.fileCheckName(fileChild);
        break;
      case FileType.Dir:
        if (dbChild.Tree == null) { await this.checkADir(dbChild, fileIndex); retDirFound = true; }
        if (this.abort.value) return true;
        dbChild.fileMergeIn(fileChild, false);
        break;
      case FileType.File:
        dbChild.fileMergeIn(fileChild, altMatch);
        break;
      default: throw new Error(`Unsuported file type ${dbChild.FileType}`);
    }
    return retDirFound;
  }

  async newFileFound(fileChild, dbDir, dbIndex, fileIndex) {
    switch (fileChild.FileType) {
      case FileType.Zip: case FileType.SevenZip: {
        const n = dbDir.fileAdd(fileChild, dbIndex);
        await this.checkAnArchive(n, false, fileIndex);
        return false;
      }
      case FileType.Dir: {
        const n = dbDir.fileAdd(fileChild, dbIndex);
        await this.checkADir(n, fileIndex);
        return true;
      }
      case FileType.File:
        if (fileChild.GotStatus !== GotStatus.FileLocked && !fileChild.DeepScanned) {
          this.thWrk.value2?.(fileIndex);
          this.thWrk.text2?.(fileChild.Name);
          await Populate.fromAFile(fileChild, dbDir.FullNameCase, this.EScanLevel, this.thWrk, this.abort);
        }
        dbDir.fileAdd(fileChild, dbIndex);
        return false;
      default: throw new Error(`Unsuported file type ${fileChild.FileType}`);
    }
  }

  dbFileNotFound(dbChild, dbDir, ref) {
    if (dbChild.fileRemove() === EFile.Delete) { dbDir.childRemove(ref.dbIndex); return; }
    if (dbChild.FileType === FileType.Zip || dbChild.FileType === FileType.SevenZip) dbChild.markAsMissing();
    else if (dbChild.FileType === FileType.Dir && dbChild.Tree == null) dbChild.markAsMissing();
    ref.dbIndex++;
  }
}

module.exports = { FileScanning, Populate, FileCompare };
