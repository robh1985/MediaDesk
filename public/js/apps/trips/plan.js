// Trip Planner: the plan. Days down the side (and a list of places not on a day yet), the map
// beside them. Places come from a search, from exploring what's nearby, from a click on the map,
// or from an import (GPX, KML/KMZ, GeoJSON, Google Takeout, Google Maps links). Drag places and
// notes between days; each day's route is drawn with its distance and time, can be put in the
// shortest order, and opened in Google Maps. Each day shows its weather and where you're staying.

import { h, clear, toast, toastError } from '../../ui.js';
import { geo, newId } from './store.js';
import { makeMap, placeIcon, fitTo, STYLES } from './map.js';
import { dayDestinations, nearestDestination } from './destinations.js';
import { originCard, legCard, drawTravel } from './travel.js';
import {
  tripDays, fmtDay, fmtTime, fmtMins, fmtKm, CATEGORIES, catOf, DAY_COLORS, bookingType, BOOKING_TYPES, STAYS, haversine, optimiseOrder, weatherIcon,
  navLinks, googleDirections, sheet, field, input, select, textarea, emptyState, esc,
} from './util.js';

const MODES = { foot: ['On foot', '🚶'], bike: ['By bike', '🚲'], car: ['By car', '🚗'], transit: ['Public transport', '🚆'] };

