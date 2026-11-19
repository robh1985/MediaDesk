// Network shares in Files: a Windows / NAS share (SMB), an NFS export, a folder over SSH (SFTP) or a
// WebDAV folder (Nextcloud, ownCloud, a NAS…), connected by the MediaDesk server and shown as one of
// Files' shared folders. The server mounts each one into a folder of its own (next to config.json),
// so every app that reads shared folders (Files, Music, Preview, the eBook Reader…) can use it like
// any other folder. On Windows, an SMB share is connected with `net use` and used by its
// \\server\share address instead. Cloud storage (Google Drive, OneDrive, iCloud Drive, Dropbox…) is a
// share too: cloudstorage.js signs in and mounts it with rclone.
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
const { PROVIDERS, CloudError } = require('./cloudstorage');

const TYPES = {
  smb: 'Windows share (SMB)',
  nfs: 'NFS',
  sftp: 'SFTP (SSH)',
  webdav: 'WebDAV',
  ...Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.name])),
};
const isCloud = (s) => Boolean(PROVIDERS[s?.type]);
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Where a share's files are: its own folder in <config folder>/network, or on Windows its \\server\share address.
const rootFor = (dataDir, s) => (isWin && !isCloud(s) ? `\\\\${s.host}\\${s.share}${s.path ? `\\${s.path.replace(/\//g, '\\')}` : ''}` : path.join(dataDir, 'network', s.id));

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

function createNetShares({ dataDir, getShares, setShares, cloud = null, getCloudSettings = () => ({}), setCloudSettings = async () => {}, log = console.log, mock = false }) {
  const base = path.join(dataDir, 'network');
  const state = new Map(); // id -> { status: 'connected' | 'connecting' | 'error' | 'off', error, at }

  const rootOf = (s) => rootFor(dataDir, s);
  const label = (s) => (isCloud(s) ? [TYPES[s.type], cloud?.accountOf(s.id), s.type === 's3' ? (s.endpoint || '').replace(/^https?:\/\//, '') : '', [s.bucket, s.path].filter(Boolean).join('/')].filter(Boolean).join(' · ') : { smb: `\\\\${s.host}\\${s.share}${s.path ? `\\${s.path}` : ''}`, nfs: `${s.host}:${s.share}`, sftp: `sftp://${s.username ? `${s.username}@` : ''}${s.host}${s.port ? `:${s.port}` : ''}${s.share || '/'}`, webdav: s.url }[s.type]);
  const inMounts = (mp) => { mountsAt = 0; const list = mountPoints(); return list ? list.has(path.resolve(mp)) : false; };

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
    if (isCloud(s)) {
      if (!cloud?.running(s.id)) return false;
      if (isWin) return fs.existsSync(rootOf(s));
      const list = mountPoints();
      return list ? list.has(path.resolve(rootOf(s))) : true;
    }
    if (isWin) return state.get(s.id)?.status === 'connected';
    const list = mountPoints();
    if (list) return list.has(path.resolve(rootOf(s)));
    try { return fs.statSync(rootOf(s)).dev !== fs.statSync(base).dev; } catch { return false; }
  }

  async function mountOne(s) {
    if (mock) { state.set(s.id, { status: 'connected', at: Date.now() }); return; }
    const mp = rootOf(s);
    state.set(s.id, { status: 'connecting', at: Date.now() });
    if (isCloud(s)) {
      if (!cloud) throw new ShareError(503, 'Cloud storage isn’t available on this server');
      try { await cloud.mount(s, mp, { inMounts }); } catch (err) {
        state.set(s.id, { status: 'error', error: err.message, at: Date.now() });
        throw new ShareError(err.status || 502, err.message);
      }
      state.set(s.id, { status: 'connected', at: Date.now() });
      return;
    }
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
    if (isCloud(s)) { await cloud?.unmount(s, rootOf(s), { inMounts }); state.set(s.id, { status: 'off', at: Date.now() }); return; }
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
    if (isCloud(s)) {
      // Sign-in details go to rclone.conf (cloudstorage.js), never here.
      delete s.username;
      if (prev.offline) s.offline = prev.offline;
      const sub = (v) => clean(v, 500).replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
      s.path = sub(body.path ?? prev.path);
      if (type === 's3') {
        s.bucket = clean(body.bucket ?? prev.bucket, 100).replace(/^\/+|\/+$/g, '');
        if (!/^[a-z0-9][a-z0-9.\-_]{1,98}[a-z0-9]$/i.test(s.bucket)) throw new ShareError(400, 'Enter the bucket’s name');
        s.endpoint = clean(body.endpoint ?? prev.endpoint, 300);
        s.region = clean(body.region ?? prev.region, 60);
      }
      if (!s.name) s.name = TYPES[type];
      if (getShares().some((x) => x.id !== s.id && x.name.toLowerCase() === s.name.toLowerCase())) throw new ShareError(409, `There’s a shared folder called “${s.name}” already: give this one another name.`);
      return s;
    }
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
    username: (isCloud(s) ? cloud?.accountOf(s.id) : s.username) || '', domain: s.domain || '', version: s.version || 'auto', readOnly: Boolean(s.readOnly), hasPassword: Boolean(s.password),
    ...(isCloud(s) ? { cloud: true, bucket: s.bucket || '', endpoint: s.endpoint || '', region: s.region || '' } : {}),
    ...(isCloud(s) ? { offline: offlineView(s), ...(cloud?.usesSharedClient(s) ? { warning: 'Uses rclone’s shared Google app, which is being retired during 2026. Press Change, open “Use your own Google client ID”, and sign in again.' } : {}) } : {}),
    label: label(s), root: rootOf(s), ...(mounted(s) ? { status: 'connected' } : { status: state.get(s.id)?.status === 'connecting' ? 'connecting' : 'error', error: (state.get(s.id)?.status === 'connected' ? cloud?.lastError(s.id) : state.get(s.id)?.error) || cloud?.lastError(s.id) || 'Not connected' }),
  });

  async function add(body) {
    const waiting = body.pending ? cloud?.pendingShare(body.pending) : null;
    if (body.pending && !waiting) throw new ShareError(400, 'That sign-in has ended. Start again.');
    const s = waiting ? fromBody({ ...body, type: waiting.type }, { id: waiting.id, created: waiting.created }) : fromBody(body);
    if (isCloud(s)) {
      if (!cloud) throw new ShareError(503, 'Cloud storage isn’t available on this server');
      if (mock) throw new ShareError(400, 'Cloud storage can’t be connected in demo mode');
      try { await cloud.setUp(s, body); } catch (err) {
        if (!err.needCode && !waiting) cloud.forget(s.id); // a wrong code can be tried again
        throw err;
      }
    }
    try { await mountOne(s); } catch (err) {
      if (!isWin && !mounted(s)) await fsp.rmdir(rootOf(s)).catch(() => {});
      if (isCloud(s) && err.status !== 503) {
        // Signed in, but it wouldn't mount (no FUSE yet, say): keep it, so Reconnect can try again.
        await setShares([...getShares(), s]);
        throw new ShareError(err.status || 502, `${err.message} “${s.name}” is saved: press Reconnect once that’s fixed.`);
      }
      state.delete(s.id);
      if (isCloud(s)) cloud.forget(s.id);
      throw err;
    }
    await setShares([...getShares(), s]);
    log(`${isCloud(s) ? 'Cloud storage' : 'Network share'} “${s.name}” (${label(s)}) connected`);
    return view(s);
  }
  async function update(id, body) {
    const prev = getShares().find((x) => x.id === id);
    if (!prev) throw new ShareError(404, 'That network share isn’t there any more');
    const s = fromBody(body, prev);
    await unmountOne(prev);
    if (isCloud(s)) {
      try { await cloud.setUp(s, body, { replacing: true }); } catch (err) { // a new sign-in, if one was given
        if (!err.needCode) await mountOne(prev).catch(() => {});
        throw err;
      }
    }
    try { await mountOne(s); } catch (err) {
      if (isCloud(s)) { await setShares(getShares().map((x) => (x.id === id ? s : x))); throw err; } // keep the new sign-in; Reconnect retries
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
    if ((!isWin || isCloud(s)) && !mounted(s)) await fsp.rmdir(rootOf(s)).catch(() => {});
    if (isCloud(s)) cloud?.forget(s.id); // an offline copy's files stay where they are
    await setShares(getShares().filter((x) => x.id !== id));
    state.delete(id);
  }
  async function reconnect(id) {
    const s = getShares().find((x) => x.id === id);
    if (!s) throw new ShareError(404, 'That network share isn’t there any more');
    if ((!isWin || isCloud(s)) && mounted(s)) await unmountOne(s);
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

  // ---- Offline copies of cloud storage (kept in step both ways by cloudstorage.js) ----
  const EVERY = [0, 15, 60, 360, 1440]; // minutes; 0 = only when asked
  const offlineOn = (s) => isCloud(s) && s.offline && s.offline.mode !== 'off';
  const defaultDest = (s) => path.join(dataDir, 'cloud-offline', s.id);
  const offlineView = (s) => ({ mode: s.offline?.mode || 'off', paths: s.offline?.paths || [], dest: s.offline?.dest || defaultDest(s), defaultDest: defaultDest(s), every: s.offline?.every ?? 60, ...(cloud ? cloud.syncState(s.id) : {}) });
  const cleanRel = (p) => {
    const dir = /[\\/]$/.test(String(p));
    const parts = String(p ?? '').replace(/[\u0000-\u001f]/g, '').split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.some((x) => x === '.' || x === '..')) return null;
    return parts.join('/') + (dir ? '/' : '');
  };
  const isInside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  async function setOffline(id, body) {
    const s = getShares().find((x) => x.id === id);
    if (!s || !isCloud(s)) throw new ShareError(404, 'That cloud storage isn’t there any more');
    if (mock) throw new ShareError(400, 'Offline copies can’t be made in demo mode');
    const prev = s.offline || {};
    let mode = ['off', 'all', 'some'].includes(body.mode) ? body.mode : prev.mode || 'off';
    let paths = Array.isArray(body.paths) ? body.paths : prev.paths || [];
    if (Array.isArray(body.add)) paths = [...paths, ...body.add];
    if (Array.isArray(body.remove)) { const gone = new Set(body.remove.map(cleanRel)); paths = paths.filter((x) => !gone.has(cleanRel(x))); }
    paths = [...new Set(paths.map(cleanRel).filter(Boolean))].slice(0, 500);
    // From Files' "Keep offline": chosen items, unless it already keeps everything.
    if (body.mode === 'auto') mode = prev.mode === 'all' ? 'all' : paths.length ? 'some' : 'off';
    const every = EVERY.includes(Number(body.every)) ? Number(body.every) : prev.every ?? 60;
    let dest = typeof body.dest === 'string' && body.dest.trim() ? body.dest.trim() : prev.dest || defaultDest(s);
    if (!path.isAbsolute(dest)) throw new ShareError(400, `Give the full path of a folder for the offline copy, like ${isWin ? 'D:\\Offline\\Google Drive' : '/mnt/storage/Google Drive'}`);
    dest = path.resolve(dest);
    if (isInside(dest, base) || isInside(base, dest)) throw new ShareError(400, 'The offline copy can’t go in MediaDesk’s network folder.');
    if (isInside(dest, path.resolve(cloud.cacheDir())) || isInside(dest, path.resolve(cloud.defaultCacheDir))) throw new ShareError(400, 'The offline copy can’t go in the cloud cache folder.');
    for (const x of getShares()) if (x.id !== id && x.offline?.dest && (isInside(dest, x.offline.dest) || isInside(x.offline.dest, dest))) throw new ShareError(400, `That folder is (or holds) the offline copy of “${x.name}”.`);
    if (mode !== 'off' && dest !== path.resolve(prev.dest || defaultDest(s))) {
      // Syncing merges the folder with the cloud: start with an empty (or new) folder.
      let items = [];
      try { items = await fsp.readdir(dest); } catch { /* new */ }
      if (items.length) throw new ShareError(400, 'Choose an empty or new folder: everything in it would be synced up to the cloud.');
    }
    if (mode === 'some' && !paths.length) throw new ShareError(400, 'Choose at least one file or folder to keep offline (right-click it in Files, or type its path).');
    if (mode !== 'off') {
      try { await fsp.mkdir(dest, { recursive: true }); } catch (err) { throw new ShareError(400, `MediaDesk can’t make ${dest}: ${err.code || err.message}`); }
    }
    const next = { ...s, offline: { mode, paths, dest, every } };
    if (mode === 'off') cloud.stopSync(id);
    await setShares(getShares().map((x) => (x.id === id ? next : x)));
    if (mode !== 'off') await cloud.sync(next, next.offline).catch((err) => { throw new ShareError(err.status || 502, err.message); });
    return view(next);
  }
  async function syncNow(id, { force = false } = {}) {
    const s = getShares().find((x) => x.id === id);
    if (!offlineOn(s)) throw new ShareError(400, 'There’s no offline copy to sync');
    try { await cloud.sync(s, s.offline, { force }); } catch (err) { throw new ShareError(err.status || 502, err.message); }
    return view(s);
  }
  // Each one on its own schedule (checked every minute).
  const syncTimer = setInterval(() => {
    for (const s of getShares()) {
      if (!offlineOn(s) || !s.offline.every) continue;
      const st = cloud.syncState(s.id);
      if (st.running || (st.lastAt && Date.now() - st.lastAt < s.offline.every * 60e3)) continue;
      cloud.sync(s, s.offline).catch((err) => log(`Offline copy of “${s.name}”: ${err.message}`));
    }
  }, 60e3);
  syncTimer.unref?.();

  // Cloud cache: where files wait to upload, and how big that may get.
  async function setCacheSettings(body) {
    const cur = getCloudSettings() || {};
    const next = { ...cur };
    if (typeof body.cacheDir === 'string') {
      const d = body.cacheDir.trim();
      if (d && !path.isAbsolute(d)) throw new ShareError(400, 'Give the full path of a folder for the cache');
      if (d) {
        const r = path.resolve(d);
        if (isInside(r, base)) throw new ShareError(400, 'The cache can’t go in MediaDesk’s network folder.');
        try { await fsp.mkdir(r, { recursive: true }); await fsp.access(r, fs.constants.W_OK); } catch { throw new ShareError(400, `MediaDesk can’t write to ${r}`); }
        next.cacheDir = r;
      } else delete next.cacheDir;
    }
    if (body.cacheMaxGB !== undefined) {
      const gb = body.cacheMaxGB === '' || body.cacheMaxGB === null ? 0 : Number(body.cacheMaxGB);
      if (!Number.isFinite(gb) || gb < 0 || gb > 100000) throw new ShareError(400, 'Enter the cache limit in GB, or leave it blank for no limit');
      if (gb) next.cacheMaxGB = Math.round(gb * 10) / 10; else delete next.cacheMaxGB;
    }
    const changed = next.cacheDir !== cur.cacheDir || next.cacheMaxGB !== cur.cacheMaxGB;
    await setCloudSettings(next);
    // Connected cloud storage picks the new settings up when it's mounted again.
    if (changed && !mock) for (const s of getShares()) if (isCloud(s) && mounted(s)) await reconnect(s.id).catch(() => {});
    return cacheView();
  }
  const cacheView = () => ({ cacheDir: getCloudSettings()?.cacheDir || '', cacheMaxGB: getCloudSettings()?.cacheMaxGB || null, defaultCacheDir: cloud?.defaultCacheDir || '' });

  // For Files: the share whose folder this is, and whether it can be used now.
  const byRoot = (abs) => getShares().find((s) => path.resolve(rootOf(s)) === path.resolve(abs)) || null;
  function offline(abs) {
    const s = byRoot(abs);
    if (!s || mounted(s)) return null;
    const st = state.get(s.id);
    return st?.status === 'connecting' ? `The network share “${s.name}” is connecting… try again in a moment.` : `The network share “${s.name}” isn’t connected${st?.error ? `: ${st.error}` : ''}.`;
  }
  const byOfflineRoot = (abs) => getShares().find((s) => offlineOn(s) && path.resolve(s.offline.dest) === path.resolve(abs)) || null;
  const info = (abs) => {
    const s = byRoot(abs);
    if (s) return { network: { id: s.id, type: s.type, label: label(s), ...(isCloud(s) ? { cloud: true, offlineCopy: offlineOn(s) ? { mode: s.offline.mode, paths: s.offline.paths } : null } : {}) }, offline: offline(abs) };
    const o = byOfflineRoot(abs);
    if (o) { const st = cloud.syncState(o.id); return { network: { id: o.id, type: o.type, cloud: true, isOfflineCopy: true, label: `Offline copy · ${st.running ? 'syncing…' : st.ok === false ? 'sync failed' : st.lastAt ? 'in sync' : 'not synced yet'}` }, offline: null }; }
    return null;
  };
  const offlineRoots = () => getShares().filter(offlineOn).map((s) => path.resolve(s.offline.dest));

  async function handle(req, res, p, { sendJson, readJson }) {
    try {
      if (p === '/portal/netshares' && req.method === 'GET') return sendJson(res, 200, { shares: getShares().map(view), types: TYPES, platform: process.platform, cloud: cloud ? { ...(await cloud.status()), ...cacheView() } : { available: false } });
      if (p === '/portal/netshares/cloud/settings' && req.method === 'PUT') return sendJson(res, 200, await setCacheSettings(await readJson(req)));
      const o = /^\/portal\/netshares\/([a-f0-9]{12})\/offline(\/sync)?$/.exec(p);
      if (o && !o[1 + 1] && req.method === 'PUT') return sendJson(res, 200, { share: await setOffline(o[1], await readJson(req)) });
      if (o && o[2] && req.method === 'POST') return sendJson(res, 200, { share: await syncNow(o[1], { force: Boolean((await readJson(req)).force) }) });
      // Signing in to a cloud service in the browser (see cloudstorage.js).
      if (p === '/portal/netshares/cloud/auth' && req.method === 'POST') return sendJson(res, 200, await cloud.startAuth(await readJson(req)));
      const a = /^\/portal\/netshares\/cloud\/auth\/([a-f0-9]{18})$/.exec(p);
      if (a && req.method === 'GET') return sendJson(res, 200, cloud.authStatus(a[1]));
      if (a && req.method === 'POST') return sendJson(res, 200, await cloud.finishAuth(a[1], (await readJson(req)).url));
      if (a && req.method === 'DELETE') { cloud.cancelAuth(a[1]); return sendJson(res, 200, { ok: true }); }
      if (p === '/portal/netshares' && req.method === 'POST') return sendJson(res, 200, { share: await add(await readJson(req)) });
      const m = /^\/portal\/netshares\/([a-f0-9]{12})(\/reconnect)?$/.exec(p);
      if (m && !m[2] && req.method === 'PUT') return sendJson(res, 200, { share: await update(m[1], await readJson(req)) });
      if (m && !m[2] && req.method === 'DELETE') { await remove(m[1]); return sendJson(res, 200, { ok: true }); }
      if (m && m[2] && req.method === 'POST') return sendJson(res, 200, { share: await reconnect(m[1]) });
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      if (err instanceof CloudError && err.needCode) return sendJson(res, 200, { needCode: true, pending: err.pending, message: err.message });
      if (err instanceof ShareError || err instanceof CloudError) return sendJson(res, err.status, { error: err.message });
      throw err;
    }
  }

  return { handle, connectAll, rootOf, offline, info, roots: () => [...getShares().map(rootOf), ...offlineRoots()], names: () => [...getShares().map((s) => [rootOf(s), s.name]), ...getShares().filter(offlineOn).map((s) => [path.resolve(s.offline.dest), `${s.name} (offline)`])] };
}

module.exports = { createNetShares, rootFor, TYPES, ShareError };
