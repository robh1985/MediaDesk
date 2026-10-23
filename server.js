#!/usr/bin/env node
// MediaDesk — a unified desktop-style portal for Radarr, Sonarr, NZBGet and Jellyfin.
// Zero dependencies: requires Node.js 18+ (uses the built-in fetch).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const files = require('./files');
const appSettings = require('./appsettings');
const { createNotifier } = require('./notify');

const ROOT = __dirname;

// `--log <file>` sends all output to a file (used by the Windows startup task, which has no console).
const logArg = process.argv.indexOf('--log');
let logStream = null;
// Exit only after the log file has been flushed, so the reason for exiting is recorded.
const exitAfterLog = (code) => (logStream ? logStream.end(() => process.exit(code)) : process.exit(code));
if (logArg !== -1 && process.argv[logArg + 1]) {
  const logFile = path.resolve(process.argv[logArg + 1]);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = (logStream = fs.createWriteStream(logFile, { flags: 'a' }));
  const stamp = (fn) => (...args) => fn(`[${new Date().toISOString()}]`, ...args);
  const fileConsole = new console.Console({ stdout: stream, stderr: stream });
  globalThis.console = Object.assign(Object.create(fileConsole), {
    log: stamp(fileConsole.log), info: stamp(fileConsole.info), warn: stamp(fileConsole.warn), error: stamp(fileConsole.error),
  });
  process.on('uncaughtException', (err) => {
    console.error('Fatal error:', err);
    exitAfterLog(1);
  });
}

// Which code is running: the package version plus the git commit when installed with git.
function readVersion() {
  let version = '1.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { /* ignore */ }
  try {
    const gitDir = path.join(__dirname, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    let sha = head;
    let branch = null;
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      branch = ref.replace('refs/heads/', '');
      try { sha = fs.readFileSync(path.join(gitDir, ref), 'utf8').trim(); }
      catch {
        const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
        sha = (packed.split('\n').find((l) => l.endsWith(` ${ref}`)) || '').split(' ')[0];
      }
    }
    if (sha) return `${version} (${branch ? `${branch} ` : ''}${sha.slice(0, 7)})`;
  } catch { /* not a git checkout */ }
  return version;
}
const VERSION = readVersion();

// Fingerprint of the browser code, so open pages can tell when MediaDesk has been updated.
function computeBuildId() {
  const hash = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else { const st = fs.statSync(full); hash.update(`${path.relative(PUBLIC_DIR, full)}:${st.size}:${st.mtimeMs}\n`); }
    }
  };
  try { walk(PUBLIC_DIR); } catch { hash.update(String(Date.now())); }
  return hash.digest('hex').slice(0, 12);
}
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, 'config', 'config.json');
const HOST = process.env.HOST || '0.0.0.0';
const MOCK = process.env.MOCK === '1' || process.argv.includes('--mock');
const SERVICES = ['radarr', 'sonarr', 'nzbget', 'jellyfin'];
const SESSION_DAYS = 30;
const BUILD_ID = computeBuildId();
// Lets the server's own notification watcher call the service proxies without a login cookie.
const INTERNAL_TOKEN = crypto.randomBytes(24).toString('hex');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Notepad on Windows may save JSON with a byte-order mark, which JSON.parse rejects.
const readConfigFile = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));

