#!/usr/bin/env node
// MediaDesk — a unified desktop-style portal for Radarr, Sonarr, NZBGet and Jellyfin.
// Zero dependencies: requires Node.js 18+ (uses the built-in fetch).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { AsyncLocalStorage } = require('node:async_hooks');
const files = require('./files');
const appSettings = require('./appsettings');
const { createNotifier } = require('./notify');
const { createWallpapers } = require('./wallpapers');
const media = require('./media');
const { createGames } = require('./games');
const { createPikvm } = require('./pikvm');
const { createArchive } = require('./archive');
const { createFamily } = require('./family');
const { createEbooks } = require('./ebooks');
const { createTrips } = require('./trips');
const { createUsers } = require('./users');
const { sendMail } = require('./smtp');
const { createNetShares } = require('./netshares');
const { createMaps } = require('./maps');
const { createSports } = require('./sports');

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
const SERVICES = ['radarr', 'sonarr', 'nzbget', 'jellyfin', 'plex', 'pikvm'];
const SESSION_DAYS = 30;
let BUILD_ID = computeBuildId();
// MediaDesk updated without restarting (new files in public/): a new build, so browsers fetch the
// new scripts and styles instead of mixing new code with styles they kept from before.
let buildCheckedAt = Date.now();
function checkBuild() {
  if (Date.now() - buildCheckedAt < 10e3) return;
  buildCheckedAt = Date.now();
  const now = computeBuildId();
  if (now !== BUILD_ID) { BUILD_ID = now; indexHtml = familyHtml = tripShareHtml = null; }
}
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
  set('pikvm', 'username', env.PIKVM_USERNAME);
  set('pikvm', 'password', env.PIKVM_PASSWORD);
  set('plex', 'apiKey', env.PLEX_TOKEN);
  // Plex identifies each app that talks to it; keep one stable id for this MediaDesk.
  cfg.plexClientId = MOCK ? 'mediadesk-demo' : `mediadesk-${crypto.createHash('sha1').update(`${require('node:os').hostname()}|${CONFIG_PATH}`).digest('hex').slice(0, 16)}`;
  if (env.PORTAL_PASSWORD) cfg.portalPassword = env.PORTAL_PASSWORD;
  if (env.FILE_ROOTS) cfg.fileRoots = env.FILE_ROOTS.split(path.delimiter).filter(Boolean);
  if (MOCK) cfg.fileRoots = require('./mock').demoFileRoots();
  // Network shares (Settings → Files) are shared folders too, named after the share.
  if (!MOCK && Array.isArray(cfg.networkShares) && cfg.networkShares.length) {
    const { rootFor } = require('./netshares');
    cfg.fileRoots = Array.isArray(cfg.fileRoots) ? [...cfg.fileRoots] : [];
    cfg.fileRootInfo = { ...(cfg.fileRootInfo || {}) };
    for (const sh of cfg.networkShares) {
      const r = path.resolve(rootFor(path.dirname(CONFIG_PATH), sh));
      if (!cfg.fileRoots.some((x) => path.resolve(String(x)) === r)) cfg.fileRoots.push(r);
      cfg.fileRootInfo[r] = { ...(cfg.fileRootInfo[r] || {}), alias: sh.name };
    }
  }
  if (env.GAMES_DIR) cfg.gamesFolder = env.GAMES_DIR;
  if (env.EBOOKS_DIR) cfg.ebooksFolder = env.EBOOKS_DIR;
  if (env.EBOOK_CONVERT_PATH) cfg.ebookConvertPath = env.EBOOK_CONVERT_PATH;
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
  if (svc === 'nzbget') return true;
  // PiKVM logs in with a user name and password (admin by default).
  if (svc === 'pikvm') return Boolean(c.password);
  return Boolean(c.apiKey);
};

// Shape of the config the browser is allowed to see: no secrets.
const SERVICE_APPS = { radarr: ['radarr'], sonarr: ['sonarr'], nzbget: ['nzbget'], jellyfin: ['jellyfin', 'music'], plex: ['plex', 'plexviewer'], pikvm: ['pikvm'] };
function publicConfig(u = reqUser()) {
  const services = {};
  for (const svc of SERVICES) {
    const c = config.services[svc];
    services[svc] = {
      // A service someone can't use looks unset to them (no dashboard widgets or links for it).
      configured: (MOCK || isConfigured(svc)) && (SERVICE_APPS[svc] || []).some((a) => users.can(u, a)),
      url: c.url || '',
      publicUrl: trimSlash(c.publicUrl || c.url || ''),
      username: c.username || '',
      userId: c.userId || '',
      hasApiKey: Boolean(c.apiKey),
      hasPassword: Boolean(c.password),
      ...(svc === 'pikvm' ? { verifyTls: Boolean(c.verifyTls) } : {}),
    };
  }
  return {
    services, mock: MOCK, auth: users.enabled(), files: filesStatus(u), version: VERSION,
    // An admin's preferences are everyone's defaults; others can have their own on top.
    appSettings: appSettings.resolve(u.role === 'admin' ? config.appSettings : appSettings.merge(config.appSettings || {}, users.byId(u.id)?.appSettings || {})),
    usersFolder: u.role === 'admin' ? personalBase() : undefined,
    media: { ...media.status(), ffmpegPath: config.ffmpegPath || '', libreOfficePath: config.libreOfficePath || '' },
    archive: { ...archive.status(), sevenZipPath: config.sevenZipPath || '' },
    games: { folder: MOCK ? '(demo games)' : config.gamesFolder || '' },
    ebooks: { folder: MOCK ? '(demo books)' : config.ebooksFolder || '', mineList: true, kindle: u.role === 'admin' ? { ...kindlePublic(), email: kindleFor(u).email } : { email: kindleFor(u).email, smtp: { ready: Boolean(config.kindle?.smtp?.host) } }, personal: personalOn(u) },
  };
}

