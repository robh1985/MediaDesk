// Ported from RomVault (RVWorld: RomVaultCore/RepairStatus.cs) by Gordon J. Licensed under Apache-2.0;
// see LICENSE and NOTICE. Converted from C# to JavaScript for MediaDesk. MIA statuses are kept in the enum
// but the port has no MIA reporting, so UIStatus passes statuses through unchanged.
'use strict';

const { FileType, DatStatus, GotStatus, RepStatus: R } = require('./enums');

// StatusCheck[fileType][datStatus][gotStatus] = allowed statuses, the first being the default.
const StatusCheck = [];
function set(ft, ds, gs, list) {
  StatusCheck[ft] = StatusCheck[ft] || [];
  StatusCheck[ft][ds] = StatusCheck[ft][ds] || [];
  StatusCheck[ft][ds][gs] = list;
}
set(FileType.Dir, DatStatus.InDatCollect, GotStatus.NotGot, [R.DirMissing]);
set(FileType.Dir, DatStatus.InDatCollect, GotStatus.Got, [R.DirCorrect]);
set(FileType.Dir, DatStatus.InToSort, GotStatus.NotGot, [R.Deleted]);
set(FileType.Dir, DatStatus.InToSort, GotStatus.Got, [R.DirInToSort]);
set(FileType.Dir, DatStatus.NotInDat, GotStatus.NotGot, [R.Deleted]);
set(FileType.Dir, DatStatus.NotInDat, GotStatus.Got, [R.DirUnknown]);
for (const ft of [FileType.Zip, FileType.SevenZip]) {
  set(ft, DatStatus.InDatCollect, GotStatus.NotGot, [R.DirMissing]);
  set(ft, DatStatus.InDatCollect, GotStatus.Got, [R.DirCorrect]);
  set(ft, DatStatus.InDatCollect, GotStatus.Corrupt, [R.DirCorrupt]);
  set(ft, DatStatus.InDatCollect, GotStatus.FileLocked, [R.UnScanned]);
  set(ft, DatStatus.InToSort, GotStatus.NotGot, [R.Deleted]);
  set(ft, DatStatus.InToSort, GotStatus.Got, [R.DirInToSort]);
  set(ft, DatStatus.InToSort, GotStatus.Corrupt, [R.DirCorrupt]);
  set(ft, DatStatus.InToSort, GotStatus.FileLocked, [R.UnScanned]);
  set(ft, DatStatus.NotInDat, GotStatus.NotGot, [R.Deleted]);
  set(ft, DatStatus.NotInDat, GotStatus.Got, [R.DirUnknown]);
  set(ft, DatStatus.NotInDat, GotStatus.Corrupt, [R.DirCorrupt]);
  set(ft, DatStatus.NotInDat, GotStatus.FileLocked, [R.UnScanned]);
}
for (const ft of [FileType.File, FileType.FileZip, FileType.FileSevenZip]) {
  const isFile = ft === FileType.File;
  set(ft, DatStatus.InDatCollect, GotStatus.NotGot, [R.Missing, R.CanBeFixed, R.Incomplete]);
  set(ft, DatStatus.InDatCollect, GotStatus.Got, [R.Correct, R.IncompleteRemove, R.MoveToSort, R.NeededForFix, R.Delete]);
  set(ft, DatStatus.InDatCollect, GotStatus.Corrupt, [R.Corrupt, R.MoveToCorrupt, R.CorruptCanBeFixed]);
  set(ft, DatStatus.InDatCollect, GotStatus.FileLocked, [R.UnScanned]);
  set(ft, DatStatus.InDatMerged, GotStatus.NotGot, [R.NotCollected]);
  set(ft, DatStatus.InDatMerged, GotStatus.Got, isFile
    ? [R.UnNeeded, R.Delete, R.MoveToSort, R.NeededForFix]
    : [R.UnNeeded, R.Delete, R.MoveToSort, R.NeededForFix, R.Rename]);
  set(ft, DatStatus.InDatMerged, GotStatus.Corrupt, [R.Corrupt, R.MoveToCorrupt, R.Delete]);
  set(ft, DatStatus.InDatMerged, GotStatus.FileLocked, [R.UnScanned]);
  set(ft, DatStatus.InToSort, GotStatus.NotGot, [R.Deleted]);
  set(ft, DatStatus.InToSort, GotStatus.Got, isFile
    ? [R.InToSort, R.Ignore, R.NeededForFix, R.Delete]
    : [R.InToSort, R.NeededForFix, R.Delete]);
  set(ft, DatStatus.InToSort, GotStatus.Corrupt, [R.Corrupt, R.Delete]);
  set(ft, DatStatus.InToSort, GotStatus.FileLocked, [R.UnScanned]);
  set(ft, DatStatus.NotInDat, GotStatus.NotGot, [R.Deleted]);
  set(ft, DatStatus.NotInDat, GotStatus.Got, isFile
    ? [R.Unknown, R.Ignore, R.Delete, R.MoveToSort, R.NeededForFix, R.Rename]
    : [R.Unknown, R.Delete, R.MoveToSort, R.NeededForFix, R.Rename]);
  set(ft, DatStatus.NotInDat, GotStatus.Corrupt, [R.Corrupt, R.MoveToCorrupt, R.Delete]);
  set(ft, DatStatus.NotInDat, GotStatus.FileLocked, [R.UnScanned]);
}

