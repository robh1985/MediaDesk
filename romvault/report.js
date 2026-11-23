// Ported from RomVault (RVWorld: ROMVault/Report.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE and
// NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: returns the report as text instead of writing it
// through a save dialog.
'use strict';

const { RepStatus: R, RepStatusName } = require('./enums');

const Partial = [R.UnScanned, R.Missing, R.Corrupt, R.CanBeFixed, R.CorruptCanBeFixed];
const Fixing = [R.CanBeFixed, R.MoveToSort, R.Delete, R.NeededForFix, R.Rename, R.CorruptCanBeFixed, R.MoveToCorrupt];
const RT = { Complete: 0, CompletelyMissing: 1, PartialMissing: 2, Fixing: 3 };
const DatRootFullName = 2;

function generateReport(root) {
  const out = [];
  out.push('Complete DAT Sets', '-----------------------------------------');
  findAllDats(out, root, RT.Complete);
  out.push('', '', 'Empty DAT Sets', '-----------------------------------------');
  findAllDats(out, root, RT.CompletelyMissing);
  out.push('', '', 'Partial DAT Sets - (Listing Missing ROMs)', '-----------------------------------------');
  findAllDats(out, root, RT.PartialMissing);
  return out.join('\r\n') + '\r\n';
}

function generateFixReport(root) {
  const out = ['Listing Fixes', '-----------------------------------------'];
  findAllDats(out, root, RT.Fixing);
  return out.join('\r\n') + '\r\n';
}

const removeBase = (name) => { const p = name.indexOf('\\'); return p > 0 ? name.substring(p + 1) : name; };

function findAllDats(out, d, rt) {
  if (!d.IsDirectory) return;
  for (let i = 0; i < d.DirDatCount; i++) {
    const dat = d.dirDat(i);
    let correct = 0; let missing = 0; let fixesNeeded = 0;
    const add = (s) => { correct += s.countCorrect(); missing += s.countMissing(); fixesNeeded += s.countFixesNeeded(); };
    if (d.Dat === dat) add(d.DirStatus);
    else for (let j = 0; j < d.ChildCount; j++) { const c = d.child(j); if (c.IsDirectory && c.Dat === dat) add(c.DirStatus); }
    const name = removeBase(dat.getData(DatRootFullName) || '');
    if (rt === RT.Complete && correct > 0 && missing === 0 && fixesNeeded === 0) out.push(name);
    else if (rt === RT.CompletelyMissing && correct === 0 && missing > 0 && fixesNeeded === 0) out.push(name);
    else if ((rt === RT.PartialMissing && ((correct > 0 && missing > 0) || fixesNeeded > 0)) || (rt === RT.Fixing && fixesNeeded > 0)) {
      out.push(name);
      const want = rt === RT.Fixing ? Fixing : Partial;
      const rows = [];
      collect(d, dat, want, rows);
      const w = [0, 0, 0];
      for (const r of rows) { w[0] = Math.max(w[0], r[0].length); w[1] = Math.max(w[1], r[1].length); w[2] = Math.max(w[2], r[3].length); }
      const bar = `+${'-'.repeat(w[0] + 2)}+${'-'.repeat(w[1] + 2)}+----------+${'-'.repeat(w[2] + 2)}+`;
      out.push(bar);
      for (const r of rows) out.push(`| ${r[0].padEnd(w[0] + 1)}| ${r[1].padEnd(w[1] + 1)}| ${r[2].padEnd(9)}| ${r[3].padEnd(w[2] + 1)}|`);
      out.push(bar, '');
    }
  }
  if (d.Dat != null) return;
  for (let i = 0; i < d.ChildCount; i++) findAllDats(out, d.child(i), rt);
}

function collect(dir, dat, want, rows) {
  for (let i = 0; i < dir.ChildCount; i++) {
    const b = dir.child(i);
    if (b.Dat != null && b.Dat !== dat) continue;
    if (b.IsFile && want.includes(b.RepStatus)) rows.push([b.fileNameInsideGame(), String(b.Size ?? ''), b.CRC || '', RepStatusName[b.RepStatus]]);
    if (b.IsDirectory) collect(b, dat, want, rows);
  }
}

module.exports = { generateReport, generateFixReport };
