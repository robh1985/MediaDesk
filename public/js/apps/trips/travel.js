// Trip Planner: getting from place to place. The plan's menu starts with where the trip begins;
// before each destination comes the journey there. A flight shows the airport you leave from, with
// driving directions to it; a road trip has driving directions to the next destination, drawn on
// the map, and a search for hotels, sights, food, fuel and more along the route.

import { h, clear } from '../../ui.js';
import { geo } from './store.js';
import { airportByCode, nearestAirport } from './bookings.js';
import { TRAVEL, travelSummary, directionsLink, units, fmtKm, fmtMins, fmtDay, haversine, tripDays, esc } from './util.js';

// What to look for along a road trip.
export const ALONG = {
  hotel: ['Hotels', '🛏️'], camping: ['Camping', '⛺'], sights: ['Attractions', '🏛️'], food: ['Food', '🍽️'], cafe: ['Cafés', '☕'], viewpoint: ['Viewpoints', '🌄'],
  park: ['Nature', '🌳'], museum: ['Museums', '🖼️'], fuel: ['Fuel', '⛽'], charging: ['EV charging', '🔌'], rest: ['Rest areas', '🅿️'],
};
const PLACE_WORD = { train: 'station', bus: 'bus stop', ferry: 'port', boat: 'pier' };

// Where a journey to destination i starts: the trip's starting point, or the destination before.
export const legFrom = (view, i) => (i ? view.dests()[i - 1] : view.trip.origin || null);

export function originCard(view) {
  const o = view.trip.origin;
  if (!o) return null;
  return h('div', { class: 'tp-origin' },
    h('span', { class: 'tp-origin-icon', 'aria-hidden': 'true' }, '🏠'),
    h('span', { class: 'tp-dest-title' }, h('small', {}, 'Starting from'), h('b', {}, o.name)),
    Number.isFinite(o.lat) ? h('button', { class: 'tp-icon-btn', title: 'Show on the map', 'aria-label': `Show ${o.name} on the map`, onclick: () => view.map?.setView([o.lat, o.lon], 11) }, '📍') : null);
}

// The airport a flight leaves from: the one chosen, or the nearest international one.
async function departingAirport(view, x, from) {
  const t = x.travel;
  const key = `${t.fromAirport || ''}|${from?.lat},${from?.lon}`;
  view.airports ||= new Map();
  if (view.airports.has(key)) return view.airports.get(key);
  view.airports.set(key, null);
  const a = t.fromAirport ? await airportByCode(t.fromAirport) : await nearestAirport(from);
  const out = a ? { ...a, guessed: !t.fromAirport } : null;
  view.airports.set(key, out);
  if (out) view.drawSideOnly();
  return out;
}

// Where a route starts and ends, to tell whether a saved one still fits the journey.
const placeKey = (p) => (Number.isFinite(p?.lat) ? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : '');

// A route line with fewer points (Douglas–Peucker), so it's small enough to keep with the trip.
function simplify(line, tolerance = 0.0004, max = 1000) {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let far = -1;
    let fd = tolerance;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (line[i][0] - ax) - dx * (line[i][1] - ay)) / len; if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out = line.filter((_, i) => keep[i]);
  return out.length > max ? simplify(line, tolerance * 2, max) : out;
}

// A journey's route: one being worked out now, or the one kept with the trip if it still goes
// from and to the same places.
function legState(view, x, from, to) {
  view.legs ||= new Map();
  const live = view.legs.get(x.id);
  if (live) return live;
  const saved = view.trip.legRoutes?.[x.id];
  if (!saved || saved.fromKey !== placeKey(from)) return {};
  if (to && saved.toKey !== placeKey(to)) return {};
  return { route: saved, to: saved.to, saved: true };
}