function loadConfig() {
  let cfg = {};
  try {
    cfg = readConfigFile();
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${CONFIG_PATH}: ${err.message}`);
  }
  cfg.services = cfg.services || {};
  for (const name of SERVICES) cfg.services[name] = cfg.services[name] || {};

  // Environment variables override the file (handy for Docker).
  const env = process.env;
  const set = (svc, key, value) => { if (value !== undefined && value !== '') cfg.services[svc][key] = value; };
  for (const svc of SERVICES) {
    const p = svc.toUpperCase();
    set(svc, 'url', env[`${p}_URL`]);
    set(svc, 'publicUrl', env[`${p}_PUBLIC_URL`]);
    set(svc, 'apiKey', env[`${p}_API_KEY`]);
  }
  set('nzbget', 'username', env.NZBGET_USERNAME);
  set('nzbget', 'password', env.NZBGET_PASSWORD);
  set('jellyfin', 'userId', env.JELLYFIN_USER_ID);
  if (env.PORTAL_PASSWORD) cfg.portalPassword = env.PORTAL_PASSWORD;
  if (env.FILE_ROOTS) cfg.fileRoots = env.FILE_ROOTS.split(path.delimiter).filter(Boolean);
  if (MOCK) cfg.fileRoots = require('./mock').demoFileRoots();
  return cfg;
}

let config = loadConfig();
const PORT = Number(process.env.PORT) || Number(config.port) || 8080;

function saveConfig(next) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  config = loadConfig();
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');
const isConfigured = (svc) => {
  const c = config.services[svc];
  if (!c || !c.url) return false;
  return svc === 'nzbget' ? true : Boolean(c.apiKey);
};

// Shape of the config the browser is allowed to see: no secrets.
function publicConfig() {
  const services = {};
  for (const svc of SERVICES) {
    const c = config.services[svc];
    services[svc] = {
      configured: MOCK || isConfigured(svc),
      url: c.url || '',
      publicUrl: trimSlash(c.publicUrl || c.url || ''),
      username: c.username || '',
      userId: c.userId || '',
      hasApiKey: Boolean(c.apiKey),
      hasPassword: Boolean(c.password),
    };
  }
  return { services, mock: MOCK, auth: Boolean(config.portalPassword), files: filesStatus(), version: VERSION, appSettings: appSettings.resolve(config.appSettings) };
}

// The file manager can change anything inside its folders, so it also requires a portal password.
function filesStatus() {
  const roots = files.rootList(config).map((r) => r.path);
  let reason = null;
  if (!config.portalPassword && !MOCK) reason = 'password';
  else if (!roots.length) reason = 'roots';
  return { enabled: !reason, reason, roots };
}

// ---------------------------------------------------------------------------
// Authentication (optional — enabled when a portal password is set)
// ---------------------------------------------------------------------------

function sign(value) {
  return crypto.createHmac('sha256', String(config.portalPassword)).update(value).digest('base64url');
}

function makeSession() {
  const expires = String(Date.now() + SESSION_DAYS * 864e5);
  return `${expires}.${sign(expires)}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Sessions locked by the screensaver ("require password to return"). Unlocking means logging in
// again, which issues a new, unlocked session cookie. Every tab using the locked cookie sees the lock.
const lockedSessions = new Map();     // session token -> its expiry time
const sessionToken = (req) => parseCookies(req).mediadesk_session || '';
function isLocked(req) {
  const exp = lockedSessions.get(sessionToken(req));
  if (!exp) return false;
  if (exp < Date.now()) { lockedSessions.delete(sessionToken(req)); return false; }
  return true;
}

function isAuthed(req, { ignoreLock = false } = {}) {
  if (!config.portalPassword) return true;
  if (!ignoreLock && isLocked(req)) return false;
  const internal = req.headers['x-mediadesk-internal'];
  if (internal && internal.length === INTERNAL_TOKEN.length && crypto.timingSafeEqual(Buffer.from(internal), Buffer.from(INTERNAL_TOKEN))) return true;
  const token = parseCookies(req).mediadesk_session || '';
  const [expires, sig] = token.split('.');
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Basic brute-force protection for the login endpoint.
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 15 * 60e3) { entry.count = 0; entry.since = now; }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count > 10;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------------------
// Service proxies
// ---------------------------------------------------------------------------

const HOP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

async function pipeUpstream(res, upstream) {
  const headers = {};
  upstream.headers.forEach((v, k) => { if (!HOP_HEADERS.has(k)) headers[k] = v; });
  // fetch() only changes the body when it decompresses it; otherwise keep the length (media players need it to seek).
  if (!upstream.headers.get('content-encoding') && upstream.headers.get('content-length')) headers['content-length'] = upstream.headers.get('content-length');
  res.writeHead(upstream.status, headers);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
}

// Radarr, Sonarr, Jellyfin: REST passthrough with credentials injected server-side.
async function proxyRest(req, res, svc, rest, search) {
  const c = config.services[svc];
  if (!isConfigured(svc)) return sendJson(res, 503, { error: `${svc} is not configured` });

  const headers = { Accept: req.headers.accept || 'application/json' };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  // Byte ranges let the browser seek within audio and video streams.
  for (const name of ['range', 'if-range']) if (req.headers[name]) headers[name] = req.headers[name];
  if (svc === 'jellyfin') {
    headers['X-Emby-Token'] = c.apiKey;
    headers.Authorization = `MediaBrowser Client="MediaDesk", Device="MediaDesk", DeviceId="mediadesk", Version="1.0.0", Token="${c.apiKey}"`;
  } else {
    headers['X-Api-Key'] = c.apiKey;
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await readBody(req) : undefined;
  const target = `${trimSlash(c.url)}/${rest}${search}`;
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(30e3) });
    await pipeUpstream(res, upstream);
  } catch (err) {
    sendJson(res, 502, { error: `Could not reach ${svc}: ${err.cause?.code || err.message}` });
  }
}

