// Trip Planner: shared bits: dates, place kinds, booking kinds, money (in whole cents), distances,
// route ordering, weather symbols, navigation links and dialogs.

import { h, clear } from '../../ui.js';

// --- Dates -----------------------------------------------------------------------------------
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
export const dayDiff = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 864e5);
export function tripDays(trip) {
  if (!trip.start) return [];
  const out = [];
  for (let d = trip.start; d <= (trip.end || trip.start) && out.length < 120; d = addDays(d, 1)) out.push(d);
  return out;
}
export const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, opts);
export const fmtTime = (s) => (s && s.length > 10 ? new Date(s.length === 16 ? `${s}:00` : s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
export const fmtRange = (a, b) => {
  if (!a) return 'No dates yet';
  const sameYear = !b || a.slice(0, 4) === b.slice(0, 4);
  const A = fmtDay(a, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return b && b !== a ? `${A} – ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}` : fmtDay(a, { day: 'numeric', month: 'short', year: 'numeric' });
};
export function countdown(trip) {
  if (!trip.start) return '';
  const t = today();
  if (t < trip.start) { const n = dayDiff(t, trip.start); return n === 1 ? 'Tomorrow' : `In ${n} days`; }
  if (t <= (trip.end || trip.start)) return `Day ${dayDiff(trip.start, t) + 1} of ${dayDiff(trip.start, trip.end || trip.start) + 1}`;
  return 'Done';
}
export const fmtMins = (sec) => { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
export const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

// --- Places ------------------------------------------------------------------------------------
export const CATEGORIES = {
  sights: ['Sights', '🏛️', '#7048e8'], museum: ['Museum', '🖼️', '#ae3ec9'], viewpoint: ['Viewpoint', '🌄', '#1098ad'], park: ['Nature', '🌳', '#2f9e44'],
  food: ['Food', '🍽️', '#e8590c'], cafe: ['Café', '☕', '#a0522d'], nightlife: ['Nightlife', '🍸', '#c2255c'], shopping: ['Shopping', '🛍️', '#d6336c'],
  hotel: ['Stay', '🛏️', '#364fc7'], transport: ['Transport', '🚉', '#495057'], activity: ['Activity', '🎟️', '#f08c00'], other: ['Place', '📍', '#1c7ed6'],
};
export const catOf = (c) => CATEGORIES[c] || CATEGORIES.other;
export const DAY_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#4263eb', '#868e96', '#c2255c', '#5c940d', '#1098ad'];

// --- Bookings ------------------------------------------------------------------------------------
export const BOOKING_TYPES = {
  flight: ['Flight', '✈️', true], train: ['Train', '🚆', true], bus: ['Bus', '🚌', true], ferry: ['Ferry', '⛴️', true], car: ['Car rental', '🚗', false], transfer: ['Taxi / transfer', '🚕', true],
  hotel: ['Hotel', '🏨', false], apartment: ['Apartment', '🏠', false], camping: ['Camping', '⛺', false], hostel: ['Hostel', '🛏️', false],
  restaurant: ['Restaurant', '🍽️', false], event: ['Event', '🎭', false], tour: ['Tour', '🧭', false], activity: ['Activity', '🎟️', false], museum: ['Museum / tickets', '🖼️', false],
  insurance: ['Insurance', '🛡️', false], parking: ['Parking', '🅿️', false], other: ['Other', '📄', false],
};
export const STAYS = new Set(['hotel', 'apartment', 'camping', 'hostel']);
export const bookingType = (t) => BOOKING_TYPES[t] || BOOKING_TYPES.other;
export const STATUS = { confirmed: ['Confirmed', '#2f9e44'], pending: ['Pending', '#f08c00'], cancelled: ['Cancelled', '#868e96'] };

// --- Money: whole cents, so shares always add up -------------------------------------------------
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'TRY', 'MXN', 'BRL', 'CNY', 'HKD', 'SGD', 'THB', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'ZAR', 'ILS', 'ISK'];
const NO_DECIMALS = new Set(['JPY', 'KRW', 'HUF', 'ISK', 'IDR']);
export const money = (amount, cur) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: NO_DECIMALS.has(cur) ? 0 : 2 }).format(amount); } catch { return `${amount.toFixed(2)} ${cur}`; }
};
export const cents = (x) => Math.round(Number(x || 0) * 100);
// Split a whole number of cents by weights; the left-over cents go to the largest shares first.
export function splitCents(total, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = entries.reduce((a, [, w]) => a + w, 0);
  if (!sum) return {};
  const out = {};
  let given = 0;
  const rem = [];
  for (const [k, w] of entries) { const exact = (total * w) / sum; out[k] = Math.floor(exact); given += out[k]; rem.push([k, exact - out[k]]); }
  rem.sort((a, b) => b[1] - a[1]);
  for (let i = 0; given < total && i < rem.length; i++, given++) out[rem[i % rem.length][0]]++;
  return out;
}
// What each person paid and owes for an expense, in the trip's currency (cents).
export function expenseParts(e) {
  const total = cents(Number(e.amount) * (Number(e.rate) || 1));
  const paidRaw = e.paidBy || {};
  const paidTotal = Object.values(paidRaw).reduce((a, v) => a + Number(v || 0), 0) || 1;
  const paid = splitCents(total, Object.fromEntries(Object.entries(paidRaw).map(([k, v]) => [k, Number(v) / paidTotal])));
  let owed;
  if (e.split === 'amounts') {
    const asCents = Object.fromEntries(Object.entries(e.shares || {}).map(([k, v]) => [k, cents(Number(v) * (Number(e.rate) || 1))]));
    owed = splitCents(total, asCents);
  } else owed = splitCents(total, Object.fromEntries(Object.entries(e.shares || {}).map(([k, v]) => [k, Number(v) || 0])));
  return { total, paid, owed };
}
// Balances (cents, + is owed money) and the fewest payments that settle them.
export function balances(store) {
  const bal = Object.fromEntries(store.trip.members.map((m) => [m.id, 0]));
  for (const e of store.all('expenses')) {
    const { paid, owed } = expenseParts(e);
    for (const [k, v] of Object.entries(paid)) bal[k] = (bal[k] || 0) + v;
    for (const [k, v] of Object.entries(owed)) bal[k] = (bal[k] || 0) - v;
  }
  for (const s of store.all('settlements')) { bal[s.from] = (bal[s.from] || 0) + cents(s.amount); bal[s.to] = (bal[s.to] || 0) - cents(s.amount); }
  return bal;
}
export function settleUp(bal) {
  const debtors = Object.entries(bal).filter(([, v]) => v < 0).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i][1], creditors[j][1]);
    if (amt > 0) out.push({ from: debtors[i][0], to: creditors[j][0], cents: amt });
    debtors[i][1] -= amt;
    creditors[j][1] -= amt;
    if (!debtors[i][1]) i++;
    if (!creditors[j][1]) j++;
  }
  return out;
}

