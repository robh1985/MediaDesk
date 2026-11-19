// Cloud storage in Files: Google Drive, OneDrive, iCloud Drive, Dropbox, Box, pCloud, MEGA and
// S3-compatible storage, connected through rclone (https://rclone.org, MIT licence) on the MediaDesk
// server. Each one is a network share (netshares.js) whose folder is an `rclone mount`, so every app
// that reads shared folders can use it like any other folder.
//
// Signing in:
// - Google Drive, OneDrive, Dropbox, Box and pCloud use rclone's own sign-in (`rclone authorize`),
//   so no app registration is needed. rclone waits for the provider to send the browser back to
//   http://127.0.0.1:53682/ on the MediaDesk server. If the browser is on that computer it just works;
//   otherwise the browser lands on a page that can't be reached, and the person pastes that page's
//   address into MediaDesk, which hands it to rclone on the server.
// - iCloud Drive has no official API for other apps: rclone signs in the way icloud.com does, with
//   the Apple ID, password and a two-factor code (Advanced Data Protection must be off).
// - MEGA takes an email and password; S3-compatible storage an access key and secret.
//
// Files people write are kept in rclone's cache while they upload (folder and size limit set in
// Settings → Files). An offline copy keeps a local copy of all of it, or of chosen files and folders,
// in a folder of its own, kept in step both ways with `rclone bisync` on a schedule.
//
// Tokens and passwords live only in rclone.conf next to config.json on the server (passwords
// obscured the way rclone does it), never in config.json, on a command line, or in the browser.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const PROVIDERS = {
  gdrive: { name: 'Google Drive', rclone: 'drive', auth: 'oauth', choices: { config_change_team_drive: 'false' }, extra: { scope: 'drive' } },
  onedrive: { name: 'OneDrive', rclone: 'onedrive', auth: 'oauth', choices: { config_type: 'onedrive', config_drive_ok: 'true' } },
  icloud: { name: 'iCloud Drive', rclone: 'iclouddrive', auth: 'apple', minVersion: [1, 69] },
  dropbox: { name: 'Dropbox', rclone: 'dropbox', auth: 'oauth' },
  box: { name: 'Box', rclone: 'box', auth: 'oauth' },
  pcloud: { name: 'pCloud', rclone: 'pcloud', auth: 'oauth' },
  mega: { name: 'MEGA', rclone: 'mega', auth: 'password' },
  s3: { name: 'S3-compatible storage', rclone: 's3', auth: 'keys' },
};
const AUTH_PORT = 53682; // rclone's sign-in listener (fixed: the providers only send people back there)

class CloudError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

// rclone's "obscure" (reversible on purpose: it keeps passwords out of plain sight in rclone.conf).
const OBSCURE_KEY = Buffer.from('9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638', 'hex');
function obscure(text) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-ctr', OBSCURE_KEY, iv);
  return Buffer.concat([iv, c.update(String(text), 'utf8'), c.final()]).toString('base64url');
}
function reveal(text) {
  const buf = Buffer.from(String(text), 'base64url');
  const d = crypto.createDecipheriv('aes-256-ctr', OBSCURE_KEY, buf.subarray(0, 16));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString('utf8');
}

// rclone.conf: [section] then "key = value" lines.
function parseConf(text) {
  const out = new Map();
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { cur = new Map(); out.set(sec[1], cur); continue; }
    const i = line.indexOf('=');
    if (cur && i > 0) cur.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return out;
}
const formatConf = (conf) => [...conf].map(([name, kv]) => `[${name}]\n${[...kv].map(([k, v]) => `${k} = ${v}`).join('\n')}\n`).join('\n');

const remoteName = (id) => `md_${id}`;
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function run(cmd, args, { ms = 60e3, env } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try { child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true }); } catch (e) { resolve({ code: -1, out: '', err: e.message, missing: e.code === 'ENOENT' }); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: -1, out, err: `${err}\ntimed out`, timedOut: true }); }, ms);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message, missing: e.code === 'ENOENT' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
    child.stdin.end();
  });
}

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; } };

