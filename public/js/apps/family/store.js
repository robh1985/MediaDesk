// The family's data, shared by every device: kept on the server, changed a record at a time,
// and checked for other devices' changes every few seconds while the organizer is open.

const BASE = '/portal/family';

async function call(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-MediaDesk': '1', Accept: 'application/json' };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/${path}`, { method, headers, credentials: 'same-origin', body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (data.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

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

  members() { return this.all('members').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }
  member(id) { return this.get('members', id); }

  // Every event to show: the family's own plus those from subscribed calendars.
  events() {
    const own = this.all('events').map((e) => ({ ...e, source: 'family' }));
    const subscribed = [];
    for (const cal of this.all('calendars')) {
      if (cal.enabled === false) continue;
      const f = this.feeds.get(cal.id);
      for (const e of f?.events || []) subscribed.push({ ...e, id: `${cal.id}:${e.id}`, members: cal.members || [], calendar: cal.id, color: cal.color, readonly: true, source: 'feed' });
    }
    return own.concat(subscribed);
  }

  // Stars earned (chores done) less stars spent (rewards) and adjustments.
  stars(memberId) {
    let n = 0;
    for (const l of this.all('chorelog')) if (l.member === memberId) n += Number(l.stars) || 0;
    for (const r of this.all('redemptions')) if (r.member === memberId) n -= Number(r.stars) || 0;
    return n;
  }
}