// --- Distances and route order ------------------------------------------------------------------
export function haversine(a, b) {
  const R = 6371e3;
  const r = (x) => (x * Math.PI) / 180;
  const dl = r(b.lat - a.lat);
  const dn = r(b.lon - a.lon);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2));
}
// The shortest order through stops: nearest neighbour, then 2-opt. Locked stops keep their place
// in the list; the first stop is where the day starts.
export function optimiseOrder(stops) {
  const n = stops.length;
  if (n < 3) return stops.map((_, i) => i);
  const fixed = new Map(stops.map((s, i) => [i, s.locked || i === 0]).filter(([, f]) => f));
  const free = stops.map((_, i) => i).filter((i) => !fixed.has(i));
  // Order the free stops, starting from the first stop.
  const order = [];
  const left = new Set(free);
  let cur = 0;
  while (left.size) {
    let best = null;
    for (const k of left) if (best == null || haversine(stops[cur], stops[k]) < haversine(stops[cur], stops[best])) best = k;
    order.push(best);
    left.delete(best);
    cur = best;
  }
  const len = (o) => { let s = 0; let p = 0; for (const k of o) { s += haversine(stops[p], stops[k]); p = k; } return s; };
  let improved = true;
  for (let pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (let a = 0; a < order.length - 1; a++) {
      for (let b = a + 1; b < order.length; b++) {
        const next = [...order.slice(0, a), ...order.slice(a, b + 1).reverse(), ...order.slice(b + 1)];
        if (len(next) < len(order) - 1) { order.splice(0, order.length, ...next); improved = true; }
      }
    }
  }
  // Put the locked stops back where they were, and the rest in order around them.
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) out.push(fixed.has(i) ? i : order[k++]);
  return out;
}