// NZBGet: JSON-RPC. The browser posts {method, params}; we add the auth.
async function proxyNzbget(req, res) {
  const c = config.services.nzbget;
  if (!isConfigured('nzbget')) return sendJson(res, 503, { error: 'nzbget is not configured' });
  const { method, params = [] } = await readJson(req);
  if (typeof method !== 'string' || !/^[a-z]+$/i.test(method)) return sendJson(res, 400, { error: 'Invalid method' });

  const headers = { 'Content-Type': 'application/json' };
  if (c.username) headers.Authorization = 'Basic ' + Buffer.from(`${c.username}:${c.password || ''}`).toString('base64');
  try {
    const upstream = await fetch(`${trimSlash(c.url)}/jsonrpc`, {
      method: 'POST', headers, body: JSON.stringify({ version: '1.1', id: 1, method, params }),
      signal: AbortSignal.timeout(30e3),
    });
    if (upstream.status === 401) return sendJson(res, 401, { error: 'NZBGet rejected the username/password' });
    const data = await upstream.json();
    if (data.error) return sendJson(res, 400, { error: data.error.message || 'NZBGet error' });
    sendJson(res, 200, data.result);
  } catch (err) {
    sendJson(res, 502, { error: `Could not reach nzbget: ${err.cause?.code || err.message}` });
  }
}

// ---------------------------------------------------------------------------
// Portal endpoints
// ---------------------------------------------------------------------------

async function updateConfig(req, res) {
  const body = await readJson(req);
  const next = fs.existsSync(CONFIG_PATH) ? readConfigFile() : {};
  next.services = next.services || {};
  for (const svc of SERVICES) {
    const incoming = body.services?.[svc];
    if (!incoming) continue;
    const cur = (next.services[svc] = next.services[svc] || {});
    for (const key of ['url', 'publicUrl', 'username', 'userId']) {
      if (typeof incoming[key] === 'string') cur[key] = incoming[key].trim();
    }
    // Secrets are only replaced when a new value is supplied.
    for (const key of ['apiKey', 'password']) {
      if (typeof incoming[key] === 'string' && incoming[key] !== '') cur[key] = incoming[key].trim();
    }
  }
  if (body.appSettings) next.appSettings = appSettings.merge(next.appSettings, body.appSettings);
  if (Array.isArray(body.fileRoots)) {
    const { roots, errors } = await files.validateRoots(body.fileRoots);
    if (errors.length) return sendJson(res, 400, { error: `Check these folders: ${errors.join('; ')}` });
    next.fileRoots = roots;
  }
  saveConfig(next);
  sendJson(res, 200, publicConfig());
}

