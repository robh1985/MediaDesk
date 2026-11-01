// Trip Planner: the atlas. A map of the world with the countries you've been to (from your trips,
// and any you mark yourself) and the ones on your bucket list.

import { h, clear, toastError } from '../../ui.js';
import { api } from './store.js';
import { loadLeaflet } from './map.js';
import { emptyState, fmtRange } from './util.js';

let world = null;
// TopoJSON to GeoJSON (world-atlas uses quantised arcs).
async function loadWorld() {
  if (world) return world;
  world = Promise.all([fetch('/vendor/world-atlas/countries-50m.json').then((r) => r.json()), fetch('/vendor/world-atlas/iso-numeric.json').then((r) => r.json())]).then(([topo, iso]) => {
    const { scale: [kx, ky], translate: [dx, dy] } = topo.transform;
    const arcs = topo.arcs.map((arc) => { let x = 0; let y = 0; return arc.map(([a, b]) => { x += a; y += b; return [x * kx + dx, y * ky + dy]; }); });
    // Rings that cross the date line are kept in one piece (longitudes past ±180), so no lines
    // are drawn across the whole map.
    const line = (ids) => {
      const out = [];
      for (const i of ids) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; out.push(...(out.length ? a.slice(1) : a)); }
      for (let k = 1; k < out.length; k++) { const d = out[k][0] - out[k - 1][0]; if (Math.abs(d) > 180) out[k] = [out[k][0] - Math.sign(d) * 360, out[k][1]]; }
      return out;
    };
    const features = topo.objects.countries.geometries.filter((g) => g.arcs && g.id !== '010').map((g) => ({
      type: 'Feature', id: iso[g.id] || g.id, properties: { name: g.properties.name, code: iso[g.id] || null },
      geometry: g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.arcs.map(line) } : { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(line)) },
    }));
    return { type: 'FeatureCollection', features };
  });
  return world;
}

const COLORS = { trip: '#2f9e44', visited: '#51cf66', bucket: '#fab005', none: 'transparent' };

export class AtlasView {
  constructor(app) { this.app = app; }

