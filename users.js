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

function createUsers({ dataDir, mock = false, legacyPassword = () => '', log = console.log, onChange = () => {} }) {
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
    id: u.id, username: u.username, name: u.name || u.username, color: u.color || '#3b82f6', role: u.role, apps: u.role === 'custom' ? u.apps || [] : (u.apps || []).filter((a) => ADMIN_ONLY.has(a)),
    allowed: appsOf(u), twoFactor: Boolean(u.totp?.enabled), disabled: Boolean(u.disabled), created: u.created || null, lastLogin: u.lastLogin || null,
    family: u.family || null, folders: u.folders ?? null, open: Boolean(u.open),
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
    return { username, name: clean(body.name ?? u.name ?? username, 60) || username, role, apps, color, folders, family };
  }
  async function create(body, opts = {}) {
    const u = { id: crypto.randomBytes(8).toString('hex'), created: Date.now(), ...fields(body) };
    await setPassword(u, body.password, opts);
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
      // No accounts yet: the first one (an admin) is made from this browser, which signs in as it.
      if (p === '/portal/users/setup' && req.method === 'POST') {
        if (all().length) return sendJson(res, 400, { error: 'There are accounts already' });
        const body = await readJson(req);
        const u = await create({ ...body, role: 'admin' });
        await ctx.onFirstAdmin?.(u);
        return finishLogin(res, u);
      }

      if (!me) return sendJson(res, 401, { error: 'Not signed in' });
      if (p === '/portal/me' && req.method === 'GET') return sendJson(res, 200, { user: publicUser(me, { full: true }), signIn: enabled(), apps: APPS });
      if (p === '/portal/users/directory' && req.method === 'GET') {
        // Names and colours, for linking people in apps (trips, the family).
        return sendJson(res, 200, { users: (enabled() ? all() : [OWNER]).filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, username: u.username, color: u.color })) });
      }
      if (me.open && p.startsWith('/portal/me/')) return sendJson(res, 400, { error: 'Turn on sign-in first (Settings → Users)' });
      if (p === '/portal/me' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.name !== undefined) me.name = clean(body.name, 60) || me.name;
        if (/^#[0-9a-f]{6}$/i.test(body.color || '')) me.color = body.color.toLowerCase();
        await save();
        return sendJson(res, 200, { user: publicUser(me, { full: true }) });
      }
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
        if (p === '/portal/users' && req.method === 'GET') return sendJson(res, 200, { users: all().sort((a, b) => (a.created || 0) - (b.created || 0)).map((u) => publicUser(u, { full: true })), apps: APPS, adminOnly: [...ADMIN_ONLY], signIn: enabled(), mock });
        if (p === '/portal/users' && req.method === 'POST') {
          if (!enabled()) return sendJson(res, 400, { error: 'Make your own admin account first' });
          const u = await create(await readJson(req));
          return sendJson(res, 200, { user: publicUser(u, { full: true }) });
        }
        const m = /^\/portal\/users\/([0-9a-f]{16})(\/2fa-reset|\/signout)?$/.exec(p);
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
  return { load, save, all, byId, byName, enabled, migrate, fromToken, appsOf, can, publicUser, ownerId, OWNER, handle, resetPassword, APPS, settings: () => load().settings };
}

module.exports = { createUsers, hotp, totpStep, base32, APPS, ALWAYS, ADMIN_ONLY };
