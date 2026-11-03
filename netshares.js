// Network shares in Files: a Windows / NAS share (SMB), an NFS export, a folder over SSH (SFTP) or a
// WebDAV folder (Nextcloud, ownCloud, a NAS…), connected by the MediaDesk server and shown as one of
// Files' shared folders. The server mounts each one into a folder of its own (next to config.json),
// so every app that reads shared folders (Files, Music, Preview, the eBook Reader…) can use it like
// any other folder. On Windows, an SMB share is connected with `net use` and used by its
// \\server\share address instead.
//
// Mounting needs the tools for it on the server (cifs-utils, nfs-common, sshfs, davfs2 — the Docker
// image has them) and permission to mount (root, or a Docker container with the SYS_ADMIN
// capability). Passwords stay in config.json on the server and are never sent to the browser.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const TYPES = {
  smb: 'Windows share (SMB)',
  nfs: 'NFS',
  sftp: 'SFTP (SSH)',
  webdav: 'WebDAV',
};
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Where a share's files are: its own folder in <config folder>/network, or on Windows its \\server\share address.
const rootFor = (dataDir, s) => (isWin ? `\\\\${s.host}\\${s.share}${s.path ? `\\${s.path.replace(/\//g, '\\')}` : ''}` : path.join(dataDir, 'network', s.id));

class ShareError extends Error { constructor(status, message) { super(message); this.status = status; } }

const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

// Run a command (no shell), feeding it `input`, giving up after `ms`.
function run(cmd, args, { input = null, ms = 45e3, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true }); } catch (err) { resolve({ code: -1, out: err.message, missing: err.code === 'ENOENT' }); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: -1, out: `${out}\ntimed out`, timedOut: true }); }, ms);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message, missing: err.code === 'ENOENT' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); } else child.stdin.end();
  });
}

// What went wrong, in words people can act on.
function explain(share, r) {
  const o = (r.out || '').toLowerCase();
  const tool = { smb: isMac ? 'mount_smbfs' : 'mount.cifs (the cifs-utils package)', nfs: 'mount.nfs (the nfs-common package)', sftp: 'sshfs', webdav: 'mount.davfs (the davfs2 package)' }[share.type];
  if (r.missing || /not found|no such file or directory.*mount\.|unknown filesystem type|helper program/.test(o)) return `The MediaDesk server can’t connect ${TYPES[share.type]} shares: ${tool} isn’t installed there.`;
  if (r.timedOut || /timed out|timeout/.test(o)) return `${share.host} didn’t answer. Check the server name or address, and that it’s switched on and reachable from the MediaDesk server.`;
  if (/filesystem not supported|no such device|fuse: device not found|\/dev\/fuse/.test(o)) return `The MediaDesk server’s system can’t connect ${TYPES[share.type]} shares (its kernel has no support for them${share.type === 'sftp' || share.type === 'webdav' ? ': in Docker, add the device /dev/fuse' : ''}).`;
  if (/only root|must be superuser|operation not permitted|permission denied.*mount|not permitted/.test(o) && !/error\(13\)/.test(o)) return 'MediaDesk isn’t allowed to connect network shares. Run it as root, or in Docker give the container the SYS_ADMIN capability (see the README), or connect the share on the host and add that folder instead.';
  if (/error\(13\)|permission denied|access denied|logon failure|authentication failed|401|nt_status_logon_failure|password/.test(o)) return 'The user name or password wasn’t accepted.';
  if (/error\(2\)|no such file|not found|bad share name|does not exist|404|nt_status_bad_network_name/.test(o)) return `${share.host} has no share or folder called “${share.share || share.path}”.`;
  if (/host is down|no route|unreachable|could not resolve|name or service not known|connection refused|error\(112\)|error\(115\)|system error 53|system error 67/.test(o)) return `Couldn’t reach ${share.host}. Check the server name or address.`;
  if (/host key|verification failed/.test(o)) return `${share.host}’s SSH key has changed since it was first connected. If that’s expected, remove the share and add it again.`;
  return (r.out || 'It couldn’t be connected').split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
}