  async render(el) {
    this.el = el;
    clear(el, h('div', { class: 'tp-loading' }, 'Loading the atlas…'));
    let data;
    let geo;
    try { [data, geo] = await Promise.all([api('atlas'), loadWorld()]); await loadLeaflet(); } catch (err) { clear(el, emptyState('⚠️', err.message)); return; }
    this.data = data;
    this.geo = geo;
    this.fromTrips = new Map();
    for (const trip of data.trips) for (const c of trip.countries) { if (!this.fromTrips.has(c)) this.fromTrips.set(c, []); this.fromTrips.get(c).push(trip); }
    this.mapEl = h('div', { class: 'tp-atlas-map' });
    this.stats = h('div', { class: 'tp-atlas-stats' });
    this.listEl = h('div', { class: 'tp-atlas-list' });
    clear(el, h('div', { class: 'tp-atlas' },
      h('header', { class: 'tp-trip-head' },
        h('button', { class: 'tp-icon-btn', 'aria-label': 'All trips', onclick: () => this.app.showDashboard() }, '←'),
        h('div', { class: 'tp-trip-title' }, h('span', { class: 'tp-trip-cover' }, '🌍'), h('div', {}, h('h2', {}, 'Atlas'), h('p', { class: 'muted small' }, 'Click a country to mark it visited, then on your bucket list, then neither.')))),
      h('div', { class: 'tp-atlas-body' }, this.mapEl, h('aside', { class: 'tp-atlas-side' }, this.stats, h('div', { class: 'tp-legend' },
        h('span', {}, h('i', { style: { background: COLORS.trip } }), 'On a trip'), h('span', {}, h('i', { style: { background: COLORS.visited } }), 'Been there'), h('span', {}, h('i', { style: { background: COLORS.bucket } }), 'Bucket list')), this.listEl))));
    const L = window.L;
    this.map = L.map(this.mapEl, { worldCopyJump: true, minZoom: 1, maxZoom: 7, zoomSnap: 0.25, attributionControl: true }).setView([30, 10], 1.75);
    this.map.attributionControl.addAttribution('Countries: <a href="https://github.com/topojson/world-atlas" target="_blank" rel="noopener">Natural Earth via world-atlas</a>');
    new ResizeObserver(() => this.map.invalidateSize()).observe(this.mapEl);
    this.layer = L.geoJSON(geo, {
      style: (f) => this.style(f),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(() => `${f.properties.name}${this.fromTrips.has(f.properties.code) ? ` — ${this.fromTrips.get(f.properties.code).map((x) => x.title).join(', ')}` : ''}`, { sticky: true });
        layer.on('click', () => this.toggle(f.properties.code));
        layer.on('mouseover', () => layer.setStyle({ weight: 2 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 0.6 }));
      },
    }).addTo(this.map);
    this.drawSide();
  }
  destroy() { this.map?.remove(); }

  state(code) {
    if (this.fromTrips.has(code)) return 'trip';
    if (this.data.visited.includes(code)) return 'visited';
    if (this.data.bucket.includes(code)) return 'bucket';
    return 'none';
  }
  style(f) {
    const s = this.state(f.properties.code);
    const dark = document.documentElement.dataset.theme === 'dark';
    return { color: dark ? '#5c5f66' : '#adb5bd', weight: 0.6, fillColor: s === 'none' ? (dark ? '#2c2e33' : '#f1f3f5') : COLORS[s], fillOpacity: 1 };
  }

  async toggle(code) {
    if (!code || this.fromTrips.has(code)) return;
    const s = this.state(code);
    const visited = this.data.visited.filter((c) => c !== code);
    const bucket = this.data.bucket.filter((c) => c !== code);
    if (s === 'none') visited.push(code); else if (s === 'visited') bucket.push(code);
    Object.assign(this.data, { visited, bucket });
    this.layer.setStyle((f) => this.style(f));
    this.drawSide();
    try { await api('atlas', { method: 'POST', body: { visited, bucket } }); } catch (err) { toastError(err); }
  }

  drawSide() {
    const names = Object.fromEntries(this.geo.features.map((f) => [f.properties.code, f.properties.name]));
    const been = new Set([...this.fromTrips.keys(), ...this.data.visited].filter((c) => names[c]));
    const total = new Set(Object.keys(names).filter(Boolean)).size;
    clear(this.stats,
      h('div', { class: 'tp-stat' }, h('b', {}, been.size), h('small', {}, 'countries')),
      h('div', { class: 'tp-stat' }, h('b', {}, `${Math.round((been.size / total) * 100)}%`), h('small', {}, 'of the world')),
      h('div', { class: 'tp-stat' }, h('b', {}, this.data.trips.length), h('small', {}, 'trips')),
      h('div', { class: 'tp-stat' }, h('b', {}, this.data.bucket.length), h('small', {}, 'on the bucket list')));
    const flag = (c) => String.fromCodePoint(...[...c].map((x) => 0x1f1e6 + x.charCodeAt(0) - 65));
    const row = (c) => h('div', { class: 'tp-atlas-row' }, h('span', {}, `${flag(c)} ${names[c] || c}`), this.fromTrips.has(c) ? h('small', { class: 'muted' }, this.fromTrips.get(c).map((x) => `${x.title}${x.start ? ` (${fmtRange(x.start, x.end)})` : ''}`).join(', ')) : null);
    clear(this.listEl,
      h('h5', {}, 'Been there'), been.size ? [...been].sort((a, b) => (names[a] || a).localeCompare(names[b] || b)).map(row) : h('p', { class: 'muted small' }, 'Places on your trips appear here.'),
      h('h5', {}, 'Bucket list'), this.data.bucket.length ? this.data.bucket.slice().sort((a, b) => (names[a] || a).localeCompare(names[b] || b)).map(row) : h('p', { class: 'muted small' }, 'Click a country twice to put it on your bucket list.'));
  }
}