export class PlanView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.day = null; // the day picked (null: the whole trip)
    this.placeId = null; // the place open in the details panel
    this.routes = new Map(); // route key → route
    this.weather = {};
    this.explore = null;
    this.mapStyle = null;
  }

  get trip() { return this.store.trip; }
  dayList() { return tripDays(this.trip); }
  itemsOn(date) { return this.store.all('items').filter((it) => (it.date || null) === date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
  dests() { return this.trip.destinations || []; }
  dest(id) { return this.dests().find((x) => x.id === id) || null; }
  // The destination a place not on a day belongs to: where it was put, or the nearest.
  poolDest(it) {
    if (it.dest && this.dest(it.dest)) return it.dest;
    return nearestDestination(this.trip, it.kind === 'place' ? this.store.get('places', it.placeId) : null);
  }
  // A day's items, or the places to visit (for one destination).
  itemsIn(date, destId) { const list = this.itemsOn(date); return date || !destId ? list : list.filter((it) => this.poolDest(it) === destId); }
  dayColor(date) { const i = this.dayList().indexOf(date); return i < 0 ? '#868e96' : DAY_COLORS[i % DAY_COLORS.length]; }
  modeOf(date) { return (this.trip.dayModes || {})[date] || 'foot'; }
  // The located stops of a day, in order (places, and bookings with a place).
  stopsOf(date) {
    return this.itemsOn(date).map((it) => {
      if (it.kind === 'place') { const p = this.store.get('places', it.placeId); return p && Number.isFinite(p.lat) ? { ...p, item: it } : null; }
      if (it.kind === 'booking') { const b = this.store.get('bookings', it.bookingId); return b && Number.isFinite(b.lat) && !BOOKING_TYPES[b.type]?.[2] ? { name: b.title, lat: b.lat, lon: b.lon, category: 'transport', item: it } : null; }
      return null;
    }).filter(Boolean);
  }

  render(el) {
    this.el = el;
    if (!this.layout?.isConnected) this.build(el);
    this.drawSide();
    this.drawMap();
  }

  build(el) {
    this.side = h('div', { class: 'tp-plan-list' });
    const q = input({ type: 'search', placeholder: 'Search for a place, address or city…', class: 'input tp-search' });
    this.results = h('div', { class: 'tp-results', hidden: true });
    let t = null;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(q.value.trim()), 450); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); this.search(q.value.trim()); } if (e.key === 'Escape') { this.results.hidden = true; } });
    this.undoBtn = h('button', { class: 'tp-icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => this.undo() }, '↶');
    const tools = h('div', { class: 'tp-plan-tools' },
      h('div', { class: 'tp-searchwrap' }, q, this.results),
      h('button', { class: 'btn btn-sm', onclick: () => this.openExplore() }, '🧭 Explore'),
      h('button', { class: 'btn btn-sm', onclick: (e) => this.importExportMenu(e.currentTarget) }, '⇅ Import / export'),
      this.undoBtn);
    this.mapEl = h('div', { class: 'tp-map' });
    this.panel = h('div', { class: 'tp-panel', hidden: true });
    const styleSel = select(Object.entries(STYLES).map(([k, v]) => [k, v[0]]), '', { class: 'input tp-mapstyle', 'aria-label': 'Map style', onchange: (e) => { this.mapStyle = e.target.value; this.map?.setStyle(e.target.value); } });
    styleSel.prepend(h('option', { value: '', selected: true, disabled: true }, 'Map style'));
    const overview = h('button', { class: 'btn btn-sm tp-overview', onclick: () => { this.day = null; this.lastDay = null; this.render(this.el); this.fitAll(); } }, '🗺️ Whole trip');
    this.layout = h('div', { class: 'tp-plan' },
      h('div', { class: 'tp-plan-side' }, tools, this.side),
      h('div', { class: 'tp-plan-mapwrap' }, this.mapEl, h('div', { class: 'tp-map-tools' }, overview, styleSel), this.panel));
    clear(el, this.layout);
    this.keys = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input, textarea') && this.layout.isConnected) { e.preventDefault(); this.undo(); } };
    window.addEventListener('keydown', this.keys);
  }
  destroy() { window.removeEventListener('keydown', this.keys); this.map?.remove(); }

  async undo() {
    if (!this.store.canUndo()) { toast('Nothing to undo', { timeout: 1500 }); return; }
    try { const label = await this.store.undo(); toast(label ? `Undone: ${label}` : 'Undone', { timeout: 1500 }); } catch (err) { toastError(err); }
  }

  // --- The days -----------------------------------------------------------------------------

  drawSide() {
    this.undoBtn.disabled = !this.store.canUndo();
    this.drawSideOnly();
    this.loadWeather();
    this.loadRoutes();
  }

  // Without destinations: the places to visit, then the days. With them: each destination folds
  // open to its own places to visit and its days.
  sideSections() {
    const days = this.dayList();
    const dests = this.dests();
    const sections = [];
    const origin = originCard(this);
    if (origin) sections.push(origin);
    if (!dests.length) sections.push(this.daySection(null, this.itemsOn(null)), ...days.map((d, i) => this.daySection(d, this.itemsOn(d), i)));
    else {
      const byDay = dayDestinations(this.trip);
      dests.forEach((x, k) => {
        const mine = days.filter((d) => byDay.get(d) === x.id);
        const pool = this.itemsIn(null, x.id);
        const open = !this.collapsed().has(x.id);
        const span = mine.length ? `${fmtDay(mine[0])}${mine.length > 1 ? ` – ${fmtDay(mine.at(-1))}` : ''} · ${mine.length} day${mine.length === 1 ? '' : 's'}` : 'No days';
        const places = new Set([...pool, ...mine.flatMap((d) => this.itemsOn(d))].filter((it) => it.kind === 'place').map((it) => it.placeId)).size;
        const leg = legCard(this, x, k);
        if (leg) sections.push(leg);
        sections.push(h('section', { class: `tp-dest ${open ? 'open' : ''}`, dataset: { dest: x.id } },
          h('button', { class: 'tp-dest-head', 'aria-expanded': String(open), onclick: () => this.toggleDest(x) },
            h('span', { class: 'tp-dest-chev', 'aria-hidden': 'true' }, '▸'),
            h('span', { class: 'tp-dest-pin' }, k + 1),
            h('span', { class: 'tp-dest-title' }, h('b', {}, x.name), h('small', {}, `${span} · ${places} place${places === 1 ? '' : 's'}`))),
          open ? h('div', { class: 'tp-dest-body' }, this.daySection(null, pool, undefined, x), mine.map((d) => this.daySection(d, this.itemsOn(d), days.indexOf(d)))) : null));
      });
      const other = days.filter((d) => !byDay.has(d));
      if (other.length) sections.push(h('section', { class: 'tp-dest open other' }, h('div', { class: 'tp-dest-head static' }, h('span', { class: 'tp-dest-title' }, h('b', {}, 'Other days'), h('small', {}, 'Not at any destination'))), h('div', { class: 'tp-dest-body' }, other.map((d) => this.daySection(d, this.itemsOn(d), days.indexOf(d))))));
    }
    if (!days.length) sections.push(h('p', { class: 'muted small tp-pad' }, 'Give the trip dates (⚙ Trip settings) to plan it day by day.'));
    return sections;
  }
  drawSideOnly() { const keep = this.side.scrollTop; clear(this.side, this.sideSections()); this.side.scrollTop = keep; }

  // Which destinations are folded away (kept for each trip on this device).
  collapsed() {
    if (!this._collapsed) { let v = []; try { v = JSON.parse(localStorage.getItem(`mediadesk.trips.folded.${this.store.id}`) || '[]'); } catch { /* none */ } this._collapsed = new Set(v); }
    return this._collapsed;
  }
  toggleDest(x) {
    const c = this.collapsed();
    if (c.has(x.id)) { c.delete(x.id); this.focusDest(x); } else c.add(x.id);
    try { localStorage.setItem(`mediadesk.trips.folded.${this.store.id}`, JSON.stringify([...c])); } catch { /* not kept */ }
    this.drawSideOnly();
  }

  daySection(date, items, index, dest = null) {
    const color = date ? this.dayColor(date) : '#868e96';
    const on = this.day === date && date;
    const stops = date ? this.stopsOf(date) : [];
    const route = date ? this.routes.get(this.routeKey(date)) : null;
    const w = date ? this.weather[date] : null;
    const stays = date ? this.store.all('bookings').filter((b) => STAYS.has(b.type) && b.start && b.start.slice(0, 10) <= date && (b.end || b.start).slice(0, 10) > date && b.status !== 'cancelled') : [];
    const mode = date ? this.modeOf(date) : null;
    const head = date
      ? h('div', { class: 'tp-day-head', onclick: (e) => { if (e.target.closest('button, select')) return; this.day = on ? null : date; this.render(this.el); } },
        h('span', { class: 'tp-day-dot', style: { background: color } }, index + 1),
        h('div', { class: 'tp-day-title' }, h('b', {}, `Day ${index + 1}`), h('span', {}, fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })),
          h('div', { class: 'tp-day-meta' },
            w ? h('span', { class: 'tp-chip', title: w.guess ? 'Last year on this day (a guide, not a forecast)' : 'Forecast' }, `${weatherIcon(w.code)} ${Math.round(w.max)}° / ${Math.round(w.min)}°${w.guess ? '*' : ''}`) : null,
            stays.map((b) => h('span', { class: 'tp-chip', title: 'Staying' }, `🛏 ${b.title}`)),
            route ? h('span', { class: 'tp-chip' }, `${MODES[mode][1]} ${fmtKm(route.distance)} · ${fmtMins(route.duration)}`) : null)),
        h('div', { class: 'tp-day-tools' },
          h('button', { class: 'tp-icon-btn', title: `Getting around: ${MODES[mode][0].toLowerCase()} (click to change)`, 'aria-label': `Getting around: ${MODES[mode][0]}`, onclick: () => { const ks = Object.keys(MODES); this.store.patchTrip({ dayModes: { ...(this.trip.dayModes || {}), [date]: ks[(ks.indexOf(mode) + 1) % ks.length] } }, { label: 'travel mode' }).catch(toastError); } }, MODES[mode][1]),
          h('button', { class: 'tp-icon-btn', title: 'Shortest order', 'aria-label': 'Put in the shortest order', disabled: stops.length < 3, onclick: () => this.optimise(date) }, '⇄'),
          h('button', { class: 'tp-icon-btn', title: 'Open in Google Maps', 'aria-label': 'Open the day in Google Maps', disabled: stops.length < 1, onclick: () => window.open(googleDirections(stops, mode), '_blank', 'noopener') }, '↗'),
          h('button', { class: 'tp-icon-btn', title: 'Add a note', 'aria-label': 'Add a note', onclick: () => this.editNote(null, date) }, '✎')))
      : h('div', { class: 'tp-day-head pool' }, h('span', { class: 'tp-day-dot', style: { background: color } }, '★'), h('div', { class: 'tp-day-title' }, h('b', {}, dest ? `Places to visit in ${dest.name}` : 'Places to visit'), h('span', {}, 'Not on a day yet — drag them onto one')));
    const list = h('div', { class: 'tp-day-items', dataset: { date: date || '' } });
    let n = 0;
    const legs = route?.legs || [];
    let stopIndex = -1;
    items.forEach((it) => {
      const row = this.itemRow(it, date, color, it.kind === 'note' ? null : ++n);
      if (date && row.dataset.located === '1') {
        stopIndex++;
        const leg = legs[stopIndex - 1];
        if (leg && stopIndex > 0) list.append(h('div', { class: 'tp-leg' }, `${MODES[mode][1]} ${fmtMins(leg.duration)} · ${fmtKm(leg.distance)}`));
      }
      list.append(row);
    });
    if (!items.length) list.append(h('div', { class: 'tp-day-empty' }, date ? 'Drop places here, or search above' : 'Search for places, or explore what’s nearby'));
    if (date && mode === 'transit' && stops.length > 1) list.append(h('a', { class: 'tp-leg link', href: googleDirections(stops, 'transit'), target: '_blank', rel: 'noopener' }, '🚆 See public transport in Google Maps ↗'));
    this.dropTarget(list, date, dest?.id || null);
    return h('section', { class: `tp-day ${on ? 'on' : ''}`, style: { '--c': color } }, head, list);
  }

  itemRow(it, date, color, n) {
    let body;
    let located = false;
    if (it.kind === 'place') {
      const p = this.store.get('places', it.placeId);
      if (!p) return h('div');
      located = Number.isFinite(p.lat);
      const [, emoji] = catOf(p.category);
      body = [h('span', { class: 'tp-num', style: { background: color } }, n),
        h('button', { class: 'tp-item-main', onclick: () => this.openPlace(p.id) }, h('b', {}, `${emoji} ${p.name}`), h('small', {}, [it.time ? `🕒 ${it.time}${it.duration ? ` · ${it.duration} min` : ''}` : null, p.rating ? '★'.repeat(p.rating) : null, p.address?.split(',').slice(0, 2).join(',')].filter(Boolean).join(' · ')))];
    } else if (it.kind === 'booking') {
      const b = this.store.get('bookings', it.bookingId);
      if (!b) return h('div');
      located = Number.isFinite(b.lat) && !BOOKING_TYPES[b.type]?.[2];
      const [label, emoji] = bookingType(b.type);
      body = [h('span', { class: 'tp-num booking' }, emoji),
        h('button', { class: 'tp-item-main', onclick: () => this.app.go('bookings', b.id) }, h('b', {}, b.title || label), h('small', {}, [fmtTime(b.start), b.code ? `#${b.code}` : null, b.status === 'pending' ? 'pending' : null].filter(Boolean).join(' · ')))];
    } else {
      body = [h('span', { class: 'tp-num note' }, '✎'), h('button', { class: 'tp-item-main', onclick: () => this.editNote(it, date) }, h('span', { class: 'tp-note-text' }, it.text))];
    }
    const row = h('div', { class: `tp-item ${it.kind} ${this.placeId && it.placeId === this.placeId ? 'on' : ''}`, draggable: 'true', dataset: { id: it.id, located: located ? '1' : '0' } },
      h('span', { class: 'tp-grip', 'aria-hidden': 'true' }, '⋮⋮'), body,
      date && it.kind !== 'note' ? h('button', { class: `tp-icon-btn tp-lock ${it.locked ? 'on' : ''}`, title: it.locked ? 'Stays put when the day is put in order' : 'Keep in place when putting the day in order', 'aria-label': 'Keep in place', onclick: () => this.store.put('items', { ...it, locked: !it.locked }, { label: 'keep in place' }) }, it.locked ? '🔒' : '🔓') : null,
      h('button', { class: 'tp-icon-btn', 'aria-label': 'More', onclick: (e) => this.itemMenu(e.currentTarget, it) }, '⋯'));
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); this.dragId = it.id; });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); this.dragId = null; this.el.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
    return row;
  }

  // Drop a dragged item into a day, before or after the row it's over.
  dropTarget(list, date, destId = null) {
    const target = (e) => { const row = e.target.closest('.tp-item'); if (!row || row.dataset.id === this.dragId) return null; const r = row.getBoundingClientRect(); return { row, after: e.clientY > r.top + r.height / 2 }; };
    list.addEventListener('dragover', (e) => {
      if (!this.dragId) return;
      e.preventDefault();
      list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const t = target(e);
      if (t) t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
      list.classList.add('drop-on');
    });
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) list.classList.remove('drop-on'); });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/plain') || this.dragId;
      const t = target(e);
      this.moveItem(id, date, t ? { id: t.row.dataset.id, after: t.after } : null, destId);
    });
  }
  moveItem(id, date, at, destId = null) {
    const it = this.store.get('items', id);
    if (!it) return;
    const rest = this.itemsIn(date, destId).filter((x) => x.id !== id);
    let idx = rest.length;
    if (at) { const k = rest.findIndex((x) => x.id === at.id); if (k >= 0) idx = k + (at.after ? 1 : 0); }
    rest.splice(idx, 0, it);
    const ops = rest.map((x, i) => ({ op: 'put', col: 'items', item: { ...x, date, order: i, ...(x.id === id && !date && destId ? { dest: destId } : {}) } })).filter((o) => o.item.id === id || o.item.order !== this.store.get('items', o.item.id).order);
    this.store.batch(ops, { label: `move ${it.kind}` }).catch((err) => toastError(err));
  }

  itemMenu(anchor, it) {
    const days = this.dayList();
    const byDay = dayDestinations(this.trip);
    const pools = this.dests().length ? this.dests().map((x) => [`__pool:${x.id}`, `Places to visit in ${x.name}`]) : [['__pool', 'Places to visit']];
    const opts = [['', 'Move to…'], ...pools, ...days.map((d, i) => [d, `Day ${i + 1} · ${fmtDay(d)}${byDay.has(d) ? ` · ${this.dest(byDay.get(d))?.name}` : ''}`])];
    const sel = select(opts, '', { class: 'input' });
    const time = input({ type: 'time', value: it.time || '' });
    const dur = input({ type: 'number', min: 0, max: 1440, step: 15, value: it.duration || '', placeholder: 'minutes' });
    sheet(this.app.root, {
      title: it.kind === 'place' ? this.store.get('places', it.placeId)?.name || 'Place' : it.kind === 'booking' ? 'Booking' : 'Note',
      body: h('div', { class: 'tp-form' }, field('Day', sel), it.kind !== 'note' ? h('div', { class: 'tp-row' }, field('Time', time), field('How long', dur)) : null),
      actions: [{ label: it.kind === 'place' ? 'Take off the plan' : 'Remove', danger: true, left: true, onClick: (close) => { close(); (it.kind === 'place' ? this.store.put('items', { ...it, date: null }, { label: 'take off the day' }) : this.store.del('items', it.id, { label: 'remove' })).catch(toastError); } },
        { label: 'Cancel' },
        { label: 'Save', primary: true, submit: true, onClick: (close) => {
          close();
          const patch = { ...it, time: time.value || null, duration: Number(dur.value) || null };
          if (sel.value) { const pool = sel.value.startsWith('__pool'); patch.date = pool ? null : sel.value; patch.order = 999; if (pool && sel.value.includes(':')) patch.dest = sel.value.split(':')[1]; }
          this.store.put('items', patch, { label: 'change' }).catch(toastError);
        } }],
    });
  }

  async optimise(date) {
    const items = this.itemsOn(date);
    const located = items.filter((it) => this.stopsOf(date).some((s) => s.item.id === it.id));
    const stops = located.map((it) => ({ ...this.stopsOf(date).find((s) => s.item.id === it.id), locked: it.locked }));
    const order = optimiseOrder(stops);
    const sorted = order.map((i) => located[i]);
    // Notes and unlocated items keep their places; located ones fill the located slots in order.
    let k = 0;
    const next = items.map((it) => (located.includes(it) ? sorted[k++] : it));
    const before = stops.reduce((a, s, i) => a + (i ? haversine(stops[i - 1], s) : 0), 0);
    const after = order.reduce((a, s, i) => a + (i ? haversine(stops[order[i - 1]], stops[s]) : 0), 0);
    if (next.every((it, i) => it.id === items[i].id)) { toast('This day is already in the shortest order', { timeout: 2000 }); return; }
    await this.store.batch(next.map((it, i) => ({ op: 'put', col: 'items', item: { ...it, order: i } })), { label: 'shortest order' });
    toast('Put in the shortest order', { type: 'success', timeout: 2500, body: `About ${fmtKm(before - after)} shorter as the crow flies. Undo to put it back.` });
  }

  editNote(it, date) {
    const t = textarea(it?.text || '', { placeholder: 'A note for this day…', autofocus: true, rows: 4 });
    sheet(this.app.root, {
      title: it ? 'Note' : 'Add a note',
      body: t,
      actions: [it ? { label: 'Delete', danger: true, left: true, onClick: (close) => { close(); this.store.del('items', it.id, { label: 'delete note' }); } } : null, { label: 'Cancel' },
        { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!t.value.trim()) return; close(); this.store.put('items', { ...(it || { kind: 'note', date, order: 999 }), text: t.value.trim() }, { label: 'note' }).catch(toastError); } }],
    });
  }

  // --- Weather and routes -------------------------------------------------------------------

  async loadWeather() {
    const days = this.dayList();
    const key = `${days[0]}|${days.at(-1)}|${this.store.all('places').length}|${this.dests().map((x) => `${x.lat},${x.arrive},${x.depart}`).join(';')}`;
    if (!days.length || this.weatherFor === key) return;
    this.weatherFor = key;
    // One forecast per area (each day's first place, or the trip's middle).
    const groups = new Map();
    const all = this.store.all('places').filter((p) => Number.isFinite(p.lat));
    const center = all.length ? { lat: all.reduce((a, p) => a + p.lat, 0) / all.length, lon: all.reduce((a, p) => a + p.lon, 0) / all.length } : null;
    for (const d of days) {
      const p = this.stopsOf(d)[0] || this.dest(dayDestinations(this.trip).get(d)) || center;
      if (!p || !Number.isFinite(p.lat)) continue;
      const key = `${Math.round(p.lat * 2) / 2},${Math.round(p.lon * 2) / 2}`;
      if (!groups.has(key)) groups.set(key, { p, days: [] });
      groups.get(key).days.push(d);
    }
    for (const { p, days: ds } of groups.values()) {
      try {
        const w = await geo.weather(p.lat, p.lon, ds[0], ds.at(-1));
        for (const d of ds) if (w[d]) this.weather[d] = w[d];
      } catch { /* no weather */ }
    }
    if (this.layout?.isConnected) this.drawSideOnly();
  }
  routeKey(date) { const pts = this.stopsOf(date); return `${this.modeOf(date)}|${pts.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';')}`; }
  async loadRoutes() {
    let changed = false;
    for (const d of this.dayList()) {
      const stops = this.stopsOf(d);
      const mode = this.modeOf(d);
      if (stops.length < 2 || mode === 'transit') continue;
      const key = this.routeKey(d);
      if (this.routes.has(key)) continue;
      this.routes.set(key, null);
      try { this.routes.set(key, await geo.route(mode, stops)); changed = true; } catch { this.routes.delete(key); }
    }
    if (changed && this.layout?.isConnected) { this.drawSideOnly(); this.drawRoutes(); }
  }

  // --- The map --------------------------------------------------------------------------------

  async drawMap() {
    if (!this.map) {
      try {
        this.map = await makeMap(this.mapEl, { style: this.mapStyle || undefined });
        this.map.on('click', (e) => this.mapClick(e.latlng));
        this.markers = window.L.markerClusterGroup({ maxClusterRadius: 38, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 14 });
        this.map.addLayer(this.markers);
        this.travelLayer = window.L.layerGroup().addTo(this.map);
        this.lines = window.L.layerGroup().addTo(this.map);
        this.extra = window.L.layerGroup().addTo(this.map);
        this.fitted = false;
      } catch (err) { clear(this.mapEl, emptyState('🗺️', `The map couldn’t load: ${err.message}`)); return; }
    }
    const L = window.L;
    this.markers.clearLayers();
    const days = this.dayList();
    const where = new Map(); // place → [date, n]
    for (const d of days) this.itemsOn(d).filter((it) => it.kind === 'place').forEach((it, i) => { if (!where.has(it.placeId)) where.set(it.placeId, [d, i + 1]); });
    const shown = [];
    for (const p of this.store.all('places')) {
      if (!Number.isFinite(p.lat)) continue;
      const [d, n] = where.get(p.id) || [null, null];
      const faded = this.day && d !== this.day;
      const m = L.marker([p.lat, p.lon], { icon: placeIcon(L, p, { color: d ? this.dayColor(d) : '#868e96', n, selected: p.id === this.placeId, faded }), title: p.name, riseOnHover: true });
      m.on('click', () => this.openPlace(p.id));
      m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -34] });
      this.markers.addLayer(m);
      if (!faded) shown.push(p);
    }
    this.drawRoutes();
    this.drawTravel();
    if (!this.fitted || this.lastDay !== this.day) {
      const first = !this.fitted;
      this.fitted = true;
      this.lastDay = this.day;
      // A trip opens on its first destination.
      if (first && !this.day && this.dests().length) this.focusDest(this.dests()[0]);
      else if (this.day) fitTo(this.map, this.stopsOf(this.day));
      else this.fitAll();
    }
  }
  // The whole trip: every place and destination.
  fitAll() { fitTo(this.map, [...this.store.all('places'), ...this.dests(), ...(this.trip.origin ? [this.trip.origin] : [])], 13); }
  drawTravel() { drawTravel(this); }
  // One destination: its places (or the town itself, before it has any).
  focusDest(x) {
    if (!this.map) return;
    const byDay = dayDestinations(this.trip);
    const items = [...this.itemsIn(null, x.id), ...this.dayList().filter((d) => byDay.get(d) === x.id).flatMap((d) => this.itemsOn(d))];
    const pts = items.filter((it) => it.kind === 'place').map((it) => this.store.get('places', it.placeId)).filter((p) => p && Number.isFinite(p.lat));
    if (pts.length) fitTo(this.map, pts);
    else if (Number.isFinite(x.lat)) this.map.setView([x.lat, x.lon], 12);
  }
  drawRoutes() {
    if (!this.lines) return;
    const L = window.L;
    this.lines.clearLayers();
    for (const d of this.dayList()) {
      const stops = this.stopsOf(d);
      if (stops.length < 2) continue;
      const route = this.routes.get(this.routeKey(d));
      const line = route?.line || stops.map((s) => [s.lat, s.lon]);
      const faded = this.day && this.day !== d;
      L.polyline(line, { color: this.dayColor(d), weight: faded ? 3 : 5, opacity: faded ? 0.25 : 0.85, dashArray: route ? null : '6 8' }).addTo(this.lines);
    }
  }

  mapClick(latlng) {
    if (this.panel && !this.panel.hidden && this.panel.dataset.kind === 'place') return this.closePanel();
    const L = window.L;
    const pop = L.popup({ closeButton: true }).setLatLng(latlng).setContent(`<button class="btn btn-sm tp-addhere">📍 Add a place here</button>`).openOn(this.map);
    setTimeout(() => pop.getElement()?.querySelector('.tp-addhere')?.addEventListener('click', async () => {
      this.map.closePopup();
      try {
        const p = await geo.reverse(latlng.lat, latlng.lng);
        this.addPlace({ ...p, lat: latlng.lat, lon: latlng.lng }, this.day);
      } catch (err) { toastError(err, 'Couldn’t find that place'); }
    }));
  }

  // --- Finding and adding places -------------------------------------------------------------

  async search(q) {
    if (!q || q.length < 2) { this.results.hidden = true; return; }
    const c = this.map?.getCenter();
    clear(this.results, h('div', { class: 'tp-result muted' }, 'Searching…'));
    this.results.hidden = false;
    try {
      const list = await geo.search(q, c ? `${c.lat.toFixed(3)},${c.lng.toFixed(3)}` : null);
      clear(this.results, list.length ? list.map((p) => {
        const [label, emoji] = catOf(p.category);
        return h('div', { class: 'tp-result' },
          h('button', { class: 'tp-result-main', onclick: () => { this.map?.setView([p.lat, p.lon], 15); this.preview([p]); } }, h('b', {}, `${emoji} ${p.name}`), h('small', {}, `${label} · ${p.address}`)),
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => { this.addPlace(p, this.day); this.results.hidden = true; } }, this.day ? `Add to day ${this.dayList().indexOf(this.day) + 1}` : 'Add'));
      }) : h('div', { class: 'tp-result muted' }, 'Nothing found'));
    } catch (err) { clear(this.results, h('div', { class: 'tp-result tp-error' }, err.message)); }
  }
  preview(list) {
    if (!this.extra) return;
    const L = window.L;
    this.extra.clearLayers();
    for (const p of list) L.circleMarker([p.lat, p.lon], { radius: 9, color: '#111', weight: 2, fillColor: '#ffd43b', fillOpacity: 0.95 }).bindTooltip(esc(p.name)).addTo(this.extra);
  }

  async addPlace(p, date = null, { open = true, quiet = false, dest = null } = {}) {
    // The same place twice: put the existing one on the day instead.
    const same = this.store.all('places').find((x) => (p.osm && x.osm === p.osm) || (x.name === p.name && Math.abs(x.lat - p.lat) < 1e-4 && Math.abs(x.lon - p.lon) < 1e-4));
    const placeId = same?.id || newId();
    const ops = [];
    if (!same) ops.push({ op: 'put', col: 'places', item: { id: placeId, name: p.name, lat: p.lat, lon: p.lon, address: p.address || '', category: p.category || 'other', country: p.country || null, osm: p.osm || null, url: p.url || null, phone: p.phone || null, hours: p.hours || null, wiki: p.wiki || null, notes: p.notes || '' } });
    if (!same || !this.store.all('items').some((it) => it.placeId === placeId && (it.date || null) === date)) ops.push({ op: 'put', col: 'items', item: { kind: 'place', placeId, date, order: this.itemsOn(date).length, ...(dest && !date ? { dest } : {}) } });
    if (!ops.length) { if (!quiet) toast(`${p.name} is already there`, { timeout: 1500 }); return placeId; }
    await this.store.batch(ops, { label: `add ${p.name}` }).catch(toastError);
    this.extra?.clearLayers();
    if (!quiet) toast(`Added ${p.name}${date ? ` to day ${this.dayList().indexOf(date) + 1}` : ''}`, { type: 'success', timeout: 1800 });
    if (open) this.openPlace(placeId);
    return placeId;
  }

  // What's nearby: by kind, around the place that's open (or the middle of the map).
  openExplore() {
    const c = this.placeId ? this.store.get('places', this.placeId) : null;
    const center = c ? { lat: c.lat, lon: c.lon, name: c.name } : this.map ? { lat: this.map.getCenter().lat, lon: this.map.getCenter().lng, name: 'the middle of the map' } : null;
    if (!center) return;
    this.panel.hidden = false;
    this.panel.dataset.kind = 'explore';
    const results = h('div', { class: 'tp-explore-list' });
    const run = async (cat, btn) => {
      this.panel.querySelectorAll('.tp-catchip').forEach((b) => b.classList.toggle('on', b === btn));
      clear(results, h('p', { class: 'muted small' }, 'Looking around…'));
      // Only the last kind chosen counts (an earlier search may still be on its way).
      const ask = this.exploreAsk = (this.exploreAsk || 0) + 1;
      setTimeout(() => { if (ask === this.exploreAsk && results.textContent === 'Looking around…') clear(results, h('p', { class: 'muted small' }, 'Still looking… OpenStreetMap’s servers are slow right now.')); }, 6000);
      try {
        const list = await geo.nearby(center.lat, center.lon, cat);
        if (ask !== this.exploreAsk) return;
        this.preview(list);
        if (list.length) fitTo(this.map, [center, ...list]);
        clear(results, list.length ? list.sort((a, b) => haversine(center, a) - haversine(center, b)).map((p) => h('div', { class: 'tp-result' },
          h('button', { class: 'tp-result-main', onclick: () => this.map.setView([p.lat, p.lon], 17) }, h('b', {}, p.name), h('small', {}, [fmtKm(haversine(center, p)), p.cuisine, p.hours].filter(Boolean).join(' · '))),
          h('button', { class: 'btn btn-sm btn-primary', onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = '✓'; this.addPlace(p, this.day, { open: false }); } }, 'Add')))
          : h('p', { class: 'muted small' }, 'Nothing of that kind nearby'));
      } catch (err) { if (ask === this.exploreAsk) clear(results, h('p', { class: 'tp-error small' }, err.message), h('button', { class: 'btn btn-sm', onclick: () => run(cat, btn) }, 'Try again')); }
    };
    clear(this.panel, h('div', { class: 'tp-panel-head' }, h('b', {}, `Near ${center.name}`), h('button', { class: 'tp-icon-btn', 'aria-label': 'Close', onclick: () => this.closePanel() }, '✕')),
      h('div', { class: 'tp-catchips' }, Object.entries(CATEGORIES).filter(([k]) => !['other', 'activity'].includes(k)).map(([k, [l, e]]) => h('button', { class: 'tp-catchip', onclick: (ev) => run(k, ev.currentTarget) }, `${e} ${l}`))),
      results);
    run('sights', this.panel.querySelector('.tp-catchip'));
  }

  closePanel() { this.panel.hidden = true; this.placeId = null; this.extra?.clearLayers(); this.drawMap(); this.drawSideOnly(); }

  // --- A place's details ------------------------------------------------------------------------

  async openPlace(id) {
    const p = this.store.get('places', id);
    if (!p) return;
    this.placeId = id;
    this.panel.hidden = false;
    this.panel.dataset.kind = 'place';
    this.drawMap();
    this.drawSideOnly();
    if (Number.isFinite(p.lat)) this.map?.panTo([p.lat, p.lon]);
    const file = p.image ? this.store.get('files', p.image) : null;
    const img = file ? this.store.fileUrl(file.id) : p.wikiImage || null;
    const days = this.dayList();
    const onDays = this.store.all('items').filter((it) => it.placeId === id && it.date).map((it) => it.date);
    const dayPick = select([['', onDays.length ? `On day ${onDays.map((d) => days.indexOf(d) + 1).join(', ')}` : 'Add to a day…'], ...days.map((d, i) => [d, `Day ${i + 1} · ${fmtDay(d)}`])], '', { class: 'input', onchange: (e) => { if (e.target.value) this.addPlace(p, e.target.value, { open: false }); } });
    const save = (patch, label) => this.store.put('places', { ...this.store.get('places', id), ...patch }, { label }).catch(toastError);
    const stars = h('span', { class: 'tp-stars' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: n <= (p.rating || 0) ? 'on' : '', 'aria-label': `${n} stars`, onclick: () => save({ rating: p.rating === n ? null : n }, 'rating').then(() => this.openPlace(id)) }, '★')));
    const notes = textarea(p.notes || '', { placeholder: 'Notes: what to see, tickets, tips…', rows: 3 });
    notes.addEventListener('change', () => save({ notes: notes.value }, 'notes'));
    const files = this.store.all('files').filter((f) => f.placeId === id && !f.deleted);
    const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = photoIn.files[0]; if (!f) return; try { const up = await this.store.upload(f, { placeId: id }); await save({ image: up.id }, 'photo'); this.openPlace(id); } catch (err) { toastError(err); } } });
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: async () => { for (const f of fileIn.files) { try { await this.store.upload(f, { placeId: id }); } catch (err) { toastError(err); } } this.openPlace(id); } });
    const desc = h('p', { class: 'tp-desc' }, p.description || '');
    clear(this.panel,
      h('div', { class: 'tp-panel-head' }, h('b', {}, 'Place'), h('button', { class: 'tp-icon-btn', 'aria-label': 'Close', onclick: () => this.closePanel() }, '✕')),
      h('div', { class: 'tp-place-photo', style: img ? { backgroundImage: `url("${img}")` } : { background: catOf(p.category)[2] } }, img ? null : h('span', {}, catOf(p.category)[1]),
        h('button', { class: 'btn btn-sm tp-photo-btn', onclick: () => photoIn.click() }, img ? 'Change photo' : 'Add photo'), photoIn),
      h('div', { class: 'tp-place-body' },
        h('input', { class: 'tp-place-name', value: p.name, 'aria-label': 'Name', onchange: (e) => save({ name: e.target.value.trim() || p.name }, 'rename') }),
        h('div', { class: 'tp-row' }, select(Object.entries(CATEGORIES).map(([k, [l, e]]) => [k, `${e} ${l}`]), p.category || 'other', { class: 'input', onchange: (e) => save({ category: e.target.value }, 'kind').then(() => this.drawMap()) }), stars),
        p.address ? h('div', { class: 'tp-place-line' }, '📍 ', p.address) : null,
        p.hours ? h('div', { class: 'tp-place-line' }, '🕒 ', p.hours) : null,
        p.url ? h('div', { class: 'tp-place-line' }, '🔗 ', h('a', { href: /^https?:/.test(p.url) ? p.url : `https://${p.url}`, target: '_blank', rel: 'noopener' }, p.url.replace(/^https?:\/\//, ''))) : null,
        p.phone ? h('div', { class: 'tp-place-line' }, '📞 ', h('a', { href: `tel:${p.phone}` }, p.phone)) : null,
        desc,
        p.wikiUrl ? h('a', { class: 'small', href: p.wikiUrl, target: '_blank', rel: 'noopener' }, 'More on Wikipedia ↗') : null,
        dayPick,
        notes,
        h('div', { class: 'tp-files-mini' }, files.map((f) => h('a', { href: this.store.fileUrl(f.id), target: '_blank', rel: 'noopener', class: 'tp-chip' }, `📎 ${f.name}`)), h('button', { class: 'btn btn-sm', onclick: () => fileIn.click() }, '📎 Attach a file'), fileIn),
        h('details', { class: 'tp-nav' }, h('summary', {}, '🧭 Directions in…'), h('div', { class: 'tp-navlinks' }, navLinks(p).map(([n, u]) => h('a', { href: u, target: '_blank', rel: 'noopener', class: 'btn btn-sm' }, n)))),
        h('div', { class: 'tp-row' },
          h('button', { class: 'btn btn-sm', onclick: () => this.openExplore() }, '🧭 What’s nearby'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => { this.store.del('places', id, { label: `delete ${p.name}` }).catch(toastError); this.closePanel(); toast(`Deleted ${p.name}`, { timeout: 4000, action: { label: 'Undo', onClick: () => this.undo() } }); } }, 'Delete place'))));
    // A description and picture from Wikipedia, the first time.
    if (!p.description && !p.wikiChecked) {
      try {
        const w = await geo.wiki(p);
        const patch = { wikiChecked: true, ...(w ? { description: w.extract, wikiUrl: w.url, wikiImage: w.image } : {}) };
        await this.store.put('places', { ...this.store.get('places', id), ...patch }, { undoable: false });
        if (this.placeId === id) this.openPlace(id);
      } catch { /* no description */ }
    }
  }

  // --- Import and export ------------------------------------------------------------------------

  importExportMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    document.querySelector('.tp-menu')?.remove();
    const close = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (!menu.contains(e.target)) close(); };
    const item = (label, fn) => h('button', { onclick: () => { close(); fn(); } }, label);
    const menu = h('div', { class: 'tp-menu', style: { left: `${Math.min(r.left, innerWidth - 270)}px`, top: `${r.bottom + 4}px` } },
      h('div', { class: 'tp-menu-h' }, 'Import'),
      item('📂 A file (GPX, KML, KMZ, GeoJSON, Google Takeout)', () => this.importFile()),
      item('🔗 A Google Maps link', () => this.importLink()),
      h('div', { class: 'tp-menu-h' }, 'Export'),
      item('🧭 Places as GPX', () => this.exportGpx()),
      item('📅 Calendar (.ics)', () => { location.href = `/portal/trips/trip/${encodeURIComponent(this.store.id)}/ics`; }),
      item('🗺️ Today’s route in Google Maps', () => { const d = this.day || this.dayList()[0]; const u = d && googleDirections(this.stopsOf(d), this.modeOf(d)); if (u) window.open(u, '_blank', 'noopener'); else toast('Pick a day with places first', { timeout: 2000 }); }));
    document.body.append(menu);
    setTimeout(() => document.addEventListener('pointerdown', away, true));
  }

  async importFile() {
    const fileIn = h('input', { type: 'file', accept: '.gpx,.kml,.kmz,.geojson,.json,.csv', multiple: true });
    fileIn.onchange = async () => {
      const places = [];
      for (const f of fileIn.files) {
        try { places.push(...(await parsePlacesFile(f))); } catch (err) { toastError(err, `Couldn’t read ${f.name}`); }
      }
      this.confirmImport(places);
    };
    fileIn.click();
  }
  importLink() {
    const link = input({ type: 'url', placeholder: 'https://www.google.com/maps/dir/…  or  …/maps/place/…', autofocus: true });
    sheet(this.app.root, {
      title: 'Import from a Google Maps link',
      body: h('div', { class: 'tp-form' }, h('p', { class: 'muted small' }, 'Paste a link to directions (all the stops come in) or to a place.'), link),
      actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, submit: true, onClick: async (close) => {
        close();
        try { this.confirmImport(await parseGoogleLink(link.value.trim())); } catch (err) { toastError(err, 'That link couldn’t be read'); }
      } }],
    });
  }
  async confirmImport(places) {
    if (!places.length) { toast('No places found to import', { timeout: 2500 }); return; }
    const days = this.dayList();
    const where = select([['', 'Places to visit'], ...days.map((d, i) => [d, `Day ${i + 1} · ${fmtDay(d)}`])], this.day || '');
    const ok = await sheet(this.app.root, {
      title: `Import ${places.length} place${places.length === 1 ? '' : 's'}`,
      body: h('div', { class: 'tp-form' }, h('div', { class: 'tp-import-list' }, places.slice(0, 200).map((p) => h('div', {}, `📍 ${p.name}`, p.lat == null ? h('small', { class: 'muted' }, ' (will be looked up)') : null))), field('Add them to', where)),
      actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, value: true }],
    });
    if (!ok) return;
    let n = 0;
    for (const p of places) {
      let place = p;
      if (p.lat == null) {
        try { place = { ...(await geo.search(p.name))[0], notes: p.notes || '' }; } catch { place = null; }
        if (!place?.lat) continue;
      }
      await this.addPlace(place, where.value || null, { open: false, quiet: true });
      n++;
    }
    toast(`Imported ${n} place${n === 1 ? '' : 's'}`, { type: 'success', timeout: 2500 });
  }

  exportGpx() {
    const x = (s) => esc(s);
    const days = this.dayList();
    const wpts = this.store.all('places').filter((p) => Number.isFinite(p.lat)).map((p) => `  <wpt lat="${p.lat}" lon="${p.lon}"><name>${x(p.name)}</name>${p.notes ? `<desc>${x(p.notes)}</desc>` : ''}<type>${x(catOf(p.category)[0])}</type></wpt>`);
    const rtes = days.map((d, i) => { const s = this.stopsOf(d); return s.length ? `  <rte><name>Day ${i + 1} (${d})</name>\n${s.map((p) => `    <rtept lat="${p.lat}" lon="${p.lon}"><name>${x(p.name)}</name></rtept>`).join('\n')}\n  </rte>` : ''; }).filter(Boolean);
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MediaDesk Trip Planner" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${x(this.trip.title)}</name></metadata>\n${wpts.join('\n')}\n${rtes.join('\n')}\n</gpx>\n`;
    const a = h('a', { href: URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' })), download: `${this.trip.title.replace(/[^\w -]+/g, '')}.gpx` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}

// --- Reading places from files and links ---------------------------------------------------------

async function parsePlacesFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kmz')) {
    await new Promise((resolve, reject) => { if (window.JSZip) { resolve(); return; } const s = document.createElement('script'); s.src = '/vendor/jszip/jszip.min.js'; s.onload = resolve; s.onerror = reject; document.head.append(s); });
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const kml = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!kml) throw new Error('No KML inside');
    return parseXmlPlaces(await zip.file(kml).async('string'));
  }
  const text = await file.text();
  if (name.endsWith('.gpx') || name.endsWith('.kml')) return parseXmlPlaces(text);
  if (name.endsWith('.csv')) {
    // Google Takeout saved lists: Title, Note, URL (no coordinates: looked up by name).
    const rows = text.split(/\r?\n/).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || []);
    const head = rows.shift()?.map((x) => x.toLowerCase()) || [];
    const ti = head.indexOf('title');
    const ni = head.indexOf('note');
    return rows.filter((r) => r[ti]).slice(0, 100).map((r) => ({ name: r[ti], notes: ni >= 0 ? r[ni] : '', lat: null }));
  }
  // GeoJSON (Google Takeout's "Saved Places.json" too).
  const json = JSON.parse(text);
  const feats = json.type === 'FeatureCollection' ? json.features : json.type === 'Feature' ? [json] : [];
  return feats.filter((f) => f.geometry?.type === 'Point').map((f) => {
    const pr = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const loc = pr.location || pr.Location || {};
    return { name: pr.name || pr.Title || pr.title || loc.name || loc['Business Name'] || 'Place', lat, lon, address: loc.address || loc.Address || pr.address || '', notes: pr.description || pr.Comment || '', url: pr.google_maps_url || null };
  }).filter((p) => Number.isFinite(p.lat) && (p.lat || p.lon));
}

