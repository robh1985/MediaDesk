// The family's data, shared by every device: kept on the server, changed a record at a time,
// and checked for other devices' changes every few seconds while the organizer is open.

const BASE = '/portal/family';

// Extra chores: the menu beside the chore chart for one-off jobs someone did (they earn stars once
// a parent approves them). Kept by parents in Settings → Extra chores.
export const DEFAULT_EXTRA_CHORES = [
  ['xc-car', 'Wash the car', '🚗', 5], ['xc-leaves', 'Rake leaves', '🍂', 3], ['xc-dinner', 'Help make dinner', '🍳', 2],
  ['xc-laundry', 'Fold laundry', '🧺', 2], ['xc-sweep', 'Sweep the floor', '🧹', 2], ['xc-bathroom', 'Clean the bathroom', '🛁', 4],
  ['xc-garden', 'Weed the garden', '🌱', 3], ['xc-dog', 'Walk the dog', '🐕', 2], ['xc-groceries', 'Unload groceries', '🛒', 1],
  ['xc-table', 'Wipe the table', '🧽', 1], ['xc-help', 'Help a brother or sister', '🤝', 2], ['xc-windows', 'Clean the windows', '🪟', 3],
].map(([id, title, emoji, stars]) => ({ id, title, emoji, stars }));

// The quick picks a family starts with (until a parent changes them).
export const DEFAULT_QUICK_PICKS = [
  ['qp-bed', 'Make your bed', '🛏️', 1, 'routine', 'morning', { kind: 'daily' }],
  ['qp-teeth', 'Brush teeth', '🪥', 1, 'routine', 'morning', { kind: 'daily' }],
  ['qp-dressed', 'Get dressed', '👕', 1, 'routine', 'morning', { kind: 'daily' }],
  ['qp-backpack', 'Pack backpack', '🎒', 1, 'routine', 'morning', { kind: 'weekly', days: [1, 2, 3, 4, 5] }],
  ['qp-homework', 'Homework', '📚', 2, 'routine', 'afternoon', { kind: 'weekly', days: [1, 2, 3, 4] }],
  ['qp-read', 'Read for 20 minutes', '📖', 1, 'routine', 'evening', { kind: 'daily' }],
  ['qp-pjs', 'Pajamas on', '🌙', 1, 'routine', 'evening', { kind: 'daily' }],
  ['qp-dishwasher', 'Empty the dishwasher', '🍽️', 2, 'chore', 'anytime', { kind: 'daily' }],
  ['qp-table', 'Set the table', '🥣', 1, 'chore', 'anytime', { kind: 'daily' }],
  ['qp-pet', 'Feed the pet', '🐶', 2, 'chore', 'anytime', { kind: 'daily' }],
  ['qp-trash', 'Take out the trash', '🗑️', 2, 'chore', 'anytime', { kind: 'weekly', days: [2] }],
  ['qp-laundry', 'Put away laundry', '🧺', 2, 'chore', 'anytime', { kind: 'weekly', days: [0, 4] }],
  ['qp-room', 'Tidy your room', '🧸', 3, 'chore', 'anytime', { kind: 'weekly', days: [6] }],
  ['qp-plants', 'Water the plants', '🪴', 1, 'chore', 'anytime', { kind: 'weekly', days: [0, 3] }],
  ['qp-vacuum', 'Vacuum', '🧹', 3, 'chore', 'anytime', { kind: 'weekly', days: [6] }],
  ['qp-car', 'Wash the car', '🚗', 5, 'chore', 'anytime', { kind: 'once' }],
].map(([id, title, emoji, stars, kind, part, repeat]) => ({ id, title, emoji, stars, kind, part, repeat }));

