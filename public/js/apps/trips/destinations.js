// Trip Planner: where a trip goes. A town, city, region or country is found as you type; a trip
// with several destinations keeps them as a list (added like items on a Family Organizer list),
// each with the day you arrive and the day you leave, chosen from the trip's days.

import { h, clear } from '../../ui.js';
import { geo, newId } from './store.js';
import { tripDays, fmtDay, select, input, field, haversine, addDays, dayDiff, TRAVEL } from './util.js';
import { airportField, nearestAirport } from './bookings.js';

// How you get to a destination, and what to ask about each way of travelling.
export { TRAVEL };
const TRAVEL_FIELDS = {
  car: [['departs', 'Setting off at', 'time'], ['rental', 'Rental car', 'check'], ['avoidTolls', 'Avoid tolls', 'check'], ['avoidHighways', 'Avoid motorways', 'check']],
  flight: [['fromAirport', 'From airport', 'airport'], ['toAirport', 'To airport', 'airport'], ['number', 'Flight', 'text', 'e.g. TP1351'], ['departs', 'Departs', 'time'], ['airportBy', 'Getting to the airport', 'select', [['car', 'Driving'], ['taxi', 'Taxi / drop-off'], ['transit', 'Public transport']]]],
  train: [['from', 'From station', 'text', 'e.g. Lisboa Santa Apolónia'], ['to', 'To station', 'text'], ['number', 'Train', 'text', 'e.g. AP 131'], ['departs', 'Departs', 'time']],
  bus: [['from', 'From stop', 'text'], ['to', 'To stop', 'text'], ['operator', 'Bus company', 'text', 'e.g. FlixBus'], ['departs', 'Departs', 'time']],
  ferry: [['from', 'From port', 'text'], ['to', 'To port', 'text'], ['operator', 'Ferry company', 'text'], ['departs', 'Departs', 'time'], ['withCar', 'Taking a car', 'check']],
  boat: [['from', 'From', 'text', 'Marina, pier or harbour'], ['to', 'To', 'text'], ['operator', 'Operator', 'text'], ['departs', 'Departs', 'time']],
  other: [['note', 'How', 'text', 'e.g. Cycling, cable car, hitch-hiking'], ['departs', 'Leaving at', 'time']],
};

// "Getting here from …": the kind of travel, and the questions that go with it. from() is where
// the journey starts (the trip's starting point, or the destination before), to is the destination.
export function travelEditor(dest, { from, onChange } = {}) {
  dest.travel ||= null;
  const box = h('div', { class: 'tp-travel' });
  const draw = () => {
    const t = dest.travel;
    const start = from?.();
    const modeSel = select([['', 'Choose…'], ...Object.entries(TRAVEL).map(([k, [l, e]]) => [k, `${e} ${l}`])], t?.mode || '', { 'aria-label': `Getting to ${dest.name}`, class: 'input tp-travel-mode', onchange: async (e) => {
      const mode = e.target.value;
      dest.travel = mode ? { ...(t?.mode === mode ? t : {}), mode } : null;
      // Flights start with the airports nearest each end.
      if (mode === 'flight') {
        const [a, b] = await Promise.all([dest.travel.fromAirport ? null : nearestAirport(from?.()), dest.travel.toAirport ? null : nearestAirport(dest)]);
        if (a) dest.travel.fromAirport = a.iata;
        if (b) dest.travel.toAirport = b.iata;
      }
      if (mode === 'car' && !dest.travel.departs) dest.travel.departs = '09:00';
      draw();
      onChange?.();
    } });
    const fields = t?.mode ? TRAVEL_FIELDS[t.mode].map(([k, label, kind, extra]) => {
      if (kind === 'airport') return airportField(t, k, label);
      if (kind === 'check') return h('label', { class: 'tp-check' }, h('input', { type: 'checkbox', checked: Boolean(t[k]), onchange: (e) => { t[k] = e.target.checked; onChange?.(); } }), label);
      if (kind === 'select') return field(label, select(extra, t[k] || extra[0][0], { onchange: (e) => { t[k] = e.target.value; onChange?.(); } }));
      return field(label, input({ type: kind === 'time' ? 'time' : 'text', value: t[k] || '', placeholder: extra || '', oninput: (e) => { t[k] = e.target.value; onChange?.(); } }));
    }) : [];
    clear(box, h('div', { class: 'tp-travel-head' }, h('span', { class: 'muted small' }, start?.name ? `Getting here from ${start.name}` : 'Getting here'), modeSel),
      fields.length ? h('div', { class: `tp-travel-fields tp-travel-${t.mode}` }, fields) : null);
  };
  draw();
  box.redraw = draw;
  return box;
}

