// Trip Planner: trips kept on this server, one JSON document each, shared by every device signed in
// to MediaDesk (changes are sent as small operations and picked up by others within seconds).
//
// A trip holds its places, the day plan, bookings (flights, trains, stays…), costs split between
// the travellers, packing lists and to-dos, files, notes, links and polls. A trip can be shared
// read-only by a secret link, and its days and bookings subscribed to as a calendar.
//
// Maps, places, routes, weather and exchange rates come from open services that need no account,
// fetched by this server: OpenStreetMap's Nominatim (search), Overpass (nearby places), the
// FOSSGIS OSRM servers (routes by car, bike or on foot), Wikipedia (descriptions and photos),
// Open-Meteo (weather) and Frankfurter (exchange rates, from the European Central Bank). In demo
// mode none of them is called: answers come from a small built-in world instead.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UA = 'MediaDesk/1.0 (self-hosted trip planner; https://github.com/robh1985/mediadesk)';
const COLS = ['places', 'items', 'bookings', 'expenses', 'settlements', 'lists', 'entries', 'bags', 'files', 'notes', 'links', 'polls'];
const MAX_FILE = 50 * 1024 * 1024;
const MAX_VIDEO = 500 * 1024 * 1024;

class TripError extends Error { constructor(status, message) { super(message); this.status = status; } }

const newId = () => crypto.randomBytes(8).toString('base64url');
const token = () => crypto.randomBytes(18).toString('base64url');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
// "2026-05-03T14:30" moved by n days (keeps the clock time).
const shiftDateTime = (v, n) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? addDays(v.slice(0, 10), n) + v.slice(10) : v);