async function call(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-MediaDesk': '1', Accept: 'application/json' };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/${path}`, { method, headers, credentials: 'same-origin', body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (data.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  // Signed out (the session ended, or the account was turned off): the page shows the sign-in.
  if (res.status === 401 && data.signin) window.dispatchEvent(new Event('family:signedout'));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// Accounts (for the organizer on its own, at /family).
export const familyAuth = {
  session: () => call('auth/session'),
  login: (username, password) => call('auth/login', { method: 'POST', body: { username, password } }),
  logout: () => call('auth/logout', { method: 'POST', body: {} }),
  invite: (code) => call(`auth/invite?code=${encodeURIComponent(code)}`),
  signup: (details) => call('auth/signup', { method: 'POST', body: details }),
  updateMe: (details) => call('auth/me', { method: 'POST', body: details }),
  users: () => call('auth/users'),
  updateUser: (id, patch) => call(`auth/users/${id}`, { method: 'POST', body: patch }),
  deleteUser: (id) => call(`auth/users/${id}`, { method: 'DELETE' }),
  createInvite: (opts) => call('auth/invites', { method: 'POST', body: opts }),
  deleteInvite: (code) => call(`auth/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
};

export class Store {
  constructor() {
    this.rev = 0;
    this.data = {};
    this.settings = {};
    this.feedToken = '';
    this.feeds = new Map(); // calendar id -> { events, error, at }
    this.listeners = new Set();
    this.pending = 0;
    this.timer = null;
    this.feedTimer = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (err) { console.error(err); } } }

  async load() {
    const d = await call('data');
    this.apply(d);
    this.loadFeeds().catch(() => {});
    return this;
  }

  apply(d) {
    this.rev = d.rev;
    this.data = d.collections || {};
    this.settings = d.settings || {};
    this.feedToken = d.feedToken || '';
  }

  start() {
    this.stop();
    const tick = async () => {
      if (document.hidden || this.pending) return;
      try {
        const d = await call(`data?since=${this.rev}`);
        if (!d.same && !this.pending) {
          const calsBefore = JSON.stringify(this.data.calendars || {});
          this.apply(d);
          this.emit('remote');
          if (JSON.stringify(this.data.calendars || {}) !== calsBefore) this.loadFeeds().catch(() => {});
        }
      } catch { /* offline for a moment */ }
    };
    this.timer = setInterval(tick, 8000);
    this.feedTimer = setInterval(() => { if (!document.hidden) this.loadFeeds().catch(() => {}); }, 10 * 60e3);
    this.onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.feedTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
  }

  async loadFeeds(refresh = false) {
    const { feeds } = await call(`feeds${refresh ? '?refresh=1' : ''}`);
    this.feeds = new Map(feeds.map((f) => [f.id, f]));
    this.emit('feeds');
  }

  all(col) { return Object.values(this.data[col] || {}); }
  get(col, id) { return this.data[col]?.[id] || null; }

  // Changes show at once and are then saved; if saving fails they are put back.
  async batch(ops) {
    const before = ops.map((o) => [o.col, o.op === 'put' ? o.item.id : o.id]).map(([c, id]) => [c, id, id && this.data[c]?.[id]]);
    for (const o of ops) {
      this.data[o.col] ||= {};
      if (o.op === 'delete') delete this.data[o.col][o.id];
      else {
        o.item.id ||= Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
        this.data[o.col][o.item.id] = { ...this.data[o.col][o.item.id], ...o.item };
      }
    }
    this.emit('local');
    this.pending++;
    try {
      const r = await call('batch', { method: 'POST', body: { ops } });
      this.rev = r.rev;
      r.results.forEach((item, i) => { if (!item.deleted) this.data[ops[i].col][item.id] = item; });
      // The server may have filled things in (who did a chore, whether it's approved): redraw.
      this.emit('local');
      window.dispatchEvent(new Event('mediadesk:family-changed'));
      return r.results;
    } catch (err) {
      for (const [c, id, old] of before) { if (!id) continue; if (old) this.data[c][id] = old; else delete this.data[c][id]; }
      this.emit('local');
      throw err;
    } finally { this.pending--; }
  }

  put(col, item) { return this.batch([{ op: 'put', col, item }]).then((r) => r[0]); }
  del(col, id) { return this.batch([{ op: 'delete', col, id }]); }

  async setSettings(patch) {
    Object.assign(this.settings, patch);
    for (const [k, v] of Object.entries(patch)) if (v === null) delete this.settings[k];
    this.emit('settings');
    const r = await call('settings', { method: 'POST', body: patch });
    this.rev = r.rev;
    this.settings = r.settings;
  }

  async newFeedToken() { const r = await call('feed-token', { method: 'POST', body: {} }); this.feedToken = r.feedToken; this.rev = r.rev; this.emit('settings'); }
  checkFeed(url) { return call('check-feed', { method: 'POST', body: { url } }); }
  parseIcs(text) { return call('parse-ics', { method: 'POST', body: text, raw: true }).then((r) => r.events); }
  weather(refresh) { return call(`weather${refresh ? '?refresh=1' : ''}`); }
  geocode(q) { return call(`geocode?q=${encodeURIComponent(q)}`).then((r) => r.places); }

  async uploadPhoto(file) {
    const r = await call(`photos?name=${encodeURIComponent(file.name || 'Photo')}`, { method: 'POST', body: file, raw: true });
    this.data.photos ||= {};
    this.data.photos[r.item.id] = r.item;
    this.rev = r.rev;
    this.emit('local');
    return r.item;
  }

  photoUrl(p) { return `${BASE}/photos/${encodeURIComponent(p.file)}`; }
  feedUrl() { return `${location.origin}/family-feed/${this.feedToken}/family.ics`; }

  // --- What the views need -------------------------------------------------

  // Ready-made chores to start from, kept by parents in Settings → Quick picks.
  // Events from an .ics file, recorded as one import (so they can be removed together). The same
  // file imported again updates its events rather than doubling them.
  async importEvents(evs, fileName, calendar = null) {
    const importId = `i${Date.now().toString(36)}`;
    const importedAt = Date.now();
    const items = evs.map((e) => ({ id: `imp-${e.id}`, title: e.title, allDay: e.allDay, start: e.start, end: e.end, rrule: e.rrule || null, exdates: e.exdates || [], location: e.location || '', notes: e.notes || '', members: e.members || [], calendar, importId, importName: fileName, importedAt }));
    for (let i = 0; i < items.length; i += 200) await this.batch(items.slice(i, i + 200).map((item) => ({ op: 'put', col: 'events', item })));
    return items.length;
  }

  extraChores() { return Array.isArray(this.settings.extraChores) ? this.settings.extraChores : DEFAULT_EXTRA_CHORES; }
  quickPicks() { return Array.isArray(this.settings.quickPicks) ? this.settings.quickPicks : DEFAULT_QUICK_PICKS; }

  members() { return this.all('members').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }
  member(id) { return this.get('members', id); }

  // Every event to show: the family's own plus those from subscribed calendars.
  // The family's own calendars (made in Settings → Calendars), as opposed to connected ones.
  customCalendars() { return this.all('calendars').filter((c) => c.custom).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }

  events() {
    const cals = new Map(this.all('calendars').map((c) => [c.id, c]));
    // Events on one of the family's own calendars take its colour, and go when it's turned off.
    const own = this.all('events').flatMap((e) => {
      const cal = e.calendar ? cals.get(e.calendar) : null;
      if (cal?.custom && cal.enabled === false) return [];
      // Someone's calendar: its events are theirs unless the event says whose it is.
      const members = (e.members || []).length || !cal?.custom ? e.members : cal.members || [];
      return [{ ...e, members, source: 'family', ...(cal?.custom ? { color: cal.color, calendarName: cal.name } : {}) }];
    });
    const subscribed = [];
    for (const cal of this.all('calendars')) {
      if (cal.enabled === false || cal.custom) continue;
      const f = this.feeds.get(cal.id);
      for (const e of f?.events || []) subscribed.push({ ...e, id: `${cal.id}:${e.id}`, members: cal.members || [], calendar: cal.id, color: cal.color, readonly: true, source: 'feed' });
    }
    return own.concat(subscribed);
  }

  // Stars earned (chores done) less stars spent (rewards) and adjustments.
  stars(memberId) {
    let n = 0;
    // Chores a family member made for themselves count once a parent approves them.
    for (const l of this.all('chorelog')) if (l.member === memberId && this.get('chores', l.chore)?.approved !== false) n += Number(l.stars) || 0;
    for (const r of this.all('redemptions')) if (r.member === memberId) n -= Number(r.stars) || 0;
    return n;
  }
}