// On Windows MediaDesk runs as SYSTEM, without your PATH: winget installs rclone per user.
function windowsPlaces() {
  const out = [];
  for (const home of subdirs(path.join(process.env.SystemDrive || 'C:', '\\Users'))) {
    const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet');
    out.push(path.join(winget, 'Links', 'rclone.exe'));
    for (const pkg of subdirs(path.join(winget, 'Packages')).filter((d) => /rclone/i.test(path.basename(d)))) {
      out.push(path.join(pkg, 'rclone.exe'), ...subdirs(pkg).map((d) => path.join(d, 'rclone.exe')));
    }
    out.push(path.join(home, 'scoop', 'shims', 'rclone.exe'));
  }
  for (const base of [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files'].filter(Boolean)) out.push(path.join(base, 'rclone', 'rclone.exe'), path.join(base, 'WinGet', 'Links', 'rclone.exe'));
  out.push(path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'rclone.exe'), 'C:\\rclone\\rclone.exe');
  return out.filter(exists);
}

// What went wrong, in words people can act on.
function explain(text, provider) {
  // rclone's notice about its shared Google client isn't the error (Settings shows it separately).
  text = String(text || '').split('\n').filter((l) => !/shared google drive client_id|making-your-own-client-id|create your own client_id/i.test(l)).join('\n')
    .replace(/^.*?This remote uses rclone's shared Google Drive client_id.*?interruption: \S+\s*/i, '');
  const o = text.toLowerCase();
  const p = PROVIDERS[provider]?.name || 'The cloud service';
  if (/parent of mountpoint/.test(o)) return 'The folder to connect it in couldn’t be made. Press Reconnect; if it keeps failing, check MediaDesk can write to its config folder.';
  if (/mountpoint.*(already exists|not empty)|directory already exists/.test(o)) return 'Its folder is already there (and not empty). Press Reconnect, or remove what’s in it.';
  if (/winfsp|cgofuse/.test(o)) return 'Cloud storage needs WinFsp on the MediaDesk computer: run winget install WinFsp.WinFsp, then press Reconnect.';
  if (/fusermount.*(not found|executable file)|exec: "fusermount/.test(o)) return 'Cloud storage needs FUSE on the MediaDesk server: install fuse3 (sudo apt install fuse3), then press Reconnect.';
  if (/\/dev\/fuse|fuse: device not found|no such device/.test(o)) return 'The MediaDesk server can’t use FUSE (needed for cloud storage). In Docker, add the device /dev/fuse (see docker-compose.yml).';
  if (/macfuse|osxfuse|cannot find fuse/.test(o)) return 'Cloud storage needs macFUSE on this Mac (brew install --cask macfuse), then press Reconnect.';
  if (/advanced data protection|\badp\b|pcs is required|zone not found/.test(o) && provider === 'icloud') return 'iCloud wouldn’t share your files: turn off Advanced Data Protection and turn on “Access iCloud Data on the Web” (iPhone: Settings → your name → iCloud), then try again.';
  if (provider === 'icloud' && /2fa|two-factor|verification code|-21669/.test(o)) return 'That code wasn’t accepted. Ask for a new one and try again.';
  if (provider === 'icloud' && /invalid email\/password|401|unauthorized|incorrect|-20101/.test(o)) return 'Apple didn’t accept that Apple ID and password.';
  if (/invalid_grant|token.*(expired|revoked)|couldn't fetch token|empty token|unauthorized|401/.test(o)) return `${p} needs you to sign in again: press Change, then sign in.`;
  if (/couldn't find section|didn't find section|not found in config/.test(o)) return `${p} isn’t set up on the server any more: press Change and sign in again.`;
  if (/no such host|dial tcp|timeout|timed out|connection refused|network is unreachable/.test(o)) return `Couldn’t reach ${p} from the MediaDesk server. Check its internet connection.`;
  if (/access denied|invalidaccesskeyid|signaturedoesnotmatch|forbidden|403/.test(o)) return `${p} refused the sign-in details.`;
  if (/bucket.*(not exist|not found)|nosuchbucket/.test(o)) return 'There’s no bucket with that name.';
  const lines = String(text || '').split('\n').map((l) => l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s+(ERROR|NOTICE|CRITICAL|Failed to \w+)\s*:?\s*/i, '').trim()).filter(Boolean);
  return (lines.slice(-2).join(' ') || `${p} couldn’t be connected`).slice(0, 300);
}

function createCloudStorage({ dataDir, getRclonePath = () => '', getSettings = () => ({}), log = console.log, mock = false }) {
  const confPath = path.join(dataDir, 'rclone.conf');
  const cacheBase = path.join(dataDir, 'rclone-cache');
  const mounts = new Map(); // share id -> { child, mp, err, exited }
  const pending = new Map(); // iCloud sign-ins waiting for a code: id -> { share, state, at }
  let tool = { path: null, version: null, checked: 0 };
  let auth = null; // the one sign-in in progress (rclone's listener has one fixed port)

  // ---- rclone itself ----
  async function detect(force = false) {
    if (!force && tool.checked && Date.now() - tool.checked < 60e3) return tool;
    const list = [...new Set([getRclonePath(), process.env.RCLONE_PATH, 'rclone', ...(isWin ? windowsPlaces() : ['/usr/bin/rclone', '/usr/local/bin/rclone', '/opt/homebrew/bin/rclone'])].filter(Boolean))];
    tool = { path: null, version: null, checked: Date.now() };
    for (const cmd of list) {
      const r = await run(cmd, ['version'], { ms: 15e3 });
      const m = /rclone v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(r.out);
      if (r.code === 0 && m) { tool = { path: cmd, version: `${m[1]}.${m[2]}.${m[3] || 0}`, major: Number(m[1]), minor: Number(m[2]), checked: Date.now() }; break; }
    }
    return tool;
  }
  async function need(provider) {
    const t = await detect();
    if (!t.path) throw new CloudError(503, 'Cloud storage needs rclone on the MediaDesk server. See Settings → Files → Network shares for how to install it.');
    const min = PROVIDERS[provider]?.minVersion;
    if (min && (t.major < min[0] || (t.major === min[0] && t.minor < min[1]))) throw new CloudError(503, `${PROVIDERS[provider].name} needs rclone ${min.join('.')} or newer; the server has ${t.version}. Update rclone (rclone selfupdate), then try again.`);
    return t.path;
  }
  const rclone = async (provider, args, opts) => run(await need(provider), [...args, '--config', confPath], opts);

  // ---- rclone.conf ----
  const readConf = () => { try { return parseConf(fs.readFileSync(confPath, 'utf8')); } catch { return new Map(); } };
  function writeConf(conf) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${confPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, formatConf(conf), { mode: 0o600 });
    fs.renameSync(tmp, confPath);
  }
  // Read, change and write in one go (rclone may have just saved a refreshed token).
  function setSection(id, kv) { const conf = readConf(); conf.set(remoteName(id), new Map(Object.entries(kv).filter(([, v]) => v !== undefined && v !== ''))); writeConf(conf); }
  function dropSection(id) { const conf = readConf(); if (conf.delete(remoteName(id))) writeConf(conf); }
  const hasSection = (id) => readConf().has(remoteName(id));
  const sectionValue = (id, key) => readConf().get(remoteName(id))?.get(key);

  // Run rclone's own set-up for a remote (it finds the OneDrive drive, checks iCloud's sign-in…).
  // Returns null when it's done, or the question rclone asks next (iCloud's two-factor code).
  async function configure(provider, id, { state, result, choices = {} } = {}) {
    const args = ['config', 'update', remoteName(id), ...Object.entries(choices).map(([k, v]) => `${k}=${v}`), '--non-interactive'];
    if (state != null) args.push('--continue', '--state', state, '--result', String(result ?? ''));
    else if (PROVIDERS[provider].auth !== 'apple') args.push('--auto-confirm');
    const r = await rclone(provider, args, { ms: 90e3 });
    if (r.code !== 0) throw new CloudError(502, explain(`${r.err}\n${r.out}`, provider));
    let out = {};
    try { out = JSON.parse(r.out || '{}'); } catch { /* older output: nothing to ask */ }
    if (out.Error) throw new CloudError(400, explain(out.Error, provider));
    if (out.State && out.Option) return { state: out.State, question: out.Option.Name, help: String(out.Option.Help || '').split('\n')[0] };
    return null;
  }

  // ---- Signing in with a browser (OAuth providers) ----
  function stopAuth() {
    if (auth?.child && auth.child.exitCode === null) auth.child.kill();
    clearTimeout(auth?.timer);
  }
  async function startAuth({ provider, clientId, clientSecret }) {
    const p = PROVIDERS[provider];
    if (!p || p.auth !== 'oauth') throw new CloudError(400, 'Choose the cloud service to sign in to');
    const cmd = await need(provider);
    stopAuth();
    const blob = Buffer.from(JSON.stringify({ ...(clientId ? { client_id: clean(clientId, 300) } : {}), ...(clientSecret ? { client_secret: clean(clientSecret, 300) } : {}) })).toString('base64').replace(/=+$/, '');
    const a = { id: crypto.randomBytes(9).toString('hex'), provider, status: 'starting', out: '', err: '', at: Date.now() };
    auth = a;
    a.child = spawn(cmd, ['authorize', p.rclone, blob, '--auth-no-open-browser', '--config', confPath], { windowsHide: true });
    a.child.stdout.on('data', (d) => { a.out += d; });
    a.child.stderr.on('data', (d) => { a.err += d; });
    a.child.on('error', (e) => { a.err += e.message; });
    a.child.on('close', (code) => {
      const m = /--->\s*\n([\s\S]*?)\n\s*<---End paste/.exec(a.out);
      if (code === 0 && m) {
        try {
          const raw = m[1].trim();
          const data = raw.startsWith('{') ? { token: raw } : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
          a.result = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('config_')));
          if (!a.result.token) throw new Error('no token');
          if (clientId) a.result.client_id = clean(clientId, 300);
          if (clientSecret) a.result.client_secret = clean(clientSecret, 300);
          a.status = 'done';
        } catch { a.status = 'error'; a.error = 'rclone’s answer couldn’t be read. Try signing in again.'; }
      } else if (a.status !== 'cancelled') {
        a.status = 'error';
        a.error = /address already in use|bind/i.test(a.err) ? `Something else on the MediaDesk server is using port ${AUTH_PORT} (another rclone sign-in?). Close it and try again.` : explain(a.err || a.out, provider);
      }
    });
    a.timer = setTimeout(() => { if (a.status === 'waiting') { a.status = 'cancelled'; a.error = 'The sign-in took too long. Start again.'; a.child.kill(); } }, 15 * 60e3);
    a.timer.unref?.();
    // rclone prints http://127.0.0.1:53682/auth?state=…, which sends the browser on to the provider.
    const local = await new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const m = /(http:\/\/127\.0\.0\.1:\d+\/auth\?state=[^\s"]+)/.exec(a.err + a.out);
        if (m) return resolve(m[1]);
        if (a.child.exitCode !== null || a.status === 'error' || Date.now() - t0 > 20e3) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
    if (!local) {
      const msg = a.error || explain(a.err || a.out || 'rclone didn’t start the sign-in', provider);
      stopAuth();
      a.status = 'error';
      throw new CloudError(502, msg);
    }
    const url = await new Promise((resolve) => {
      const req = http.get(local, { agent: false, timeout: 10e3 }, (res) => { res.resume(); resolve(res.headers.location || null); });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (!url || !/^https:\/\//i.test(url)) { stopAuth(); a.status = 'error'; throw new CloudError(502, 'rclone didn’t give a sign-in address. Try again.'); }
    a.status = 'waiting';
    a.url = url;
    return { id: a.id, url, provider };
  }
  const authFor = (id) => (auth && auth.id === id ? auth : null);
  const authView = (a) => ({ id: a.id, provider: a.provider, status: a.status === 'starting' ? 'waiting' : a.status, ...(a.error ? { error: a.error } : {}) });
  // The page the browser was sent back to (http://127.0.0.1:53682/?state=…&code=…), pasted in.
  async function finishAuth(id, pasted) {
    const a = authFor(id);
    if (!a) throw new CloudError(404, 'That sign-in has ended. Start again.');
    if (a.status === 'done') return authView(a);
    if (a.status !== 'waiting') throw new CloudError(400, a.error || 'That sign-in has ended. Start again.');
    let u;
    try { u = new URL(String(pasted || '').trim()); } catch { throw new CloudError(400, 'Paste the whole address of the page you were sent back to (it starts with http://127.0.0.1 or http://localhost).'); }
    if (!u.searchParams.get('code') && !u.searchParams.get('error')) throw new CloudError(400, 'That address has no sign-in code in it. Copy the address of the page you landed on after allowing access.');
    if (u.searchParams.get('error')) throw new CloudError(400, `The sign-in was refused: ${clean(u.searchParams.get('error_description') || u.searchParams.get('error'), 200)}`);
    // Only the query goes on, and only to rclone's own listener on this computer.
    await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: AUTH_PORT, path: `/${u.search}`, agent: false, timeout: 15e3 }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
    for (let i = 0; i < 300 && a.status === 'waiting'; i++) await new Promise((r) => setTimeout(r, 100));
    if (a.status === 'waiting') throw new CloudError(504, 'rclone is still finishing the sign-in. Wait a moment, then press Connect.');
    if (a.status !== 'done') throw new CloudError(400, a.error || 'The sign-in didn’t work. Start again.');
    return authView(a);
  }
  function cancelAuth(id) { const a = authFor(id); if (a) { a.status = 'cancelled'; stopAuth(); auth = null; } }

  // ---- Setting a remote up ----
  // Fields from the Connect dialog for this share. Returns null when it's ready to mount, or
  // { pending, question } when iCloud wants its two-factor code (then finish with { pending, code }).
  async function setUp(share, body, { replacing = false } = {}) {
    const p = PROVIDERS[share.type];
    if (body.pending) {
      const w = pending.get(String(body.pending));
      if (!w || w.share.id !== share.id) throw new CloudError(400, 'That sign-in has ended. Start again.');
      const code = clean(body.code, 20).replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) throw new CloudError(400, 'Enter the 6-digit code from your Apple device.');
      const next = await configure(share.type, share.id, { state: w.state, result: code });
      if (next) throw new CloudError(400, 'That code wasn’t accepted. Ask for a new one and try again.');
      pending.delete(String(body.pending));
      return null;
    }
    if (p.auth === 'oauth') {
      const a = body.authId ? authFor(String(body.authId)) : null;
      if (!a) { if (replacing && hasSection(share.id)) return null; throw new CloudError(400, `Sign in to ${p.name} first.`); }
      if (a.status !== 'done' || a.provider !== share.type) throw new CloudError(400, a.status === 'waiting' ? `Finish signing in to ${p.name} first.` : a.error || 'Sign in again.');
      setSection(share.id, { type: p.rclone, ...(p.extra || {}), ...a.result });
      auth = null;
      await configure(share.type, share.id, { choices: { config_refresh_token: 'false', ...(p.choices || {}) } });
      return null;
    }
    if (p.auth === 'apple') {
      const appleId = clean(body.appleId ?? body.username, 200) || (replacing ? sectionValue(share.id, 'apple_id') : '');
      const password = typeof body.password === 'string' && body.password ? body.password : '';
      if (!password && replacing && hasSection(share.id) && appleId === sectionValue(share.id, 'apple_id')) return null;
      if (!appleId || !password) throw new CloudError(400, 'Enter your Apple ID and password.');
      setSection(share.id, { type: p.rclone, apple_id: appleId, password: obscure(password) });
      const q = await configure(share.type, share.id);
      if (q) {
        const id = crypto.randomBytes(9).toString('hex');
        pending.set(id, { share, state: q.state, at: Date.now() });
        for (const [k, v] of pending) if (Date.now() - v.at > 20 * 60e3) pending.delete(k);
        throw new CloudError(200, 'Enter the code Apple sent to your devices.', { needCode: true, pending: id });
      }
      return null;
    }
    if (p.auth === 'password') {
      const user = clean(body.username, 200) || (replacing ? sectionValue(share.id, 'user') : '');
      const password = typeof body.password === 'string' && body.password ? body.password : '';
      if (!password && replacing && hasSection(share.id) && user === sectionValue(share.id, 'user')) return null;
      if (!user || !password) throw new CloudError(400, `Enter your ${p.name} email and password.`);
      setSection(share.id, { type: p.rclone, user, pass: obscure(password) });
      return null;
    }
    // S3-compatible: Amazon S3, Backblaze B2, Cloudflare R2, Wasabi, MinIO…
    const endpoint = clean(body.endpoint, 300);
    const region = clean(body.region, 60);
    const accessKey = clean(body.accessKey, 200);
    const secretKey = typeof body.secretKey === 'string' ? body.secretKey.trim().slice(0, 300) : '';
    if (!accessKey && !secretKey && replacing && hasSection(share.id)) {
      const kv = Object.fromEntries(readConf().get(remoteName(share.id)));
      setSection(share.id, { ...kv, endpoint: endpoint || undefined, region: region || undefined, provider: endpoint ? 'Other' : 'AWS' });
      return null;
    }
    if (!accessKey || !secretKey) throw new CloudError(400, 'Enter the access key and secret key.');
    if (endpoint && !/^https?:\/\/[^\s/]+/i.test(endpoint)) throw new CloudError(400, 'The endpoint starts with https://');
    setSection(share.id, { type: 's3', provider: endpoint ? 'Other' : 'AWS', env_auth: 'false', access_key_id: accessKey, secret_access_key: secretKey, endpoint: endpoint || undefined, region: region || undefined });
    return null;
  }
  function forget(id) {
    dropSection(id);
    forgetSync(id);
    for (const dir of new Set([cacheBase, cacheDir()])) fsp.rm(path.join(dir, id), { recursive: true, force: true }).catch(() => {});
    fsp.rm(path.join(cacheBase, `${id}.filter`), { force: true }).catch(() => {});
  }

  // ---- Mounting ----
  // Where files being written wait to upload, and how big that may get (per connection).
  const cacheDir = () => { const d = getSettings().cacheDir; return d && path.isAbsolute(d) ? d : cacheBase; };
  const cacheLimit = () => { const gb = Number(getSettings().cacheMaxGB); return gb > 0 ? `${Math.round(gb * 1024)}M` : null; };
  const remotePath = (s) => `${remoteName(s.id)}:${s.type === 's3' ? [s.bucket, s.path].filter(Boolean).join('/') : s.path || ''}`;
  const running = (id) => { const m = mounts.get(id); return Boolean(m && !m.exited); };
  const lastError = (id) => mounts.get(id)?.error || null;

  // An rclone left running by a MediaDesk that was stopped without cleaning up (its pid is kept).
  const pidFile = (id) => path.join(cacheBase, `${id}.pid`);
  async function stopLeftover(id) {
    let pid;
    try { pid = Number(fs.readFileSync(pidFile(id), 'utf8')); } catch { return; }
    if (pid > 1 && ![...mounts.values()].some((m) => m.child?.pid === pid)) {
      let cmdline = '';
      if (isWin) cmdline = (await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { ms: 10e3 })).out;
      else if (fs.existsSync('/proc')) { try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { /* gone */ } }
      else cmdline = (await run('ps', ['-p', String(pid), '-o', 'command='], { ms: 10e3 })).out;
      if (/rclone/i.test(cmdline) && (isWin || cmdline.includes(remoteName(id)))) {
        try { process.kill(pid); } catch { /* gone */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    fs.rmSync(pidFile(id), { force: true });
  }

  async function unmount(s, mp, { inMounts }) {
    await stopLeftover(s.id);
    const m = mounts.get(s.id);
    if (m && !m.exited) {
      m.stopping = true;
      m.child.kill(isWin ? undefined : 'SIGTERM');
      for (let i = 0; i < 50 && !m.exited; i++) await new Promise((r) => setTimeout(r, 100));
      if (!m.exited) m.child.kill('SIGKILL');
    }
    mounts.delete(s.id);
    // A mount left behind by a MediaDesk that stopped without cleaning up.
    if (!isWin && inMounts(mp)) {
      for (const [cmd, args] of [['fusermount3', ['-uz', mp]], ['fusermount', ['-uz', mp]], ['umount', isMac ? [mp] : ['-l', mp]]]) {
        const r = await run(cmd, args, { ms: 15e3 });
        if (r.code === 0 && !inMounts(mp)) break;
      }
    }
  }

  async function mount(s, mp, { inMounts }) {
    if (mock) return;
    const cmd = await need(s.type);
    if (!hasSection(s.id)) throw new CloudError(400, `${PROVIDERS[s.type].name} isn’t set up on the server any more: press Change and sign in again.`);
    await unmount(s, mp, { inMounts });
    if (isWin) {
      // WinFsp makes the mount folder itself: its parent must exist, and the folder itself mustn't.
      await fsp.mkdir(path.dirname(mp), { recursive: true });
      await fsp.rmdir(mp).catch(() => {});
      if (fs.existsSync(mp)) throw new CloudError(409, `The folder ${mp} is in the way (it isn’t empty). Move what’s in it, then press Reconnect.`);
    }
    else await fsp.mkdir(mp, { recursive: true });
    const args = ['mount', remotePath(s), mp, '--config', confPath, '--cache-dir', path.join(cacheDir(), s.id),
      ...(cacheLimit() ? ['--vfs-cache-max-size', cacheLimit()] : []),
      '--vfs-cache-mode', 'writes', '--dir-cache-time', '1m', '--poll-interval', '1m', '--log-level', 'NOTICE',
      ...(s.readOnly ? ['--read-only'] : []), ...(isMac || isWin ? ['--volname', s.name] : [])];
    const m = { child: null, mp, err: '', exited: false, error: null, started: Date.now() };
    mounts.set(s.id, m);
    m.child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (m.child.pid) { fs.mkdirSync(cacheBase, { recursive: true }); fs.writeFileSync(pidFile(s.id), String(m.child.pid)); }
    const keep = (d) => { m.err = (m.err + d).slice(-4000); };
    m.child.stdout.on('data', keep);
    m.child.stderr.on('data', keep);
    m.child.on('error', (e) => { keep(e.message); m.exited = true; });
    m.child.on('close', (code) => {
      m.exited = true;
      fs.rmSync(pidFile(s.id), { force: true });
      if (!m.stopping) {
        m.error = explain(m.err || `rclone stopped (code ${code})`, s.type);
        log(`Cloud storage “${s.name}” stopped: ${m.error}`);
      }
    });
    const ready = () => (isWin ? fs.existsSync(mp) : inMounts(mp));
    for (let i = 0; i < 300 && !m.exited && !ready(); i++) await new Promise((r) => setTimeout(r, 100));
    if (m.exited) throw new CloudError(502, m.error || explain(m.err, s.type));
    if (!ready()) { await unmount(s, mp, { inMounts }); throw new CloudError(504, `${PROVIDERS[s.type].name} took too long to connect. Press Reconnect to try again.`); }
  }

  // When MediaDesk stops, rclone stops too (it unmounts as it goes), and so does a sign-in in progress.
  const stopAll = () => {
    for (const m of mounts.values()) if (!m.exited) { m.stopping = true; try { m.child.kill(); } catch { /* gone */ } }
    try { if (auth?.child && auth.child.exitCode === null) auth.child.kill(); } catch { /* gone */ }
    for (const st of syncs.values()) if (st.running) try { st.child.kill(); } catch { /* gone */ }
  };
  process.once('exit', stopAll);
  for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    if (!process.listenerCount(sig)) process.once(sig, () => { stopAll(); process.exit(code); });
  }

  async function status() {
    const t = await detect();
    return { available: Boolean(t.path), version: t.version, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { name: v.name, auth: v.auth }])) };
  }

  const pendingShare = (id) => pending.get(String(id))?.share || null;

  // ---- Offline copies ----
  // `rclone bisync`, both ways: changes in the cloud come down, changes in the local folder go up.
  // The first run (and any run after the chosen files, or the folder, change) is a --resync, which
  // merges both sides keeping the newer version. Conflicts keep both: the older one gets a number.
  const syncs = new Map(); // id -> { running, child, lastAt, ok, error, startedAt, tooMany }
  const statePath = path.join(cacheBase, 'offline-state.json');
  const saved = (() => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; } })();
  for (const [id, v] of Object.entries(saved)) syncs.set(id, { lastAt: v.lastAt || null, ok: v.ok ?? null, error: v.error || null, key: v.key || null });
  function saveState() {
    const out = {};
    for (const [id, st] of syncs) out[id] = { lastAt: st.lastAt || null, ok: st.ok ?? null, error: st.error || null, key: st.key || null };
    try { fs.mkdirSync(cacheBase, { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(out)); } catch { /* next time */ }
  }
  const escapeGlob = (p) => p.replace(/[\\*?[\]{}]/g, (c) => `\\${c}`);
  function filterLines(paths) {
    return [...paths.map((p) => (p.endsWith('/') ? `+ /${escapeGlob(p.replace(/\/+$/, ''))}/**` : `+ /${escapeGlob(p)}`)), '- **'].join('\n') + '\n';
  }
  function syncState(id) { const st = syncs.get(id); return st ? { running: Boolean(st.running), lastAt: st.lastAt || null, ok: st.ok ?? null, error: st.error || null, tooMany: Boolean(st.tooMany), startedAt: st.startedAt || null } : { running: false, lastAt: null, ok: null, error: null, tooMany: false }; }
  function stopSync(id) { const st = syncs.get(id); if (st?.child && st.running) { st.stopped = true; st.child.kill(); } }
  function forgetSync(id) { stopSync(id); syncs.delete(id); saveState(); }
  // What makes a --resync necessary: where the copy is, and what's in it.
  const syncKey = (s, offline) => crypto.createHash('sha1').update(JSON.stringify([remotePath(s), offline.dest, offline.mode, offline.mode === 'some' ? [...offline.paths].sort() : []])).digest('hex');

  function runBisync(cmd, args) {
    return new Promise((resolve) => {
      let out = '';
      const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => { out = (out + d).slice(-6000); });
      child.stderr.on('data', (d) => { out = (out + d).slice(-6000); });
      child.on('error', (e) => { out += e.message; });
      child.on('close', (code) => resolve({ code, out }));
      resolve.child = child;
      runBisync.last = child;
    });
  }

  async function sync(s, offline, { force = false, onDone } = {}) {
    if (mock) return syncState(s.id);
    const st = syncs.get(s.id) || {};
    if (st.running) return syncState(s.id);
    const cmd = await need(s.type);
    if (!hasSection(s.id)) throw new CloudError(400, `${PROVIDERS[s.type].name} isn’t set up on the server any more: press Change and sign in again.`);
    if (offline.mode === 'some' && !offline.paths.length) throw new CloudError(400, 'Choose at least one file or folder to keep offline.');
    await fsp.mkdir(offline.dest, { recursive: true });
    const workdir = path.join(cacheBase, 'bisync');
    await fsp.mkdir(workdir, { recursive: true });
    const base = ['bisync', remotePath(s), offline.dest, '--config', confPath, '--workdir', workdir, '--create-empty-src-dirs',
      '--resilient', '--recover', '--max-lock', '2m', '--conflict-resolve', 'newer', '--conflict-loser', 'num', '--compare', 'size,modtime', '--log-level', 'NOTICE'];
    if (offline.mode === 'some') {
      const f = path.join(cacheBase, `${s.id}.filter`);
      await fsp.writeFile(f, filterLines(offline.paths));
      base.push('--filters-file', f);
    }
    if (force) base.push('--force');
    const key = syncKey(s, offline);
    Object.assign(st, { running: true, startedAt: Date.now(), stopped: false, error: null, tooMany: false });
    syncs.set(s.id, st);
    (async () => {
      let resync = st.key !== key;
      let r;
      for (let attempt = 0; attempt < 2; attempt++) {
        const p = runBisync(cmd, [...base, ...(resync ? ['--resync', '--resync-mode', 'newer'] : [])]);
        st.child = runBisync.last;
        r = await p;
        if (st.stopped) break;
        // Its saved listings are gone or out of date: one --resync puts it right.
        if (r.code !== 0 && !resync && /must run --resync|cannot find prior|--resync to recover|filters file has changed|listings? (are|is) (missing|corrupt)/i.test(r.out)) { resync = true; continue; }
        break;
      }
      st.running = false;
      st.child = null;
      if (st.stopped) return;
      st.lastAt = Date.now();
      st.ok = r.code === 0;
      st.tooMany = !st.ok && /too many deletes|max-delete|safety abort/i.test(r.out);
      st.error = st.ok ? null : st.tooMany ? 'More than half of the files were deleted on one side, so the sync stopped to be safe. If that was on purpose, press Sync anyway.' : explain(r.out || `rclone stopped (code ${r.code})`, s.type);
      if (st.ok) st.key = key;
      saveState();
      log(`Offline copy of “${s.name}” ${st.ok ? 'is in sync' : `failed: ${st.error}`}`);
      onDone?.(syncState(s.id));
    })();
    return syncState(s.id);
  }
  function stopAllSyncs() { for (const id of syncs.keys()) stopSync(id); }

  // Google Drive signed in with rclone's shared app, which Google is retiring during 2026.
  const usesSharedClient = (s) => s.type === 'gdrive' && hasSection(s.id) && !sectionValue(s.id, 'client_id');

  return { PROVIDERS, usesSharedClient, detect, sync, syncState, stopSync, forgetSync, stopAllSyncs, cacheDir, defaultCacheDir: cacheBase, status, pendingShare, startAuth, authStatus: (id) => { const a = authFor(id); if (!a) throw new CloudError(404, 'That sign-in has ended. Start again.'); return authView(a); }, finishAuth, cancelAuth, setUp, forget, mount, unmount, running, lastError, accountOf: (id) => sectionValue(id, 'apple_id') || sectionValue(id, 'user') || '' };
}

module.exports = { createCloudStorage, PROVIDERS, CloudError, obscure, reveal, parseConf, formatConf, explain };