// Send to Kindle settings as the browser sees them: everything but the password.
function kindlePublic() {
  const k = config.kindle || {};
  const m = k.smtp || {};
  return { email: k.email || '', smtp: { host: m.host || '', port: m.port || 587, security: m.security || 'starttls', user: m.user || '', from: m.from || '', hasPassword: Boolean(m.pass) } };
}
// New Send to Kindle settings: a blank password keeps the one saved.
function mergeKindle(prev = {}, body = {}) {
  const email = String(body.email ?? prev.email ?? '').trim().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('That Kindle email address doesn’t look right'), { status: 400 });
  const b = body.smtp || {};
  const p = prev.smtp || {};
  const pick = (k, max = 200) => String(b[k] ?? p[k] ?? '').trim().slice(0, max);
  const smtp = { host: pick('host'), port: Math.min(65535, Math.max(1, Number(b.port ?? p.port) || 587)), security: ['tls', 'starttls', 'none'].includes(b.security) ? b.security : p.security || 'starttls', user: pick('user'), from: pick('from'), pass: b.clearPassword ? '' : typeof b.pass === 'string' && b.pass ? b.pass.slice(0, 500) : p.pass || '' };
  if (smtp.from && !/@/.test(smtp.from)) throw Object.assign(new Error('The From address doesn’t look right'), { status: 400 });
  return { email, smtp };
}

// The file manager can change anything inside its folders, so it also requires a portal password.
function filesStatus(u = reqUser()) {
  const list = files.rootList(filesConfigFor(u));
  const roots = list.map((r) => r.path);
  let reason = null;
  if (!users.enabled() && !MOCK) reason = 'password';
  else if (!roots.length) reason = 'roots';
  return { enabled: !reason, reason, roots, folders: list.map(({ path: p, alias, tags, folderName, network }) => ({ path: p, alias, tags, folderName, network: network || null })), tags: config.fileTags || [] };
}

// ---------------------------------------------------------------------------
// Authentication (optional — enabled when a portal password is set)
// ---------------------------------------------------------------------------

// Sessions belong to user accounts (users.js). Without accounts MediaDesk is open, used as its
// owner (with a warning at start-up); in the demo nobody signs in.
const parseCookies = (req) => {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

// Sessions locked by the screensaver ("require password to return"). Unlocking means signing in
// again, which issues a new, unlocked session cookie. Every tab using the locked cookie sees the lock.
const lockedSessions = new Map();     // session token -> its expiry time
const sessionToken = (req) => parseCookies(req).mediadesk_session || '';
function isLocked(req) {
  const exp = lockedSessions.get(sessionToken(req));
  if (!exp) return false;
  if (exp < Date.now()) { lockedSessions.delete(sessionToken(req)); return false; }
  return true;
}

// The person making a request, or null (not signed in, or locked).
function currentUser(req, { ignoreLock = false } = {}) {
  if (!users.enabled()) return users.OWNER;
  const internal = req.headers['x-mediadesk-internal'];
  if (internal && internal.length === INTERNAL_TOKEN.length && crypto.timingSafeEqual(Buffer.from(internal), Buffer.from(INTERNAL_TOKEN))) return users.byId(users.ownerId()) || users.OWNER;
  if (!ignoreLock && isLocked(req)) return null;
  return users.fromToken(sessionToken(req));
}
const isAuthed = (req, opts) => Boolean(currentUser(req, opts));
const sessionCookie = (req) => (value, maxAge) => `mediadesk_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

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
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream',
  '.md': 'text/plain; charset=utf-8',
};

// The page loads its scripts and styles from /v/<build>/…, so every update uses new addresses.
// Caches in between (a Cloudflare tunnel keeps .js and .css files for hours whatever the server
// says) then can't hand out old code with a new page. Those files never change at a given address,
// so they may be kept for a long time; the page itself is never cached.
let indexHtml = null;
function serveIndex(req, res) {
  checkBuild();
  if (!indexHtml) {
    indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
      .replace(/(href|src)="(css|js)\//g, `$1="v/${BUILD_ID}/$2/`);
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : indexHtml);
}

// The Family Organizer on its own page, with the same versioned assets as MediaDesk.
let familyHtml = null;
function serveFamilyPage(req, res) {
  checkBuild();
  familyHtml ||= fs.readFileSync(path.join(PUBLIC_DIR, 'family.html'), 'utf8').replace(/(href|src)="(css|js)\//g, `$1="/v/${BUILD_ID}/$2/`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
  res.end(req.method === 'HEAD' ? undefined : familyHtml);
}

// A shared trip's page (read-only, no sign-in), with the same versioned assets.
let tripShareHtml = null;
function serveTripSharePage(req, res) {
  checkBuild();
  tripShareHtml ||= fs.readFileSync(path.join(PUBLIC_DIR, 'trip-share.html'), 'utf8').replace(/(href|src)="(css|js)\//g, `$1="/v/${BUILD_ID}/$2/`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : tripShareHtml);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  const versioned = /^\/v\/[A-Za-z0-9_-]{1,64}(\/.*)$/.exec(rel);
  if (versioned) rel = versioned[1];
  if (rel === '/' || rel === '/index.html') return serveIndex(req, res);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'Not found' });
    // Let browsers re-use unchanged files (the PDF viewer alone is several MB).
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const cache = versioned ? 'public, max-age=31536000, immutable' : 'no-cache';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); return res.end(); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      ETag: etag,
      // The Game Console's player: emulators that use threads (PSP) need an isolated page.
      ...(rel === '/console-player.html' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}),
    });
    if (req.method === 'HEAD') return res.end();
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
  if (upstream.body) {
    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => res.end());
    body.pipe(res);
  } else res.end();
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
  } else if (svc === 'plex') {
    Object.assign(headers, plexHeaders(c.apiKey));
    if (!req.headers.accept || req.headers.accept === '*/*') headers.Accept = 'application/json';
  } else {
    headers['X-Api-Key'] = c.apiKey;
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await readBody(req) : undefined;
  const target = `${trimSlash(c.url)}/${rest}${search}`;
  // Give up if the service doesn't answer within 30 s, but let an answer stream for as long as it
  // needs (a film can play for hours). Stop fetching if the browser goes away.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timed out')), 30e3);
  res.on('close', () => ctrl.abort());
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, signal: ctrl.signal });
    clearTimeout(timer);
    // Plex answers refusals with a bare HTML page; say what it means instead.
    if (svc === 'plex' && (upstream.status === 401 || upstream.status === 403) && !/json/.test(upstream.headers.get('content-type') || '')) {
      upstream.body?.cancel().catch(() => {});
      return sendJson(res, upstream.status, { code: 'plex-not-admin', error: upstream.status === 401
        ? 'Plex rejected MediaDesk’s token. Sign in again in Settings → Plex.'
        : 'Plex only allows this for the server owner. MediaDesk’s Plex token isn’t the owner’s admin token — in Settings → Plex, click “Sign in with Plex” and sign in as the account (and Plex Home profile) that owns the server.' });
    }
    await pipeUpstream(res, upstream);
  } catch (err) {
    clearTimeout(timer);
    if (!res.headersSent) sendJson(res, 502, { error: `Could not reach ${svc}: ${err.cause?.code || err.message}` });
    else res.end();
  }
}

