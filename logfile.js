'use strict';
// The log file (logs\mediadesk.log on Windows) is UTF-8. Windows tools that don't know that, such
// as Windows PowerShell's Get-Content and older Notepad, read it as the local code page and turn
// ’ “ ” — → into â€™ â€œ â€ â€” â†’. A byte-order mark at the start tells them it's UTF-8.
// MediaDesk's own Log Viewer reads it either way.

const fs = require('node:fs');
const path = require('node:path');

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const MAX_REWRITE = 64 * 1024 * 1024; // add the mark to older logs up to this size

// Make sure the log's folder exists and the file starts with the UTF-8 byte-order mark: a new or
// empty file gets one; an older log written without one gets it added in front.
function prepareLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let size = -1;
  try { size = fs.statSync(file).size; } catch { /* not there yet */ }
  if (size <= 0) { fs.writeFileSync(file, BOM); return; }
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(3);
  try { fs.readSync(fd, head, 0, 3, 0); } finally { fs.closeSync(fd); }
  if (head.equals(BOM) || size > MAX_REWRITE) return;
  const tmp = `${file}.bom-${process.pid}`;
  try {
    fs.writeFileSync(tmp, Buffer.concat([BOM, fs.readFileSync(file)]));
    fs.renameSync(tmp, file);
  } catch { fs.rmSync(tmp, { force: true }); /* leave the log as it is */ }
}

module.exports = { prepareLog, BOM };