export function legCard(view, x, i) {
  const from = legFrom(view, i);
  const t = x.travel;
  if (!t?.mode) {
    if (!from) return null;
    return h('div', { class: 'tp-legcard empty' },
      h('span', { class: 'tp-legcard-route' }, `${from.name} → ${x.name}`),
      h('button', { class: 'btn btn-sm', onclick: () => view.app.settingsDialog() }, 'How are you getting there?'));
  }
  const [label, emoji] = TRAVEL[t.mode];
  // Where the route goes: the airport (once it's known) or the destination.
  const airport = t.mode === 'flight' ? view.airports?.get(`${t.fromAirport || ''}|${from?.lat},${from?.lon}`) : null;
  const st = legState(view, x, from, t.mode === 'car' ? x : airport || null);
  const body = [];
  const located = (p) => p && Number.isFinite(p.lat);
  const routeLine = (what) => (st.route
    ? h('div', { class: 'tp-legcard-result' }, h('b', {}, `🚗 ${fmtMins(st.route.duration)} · ${fmtKm(st.route.distance)}`), h('span', { class: 'muted small' }, ` ${what}`),
      h('a', { class: 'tp-legcard-link', href: directionsLink(from, st.to, 'driving', t), target: '_blank', rel: 'noopener' }, 'Open in Google Maps ↗'),
      h('button', { class: 'tp-icon-btn', title: 'Clear the route', 'aria-label': 'Clear the route', onclick: () => clearRoute(view, x) }, '✕'))
    : st.loading ? h('div', { class: 'muted small' }, 'Working out the route…') : st.error ? h('div', { class: 'tp-error small' }, st.error) : null);

  if (t.mode === 'flight') {
    const a = located(from) || t.fromAirport ? (view.airports?.get(`${t.fromAirport || ''}|${from?.lat},${from?.lon}`) ?? (departingAirport(view, x, from), null)) : null;
    body.push(a
      ? h('div', { class: 'tp-legcard-line' }, '🛫 ', h('b', {}, a.iata), ` ${a.name}`, a.guessed ? h('small', { class: 'muted' }, ' (nearest — choose another in Trip settings)') : null)
      : h('div', { class: 'tp-legcard-line muted small' }, t.fromAirport ? `🛫 ${t.fromAirport}` : 'Choose the airport in Trip settings'));
    if (a && from) {
      if (t.airportBy === 'transit') body.push(h('a', { class: 'btn btn-sm', href: directionsLink(from, a, 'transit'), target: '_blank', rel: 'noopener' }, `🚆 Public transport to ${a.iata} ↗`));
      else if (!st.route) body.push(h('button', { class: 'btn btn-sm', disabled: !located(from) || st.loading, onclick: () => directions(view, x, from, a) }, `🚗 Driving directions to ${a.iata}`));
      body.push(routeLine(`from ${from.name} to the airport`));
    }
  } else if (t.mode === 'car') {
    if (!st.route) body.push(h('button', { class: 'btn btn-sm', disabled: !located(from) || !located(x) || st.loading, title: located(from) ? '' : 'Choose where the trip starts in Trip settings', onclick: () => directions(view, x, from, x) }, `🚗 Driving directions to ${x.name}`));
    body.push(routeLine(`to ${x.name}`));
    if (st.route) {
      body.push(h('div', { class: 'tp-along' }, h('small', { class: 'muted' }, 'Find along the way:'),
        h('div', { class: 'tp-catchips' }, Object.entries(ALONG).map(([k, [l, e]]) => h('button', { class: `tp-catchip ${view.alongCat === k && view.alongDest === x.id ? 'on' : ''}`, onclick: () => alongRoute(view, x, k) }, `${e} ${l}`)))));
    }
  } else if (t.mode !== 'other' && (t.from || from)) {
    const word = PLACE_WORD[t.mode];
    if (t.from && from) body.push(h('a', { class: 'btn btn-sm', href: directionsLink(from, t.from, 'driving'), target: '_blank', rel: 'noopener' }, `🚗 Directions to the ${word} ↗`));
  }
  return h('div', { class: `tp-legcard ${t.mode}` },
    h('div', { class: 'tp-legcard-head' }, h('span', { class: 'tp-legcard-icon', 'aria-hidden': 'true' }, emoji),
      h('span', { class: 'tp-dest-title' }, h('b', {}, `${label}${from ? ` from ${from.name}` : ''}`), h('small', {}, [travelSummary(t), x.arrive ? fmtDay(x.arrive) : null].filter(Boolean).join(' · ') || `to ${x.name}`)),
      h('button', { class: 'tp-icon-btn', title: 'Change in Trip settings', 'aria-label': 'Change how you get there', onclick: () => view.app.settingsDialog() }, '✎')),
    body.length ? h('div', { class: 'tp-legcard-body' }, body) : null);
}

// Driving directions, drawn on the map.
async function directions(view, x, from, to) {
  view.legs.set(x.id, { loading: true });
  view.drawSideOnly();
  try {
    const route = await geo.route('car', [from, to]);
    const keep = { fromKey: placeKey(from), toKey: placeKey(to), to: { name: to.name, lat: to.lat, lon: to.lon, ...(to.iata ? { iata: to.iata } : {}) }, distance: route.distance, duration: route.duration, line: simplify(route.line) };
    view.legs.delete(x.id);
    await view.store.patchTrip({ legRoutes: { ...(view.trip.legRoutes || {}), [x.id]: keep } }, { undoable: false });
    view.drawTravel();
    if (route?.line?.length) view.map?.fitBounds(route.line, { padding: [40, 40] });
  } catch (err) { view.legs.set(x.id, { error: `No route: ${err.message}` }); }
  if (view.legs.get(x.id)?.loading) view.legs.delete(x.id);
  view.drawSideOnly();
}

// Forget a journey's route.
async function clearRoute(view, x) {
  view.legs?.delete(x.id);
  const rest = { ...(view.trip.legRoutes || {}) };
  delete rest[x.id];
  if (view.alongDest === x.id) { view.alongCat = null; view.closePanel(); }
  await view.store.patchTrip({ legRoutes: rest }, { label: 'clear the route' }).catch(() => {});
  view.drawTravel();
  view.drawSideOnly();
}

