// Custom wallpapers: pictures uploaded from a device or copied from a shared folder, kept in a
// "wallpapers" folder next to config.json. Files are checked by their contents, not their name.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_COUNT = 24;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };

class WallpaperError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Work out the image type from the first bytes of the file.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]/.test(buf.subarray(8, 12).toString('latin1'))) return 'avif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

async function readHead(file, n = 512) {
  const fh = await fsp.open(file, 'r');
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(n), 0, n, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

const cleanName = (name) => String(name || 'Wallpaper').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\p{L}\p{N} ._()-]+/gu, ' ').trim().slice(0, 60) || 'Wallpaper';

function createWallpapers(dir) {
  const indexFile = path.join(dir, 'index.json');

  async function readIndex() {
    try { return JSON.parse(await fsp.readFile(indexFile, 'utf8')); } catch { return []; }
  }
  async function writeIndex(list) {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${indexFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(list, null, 2));
    await fsp.rename(tmp, indexFile);
  }
  const publicEntry = (w) => ({ id: w.id, name: w.name, type: w.type, size: w.size, added: w.added, url: `/portal/wallpapers/${w.file}` });

  // Take a finished temporary file, check it is a picture, and add it to the list.
  async function adopt(tmp, name) {
    try {
      const type = sniff(await readHead(tmp));
      if (!type) throw new WallpaperError(415, 'That file is not a picture MediaDesk can use (JPEG, PNG, WebP, GIF, AVIF, BMP or SVG)');
      const list = await readIndex();
      if (list.length >= MAX_COUNT) throw new WallpaperError(409, `You can keep up to ${MAX_COUNT} wallpapers. Delete one first.`);
      const id = crypto.randomBytes(6).toString('hex');
      const file = `${id}.${type}`;
      await fsp.rename(tmp, path.join(dir, file));
      const size = (await fsp.stat(path.join(dir, file))).size;
      const entry = { id, file, name: cleanName(name), type, size, added: Date.now() };
      list.push(entry);
      await writeIndex(list);
      return publicEntry(entry);
    } finally {
      fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  async function upload(req, name) {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}`);
    let received = 0;
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > MAX_BYTES) cb(new WallpaperError(413, 'Pictures can be up to 40 MB'));
        else cb(null, chunk);
      },
    });
    try { await pipeline(req, limit, fs.createWriteStream(tmp)); }
    catch (err) { await fsp.rm(tmp, { force: true }); throw err; }
    return adopt(tmp, name);
  }

  async function fromFile(abs, name) {
    const st = await fsp.stat(abs);
    if (!st.isFile()) throw new WallpaperError(400, 'That is not a file');
    if (st.size > MAX_BYTES) throw new WallpaperError(413, 'Pictures can be up to 40 MB');
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.copy-${crypto.randomBytes(6).toString('hex')}`);
    await fsp.copyFile(abs, tmp);
    return adopt(tmp, name);
  }

  async function remove(id) {
    const list = await readIndex();
    const w = list.find((x) => x.id === id);
    if (!w) throw new WallpaperError(404, 'Wallpaper not found');
    await fsp.rm(path.join(dir, w.file), { force: true });
    await writeIndex(list.filter((x) => x !== w));
    return { deleted: id };
  }

  async function serve(req, res, file) {
    const list = await readIndex();
    const w = list.find((x) => x.file === file);
    if (!w) throw new WallpaperError(404, 'Wallpaper not found');
    const abs = path.join(dir, w.file);
    const st = await fsp.stat(abs);
    res.writeHead(200, {
      'Content-Type': TYPES[w.type],
      'Content-Length': st.size,
      // File names are random and never reused, so browsers may keep them.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    await pipeline(fs.createReadStream(abs), res).catch(() => {});
  }

  // resolveSharedFile(root, path) -> absolute path inside a shared folder (throws if not allowed).
  async function handle(req, res, url, { sendJson, readJson, resolveSharedFile }) {
    const route = url.pathname.slice('/portal/wallpapers'.length).replace(/^\//, '');
    try {
      if (!route && req.method === 'GET') return sendJson(res, 200, (await readIndex()).map(publicEntry));
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!/^[a-f0-9]{12}\.[a-z]{3,4}$/.test(route)) throw new WallpaperError(404, 'Not found');
        return await serve(req, res, route);
      }
      if (req.method !== 'POST') throw new WallpaperError(405, 'Method not allowed');
      if (route === 'upload') return sendJson(res, 200, await upload(req, url.searchParams.get('name')));
      const b = await readJson(req);
      if (route === 'from-file') {
        const abs = await resolveSharedFile(b.root, b.path);
        return sendJson(res, 200, await fromFile(abs, path.basename(String(b.path || ''))));
      }
      if (route === 'delete') return sendJson(res, 200, await remove(String(b.id || '')));
      throw new WallpaperError(404, 'Unknown wallpaper action');
    } catch (err) {
      if (res.headersSent) return res.end();
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      return sendJson(res, status, { error: err.status ? err.message : (err.code === 'ENOENT' ? 'Not found' : err.message) });
    }
  }

  return { handle, readIndex };
}

module.exports = { createWallpapers, sniff };