// Headers Plex expects from every app; the token is added here so the browser never sees it.
function plexHeaders(token) {
  return {
    'X-Plex-Token': token || '',
    'X-Plex-Client-Identifier': config.plexClientId,
    'X-Plex-Product': 'MediaDesk',
    'X-Plex-Version': VERSION.split(' ')[0] || '1.0',
    'X-Plex-Device-Name': 'MediaDesk',
    'X-Plex-Device': 'MediaDesk',
  };
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
    if (svc === 'pikvm' && typeof incoming.verifyTls === 'boolean') cur.verifyTls = incoming.verifyTls;
    // Secrets are only replaced when a new value is supplied.
    for (const key of ['apiKey', 'password']) {
      if (typeof incoming[key] === 'string' && incoming[key] !== '') cur[key] = incoming[key].trim();
    }
  }
  if (body.appSettings) next.appSettings = appSettings.merge(next.appSettings, body.appSettings);
  if (Array.isArray(body.fileRoots)) {
    // Network shares' folders aren't kept in the list (they come from the shares themselves).
    const netRoots = new Set(netShares.roots().map((r) => path.resolve(r)));
    const { roots, errors } = await files.validateRoots(body.fileRoots.filter((r) => typeof r !== 'string' || !netRoots.has(path.resolve(r.trim()))));
    if (errors.length) return sendJson(res, 400, { error: `Check these folders: ${errors.join('; ')}` });
    next.fileRoots = roots;
  }
  if (Array.isArray(body.fileTags)) next.fileTags = files.cleanTags(body.fileTags);
  if (body.fileRootInfo || Array.isArray(body.fileTags) || Array.isArray(body.fileRoots)) {
    next.fileRootInfo = files.cleanRootInfo(body.fileRootInfo || next.fileRootInfo, [...(next.fileRoots || []), ...netShares.roots()], next.fileTags || []);
  }
  if (typeof body.gamesFolder === 'string') {
    const folder = body.gamesFolder.trim();
    if (folder) {
      const { roots, errors } = await files.validateRoots([folder]);
      if (errors.length) return sendJson(res, 400, { error: `Games folder: ${errors[0]}` });
      next.gamesFolder = roots[0];
    } else delete next.gamesFolder;
    games.invalidate();
  }
  if (typeof body.ebooksFolder === 'string') {
    const folder = body.ebooksFolder.trim();
    if (folder) {
      const { roots, errors } = await files.validateRoots([folder]);
      if (errors.length) return sendJson(res, 400, { error: `Books folder: ${errors[0]}` });
      next.ebooksFolder = roots[0];
    } else delete next.ebooksFolder;
    ebooks.invalidate();
  }
  if (body.kindle && typeof body.kindle === 'object') {
    try { next.kindle = mergeKindle(next.kindle, body.kindle); } catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }
  }
  if (typeof body.usersFolder === 'string') {
    const f = body.usersFolder.trim();
    if (f && !path.isAbsolute(f)) return sendJson(res, 400, { error: 'Personal folders: give the full path of a folder' });
    if (f) { try { fs.mkdirSync(f, { recursive: true }); fs.accessSync(f, fs.constants.W_OK); } catch { return sendJson(res, 400, { error: `MediaDesk can’t write to ${f}` }); } next.usersFolder = path.resolve(f); } else delete next.usersFolder;
  }
  let toolsChanged = false;
  for (const key of ['ffmpegPath', 'libreOfficePath']) {
    if (typeof body[key] === 'string' && body[key].trim() !== (next[key] || '')) { next[key] = body[key].trim(); toolsChanged = true; }
  }
  let sevenChanged = false;
  if (typeof body.sevenZipPath === 'string' && body.sevenZipPath.trim() !== (next.sevenZipPath || '')) {
    if (body.sevenZipPath.trim()) next.sevenZipPath = body.sevenZipPath.trim(); else delete next.sevenZipPath;
    sevenChanged = true;
  }
  saveConfig(next);
  if (toolsChanged || body.recheckTools) await media.detect(config);
  if (sevenChanged || body.recheckTools) await archive.detect();
  if (body.recheckTools || typeof body.ebookConvertPath === 'string') await ebooks.detectCalibre();
  sendJson(res, 200, publicConfig());
}