function createTrips({ dataDir, mock = false, log = console.log }) {
  const dir = path.join(dataDir, 'trips');
  const fileDir = path.join(dir, 'files');
  const settingsFile = path.join(dir, 'settings.json');
  const trips = new Map(); // id → doc
  let loaded = false;
  let settings = null;
  const writing = new Map();

  function loadAll() {
    if (loaded) return;
    loaded = true;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (!/^[\w-]+\.json$/.test(f) || f === 'settings.json') continue;
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (d?.id) trips.set(d.id, normalise(d)); } catch (err) { log(`Trip Planner: couldn’t read ${f} (${err.message})`); }
    }
    try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { settings = {}; }
    settings.icsToken ||= token();
    if (mock && !trips.size) demoTrip();
  }
  function normalise(d) {
    d.trip ||= {};
    d.trip.members ||= [];
    for (const c of COLS) d[c] ||= {};
    d.rev ||= 1;
    return d;
  }
  // Each trip is written on its own, one write at a time (the newest wins).
  function persist(d) {
    const snapshot = JSON.stringify(d);
    const prev = writing.get(d.id) || Promise.resolve();
    const next = prev.then(async () => {
      await fsp.mkdir(dir, { recursive: true });
      const f = path.join(dir, `${d.id}.json`);
      await fsp.writeFile(`${f}.tmp`, snapshot);
      await fsp.rename(`${f}.tmp`, f);
    }).catch((err) => log(`Trip Planner: couldn’t save a trip (${err.message})`));
    writing.set(d.id, next);
    return next;
  }
  async function saveSettings() {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(settingsFile, JSON.stringify(settings));
  }
  const get = (id) => { loadAll(); const d = trips.get(String(id)); if (!d) throw new TripError(404, 'That trip doesn’t exist any more'); return d; };

  function summary(d) {
    const t = d.trip;
    const places = Object.values(d.places);
    return {
      id: d.id, rev: d.rev, title: t.title, destination: t.destination || '', start: t.start || null, end: t.end || null, archived: Boolean(t.archived),
      cover: t.cover || null, color: t.color || null, members: t.members, currency: t.currency || 'EUR', updated: d.updated,
      counts: { places: places.length, bookings: Object.keys(d.bookings).length, expenses: Object.keys(d.expenses).length },
      countries: [...new Set([...places.map((p) => p.country), ...(t.destinations || []).map((x) => x.country)].filter(Boolean))],
      destinations: (t.destinations || []).map((x) => x.name),
      center: places.length ? { lat: places.reduce((a, p) => a + (p.lat || 0), 0) / places.length, lon: places.reduce((a, p) => a + (p.lon || 0), 0) / places.length } : null,
    };
  }

  function createTrip(body) {
    loadAll();
    const id = newId();
    const t = cleanTrip({ currency: 'EUR', ...body });
    if (!t.title) t.title = 'New trip';
    const d = normalise({ id, rev: 1, created: Date.now(), updated: Date.now(), trip: t });
    if (!t.members.length) t.members.push({ id: newId(), name: 'Me', color: '#3b82f6' });
    trips.set(id, d);
    persist(d);
    return d;
  }
  function cleanTrip(t, prev = {}) {
    const out = { ...prev };
    for (const k of ['title', 'description', 'destination', 'cover', 'color', 'currency', 'coverImage', 'timezone']) if (k in t) out[k] = t[k] == null ? null : String(t[k]).slice(0, k === 'description' ? 4000 : 300);
    if ('start' in t) out.start = isDate(t.start) ? t.start : null;
    if ('end' in t) out.end = isDate(t.end) ? t.end : null;
    if (out.start && out.end && out.end < out.start) out.end = out.start;
    if ('archived' in t) out.archived = Boolean(t.archived);
    if ('members' in t && Array.isArray(t.members)) out.members = t.members.slice(0, 50).map((m) => ({ id: String(m.id || newId()).slice(0, 40), name: String(m.name || 'Traveller').slice(0, 60), color: String(m.color || '#3b82f6').slice(0, 20), email: m.email ? String(m.email).slice(0, 200) : undefined }));
    if ('dayModes' in t) out.dayModes = Object.fromEntries(Object.entries(t.dayModes && typeof t.dayModes === 'object' ? t.dayModes : {}).filter(([d, m]) => isDate(d) && ['foot', 'bike', 'car', 'transit'].includes(m)).slice(0, 400));
    if ('units' in t) out.units = t.units === 'km' ? 'km' : 'mi';
    if ('origin' in t) out.origin = cleanPlace(t.origin);
    // Driving routes worked out for journeys between destinations (kept so they're there next time).
    if ('legRoutes' in t) {
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
      out.legRoutes = Object.fromEntries(Object.entries(t.legRoutes && typeof t.legRoutes === 'object' ? t.legRoutes : {}).slice(0, 60).map(([k, r]) => {
        if (!r || typeof r !== 'object' || !Array.isArray(r.line)) return null;
        const line = r.line.slice(0, 1200).map((pt) => [num(pt?.[0]), num(pt?.[1])]).filter(([a, b]) => a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
        if (line.length < 2) return null;
        const to = cleanPlace(r.to) || { name: 'Destination', lat: line.at(-1)[0], lon: line.at(-1)[1] };
        if (r.to?.iata) to.iata = String(r.to.iata).slice(0, 4);
        return [String(k).replace(/[^\w-]/g, '').slice(0, 40), { fromKey: String(r.fromKey || '').slice(0, 60), toKey: String(r.toKey || '').slice(0, 60), to, distance: num(r.distance) || 0, duration: num(r.duration) || 0, line, at: Date.now() }];
      }).filter(Boolean));
    }
    if ('destinations' in t) {
      out.destinations = (Array.isArray(t.destinations) ? t.destinations : []).slice(0, 40).map((x) => ({
        id: String(x.id || newId()).replace(/[^\w-]/g, '').slice(0, 40) || newId(), name: String(x.name || 'Destination').slice(0, 120), address: x.address ? String(x.address).slice(0, 300) : '',
        lat: Number.isFinite(Number(x.lat)) && x.lat !== null ? Number(x.lat) : null, lon: Number.isFinite(Number(x.lon)) && x.lon !== null ? Number(x.lon) : null,
        country: /^[A-Za-z]{2}$/.test(x.country || '') ? x.country.toUpperCase() : null, arrive: isDate(x.arrive) ? x.arrive : null, depart: isDate(x.depart) ? x.depart : null,
        travel: cleanTravel(x.travel),
      }));
    }
    if ('budget' in t) out.budget = Number(t.budget) || null;
    if ('home' in t) out.home = t.home && Number.isFinite(t.home.lat) ? { lat: t.home.lat, lon: t.home.lon, name: String(t.home.name || '').slice(0, 200) } : null;
    out.members ||= [];
    return out;
  }

  function cleanPlace(x) {
    if (!x || typeof x !== 'object' || !x.name) return null;
    const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    return { name: String(x.name).slice(0, 120), address: x.address ? String(x.address).slice(0, 300) : '', lat: num(x.lat), lon: num(x.lon), country: /^[A-Za-z]{2}$/.test(x.country || '') ? x.country.toUpperCase() : null };
  }
  // How a destination is reached: the kind of travel and what goes with it.
  function cleanTravel(x) {
    if (!x || typeof x !== 'object' || !TRAVEL_MODES.includes(x.mode)) return null;
    const out = { mode: x.mode };
    for (const k of ['fromAirport', 'toAirport', 'number', 'departs', 'airportBy', 'from', 'to', 'operator', 'note']) if (x[k]) out[k] = String(x[k]).slice(0, 200);
    for (const k of ['avoidTolls', 'avoidHighways', 'rental', 'withCar']) if (x[k]) out[k] = true;
    return out;
  }

  // Changes: [{ op: 'put', col, item } | { op: 'delete', col, id } | { op: 'trip', patch }]
  function applyOps(d, ops) {
    if (!Array.isArray(ops) || !ops.length) throw new TripError(400, 'Nothing to change');
    if (ops.length > 500) throw new TripError(400, 'Too many changes at once');
    const results = [];
    for (const op of ops) {
      if (op.op === 'trip') { d.trip = cleanTrip(op.patch || {}, d.trip); results.push({ trip: d.trip }); continue; }
      if (!COLS.includes(op.col)) throw new TripError(400, `Unknown list “${op.col}”`);
      const col = d[op.col];
      if (op.op === 'delete') {
        const old = col[op.id];
        delete col[op.id];
        if (op.col === 'files' && old?.stored) fsp.rm(path.join(fileDir, d.id, path.basename(old.stored)), { force: true }).catch(() => {});
        // A place goes from the plan too; a booking's day entries and linked cost go with it.
        if (op.col === 'places') for (const [k, it] of Object.entries(d.items)) if (it.placeId === op.id) delete d.items[k];
        if (op.col === 'bookings') for (const [k, it] of Object.entries(d.items)) if (it.bookingId === op.id) delete d.items[k];
        if (op.col === 'lists') for (const [k, e] of Object.entries(d.entries)) if (e.list === op.id) delete d.entries[k];
        results.push({ id: op.id, deleted: true });
      } else if (op.op === 'put') {
        const item = op.item && typeof op.item === 'object' ? op.item : null;
        if (!item) throw new TripError(400, 'Nothing to save');
        if (JSON.stringify(item).length > 200000) throw new TripError(413, 'That’s too much to save');
        const id = String(item.id || newId()).replace(/[^\w-]/g, '').slice(0, 40) || newId();
        const prev = col[id];
        const next = { ...item, id, updated: Date.now(), created: prev?.created || Date.now() };
        if (op.col === 'files' && prev) next.stored = prev.stored; // where a file is kept never comes from a browser
        if (op.col === 'files' && !prev) throw new TripError(400, 'Upload the file first');
        col[id] = next;
        results.push(next);
      } else throw new TripError(400, 'Unknown change');
    }
    d.rev++;
    d.updated = Date.now();
    persist(d);
    return { rev: d.rev, results };
  }

  // New dates: the days move with the trip, and so do the bookings on them.
  function redate(d, start, end) {
    if (!isDate(start)) throw new TripError(400, 'Choose a start date');
    const old = d.trip.start;
    const len = d.trip.start && d.trip.end ? dayDiff(d.trip.start, d.trip.end) : 0;
    const newEnd = isDate(end) ? end : addDays(start, len);
    if (old && old !== start) {
      const n = dayDiff(old, start);
      for (const it of Object.values(d.items)) if (isDate(it.date)) it.date = addDays(it.date, n);
      for (const b of Object.values(d.bookings)) {
        for (const k of ['start', 'end']) b[k] = shiftDateTime(b[k], n);
        if (Array.isArray(b.legs)) for (const l of b.legs) { l.depart = shiftDateTime(l.depart, n); l.arrive = shiftDateTime(l.arrive, n); }
      }
      for (const e of Object.values(d.entries)) if (isDate(e.due)) e.due = addDays(e.due, n);
      for (const x of d.trip.destinations || []) { if (isDate(x.arrive)) x.arrive = addDays(x.arrive, n); if (isDate(x.depart)) x.depart = addDays(x.depart, n); }
      if (d.trip.dayModes) d.trip.dayModes = Object.fromEntries(Object.entries(d.trip.dayModes).map(([k, v]) => [addDays(k, n), v]));
    }
    d.trip.start = start;
    d.trip.end = newEnd < start ? start : newEnd;
    for (const x of d.trip.destinations || []) { for (const k of ['arrive', 'depart']) if (isDate(x[k])) x[k] = x[k] < d.trip.start ? d.trip.start : x[k] > d.trip.end ? d.trip.end : x[k]; }
    // Days that fall outside the trip now: their plans go back to the unplanned list.
    for (const it of Object.values(d.items)) if (isDate(it.date) && (it.date < d.trip.start || it.date > d.trip.end)) it.date = null;
    d.rev++;
    d.updated = Date.now();
    persist(d);
  }

  async function copyTrip(d) {
    const copy = JSON.parse(JSON.stringify(d));
    copy.id = newId();
    copy.rev = 1;
    copy.created = copy.updated = Date.now();
    copy.trip.title = `${d.trip.title} (copy)`;
    delete copy.trip.shareToken;
    delete copy.trip.icsToken;
    // Files are copied too.
    for (const f of Object.values(copy.files)) {
      if (!f.stored) continue;
      const name = `${newId()}-${path.basename(f.stored).replace(/^[^-]+-/, '')}`;
      try { await fsp.mkdir(path.join(fileDir, copy.id), { recursive: true }); await fsp.copyFile(path.join(fileDir, d.id, path.basename(f.stored)), path.join(fileDir, copy.id, name)); f.stored = name; } catch { delete copy.files[f.id]; }
    }
    trips.set(copy.id, normalise(copy));
    await persist(copy);
    return copy;
  }

  async function deleteTrip(d) {
    trips.delete(d.id);
    await (writing.get(d.id) || Promise.resolve());
    await fsp.rm(path.join(dir, `${d.id}.json`), { force: true });
    await fsp.rm(path.join(fileDir, d.id), { recursive: true, force: true });
  }

  // --- Files ---------------------------------------------------------------------------------
  const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', txt: 'text/plain', gpx: 'application/gpx+xml', kml: 'application/vnd.google-earth.kml+xml', eml: 'message/rfc822', pkpass: 'application/vnd.apple.pkpass', ics: 'text/calendar', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', json: 'application/json', zip: 'application/zip' };
  const cleanName = (n) => path.basename(String(n || 'file')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').trim().slice(0, 160) || 'file';
  async function receiveFile(req, d, name, link) {
    const ext = name.split('.').pop().toLowerCase();
    const video = /^(mp4|mov|webm|mkv)$/.test(ext);
    const limit = video ? MAX_VIDEO : MAX_FILE;
    const id = newId();
    const stored = `${id}-${name.replace(/[^\w.() -]+/g, '_')}`;
    await fsp.mkdir(path.join(fileDir, d.id), { recursive: true });
    const dest = path.join(fileDir, d.id, stored);
    let size = 0;
    const counter = new Transform({ transform(chunk, enc, cb) { size += chunk.length; if (size > limit) cb(new TripError(413, `Files can be up to ${video ? '500' : '50'} MB`)); else cb(null, chunk); } });
    try { await pipeline(req, counter, fs.createWriteStream(dest)); } catch (err) { await fsp.rm(dest, { force: true }); throw err; }
    const item = { id, name, stored, size, type: TYPES[ext] || 'application/octet-stream', created: Date.now(), updated: Date.now(), ...link };
    d.files[id] = item;
    d.rev++;
    d.updated = Date.now();
    persist(d);
    return item;
  }
  async function sendFile(req, res, d, fileId, download) {
    const f = d.files[fileId];
    if (!f?.stored) throw new TripError(404, 'That file is gone');
    const abs = path.join(fileDir, d.id, path.basename(f.stored));
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw new TripError(404, 'That file is gone');
    let start = 0, end = st.size - 1, status = 200;
    const headers = { 'Content-Type': f.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${download || !/^(image|video|application\/pdf|text\/plain)/.test(f.type) ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && st.size) {
      if (range[1] === '') start = Math.max(0, st.size - Number(range[2])); else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size ? end - start + 1 : 0;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !st.size) return res.end();
    await pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {});
  }

  // --- Sharing and calendars ------------------------------------------------------------------

  // What a read-only share link shows: the parts its options allow.
  function shared(d) {
    const o = d.trip.shareOptions || {};
    const out = { trip: { title: d.trip.title, description: d.trip.description, destination: d.trip.destination, origin: d.trip.origin || null, destinations: d.trip.destinations || [], legRoutes: d.trip.legRoutes || {}, start: d.trip.start, end: d.trip.end, cover: d.trip.cover, color: d.trip.color, currency: d.trip.currency, members: d.trip.members.map((m) => ({ id: m.id, name: m.name, color: m.color })) }, options: o };
    out.places = d.places;
    out.items = Object.fromEntries(Object.entries(d.items).filter(([, it]) => it.kind !== 'booking' || o.bookings));
    out.files = Object.fromEntries(Object.entries(d.files).filter(([, f]) => !f.deleted && /^image\//.test(f.type) && (f.id === d.trip.cover || f.placeId)));
    if (o.bookings) out.bookings = Object.fromEntries(Object.entries(d.bookings).map(([k, b]) => [k, { ...b, code: undefined, notes: undefined }]));
    if (o.packing) { out.lists = d.lists; out.entries = d.entries; out.bags = d.bags; }
    if (o.costs) { out.expenses = d.expenses; out.settlements = d.settlements; }
    if (o.notes) { out.notes = d.notes; out.links = d.links; out.polls = d.polls; }
    return out;
  }
  const findShared = (t) => { loadAll(); for (const d of trips.values()) if (d.trip.shareToken && d.trip.shareToken === t) return d; return null; };

  // A calendar of a trip's days and bookings (or of every trip).
  function ics(list, name) {
    const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
    const dt = (v) => (v && v.length > 10 ? `${v.slice(0, 16).replace(/[-:]/g, '')}00` : null);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MediaDesk//Trip Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const ev = (uid, summary, start, end, desc, loc, allDay) => {
      lines.push('BEGIN:VEVENT', `UID:${uid}@mediadesk-trips`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(summary)}`);
      if (allDay) lines.push(`DTSTART;VALUE=DATE:${start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(end || start, 1).replace(/-/g, '')}`);
      else { lines.push(`DTSTART:${dt(start)}`); if (end && dt(end)) lines.push(`DTEND:${dt(end)}`); }
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
      if (loc) lines.push(`LOCATION:${esc(loc)}`);
      lines.push('END:VEVENT');
    };
    for (const d of list) {
      const t = d.trip;
      if (t.start) ev(`trip-${d.id}`, `✈ ${t.title}`, t.start, t.end || t.start, t.description, t.destination, true);
      for (const b of Object.values(d.bookings)) {
        if (!b.start) continue;
        const allDay = b.start.length <= 10;
        ev(`booking-${b.id}`, `${b.title || b.type}${b.code ? ` (${b.code})` : ''}`, allDay ? b.start.slice(0, 10) : b.start, allDay ? (b.end || b.start).slice(0, 10) : b.end, [b.provider, b.notes].filter(Boolean).join('\n'), b.address || b.from || '', allDay);
      }
      for (const it of Object.values(d.items)) {
        if (it.kind !== 'place' || !it.date || !it.time) continue;
        const p = d.places[it.placeId];
        if (!p) continue;
        const start = `${it.date}T${it.time}`;
        const mins = Number(it.duration) || 60;
        const endD = new Date(`${start}:00Z`);
        endD.setUTCMinutes(endD.getUTCMinutes() + mins);
        ev(`item-${it.id}`, p.name, start, endD.toISOString().slice(0, 16), p.notes, p.address, false);
      }
    }
    lines.push('END:VCALENDAR');
    return lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/g).join('\r\n ') : l)).join('\r\n');
  }

  // --- Places, routes, weather, money (open services; built-in answers in demo mode) ------------

  const cache = new Map();
  async function fetchJson(url, { ttl = 3600e3, headers = {}, method = 'GET', body } = {}) {
    const key = `${method} ${url} ${body || ''}`;
    const hit = cache.get(key);
    if (hit && hit.at > Date.now() - ttl) return hit.data;
    const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20e3) });
    if (!res.ok) throw new TripError(502, `${new URL(url).hostname} answered ${res.status}`);
    const data = await res.json();
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return data;
  }
  // Nominatim asks for at most one request a second.
  let lastNominatim = 0;
  async function nominatim(pathAndQuery) {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    return fetchJson(`${(process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '')}/${pathAndQuery}`, { ttl: 24 * 3600e3, headers: { 'Accept-Language': 'en' } });
  }
  // Overpass (OpenStreetMap's database of places) is often busy. Searches go one at a time (two at
  // once from one address gets "too many requests"), and when a server is busy or slow the next
  // one is tried. OVERPASS_URLS can name your own.
  const OVERPASS = (process.env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',').map((u) => u.trim()).filter(Boolean);
  let overpassFirst = 0;
  let overpassQueue = Promise.resolve();
  const overpassAsked = new Map();
  function overpass(query) {
    const hit = cache.get(`overpass ${query}`);
    if (hit && hit.at > Date.now() - 6 * 3600e3) return Promise.resolve(hit.data);
    if (overpassAsked.has(query)) return overpassAsked.get(query);
    const run = overpassQueue.then(async () => {
      let last = null;
      for (let k = 0; k < OVERPASS.length; k++) {
        const i = (overpassFirst + k) % OVERPASS.length;
        const url = OVERPASS[i];
        try {
          const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30e3) });
          if (!res.ok) { last = `${new URL(url).hostname} answered ${res.status}`; continue; }
          const data = await res.json();
          // A server that ran out of time says so inside an answer that looks fine.
          if (!data.elements?.length && /timed out|out of memory|runtime error/i.test(data.remark || '')) { last = `${new URL(url).hostname}: ${data.remark}`; continue; }
          overpassFirst = i;
          cache.set(`overpass ${query}`, { at: Date.now(), data });
          return data;
        } catch (err) { last = `${new URL(url).hostname}: ${err.name === 'TimeoutError' ? 'took too long' : err.message}`; }
      }
      log(`Trip Planner: no Overpass server answered (${last})`);
      throw new TripError(503, 'The places database (OpenStreetMap’s Overpass) is busy right now. Try again in a minute.');
    });
    overpassQueue = run.catch(() => {});
    overpassAsked.set(query, run);
    run.finally(() => overpassAsked.delete(query)).catch(() => {});
    return run;
  }
  // When Overpass can't answer, Nominatim finds the main kinds of place in an area by name.
  const NOMINATIM_WORDS = { sights: 'tourist attraction', museum: 'museum', viewpoint: 'viewpoint', park: 'park', food: 'restaurant', cafe: 'cafe', nightlife: 'bar', shopping: 'shopping centre', hotel: 'hotel', transport: 'railway station' };
  async function nearbyByName(lat, lon, cat, radius) {
    const dLat = radius / 111e3;
    const dLon = radius / (111e3 * Math.cos((lat * Math.PI) / 180));
    const params = new URLSearchParams({ q: NOMINATIM_WORDS[cat] || 'tourist attraction', format: 'jsonv2', limit: '40', bounded: '1', viewbox: `${lon - dLon},${lat + dLat},${lon + dLon},${lat - dLat}`, addressdetails: '1', extratags: '1', namedetails: '1' });
    return (await nominatim(`search?${params}`)).map((r) => ({ ...placeFromNominatim(r), category: cat })).filter((p) => p.name && Number.isFinite(p.lat));
  }
  const placeFromNominatim = (r) => ({
    name: r.namedetails?.name || r.name || r.display_name?.split(',')[0] || 'Place', lat: Number(r.lat), lon: Number(r.lon), address: r.display_name || '',
    category: categoryOf(r.category || r.class, r.type), country: (r.address?.country_code || '').toUpperCase() || null,
    osm: r.osm_type && r.osm_id ? `${r.osm_type[0]}${r.osm_id}` : null, url: r.extratags?.website || null, phone: r.extratags?.phone || null, hours: r.extratags?.opening_hours || null,
    wiki: r.extratags?.wikipedia || null,
  });

  const geo = {
    async search(q, near) {
      if (mock) return demoSearch(q);
      const params = new URLSearchParams({ q, format: 'jsonv2', limit: '10', addressdetails: '1', extratags: '1', namedetails: '1' });
      if (near) { const [lat, lon] = near.split(',').map(Number); if (Number.isFinite(lat)) params.set('viewbox', `${lon - 2},${lat + 2},${lon + 2},${lat - 2}`); }
      return (await nominatim(`search?${params}`)).map(placeFromNominatim);
    },
    // Towns, cities, regions and countries as you type (Photon is made for that; Nominatim's
    // rules don't allow it).
    async suggest(q) {
      q = String(q || '').trim().slice(0, 100);
      if (q.length < 2) return [];
      if (mock) { const s = q.toLowerCase(); return DEMO_CITIES.filter((c) => c[0].toLowerCase().startsWith(s) || c[1].toLowerCase().startsWith(s)).slice(0, 8).map(([name, country, code, lat, lon, kind]) => ({ name, lat, lon, country: code, address: kind === 'country' ? name : [name, country].join(', '), kind })); }
      const params = new URLSearchParams({ q, limit: '8', lang: 'en' });
      for (const t of ['place:city', 'place:town', 'place:village', 'place:island', 'place:state', 'place:region', 'place:county', 'place:country', 'place:archipelago', 'boundary:administrative']) params.append('osm_tag', t);
      const data = await fetchJson(`https://photon.komoot.io/api/?${params}`, { ttl: 7 * 864e5 });
      const seen = new Set();
      return (data.features || []).map((f) => {
        const pr = f.properties || {};
        const [lon, lat] = f.geometry?.coordinates || [];
        const kind = pr.type || pr.osm_value || 'place';
        return { name: pr.name || q, lat, lon, country: (pr.countrycode || '').toUpperCase() || null, address: [pr.name, kind === 'country' ? null : pr.state, kind === 'country' ? null : pr.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '), kind };
      }).filter((p) => Number.isFinite(p.lat) && !seen.has(p.address) && seen.add(p.address));
    },
    async reverse(lat, lon) {
      if (mock) return { name: 'Dropped pin', lat, lon, address: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, category: 'other', country: 'PT' };
      return placeFromNominatim(await nominatim(`reverse?${new URLSearchParams({ lat, lon, format: 'jsonv2', addressdetails: '1', extratags: '1', namedetails: '1', zoom: '18' })}`));
    },
    // A description and picture: from the place's Wikipedia article, or one nearby with its name.
    async wiki({ title, lat, lon, name }) {
      if (mock) return demoWiki(name || title);
      let t = title;
      let lang = 'en';
      if (t && t.includes(':')) [lang, t] = t.split(/:(.+)/);
      if (!t && Number.isFinite(lat)) {
        const near = await fetchJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`, gsradius: '400', gslimit: '8', format: 'json', origin: '*' })}`, { ttl: 7 * 864e5 });
        const words = String(name || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        t = near.query?.geosearch?.find((g) => words.some((w) => g.title.toLowerCase().includes(w)))?.title;
      }
      if (!t || !/^[a-z-]{2,12}$/.test(lang)) return null;
      const s = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`, { ttl: 7 * 864e5 }).catch(() => null);
      return s ? { title: s.title, extract: s.extract, image: s.originalimage?.source || s.thumbnail?.source || null, url: s.content_urls?.desktop?.page || null } : null;
    },
    // Nearby places of a kind, from OpenStreetMap.
    async nearby(lat, lon, cat, radius = 1500) {
      if (mock) return demoNearby(lat, lon, cat);
      const tags = NEARBY[cat] || NEARBY.sights;
      const r = Math.min(5000, Math.max(200, Number(radius) || 1500));
      const q = `[out:json][timeout:25];(${tags.map((t) => `nwr[${t}][name](around:${r},${lat.toFixed(5)},${lon.toFixed(5)});`).join('')});out center 60;`;
      let data;
      try { data = await overpass(q); } catch (err) {
        const found = await nearbyByName(lat, lon, cat, r).catch(() => null);
        if (found?.length) return found;
        throw err;
      }
      return (data.elements || []).map((e) => ({
        name: e.tags.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, category: cat, osm: `${e.type[0]}${e.id}`,
        address: [e.tags['addr:street'] && `${e.tags['addr:street']} ${e.tags['addr:housenumber'] || ''}`.trim(), e.tags['addr:city']].filter(Boolean).join(', '),
        url: e.tags.website || null, phone: e.tags.phone || null, hours: e.tags.opening_hours || null, wiki: e.tags.wikipedia || null, cuisine: e.tags.cuisine || null,
      })).filter((p) => Number.isFinite(p.lat)).slice(0, 60);
    },
    // Places of a kind along a route (a line of points), within a distance of it.
    async along(points, cat, radius = 3000) {
      if (points.length < 2) return [];
      if (mock) return demoAlong(points, cat);
      const tags = ALONG[cat] || NEARBY[cat] || ALONG.hotel;
      const r = Math.min(10000, Math.max(500, Number(radius) || 3000));
      const line = points.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(',');
      const q = `[out:json][timeout:30];(${tags.map((t) => `nwr[${t}][name](around:${r},${line});`).join('')});out center 80;`;
      const data = await overpass(q);
      return (data.elements || []).map((e) => ({
        name: e.tags.name, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, category: ALONG_CATEGORY[cat] || cat, osm: `${e.type[0]}${e.id}`,
        address: [e.tags['addr:street'] && `${e.tags['addr:street']} ${e.tags['addr:housenumber'] || ''}`.trim(), e.tags['addr:city']].filter(Boolean).join(', '),
        url: e.tags.website || null, phone: e.tags.phone || null, hours: e.tags.opening_hours || null, wiki: e.tags.wikipedia || null, stars: e.tags.stars || null, brand: e.tags.brand || null,
      })).filter((p) => Number.isFinite(p.lat)).slice(0, 80);
    },
    // A route through points (car, bike or on foot), with its line, distance and time per leg.
    async route(mode, coords) {
      if (coords.length < 2) return null;
      if (mock) return demoRoute(mode, coords);
      const profile = { car: 'routed-car', bike: 'routed-bike', foot: 'routed-foot' }[mode] || 'routed-car';
      const data = await fetchJson(`https://routing.openstreetmap.de/${profile}/route/v1/driving/${coords.map((c) => `${c[1]},${c[0]}`).join(';')}?overview=full&geometries=geojson&steps=false`, { ttl: 24 * 3600e3 });
      const r = data.routes?.[0];
      if (!r) throw new TripError(502, 'No route was found');
      return { distance: r.distance, duration: r.duration, line: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]), legs: r.legs.map((l) => ({ distance: l.distance, duration: l.duration })) };
    },
    // 16 days of forecast; earlier and later dates from last year's records, as a guide.
    async weather(lat, lon, start, end) {
      if (mock) return demoWeather(start, end);
      const today = new Date().toISOString().slice(0, 10);
      const horizon = addDays(today, 15);
      const days = {};
      const put = (d, guess) => (d.daily?.time || []).forEach((t, i) => { days[guess ? addDays(t, 365) : t] = { code: d.daily.weather_code?.[i], max: d.daily.temperature_2m_max?.[i], min: d.daily.temperature_2m_min?.[i], rain: d.daily.precipitation_sum?.[i], guess }; });
      const vars = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum';
      if (end >= today && start <= horizon) put(await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${vars}&timezone=auto&forecast_days=16`, { ttl: 3 * 3600e3 }));
      const later = start > horizon ? start : addDays(horizon, 1);
      if (end > horizon) {
        const a = addDays(later, -365);
        const b = addDays(end, -365);
        if (dayDiff(a, b) <= 60) put(await fetchJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=${vars}&timezone=auto&start_date=${a}&end_date=${b}`, { ttl: 7 * 864e5 }).catch(() => ({})), true);
      }
      return days;
    },
    // An exchange rate on a day (from the European Central Bank's reference rates).
    async fx(from, to, date) {
      from = String(from).toUpperCase();
      to = String(to).toUpperCase();
      if (from === to) return 1;
      if (mock) return demoFx(from, to);
      const day = isDate(date) && date <= new Date().toISOString().slice(0, 10) ? date : 'latest';
      const data = await fetchJson(`https://api.frankfurter.app/${day}?from=${from}&to=${to}`, { ttl: 12 * 3600e3 });
      const rate = data.rates?.[to];
      if (!rate) throw new TripError(400, `No exchange rate for ${from} → ${to}`);
      return rate;
    },
  };

  // --- Requests --------------------------------------------------------------------------------

  async function handle(req, res, url, { sendJson, readJson }) {
    const p = url.pathname.replace(/^\/portal\/trips/, '') || '/';
    const q = url.searchParams;
    try {
      loadAll();
      if (p === '/list' && req.method === 'GET') return sendJson(res, 200, { trips: [...trips.values()].map(summary).sort((a, b) => (a.start || '9') < (b.start || '9') ? -1 : 1), icsToken: settings.icsToken, mock });
      if (p === '/create' && req.method === 'POST') return sendJson(res, 200, { trip: createTrip(await readJson(req)) });
      if (p.startsWith('/geo/')) {
        const num = (k) => Number(q.get(k));
        if (p === '/geo/search') return sendJson(res, 200, { places: await geo.search(String(q.get('q') || '').slice(0, 200), q.get('near')) });
        if (p === '/geo/suggest') return sendJson(res, 200, { places: await geo.suggest(q.get('q')) });
        if (p === '/geo/reverse') return sendJson(res, 200, { place: await geo.reverse(num('lat'), num('lon')) });
        if (p === '/geo/wiki') return sendJson(res, 200, { wiki: await geo.wiki({ title: q.get('title'), lat: num('lat'), lon: num('lon'), name: q.get('name') }) });
        if (p === '/geo/nearby') return sendJson(res, 200, { places: await geo.nearby(num('lat'), num('lon'), q.get('cat') || 'sights', q.get('radius')) });
        if (p === '/geo/route') {
          const coords = String(q.get('points') || '').split(';').map((s) => s.split(',').map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite)).slice(0, 60);
          return sendJson(res, 200, { route: await geo.route(q.get('mode'), coords) });
        }
        if (p === '/geo/along') {
          const pts = String(q.get('points') || '').split(';').map((x) => x.split(',').map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite)).slice(0, 80);
          return sendJson(res, 200, { places: await geo.along(pts, q.get('cat') || 'hotel', q.get('radius')) });
        }
        if (p === '/geo/weather') return sendJson(res, 200, { days: await geo.weather(num('lat'), num('lon'), q.get('start'), q.get('end') || q.get('start')) });
        if (p === '/geo/fx') return sendJson(res, 200, { rate: await geo.fx(q.get('from'), q.get('to'), q.get('date')) });
        return sendJson(res, 404, { error: 'Not found' });
      }
      if (p === '/ics-token' && req.method === 'POST') { settings.icsToken = token(); await saveSettings(); return sendJson(res, 200, { icsToken: settings.icsToken }); }
      // Atlas: countries marked visited or on the bucket list (besides those the trips went to).
      if (p === '/atlas' && req.method === 'GET') return sendJson(res, 200, { visited: settings.visited || [], bucket: settings.bucket || [], trips: [...trips.values()].map(summary) });
      if (p === '/atlas' && req.method === 'POST') {
        const b = await readJson(req);
        const codes = (a) => [...new Set((Array.isArray(a) ? a : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
        if ('visited' in b) settings.visited = codes(b.visited);
        if ('bucket' in b) settings.bucket = codes(b.bucket);
        await saveSettings();
        return sendJson(res, 200, { visited: settings.visited || [], bucket: settings.bucket || [] });
      }
      // Packing templates saved from lists (the built-in ones live in the app).
      if (p === '/templates' && req.method === 'GET') return sendJson(res, 200, { templates: settings.templates || [] });
      if (p === '/templates' && req.method === 'POST') {
        const b = await readJson(req);
        settings.templates = (Array.isArray(b.templates) ? b.templates : []).slice(0, 100).map((t) => ({ id: String(t.id || newId()).slice(0, 40), name: String(t.name || 'Template').slice(0, 80), items: (Array.isArray(t.items) ? t.items : []).slice(0, 400).map((i) => ({ text: String(i.text || '').slice(0, 200), category: i.category ? String(i.category).slice(0, 60) : null, quantity: Number(i.quantity) || 1 })) }));
        await saveSettings();
        return sendJson(res, 200, { templates: settings.templates });
      }
      const m = /^\/trip\/([\w-]+)(\/.*)?$/.exec(p);
      if (!m) return sendJson(res, 404, { error: 'Not found' });
      const d = get(m[1]);
      const rest = m[2] || '';
      if (!rest && req.method === 'GET') {
        if (Number(q.get('since')) === d.rev) return sendJson(res, 200, { rev: d.rev, same: true });
        return sendJson(res, 200, d);
      }
      if (!rest && req.method === 'DELETE') { await deleteTrip(d); return sendJson(res, 200, { ok: true }); }
      if (rest === '/ops' && req.method === 'POST') return sendJson(res, 200, applyOps(d, (await readJson(req)).ops));
      if (rest === '/redate' && req.method === 'POST') { const b = await readJson(req); redate(d, b.start, b.end); return sendJson(res, 200, d); }
      if (rest === '/copy' && req.method === 'POST') return sendJson(res, 200, { trip: summary(await copyTrip(d)) });
      if (rest === '/share' && req.method === 'POST') {
        const b = await readJson(req);
        if (b.enable === false) delete d.trip.shareToken; else d.trip.shareToken ||= token();
        if (b.options) d.trip.shareOptions = Object.fromEntries(['map', 'bookings', 'packing', 'costs', 'notes'].map((k) => [k, Boolean(b.options[k])]));
        if (b.renew) d.trip.shareToken = token();
        if (b.ics === 'renew' || (b.ics && !d.trip.icsToken)) d.trip.icsToken = token();
        d.rev++;
        persist(d);
        return sendJson(res, 200, { trip: d.trip });
      }
      if (rest === '/files' && req.method === 'POST') {
        const link = {};
        for (const k of ['placeId', 'bookingId', 'expenseId', 'day', 'noteId']) if (q.get(k)) link[k] = String(q.get(k)).slice(0, 40);
        return sendJson(res, 200, { file: await receiveFile(req, d, cleanName(q.get('name')), link), rev: d.rev });
      }
      const f = /^\/files\/([\w-]+)$/.exec(rest);
      if (f && (req.method === 'GET' || req.method === 'HEAD')) return await sendFile(req, res, d, f[1], q.get('download') === '1');
      if (rest === '/ics' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${cleanName(d.trip.title)}.ics"` }); return res.end(ics([d], d.trip.title)); }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!(err instanceof TripError)) log(`Trip Planner: ${err.stack || err.message}`);
      if (res.headersSent) return res.end();
      return sendJson(res, err.status || (err.name === 'TimeoutError' ? 504 : 500), { error: err.status ? err.message : err.name === 'TimeoutError' ? 'A map service took too long to answer. Try again in a minute.' : 'The Trip Planner had a problem' });
    }
  }

  // Public: a read-only share link (/trip/<token>, its data and pictures) and calendar feeds.
  async function publicHandle(req, res, url, { sendJson }) {
    const p = url.pathname;
    try {
      loadAll();
      let m = /^\/trip-share\/([\w-]{20,})\/data$/.exec(p);
      if (m) { const d = findShared(m[1]); if (!d) return sendJson(res, 404, { error: 'This trip isn’t shared any more' }); return sendJson(res, 200, shared(d)); }
      m = /^\/trip-share\/([\w-]{20,})\/files\/([\w-]+)$/.exec(p);
      if (m) {
        const d = findShared(m[1]);
        const sh = d && shared(d);
        if (!d || !sh.files[m[2]]) return sendJson(res, 404, { error: 'Not found' });
        return await sendFile(req, res, d, m[2], false);
      }
      m = /^\/trip-feed\/([\w-]{20,})\.ics$/.exec(p);
      if (m) {
        let list = [];
        let name = 'Trips';
        if (m[1] === settings.icsToken) list = [...trips.values()].filter((d) => !d.trip.archived);
        else { const d = [...trips.values()].find((x) => x.trip.icsToken === m[1]); if (d) { list = [d]; name = d.trip.title; } }
        if (!list.length && m[1] !== settings.icsToken) return sendJson(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(ics(list, name));
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong' });
    }
  }

  // --- Demo mode: a trip to Portugal, and a small built-in world -----------------------------------

  const DEMO_CITIES = [['Lisbon', 'Portugal', 'PT', 38.7223, -9.1393, 'city'], ['Porto', 'Portugal', 'PT', 41.1579, -8.6291, 'city'], ['Portugal', 'Portugal', 'PT', 39.6, -8.0, 'country'], ['Sintra', 'Portugal', 'PT', 38.8029, -9.3817, 'town'], ['Lagos', 'Portugal', 'PT', 37.1028, -8.6730, 'town'], ['Paris', 'France', 'FR', 48.8566, 2.3522, 'city'], ['Rome', 'Italy', 'IT', 41.9028, 12.4964, 'city'], ['Florence', 'Italy', 'IT', 43.7696, 11.2558, 'city'], ['Venice', 'Italy', 'IT', 45.4408, 12.3155, 'city'], ['Barcelona', 'Spain', 'ES', 41.3874, 2.1686, 'city'], ['Madrid', 'Spain', 'ES', 40.4168, -3.7038, 'city'], ['London', 'United Kingdom', 'GB', 51.5072, -0.1276, 'city'], ['Tokyo', 'Japan', 'JP', 35.6762, 139.6503, 'city'], ['Kyoto', 'Japan', 'JP', 35.0116, 135.7681, 'city'], ['New York', 'United States', 'US', 40.7128, -74.006, 'city'], ['San Francisco', 'United States', 'US', 37.7749, -122.4194, 'city'], ['Amsterdam', 'Netherlands', 'NL', 52.3676, 4.9041, 'city'], ['Berlin', 'Germany', 'DE', 52.52, 13.405, 'city']];
  const DEMO_PLACES = [
    ['Belém Tower', 38.6916, -9.2160, 'sights', 'Av. Brasília, 1400-038 Lisboa', 'PT'], ['Jerónimos Monastery', 38.6979, -9.2068, 'sights', 'Praça do Império, 1400-206 Lisboa', 'PT'],
    ['Pastéis de Belém', 38.6975, -9.2032, 'cafe', 'R. de Belém 84-92, Lisboa', 'PT'], ['LX Factory', 38.7036, -9.1786, 'shopping', 'R. Rodrigues de Faria 103, Lisboa', 'PT'],
    ['Time Out Market', 38.7069, -9.1459, 'food', 'Av. 24 de Julho 49, Lisboa', 'PT'], ['São Jorge Castle', 38.7139, -9.1335, 'sights', 'R. de Santa Cruz do Castelo, Lisboa', 'PT'],
    ['Alfama', 38.7116, -9.1300, 'sights', 'Alfama, Lisboa', 'PT'], ['Miradouro da Senhora do Monte', 38.7193, -9.1325, 'viewpoint', 'Largo Monte, Lisboa', 'PT'],
    ['Oceanário de Lisboa', 38.7635, -9.0937, 'museum', 'Esplanada Dom Carlos I, Lisboa', 'PT'], ['Pena Palace', 38.7876, -9.3906, 'sights', 'Estrada da Pena, Sintra', 'PT'],
    ['Quinta da Regaleira', 38.7963, -9.3960, 'sights', 'R. Barbosa du Bocage 5, Sintra', 'PT'], ['Cabo da Roca', 38.7804, -9.4989, 'viewpoint', 'Colares, Sintra', 'PT'],
    ['Ribeira', 41.1405, -8.6131, 'sights', 'Ribeira, Porto', 'PT'], ['Livraria Lello', 41.1469, -8.6148, 'shopping', 'R. das Carmelitas 144, Porto', 'PT'],
    ['Dom Luís I Bridge', 41.1399, -8.6094, 'sights', 'Ponte Luiz I, Porto', 'PT'], ['Graham’s Port Lodge', 41.1347, -8.6157, 'food', 'R. do Agro 141, Vila Nova de Gaia', 'PT'],
    ['Lisbon Airport', 38.7742, -9.1342, 'transport', 'Alameda das Comunidades Portuguesas, Lisboa', 'PT'], ['Santa Apolónia Station', 38.7137, -9.1225, 'transport', 'Av. Infante Dom Henrique, Lisboa', 'PT'],
    ['Porto Campanhã Station', 41.1489, -8.5853, 'transport', 'Largo da Estação, Porto', 'PT'], ['Eiffel Tower', 48.8584, 2.2945, 'sights', 'Champ de Mars, Paris', 'FR'],
    ['Louvre Museum', 48.8606, 2.3376, 'museum', 'Rue de Rivoli, Paris', 'FR'], ['Colosseum', 41.8902, 12.4922, 'sights', 'Piazza del Colosseo, Roma', 'IT'],
    ['Sagrada Família', 41.4036, 2.1744, 'sights', 'C/ de Mallorca 401, Barcelona', 'ES'], ['Brandenburg Gate', 52.5163, 13.3777, 'sights', 'Pariser Platz, Berlin', 'DE'],
    ['Tower Bridge', 51.5055, -0.0754, 'sights', 'Tower Bridge Rd, London', 'GB'], ['Shibuya Crossing', 35.6595, 139.7005, 'sights', 'Shibuya City, Tokyo', 'JP'],
  ];
  const demoPlace = ([name, lat, lon, category, address, country]) => ({ name, lat, lon, category, address, country, osm: null, url: null, phone: null, hours: category === 'museum' ? 'Tu-Su 10:00-18:00' : null });
  function demoSearch(qs) {
    const s = String(qs).toLowerCase().trim();
    if (!s) return [];
    return DEMO_PLACES.filter((p) => `${p[0]} ${p[4]}`.toLowerCase().includes(s)).slice(0, 10).map(demoPlace);
  }
  function demoWiki(name) {
    const p = DEMO_PLACES.find((x) => x[0] === name);
    if (!p) return null;
    const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const image = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,70%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,35%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><path d="M0 300 Q160 240 320 290 T640 270 V360 H0 Z" fill="rgba(0,0,0,.25)"/><text x="30" y="330" font-family="sans-serif" font-size="30" fill="#fff">${name.replace(/&/g, '&amp;')}</text></svg>`)}`;
    return { title: name, extract: `${name} is one of the best-known sights of ${p[4].split(',').pop().trim()}. (A demo description: with MediaDesk connected to the internet, descriptions and photos come from Wikipedia.)`, image, url: null };
  }
  function demoAlong(points, cat) {
    const names = { hotel: ['Roadside Inn', 'Estalagem do Caminho', 'Motel Central', 'Quinta da Estrada'], fuel: ['Galp', 'Repsol', 'BP'], charging: ['Ionity Charging', 'Tesla Supercharger'], rest: ['Rest Area North', 'Service Area'], food: ['Churrasqueira do Viajante', 'Tasca da Ponte'], cafe: ['Café da Estrada'], sights: ['Old Castle', 'Roman Bridge', 'Village Church'], viewpoint: ['Valley Viewpoint'], park: ['River Beach', 'Nature Park'], museum: ['Village Museum'], camping: ['Camping do Rio'] }[cat] || ['Place along the way'];
    return names.map((n, i) => { const pt = points[Math.min(points.length - 1, Math.round(((i + 1) / (names.length + 1)) * (points.length - 1)))]; return { name: n, lat: pt[0] + 0.01 * Math.sin(i * 1.7), lon: pt[1] + 0.012 * Math.cos(i * 1.7), category: ALONG_CATEGORY[cat] || cat, address: 'Demo road', osm: null, url: null, phone: null, hours: null }; });
  }
  function demoNearby(lat, lon, cat) {
    const names = { food: ['Taberna do Bairro', 'Casa da Esquina', 'O Pescador', 'Cantinho Verde'], cafe: ['Café Central', 'Pastelaria Doce', 'Grão de Café'], sights: ['Old Church', 'Town Fountain', 'Little Chapel', 'Stone Arch'], museum: ['City Museum', 'Tile Museum'], viewpoint: ['Sunset Viewpoint', 'Hilltop Terrace'], park: ['Garden of Roses', 'Riverside Park'], shopping: ['Market Hall', 'Book Corner'], nightlife: ['Fado House', 'Rooftop Bar'], transport: ['Metro Station', 'Bus Stop'], hotel: ['Hotel Avenida', 'Casa Azul Guesthouse'] }[cat] || ['Interesting place'];
    return names.map((n, i) => ({ name: n, lat: lat + Math.sin(i * 2.1) * 0.006, lon: lon + Math.cos(i * 2.1) * 0.008, category: cat, address: 'Demo street', osm: null, url: null, phone: null, hours: 'Mo-Su 09:00-22:00' }));
  }
  const hav = (a, b) => { const R = 6371e3; const t = (x) => x * Math.PI / 180; const dl = t(b[0] - a[0]); const dn = t(b[1] - a[1]); return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dn / 2) ** 2)); };
  function demoRoute(mode, coords) {
    const speed = { car: 13, bike: 4.5, foot: 1.35 }[mode] || 13;
    const legs = [];
    const line = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const dist = hav(a, b) * 1.3;
      legs.push({ distance: dist, duration: dist / speed });
      for (let k = 0; k <= 8; k++) { const t = k / 8; line.push([a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * 0.002, a[1] + (b[1] - a[1]) * t]); }
    }
    return { distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), line, legs };
  }
  function demoWeather(start, end) {
    const out = {};
    if (!isDate(start)) return out;
    for (let d = start, i = 0; d <= (end || start) && i < 60; d = addDays(d, 1), i++) out[d] = { code: [0, 1, 2, 3, 61, 1, 0][i % 7], max: 22 + (i % 5), min: 14 + (i % 3), rain: i % 7 === 4 ? 3.2 : 0 };
    return out;
  }
  const DEMO_RATES = { EUR: 1, USD: 1.08, GBP: 0.85, CHF: 0.95, JPY: 162, CAD: 1.47, AUD: 1.65, SEK: 11.4, NOK: 11.6, DKK: 7.46, PLN: 4.3, CZK: 25.2, HUF: 395, TRY: 35, MXN: 18.5 };
  function demoFx(from, to) {
    if (!DEMO_RATES[from] || !DEMO_RATES[to]) throw new TripError(400, `No exchange rate for ${from} → ${to}`);
    return Math.round((DEMO_RATES[to] / DEMO_RATES[from]) * 1e6) / 1e6;
  }

  function demoTrip() {
    const today = new Date().toISOString().slice(0, 10);
    const start = addDays(today, 12);
    const members = [{ id: 'm-rob', name: 'Rob', color: '#3b82f6' }, { id: 'm-sam', name: 'Sam', color: '#e8590c' }, { id: 'm-alex', name: 'Alex', color: '#2f9e44' }];
    const d = normalise({ id: 'demo-portugal', rev: 1, created: Date.now(), updated: Date.now(), trip: { title: 'Portugal road trip', destination: 'Lisbon & Porto', origin: { name: 'London', address: 'London, United Kingdom', lat: 51.5072, lon: -0.1276, country: 'GB' }, destinations: [{ id: 'd-lisbon', name: 'Lisbon', address: 'Lisbon, Portugal', lat: 38.7223, lon: -9.1393, country: 'PT', arrive: start, depart: addDays(start, 4), travel: { mode: 'flight', fromAirport: 'LHR', toAirport: 'LIS', number: 'TP1351', departs: '07:10', airportBy: 'car' } }, { id: 'd-porto', name: 'Porto', address: 'Porto, Portugal', lat: 41.1579, lon: -8.6291, country: 'PT', arrive: addDays(start, 4), depart: addDays(start, 6), travel: { mode: 'car', departs: '10:00', rental: true } }], description: 'Pastéis, palaces and port wine.', start, end: addDays(start, 6), currency: 'EUR', color: '#e8590c', members } });
    const pid = {};
    for (const p of DEMO_PLACES.slice(0, 19)) { const id = `p-${p[0].toLowerCase().replace(/[^a-z]+/g, '-')}`; pid[p[0]] = id; d.places[id] = { id, ...demoPlace(p), created: Date.now() }; }
    d.places[pid['Pastéis de Belém']].rating = 5;
    d.places[pid['Pastéis de Belém']].notes = 'Get the custard tarts warm, with cinnamon.';
    const plan = [[0, ['Lisbon Airport', 'Alfama', 'São Jorge Castle', 'Miradouro da Senhora do Monte']], [1, ['Belém Tower', 'Jerónimos Monastery', 'Pastéis de Belém', 'LX Factory', 'Time Out Market']], [2, ['Pena Palace', 'Quinta da Regaleira', 'Cabo da Roca']], [3, ['Oceanário de Lisboa']], [4, ['Santa Apolónia Station', 'Porto Campanhã Station', 'Ribeira', 'Dom Luís I Bridge']], [5, ['Livraria Lello', 'Graham’s Port Lodge']]];
    let o = 0;
    for (const [day, names] of plan) names.forEach((n, i) => { const id = `i-${++o}`; d.items[id] = { id, kind: 'place', placeId: pid[n], date: addDays(start, day), order: i, travel: day === 2 ? 'car' : 'foot', time: i === 0 ? '10:00' : null }; });
    d.items['i-note'] = { id: 'i-note', kind: 'note', text: 'Tram 28 is busy after 10 — walk up instead.', date: start, order: 1.5 };
    const at = (n, t) => `${addDays(start, n)}T${t}`;
    d.bookings = {
      'b-flight': { id: 'b-flight', type: 'flight', title: 'London → Lisbon', status: 'confirmed', code: 'TP1351', provider: 'TAP Air Portugal', start: at(0, '07:10'), end: at(0, '09:45'), travellers: ['m-rob', 'm-sam', 'm-alex'], price: 312, currency: 'GBP', legs: [{ from: 'LHR', to: 'LIS', depart: at(0, '07:10'), arrive: at(0, '09:45'), number: 'TP1351', carrier: 'TAP' }] },
      'b-hotel': { id: 'b-hotel', type: 'hotel', title: 'Casa do Fado Guesthouse', status: 'confirmed', code: 'HX8842', provider: 'Booking.com', start: at(0, '15:00'), end: at(4, '11:00'), address: 'R. dos Remédios 47, Lisboa', lat: 38.7123, lon: -9.1262, price: 520, currency: 'EUR', travellers: ['m-rob', 'm-sam', 'm-alex'] },
      'b-car': { id: 'b-car', type: 'car', title: 'Rental car for Sintra', status: 'pending', provider: 'Europcar', start: at(2, '08:30'), end: at(2, '20:00'), price: 64, currency: 'EUR' },
      'b-train': { id: 'b-train', type: 'train', title: 'Alfa Pendular to Porto', status: 'confirmed', code: 'AP131', provider: 'CP', start: at(4, '11:39'), end: at(4, '14:24'), price: 75, currency: 'EUR', legs: [{ from: 'Lisboa Santa Apolónia', to: 'Porto Campanhã', depart: at(4, '11:39'), arrive: at(4, '14:24'), number: 'AP 131' }] },
      'b-dinner': { id: 'b-dinner', type: 'restaurant', title: 'Fado dinner', status: 'confirmed', provider: 'Clube de Fado', start: at(1, '20:30'), end: at(1, '23:00'), price: 135, currency: 'EUR' },
    };
    d.items['i-b1'] = { id: 'i-b1', kind: 'booking', bookingId: 'b-flight', date: start, order: -1 };
    d.items['i-b2'] = { id: 'i-b2', kind: 'booking', bookingId: 'b-train', date: addDays(start, 4), order: 0.5 };
    d.items['i-b3'] = { id: 'i-b3', kind: 'booking', bookingId: 'b-dinner', date: addDays(start, 1), order: 9 };
    const split = (ids) => Object.fromEntries(ids.map((m) => [m, 1]));
    d.expenses = {
      'e-1': { id: 'e-1', title: 'Flights', amount: 312, currency: 'GBP', rate: 1 / 0.85, date: today, category: 'transport', paidBy: { 'm-rob': 312 }, split: 'equal', shares: split(['m-rob', 'm-sam', 'm-alex']), bookingId: 'b-flight' },
      'e-2': { id: 'e-2', title: 'Guesthouse', amount: 520, currency: 'EUR', rate: 1, date: today, category: 'stay', paidBy: { 'm-sam': 520 }, split: 'equal', shares: split(['m-rob', 'm-sam', 'm-alex']), bookingId: 'b-hotel' },
      'e-3': { id: 'e-3', title: 'Pastéis & coffee', amount: 14.4, currency: 'EUR', rate: 1, date: addDays(start, 1), category: 'food', paidBy: { 'm-alex': 14.4 }, split: 'equal', shares: split(['m-rob', 'm-sam', 'm-alex']) },
    };
    d.lists = { 'l-pack': { id: 'l-pack', kind: 'packing', name: 'Packing', order: 0 }, 'l-todo': { id: 'l-todo', kind: 'todo', name: 'Before we go', order: 1 } };
    const entries = [['l-pack', 'Passport', 'Documents', true], ['l-pack', 'Travel adapter', 'Electronics', false], ['l-pack', 'Phone charger', 'Electronics', true], ['l-pack', 'Comfortable shoes', 'Clothes', false], ['l-pack', 'Sunscreen', 'Toiletries', false], ['l-pack', 'Swimsuit', 'Clothes', false], ['l-todo', 'Book Pena Palace tickets', null, false], ['l-todo', 'Get euros', null, true], ['l-todo', 'Check car insurance', null, false]];
    entries.forEach(([list, text, cat, done], i) => { d.entries[`e${i}`] = { id: `e${i}`, list, text, category: cat, done, order: i, assignee: i % 3 === 0 ? 'm-sam' : null, ...(list === 'l-todo' ? { due: addDays(today, 5 + i), priority: i === 6 ? 'high' : 'normal' } : {}) }; });
    d.notes = { 'n-1': { id: 'n-1', title: 'Ideas', text: 'Maybe a day trip to Óbidos?\nTry ginjinha in a chocolate cup.', author: 'm-sam' } };
    d.links = { 'k-1': { id: 'k-1', title: 'Pena Palace tickets', url: 'https://www.parquesdesintra.pt/', author: 'm-rob' } };
    d.polls = { 'q-1': { id: 'q-1', question: 'Where for the last dinner?', options: [{ id: 'a', text: 'Seafood in Matosinhos', votes: ['m-rob', 'm-alex'] }, { id: 'b', text: 'Francesinha in town', votes: ['m-sam'] }], author: 'm-alex' } };
    trips.set(d.id, d);
    persist(d);
  }

  return { handle, publicHandle, geo };
}

