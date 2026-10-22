// File manager API: browse and manage files inside the folders listed in config.fileRoots.
// Every path from the browser is resolved against one of those roots and rejected if it
// escapes it (including through symlinks or Windows junctions).

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const TEXT_LIMIT = 2 * 1024 * 1024;
const TEXT_EXT = new Set(['.txt', '.nfo', '.srt', '.ass', '.ssa', '.sub', '.vtt', '.log', '.md', '.json', '.xml', '.yml', '.yaml',
  '.ini', '.conf', '.cfg', '.config', '.csv', '.tsv', '.sh', '.bat', '.cmd', '.ps1', '.py', '.js', '.ts', '.css', '.html', '.htm',
  '.env', '.properties', '.toml', '.m3u', '.m3u8', '.cue', '.sfv', '.nzb', '.gitignore', '.dockerfile']);
// Only these types are ever shown inline; everything else downloads. Text is served as plain text.
const INLINE = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
};

class FileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const FRIENDLY = {
  ENOENT: [404, 'Not found — it may have been moved or deleted'],
  EEXIST: [409, 'Something with that name already exists'],
  ENOTEMPTY: [409, 'The folder is not empty'],
  EACCES: [403, 'Permission denied'],
  EPERM: [403, 'Permission denied, or the file is in use by another program'],
  EBUSY: [423, 'The file is in use by another program'],
  ENOSPC: [507, 'The disk is full'],
  EISDIR: [400, 'That is a folder'],
  ENOTDIR: [400, 'That is not a folder'],
  EXDEV: [400, 'Cannot move across drives'],
  ENAMETOOLONG: [400, 'The name is too long'],
};

function toFileError(err) {
  if (err instanceof FileError) return err;
  const f = FRIENDLY[err.code];
  return f ? new FileError(f[0], `${f[1]} (${err.code})`) : new FileError(500, err.message);
}

// --- Roots & path safety -----------------------------------------------------

const isWin = process.platform === 'win32';
const norm = (p) => (isWin ? p.toLowerCase() : p);
const within = (child, parent) => {
  const c = norm(child), pr = norm(parent);
  return c === pr || c.startsWith(pr.endsWith(path.sep) ? pr : pr + path.sep);
};

function rootList(config) {
  const raw = Array.isArray(config.fileRoots) ? config.fileRoots : [];
  return raw.filter((r) => typeof r === 'string' && r.trim()).map((r, id) => {
    const abs = path.resolve(r.trim());
    return { id, path: abs, name: path.basename(abs) || abs };
  });
}

function getRoot(config, id) {
  const root = rootList(config)[Number(id)];
  if (!root) throw new FileError(404, 'Unknown folder root');
  return root;
}

function checkName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new FileError(400, 'A name is required');
  if (name === '.' || name === '..' || /[\\/\0]/.test(name) || (isWin && /[<>:"|?*]/.test(name))) {
    throw new FileError(400, `“${name}” is not a valid name`);
  }
  if (isWin && /[. ]$/.test(name)) throw new FileError(400, 'Names cannot end with a dot or space on Windows');
  if (isWin && /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) throw new FileError(400, `“${name}” is a reserved name on Windows`);
  return name;
}

// Resolve `rel` (a "/"-separated path relative to the root) to an absolute path inside the root.
async function resolveIn(root, rel = '') {
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.')) throw new FileError(400, 'Invalid path');
  const abs = path.resolve(root.path, ...parts);
  if (!within(abs, root.path)) throw new FileError(400, 'Path is outside the allowed folder');
  // Follow symlinks/junctions on the deepest existing ancestor and make sure it stays inside.
  const realRoot = await fsp.realpath(root.path).catch(() => { throw new FileError(404, `Folder root ${root.path} is not reachable`); });
  let probe = abs;
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      if (!within(real, realRoot)) throw new FileError(403, 'That link points outside the allowed folder');
      break;
    } catch (err) {
      if (err instanceof FileError) throw err;
      const up = path.dirname(probe);
      if (up === probe || !within(up, root.path)) break;
      probe = up;
    }
  }
  return abs;
}

const relOf = (root, abs) => path.relative(root.path, abs).split(path.sep).join('/');