// Places along a road trip's route, listed beside the map.
async function alongRoute(view, x, cat) {
  const st = legState(view, x, legFrom(view, view.dests().indexOf(x)), x);
  if (!st?.route) return;
  view.alongCat = cat;
  view.alongDest = x.id;
  view.drawSideOnly();
  const line = st.route.line;
  // Up to 60 points spread along the route, and how far along each one is.
  const step = Math.max(1, Math.ceil(line.length / 60));
  const pts = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + haversine({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
  const panel = view.panel;
  panel.hidden = false;
  panel.dataset.kind = 'along';
  const radius = view.alongRadius || (units() === 'km' ? 3000 : 3219);
  const results = h('div', { class: 'tp-explore-list' }, h('p', { class: 'muted small' }, 'Looking along the route…'));
  const days = tripDays(view.trip);
  const day = x.arrive && days.includes(x.arrive) ? x.arrive : null;
  clear(panel,
    h('div', { class: 'tp-panel-head' }, h('b', {}, `${ALONG[cat][1]} ${ALONG[cat][0]} on the way to ${x.name}`), h('button', { class: 'tp-icon-btn', 'aria-label': 'Close', onclick: () => { view.alongCat = null; view.closePanel(); } }, '✕')),
    h('div', { class: 'tp-catchips' }, h('small', { class: 'muted' }, 'Within'), (units() === 'km' ? [1000, 3000, 5000, 10000] : [805, 3219, 4828, 9656]).map((r) => h('button', { class: `tp-catchip ${r === radius ? 'on' : ''}`, onclick: () => { view.alongRadius = r; alongRoute(view, x, cat); } }, fmtKm(r))), h('small', { class: 'muted' }, 'of the road')),
    results);
  const ask = view.alongAsk = (view.alongAsk || 0) + 1;
  setTimeout(() => { if (ask === view.alongAsk && results.textContent === 'Looking along the route…') clear(results, h('p', { class: 'muted small' }, 'Still looking… OpenStreetMap’s servers are slow right now.')); }, 6000);
  try {
    const list = await geo.along(cat, pts, radius);
    if (ask !== view.alongAsk) return;
    view.preview(list);
    const where = (p) => { let best = 0; let bd = Infinity; pts.forEach((q, i) => { const d = haversine(p, { lat: q[0], lon: q[1] }); if (d < bd) { bd = d; best = i; } }); return [along[best], bd]; };
    const rows = list.map((p) => ({ p, at: where(p) })).sort((a, b) => a.at[0] - b.at[0]);
    clear(results, rows.length ? rows.map(({ p, at }) => h('div', { class: 'tp-result' },
      h('button', { class: 'tp-result-main', onclick: () => view.map?.setView([p.lat, p.lon], 15) }, h('b', {}, p.name), h('small', {}, [`${fmtKm(at[0])} along`, at[1] > 300 ? `${fmtKm(at[1])} off the road` : null, p.stars ? `${'★'.repeat(Math.min(5, Number(p.stars) || 0))}` : null, p.brand, p.hours].filter(Boolean).join(' · '))),
      h('button', { class: 'btn btn-sm btn-primary', onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = '✓'; view.addPlace(p, day, { open: false, dest: x.id }); } }, day ? `Add to day ${days.indexOf(day) + 1}` : 'Add')))
      : h('p', { class: 'muted small' }, `Nothing found within ${fmtKm(radius)} of the route. Try a wider search.`));
  } catch (err) { if (ask === view.alongAsk) clear(results, h('p', { class: 'tp-error small' }, err.message), h('button', { class: 'btn btn-sm', onclick: () => alongRoute(view, x, cat) }, 'Try again')); }
}

// The map: where the trip starts, each destination, and the journeys between them (a computed
// route as a line, otherwise a dashed one).
export function drawTravel(view) {
  const L = window.L;
  if (!view.travelLayer || !L) return;
  view.travelLayer.clearLayers();
  const dests = view.dests();
  const o = view.trip.origin;
  const pin = (p, html, cls, title) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: `tp-destpin ${cls}`, html, iconSize: [28, 28], iconAnchor: [14, 14] }), title, zIndexOffset: -500, keyboard: false }).bindTooltip(esc(title)).addTo(view.travelLayer);
  if (o && Number.isFinite(o.lat)) pin(o, '🏠', 'home', `Starting from ${o.name}`);
  dests.forEach((x, i) => {
    if (Number.isFinite(x.lat)) pin(x, String(i + 1), '', x.name);
    const from = legFrom(view, i);
    const st = legState(view, x, from, x.travel?.mode === 'car' ? x : null);
    if (st?.route?.line) L.polyline(st.route.line, { color: '#1c7ed6', weight: 5, opacity: 0.8 }).addTo(view.travelLayer);
    if (from && Number.isFinite(from.lat) && Number.isFinite(x.lat)) {
      const flight = x.travel?.mode === 'flight';
      L.polyline([[from.lat, from.lon], [x.lat, x.lon]], { color: flight ? '#7048e8' : '#495057', weight: 2, opacity: 0.55, dashArray: flight ? '2 8' : '6 8', interactive: false }).addTo(view.travelLayer);
    }
  });
}