async function testService(svc) {
  if (MOCK) return { ok: true, version: 'mock' };
  if (!isConfigured(svc)) return { ok: false, error: 'Not configured' };
  if (svc === 'pikvm') return pikvm.test();
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
    if (svc === 'plex') {
      r = await fetch(`${base}/`, { headers: { ...plexHeaders(c.apiKey), Accept: 'application/json' }, signal: AbortSignal.timeout(8e3) });
      if (r.status === 401) return { ok: false, error: 'Plex rejected the token (HTTP 401)' };
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const mc = (await r.json()).MediaContainer || {};
      // Now Playing, history and tasks need the owner's (admin) token.
      const admin = await fetch(`${base}/status/sessions`, { headers: { ...plexHeaders(c.apiKey), Accept: 'application/json' }, signal: AbortSignal.timeout(8e3) })
        .then((x) => { x.body?.cancel().catch(() => {}); return x.status !== 401 && x.status !== 403; }).catch(() => true);
      return { ok: true, version: mc.version, name: mc.friendlyName, plexPass: Boolean(mc.myPlexSubscription), admin,
        ...(admin ? {} : { warning: 'Connected, but not as the server owner: Now Playing, history and scheduled tasks won’t work. Sign in with Plex as the owner.' }) };
    }
    r = await fetch(`${base}/api/v3/system/status`, { headers: { 'X-Api-Key': c.apiKey }, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, version: (await r.json()).version };
  } catch (err) {
    return { ok: false, error: err.cause?.code || err.message };
  }
}

// ---------------------------------------------------------------------------
// Sign in with Plex: the plex.tv PIN flow. The browser opens plex.tv to approve MediaDesk; the token
// it grants stays here, and the person only picks which server to use.
// ---------------------------------------------------------------------------

const plexPins = new Map();       // pin id -> { code, token, servers, at }
async function plexTv(pathAndQuery, { method = 'GET', token } = {}) {
  const r = await fetch(`https://plex.tv${pathAndQuery}`, { method, headers: { ...plexHeaders(token), Accept: 'application/json' }, signal: AbortSignal.timeout(15e3) });
  if (!r.ok) throw Object.assign(new Error(`plex.tv answered HTTP ${r.status}`), { status: 502 });
  return r.json();
}

