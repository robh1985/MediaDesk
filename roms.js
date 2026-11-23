// ROM Manager: keeps a ROM collection matched to DAT files, with RomVault's engine (romvault/, a JavaScript port of
// RomVault by Gordon J, Apache-2.0). The engine runs in a worker thread (romvault/worker.js); this file starts it,
// passes requests to it and serves /portal/roms/… for the app (public/js/apps/roms.js).
//
// Looking is for everyone who has the app. Changing anything (ticks, settings, jobs) needs canChange: admins and
// Family Organizer parents.
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

class RomError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function createRoms({ dataDir, mock = false, getSevenZip = async () => null, demo = null }) {
  const dir = path.join(dataDir, 'roms');
  fs.mkdirSync(dir, { recursive: true });
  const cancelBuf = new SharedArrayBuffer(4);
  const cancelFlag = new Int32Array(cancelBuf);
  let worker = null;
  let seq = 0;
  const pending = new Map();
  let job = null;
  let ready = null;
  let closing = false;
  // The worker's job snapshots can arrive out of order: a quick job's "finished" message can beat the reply that
  // started it. Keep whichever is newest, so a finished job never goes back to "running".
  const takeJob = (j) => { if (!j || !job || j.id > job.id || (j.id === job.id && (j.rev || 0) >= (job.rev || 0))) job = j; return job; };