function createNetShares({ dataDir, getShares, setShares, log = console.log, mock = false }) {
  const base = path.join(dataDir, 'network');
  const state = new Map(); // id -> { status: 'connected' | 'connecting' | 'error' | 'off', error, at }

  const rootOf = (s) => rootFor(dataDir, s);
  const label = (s) => ({ smb: `\\\\${s.host}\\${s.share}${s.path ? `\\${s.path}` : ''}`, nfs: `${s.host}:${s.share}`, sftp: `sftp://${s.username ? `${s.username}@` : ''}${s.host}${s.port ? `:${s.port}` : ''}${s.share || '/'}`, webdav: s.url }[s.type]);

  // Mounted: the folder is on another device than the folder it's in.
  // On Linux this reads the list of mounts, never the share itself: a share whose server stopped
  // answering can hang anything that looks inside it (and stat-ing it would hang the server).
  let mountsAt = 0, mountList = null;
  function mountPoints() {
    if (Date.now() - mountsAt > 1500 || !mountList) {
      mountsAt = Date.now();
      try { mountList = new Set(fs.readFileSync('/proc/self/mounts', 'utf8').split('\n').map((l) => (l.split(' ')[1] || '').replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\'))); } catch { mountList = false; }
    }
    return mountList;
  }
  function mounted(s) {
    if (mock) return state.get(s.id)?.status === 'connected';
    if (isWin) return state.get(s.id)?.status === 'connected';
    const list = mountPoints();
    if (list) return list.has(path.resolve(rootOf(s)));
    try { return fs.statSync(rootOf(s)).dev !== fs.statSync(base).dev; } catch { return false; }
  }

  async function mountOne(s) {
    if (mock) { state.set(s.id, { status: 'connected', at: Date.now() }); return; }
    const mp = rootOf(s);
    state.set(s.id, { status: 'connecting', at: Date.now() });
    if (!isWin) {
      await fsp.mkdir(mp, { recursive: true });
      if (mounted(s)) { state.set(s.id, { status: 'connected', at: Date.now() }); return; }
    }
    const uid = process.getuid?.() ?? 0, gid = process.getgid?.() ?? 0;
    const ro = s.readOnly;
    let r;
    const secret = path.join(base, `.${s.id}`);
    try {
      if (s.type === 'smb') {
        if (isWin) {
          const user = s.username ? [`/user:${s.domain ? `${s.domain}\\` : ''}${s.username}`] : [];
          r = await run('net', ['use', `\\\\${s.host}\\${s.share}`, ...(s.password ? [s.password] : []), ...user, '/persistent:no']);
          if (r.code !== 0 && /1219|multiple connections/i.test(r.out)) r = { code: 0, out: '' }; // already connected as this user
        } else if (isMac) {
          const auth = s.username ? `${s.domain ? `${encodeURIComponent(s.domain)};` : ''}${encodeURIComponent(s.username)}${s.password ? `:${encodeURIComponent(s.password)}` : ''}@` : 'guest:@';
          r = await run('mount_smbfs', [...(ro ? ['-o', 'rdonly'] : []), `//${auth}${s.host}/${encodeURIComponent(s.share)}${s.path ? `/${s.path}` : ''}`, mp]);
        } else {
          // The password goes in a file only the server can read (never on the command line).
          await fsp.writeFile(secret, `username=${s.username || ''}\npassword=${s.password || ''}\n${s.domain ? `domain=${s.domain}\n` : ''}`, { mode: 0o600 });
          const opts = [s.username ? `credentials=${secret}` : 'guest', `uid=${uid}`, `gid=${gid}`, 'file_mode=0664', 'dir_mode=0775', 'iocharset=utf8', 'soft', 'nounix', 'noserverino', ...(s.version && s.version !== 'auto' ? [`vers=${s.version}`] : []), ...(ro ? ['ro'] : [])];
          r = await run('mount', ['-t', 'cifs', `//${s.host}/${s.share}${s.path ? `/${s.path}` : ''}`, mp, '-o', opts.join(',')]);
        }
      } else if (s.type === 'nfs') {
        if (isWin) throw new ShareError(400, 'On Windows, connect NFS exports in Windows itself (Services for NFS), then add the drive as a folder.');
        const opts = ['soft', 'timeo=150', 'retrans=2', ...(isMac ? ['resvport'] : []), ...(s.version && s.version !== 'auto' ? [`vers=${s.version}`] : []), ...(ro ? ['ro'] : [])];
        r = await run('mount', ['-t', 'nfs', '-o', opts.join(','), `${s.host}:${s.share}`, mp]);
      } else if (s.type === 'sftp') {
        if (isWin) throw new ShareError(400, 'On Windows, connect SFTP folders with SSHFS-Win in Windows itself, then add the drive as a folder.');
        const known = path.join(base, 'known_hosts');
        const opts = [`UserKnownHostsFile=${known}`, 'StrictHostKeyChecking=accept-new', 'reconnect', 'ServerAliveInterval=15', 'ServerAliveCountMax=3', 'ConnectTimeout=15', `uid=${uid}`, `gid=${gid}`, ...(s.password ? ['password_stdin'] : ['BatchMode=yes']), ...(ro ? ['ro'] : []), ...(s.port ? [`port=${s.port}`] : [])];
        r = await run('sshfs', [`${s.username ? `${s.username}@` : ''}${s.host}:${s.share || ''}`, mp, '-o', opts.join(',')], { input: s.password ? `${s.password}\n` : null });
      } else if (s.type === 'webdav') {
        if (isWin || isMac) throw new ShareError(400, `WebDAV folders are connected on Linux servers only. On ${isWin ? 'Windows' : 'macOS'}, connect it in the system itself, then add that folder.`);
        // davfs2 reads the user name and password from a secrets file of its own (given in a config file).
        const conf = `${secret}.conf`;
        const q = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;
        await fsp.writeFile(secret, `${q(s.url)} ${q(s.username || '')} ${q(s.password || '')}\n`, { mode: 0o600 });
        await fsp.writeFile(conf, `secrets ${secret}\nuse_locks 0\nask_auth 0\n`, { mode: 0o600 });
        r = await run('mount', ['-t', 'davfs', s.url, mp, '-o', [`conf=${conf}`, `uid=${uid}`, `gid=${gid}`, ...(ro ? ['ro'] : [])].join(',')]);
      } else throw new ShareError(400, 'Choose what kind of share it is');
    } finally {
      if (s.type === 'smb' && !isWin && !isMac) await fsp.rm(secret, { force: true }).catch(() => {});
    }
    mountsAt = 0; // look at the mounts afresh
    if (r.code === 0 && (isWin || mounted(s))) { state.set(s.id, { status: 'connected', at: Date.now() }); return; }
    const error = explain(s, r);
    state.set(s.id, { status: 'error', error, at: Date.now() });
    throw new ShareError(502, error);
  }

  async function unmountOne(s) {
    if (mock) { state.set(s.id, { status: 'off', at: Date.now() }); return; }
    if (isWin) await run('net', ['use', `\\\\${s.host}\\${s.share}`, '/delete', '/y']);
    else if (mounted(s)) {
      let r = await run('umount', [rootOf(s)]);
      if (r.code !== 0 && s.type === 'sftp') r = await run('fusermount', ['-u', rootOf(s)]);
      if (r.code !== 0) r = await run('umount', ['-l', rootOf(s)]); // busy: let go once nothing uses it
    }
    mountsAt = 0;
    state.set(s.id, { status: 'off', at: Date.now() });
    for (const f of [path.join(base, `.${s.id}`), path.join(base, `.${s.id}.conf`)]) await fsp.rm(f, { force: true }).catch(() => {});
  }

  // A share from the Settings form (keeping the saved password when none is typed).
  function fromBody(body, prev = {}) {
    const type = TYPES[body.type] ? body.type : prev.type;
    if (!type) throw new ShareError(400, 'Choose what kind of share it is');
    const s = { id: prev.id || crypto.randomBytes(6).toString('hex'), type, created: prev.created || Date.now() };
    s.name = clean(body.name ?? prev.name, 60);
    s.readOnly = body.readOnly !== undefined ? Boolean(body.readOnly) : Boolean(prev.readOnly);
    s.username = clean(body.username ?? prev.username, 120);
    s.password = typeof body.password === 'string' && body.password !== '' ? String(body.password).slice(0, 300) : body.clearPassword ? '' : prev.password || '';
    if (type === 'webdav') {
      s.url = clean(body.url ?? prev.url, 500);
      let u;
      try { u = new URL(s.url); } catch { throw new ShareError(400, 'Enter the WebDAV address, like https://cloud.example.com/remote.php/dav/files/me/'); }
      if (!/^https?:$/.test(u.protocol)) throw new ShareError(400, 'WebDAV addresses start with https:// or http://');
      s.host = u.hostname;
    } else {
      // "\\nas\media\Movies", "smb://nas/media", "nas:/export" and "nas" + share are all fine.
      let host = clean(body.host ?? prev.host, 255).replace(/^(smb|cifs|nfs|sftp|ssh):\/\//i, '').replace(/^[\\/]+/, '');
      let share = clean(body.share ?? prev.share, 300);
      let sub = clean(body.path ?? prev.path, 500);
      if (type === 'smb' && /[\\/]/.test(host)) { const parts = host.split(/[\\/]+/).filter(Boolean); host = parts[0]; share = share || parts[1] || ''; sub = sub || parts.slice(2).join('/'); }
      if ((type === 'nfs' || type === 'sftp') && /^[^:/]+:\//.test(host)) { const i = host.indexOf(':'); share = share || host.slice(i + 1); host = host.slice(0, i); }
      if (type === 'sftp' && host.includes('@')) { const i = host.lastIndexOf('@'); s.username = s.username || host.slice(0, i); host = host.slice(i + 1); }
      if (type === 'sftp' && /:\d+$/.test(host)) { s.port = Number(host.split(':').pop()); host = host.replace(/:\d+$/, ''); }
      if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$|^\[?[0-9a-f:.]+\]?$/i.test(host)) throw new ShareError(400, 'Enter the server’s name or address (like nas, nas.local or 192.168.1.20)');
      s.host = host;
      if (type === 'smb') {
        share = share.replace(/^[\\/]+|[\\/]+$/g, '');
        if (!share || /[\\/:*?"<>|]/.test(share)) throw new ShareError(400, 'Enter the share’s name (like media)');
        sub = sub.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
        s.share = share; s.path = sub;
        s.domain = clean(body.domain ?? prev.domain, 100);
        s.version = ['auto', '3.1.1', '3.0', '2.1', '2.0', '1.0'].includes(body.version ?? prev.version) ? body.version ?? prev.version : 'auto';
      } else {
        share = `/${share.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
        if (share.split('/').some((x) => x === '..')) throw new ShareError(400, 'That path isn’t right');
        if (type === 'nfs' && share === '/') throw new ShareError(400, 'Enter the export’s path (like /volume1/media)');
        s.share = share;
        if (type === 'nfs') s.version = ['auto', '4.2', '4.1', '4', '3'].includes(body.version ?? prev.version) ? body.version ?? prev.version : 'auto';
        if (type === 'sftp') s.port = Number(body.port ?? s.port ?? prev.port) || undefined;
        if (s.port && (s.port < 1 || s.port > 65535)) throw new ShareError(400, 'That port isn’t right');
      }
    }
    if (!s.name) s.name = type === 'smb' ? s.share : type === 'webdav' ? s.host : path.posix.basename(s.share) || s.host;
    if (getShares().some((x) => x.id !== s.id && x.name.toLowerCase() === s.name.toLowerCase())) throw new ShareError(409, 'There’s a network share with that name already');
    return s;
  }

  const view = (s) => ({
    id: s.id, type: s.type, typeName: TYPES[s.type], name: s.name, host: s.host, share: s.share || '', path: s.path || '', url: s.url || '', port: s.port || null,
    username: s.username || '', domain: s.domain || '', version: s.version || 'auto', readOnly: Boolean(s.readOnly), hasPassword: Boolean(s.password),
    label: label(s), root: rootOf(s), ...(mounted(s) ? { status: 'connected' } : { status: state.get(s.id)?.status === 'connecting' ? 'connecting' : 'error', error: state.get(s.id)?.error || 'Not connected' }),
  });

  async function add(body) {
    const s = fromBody(body);
    try { await mountOne(s); } catch (err) {
      if (!isWin && !mounted(s)) await fsp.rmdir(rootOf(s)).catch(() => {});
      state.delete(s.id);
      throw err;
    }
    await setShares([...getShares(), s]);
    log(`Network share “${s.name}” (${label(s)}) connected`);
    return view(s);
  }
  async function update(id, body) {
    const prev = getShares().find((x) => x.id === id);
    if (!prev) throw new ShareError(404, 'That network share isn’t there any more');
    const s = fromBody(body, prev);
    await unmountOne(prev);
    try { await mountOne(s); } catch (err) {
      await mountOne(prev).catch(() => {}); // put the old one back
      throw err;
    }
    await setShares(getShares().map((x) => (x.id === id ? s : x)));
    return view(s);
  }
  async function remove(id) {
    const s = getShares().find((x) => x.id === id);
    if (!s) throw new ShareError(404, 'That network share isn’t there any more');
    await unmountOne(s);
    if (!isWin && !mounted(s)) await fsp.rmdir(rootOf(s)).catch(() => {});
    await setShares(getShares().filter((x) => x.id !== id));
    state.delete(id);
  }
  async function reconnect(id) {
    const s = getShares().find((x) => x.id === id);
    if (!s) throw new ShareError(404, 'That network share isn’t there any more');
    if (!isWin && mounted(s)) await unmountOne(s);
    await mountOne(s);
    return view(s);
  }
  // At start: connect them all (one at a time, without holding anything up).
  async function connectAll() {
    for (const s of getShares()) {
      try { await mountOne(s); log(`Network share “${s.name}” connected`); } catch (err) { log(`Network share “${s.name}” (${label(s)}) couldn’t be connected: ${err.message}`); }
    }
  }
  // Every couple of minutes: reconnect shares that dropped.
  const timer = setInterval(async () => {
    for (const s of getShares()) {
      if (state.get(s.id)?.status === 'connecting' || mounted(s)) continue;
      if (Date.now() - (state.get(s.id)?.at || 0) < 110e3) continue;
      await mountOne(s).catch(() => {});
    }
  }, 120e3);
  timer.unref?.();

  // For Files: the share whose folder this is, and whether it can be used now.
  const byRoot = (abs) => getShares().find((s) => path.resolve(rootOf(s)) === path.resolve(abs)) || null;
  function offline(abs) {
    const s = byRoot(abs);
    if (!s || mounted(s)) return null;
    const st = state.get(s.id);
    return st?.status === 'connecting' ? `The network share “${s.name}” is connecting… try again in a moment.` : `The network share “${s.name}” isn’t connected${st?.error ? `: ${st.error}` : ''}.`;
  }
  const info = (abs) => { const s = byRoot(abs); return s ? { network: { id: s.id, type: s.type, label: label(s) }, offline: offline(abs) } : null; };

  async function handle(req, res, p, { sendJson, readJson }) {
    try {
      if (p === '/portal/netshares' && req.method === 'GET') return sendJson(res, 200, { shares: getShares().map(view), types: TYPES, platform: process.platform });
      if (p === '/portal/netshares' && req.method === 'POST') return sendJson(res, 200, { share: await add(await readJson(req)) });
      const m = /^\/portal\/netshares\/([a-f0-9]{12})(\/reconnect)?$/.exec(p);
      if (m && !m[2] && req.method === 'PUT') return sendJson(res, 200, { share: await update(m[1], await readJson(req)) });
      if (m && !m[2] && req.method === 'DELETE') { await remove(m[1]); return sendJson(res, 200, { ok: true }); }
      if (m && m[2] && req.method === 'POST') return sendJson(res, 200, { share: await reconnect(m[1]) });
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      if (err instanceof ShareError) return sendJson(res, err.status, { error: err.message });
      throw err;
    }
  }

  return { handle, connectAll, rootOf, offline, info, roots: () => getShares().map(rootOf), names: () => getShares().map((s) => [rootOf(s), s.name]) };
}

module.exports = { createNetShares, rootFor, TYPES, ShareError };