// Place kinds, from OpenStreetMap's categories.
function categoryOf(cls, type) {
  const t = `${cls}:${type}`;
  if (/restaurant|fast_food|food_court|pub|biergarten/.test(t)) return 'food';
  if (/cafe|bakery|ice_cream/.test(t)) return 'cafe';
  if (/bar|nightclub/.test(t)) return 'nightlife';
  if (/museum|gallery|arts_centre/.test(t)) return 'museum';
  if (/viewpoint/.test(t)) return 'viewpoint';
  if (/hotel|hostel|guest_house|motel|apartment|camp_site/.test(t)) return 'hotel';
  if (/park|garden|nature_reserve|beach|peak|forest/.test(t)) return 'park';
  if (/shop|mall|marketplace/.test(t)) return 'shopping';
  if (/station|aerodrome|airport|bus_stop|ferry|railway|public_transport/.test(t)) return 'transport';
  if (/tourism|historic|attraction|monument|castle|church|place_of_worship|memorial|ruins/.test(t)) return 'sights';
  return 'other';
}
const TRAVEL_MODES = ['car', 'flight', 'train', 'bus', 'ferry', 'boat', 'other'];
// Along a road trip: what to look for, and the kind of place it becomes.
const ALONG = {
  hotel: ['tourism=hotel', 'tourism=motel', 'tourism=guest_house'], camping: ['tourism=camp_site', 'tourism=caravan_site'], fuel: ['amenity=fuel'], charging: ['amenity=charging_station'],
  rest: ['highway=rest_area', 'highway=services'], food: ['amenity=restaurant', 'amenity=fast_food'], cafe: ['amenity=cafe'], sights: ['tourism=attraction', 'historic=castle', 'historic=monument'],
  viewpoint: ['tourism=viewpoint'], park: ['leisure=nature_reserve', 'boundary=national_park', 'natural=beach'], museum: ['tourism=museum'],
};
const ALONG_CATEGORY = { hotel: 'hotel', camping: 'hotel', fuel: 'transport', charging: 'transport', rest: 'transport' };
const NEARBY = {
  food: ['amenity=restaurant', 'amenity=fast_food'], cafe: ['amenity=cafe', 'shop=bakery'], sights: ['tourism=attraction', 'historic', 'tourism=artwork'], museum: ['tourism=museum', 'tourism=gallery'],
  viewpoint: ['tourism=viewpoint'], park: ['leisure=park', 'leisure=garden', 'natural=beach'], shopping: ['shop=mall', 'amenity=marketplace', 'shop=books', 'shop=gift'],
  nightlife: ['amenity=bar', 'amenity=pub', 'amenity=nightclub'], transport: ['public_transport=station', 'railway=station', 'amenity=bus_station'], hotel: ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel'],
};

module.exports = { createTrips, categoryOf };
