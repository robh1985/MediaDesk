// Family Organizer: the family's shared calendar, chores, routines, rewards, lists, meal plans,
// recipes and photo frame, kept in one file next to config.json so every device sees the same
// thing. Calendars from Google, Outlook, iCloud, Yahoo and others are added by their iCal
// (.ics) address and read here; the family's own events can be subscribed to from phones with
// a private feed address. Weather comes from Open-Meteo (no account needed).

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { sniff } = require('./wallpapers');
const { createFamilyAuth } = require('./family-auth');

const COLLECTIONS = ['members', 'events', 'calendars', 'chores', 'chorelog', 'rewards', 'redemptions', 'lists', 'listitems', 'meals', 'recipes', 'photos'];
const MAX_PHOTO = 25 * 1024 * 1024;
const PHOTO_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
const FEED_CACHE_MS = 10 * 60e3;
const WEATHER_CACHE_MS = 30 * 60e3;
const UA = 'MediaDesk/1.0 (self-hosted media portal; https://github.com/robh1985/MediaDesk)';

class FamilyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const newId = () => crypto.randomBytes(8).toString('hex');

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

// Windows time zone names, which Outlook puts in its feeds, for the zones most people are in.
const WINDOWS_ZONES = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow', 'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland', 'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Mexico Standard Time': 'America/Mexico_City', 'Central America Standard Time': 'America/Guatemala', 'UTC': 'UTC',
};

function zoneOffset(zone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs));
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second) - utcMs;
}

// A wall-clock time in a time zone, as a moment.
function zonedToUtc(y, mo, d, hh, mm, ss, zone) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  // Times without a zone ("floating") and zones we don't know are taken as this server's time.
  const local = () => new Date(y, mo - 1, d, hh, mm, ss).getTime();
  if (!zone) return local();
  const valid = (z) => { try { zoneOffset(z, guess); return true; } catch { return false; } };
  // Some calendars prefix the zone, as in /mozilla.org/20050126_1/America/New_York.
  const tz = [WINDOWS_ZONES[zone], zone, zone.split('/').slice(-2).join('/'), zone.split('/').slice(-3).join('/')].find((z) => z && valid(z));
  if (!tz) return local();
  const first = guess - zoneOffset(tz, guess);
  return guess - zoneOffset(tz, first);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

// DTSTART and friends: a date (all day), a UTC time, or a local time in a zone.
function parseDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (hh === undefined || params.VALUE === 'DATE') return { allDay: true, date: `${y}-${mo}-${d}` };
  const ms = z ? Date.UTC(+y, mo - 1, +d, +hh, +mm, +(ss || 0)) : zonedToUtc(+y, +mo, +d, +hh, +mm, +(ss || 0), params.TZID);
  return { allDay: false, iso: new Date(ms).toISOString() };
}

const unescapeText = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function parseDuration(s) {
  const m = /^([-+])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || '').trim());
  if (!m) return 0;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}

