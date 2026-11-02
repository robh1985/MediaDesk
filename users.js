'use strict';

// MediaDesk user accounts: who can sign in, what each person can use, and two-step sign-in with
// an authenticator app (Google Authenticator and the like: time-based codes, RFC 6238).
//
// Roles: admin (everything, including the settings and users), standard (every app but the
// admin-only ones) and custom (the apps an admin picks). Accounts are kept in users.json next to
// the config, passwords as scrypt hashes, and sessions as signed cookies that end when the
// password changes, the account is turned off, or "sign out everywhere" is used.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const passkeys = require('./passkeys');

const SESSION_DAYS = 30;
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const ROLES = ['admin', 'standard', 'custom'];

// Every app, and who gets it. "always": everyone (their own settings, search, viewers and small
// tools); "adminOnly": admins unless picked for a custom user.
const APPS = {
  dashboard: 'Dashboard', radarr: 'Radarr', sonarr: 'Sonarr', nzbget: 'NZBGet', jellyfin: 'Jellyfin', plex: 'Plex', plexviewer: 'Plex Viewer',
  pikvm: 'PiKVM', console: 'The Game Console', music: 'Music', files: 'Files', notes: 'Notes', logs: 'Log Viewer', archive: 'Archive Expander',
  convert: 'Convert', paint: 'Paint', paintpro: 'Paint Pro', family: 'Family Organizer', ebooks: 'eBook Reader', trips: 'Trip Planner',
  calculator: 'Calculator', webview: 'Web UI windows',
};
const ALWAYS = new Set(['settings', 'launcher', 'preview']);
const ADMIN_ONLY = new Set(['pikvm', 'logs']);

class UserError extends Error { constructor(status, message) { super(message); this.status = status; } }

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});
const clean = (s, max = 100) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// --- Authenticator codes (TOTP: HMAC-SHA1, 6 digits, 30 seconds) --------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// The time step a code belongs to (this one, or one either side for clocks a little out), or -1.
function totpStep(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return -1;
  const t = Math.floor(now / 30e3);
  for (const d of [0, -1, 1]) {
    const want = Buffer.from(hotp(secret, t + d));
    if (crypto.timingSafeEqual(want, Buffer.from(c))) return t + d;
  }
  return -1;
}