const KIND = { country: '🌍', state: '🗺️', region: '🗺️', county: '🗺️', island: '🏝️', archipelago: '🏝️', city: '🏙️', town: '🏘️', village: '🏡' };

// A text box that suggests places as you type. onPick(place) when one is chosen (by click, the
// arrow keys and Enter). picked() is the chosen place while the text still matches it.
export function placeInput({ value = '', placeholder = 'Where are you going?', onPick, onEnter, autofocus = false, clearOnPick = false } = {}) {
  const box = h('input', { class: 'input', value, placeholder, autocomplete: 'off', autofocus, enterkeyhint: 'enter', role: 'combobox', 'aria-autocomplete': 'list' });
  const list = h('div', { class: 'tp-results tp-suggest', role: 'listbox', hidden: true });
  let picks = [];
  let hi = -1;
  let chosen = null;
  let t = null;
  let asked = '';
  const draw = () => {
    list.hidden = !picks.length || document.activeElement !== box;
    clear(list, picks.map((p, i) => h('button', { type: 'button', role: 'option', class: `tp-result-main ${i === hi ? 'hi' : ''}`, onpointerdown: (e) => e.preventDefault(), onclick: () => pick(p) },
      h('b', {}, `${KIND[p.kind] || '📍'} ${p.name}`), h('small', {}, p.address))));
  };
  const pick = (p) => {
    chosen = p;
    picks = [];
    hi = -1;
    box.value = clearOnPick ? '' : p.name;
    draw();
    onPick?.(p);
  };
  const lookup = async () => {
    const q = box.value.trim();
    asked = q;
    if (q.length < 2) { picks = []; draw(); return; }
    try { const r = await geo.suggest(q); if (asked === q) { picks = r; hi = -1; draw(); } } catch { picks = []; draw(); }
  };
  box.addEventListener('input', () => { chosen = null; clearTimeout(t); t = setTimeout(lookup, 250); });
  box.addEventListener('focus', () => { if (picks.length) draw(); });
  box.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  box.addEventListener('keydown', (e) => {
    const n = list.hidden ? 0 : picks.length;
    if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); hi = e.key === 'ArrowDown' ? (hi + 1) % n : (hi <= 0 ? n - 1 : hi - 1); draw(); return; }
    if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); e.preventDefault(); list.hidden = true; return; }
    if (e.key === 'Enter') {
      if (n && hi >= 0) { e.preventDefault(); pick(picks[hi]); return; }
      if (onEnter) { e.preventDefault(); onEnter(); }
    }
  });
  const el = h('div', { class: 'tp-searchwrap tp-place-input' }, box, list);
  el.input = box;
  el.picked = () => (chosen && box.value.trim() === chosen.name ? chosen : null);
  // The place for whatever's typed: the one chosen, or the best match for the text.
  el.resolve = async () => {
    const text = box.value.trim();
    if (!text) return null;
    if (el.picked()) return el.picked();
    try { const r = picks.length && asked === text ? picks : await geo.suggest(text); if (r[0]) return { ...r[0], name: r[0].name }; } catch { /* keep the name only */ }
    return { name: text, lat: null, lon: null, address: '' };
  };
  el.set = (p) => { chosen = p; box.value = p?.name || ''; };
  return el;
}

