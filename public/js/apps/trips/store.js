// A trip's data in the browser: changes show at once and are sent to the server as small
// operations; changes made elsewhere (another device, another person) arrive every few seconds.
// Changes can be undone.

const BASE = '/portal/trips';
export const COLS = ['places', 'items', 'bookings', 'expenses', 'settlements', 'lists', 'entries', 'bags', 'files', 'notes', 'links', 'polls'];

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method, credentials: 'same-origin',
    headers: { 'X-MediaDesk': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}) },
    body: body == null ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class TripStore {
  constructor(id) {
    this.id = id;
    this.doc = null;
    this.listeners = new Set();
    this.undoStack = [];
    this.pending = 0;
  }

  async load() {
    this.doc = await api(`trip/${encodeURIComponent(this.id)}`);
    this.poll();
    return this;
  }
  get trip() { return this.doc.trip; }
  get rev() { return this.doc.rev; }
  all(col) { return Object.values(this.doc[col] || {}); }
  get(col, id) { return this.doc[col]?.[id] || null; }
  member(id) { return this.trip.members.find((m) => m.id === id) || null; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(why) { for (const fn of this.listeners) fn(why); }

  // Others' changes: checked every few seconds (not while ours are on their way).
  poll() {
    clearTimeout(this.pollT);
    this.pollT = setTimeout(async () => {
      if (!this.stopped && !this.pending && !document.hidden) {
        try {
          const d = await api(`trip/${encodeURIComponent(this.id)}?since=${this.doc.rev}`);
          if (!d.same && !this.pending) { this.doc = d; this.emit('remote'); }
        } catch { /* try again shortly */ }
      }
      if (!this.stopped) this.poll();
    }, 5000);
  }
  stop() { this.stopped = true; clearTimeout(this.pollT); }

  // Apply operations here at once, then on the server. Returns the saved items.
  async batch(ops, { undoable = true, label = '' } = {}) {
    const inverse = [];
    for (const op of ops) {
      if (op.op === 'put') {
        op.item.id ||= newId();
        const prev = this.doc[op.col][op.item.id];
        inverse.unshift(prev ? { op: 'put', col: op.col, item: prev } : { op: 'delete', col: op.col, id: op.item.id });
        this.doc[op.col][op.item.id] = { ...prev, ...op.item };
      } else if (op.op === 'delete') {
        const prev = this.doc[op.col][op.id];
        if (prev) inverse.unshift({ op: 'put', col: op.col, item: prev });
        delete this.doc[op.col][op.id];
        // What the server also removes with it.
        if (op.col === 'places') for (const it of this.all('items')) if (it.placeId === op.id) { inverse.unshift({ op: 'put', col: 'items', item: it }); delete this.doc.items[it.id]; }
        if (op.col === 'bookings') for (const it of this.all('items')) if (it.bookingId === op.id) { inverse.unshift({ op: 'put', col: 'items', item: it }); delete this.doc.items[it.id]; }
        if (op.col === 'lists') for (const e of this.all('entries')) if (e.list === op.id) { inverse.unshift({ op: 'put', col: 'entries', item: e }); delete this.doc.entries[e.id]; }
      } else if (op.op === 'trip') {
        const prev = {};
        for (const k of Object.keys(op.patch)) prev[k] = this.doc.trip[k] ?? null;
        inverse.unshift({ op: 'trip', patch: prev });
        Object.assign(this.doc.trip, op.patch);
      }
    }
    if (undoable && inverse.length) { this.undoStack.push({ ops: inverse, label }); if (this.undoStack.length > 50) this.undoStack.shift(); }
    this.emit('local');
    this.pending++;
    try {
      const r = await api(`trip/${encodeURIComponent(this.id)}/ops`, { method: 'POST', body: { ops } });
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const res = r.results[i];
        if (op.op === 'put' && res?.id) this.doc[op.col][res.id] = res;
        if (op.op === 'trip' && res?.trip) this.doc.trip = res.trip;
      }
      this.doc.rev = r.rev;
      return r.results;
    } catch (err) {
      // Not saved: fetch the trip as it is on the server.
      try { this.doc = await api(`trip/${encodeURIComponent(this.id)}`); } catch { /* keep what we have */ }
      this.emit('remote');
      throw err;
    } finally { this.pending--; }
  }
  put(col, item, opts) { return this.batch([{ op: 'put', col, item }], opts).then((r) => r[0]); }
  del(col, id, opts) { return this.batch([{ op: 'delete', col, id }], opts); }
  patchTrip(patch, opts) { return this.batch([{ op: 'trip', patch }], opts); }

  canUndo() { return this.undoStack.length > 0; }
  async undo() {
    const last = this.undoStack.pop();
    if (!last) return null;
    // Items that were deleted come back as they were (with their ids).
    await this.batch(last.ops.map((o) => (o.op === 'put' ? { ...o, item: { ...o.item } } : o)), { undoable: false });
    return last.label;
  }

  async redate(start, end) {
    this.doc = await api(`trip/${encodeURIComponent(this.id)}/redate`, { method: 'POST', body: { start, end } });
    this.undoStack = [];
    this.emit('remote');
  }
  async upload(file, link = {}, onProgress) {
    const params = new URLSearchParams({ name: file.name || 'file', ...link });
    const r = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${BASE}/trip/${encodeURIComponent(this.id)}/files?${params}`);
      x.withCredentials = true;
      x.setRequestHeader('X-MediaDesk', '1');
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.responseType = 'json';
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      x.onload = () => (x.status < 300 ? resolve(x.response) : reject(new Error(x.response?.error || `HTTP ${x.status}`)));
      x.onerror = () => reject(new Error('The upload didn’t get through'));
      x.send(file);
    });
    this.doc.files[r.file.id] = r.file;
    this.doc.rev = r.rev;
    this.emit('local');
    return r.file;
  }
  fileUrl(id, download = false) { return `${BASE}/trip/${encodeURIComponent(this.id)}/files/${encodeURIComponent(id)}${download ? '?download=1' : ''}`; }
  async share(body) {
    const r = await api(`trip/${encodeURIComponent(this.id)}/share`, { method: 'POST', body });
    this.doc.trip = r.trip;
    this.emit('local');
    return r.trip;
  }
}

export const geo = {
  search: (q, near) => api(`geo/search?${new URLSearchParams({ q, ...(near ? { near } : {}) })}`).then((r) => r.places),
  along: (cat, pts, radius = 3000) => api(`geo/along?cat=${cat}&radius=${radius}&points=${pts.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';')}`).then((r) => r.places),
  suggest: (q) => api(`geo/suggest?${new URLSearchParams({ q })}`).then((r) => r.places),
  reverse: (lat, lon) => api(`geo/reverse?lat=${lat}&lon=${lon}`).then((r) => r.place),
  wiki: (p) => api(`geo/wiki?${new URLSearchParams({ ...(p.wiki ? { title: p.wiki } : {}), lat: p.lat, lon: p.lon, name: p.name })}`).then((r) => r.wiki),
  nearby: (lat, lon, cat, radius = 1500) => api(`geo/nearby?lat=${lat}&lon=${lon}&cat=${cat}&radius=${radius}`).then((r) => r.places),
  route: (mode, pts) => api(`geo/route?mode=${mode}&points=${pts.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(';')}`).then((r) => r.route),
  weather: (lat, lon, start, end) => api(`geo/weather?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&start=${start}&end=${end}`).then((r) => r.days),
  fx: (from, to, date) => api(`geo/fx?from=${from}&to=${to}${date ? `&date=${date}` : ''}`).then((r) => r.rate),
};