// sendEmail(to, subject, text) sends through MediaDesk's email server (null when there isn't one).
function createUsers({ dataDir, mock = false, legacyPassword = () => '', log = console.log, onChange = () => {}, sendEmail = null, canEmail = () => false, publicUrl = () => '' }) {
  const file = path.join(dataDir, 'users.json');
  let db = null;
  // In the demo, accounts are kept in memory only (until the demo restarts).
  function load() {
    if (db) return db;
    try { db = mock ? {} : JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = {}; }
    db.secret ||= crypto.randomBytes(32).toString('base64url');
    db.users ||= {};
    db.settings ||= {};
    return db;
  }
  async function save() {
    if (mock) { onChange(); return; }
    await fsp.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(load(), null, 1), { mode: 0o600 });
    await fsp.rename(tmp, file);
    onChange();
  }
  const all = () => Object.values(load().users);
  const byId = (id) => load().users[id] || null;
  const byName = (u) => all().find((x) => x.username === String(u || '').trim().toLowerCase()) || null;
  const admins = () => all().filter((u) => u.role === 'admin' && !u.disabled);
  // Sign-in is on once there's an account.
  const enabled = () => all().length > 0;

  // The portal password from before there were accounts becomes the "admin" account.
  async function migrate() {
    const pw = legacyPassword();
    if (all().length || !pw) return;
    const u = await create({ username: 'admin', name: 'Admin', role: 'admin', password: pw }, { allowShort: true });
    u.migrated = true;
    await save();
    log('MediaDesk: the portal password is now the password of the "admin" account (Settings → Users to add more people).');
  }

  // Without accounts (or in the demo) MediaDesk is used as this owner.
  const OWNER = Object.freeze({ id: 'owner', username: 'owner', name: 'Admin', role: 'admin', apps: [], color: '#3b82f6', open: true });
  // The first admin: whose data from before accounts (reading places, saves…) is theirs.
  const ownerId = () => (enabled() ? (all().filter((u) => u.role === 'admin').sort((a, b) => a.created - b.created)[0]?.id || 'owner') : 'owner');

  // --- Passwords ---
  async function setPassword(u, password, { allowShort = false } = {}) {
    if (!allowShort && String(password || '').length < 8) throw new UserError(400, 'Use a password of at least 8 characters');
    if (String(password || '').length > 200) throw new UserError(400, 'That password is too long');
    if (!password) throw new UserError(400, 'Enter a password');
    u.salt = crypto.randomBytes(16).toString('base64url');
    u.hash = (await scrypt(password, u.salt)).toString('base64url');
    u.ver = (u.ver || 0) + 1;
  }
  async function checkPassword(u, password) {
    if (!u?.hash) { await scrypt(password || '', 'x'.repeat(22)); return false; }
    const key = await scrypt(password || '', u.salt);
    const want = Buffer.from(u.hash, 'base64url');
    return want.length === key.length && crypto.timingSafeEqual(want, key);
  }

  // --- Sessions: "<id>.<version>.<expiry>.<signature>" -----------------------------------------
  const sign = (s) => crypto.createHmac('sha256', load().secret).update(s).digest('base64url');
  const verify = (body, sig) => { const a = Buffer.from(sign(body)); const b = Buffer.from(String(sig || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  function makeSession(u) {
    const body = `${u.id}.${u.ver || 0}.${Date.now() + SESSION_DAYS * 864e5}`;
    return `${body}.${sign(body)}`;
  }
  function fromToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 4) return null;
    if (!verify(parts.slice(0, 3).join('.'), parts[3])) return null;
    if (Number(parts[2]) < Date.now()) return null;
    const u = byId(parts[0]);
    if (!u || u.disabled || String(u.ver || 0) !== parts[1]) return null;
    return u;
  }
  // A short-lived pass between the password and the authenticator code.
  function ticketFor(u) { const body = `2fa.${u.id}.${u.ver || 0}.${Date.now() + 5 * 60e3}`; return `${body}.${sign(body)}`; }
  function fromTicket(t) {
    const parts = String(t || '').split('.');
    if (parts.length !== 5 || parts[0] !== '2fa' || !verify(parts.slice(0, 4).join('.'), parts[4]) || Number(parts[3]) < Date.now()) return null;
    const u = byId(parts[1]);
    return u && !u.disabled && String(u.ver || 0) === parts[2] ? u : null;
  }

  // --- What a person can use ---
  function appsOf(u) {
    if (!u) return [];
    if (u.role === 'admin') return [...Object.keys(APPS), ...ALWAYS];
    if (u.role === 'standard') return [...Object.keys(APPS).filter((a) => !ADMIN_ONLY.has(a) || (u.apps || []).includes(a)), ...ALWAYS];
    return [...new Set([...(u.apps || []).filter((a) => APPS[a]), ...ALWAYS])];
  }
  const can = (u, app) => appsOf(u).includes(app);

  const publicUser = (u, { full = false } = {}) => u && ({
    id: u.id, username: u.username, name: u.name || u.username, color: u.color || '#3b82f6', avatar: u.avatar || null, email: u.email || '', role: u.role, apps: u.role === 'custom' ? u.apps || [] : (u.apps || []).filter((a) => ADMIN_ONLY.has(a)),
    allowed: appsOf(u), twoFactor: Boolean(u.totp?.enabled), invited: Boolean(u.invite && !u.hash), disabled: Boolean(u.disabled), created: u.created || null, lastLogin: u.lastLogin || null,
    family: u.family || null, folders: u.folders ?? null, open: Boolean(u.open),
    passkeys: (u.passkeys || []).length,
    ...(full ? { recoveryLeft: (u.recovery || []).length, migrated: Boolean(u.migrated) } : {}),
  });

  // --- Making and changing accounts ---
  function fields(body, u = {}) {
    const username = body.username !== undefined ? clean(body.username, 40).toLowerCase() : u.username;
    if (!USERNAME.test(username || '')) throw new UserError(400, 'User names are 2–32 letters, digits, dots, dashes or underscores, starting with a letter or digit');
    const other = byName(username);
    if (other && other.id !== u.id) throw new UserError(409, 'That user name is taken');
    const role = body.role !== undefined ? body.role : u.role || 'standard';
    if (!ROLES.includes(role)) throw new UserError(400, 'Choose a role');
    const apps = Array.isArray(body.apps) ? [...new Set(body.apps.filter((a) => APPS[a]))] : u.apps || [];
    const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color.toLowerCase() : u.color || ['#3b82f6', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c'][all().length % 7];
    let folders = u.folders ?? null;
    if ('folders' in body) folders = body.folders === null ? null : (Array.isArray(body.folders) ? body.folders.map((f) => clean(f, 1000)).filter(Boolean).slice(0, 200) : null);
    let family = u.family || null;
    if ('family' in body) family = body.family && ['parent', 'kid', 'none'].includes(body.family.role) ? { role: body.family.role, profile: body.family.role !== 'none' && body.family.profile ? clean(body.family.profile, 60) : null } : null;
    const email = body.email !== undefined ? clean(body.email, 200).toLowerCase() : u.email || '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError(400, 'That email address doesn’t look right');
    if (email && all().some((x) => x.id !== u.id && x.email === email)) throw new UserError(409, 'Someone else has that email address');
    return { username, name: clean(body.name ?? u.name ?? username, 60) || username, role, apps, color, folders, family, email };
  }
  async function create(body, opts = {}) {
    const u = { id: crypto.randomBytes(8).toString('hex'), created: Date.now(), ...fields(body) };
    // Invited: no password yet; they choose one from the invite link.
    if (body.invite) u.ver = 1; else await setPassword(u, body.password, opts);
    load().users[u.id] = u;
    await save();
    return u;
  }
  async function update(u, body, actor) {
    const next = fields(body, u);
    // There's always an admin who can sign in.
    const losing = u.role === 'admin' && (next.role !== 'admin' || body.disabled === true);
    if (losing && admins().filter((a) => a.id !== u.id).length === 0) throw new UserError(400, 'There has to be at least one admin who can sign in');
    if (actor?.id === u.id && body.disabled === true) throw new UserError(400, 'You can’t turn off your own account');
    const oldName = u.username;
    Object.assign(u, next);
    if ('disabled' in body) { u.disabled = Boolean(body.disabled); if (u.disabled) u.ver = (u.ver || 0) + 1; }
    if (body.password) await setPassword(u, body.password);
    await save();
    return { user: u, renamed: oldName !== u.username ? oldName : null };
  }

  // --- Profile pictures (PNG, JPEG or WebP, made square and small in the browser) ---
  const avatarDir = path.join(dataDir, mock ? 'demo-avatars' : 'avatars');
  const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null);
  async function setAvatar(u, buf) {
    const type = buf && sniff(buf);
    if (!type) throw new UserError(415, 'Use a PNG, JPEG or WebP picture');
    await fsp.mkdir(avatarDir, { recursive: true });
    for (const t of Object.keys(AVATAR_TYPES)) await fsp.rm(path.join(avatarDir, `${u.id}.${t}`), { force: true });
    await fsp.writeFile(path.join(avatarDir, `${u.id}.${type}`), buf);
    u.avatar = Date.now();
    await save();
  }
  async function dropAvatar(u) {
    for (const t of Object.keys(AVATAR_TYPES)) await fsp.rm(path.join(avatarDir, `${u.id}.${t}`), { force: true });
    delete u.avatar;
    await save();
  }
  async function sendAvatar(res, id) {
    for (const [t, type] of Object.entries(AVATAR_TYPES)) {
      const buf = await fsp.readFile(path.join(avatarDir, `${id}.${t}`)).catch(() => null);
      if (buf) { res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(buf); }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('No picture');
  }

  // --- Invites and password resets: a secret link (kept only as a hash) ------------------------
  const INVITE_DAYS = 7;
  const RESET_MINUTES = 60;
  function newLink(u, kind) {
    const tok = crypto.randomBytes(24).toString('base64url');
    u[kind] = { hash: sha(tok), expires: Date.now() + (kind === 'invite' ? INVITE_DAYS * 864e5 : RESET_MINUTES * 60e3) };
    return tok;
  }
  const byLink = (kind, tok) => {
    if (!tok || String(tok).length < 20) return null;
    const h = sha(tok);
    const u = all().find((x) => x[kind]?.hash && x[kind].hash.length === h.length && crypto.timingSafeEqual(Buffer.from(x[kind].hash), Buffer.from(h)));
    return u && u[kind].expires > Date.now() && !u.disabled ? u : null;
  };
  // Where links point: MediaDesk's address as set (PUBLIC_URL), or as an admin last used it. Never
  // the address in a request from someone not signed in (it could be forged to point elsewhere).
  const linkBase = () => (publicUrl() || load().settings.origin || '').replace(/\/+$/, '');
  const emailReady = () => Boolean(sendEmail && canEmail() && linkBase());
  async function sendInvite(u, by) {
    const link = `${linkBase()}/?invite=${newLink(u, 'invite')}`;
    await save();
    if (!u.email || !sendEmail || !canEmail()) return { link, emailed: false };
    try {
      await sendEmail(u.email, 'You’re invited to MediaDesk', `${by ? `${by} has` : 'You’ve been'} invited you to MediaDesk.\n\nYour user name is: ${u.username}\n\nChoose your password here (the link works for ${INVITE_DAYS} days):\n${link}\n`);
      return { link, emailed: true };
    } catch (err) { return { link, emailed: false, emailError: err.message }; }
  }
  async function sendReset(u, { email = true } = {}) {
    const link = `${linkBase()}/?reset=${newLink(u, 'reset')}`;
    await save();
    if (email && u.email && sendEmail && canEmail()) {
      try {
        await sendEmail(u.email, 'Reset your MediaDesk password', `Someone (hopefully you) asked to reset the password of the MediaDesk account ${u.username}.\n\nChoose a new password here (the link works for ${RESET_MINUTES} minutes):\n${link}\n\nIf it wasn’t you, ignore this email: your password stays as it is.\n`);
        return { link, emailed: true };
      } catch (err) { return { link, emailed: false, emailError: err.message }; }
    }
    return { link, emailed: false };
  }

  // --- Two-step sign-in ---
  function newRecovery(u) {
    const codes = Array.from({ length: 10 }, () => { const s = base32(crypto.randomBytes(5)).toLowerCase(); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; });
    u.recovery = codes.map((c) => sha(c.replace(/-/g, '')));
    return codes;
  }
  function checkCode(u, code) {
    if (!u.totp?.enabled) return false;
    const step = totpStep(u.totp.secret, code);
    if (step >= 0 && step > (u.totp.last || 0)) { u.totp.last = step; return true; }
    // A recovery code works once.
    const r = sha(String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const i = (u.recovery || []).indexOf(r);
    if (i >= 0) { u.recovery.splice(i, 1); return 'recovery'; }
    return false;
  }

  // Too many wrong passwords or codes from one place, or for one account.
  // --- Passkeys: a one-time challenge for each sign-in or new passkey (good for 3 minutes) ---
  const challenges = new Map();
  function newChallenge(info) {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
    if (challenges.size > 2000) challenges.delete(challenges.keys().next().value);
    const c = crypto.randomBytes(32).toString('base64url');
    challenges.set(c, { ...info, exp: now + 3 * 60e3 });
    return c;
  }
  // The challenge the browser signed (read from its answer), used once.
  function takeChallenge(response, kind) {
    let c = '';
    try { c = JSON.parse(Buffer.from(String(response?.clientDataJSON || ''), 'base64url').toString('utf8')).challenge || ''; } catch { /* none */ }
    const info = challenges.get(c);
    challenges.delete(c);
    if (!info || info.kind !== kind || info.exp < Date.now()) throw new UserError(400, 'That took too long — try again');
    return { challenge: c, ...info };
  }
  const rpIdOf = (origin) => { try { return new URL(origin).hostname; } catch { return ''; } };
  const passkeyList = (u) => (u.passkeys || []).map((k) => ({ id: k.id, name: k.name, created: k.created, lastUsed: k.lastUsed || null, site: k.rpId }));
  const hasPasskeys = () => all().some((u) => !u.disabled && (u.passkeys || []).length);

  const attempts = new Map();
  function tooMany(key) {
    const now = Date.now();
    const e = attempts.get(key) || { count: 0, since: now };
    if (now - e.since > 15 * 60e3) { e.count = 0; e.since = now; }
    e.count++;
    attempts.set(key, e);
    if (attempts.size > 5000) for (const [k, v] of attempts) if (now - v.since > 15 * 60e3) attempts.delete(k);
    return e.count > 10;
  }

  // Routes: signing in (public), your own account (/portal/me) and everyone's (/portal/users, admins).
  // ctx: { user (signed in, or the owner when sign-in is off), ip, cookie(value, maxAge), sendJson, readJson, onRename(old, new), onFirstAdmin(user) }
  async function handle(req, res, p, ctx) {
    const { sendJson, readJson } = ctx;
    const me = ctx.user;
    try {
      if (p === '/portal/login' && req.method === 'POST') {
        const body = await readJson(req);
        if (!enabled()) return sendJson(res, 400, { error: 'Sign-in isn’t turned on' });
        if (tooMany(`ip:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        // From before accounts: a password on its own signs in as the only account.
        const u = body.username ? byName(body.username) : all().length === 1 ? all()[0] : null;
        if (!u || u.disabled || !(await checkPassword(u, body.password))) return sendJson(res, 401, { error: body.username || all().length === 1 ? 'Wrong user name or password' : 'Enter your user name' });
        if (u.totp?.enabled) return sendJson(res, 200, { twoFactor: true, ticket: ticketFor(u), name: u.name });
        return finishLogin(res, u);
      }
      if (p === '/portal/login/code' && req.method === 'POST') {
        const body = await readJson(req);
        const u = fromTicket(body.ticket);
        if (!u) return sendJson(res, 401, { error: 'That took too long — sign in again', restart: true });
        if (tooMany(`code:${u.id}`) || tooMany(`ip:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const ok = checkCode(u, body.code);
        if (!ok) { await save(); return sendJson(res, 401, { error: 'That code isn’t right. Use the newest code from your authenticator app.' }); }
        await save();
        return finishLogin(res, u, ok === 'recovery' ? { recoveryUsed: true, recoveryLeft: u.recovery.length } : {});
      }
      // Signing in with a passkey: any passkey made on this site (the browser offers the person's own).
      if (p === '/portal/passkey/start' && req.method === 'POST') {
        if (!enabled()) return sendJson(res, 400, { error: 'Sign-in isn’t turned on' });
        if (tooMany(`pk:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const rpId = rpIdOf(ctx.origin);
        return sendJson(res, 200, { options: { challenge: newChallenge({ kind: 'get' }), rpId, timeout: 120000, userVerification: 'required' } });
      }
      if (p === '/portal/passkey/finish' && req.method === 'POST') {
        if (tooMany(`ip:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const { response, id } = await readJson(req);
        const { challenge } = takeChallenge(response, 'get');
        const u = all().find((x) => (x.passkeys || []).some((k) => k.id === id));
        const cred = u?.passkeys.find((k) => k.id === id);
        if (!u || !cred) return sendJson(res, 401, { error: 'That passkey isn’t on any account here. Sign in with your password, then add it in My account.' });
        if (u.disabled) return sendJson(res, 403, { error: 'That account is turned off' });
        if (response.userHandle && Buffer.from(response.userHandle, 'base64url').toString() !== u.id) return sendJson(res, 401, { error: 'That passkey didn’t work' });
        try { cred.counter = passkeys.verifyAssertion({ response, challenge, cred }); } catch (err) { if (err instanceof passkeys.PasskeyError) return sendJson(res, 401, { error: err.message }); throw err; }
        cred.lastUsed = Date.now();
        // A passkey is two steps in one (the device, and the face, finger or PIN that unlocks it).
        return finishLogin(res, u, { passkey: true });
      }
      // An invite link: who it's for, then their password (which signs them in).
      if (p === '/portal/invite' && req.method === 'GET') {
        const u = byLink('invite', new URL(req.url, 'http://x').searchParams.get('token'));
        if (!u || u.hash) return sendJson(res, 404, { error: 'This invite link has expired or been used. Ask for a new one.' });
        return sendJson(res, 200, { name: u.name, username: u.username, color: u.color });
      }
      if (p === '/portal/invite' && req.method === 'POST') {
        if (tooMany(`ip:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const body = await readJson(req);
        const u = byLink('invite', body.token);
        if (!u || u.hash) return sendJson(res, 404, { error: 'This invite link has expired or been used. Ask for a new one.' });
        await setPassword(u, body.password);
        delete u.invite;
        return finishLogin(res, u, { welcome: true });
      }
      // Forgot password: an email with a link (to the account's email address, if it has one).
      if (p === '/portal/reset/request' && req.method === 'POST') {
        if (tooMany(`reset:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const body = await readJson(req);
        const who = clean(body.who, 200).toLowerCase();
        const u = all().find((x) => !x.disabled && (x.username === who || (x.email && x.email === who)));
        // The same answer either way, so this can't be used to find out who has an account.
        if (u?.email && emailReady() && u.hash) await sendReset(u).catch((err) => log(`Password reset email: ${err.message}`));
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/portal/reset' && req.method === 'GET') {
        const u = byLink('reset', new URL(req.url, 'http://x').searchParams.get('token'));
        if (!u) return sendJson(res, 404, { error: 'This link has expired or been used. Ask for a new one.' });
        return sendJson(res, 200, { name: u.name, username: u.username, color: u.color, avatar: u.avatar || null, id: u.id, twoFactor: Boolean(u.totp?.enabled) });
      }
      if (p === '/portal/reset' && req.method === 'POST') {
        if (tooMany(`ip:${ctx.ip}`)) return sendJson(res, 429, { error: 'Too many attempts — try again in a few minutes' });
        const body = await readJson(req);
        const u = byLink('reset', body.token);
        if (!u) return sendJson(res, 404, { error: 'This link has expired or been used. Ask for a new one.' });
        await setPassword(u, body.password); // ends their sessions everywhere
        delete u.reset;
        await save();
        // With two-step sign-in, the code is still needed: sign in as usual.
        if (u.totp?.enabled) return sendJson(res, 200, { ok: true, signIn: true, username: u.username });
        return finishLogin(res, u, { reset: true });
      }
      // No accounts yet: the first one (an admin) is made from this browser, which signs in as it.
      if (p === '/portal/users/setup' && req.method === 'POST') {
        if (all().length) return sendJson(res, 400, { error: 'There are accounts already' });
        const body = await readJson(req);
        const u = await create({ ...body, role: 'admin' });
        await ctx.onFirstAdmin?.(u);
        return finishLogin(res, u);
      }

      // Pictures are public (the sign-in screen shows them); their address is the account's random id.
      const av = /^\/portal\/avatar\/([0-9a-f]{16})$/.exec(p);
      if (av && req.method === 'GET') return sendAvatar(res, av[1]);

      if (!me) return sendJson(res, 401, { error: 'Not signed in' });
      if (p === '/portal/me' && req.method === 'GET') return sendJson(res, 200, { user: publicUser(me, { full: true }), signIn: enabled(), apps: APPS });
      if (p === '/portal/users/directory' && req.method === 'GET') {
        // Names and colours, for linking people in apps (trips, the family).
        return sendJson(res, 200, { users: (enabled() ? all() : [OWNER]).filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, username: u.username, color: u.color, avatar: u.avatar || null })) });
      }
      if (me.open && p.startsWith('/portal/me/')) return sendJson(res, 400, { error: 'Turn on sign-in first (Settings → Users)' });
      if (p === '/portal/me' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.name !== undefined) me.name = clean(body.name, 60) || me.name;
        if (/^#[0-9a-f]{6}$/i.test(body.color || '')) me.color = body.color.toLowerCase();
        if (body.email !== undefined) {
          const email = clean(body.email, 200).toLowerCase();
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError(400, 'That email address doesn’t look right');
          if (email && all().some((x) => x.id !== me.id && x.email === email)) throw new UserError(409, 'Someone else has that email address');
          me.email = email;
        }
        await save();
        return sendJson(res, 200, { user: publicUser(me, { full: true }) });
      }
      if (p === '/portal/me/avatar' && req.method === 'POST') { await setAvatar(me, await ctx.readBody(req, 2 * 1024 * 1024)); return sendJson(res, 200, { user: publicUser(me, { full: true }) }); }
      if (p === '/portal/me/avatar' && req.method === 'DELETE') { await dropAvatar(me); return sendJson(res, 200, { user: publicUser(me, { full: true }) }); }
      if (p === '/portal/me/password' && req.method === 'POST') {
        const body = await readJson(req);
        if (!(await checkPassword(me, body.current))) return sendJson(res, 401, { error: 'Your current password isn’t right' });
        await setPassword(me, body.next);
        await save();
        return finishLogin(res, me, { changed: true }); // a new cookie: every other session has ended
      }
      if (p === '/portal/me/signout-others' && req.method === 'POST') {
        me.ver = (me.ver || 0) + 1;
        await save();
        return finishLogin(res, me, { signedOut: true });
      }
      // Your passkeys.
      if (p === '/portal/me/passkeys' && req.method === 'GET') return sendJson(res, 200, { passkeys: passkeyList(me) });
      if (p === '/portal/me/passkeys/start' && req.method === 'POST') {
        const rpId = rpIdOf(ctx.origin);
        if (!rpId) return sendJson(res, 400, { error: 'MediaDesk’s address can’t be used for passkeys' });
        const challenge = newChallenge({ kind: 'create', userId: me.id, rpId });
        return sendJson(res, 200, { options: passkeys.registrationOptions({ rpId, user: me, challenge, exclude: (me.passkeys || []).filter((k) => k.rpId === rpId).map((k) => k.id) }) });
      }
      if (p === '/portal/me/passkeys/finish' && req.method === 'POST') {
        const body = await readJson(req);
        const info = takeChallenge(body.response, 'create');
        if (info.userId !== me.id) return sendJson(res, 400, { error: 'That took too long — try again' });
        let key;
        try { key = passkeys.verifyRegistration({ response: body.response, challenge: info.challenge, rpId: info.rpId }); } catch (err) { if (err instanceof passkeys.PasskeyError) return sendJson(res, 400, { error: err.message }); throw err; }
        if (all().some((x) => (x.passkeys || []).some((k) => k.id === key.id))) return sendJson(res, 409, { error: 'That passkey is on an account already' });
        me.passkeys = [...(me.passkeys || []), { ...key, name: clean(body.name, 60) || 'Passkey', created: Date.now() }].slice(-20);
        await save();
        return sendJson(res, 200, { passkeys: passkeyList(me) });
      }
      const pk = /^\/portal\/me\/passkeys\/([\w-]{8,})$/.exec(p);
      if (pk && req.method === 'DELETE') {
        me.passkeys = (me.passkeys || []).filter((k) => k.id !== pk[1]);
        await save();
        return sendJson(res, 200, { passkeys: passkeyList(me) });
      }
      if (pk && req.method === 'PUT') {
        const k = (me.passkeys || []).find((x) => x.id === pk[1]);
        if (!k) return sendJson(res, 404, { error: 'That passkey isn’t on your account' });
        k.name = clean((await readJson(req)).name, 60) || k.name;
        await save();
        return sendJson(res, 200, { passkeys: passkeyList(me) });
      }
      if (p === '/portal/me/2fa/start' && req.method === 'POST') {
        const secret = base32(crypto.randomBytes(20));
        me.totpPending = { secret, at: Date.now() };
        await save();
        const label = encodeURIComponent(`MediaDesk:${me.username}`);
        return sendJson(res, 200, { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=MediaDesk&algorithm=SHA1&digits=6&period=30` });
      }
      if (p === '/portal/me/2fa/confirm' && req.method === 'POST') {
        const body = await readJson(req);
        const pend = me.totpPending;
        if (!pend || Date.now() - pend.at > 30 * 60e3) return sendJson(res, 400, { error: 'Start again: scan a new QR code' });
        const step = totpStep(pend.secret, body.code);
        if (step < 0) return sendJson(res, 400, { error: 'That code isn’t right. Check the time on your phone is set automatically, and use the newest code.' });
        me.totp = { secret: pend.secret, enabled: true, last: step, since: Date.now() };
        delete me.totpPending;
        const codes = newRecovery(me);
        await save();
        return sendJson(res, 200, { enabled: true, recovery: codes });
      }
      if (p === '/portal/me/2fa/disable' && req.method === 'POST') {
        const body = await readJson(req);
        if (!(await checkPassword(me, body.password))) return sendJson(res, 401, { error: 'Your password isn’t right' });
        delete me.totp; delete me.recovery; delete me.totpPending;
        await save();
        return sendJson(res, 200, { enabled: false });
      }
      if (p === '/portal/me/2fa/recovery' && req.method === 'POST') {
        const body = await readJson(req);
        if (!(await checkPassword(me, body.password))) return sendJson(res, 401, { error: 'Your password isn’t right' });
        if (!me.totp?.enabled) return sendJson(res, 400, { error: 'Turn on two-step sign-in first' });
        const codes = newRecovery(me);
        await save();
        return sendJson(res, 200, { recovery: codes });
      }

      // Everyone's accounts: admins only.
      if (p === '/portal/users' || p.startsWith('/portal/users/')) {
        if (me.role !== 'admin') return sendJson(res, 403, { error: 'Only admins can manage users' });
        // MediaDesk's address as an admin uses it: for links in invites and reset emails.
        if (ctx.origin && /^https?:\/\/[\w.:[\]-]+$/.test(ctx.origin) && load().settings.origin !== ctx.origin) { load().settings.origin = ctx.origin; await save(); }
        if (p === '/portal/users' && req.method === 'GET') return sendJson(res, 200, { users: all().sort((a, b) => (a.created || 0) - (b.created || 0)).map((u) => publicUser(u, { full: true })), apps: APPS, adminOnly: [...ADMIN_ONLY], signIn: enabled(), mock });
        if (p === '/portal/users' && req.method === 'POST') {
          if (!enabled()) return sendJson(res, 400, { error: 'Make your own admin account first' });
          const body = await readJson(req);
          const u = await create(body);
          if (body.invite) return sendJson(res, 200, { user: publicUser(u, { full: true }), invite: await sendInvite(u, me.name) });
          return sendJson(res, 200, { user: publicUser(u, { full: true }) });
        }
        if (p === '/portal/users/email' && req.method === 'GET') return sendJson(res, 200, { ready: emailReady(), server: canEmail(), base: linkBase() });
        const m = /^\/portal\/users\/([0-9a-f]{16})(\/2fa-reset|\/signout|\/avatar|\/invite|\/reset|\/passkeys)?$/.exec(p);
        const u = m && byId(m[1]);
        if (!u) return sendJson(res, 404, { error: 'That account doesn’t exist' });
        if (!m[2] && req.method === 'PUT') {
          const { user, renamed } = await update(u, await readJson(req), me);
          if (renamed) await ctx.onRename?.(renamed, user.username);
          return sendJson(res, 200, { user: publicUser(user, { full: true }) });
        }
        if (!m[2] && req.method === 'DELETE') {
          if (u.id === me.id) return sendJson(res, 400, { error: 'You can’t delete your own account' });
          if (u.role === 'admin' && admins().filter((a) => a.id !== u.id).length === 0) return sendJson(res, 400, { error: 'There has to be at least one admin' });
          delete load().users[u.id];
          await save();
          return sendJson(res, 200, { deleted: true });
        }
        if (m[2] === '/2fa-reset' && req.method === 'POST') { delete u.totp; delete u.recovery; delete u.totpPending; await save(); return sendJson(res, 200, { user: publicUser(u, { full: true }) }); }
        if (m[2] === '/avatar' && req.method === 'POST') { await setAvatar(u, await ctx.readBody(req, 2 * 1024 * 1024)); return sendJson(res, 200, { user: publicUser(u, { full: true }) }); }
        if (m[2] === '/avatar' && req.method === 'DELETE') { await dropAvatar(u); return sendJson(res, 200, { user: publicUser(u, { full: true }) }); }
        // A new invite link (and email), or a password reset link (and email) for someone.
        if (m[2] === '/invite' && req.method === 'POST') {
          if (u.hash) return sendJson(res, 400, { error: `${u.name} has chosen a password already` });
          return sendJson(res, 200, await sendInvite(u, me.name));
        }
        if (m[2] === '/reset' && req.method === 'POST') {
          const body = await readJson(req);
          return sendJson(res, 200, await sendReset(u, { email: body.email !== false }));
        }
        // Lost phone: take someone's passkeys off their account.
        if (m[2] === '/passkeys' && req.method === 'DELETE') { delete u.passkeys; await save(); return sendJson(res, 200, { user: publicUser(u, { full: true }) }); }
        if (m[2] === '/signout' && req.method === 'POST') { u.ver = (u.ver || 0) + 1; await save(); return sendJson(res, 200, { ok: true }); }
      }
      return null;
    } catch (err) {
      if (err instanceof UserError) return sendJson(res, err.status, { error: err.message });
      throw err;
    }

    async function finishLogin(r, u, extra = {}) {
      u.lastLogin = Date.now();
      attempts.delete(`ip:${ctx.ip}`);
      await save();
      return ctx.sendJson(r, 200, { ok: true, user: publicUser(u), ...extra }, { 'Set-Cookie': ctx.cookie(makeSession(u), SESSION_DAYS * 86400) });
    }
  }

  // Reset an admin's password from the command line (when it's forgotten).
  async function resetPassword(username, password) {
    const u = byName(username);
    if (!u) throw new UserError(404, `There's no account called ${username}`);
    await setPassword(u, password);
    u.disabled = false;
    delete u.totp; delete u.recovery;
    await save();
    return u;
  }

  load();
  return { emailReady, hasPasskeys, load, save, all, byId, byName, enabled, migrate, fromToken, appsOf, can, publicUser, ownerId, OWNER, handle, resetPassword, APPS, settings: () => load().settings };
}

module.exports = { createUsers, hotp, totpStep, base32, APPS, ALWAYS, ADMIN_ONLY };