// The list of destinations, each with its arrival and departure day.
export function destinationsEditor({ list = [], start = null, end = null, origin = () => null } = {}) {
  const copy = (x) => ({ ...x, travel: x.travel ? { ...x.travel } : null });
  let items = list.map(copy);
  let range = { start, end };
  const rows = h('div', { class: 'tp-dests' });
  const add = async () => {
    const p = await entry.resolve();
    if (!p) return;
    push(p);
    entry.input.value = '';
    entry.input.focus();
  };
  const push = (p) => {
    // A new destination takes the second half of the days the one before had left.
    const last = items.at(-1);
    let arrive = range.start || null;
    if (last && range.start && range.end) {
      const from = last.arrive || range.start;
      const span = dayDiff(from, range.end);
      arrive = span >= 1 ? addDays(from, Math.ceil(span / 2)) : range.end;
      if (span >= 1) last.depart = arrive;
    }
    items.push({ id: newId(), name: p.name, address: p.address || '', lat: p.lat ?? null, lon: p.lon ?? null, country: p.country || null, arrive, depart: range.end || null });
    draw();
  };
  const entry = placeInput({ placeholder: 'Add a destination: a city, region or country', onPick: (p) => { push(p); }, onEnter: add, clearOnPick: true });
  const days = () => tripDays(range);
  const draw = () => {
    const ds = days();
    const opts = ds.map((d, i) => [d, `Day ${i + 1} · ${fmtDay(d)}`]);
    clear(rows, items.length ? items.map((x, i) => h('div', { class: 'tp-dest-item' }, h('div', { class: 'tp-dest-row' },
      h('span', { class: 'tp-dest-num' }, i + 1),
      h('div', { class: 'tp-dest-name' }, h('b', {}, x.name), x.address && x.address !== x.name ? h('small', { class: 'muted' }, x.address) : null),
      ds.length ? h('label', { class: 'tp-dest-day' }, h('span', {}, 'Arrive'), select(opts, x.arrive, { 'aria-label': `Arrive in ${x.name}`, onchange: (e) => { x.arrive = e.target.value; if (x.depart < x.arrive) x.depart = x.arrive; draw(); } })) : null,
      ds.length ? h('label', { class: 'tp-dest-day' }, h('span', {}, 'Leave'), select(opts, x.depart, { 'aria-label': `Leave ${x.name}`, onchange: (e) => { x.depart = e.target.value; if (x.arrive > x.depart) x.arrive = x.depart; draw(); } })) : null,
      h('div', { class: 'tp-dest-tools' },
        h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': `Move ${x.name} up`, disabled: i === 0, onclick: () => { items.splice(i - 1, 0, items.splice(i, 1)[0]); draw(); } }, '↑'),
        h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': `Move ${x.name} down`, disabled: i === items.length - 1, onclick: () => { items.splice(i + 1, 0, items.splice(i, 1)[0]); draw(); } }, '↓'),
        h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': `Remove ${x.name}`, onclick: () => { items.splice(i, 1); draw(); } }, '✕'))),
      travelEditor(x, { from: () => (i ? items[i - 1] : origin()) })))
      : h('p', { class: 'muted small tp-dests-empty' }, 'No destinations yet. Type one above and pick it from the list, or press Enter.'),
    !ds.length && items.length ? h('p', { class: 'muted small' }, 'Choose the trip’s dates to set when you’re in each place.') : null);
  };
  const el = h('div', { class: 'tp-dests-edit' }, h('div', { class: 'tp-dest-add' }, entry, h('button', { type: 'button', class: 'btn', onclick: add }, 'Add')), rows);
  // New trip dates: days outside them move to the nearest day that's in.
  el.setRange = (s, e) => {
    // A new start date moves every destination's days with it (as it moves the plan).
    if (range.start && s && s !== range.start) { const n = dayDiff(range.start, s); for (const x of items) { if (x.arrive) x.arrive = addDays(x.arrive, n); if (x.depart) x.depart = addDays(x.depart, n); } }
    range = { start: s || null, end: e && s && e < s ? s : e || s || null };
    const clamp = (d) => (!d || !range.start ? d || range.start : d < range.start ? range.start : d > range.end ? range.end : d);
    for (const x of items) { x.arrive = clamp(x.arrive) || range.start; x.depart = clamp(x.depart) || range.end; if (x.depart && x.arrive && x.depart < x.arrive) x.depart = x.arrive; }
    draw();
  };
  el.value = () => items.map(copy);
  el.set = (list2) => { items = list2.map(copy); el.setRange(range.start, range.end); };
  el.redraw = () => draw();
  el.entry = entry;
  el.setRange(start, end);
  return el;
}

// "Lisbon", "Lisbon & Porto", "Lisbon, Sintra & Porto"
export function destinationLabel(list) {
  const names = list.map((x) => x.name).filter(Boolean);
  return names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

// Which destination each day of the trip belongs to: the last one you've arrived at by then (so a
// travel day is with the place you're going to).
export function dayDestinations(trip) {
  const dests = trip.destinations || [];
  const out = new Map();
  const sorted = dests.map((x, i) => ({ x, i, a: x.arrive || trip.start, d: x.depart || trip.end })).sort((p, q) => (p.a || '').localeCompare(q.a || '') || p.i - q.i);
  for (const day of tripDays(trip)) {
    let found = null;
    for (const s of sorted) if ((!s.a || s.a <= day) && (!s.d || day <= s.d)) found = s.x;
    if (found) out.set(day, found.id);
  }
  return out;
}

// The destination nearest a place (the first, for places with no position).
export function nearestDestination(trip, p) {
  const dests = (trip.destinations || []).filter((x) => Number.isFinite(x.lat));
  if (!dests.length || !Number.isFinite(p?.lat)) return trip.destinations?.[0]?.id || null;
  return dests.reduce((best, x) => (haversine(x, p) < haversine(best, p) ? x : best)).id;
}