async function plexSignIn(req, res, p) {
  for (const [id, pin] of plexPins) if (Date.now() - pin.at > 30 * 60e3) plexPins.delete(id);
  try {
    if (p === '/portal/plex/pin' && req.method === 'POST') {
      if (MOCK) {
        plexPins.set('demo', { code: 'DEMO', token: 'demo-token', at: Date.now() });
        return sendJson(res, 200, { id: 'demo', authUrl: 'about:blank' });
      }
      const pin = await plexTv('/api/v2/pins?strong=true', { method: 'POST' });
      plexPins.set(String(pin.id), { code: pin.code, at: Date.now() });
      const q = new URLSearchParams({ clientID: config.plexClientId, code: pin.code, 'context[device][product]': 'MediaDesk' });
      return sendJson(res, 200, { id: String(pin.id), authUrl: `https://app.plex.tv/auth#?${q}` });
    }
    const poll = /^\/portal\/plex\/pin\/([\w-]+)$/.exec(p);
    if (poll && req.method === 'GET') {
      const pin = plexPins.get(poll[1]);
      if (!pin) return sendJson(res, 404, { error: 'That sign-in has expired. Start again.' });
      if (!pin.token) {
        const r = await plexTv(`/api/v2/pins/${poll[1]}`);
        if (!r.authToken) return sendJson(res, 200, { done: false });
        pin.token = r.authToken;
      }
      if (!pin.servers) {
        if (MOCK) pin.servers = [{ id: 'mockplex', name: 'media-server (demo)', owned: true, connections: [{ uri: 'http://192.168.1.20:32400', local: true }] }];
        else {
          const list = await plexTv('/api/v2/resources?includeHttps=1&includeRelay=1', { token: pin.token });
          pin.servers = list.filter((r) => String(r.provides || '').includes('server')).map((r) => ({
            id: r.clientIdentifier, name: r.name, owned: Boolean(r.owned), accessToken: r.accessToken,
            connections: (r.connections || []).map((c) => ({ uri: c.uri, local: Boolean(c.local), relay: Boolean(c.relay) })),
          }));
        }
      }
      return sendJson(res, 200, { done: true, servers: pin.servers.map(({ accessToken, ...rest }) => rest) });
    }
    if (p === '/portal/plex/use' && req.method === 'POST') {
      const b = await readJson(req);
      const pin = plexPins.get(String(b.pin));
      const server = pin?.servers?.find((s) => s.id === b.server);
      if (!pin?.token || !server) return sendJson(res, 400, { error: 'Sign in with Plex again' });
      const uri = trimSlash(String(b.uri || ''));
      if (!server.connections.some((c) => c.uri === uri) && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(uri)) return sendJson(res, 400, { error: 'Choose one of the server addresses' });
      plexPins.delete(String(b.pin));
      if (MOCK) return sendJson(res, 200, publicConfig());
      const next = fs.existsSync(CONFIG_PATH) ? readConfigFile() : {};
      next.services = next.services || {};
      // On a server you own, your account token has full admin rights (Now Playing, history, tasks).
      // The per-server token from plex.tv can be more limited, so it is only used for shared servers.
      next.services.plex = { ...(next.services.plex || {}), url: uri, apiKey: server.owned ? pin.token : (server.accessToken || pin.token) };
      saveConfig(next);
      return sendJson(res, 200, publicConfig());
    }
    return sendJson(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    return sendJson(res, err.status || 502, { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const mock = MOCK ? require('./mock') : null;
const DATA_DIR = MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH);
const users = createUsers({
  dataDir: DATA_DIR, mock: MOCK, legacyPassword: () => config.portalPassword || '',
  publicUrl: () => process.env.PUBLIC_URL || config.publicUrl || '',
  // Invites and password resets go out through the email server (Settings → Users → Email).
  canEmail: () => Boolean(config.kindle?.smtp?.host),
  sendEmail: (to, subject, text) => {
    const smtp = config.kindle?.smtp;
    if (!smtp?.host) throw new Error('No email server is set up');
    if (MOCK) return Promise.resolve();
    return sendMail(smtp, { from: smtp.from || smtp.user, to, subject, text });
  },
});
// Who a request is from, for the apps (set for each request in handle()).
const requestContext = new AsyncLocalStorage();
const reqUser = () => requestContext.getStore()?.user || users.OWNER;
// With accounts, everyone has personal folders (Books, Games, Files) under one folder,
// <config folder>/users by default (Settings → Users can move it).
const personalBase = () => path.resolve(config.usersFolder || path.join(DATA_DIR, 'users'));
const personalOn = (u) => users.enabled() && u && !u.open;
const safeDirName = (s) => String(s).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_').slice(0, 60) || 'user';
function personalDir(u, kind) {
  const d = path.join(personalBase(), safeDirName(u.username), kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// A user's own data (reading places, saves, settings of their personal libraries).
const userDataDir = (u) => path.join(DATA_DIR, 'user-data', u.id);
async function renamePersonal(from, to) {
  const a = path.join(personalBase(), safeDirName(from));
  const b = path.join(personalBase(), safeDirName(to));
  if (fs.existsSync(a) && !fs.existsSync(b)) await fs.promises.rename(a, b).catch((err) => console.error(`Couldn’t rename ${a}: ${err.message}`));
}
// The first admin takes over what was used before there were accounts (nothing to move: data
// from then belongs to the first admin).
async function adoptOwnerData() {}
// Files: the shared folders a person may use (admins: all; others: all, or the ones picked for
// them) and their own "My files".
function filesConfigFor(u) {
  if (!personalOn(u)) return config;
  const allowed = (r) => u.role === 'admin' || !Array.isArray(u.folders) || u.folders.includes(path.resolve(r));
  const shared = (config.fileRoots || []).filter((r) => typeof r === 'string' && r.trim() && allowed(r.trim()));
  // "My files" is the person's whole folder: their Games (their own Game Console library) and Files.
  const mine = path.resolve(path.dirname(personalDir(u, 'Files')));
  personalDir(u, 'Games');
  return { ...config, fileRoots: [...shared, mine], fileRootInfo: { ...(config.fileRootInfo || {}), [mine]: { alias: 'My files', tags: [] } } };
}
// Send to Kindle: everyone's own Kindle address, through the email server an admin set up.
function kindleFor(u) {
  const k = config.kindle || {};
  const own = personalOn(u) && u.id !== users.ownerId() ? users.byId(u.id)?.kindleEmail || '' : u.kindleEmail || k.email || '';
  return { email: own, smtp: k.smtp };
}
const games = createGames({
  dataDir: MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH),
  getFolder: () => config.gamesFolder || '',
  mock: MOCK,
  sample: MOCK ? require('./mock-games').createSample() : null,
  // Saves, favourites and play history are each person's own (the first admin keeps the ones from before accounts).
  playerKey: () => { const u = reqUser(); return personalOn(u) && u.id !== users.ownerId() ? { id: u.id, name: safeDirName(u.username) } : null; },
});
const pikvm = createPikvm({ getConfig: () => config.services.pikvm });
const tripPlanner = createTrips({ dataDir: MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH), mock: MOCK, getUser: () => { const u = reqUser(); return { id: personalOn(u) ? u.id : null, name: u.name, color: u.color, admin: u.role === 'admin', accounts: users.enabled() }; } });
const ebooks = createEbooks({
  dataDir: MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH),
  getFolder: () => config.ebooksFolder || '',
  mock: MOCK,
  sample: MOCK ? require('./mock-ebooks').createSample() : null,
  // CBR / CB7 / CBT comics go through the Archive Expander's 7-Zip; AZW3, Word and the like through Calibre.
  getSevenZip: () => archive.status().path,
  getConvertPath: () => config.ebookConvertPath || '',
  // Send to Kindle: the reader's Kindle email address and the email server to send through.
  getKindle: () => kindleFor(reqUser()),
  resolveShared: (root, rel) => files.resolveInShared(filesConfigFor(reqUser()), Number(root), rel),
  filesEnabled: () => filesStatus(reqUser()).enabled,
  // Reading places and bookmarks are each person's own (the first admin keeps the ones from before accounts).
  readerKey: () => { const u = reqUser(); return personalOn(u) && u.id !== users.ownerId() ? u.id : null; },
});
// Books people had in a personal Books folder (before Mine became a list) move into the shared
// library, onto their Mine list. The eBook Reader has one library everyone shares.
async function adoptPersonalBooks(u) {
  const from = path.join(personalBase(), safeDirName(u.username), 'Books');
  const shared = config.ebooksFolder;
  if (!shared || !fs.existsSync(from)) return;
  const moved = [];
  const walk = async (dir, rel) => {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { await walk(abs, r); continue; }
      if (!/\.(epub|pdf|cbz|cbr|cb7|cbt|mobi|azw3?|prc|fb2|txt|rtf|docx|odt|lit)$/i.test(e.name)) continue;
      let dest = path.join(shared, ...r.split('/'));
      const stem = dest.replace(/\.[^.]+$/, '');
      const ext = dest.slice(stem.length);
      for (let n = 2; fs.existsSync(dest); n++) dest = `${stem} (${n})${ext}`;
      try {
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.rename(abs, dest).catch(async (err) => { if (err.code !== 'EXDEV') throw err; await fs.promises.copyFile(abs, dest); await fs.promises.unlink(abs); });
        moved.push(path.relative(shared, dest).split(path.sep).join('/'));
      } catch (err) { console.error(`eBook Reader: couldn’t move ${abs} into the library: ${err.message}`); }
    }
  };
  await walk(from, '');
  if (moved.length) { console.log(`eBook Reader: ${moved.length} book(s) of ${u.username} moved into the shared library (on their Mine list)`); await ebooks.adopt(moved); }
  await fs.promises.rm(from, { recursive: true }).catch(() => {});
}
const personalGames = new Map();
function gamesFor(u) {
  if (!personalGames.has(u.id)) personalGames.set(u.id, createGames({ dataDir: userDataDir(u), getFolder: () => personalDir(users.byId(u.id) || u, 'Games'), idSalt: `mine:${u.id}` }));
  return personalGames.get(u.id);
}
const maps = createMaps({ geo: tripPlanner.geo, mock: MOCK });
const sports = createSports({ dataDir: MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH), mock: MOCK });
const family = createFamily({ dataDir: MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-data') : path.dirname(CONFIG_PATH), mock: MOCK });
const archive = createArchive({ getConfig: () => filesConfigFor(reqUser()), resolveInShared: files.resolveInShared, filesEnabled: () => filesStatus(reqUser()).enabled });
// Network shares (SMB, NFS, SFTP, WebDAV) mounted as shared folders for Files.
const netShares = createNetShares({
  dataDir: path.dirname(CONFIG_PATH), mock: MOCK,
  getShares: () => (Array.isArray(config.networkShares) ? config.networkShares : []),
  setShares: async (list) => { const next = fs.existsSync(CONFIG_PATH) ? readConfigFile() : {}; next.networkShares = list; saveConfig(next); },
});
files.setNetwork({ offline: (abs) => netShares.offline(abs), info: (abs) => netShares.info(abs) });
const wallpapers = createWallpapers(MOCK ? path.join(require('node:os').tmpdir(), 'mediadesk-demo-wallpapers') : path.join(path.dirname(CONFIG_PATH), 'wallpapers'));

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

// Which apps an address belongs to (any of them gives access).
const FILE_APPS = ['files', 'music', 'notes', 'paint', 'paintpro', 'logs', 'archive', 'ebooks', 'preview'];
const FILE_WRITERS = ['files', 'notes', 'paint', 'paintpro', 'archive'];
const ROUTE_APPS = [
  ['/api/radarr/', ['radarr']], ['/api/sonarr/', ['sonarr']], ['/api/nzbget', ['nzbget']], ['/api/jellyfin/', ['jellyfin', 'music']],
  ['/api/plex/', ['plex', 'plexviewer']], ['/api/pikvm/', ['pikvm']], ['/portal/games/', ['console']], ['/portal/trips/', ['trips']], ['/portal/maps/', ['maps']],
  ['/portal/ebooks/', ['ebooks', 'files']], ['/portal/archive/', ['archive', 'files']], ['/portal/files/', FILE_APPS],
];
const appsFor = (p) => ROUTE_APPS.find(([prefix]) => p.startsWith(prefix))?.[1] || null;
// Changing MediaDesk itself (connections, signing in to Plex, testing services).
const ADMIN_ROUTES = ['/portal/test', '/portal/plex', '/portal/netshares'];
// Notifications only about apps a person has.
function notesFor(u, summary) {
  if (u.role === 'admin' || !summary || typeof summary !== 'object') return summary;
  const out = { ...summary };
  for (const k of Object.keys(out)) if (users.APPS[k] && !users.can(u, k)) delete out[k];
  if (Array.isArray(summary.items)) out.items = summary.items.filter((n) => !n.app || !users.APPS[n.app] || users.can(u, n.app));
  return out;
}

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

  // Signing in, your own account, and (for admins) everyone's.
  if (p === '/portal/login' || p.startsWith('/portal/login/') || p.startsWith('/portal/avatar/') || p.startsWith('/portal/passkey/') || p.startsWith('/portal/invite') || p.startsWith('/portal/reset') || p === '/portal/users/setup' || p === '/portal/me' || p.startsWith('/portal/me/') || p === '/portal/users' || p.startsWith('/portal/users/')) {
    const me = currentUser(req);
    const done = await users.handle(req, res, p, {
      user: me, ip: req.socket.remoteAddress || '', cookie: sessionCookie(req), sendJson, readJson, readBody,
      origin: `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`,
      onRename: (from, to) => renamePersonal(from, to),
      onFirstAdmin: (u) => adoptOwnerData(u),
    });
    if (done !== null) return done;
  }
  if (p === '/portal/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'mediadesk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (p === '/portal/session') {
    const me = currentUser(req);
    const only = users.enabled() && users.all().length === 1 ? users.all()[0] : null;
    return sendJson(res, 200, { authed: Boolean(me), locked: isLocked(req) && isAuthed(req, { ignoreLock: true }), auth: users.enabled(), user: me ? { ...users.publicUser(me), owner: me.id === users.ownerId() || Boolean(me.open) } : null, lockedUser: !me && isLocked(req) ? users.publicUser(currentUser(req, { ignoreLock: true })) : null, usernameHint: only?.migrated ? only.username : null, resetByEmail: users.enabled() && users.emailReady(), passkeys: users.enabled() && users.hasPasskeys(), build: (checkBuild(), BUILD_ID) });
  }
  if (p === '/portal/lock' && req.method === 'POST') {
    if (!users.enabled()) return sendJson(res, 400, { error: 'Turn on sign-in (Settings → Users) to lock MediaDesk' });
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Not logged in' });
    const now = Date.now();
    for (const [t, exp] of lockedSessions) if (exp < now) lockedSessions.delete(t);
    lockedSessions.set(sessionToken(req), Number(sessionToken(req).split('.')[2]) || now + SESSION_DAYS * 864e5);
    return sendJson(res, 200, { locked: true });
  }

  // The Family Organizer has accounts of its own (for using it on its own at /family); someone
  // signed in to MediaDesk counts as a parent.
  if (p.startsWith('/portal/family/')) {
    // Signed in to MediaDesk with the Family Organizer: a parent, or the kid an admin linked them to.
    const u = currentUser(req);
    const linked = u && users.can(u, 'family') && u.family?.role !== 'none' ? { id: u.id, name: u.name, role: u.family?.role || 'parent', profile: u.family?.profile || null, accounts: users.enabled() } : null;
    requestContext.getStore().user = u;
    return family.handle(req, res, url, { sendJson, readJson, readBody, portal: Boolean(linked), portalUser: linked, ip: req.socket.remoteAddress || '' });
  }
  if (p === '/family' || p === '/family/') return serveFamilyPage(req, res);

  // The family calendar for phones: its address has its own secret instead of a login.
  if (p.startsWith('/family-feed/') && req.method === 'GET') return family.feed(req, res, p, { sendJson });
  // Trip Planner: a trip shared read-only by its secret link, and trips as calendar feeds.
  if (/^\/trip\/[\w-]{20,}\/?$/.test(p) && req.method === 'GET') return serveTripSharePage(req, res);
  if ((p.startsWith('/trip-share/') || p.startsWith('/trip-feed/')) && (req.method === 'GET' || req.method === 'HEAD')) return tripPlanner.publicHandle(req, res, url, { sendJson });

  const isApi = p.startsWith('/api/') || p.startsWith('/portal/');
  if (!isApi) return serveStatic(req, res, p);
  // While locked, music that's already playing from Jellyfin may keep streaming; nothing else works.
  const lockedMusic = req.method === 'GET' && p.startsWith('/api/jellyfin/Audio/') && isAuthed(req, { ignoreLock: true });
  const me = currentUser(req) || (lockedMusic ? currentUser(req, { ignoreLock: true }) : null);
  if (!me) return sendJson(res, 401, { error: isLocked(req) ? 'MediaDesk is locked' : 'Not logged in', locked: isLocked(req) });
  requestContext.getStore().user = me;
  // Each app's addresses are only for people who have that app.
  const need = appsFor(p);
  if (need && !need.some((a) => users.can(me, a))) return sendJson(res, 403, { error: `You don’t have access to ${users.APPS[need[0]] || 'that'}. Ask an admin.`, noAccess: need[0] });
  if (ADMIN_ROUTES.some((r) => p === r || p.startsWith(`${r}/`)) && me.role !== 'admin') return sendJson(res, 403, { error: 'Only admins can do that' });
  // Apps that only open files (Music, eBook Reader, Preview, Log Viewer) can read shared folders, not change them.
  if (p.startsWith('/portal/files/') && !['GET', 'HEAD'].includes(req.method) && !FILE_WRITERS.some((a) => users.can(me, a))) return sendJson(res, 403, { error: 'You can open files, but not change them. Ask an admin for Files.' });

  if (p === '/portal/wallpapers' || p.startsWith('/portal/wallpapers/')) {
    return wallpapers.handle(req, res, url, {
      sendJson, readJson,
      resolveSharedFile: (root, rel) => {
        const status = filesStatus(me);
        if (!status.enabled) throw Object.assign(new Error('Shared folders are not set up'), { status: 403 });
        return files.resolveShared(filesConfigFor(me), root, rel);
      },
    });
  }
  if (p.startsWith('/portal/files/')) {
    const status = filesStatus(me);
    if (!status.enabled) {
      return sendJson(res, 403, { error: status.reason === 'password' ? 'Turn on sign-in (Settings → Users) to use Files' : 'No folders are shared yet. Add some in Settings → Files.' });
    }
    return files.handle(req, res, url, { config: filesConfigFor(me), sendJson, readJson });
  }

  if (p === '/portal/config' && req.method === 'GET') return sendJson(res, 200, publicConfig(me));
  // Everyone's own app preferences and Kindle address; everything else is for admins.
  if (p === '/portal/config' && req.method === 'POST' && me.role !== 'admin') {
    const body = await readJson(req);
    const extra = Object.keys(body).filter((k) => !['appSettings', 'kindle'].includes(k));
    if (extra.length) return sendJson(res, 403, { error: 'Only admins can change MediaDesk’s settings' });
    const u = users.byId(me.id);
    if (u) {
      if (body.appSettings) u.appSettings = appSettings.merge(u.appSettings || {}, body.appSettings);
      if (body.kindle && typeof body.kindle.email === 'string') {
        const email = body.kindle.email.trim().slice(0, 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'That Kindle email address doesn’t look right' });
        u.kindleEmail = email;
      }
      await users.save();
    }
    return sendJson(res, 200, publicConfig(me));
  }
  if (p === '/portal/config' && req.method === 'POST') {
    if (MOCK) {
      // Demo mode: app preferences can be tried out (kept in memory); connections can't change.
      const body = await readJson(req);
      if (body.services || body.fileRoots || typeof body.gamesFolder === 'string' || typeof body.ebooksFolder === 'string') return sendJson(res, 400, { error: 'Connections and folders are read-only in demo mode' });
      if (body.appSettings) config.appSettings = appSettings.merge(config.appSettings, body.appSettings);
      // Folder tags and aliases can be tried out too (kept in memory).
      if (Array.isArray(body.fileTags)) config.fileTags = files.cleanTags(body.fileTags);
      if (body.fileRootInfo || Array.isArray(body.fileTags)) config.fileRootInfo = files.cleanRootInfo(body.fileRootInfo || config.fileRootInfo, config.fileRoots || [], config.fileTags || []);
      if (body.recheckTools) { await media.detect(config); await archive.detect(); await ebooks.detectCalibre(); }
      // Send to Kindle can be filled in (kept in memory; nothing is really sent in the demo).
      if (body.kindle && typeof body.kindle === 'object') { try { config.kindle = mergeKindle(config.kindle, body.kindle); } catch (err) { return sendJson(res, err.status || 400, { error: err.message }); } }
      return sendJson(res, 200, publicConfig());
    }
    return updateConfig(req, res);
  }
  if (p === '/portal/notifications' && req.method === 'GET') return sendJson(res, 200, notesFor(me, notifier.summary()));
  if (p === '/portal/notifications/read' && req.method === 'POST') {
    notifier.markRead((await readJson(req)).app);
    return sendJson(res, 200, notesFor(me, notifier.summary()));
  }
  if (p === '/portal/notifications/clear' && req.method === 'POST') {
    notifier.clear((await readJson(req)).app);
    return sendJson(res, 200, notesFor(me, notifier.summary()));
  }
  if (p === '/portal/test') {
    const results = {};
    await Promise.all(SERVICES.map(async (s) => { results[s] = await testService(s); }));
    return sendJson(res, 200, results);
  }

  if (p.startsWith('/portal/plex/')) return plexSignIn(req, res, p);
  // Personal libraries: /portal/<app>/mine/… is the same app, on the person's own folder.
  if (p.startsWith('/portal/games/mine/')) {
    if (!personalOn(me)) return sendJson(res, 404, { error: 'Personal libraries come with user accounts (Settings → Users)' });
    const u2 = new URL(url);
    u2.pathname = p.replace('/mine/', '/');
    return gamesFor(me).handle(req, res, u2, { sendJson, readJson });
  }
  if (p === '/portal/ebooks/library' && personalOn(me)) await adoptPersonalBooks(me).catch((err) => console.error(`eBook Reader: ${err.message}`));
  if (p === '/portal/netshares' || p.startsWith('/portal/netshares/')) {
    if (MOCK && req.method !== 'GET') return sendJson(res, 400, { error: 'Network shares can’t be connected in demo mode' });
    return netShares.handle(req, res, p, { sendJson, readJson });
  }
  if (p.startsWith('/portal/sports/')) return sports.handle(req, res, p, { sendJson });
  if (p.startsWith('/portal/maps/')) return maps.handle(req, res, url, { sendJson });
  if (p.startsWith('/portal/games/')) return games.handle(req, res, url, { sendJson, readJson });
  if (p.startsWith('/portal/trips/')) return tripPlanner.handle(req, res, url, { sendJson, readJson });
  if (p.startsWith('/portal/ebooks/')) return ebooks.handle(req, res, url, { sendJson, readJson, readBody });
  if (p.startsWith('/portal/archive/')) return archive.handle(req, res, url, { sendJson, readJson });

  const m = p.match(/^\/api\/(radarr|sonarr|nzbget|jellyfin|plex|pikvm)(?:\/(.*))?$/);
  if (!m) return sendJson(res, 404, { error: 'Unknown endpoint' });
  const [, svc, rest = ''] = m;

  if (mock) return mock.handle(req, res, svc, rest, url, { readJson, sendJson });
  if (svc === 'nzbget') return proxyNzbget(req, res);
  if (svc === 'pikvm') {
    if (!isConfigured('pikvm')) return sendJson(res, 503, { error: 'pikvm is not configured' });
    return pikvm.proxy(req, res, rest, url.search, sendJson);
  }
  return proxyRest(req, res, svc, rest, url.search);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  requestContext.run({ user: null }, () => handle(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  });
});

// Big uploads (disc images, videos) can take longer than Node's default 5 minutes.
server.requestTimeout = 0;

// WebSockets: only PiKVM's keyboard/mouse channel, for a logged-in MediaDesk page on this site.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const origin = req.headers.origin;
  const sameSite = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  if (url.pathname !== '/api/pikvm/api/ws' || !sameSite || !isAuthed(req) || (!MOCK && !isConfigured('pikvm'))) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  if (MOCK) return mock.pikvmSocket(req, socket);
  pikvm.upgrade(req, socket, head, 'api/ws', url.search);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another copy of MediaDesk (or another program) is probably running. Stop it, or choose a different port.`);
  } else {
    console.error('Server error:', err);
  }
  exitAfterLog(1);
});

// Forgot the admin password: node server.js --reset-password <user name> <new password>
const resetArg = process.argv.indexOf('--reset-password');
if (resetArg !== -1) {
  const [who, pw] = process.argv.slice(resetArg + 1);
  users.resetPassword(who || '', pw || '')
    .then((u) => { console.log(`The password of ${u.username} was changed (and two-step sign-in turned off).`); exitAfterLog(0); })
    .catch((err) => { console.error(err.message); exitAfterLog(1); });
} else users.migrate().catch((err) => console.error(`Accounts: ${err.message}`)).then(() => server.listen(PORT, HOST, () => {
  netShares.connectAll().catch((err) => console.error(`Network shares: ${err.message}`));
  console.log(`MediaDesk ${VERSION} starting`);
  notifier.start();
  media.detect(config).then((t) => {
    const w = media.where();
    console.log(`Preview helpers: ffmpeg ${t.ffmpeg ? `found (${w.ffmpeg})` : w.ffmpeg ? 'found but ffprobe is missing' : 'not found'}, LibreOffice ${t.office ? `found (${w.soffice})` : 'not found'}`);
    if (!t.ffmpeg || !t.office) console.log('  Install the missing ones (see Settings -> Files), or enter their location there under "Installed somewhere unusual?".');
  });
  archive.detect().then((a) => console.log(`Archive Expander: 7-Zip ${a.available ? `${a.version} found (${a.path})` : 'not found - install 7-Zip to open and create archives (see Settings -> Files)'}`));
  console.log(`MediaDesk running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${MOCK ? '  (demo mode, fake data)' : ''}`);
  if (!MOCK) {
    const missing = SERVICES.filter((s) => !isConfigured(s));
    if (missing.length) console.log(`Not configured yet: ${missing.join(', ')} - open Settings in the portal or edit ${CONFIG_PATH}`);
  }
  if (!users.enabled() && !MOCK) console.log('Warning: there are no user accounts, so anyone who can reach MediaDesk can use it. Open Settings → Users to make an admin account (or set PORTAL_PASSWORD).');
}));
