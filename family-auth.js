// Family Organizer accounts, for using the organizer on its own at /family: users with a username
// and password, invite codes that parents make, and sessions. Inside MediaDesk, whoever is
// signed in to MediaDesk counts as a parent.
//
// Users and invites are kept with the family's data (under "auth"), never sent with it.

'use strict';

const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const COOKIE = 'family_session';
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Invite codes: no 0/O, 1/I/L, so they can be read out and typed.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const clean = (s, max = 100) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function createFamilyAuth({ load, persist, onUsersChanged = () => {} }) {
  const attempts = new Map(); // ip -> { count, since }

  function auth() {
    const d = load();
    d.auth ||= {};
    d.auth.secret ||= crypto.randomBytes(32).toString('base64url');
    d.auth.users ||= {};
    d.auth.invites ||= {};
    return d.auth;
  }

  const publicUser = (u) => u && ({
    id: u.id, username: u.username, first: u.first, last: u.last, email: u.email, role: u.role, profile: u.profile || null,
    disabled: Boolean(u.disabled), created: u.created, lastLogin: u.lastLogin || null,
  });
  const publicInvite = (i) => ({ code: i.code, role: i.role, profile: i.profile || null, created: i.created, expires: i.expires, by: i.by || '' });

  function tooMany(ip) {
    const now = Date.now();
    const e = attempts.get(ip) || { count: 0, since: now };
    if (now - e.since > 15 * 60e3) { e.count = 0; e.since = now; }
    e.count++;
    attempts.set(ip, e);
    return e.count > 12;
  }

  // A session is "<user id>.<version>.<expiry>.<signature>"; changing a user's password or
  // turning them off bumps their version, which ends their sessions everywhere.
  const sign = (s) => crypto.createHmac('sha256', auth().secret).update(s).digest('base64url');
  function makeToken(u) {
    const body = `${u.id}.${u.ver || 0}.${Date.now() + SESSION_DAYS * 864e5}`;
    return `${body}.${sign(body)}`;
  }
  function userFromReq(req) {
    const token = parseCookies(req)[COOKIE] || '';
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const body = parts.slice(0, 3).join('.');
    const want = Buffer.from(sign(body));
    const got = Buffer.from(parts[3]);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    if (Number(parts[2]) < Date.now()) return null;
    const u = auth().users[parts[0]];
    if (!u || u.disabled || String(u.ver || 0) !== parts[1]) return null;
    return u;
  }
  const cookie = (req, value, maxAge) => `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

  async function setPassword(u, password) {
    if (String(password || '').length < 8) throw new AuthError(400, 'Use a password of at least 8 characters');
    if (String(password).length > 200) throw new AuthError(400, 'That password is too long');
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

  const parents = () => Object.values(auth().users).filter((u) => u.role === 'parent' && !u.disabled);
  function newCode() {
    let c = '';
    for (const b of crypto.randomBytes(8)) c += CODE_CHARS[b % CODE_CHARS.length];
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  }
  const normCode = (c) => clean(c, 20).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
  function validInvite(code) {
    const i = auth().invites[normCode(code)];
    if (!i || i.expires < Date.now()) return null;
    return i;
  }
  function dropExpired() {
    const a = auth();
    for (const [k, i] of Object.entries(a.invites)) if (i.expires < Date.now()) delete a.invites[k];
  }

  // The new account's details, checked.
  function profileFields(body, u = {}) {
    const first = clean(body.first ?? u.first, 60);
    const last = clean(body.last ?? u.last, 60);
    const email = clean(body.email ?? u.email, 200).toLowerCase();
    if (!first) throw new AuthError(400, 'Enter a first name');
    if (!last) throw new AuthError(400, 'Enter a last name');
    if (!EMAIL.test(email)) throw new AuthError(400, 'Enter an email address');
    return { first, last, email };
  }

  // ctx: { portal: signed in to MediaDesk, ip }
  async function route(req, res, p, ctx, { sendJson, readJson }) {
    const me = userFromReq(req);
    const isParent = ctx.portal || me?.role === 'parent';
    const a = auth();
    const save = async () => { await persist(); onUsersChanged(); };

    if (p === '/auth/session' && req.method === 'GET') {
      return sendJson(res, 200, {
        user: publicUser(me), portal: ctx.portal, parent: Boolean(isParent),
        // No accounts yet: the first parent's account is made from MediaDesk.
        setup: Object.keys(a.users).length === 0,
      });
    }
    if (p === '/auth/login' && req.method === 'POST') {
      if (tooMany(ctx.ip)) throw new AuthError(429, 'Too many tries — wait a few minutes and try again');
      const body = await readJson(req);
      const name = clean(body.username, 64).toLowerCase();
      const u = Object.values(a.users).find((x) => x.username === name || x.email === name);
      if (!(await checkPassword(u, body.password)) || u.disabled) throw new AuthError(401, u?.disabled ? 'This account has been turned off — ask a parent' : 'That username or password isn’t right');
      attempts.delete(ctx.ip);
      u.lastLogin = Date.now();
      await persist();
      return sendJson(res, 200, { user: publicUser(u) }, { 'Set-Cookie': cookie(req, makeToken(u), SESSION_DAYS * 86400) });
    }
    if (p === '/auth/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }
    if (p === '/auth/invite' && req.method === 'GET') {
      if (tooMany(ctx.ip)) throw new AuthError(429, 'Too many tries — wait a few minutes and try again');
      const i = validInvite(new URL(req.url, 'http://x').searchParams.get('code'));
      if (!i) throw new AuthError(404, 'That invite code isn’t valid (it may have been used or expired)');
      attempts.delete(ctx.ip);
      return sendJson(res, 200, { role: i.role, expires: i.expires });
    }
    // Making an account: with an invite code, or (for the first parent) signed in to MediaDesk.
    if (p === '/auth/signup' && req.method === 'POST') {
      if (tooMany(ctx.ip)) throw new AuthError(429, 'Too many tries — wait a few minutes and try again');
      const body = await readJson(req);
      const first = Object.keys(a.users).length === 0;
      let invite = null;
      if (!(first && ctx.portal)) {
        invite = validInvite(body.code);
        if (!invite) throw new AuthError(400, first ? 'Enter the invite code made in MediaDesk (Family Organizer → Settings → Users)' : 'That invite code isn’t valid (it may have been used or expired)');
      }
      const username = clean(body.username, 64).toLowerCase();
      if (!USERNAME.test(username)) throw new AuthError(400, 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number');
      if (Object.values(a.users).some((x) => x.username === username)) throw new AuthError(409, 'That username is taken');
      const fields = profileFields(body);
      if (Object.values(a.users).some((x) => x.email === fields.email)) throw new AuthError(409, 'There’s already an account with that email address');
      const u = { id: crypto.randomBytes(8).toString('hex'), username, ...fields, role: invite ? invite.role : 'parent', profile: invite?.profile || null, created: Date.now(), lastLogin: Date.now() };
      await setPassword(u, body.password);
      a.users[u.id] = u;
      if (invite) delete a.invites[invite.code];
      attempts.delete(ctx.ip);
      await save();
      return sendJson(res, 200, { user: publicUser(u) }, { 'Set-Cookie': cookie(req, makeToken(u), SESSION_DAYS * 86400) });
    }

    if (!ctx.portal && !me) throw new AuthError(401, 'Sign in to the Family Organizer');

    // Your own account.
    if (p === '/auth/me' && req.method === 'POST') {
      if (!me) throw new AuthError(400, 'You’re using the organizer through MediaDesk, without an account');
      const body = await readJson(req);
      Object.assign(me, profileFields(body, me));
      if (Object.values(a.users).some((x) => x !== me && x.email === me.email)) throw new AuthError(409, 'There’s already an account with that email address');
      let headers = {};
      if (body.newPassword) {
        if (!(await checkPassword(me, body.password))) throw new AuthError(400, 'Your current password isn’t right');
        await setPassword(me, body.newPassword);
        headers = { 'Set-Cookie': cookie(req, makeToken(me), SESSION_DAYS * 86400) };
      }
      await save();
      return sendJson(res, 200, { user: publicUser(me) }, headers);
    }

    // Parents: users and invites.
    if (p === '/auth/users' || p.startsWith('/auth/users/') || p === '/auth/invites' || p.startsWith('/auth/invites/')) {
      if (!isParent) throw new AuthError(403, 'Only parents can manage accounts');
      dropExpired();
      if (p === '/auth/users' && req.method === 'GET') {
        return sendJson(res, 200, {
          users: Object.values(a.users).map(publicUser).sort((x, y) => x.first.localeCompare(y.first)),
          invites: Object.values(a.invites).map(publicInvite).sort((x, y) => y.created - x.created),
          me: me?.id || null,
        });
      }
      const um = /^\/auth\/users\/([a-f0-9]{16})$/.exec(p);
      if (um) {
        const u = a.users[um[1]];
        if (!u) throw new AuthError(404, 'That account is gone');
        const lastParent = u.role === 'parent' && !u.disabled && parents().length <= 1;
        if (req.method === 'DELETE') {
          if (u === me) throw new AuthError(400, 'You can’t remove your own account');
          if (lastParent) throw new AuthError(400, 'Keep at least one parent account');
          delete a.users[u.id];
          await save();
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (body.role !== undefined) {
            if (!['parent', 'member'].includes(body.role)) throw new AuthError(400, 'Unknown role');
            if (body.role !== 'parent' && lastParent) throw new AuthError(400, 'Keep at least one parent account');
            if (u === me && body.role !== 'parent') throw new AuthError(400, 'Ask another parent to change your role');
            u.role = body.role;
          }
          if (body.disabled !== undefined) {
            if (body.disabled && u === me) throw new AuthError(400, 'You can’t turn off your own account');
            if (body.disabled && lastParent) throw new AuthError(400, 'Keep at least one parent account');
            u.disabled = Boolean(body.disabled);
            if (u.disabled) u.ver = (u.ver || 0) + 1;
          }
          if (body.profile !== undefined) u.profile = body.profile ? clean(body.profile, 40) : null;
          if (body.first !== undefined || body.last !== undefined || body.email !== undefined) {
            Object.assign(u, profileFields(body, u));
            if (Object.values(a.users).some((x) => x !== u && x.email === u.email)) throw new AuthError(409, 'There’s already an account with that email address');
          }
          if (body.password) await setPassword(u, body.password);
          await save();
          return sendJson(res, 200, { user: publicUser(u) });
        }
      }
      if (p === '/auth/invites' && req.method === 'POST') {
        const body = await readJson(req);
        const role = body.role === 'parent' ? 'parent' : 'member';
        const days = Math.min(30, Math.max(1, Number(body.days) || INVITE_DAYS));
        let code = newCode();
        while (a.invites[code]) code = newCode();
        const by = me ? `${me.first} ${me.last}` : 'MediaDesk';
        a.invites[code] = { code, role, profile: body.profile ? clean(body.profile, 40) : null, created: Date.now(), expires: Date.now() + days * 864e5, by };
        await save();
        return sendJson(res, 200, { invite: publicInvite(a.invites[code]) });
      }
      const im = /^\/auth\/invites\/([A-Z0-9-]{4,12})$/.exec(p);
      if (im && req.method === 'DELETE') {
        delete a.invites[normCode(im[1])];
        await save();
        return sendJson(res, 200, { ok: true });
      }
    }
    return null;
  }

  // Demo mode: a parent and a child account (password "family-demo").
  async function seedDemo() {
    const a = auth();
    if (Object.keys(a.users).length) return;
    for (const [username, first, role, profile] of [['maria', 'Maria', 'parent', 'm-mom'], ['emma', 'Emma', 'member', 'm-emma']]) {
      const u = { id: crypto.randomBytes(8).toString('hex'), username, first, last: 'Rivera', email: `${username}@example.com`, role, profile, created: Date.now() };
      await setPassword(u, 'family-demo');
      a.users[u.id] = u;
    }
    await persist();
  }

  return { route, userFromReq, seedDemo, AuthError };
}

module.exports = { createFamilyAuth };