// --- Weather (WMO codes, as Open-Meteo gives them) --------------------------------------------------
export function weatherIcon(code) {
  if (code == null) return '';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

// --- Navigating to a place, in the app of your choice ----------------------------------------------
export function navLinks(p) {
  const ll = `${p.lat},${p.lon}`;
  const name = encodeURIComponent(p.name || '');
  return [
    ['Google Maps', `https://www.google.com/maps/dir/?api=1&destination=${ll}`],
    ['Apple Maps', `https://maps.apple.com/?daddr=${ll}&q=${name}`],
    ['Waze', `https://waze.com/ul?ll=${ll}&navigate=yes`],
    ['OpenStreetMap', `https://www.openstreetmap.org/directions?to=${ll}`],
    ['Citymapper', `https://citymapper.com/directions?endcoord=${ll}&endname=${name}`],
    ['HERE WeGo', `https://wego.here.com/directions/mix//${name}:${ll}`],
    ['Organic Maps / CoMaps', `geo:${ll}?q=${ll}(${name})`],
  ];
}
// A day's places as Google Maps directions (up to 10 stops).
export function googleDirections(points, mode = 'car') {
  if (points.length < 1) return null;
  const pts = points.slice(0, 10).map((p) => `${p.lat},${p.lon}`);
  const travel = { car: 'driving', foot: 'walking', bike: 'bicycling', transit: 'transit' }[mode] || 'driving';
  const q = new URLSearchParams({ api: '1', origin: pts[0], destination: pts[pts.length - 1], travelmode: travel });
  if (pts.length > 2) q.set('waypoints', pts.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}

// --- Pieces of the interface --------------------------------------------------------------------
export function avatar(m, size = 24) {
  if (!m) return null;
  return h('span', { class: 'tp-avatar', title: m.name, style: { '--c': m.color || '#868e96', width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.46)}px` } }, (m.name || '?').slice(0, 1).toUpperCase());
}
// A dialog over the app; resolves to the value given to close() (null when dismissed).
export function sheet(host, { title, body, actions = [], wide = false, cls = '' }) {
  let done;
  const result = new Promise((r) => { done = r; });
  const close = (v = null) => { overlay.remove(); window.removeEventListener('keydown', onKey, true); done(v); };
  const onKey = (e) => { if (e.key === 'Escape' && host.lastElementChild === overlay) { e.stopPropagation(); close(null); } };
  window.addEventListener('keydown', onKey, true);
  const form = h('form', { class: `tp-sheet ${wide ? 'wide' : ''} ${cls}`, onsubmit: (e) => { e.preventDefault(); const a = actions.find((x) => x?.submit); a?.onClick ? a.onClick(close) : close(a?.value ?? true); } },
    h('div', { class: 'tp-sheet-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
    h('div', { class: 'tp-sheet-body' }, body),
    actions.length ? h('div', { class: 'tp-sheet-actions' }, actions.map((a) => a && h('button', { type: a.submit ? 'submit' : 'button', class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.left ? 'tp-left' : ''}`, onclick: a.submit ? null : () => (a.onClick ? a.onClick(close) : close(a.value ?? null)) }, a.label))) : null);
  const overlay = h('div', { class: 'tp-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, form);
  host.append(overlay);
  requestAnimationFrame(() => form.querySelector('[autofocus]')?.focus());
  result.close = close;
  result.el = form;
  return result;
}
// A labelled control. Groups of buttons or several controls go in a div: in a <label>, a click on
// one of them would also be passed to the label's first button.
export const field = (label, control, hint) => h(control instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div', { class: 'tp-field' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
export const input = (attrs = {}) => h('input', { class: 'input', ...attrs });
export const select = (options, value, attrs = {}) => h('select', { class: 'input', ...attrs }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
export const textarea = (value, attrs = {}) => h('textarea', { class: 'input', rows: 3, ...attrs }, value || '');
// Choose people (the trip's members).
export function peoplePicker(members, selected = [], { single = false, onChange } = {}) {
  const sel = new Set(selected);
  const row = h('div', { class: 'tp-people' });
  const draw = () => clear(row, members.map((m) => h('button', { type: 'button', class: `tp-person ${sel.has(m.id) ? 'on' : ''}`, style: { '--c': m.color }, onclick: () => { if (single) { sel.clear(); sel.add(m.id); } else if (sel.has(m.id)) sel.delete(m.id); else sel.add(m.id); draw(); onChange?.([...sel]); } }, avatar(m, 20), m.name)));
  draw();
  row.value = () => [...sel];
  return row;
}
export function emptyState(emoji, text, ...extra) { return h('div', { class: 'tp-empty' }, h('div', { class: 'tp-empty-emoji' }, emoji), h('p', {}, text), ...extra); }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