function statusCheck(ft, ds, gs) {
  return StatusCheck[ft]?.[ds]?.[gs] || null;
}

const DisplayOrder = [
  R.Error, R.UnSet, R.UnScanned, R.DirCorrupt, R.MoveToCorrupt, R.CorruptCanBeFixed, R.CanBeFixedMIA, R.CanBeFixed,
  R.MoveToSort, R.Delete, R.NeededForFix, R.Rename, R.Corrupt, R.Unknown, R.UnNeeded, R.Incomplete, R.Missing,
  R.MissingNew, R.MissingMIA, R.CorrectMIA, R.Correct, R.InToSort, R.NotCollected, R.Ignore, R.Deleted,
];

function reportStatusReset(tFile) {
  tFile.repStatusReset();
  tFile.FileGroup = null;
  if (!tFile.IsDirectory) return;
  for (let i = 0; i < tFile.ChildCount; i++) reportStatusReset(tFile.child(i));
}

class ReportStatus {
  constructor() { this.a = new Int32Array(R.EndValue); }
  repStatusArrayAddRemove(rs, direction) { for (let i = 0; i < this.a.length; i++) this.a[i] += rs.a[i] * direction; }
  repStatusAddRemove(rs, dir) { this.a[rs] += dir; }
  repStatusUpdate(rsOld, rsNew) { this.a[rsOld]--; this.a[rsNew]++; }
  get(v) { return this.a[v]; }
  countCorrect() { return this.a[R.Correct] + this.a[R.CorrectMIA]; }
  hasCorrect() { return this.countCorrect() > 0; }
  countMissing() {
    const a = this.a;
    return a[R.Missing] + a[R.MissingNew] + a[R.DirCorrupt] + a[R.Corrupt] + a[R.CanBeFixed] + a[R.CanBeFixedMIA] +
      a[R.CorruptCanBeFixed] + a[R.MoveToCorrupt] + a[R.Incomplete];
  }
  hasMissing() { return this.countMissing() > 0; }
  countFixesNeeded() {
    const a = this.a;
    return a[R.CanBeFixed] + a[R.CanBeFixedMIA] + a[R.MoveToSort] + a[R.Delete] + a[R.NeededForFix] + a[R.Rename] +
      a[R.CorruptCanBeFixed] + a[R.MoveToCorrupt];
  }
  hasFixesNeeded() { return this.countFixesNeeded() > 0; }
  hasAllMerged() { return this.a[R.NotCollected] > 0 && this.countAnyFiles() === 0; }
  countCanBeFixed() { return this.a[R.CanBeFixed] + this.a[R.CanBeFixedMIA] + this.a[R.CorruptCanBeFixed]; }
  countFixable() {
    const a = this.a;
    return a[R.CanBeFixed] + a[R.CanBeFixedMIA] + a[R.CorruptCanBeFixed] + a[R.MoveToSort] + a[R.Delete] + a[R.MoveToCorrupt];
  }
  fixCheckFilesCanBeFixed() { return this.countCanBeFixed() > 0; }
  fixCheckHasNeededForFix() { return this.a[R.NeededForFix] > 0; }
  fixCheckHasFilesToBeRemoved() { return this.a[R.MoveToSort] + this.a[R.Delete] + this.a[R.MoveToCorrupt] > 0; }
  hasFixable() { return this.countFixable() > 0; }
  countAnyFiles() {
    const a = this.a;
    return a[R.Correct] + a[R.CorrectMIA] + a[R.UnNeeded] + a[R.Unknown] + a[R.InToSort] + a[R.Corrupt] + a[R.Ignore] +
      a[R.MoveToSort] + a[R.Delete] + a[R.NeededForFix] + a[R.Rename] + a[R.MoveToCorrupt];
  }
  hasAnyFiles() { return this.countAnyFiles() > 0; }
  countUnknown() { return this.a[R.Unknown]; }
  hasUnknown() { return this.countUnknown() > 0; }
  countInToSort() { return this.a[R.InToSort]; }
  hasInToSort() { return this.countInToSort() > 0; }
}

module.exports = { StatusCheck, statusCheck, DisplayOrder, reportStatusReset, ReportStatus };