async function diskSpace(p) {
  if (!fsp.statfs) return null;
  try {
    const s = await fsp.statfs(p);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}

async function uniquePath(abs) {
  const dir = path.dirname(abs), ext = path.extname(abs), base = path.basename(abs, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i === 1 ? 'copy' : `copy ${i}`})${ext}`);
    try { await fsp.lstat(candidate); } catch { return candidate; }
  }
  throw new FileError(409, 'Too many copies');
}

async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }

// --- Handlers ------------------------------------------------------------------

async function listDir(root, rel, showHidden) {
  const abs = await resolveIn(root, rel);
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new FileError(400, 'That is not a folder');
  const dirents = await fsp.readdir(abs, { withFileTypes: true });
  const entries = await Promise.all(dirents
    .filter((d) => showHidden || !d.name.startsWith('.'))
    .map(async (d) => {
      const full = path.join(abs, d.name);
      try {
        const s = await fsp.stat(full);
        return { name: d.name, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, modified: s.mtimeMs, link: d.isSymbolicLink() };
      } catch {
        return { name: d.name, dir: d.isDirectory(), size: null, modified: null, error: true };
      }
    }));
  return { root: root.id, path: relOf(root, abs), entries };
}

async function sendFile(req, res, root, rel, inline) {
  const abs = await resolveIn(root, rel);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new FileError(400, 'Folders cannot be downloaded; select files instead');
  const ext = path.extname(abs).toLowerCase();
  const name = path.basename(abs);
  let type = 'application/octet-stream';
  let disposition = 'attachment';
  if (inline && INLINE[ext]) { type = INLINE[ext]; disposition = 'inline'; }
  else if (inline && TEXT_EXT.has(ext)) { type = 'text/plain; charset=utf-8'; disposition = 'inline'; }

  const headers = {
    'Content-Type': type,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': 'private, no-cache',
    // Never let a stored file run script on the portal's origin (e.g. an .svg or .html).
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
  };
  let start = 0, end = st.size - 1, status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && st.size > 0) {
    if (range[1] === '') { start = Math.max(0, st.size - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = st.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !st.size) return res.end();
  await pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {});
}

async function readText(root, rel) {
  const abs = await resolveIn(root, rel);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new FileError(400, 'That is a folder');
  if (st.size > TEXT_LIMIT) throw new FileError(413, 'File is too large to edit here (limit 2 MB)');
  const buf = await fsp.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new FileError(415, 'This looks like a binary file');
  return { text: buf.toString('utf8').replace(/^\uFEFF/, ''), modified: st.mtimeMs, bom: buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf };
}

async function writeText(root, rel, text, expectedModified, bom) {
  const abs = await resolveIn(root, rel);
  const st = await fsp.stat(abs);
  if (expectedModified && Math.abs(st.mtimeMs - expectedModified) > 1) {
    throw new FileError(409, 'The file was changed by something else since you opened it. Reload it before saving.');
  }
  // Write in place so the file keeps its permissions, owner and any hard links.
  await fsp.writeFile(abs, (bom ? '\uFEFF' : '') + String(text));
  return { modified: (await fsp.stat(abs)).mtimeMs };
}

async function upload(req, res, root, rel, name, overwrite) {
  checkName(name);
  const dir = await resolveIn(root, rel);
  const dest = await resolveIn(root, path.posix.join(rel || '', name));
  if (path.dirname(dest) !== dir) throw new FileError(400, 'Invalid name');
  if (!overwrite && await exists(dest)) throw new FileError(409, `“${name}” already exists`);
  const tmp = `${dest}.mdpart`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  const st = await fsp.stat(dest);
  return { name, size: st.size };
}

async function mkdir(root, rel, name) {
  checkName(name);
  const dest = await resolveIn(root, path.posix.join(rel || '', name));
  await fsp.mkdir(dest);
  return { name };
}

async function rename(root, rel, newName) {
  checkName(newName);
  const src = await resolveIn(root, rel);
  if (norm(src) === norm(root.path)) throw new FileError(400, 'Cannot rename a root folder');
  const dest = path.join(path.dirname(src), newName);
  await resolveIn(root, relOf(root, dest));
  // Allow case-only renames on case-insensitive file systems.
  if (norm(dest) !== norm(src) && await exists(dest)) throw new FileError(409, `“${newName}” already exists`);
  await fsp.rename(src, dest);
  return { name: newName };
}

async function remove(root, rels) {
  const done = [];
  for (const rel of rels) {
    const abs = await resolveIn(root, rel);
    if (norm(abs) === norm(root.path)) throw new FileError(400, 'Cannot delete a root folder');
    await fsp.rm(abs, { recursive: true });
    done.push(rel);
  }
  return { deleted: done.length };
}

async function transfer(mode, root, rels, destRoot, destRel) {
  const destDir = await resolveIn(destRoot, destRel);
  if (!(await fsp.stat(destDir)).isDirectory()) throw new FileError(400, 'Destination is not a folder');
  let count = 0;
  for (const rel of rels) {
    const src = await resolveIn(root, rel);
    if (norm(src) === norm(root.path)) throw new FileError(400, 'Cannot move or copy a root folder');
    let dest = path.join(destDir, path.basename(src));
    const srcIsDir = (await fsp.stat(src)).isDirectory();
    if (srcIsDir && within(dest, src)) throw new FileError(400, `Cannot put “${path.basename(src)}” inside itself`);
    if (norm(dest) === norm(src)) {
      if (mode === 'move') continue;
      dest = await uniquePath(dest);
    } else if (await exists(dest)) {
      if (mode === 'move') throw new FileError(409, `“${path.basename(src)}” already exists in the destination`);
      dest = await uniquePath(dest);
    }
    if (mode === 'move') {
      try { await fsp.rename(src, dest); }
      catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        await fsp.rm(src, { recursive: true });
      }
    } else {
      await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    }
    count++;
  }
  return { count };
}

// --- Router ----------------------------------------------------------------------

async function handle(req, res, url, { config, sendJson, readJson }) {
  const route = url.pathname.slice('/portal/files/'.length);
  const q = url.searchParams;
  try {
    if (route === 'roots') {
      const roots = await Promise.all(rootList(config).map(async (r) => ({ ...r, ...(await diskSpace(r.path)), ok: await exists(r.path) })));
      return sendJson(res, 200, roots);
    }
    if (route === 'list') return sendJson(res, 200, await listDir(getRoot(config, q.get('root')), q.get('path'), q.get('hidden') === '1'));
    if (route === 'download') return await sendFile(req, res, getRoot(config, q.get('root')), q.get('path'), q.get('inline') === '1');
    if (route === 'text' && req.method === 'GET') return sendJson(res, 200, await readText(getRoot(config, q.get('root')), q.get('path')));
    if (route === 'upload' && req.method === 'POST') {
      return sendJson(res, 200, await upload(req, res, getRoot(config, q.get('root')), q.get('path'), q.get('name'), q.get('overwrite') === '1'));
    }
    if (req.method !== 'POST') throw new FileError(405, 'Method not allowed');
    const b = await readJson(req);
    const root = getRoot(config, b.root);
    switch (route) {
      case 'text': return sendJson(res, 200, await writeText(root, b.path, b.text, b.modified, b.bom));
      case 'mkdir': return sendJson(res, 200, await mkdir(root, b.path, b.name));
      case 'rename': return sendJson(res, 200, await rename(root, b.path, b.name));
      case 'delete': return sendJson(res, 200, await remove(root, b.paths || []));
      case 'move': case 'copy':
        return sendJson(res, 200, await transfer(route, root, b.paths || [], getRoot(config, b.destRoot ?? b.root), b.destPath));
      default: throw new FileError(404, 'Unknown file action');
    }
  } catch (err) {
    const e = toFileError(err);
    if (res.headersSent) return res.end();
    return sendJson(res, e.status, { error: e.message });
  }
}

// Check user-supplied root folders before saving them.
async function validateRoots(list) {
  const out = [], errors = [];
  for (const raw of list) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (!path.isAbsolute(p)) { errors.push(`${p}: use a full path, like ${isWin ? 'D:\\Media' : '/mnt/media'}`); continue; }
    try {
      if (!(await fsp.stat(p)).isDirectory()) errors.push(`${p}: not a folder`);
      else out.push(path.resolve(p));
    } catch (err) { errors.push(`${p}: ${err.code === 'ENOENT' ? 'folder not found' : toFileError(err).message}`); }
  }
  return { roots: [...new Set(out)], errors };
}

module.exports = { handle, rootList, validateRoots };