async function testService(svc) {
  if (MOCK) return { ok: true, version: 'mock' };
  if (!isConfigured(svc)) return { ok: false, error: 'Not configured' };
  const c = config.services[svc];
  const base = trimSlash(c.url);
  try {
    let r;
    if (svc === 'nzbget') {
      const headers = { 'Content-Type': 'application/json' };
      if (c.username) headers.Authorization = 'Basic ' + Buffer.from(`${c.username}:${c.password || ''}`).toString('base64');
      r = await fetch(`${base}/jsonrpc`, { method: 'POST', headers, body: '{"method":"version"}', signal: AbortSignal.timeout(8e3) });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, version: (await r.json()).result };
    }
    if (svc === 'jellyfin') {
      r = await fetch(`${base}/System/Info`, { headers: { 'X-Emby-Token': c.apiKey }, signal: AbortSignal.timeout(8e3) });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, version: (await r.json()).Version };
    }
    r = await fetch(`${base}/api/v3/system/status`, { headers: { 'X-Api-Key': c.apiKey }, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, version: (await r.json()).version };
  } catch (err) {
    return { ok: false, error: err.cause?.code || err.message };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const mock = MOCK ? require('./mock') : null;

// --- Notifications ------------------------------------------------------------

// Call a service through this server's own proxy (which adds credentials, or serves demo data).
async function callApi(svc, rest, { method = 'GET', body } = {}) {
  const host = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
  const url = svc === 'nzbget' ? `http://${host}:${PORT}/api/nzbget` : `http://${host}:${PORT}/api/${svc}/${rest}`;
  const res = await fetch(url, {
    method, signal: AbortSignal.timeout(20e3),
    headers: { 'X-MediaDesk': '1', 'X-MediaDesk-Internal': INTERNAL_TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const notificationsFile = MOCK
  ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-notifications.json')
  : path.join(path.dirname(CONFIG_PATH), 'notifications.json');
if (MOCK) fs.rmSync(notificationsFile, { force: true });
const notifier = createNotifier({
  file: notificationsFile,
  isConfigured: (svc) => MOCK || isConfigured(svc),
  settings: () => appSettings.resolve(config.appSettings),
  callApi,
  log: (msg) => console.log(msg),
});
if (MOCK) mock.seedNotifications(notifier);

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Changes must come from MediaDesk's own pages: browsers won't let another site send this
  // header without a CORS preflight, which this server never approves.
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && (p.startsWith('/api/') || p.startsWith('/portal/')) && req.headers['x-mediadesk'] !== '1') {
    // Usually a page that was opened before MediaDesk was updated and is still running old code.
    return sendJson(res, 403, { error: 'This page is out of date because MediaDesk was updated. Reload the page (Ctrl+F5) and try again.', code: 'stale-page' });
  }

  // Public routes
  if (p === '/portal/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (tooManyAttempts(ip)) return sendJson(res, 429, { error: 'Too many attempts — try again later' });
    const { password } = await readJson(req);
    if (!config.portalPassword || !safeEqual(password || '', config.portalPassword)) {
      return sendJson(res, 401, { error: 'Incorrect password' });
    }
    loginAttempts.delete(ip);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `mediadesk_session=${makeSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`,
    });
  }
  if (p === '/portal/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'mediadesk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (p === '/portal/session') {
    return sendJson(res, 200, { authed: isAuthed(req), locked: isLocked(req) && isAuthed(req, { ignoreLock: true }), auth: Boolean(config.portalPassword), build: BUILD_ID });
  }
  if (p === '/portal/lock' && req.method === 'POST') {
    if (!config.portalPassword) return sendJson(res, 400, { error: 'Set a portal password to lock MediaDesk' });
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Not logged in' });
    const now = Date.now();
    for (const [t, exp] of lockedSessions) if (exp < now) lockedSessions.delete(t);
    lockedSessions.set(sessionToken(req), Number(sessionToken(req).split('.')[0]) || now + SESSION_DAYS * 864e5);
    return sendJson(res, 200, { locked: true });
  }

  const isApi = p.startsWith('/api/') || p.startsWith('/portal/');
  if (!isApi) return serveStatic(req, res, p);
  // While locked, music that's already playing from Jellyfin may keep streaming; nothing else works.
  const lockedMusic = req.method === 'GET' && p.startsWith('/api/jellyfin/Audio/') && isAuthed(req, { ignoreLock: true });
  if (!isAuthed(req) && !lockedMusic) return sendJson(res, 401, { error: isLocked(req) ? 'MediaDesk is locked' : 'Not logged in', locked: isLocked(req) });

  if (p.startsWith('/portal/files/')) {
    const status = filesStatus();
    if (!status.enabled) {
      return sendJson(res, 403, { error: status.reason === 'password' ? 'Set a portal password to use Files' : 'No folders are shared yet. Add some in Settings → Files.' });
    }
    return files.handle(req, res, url, { config, sendJson, readJson });
  }

  if (p === '/portal/config' && req.method === 'GET') return sendJson(res, 200, publicConfig());
  if (p === '/portal/config' && req.method === 'POST') {
    if (MOCK) {
      // Demo mode: app preferences can be tried out (kept in memory); connections can't change.
      const body = await readJson(req);
      if (body.services || body.fileRoots) return sendJson(res, 400, { error: 'Connections and folders are read-only in demo mode' });
      if (body.appSettings) config.appSettings = appSettings.merge(config.appSettings, body.appSettings);
      return sendJson(res, 200, publicConfig());
    }
    return updateConfig(req, res);
  }
  if (p === '/portal/notifications' && req.method === 'GET') return sendJson(res, 200, notifier.summary());
  if (p === '/portal/notifications/read' && req.method === 'POST') {
    notifier.markRead((await readJson(req)).app);
    return sendJson(res, 200, notifier.summary());
  }
  if (p === '/portal/notifications/clear' && req.method === 'POST') {
    notifier.clear((await readJson(req)).app);
    return sendJson(res, 200, notifier.summary());
  }
  if (p === '/portal/test') {
    const results = {};
    await Promise.all(SERVICES.map(async (s) => { results[s] = await testService(s); }));
    return sendJson(res, 200, results);
  }

  const m = p.match(/^\/api\/(radarr|sonarr|nzbget|jellyfin)(?:\/(.*))?$/);
  if (!m) return sendJson(res, 404, { error: 'Unknown endpoint' });
  const [, svc, rest = ''] = m;

  if (mock) return mock.handle(req, res, svc, rest, url, { readJson, sendJson });
  if (svc === 'nzbget') return proxyNzbget(req, res);
  return proxyRest(req, res, svc, rest, url.search);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another copy of MediaDesk (or another program) is probably running. Stop it, or choose a different port.`);
  } else {
    console.error('Server error:', err);
  }
  exitAfterLog(1);
});

server.listen(PORT, HOST, () => {
  console.log(`MediaDesk ${VERSION} starting`);
  notifier.start();
  console.log(`MediaDesk running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${MOCK ? '  (demo mode, fake data)' : ''}`);
  if (!MOCK) {
    const missing = SERVICES.filter((s) => !isConfigured(s));
    if (missing.length) console.log(`Not configured yet: ${missing.join(', ')} - open Settings in the portal or edit ${CONFIG_PATH}`);
  }
  if (!config.portalPassword) console.log('Warning: no portal password set. Set PORTAL_PASSWORD if this is reachable by others.');
});