  function start() {
    worker = new Worker(path.join(__dirname, 'romvault', 'worker.js'), { workerData: { dataDir: dir, cancelBuf } });
    worker.on('message', (m) => {
      if (m?.type === 'job') { takeJob(m.job); return; }
      const p = pending.get(m?.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new RomError(m.status || 500, m.error));
    });
    worker.on('error', (err) => console.error(`ROM Manager: ${err.stack || err.message}`));
    worker.on('exit', (code) => {
      for (const p of pending.values()) p.reject(new RomError(500, 'The ROM Manager engine stopped. Try again.'));
      pending.clear();
      worker = null;
      if (job?.state === 'running') job = { ...job, state: 'error', error: `The engine stopped (code ${code})` };
      if (code !== 0 && !closing) console.error(`ROM Manager: engine exited with code ${code}; it restarts on the next request`);
    });
  }
  function call(cmd, args = {}) {
    if (!worker) start();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, cmd, args });
    });
  }
  async function set7z() { try { await call('set7z', { path: await getSevenZip() }); } catch { /* reported when a 7z is needed */ } }

  async function init() {
    if (demo) {
      const d = await demo(dir);
      await call('saveSettings', { DatRoot: d.datRoot, RomRoot: d.romRoot, ToSort: d.toSort });
      for (const r of d.rules || []) await call('saveRule', r);
    }
    await set7z();
    const st = await call('status');
    takeJob(st.job);
    if (demo) {
      await call('job', { type: 'updateDats' });
      await waitIdle();
      await call('job', { type: 'scan', level: 1 });
      await waitIdle();
      await call('job', { type: 'findFixes' });
      await waitIdle();
    }
  }
  async function waitIdle() {
    for (let i = 0; i < 600; i++) {
      const st = await call('status');
      if (!st.job || st.job.state !== 'running') { takeJob(st.job); return; }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function zipOf(list) {
    const { ZipWriter } = require('./romvault/compress/zip');
    const { ZipStructure } = require('./romvault/enums');
    const { Readable } = require('node:stream');
    const tmp = path.join(dir, `fixdats-${crypto.randomUUID().slice(0, 8)}.zip`);
    const w = await ZipWriter.create(tmp, ZipStructure.ZipTrrnt);
    list.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    for (const x of list) {
      const buf = Buffer.from(x.xml, 'utf8');
      const r = await w.addEntry({ name: x.name, size: buf.length, method: 8, source: Readable.from([buf]) });
      if (r.zr !== 0) { await w.closeFailed(); throw new RomError(500, `Could not zip ${x.name}`); }
    }
    await w.close();
    return tmp;
  }

  // Folder picker for the setup page: the folders on the MediaDesk server (drive letters first on Windows).
  async function browse(where) {
    const win = process.platform === 'win32';
    if (!where) {
      if (win) {
        const drives = [];
        for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { await fsp.access(`${l}:\\`); drives.push(`${l}:\\`); } catch { /* no such drive */ } }
        return { path: '', parent: null, dirs: drives, full: true };
      }
      where = '/';
    }
    if (!path.isAbsolute(where)) throw new RomError(400, 'Type a full path, for example D:\\ROMs');
    const at = path.resolve(where);
    let ents;
    try { ents = await fsp.readdir(at, { withFileTypes: true }); } catch { throw new RomError(400, `Can’t open ${at}. Check it exists and MediaDesk can read it.`); }
    const dirs = ents.filter((e) => e.isDirectory() && !/^(\$|System Volume Information$)/.test(e.name)).map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    const up = path.dirname(at);
    return { path: at, parent: up !== at ? up : win ? '' : null, dirs: dirs.slice(0, 3000) };
  }

  const textOut = (res, text, name, download) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) });
    res.end(text);
  };
  const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

  async function handle(req, res, url, { sendJson, readJson, canChange }) {
    const p = url.pathname.replace(/^\/portal\/roms/, '') || '/';
    const q = url.searchParams;
    const change = () => { if (!canChange) throw new RomError(403, 'Only a parent or an admin can change the ROM collection'); };
    const post = req.method === 'POST';
    try {
      await (ready ||= init().catch((err) => { console.error(`ROM Manager: ${err.stack || err.message}`); }));
      if (p === '/status' && !post) { const st = await call('status'); return sendJson(res, 200, { ...st, job: takeJob(st.job), canChange, mock }); }
      if (p === '/job' && !post) return sendJson(res, 200, { job });
      if (p === '/tree' && !post) return sendJson(res, 200, await call('tree'));
      if (p === '/games' && !post) {
        let show = {};
        try { show = JSON.parse(q.get('show') || '{}'); } catch { show = {}; }
        return sendJson(res, 200, await call('games', { id: q.get('id') || '', q: q.get('q') || '', show }));
      }
      if (p === '/roms' && !post) return sendJson(res, 200, await call('roms', { id: q.get('id') || '', game: q.get('game'), showMerged: q.get('merged') === '1' }));
      if (p === '/browse' && !post) { change(); return sendJson(res, 200, await browse(q.get('path') || '')); }
      if (p === '/settings' && !post) return sendJson(res, 200, await call('settings'));
      if (p === '/fixlog' && !post) return sendJson(res, 200, await call('fixLog'));
      if (p === '/errors' && !post) return sendJson(res, 200, { errors: await call('errors') });
      if (p === '/report' && !post) {
        const kind = q.get('kind') === 'fix' ? 'fix' : 'full';
        return textOut(res, await call('report', { kind }), `${kind === 'fix' ? 'RVFixReport' : 'RVFullReport'} (${stamp()}).txt`, q.get('download') === '1');
      }
      if (p === '/fixdat' && !post) {
        const r = await call('fixDats', { id: q.get('id') || '', redOnly: q.get('red') !== '0' });
        if (!r.files.length) throw new RomError(404, 'Nothing is missing there, so there’s no fix DAT to make.');
        if (r.files.length === 1) {
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.files[0].name.replace(/"/g, '')}"` });
          return res.end(r.files[0].xml);
        }
        const tmp = await zipOf(r.files);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="fixDats (${stamp()}).zip"` });
        const s = fs.createReadStream(tmp);
        s.pipe(res);
        s.on('close', () => { fsp.rm(tmp, { force: true }).catch(() => {}); });
        return undefined;
      }
      if (!post) return sendJson(res, 404, { error: 'Unknown endpoint' });

      change();
      const body = await readJson(req);
      switch (p) {
        case '/job': {
          if (!['all', 'updateDats', 'refreshDats', 'scan', 'findFixes', 'fix', 'auto'].includes(body.type)) throw new RomError(400, 'Unknown job');
          await set7z();
          Atomics.store(cancelFlag, 0, 0);
          takeJob(await call('job', { type: body.type, level: body.level, id: typeof body.id === 'string' ? body.id : '' }));
          return sendJson(res, 200, { job });
        }
        case '/cancel':
          Atomics.store(cancelFlag, 0, 1);
          return sendJson(res, 200, { job });
        case '/check': return sendJson(res, 200, await call('check', { id: String(body.id ?? ''), value: body.value, shift: !!body.shift }));
        case '/expand': return sendJson(res, 200, await call('expand', { id: String(body.id ?? ''), value: !!body.value, children: !!body.children }));
        case '/preset': return sendJson(res, 200, await call('preset', { n: body.n, save: !!body.save }));
        case '/settings':
          if (mock && (body.DatRoot !== undefined || body.RomRoot !== undefined || body.ToSort !== undefined)) throw new RomError(400, 'Folders can’t be changed in demo mode');
          return sendJson(res, 200, await call('saveSettings', body));
        case '/rule': return sendJson(res, 200, await call('saveRule', body));
        case '/rule/delete': return sendJson(res, 200, await call('deleteRule', body));
        case '/mapping':
          if (mock) throw new RomError(400, 'Folders can’t be changed in demo mode');
          return sendJson(res, 200, await call('saveMapping', body));
        case '/mapping/delete': return sendJson(res, 200, await call('deleteMapping', body));
        case '/tosort':
          if (mock && body.action === 'add') throw new RomError(400, 'Folders can’t be changed in demo mode');
          return sendJson(res, 200, await call('toSort', body));
        case '/fixdats': return sendJson(res, 200, await call('fixDats', { id: typeof body.id === 'string' ? body.id : '', redOnly: body.redOnly !== false, save: true }));
        default: return sendJson(res, 404, { error: 'Unknown endpoint' });
      }
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // Save ticks and expanded folders before the server stops.
  async function close() { closing = true; if (worker) { try { await call('flush'); } catch { /* stopping anyway */ } await worker.terminate(); } }

  return { handle, close, _call: call, _init: () => (ready ||= init()) };
}

module.exports = { createRoms };