function parseXmlPlaces(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const out = [];
  const val = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent.trim() || '';
  // GPX waypoints and route points.
  for (const el of [...doc.getElementsByTagName('wpt'), ...doc.getElementsByTagName('rtept')]) {
    out.push({ name: val(el, 'name') || 'Waypoint', lat: Number(el.getAttribute('lat')), lon: Number(el.getAttribute('lon')), notes: val(el, 'desc') });
  }
  // KML placemarks with a point.
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const pt = pm.getElementsByTagName('Point')[0];
    if (!pt) continue;
    const [lon, lat] = val(pt, 'coordinates').split(',').map(Number);
    out.push({ name: val(pm, 'name') || 'Place', lat, lon, notes: val(pm, 'description').replace(/<[^>]+>/g, ' ').trim() });
  }
  return out.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

// Google Maps links: directions (/maps/dir/A/B/C), a place (/maps/place/Name/@lat,lon), or ?q=.
async function parseGoogleLink(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error('That isn’t a link'); }
  if (/goo\.gl|maps\.app/.test(url.hostname)) throw new Error('Short links can’t be read: open the link and copy the full address from the browser');
  const coord = (s) => { const m = /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/.exec(s.trim()); return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null; };
  const parts = url.pathname.split('/').map((s) => decodeURIComponent(s.replace(/\+/g, ' '))).filter(Boolean);
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url.pathname);
  const out = [];
  const di = parts.indexOf('dir');
  if (di >= 0) {
    for (const s of parts.slice(di + 1)) {
      if (s.startsWith('@') || s.startsWith('data=') || s.startsWith('am=')) break;
      const c = coord(s);
      out.push(c ? { name: `Stop ${out.length + 1}`, ...c } : { name: s.split(',')[0], lat: null, query: s });
    }
  } else if (parts.includes('place')) {
    const name = parts[parts.indexOf('place') + 1] || 'Place';
    out.push(at ? { name, lat: Number(at[1]), lon: Number(at[2]) } : { name, lat: null });
  } else if (url.searchParams.get('q') || url.searchParams.get('query')) {
    const s = url.searchParams.get('q') || url.searchParams.get('query');
    const c = coord(s);
    out.push(c ? { name: 'Place', ...c } : { name: s, lat: null });
  } else if (at) out.push({ name: 'Place', lat: Number(at[1]), lon: Number(at[2]) });
  if (!out.length) throw new Error('No places in that link');
  return out.map((p) => (p.query ? { ...p, name: p.query } : p));
}