function parseRrule(s) {
  const r = Object.fromEntries(String(s).split(';').map((kv) => kv.split('=')).filter((kv) => kv.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) return null;
  const until = r.UNTIL ? parseDate(r.UNTIL) : null;
  return {
    freq: r.FREQ.toLowerCase(),
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : null,
    until: until ? (until.allDay ? `${until.date}T23:59:59` : until.iso) : null,
    byday: r.BYDAY ? r.BYDAY.split(',') : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(Number) : null,
    bysetpos: r.BYSETPOS ? r.BYSETPOS.split(',').map(Number) : null,
  };
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The events in an .ics file, as the organizer stores them. Changed occurrences of a repeating
// event become events of their own, and are left out of the repeating one.
function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = { props: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:VEVENT/i.test(line)) { events.push(cur); cur = null; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue;
    const m = /^([^:;]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const params = {};
    for (const p of m[2].split(';').slice(1)) { const [k, v = ''] = p.split('='); params[k.toUpperCase()] = v.replace(/^"|"$/g, ''); }
    cur.props.push({ name: m[1].toUpperCase(), params, value: m[3] });
  }
  const out = [];
  const byUid = new Map();
  for (const e of events) {
    const get = (n) => e.props.find((p) => p.name === n);
    if ((get('STATUS')?.value || '').toUpperCase() === 'CANCELLED') continue;
    const ds = get('DTSTART');
    const start = ds && parseDate(ds.value, ds.params);
    if (!start) continue;
    const de = get('DTEND');
    let end = de && parseDate(de.value, de.params);
    const ev = {
      uid: get('UID')?.value || newId(),
      title: unescapeText(get('SUMMARY')?.value) || '(No title)',
      location: unescapeText(get('LOCATION')?.value),
      notes: unescapeText(get('DESCRIPTION')?.value).slice(0, 4000),
      allDay: start.allDay,
    };
    if (start.allDay) {
      ev.start = start.date;
      // In iCal the end date of an all-day event is the day after it ends; here it's the last day.
      ev.end = end?.allDay ? addDays(end.date, -1) : start.date;
      if (ev.end < ev.start) ev.end = ev.start;
    } else {
      ev.start = start.iso;
      if (!end || end.allDay) {
        const dur = parseDuration(get('DURATION')?.value);
        end = { iso: new Date(Date.parse(start.iso) + (dur || 3600e3)).toISOString() };
      }
      ev.end = end.iso;
    }
    const rr = get('RRULE');
    if (rr) ev.rrule = parseRrule(rr.value);
    const ex = e.props.filter((p) => p.name === 'EXDATE').flatMap((p) => p.value.split(',').map((v) => parseDate(v, p.params)).filter(Boolean));
    if (ex.length) ev.exdates = ex.map((x) => (x.allDay ? x.date : x.iso));
    const rid = get('RECURRENCE-ID');
    if (rid) {
      const r = parseDate(rid.value, rid.params);
      if (r) ev.recurrenceOf = { uid: ev.uid, at: r.allDay ? r.date : r.iso };
    }
    ev.id = crypto.createHash('sha1').update(`${ev.uid}|${rid?.value || ''}`).digest('hex').slice(0, 16);
    out.push(ev);
    if (!rid) byUid.set(ev.uid, ev);
  }
  for (const ev of out) {
    if (!ev.recurrenceOf) continue;
    const master = byUid.get(ev.recurrenceOf.uid);
    if (master) (master.exdates ||= []).push(ev.recurrenceOf.at);
    delete ev.recurrenceOf;
  }
  return out;
}

const icsDate = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (d) => d.replace(/-/g, '');

function foldLine(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let n = 74;
    while (Buffer.byteLength(rest.slice(0, n)) > 74) n--;
    out.push(rest.slice(0, n));
    rest = ` ${rest.slice(n)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function rruleText(r) {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${icsDate(new Date(r.until).toISOString())}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.join(',')}`);
  if (r.bymonthday?.length) parts.push(`BYMONTHDAY=${r.bymonthday.join(',')}`);
  if (r.bymonth?.length) parts.push(`BYMONTH=${r.bymonth.join(',')}`);
  if (r.bysetpos?.length) parts.push(`BYSETPOS=${r.bysetpos.join(',')}`);
  return parts.join(';');
}

function wallTime(iso, zone) {
  const ms = Date.parse(iso);
  const t = new Date(ms + zoneOffset(zone, ms));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`;
}

function buildIcs(events, members, name = 'Family', timeZone = null) {
  let zone = null;
  try { if (timeZone) { zoneOffset(timeZone, Date.now()); zone = timeZone; } } catch { /* unknown zone */ }
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const now = icsDate(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MediaDesk//Family Organizer//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@mediadesk`, `DTSTAMP:${now}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(addDays(e.end || e.start, 1))}`);
    // In the family's time zone, so a repeat on "Tuesdays at 8 pm" stays on Tuesdays everywhere.
    else if (zone) lines.push(`DTSTART;TZID=${zone}:${wallTime(e.start, zone)}`, `DTEND;TZID=${zone}:${wallTime(e.end || e.start, zone)}`);
    else lines.push(`DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end || e.start)}`);
    const who = (e.members || []).map((id) => memberName.get(id)).filter(Boolean);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    const notes = [e.notes, who.length ? `For: ${who.join(', ')}` : ''].filter(Boolean).join('\n\n');
    if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
    if (e.rrule) lines.push(`RRULE:${rruleText(e.rrule)}`);
    for (const x of e.exdates || []) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${icsDay(x)}` : zone ? `EXDATE;TZID=${zone}:${wallTime(x, zone)}` : `EXDATE:${icsDate(new Date(x).toISOString())}`);
    if (e.reminder != null && e.reminder !== '') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:-PT${Number(e.reminder) || 0}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// Calendar addresses as people copy them: webcal:// is https.
function feedUrl(raw) {
  let u = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) throw new FamilyError(400, 'Enter the calendar’s iCal address (it starts with https:// or webcal://)');
  try { u = new URL(u).toString(); } catch { throw new FamilyError(400, 'That calendar address isn’t valid'); }
  return u;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

function createFamily({ dataDir, mock = false }) {
  const dir = path.join(dataDir, 'family');
  const file = path.join(dir, 'family.json');
  const photoDir = path.join(dir, 'photos');
  let data = null;
  let writing = Promise.resolve();
  const feeds = new Map(); // calendar id -> { at, url, events, error }
  let weather = null;
  // The demo starts afresh each time, with dates around today.
  if (mock) fs.rmSync(dir, { recursive: true, force: true });

  function blank() {
    const d = { rev: 1, feedToken: crypto.randomBytes(18).toString('base64url'), settings: {}, collections: {} };
    for (const c of COLLECTIONS) d.collections[c] = {};
    return d;
  }

  function load() {
    if (data) return data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; }
    if (!data || typeof data !== 'object') data = mock ? demoData() : blank();
    data.collections ||= {};
    for (const c of COLLECTIONS) data.collections[c] ||= {};
    data.settings ||= {};
    data.feedToken ||= crypto.randomBytes(18).toString('base64url');
    return data;
  }

  function persist() {
    const snapshot = JSON.stringify(data);
    writing = writing.then(async () => {
      await fsp.mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, snapshot);
      await fsp.rename(tmp, file);
    }).catch((err) => console.error(`Family Organizer: could not save (${err.message})`));
    return writing;
  }

  const publicState = () => {
    const d = load();
    return { rev: d.rev, settings: d.settings, collections: d.collections, feedToken: d.feedToken };
  };

  // What a family member (signed in, not a parent) may change, checked before anything is saved.
  // `who`: { parent, user } — MediaDesk itself and parents may change anything.
  function guardOps(ops, who) {
    const d = load();
    const me = who.user;
    for (const op of ops) {
      const id = op.op === 'delete' ? op.id : op.item?.id;
      const prev = id ? d.collections[op.col]?.[id] : null;
      // Stars for a ticked chore are always the chore's own (whoever sends them).
      if (op.col === 'chorelog' && op.op === 'put' && op.item) {
        const chore = d.collections.chores[op.item.chore];
        if (!chore) throw new FamilyError(400, 'That chore is gone');
        op.item.stars = Number(chore.stars) || 0;
      }
      if (who.parent) continue;
      if (op.col === 'chores') {
        // Their own chores, for themselves only, waiting for a parent until one approves them.
        const own = prev && prev.createdBy === me.id && prev.approved === false;
        if (prev && !own) throw new FamilyError(403, 'Only a parent can change this chore');
        if (op.op === 'put') {
          if (!me.profile) throw new FamilyError(403, 'Ask a parent to link your account to your family profile first');
          Object.assign(op.item, { members: [me.profile], approved: false, createdBy: me.id, createdByName: `${me.first} ${me.last}`.trim() });
        }
      } else if (op.col === 'chorelog') {
        if (op.op === 'put') {
          // Whoever ticks it off gets the stars (shown as done by them).
          if (me.profile) Object.assign(op.item, { member: me.profile, by: me.profile });
        } else if (prev && me.profile && ![prev.member, prev.by, prev.for].includes(me.profile)) {
          throw new FamilyError(403, 'Only whoever ticked it off (or a parent) can untick it');
        }
      } else if (op.col === 'redemptions') {
        if (op.op === 'delete' || op.item?.adjust) throw new FamilyError(403, 'Only a parent can give or take stars');
        if (!me.profile || op.item.member !== me.profile) throw new FamilyError(403, 'You can only spend your own stars');
      }
    }
  }

  function applyOps(ops, who = { parent: true }) {
    guardOps(ops, who);
    const d = load();
    const results = [];
    for (const op of ops) {
      const col = d.collections[op.col];
      if (!col) throw new FamilyError(400, `Unknown list “${op.col}”`);
      if (op.op === 'delete') {
        const old = col[op.id];
        delete col[op.id];
        if (op.col === 'photos' && old?.file) fsp.rm(path.join(photoDir, path.basename(old.file)), { force: true }).catch(() => {});
        if (op.col === 'calendars') feeds.delete(op.id);
        results.push({ id: op.id, deleted: true });
      } else if (op.op === 'put') {
        const item = op.item && typeof op.item === 'object' ? op.item : null;
        if (!item) throw new FamilyError(400, 'Nothing to save');
        const id = String(item.id || newId()).replace(/[^\w|:-]/g, '').slice(0, 80) || newId();
        const prev = col[id];
        const next = { ...item, id, updated: Date.now(), created: prev?.created || item.created || Date.now() };
        if (op.col === 'calendars') { next.url = feedUrl(next.url); if (prev?.url !== next.url) feeds.delete(id); }
        if (op.col === 'photos' && prev) next.file = prev.file;
        if (op.col === 'photos' && !prev) throw new FamilyError(400, 'Upload the photo first');
        col[id] = next;
        results.push(next);
      } else throw new FamilyError(400, 'Unknown change');
    }
    if (JSON.stringify(results).length > 4e6) throw new FamilyError(413, 'That’s too much to save at once');
    d.rev++;
    persist();
    return { rev: d.rev, results };
  }

  // Subscribed calendars, read when asked for and kept for ten minutes.
  async function feedEvents(cal, force) {
    const cached = feeds.get(cal.id);
    if (cached && cached.url === cal.url && !force && Date.now() - cached.at < FEED_CACHE_MS) return cached;
    if (mock) {
      const entry = { at: Date.now(), url: cal.url, events: demoFeed(cal) };
      feeds.set(cal.id, entry);
      return entry;
    }
    try {
      const res = await fetch(cal.url, { headers: { 'User-Agent': UA, Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(20e3), redirect: 'follow' });
      if (!res.ok) throw new Error(res.status === 404 ? 'The calendar wasn’t found at that address' : res.status === 401 || res.status === 403 ? 'The calendar is private — use its secret iCal address' : `The calendar server answered ${res.status}`);
      const text = await res.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That address isn’t an iCal calendar');
      const entry = { at: Date.now(), url: cal.url, events: parseIcs(text) };
      feeds.set(cal.id, entry);
      return entry;
    } catch (err) {
      const entry = { at: Date.now(), url: cal.url, events: cached?.url === cal.url ? cached.events : [], error: err.name === 'TimeoutError' ? 'The calendar took too long to answer' : err.message };
      feeds.set(cal.id, entry);
      return entry;
    }
  }

  async function getWeather(force) {
    const loc = load().settings.location;
    if (!loc || typeof loc.lat !== 'number') return { configured: false };
    const units = load().settings.units === 'metric' ? 'metric' : 'imperial';
    const key = `${loc.lat},${loc.lon},${units}`;
    if (weather && weather.key === key && !force && Date.now() - weather.at < WEATHER_CACHE_MS) return weather.data;
    let result;
    if (mock) result = demoWeather(units);
    else {
      const q = new URLSearchParams({
        latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: 16,
        current: 'temperature_2m,weather_code,is_day,apparent_temperature,wind_speed_10m,relative_humidity_2m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
        hourly: 'temperature_2m,weather_code,precipitation_probability',
        temperature_unit: units === 'metric' ? 'celsius' : 'fahrenheit', wind_speed_unit: units === 'metric' ? 'kmh' : 'mph',
      });
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15e3) });
      if (!res.ok) throw new FamilyError(502, 'The weather service didn’t answer');
      const w = await res.json();
      const today = w.daily?.time?.[0];
      result = {
        configured: true, place: loc.name, units,
        current: { temp: w.current?.temperature_2m, feels: w.current?.apparent_temperature, code: w.current?.weather_code, day: Boolean(w.current?.is_day), wind: w.current?.wind_speed_10m, humidity: w.current?.relative_humidity_2m },
        daily: (w.daily?.time || []).map((date, i) => ({ date, code: w.daily.weather_code[i], hi: w.daily.temperature_2m_max[i], lo: w.daily.temperature_2m_min[i], rain: w.daily.precipitation_probability_max?.[i], sunrise: w.daily.sunrise?.[i], sunset: w.daily.sunset?.[i] })),
        hourly: (w.hourly?.time || []).map((t, i) => ({ t, temp: w.hourly.temperature_2m[i], code: w.hourly.weather_code[i], rain: w.hourly.precipitation_probability?.[i] })).filter((x) => x.t.slice(0, 10) === today || x.t.slice(0, 10) === addDays(today, 1)),
      };
    }
    weather = { key, at: Date.now(), data: result };
    return result;
  }

  async function geocode(q) {
    if (mock) return [{ name: 'Springfield', region: 'Illinois, United States', lat: 39.8, lon: -89.64 }, { name: 'Portland', region: 'Oregon, United States', lat: 45.52, lon: -122.68 }];
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json' })}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10e3) });
    if (!res.ok) throw new FamilyError(502, 'The place search didn’t answer');
    const j = await res.json();
    return (j.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
  }

  async function savePhoto(req, res, url, { sendJson, readBody }) {
    const buf = await readBody(req, MAX_PHOTO).catch(() => { throw new FamilyError(413, 'Photos can be up to 25 MB'); });
    const type = sniff(buf);
    if (!PHOTO_TYPES[type]) throw new FamilyError(415, 'That isn’t a photo MediaDesk can show (use JPEG, PNG, GIF, WebP or AVIF)');
    const id = newId();
    const name = `${id}.${type}`;
    await fsp.mkdir(photoDir, { recursive: true });
    await fsp.writeFile(path.join(photoDir, name), buf);
    const item = { id, file: name, name: String(url.searchParams.get('name') || 'Photo').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80), size: buf.length, created: Date.now(), updated: Date.now() };
    if (url.searchParams.get('caption')) item.caption = url.searchParams.get('caption').slice(0, 200);
    const d = load();
    d.collections.photos[id] = item;
    d.rev++;
    await persist();
    return sendJson(res, 200, { rev: d.rev, item });
  }

  async function sendPhoto(res, name, sendJson) {
    const base = path.basename(name);
    const type = PHOTO_TYPES[path.extname(base).slice(1)];
    if (mock && base.startsWith('demo-')) return sendDemoPhoto(res, base);
    if (!type) return sendJson(res, 404, { error: 'Not found' });
    try {
      const buf = await fsp.readFile(path.join(photoDir, base));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Length': buf.length });
      return res.end(buf);
    } catch { return sendJson(res, 404, { error: 'That photo is gone' }); }
  }

  // Settings anyone signed in may change; the rest are for parents.
  const OPEN_SETTINGS = new Set(['calendarView', 'timeZone']);
  const PARENT_COLLECTIONS = new Set(['members', 'calendars']);

  // ctx: { portal: signed in to MediaDesk, ip }
  async function handle(req, res, url, { sendJson, readJson, readBody, portal = false, ip = '' }) {
    const p = url.pathname.replace(/^\/portal\/family/, '') || '/';
    try {
      if (p.startsWith('/auth/')) {
        const done = await auth.route(req, res, p, { portal, ip }, { sendJson, readJson });
        if (done === null) return sendJson(res, 404, { error: 'Not found' });
        return done;
      }
      const me = auth.userFromReq(req);
      if (!portal && !me) return sendJson(res, 401, { error: 'Sign in to the Family Organizer', signin: true });
      const parent = portal || me.role === 'parent';
      const needParent = () => { if (!parent) throw new FamilyError(403, 'Only a parent can change that'); };
      if (p === '/data' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since'));
        if (since && since === load().rev) return sendJson(res, 200, { rev: since, same: true });
        return sendJson(res, 200, publicState());
      }
      if (p === '/batch' && req.method === 'POST') {
        const body = await readJson(req);
        if (!Array.isArray(body.ops) || !body.ops.length) throw new FamilyError(400, 'Nothing to change');
        if (body.ops.some((o) => PARENT_COLLECTIONS.has(o.col))) needParent();
        return sendJson(res, 200, applyOps(body.ops, { parent, user: me }));
      }
      if (p === '/settings' && req.method === 'POST') {
        const body = await readJson(req);
        if (Object.keys(body || {}).some((k) => !OPEN_SETTINGS.has(k))) needParent();
        const d = load();
        for (const [k, v] of Object.entries(body || {})) { if (v === null) delete d.settings[k]; else d.settings[k] = v; }
        d.rev++;
        await persist();
        return sendJson(res, 200, { rev: d.rev, settings: d.settings });
      }
      if (p === '/feed-token' && req.method === 'POST') {
        needParent();
        const d = load();
        d.feedToken = crypto.randomBytes(18).toString('base64url');
        d.rev++;
        await persist();
        return sendJson(res, 200, { rev: d.rev, feedToken: d.feedToken });
      }
      if (p === '/feeds' && req.method === 'GET') {
        const force = url.searchParams.get('refresh') === '1';
        const cals = Object.values(load().collections.calendars).filter((c) => c.enabled !== false);
        const list = await Promise.all(cals.map(async (c) => {
          const f = await feedEvents(c, force);
          return { id: c.id, at: f.at, error: f.error || null, events: f.events };
        }));
        return sendJson(res, 200, { feeds: list });
      }
      if (p === '/check-feed' && req.method === 'POST') {
        needParent();
        const body = await readJson(req);
        const f = await feedEvents({ id: `check-${newId()}`, url: feedUrl(body.url) }, true);
        if (f.error) throw new FamilyError(400, f.error);
        return sendJson(res, 200, { ok: true, count: f.events.length });
      }
      if (p === '/parse-ics' && req.method === 'POST') {
        const text = (await readBody(req, 8 * 1024 * 1024)).toString('utf8');
        if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text)) throw new FamilyError(400, 'That isn’t an iCal (.ics) file');
        return sendJson(res, 200, { events: parseIcs(text) });
      }
      if (p === '/family.ics' && req.method === 'GET') return sendFeed(res);
      if (p === '/weather' && req.method === 'GET') return sendJson(res, 200, await getWeather(url.searchParams.get('refresh') === '1'));
      if (p === '/geocode' && req.method === 'GET') return sendJson(res, 200, { places: await geocode(String(url.searchParams.get('q') || '').slice(0, 80)) });
      if (p === '/photos' && req.method === 'POST') return await savePhoto(req, res, url, { sendJson, readBody });
      if (p.startsWith('/photos/') && req.method === 'GET') return await sendPhoto(res, decodeURIComponent(p.slice(8)), sendJson);
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'That request wasn’t understood' });
      return sendJson(res, err.status || 500, { error: err.message || 'Something went wrong' });
    }
  }

  function sendFeed(res) {
    const d = load();
    const events = Object.values(d.collections.events).filter((e) => !e.private);
    const body = buildIcs(events, Object.values(d.collections.members), d.settings.familyName ? `${d.settings.familyName} Family` : 'Family', d.settings.timeZone);
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="family.ics"' });
    res.end(body);
  }

  // The family's private calendar address for phones and other calendar apps: anyone with the
  // address can read the family's events (not change them), so it can be replaced in Settings.
  function feed(req, res, p, { sendJson }) {
    const m = /^\/family-feed\/([\w-]{16,})\/[^/]*$/.exec(p);
    const d = load();
    if (!m || m[1].length !== d.feedToken.length || !crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(d.feedToken))) return sendJson(res, 404, { error: 'Not found' });
    return sendFeed(res);
  }

  const auth = createFamilyAuth({ load, persist });
  if (mock) auth.seedDemo().catch(() => {});

  return { handle, feed };
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

function demoData() {
  const d = { rev: 1, feedToken: 'demo-family-feed-token-0001', settings: { familyName: 'Rivera', location: { name: 'Springfield', lat: 39.8, lon: -89.64 }, units: 'imperial', weekStart: 0 }, collections: {} };
  for (const c of COLLECTIONS) d.collections[c] = {};
  const put = (col, item) => { d.collections[col][item.id] = { created: Date.now(), updated: Date.now(), ...item }; };
  const members = [
    { id: 'm-mom', name: 'Maria', color: '#e8590c', emoji: '👩', role: 'parent' },
    { id: 'm-dad', name: 'Daniel', color: '#1c7ed6', emoji: '👨', role: 'parent' },
    { id: 'm-emma', name: 'Emma', color: '#ae3ec9', emoji: '👧', role: 'kid' },
    { id: 'm-leo', name: 'Leo', color: '#2f9e44', emoji: '👦', role: 'kid' },
  ];
  members.forEach((m, i) => put('members', { ...m, order: i }));
  const today = new Date();
  const day = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
  const ymd = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  const at = (n, h, m = 0) => { const x = day(n); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const dow = today.getDay();
  const ev = (id, title, start, end, extra = {}) => put('events', { id, title, start, end, allDay: false, members: [], ...extra });
  ev('e-standup', 'Work standup', at(-dow + 1, 9), at(-dow + 1, 9, 30), { members: ['m-dad'], rrule: { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] } });
  ev('e-soccer', 'Soccer practice', at(-dow + 2, 16, 30), at(-dow + 2, 18), { members: ['m-leo'], location: 'Lincoln Park field 3', rrule: { freq: 'weekly', interval: 1, byday: ['TU', 'TH'] } });
  ev('e-piano', 'Piano lesson', at(-dow + 3, 15, 45), at(-dow + 3, 16, 30), { members: ['m-emma'], rrule: { freq: 'weekly', interval: 1 } });
  ev('e-dentist', 'Dentist — Emma & Leo', at(1, 10), at(1, 11), { members: ['m-emma', 'm-leo', 'm-mom'], location: 'Bright Smiles Dental', reminder: 60 });
  ev('e-yoga', 'Yoga', at(0, 7), at(0, 8), { members: ['m-mom'] });
  ev('e-date', 'Date night 🍝', at(3, 19), at(3, 22), { members: ['m-mom', 'm-dad'] });
  ev('e-bday', 'Grandma’s birthday 🎂', ymd(day(9)), ymd(day(9)), { allDay: true, members: [], countdown: true });
  ev('e-trip', 'Camping trip ⛺', ymd(day(16)), ymd(day(18)), { allDay: true, members: members.map((m) => m.id), countdown: true });
  ev('e-recital', 'Spring recital', at(6, 18), at(6, 19, 30), { members: ['m-emma'], location: 'School auditorium', countdown: true });
  ev('e-trash', 'Trash day', ymd(day(-dow + 3)), ymd(day(-dow + 3)), { allDay: true, rrule: { freq: 'weekly', interval: 1 } });
  put('calendars', { id: 'c-school', name: 'School calendar', url: 'https://example.com/school.ics', color: '#f08c00', members: ['m-emma', 'm-leo'], enabled: true });

  const chore = (id, title, emoji, members, extra = {}) => put('chores', { id, title, emoji, members, stars: 1, repeat: { kind: 'daily' }, kind: 'chore', part: 'anytime', ...extra });
  chore('ch-bed', 'Make your bed', '🛏️', ['m-emma', 'm-leo'], { kind: 'routine', part: 'morning', order: 1 });
  chore('ch-teeth-am', 'Brush teeth', '🪥', ['m-emma', 'm-leo'], { kind: 'routine', part: 'morning', order: 2 });
  chore('ch-dress', 'Get dressed', '👕', ['m-emma', 'm-leo'], { kind: 'routine', part: 'morning', order: 3 });
  chore('ch-backpack', 'Pack backpack', '🎒', ['m-emma', 'm-leo'], { kind: 'routine', part: 'morning', order: 4, repeat: { kind: 'weekly', days: [1, 2, 3, 4, 5] } });
  chore('ch-homework', 'Homework', '📚', ['m-emma', 'm-leo'], { kind: 'routine', part: 'afternoon', order: 1, repeat: { kind: 'weekly', days: [1, 2, 3, 4] } });
  chore('ch-pjs', 'Pajamas on', '🌙', ['m-emma', 'm-leo'], { kind: 'routine', part: 'evening', order: 1 });
  chore('ch-teeth-pm', 'Brush teeth', '🪥', ['m-emma', 'm-leo'], { kind: 'routine', part: 'evening', order: 2 });
  chore('ch-dog', 'Feed the dog', '🐶', ['m-leo'], { stars: 2 });
  chore('ch-dish', 'Empty dishwasher', '🍽️', ['m-emma'], { stars: 2 });
  chore('ch-plants', 'Water the plants', '🪴', ['m-emma'], { repeat: { kind: 'weekly', days: [0, 3] } });
  chore('ch-room', 'Tidy your room', '🧸', ['m-emma', 'm-leo'], { stars: 3, repeat: { kind: 'weekly', days: [6] } });
  chore('ch-laundry', 'Fold laundry', '🧺', ['m-mom'], { stars: 0, repeat: { kind: 'weekly', days: [0, 4] } });
  chore('ch-bins', 'Take out the bins', '🗑️', ['m-dad'], { stars: 0, repeat: { kind: 'weekly', days: [2] } });
  chore('ch-car', 'Wash the car', '🚗', [], { stars: 5, repeat: { kind: 'once', date: ymd(day(2)) } });
  for (let n = -6; n <= 0; n++) for (const [c, m] of [['ch-bed', 'm-emma'], ['ch-teeth-am', 'm-emma'], ['ch-dog', 'm-leo'], ['ch-bed', 'm-leo'], ['ch-dish', 'm-emma']]) {
    if (n === 0 && c !== 'ch-bed') continue;
    if ((n + c.length) % 4 === 0) continue;
    const date = ymd(day(n));
    put('chorelog', { id: `${c}|${m}|${date}`, chore: c, member: m, date, stars: d.collections.chores[c].stars });
  }
  put('rewards', { id: 'r-movie', title: 'Pick the family movie', emoji: '🎬', stars: 10, members: [] });
  put('rewards', { id: 'r-ice', title: 'Ice cream trip', emoji: '🍦', stars: 20, members: [] });
  put('rewards', { id: 'r-late', title: 'Stay up 30 minutes late', emoji: '⏰', stars: 15, members: ['m-emma'] });
  put('rewards', { id: 'r-lego', title: 'New LEGO set', emoji: '🧱', stars: 60, members: ['m-leo'] });

  put('lists', { id: 'l-grocery', title: 'Groceries', emoji: '🛒', color: '#2f9e44', kind: 'grocery', order: 0 });
  put('lists', { id: 'l-todo', title: 'Family to-dos', emoji: '✅', color: '#1c7ed6', kind: 'todo', order: 1 });
  put('lists', { id: 'l-camp', title: 'Camping packing list', emoji: '⛺', color: '#e8590c', kind: 'todo', order: 2 });
  const item = (list, text, extra = {}) => put('listitems', { id: newId(), list, text, done: false, order: Date.now() + Math.random(), ...extra });
  ['Bananas', 'Baby spinach', 'Milk', 'Greek yogurt', 'Chicken thighs', 'Sourdough bread', 'Frozen peas', 'Pasta', 'Dish soap'].forEach((t) => item('l-grocery', t));
  item('l-grocery', 'Eggs', { done: true });
  item('l-todo', 'Sign permission slip', { member: 'm-mom' });
  item('l-todo', 'Book summer camp', { member: 'm-dad' });
  item('l-todo', 'Return library books', { member: 'm-emma' });
  ['Tent', 'Sleeping bags', 'Flashlights', 'Marshmallows', 'Bug spray'].forEach((t) => item('l-camp', t));

  const recipes = [
    { id: 'rc-tacos', title: 'Sheet-pan chicken tacos', emoji: '🌮', minutes: 35, servings: 4, ingredients: ['1.5 lb chicken thighs', '2 bell peppers', '1 onion', '2 tbsp taco seasoning', '8 tortillas', 'Salsa', 'Sour cream'], steps: 'Slice the chicken, peppers and onion. Toss with oil and seasoning.\nRoast at 425°F for 20–25 minutes.\nServe in warm tortillas with salsa and sour cream.', tags: ['Dinner', 'Kid favourite'] },
    { id: 'rc-pasta', title: 'Spinach pesto pasta', emoji: '🍝', minutes: 20, servings: 4, ingredients: ['1 lb pasta', '1 jar pesto', '2 cups baby spinach', 'Parmesan', 'Cherry tomatoes'], steps: 'Cook the pasta.\nStir in pesto and spinach until wilted.\nTop with tomatoes and parmesan.', tags: ['Dinner', 'Vegetarian', 'Quick'] },
    { id: 'rc-pancakes', title: 'Banana pancakes', emoji: '🥞', minutes: 25, servings: 4, ingredients: ['2 bananas', '2 eggs', '1 cup flour', '1 cup milk', '1 tsp baking powder', 'Maple syrup'], steps: 'Mash the bananas, whisk in the eggs and milk.\nFold in flour and baking powder.\nCook on a buttered pan, 2 minutes a side.', tags: ['Breakfast'] },
    { id: 'rc-soup', title: 'Chicken noodle soup', emoji: '🍲', minutes: 45, servings: 6, ingredients: ['1 lb chicken breast', '3 carrots', '3 celery stalks', '1 onion', '8 cups chicken broth', '2 cups egg noodles'], steps: 'Soften the vegetables.\nAdd broth and chicken, simmer 20 minutes.\nShred the chicken, add noodles and cook 8 minutes.', tags: ['Dinner', 'Comfort'] },
    { id: 'rc-wraps', title: 'Turkey hummus wraps', emoji: '🌯', minutes: 10, servings: 4, ingredients: ['4 tortillas', '8 oz sliced turkey', 'Hummus', 'Lettuce', 'Cucumber'], steps: 'Spread hummus, layer turkey and vegetables, roll up.', tags: ['Lunch', 'Quick'] },
  ];
  recipes.forEach((r) => put('recipes', r));
  const meal = (n, slot, recipe, title) => put('meals', { id: newId(), date: ymd(day(n)), slot, recipe, title: title || recipes.find((r) => r.id === recipe)?.title });
  meal(0, 'dinner', 'rc-tacos'); meal(1, 'dinner', 'rc-pasta'); meal(2, 'dinner', 'rc-soup'); meal(3, 'dinner', null, 'Takeout night 🍕');
  meal(0, 'breakfast', 'rc-pancakes'); meal(1, 'lunch', 'rc-wraps'); meal(5, 'dinner', 'rc-tacos');
  for (let i = 1; i <= 6; i++) put('photos', { id: `p-demo${i}`, file: `demo-${i}.svg`, name: `Demo photo ${i}`, created: Date.now() - i * 1e6 });
  return d;
}

function demoFeed() {
  const today = new Date();
  const ymd = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const at = (n, h) => { const x = new Date(today); x.setDate(x.getDate() + n); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  return [
    { id: 'f-early', uid: 'f-early', title: 'Early dismissal', allDay: true, start: ymd(4), end: ymd(4) },
    { id: 'f-picture', uid: 'f-picture', title: 'School picture day 📸', allDay: true, start: ymd(8), end: ymd(8) },
    { id: 'f-break', uid: 'f-break', title: 'Spring break', allDay: true, start: ymd(20), end: ymd(24) },
    { id: 'f-pta', uid: 'f-pta', title: 'PTA meeting', allDay: false, start: at(2, 18), end: at(2, 19), location: 'Library' },
  ];
}

function demoWeather(units) {
  const today = new Date();
  const base = units === 'metric' ? 14 : 58;
  const codes = [1, 2, 3, 61, 0, 2, 80, 1, 0, 3, 61, 2, 1, 0, 95, 2];
  const daily = codes.map((code, i) => {
    const x = new Date(today); x.setDate(x.getDate() + i);
    const hi = base + Math.round(Math.sin(i / 2) * 6);
    return { date: `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`, code, hi, lo: hi - (units === 'metric' ? 8 : 14), rain: code >= 60 ? 70 : 10 };
  });
  const hourly = [];
  for (let hr = 0; hr < 48; hr++) {
    const x = new Date(today); x.setHours(hr, 0, 0, 0);
    hourly.push({ t: `${daily[hr < 24 ? 0 : 1].date}T${pad(hr % 24)}:00`, temp: base - 6 + Math.round(Math.sin((hr % 24 - 8) / 24 * Math.PI * 2) * 6), code: hr % 24 < 6 || hr % 24 > 20 ? 0 : 2, rain: 10 });
  }
  return { configured: true, place: 'Springfield', units, current: { temp: base, feels: base - 2, code: 2, day: true, wind: 8, humidity: 55 }, daily, hourly };
}

// Demo photos: soft landscapes drawn as SVG, so the photo frame has something to show.
function sendDemoPhoto(res, name) {
  const i = Number(/demo-(\d+)/.exec(name)?.[1]) || 1;
  const sets = [['#ffb88c', '#de6262', '#3a1c71'], ['#a1c4fd', '#c2e9fb', '#2b5876'], ['#f6d365', '#fda085', '#6a3093'], ['#84fab0', '#8fd3f4', '#134e5e'], ['#fbc2eb', '#a6c1ee', '#41295a'], ['#ffecd2', '#fcb69f', '#5f2c82']];
  const [a, b, c] = sets[(i - 1) % sets.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#s)"/><circle cx="${300 + i * 170}" cy="${330 - i * 12}" r="110" fill="#fff" opacity=".7"/><path d="M0 720 Q 300 ${520 + i * 20} 640 680 T 1600 ${600 + i * 15} V1000 H0Z" fill="${c}" opacity=".55"/><path d="M0 820 Q 420 ${700 - i * 10} 860 820 T 1600 780 V1000 H0Z" fill="${c}" opacity=".85"/></svg>`;
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
  res.end(svg);
}

module.exports = { createFamily, parseIcs, buildIcs, parseRrule, FamilyError };
