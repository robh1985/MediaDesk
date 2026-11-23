// Ported from RomVault (RVWorld: RomVaultCore/FixFile/Fix.cs) by Gordon J. Licensed under Apache-2.0; see LICENSE
// and NOTICE. Converted from C# to JavaScript for MediaDesk. Changes: async; errors go to the worker's error list.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { FileType, RepStatus, TreeSelect } = require('../enums');
const { state } = require('../settings');
const { DB } = require('../rvdb');
const { reportStatusReset } = require('../repairStatus');
const U = require('./utils');
const { fixFile } = require('./fixAFile');
const { fixZip } = require('./fixAZip');

const { ReturnCode, Report } = U;

// thWrk: { text(s), progress(n), range(n), error(file,msg), fix?(row), fixError?(msg), cancelled }
async function performFixes(thWrk) {
  Report.set(thWrk);
  const ctx = { totalFixed: 0, reportedFixed: 0, cacheSaveAt: state.rvSettings.CacheSaveTimerEnabled ? Date.now() : null, failed: null };
  try {
    Report.text('Fixing Files');
    let totalFixes = 0;
    for (let i = 0; i < DB.DirRoot.ChildCount; i++) { const d = DB.DirRoot.child(i); totalFixes += countFixDir(d, d.Tree.Checked === TreeSelect.Selected); }
    thWrk.range(totalFixes);
    const queue = [];
    for (let i = 0; i < DB.DirRoot.ChildCount; i++) {
      const d = DB.DirRoot.child(i);
      const rc = await fixDir(d, d.Tree.Checked === TreeSelect.Selected, queue, ctx);
      if (rc !== ReturnCode.Good && rc !== ReturnCode.Cancel) { reportStatusReset(DB.DirRoot); break; }
      if (Report.cancelled) break;
    }
    return { totalFixes, totalFixed: ctx.totalFixed, failed: ctx.failed };
  } finally {
    await U.closeLocalZip();
    Report.text('Updating Cache');
    DB.write();
    Report.text('Complete');
    Report.set(null);
  }
}

function countFixDir(dir, lastSelected) {
  let n = 0;
  const sel = dir.Tree != null ? dir.Tree.Checked === TreeSelect.Selected : lastSelected;
  for (let j = 0; j < dir.ChildCount; j++) {
    const c = dir.child(j);
    if (c.FileType === FileType.Zip || c.FileType === FileType.SevenZip) { if (sel) n += c.DirStatus.countCanBeFixed(); } else if (c.FileType === FileType.Dir) n += countFixDir(c, sel);
    else if (c.FileType === FileType.File && sel && c.RepStatus === RepStatus.CanBeFixed) n++;
  }
  return n;
}

async function fixDir(dir, lastSelected, queue, ctx) {
  const sel = dir.Tree != null ? dir.Tree.Checked === TreeSelect.Selected : lastSelected;
  const list = [];
  for (let j = 0; j < dir.ChildCount; j++) list.push(dir.child(j));
  for (const child of list) {
    let rc = await fixBase(child, sel, queue, ctx);
    if (rc !== ReturnCode.Good) return rc;
    while (queue.length) {
      rc = await fixBase(queue[0], true, queue, ctx);
      if (rc !== ReturnCode.Good) return rc;
      queue.shift();
      if (Report.cancelled) break;
    }
    if (ctx.totalFixed !== ctx.reportedFixed) { Report.thWrk?.progress(ctx.totalFixed); ctx.reportedFixed = ctx.totalFixed; }
    if (Report.cancelled) break;
  }
  if (sel) await U.checkDeleteFile(dir);
  return ReturnCode.Good;
}

async function fixBase(child, sel, queue, ctx) {
  if (child.RepStatus === RepStatus.Deleted) return ReturnCode.Good;
  if (ctx.cacheSaveAt != null && Date.now() - ctx.cacheSaveAt > state.rvSettings.CacheSaveTimePeriod * 60000) {
    Report.text('Saving Cache'); DB.write(); Report.text('Saving Cache Complete'); ctx.cacheSaveAt = Date.now();
  }
  let r = { rc: ReturnCode.LogicError, error: '' };
  const counter = { get totalFixed() { return ctx.totalFixed; }, set totalFixed(v) { ctx.totalFixed = v; } };
  try {
    switch (child.FileType) {
      case FileType.Zip: case FileType.SevenZip:
        if (!sel) return ReturnCode.Good;
        r = await fixZip(child, queue, counter);
        break;
      case FileType.Dir:
        if (sel && child.FileName) {
          const dir = child.Parent.FullName;
          await fsp.rename(path.join(dir, child.FileName), path.join(dir, '__RomVault.tmpDir'));
          await fsp.rename(path.join(dir, '__RomVault.tmpDir'), path.join(dir, child.Name));
          child.FileName = null;
        }
        return fixDir(child, sel, queue, ctx);
      case FileType.File:
        if (!sel) return ReturnCode.Good;
        r = await fixFile(child, queue, counter);
        break;
      default: break;
    }
  } catch (e) {
    r = { rc: e.code ? ReturnCode.FileSystemError : ReturnCode.LogicError, error: e.message };
  }
  if (r.rc === ReturnCode.Good || r.rc === ReturnCode.Cancel) return r.rc;
  const msg = {
    [ReturnCode.FindFixesMissingFileGroups]: 'You Need to Find Fixes before Fixing.',
    [ReturnCode.FindFixesInvalidStatus]: 'You Need to Find Fixes before Fixing. (Incorrect File Status\'s found for fixing.)',
    [ReturnCode.ToSortNotFound]: 'Your Primary ToSort directory could not be found.',
  }[r.rc] || `${r.error}${r.rc === ReturnCode.FileSystemError ? `\n${r.rc}` : ''}`;
  Report.error(child.FullName, msg);
  ctx.failed = { file: child.FullName, rc: r.rc, message: msg };
  return r.rc;
}

module.exports = { performFixes };
