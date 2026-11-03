// Maps: a world map with base maps (streets, terrain, satellite, topographic, lidar relief…) and
// layers on top (hillshade, lidar, trails, railways, sea marks, weather radar), each with its own
// opacity. Search for places, click anywhere for what's there and the height of the ground, find
// yourself, and measure distances and areas. Everything here is free to use without a key; the
// browser loads the map pictures straight from their providers.

import { h, clear, toast, toastError, debounce } from '../ui.js';
import { appIcon, icon } from '../icons.js';
import { loadLeaflet } from './trips/map.js';
import { RoutePlanner } from './maps-route.js';
import { contextMenu } from '../ui.js';

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const ESRI = 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>';
const USGS = '<a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS 3DEP</a>';
const ARC = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const DEP = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';

// Base maps: [name, what it is, url or { lidar: rendering }, attribution, max zoom, extra options].
const BASES = {
  streets: ['Streets', 'OpenStreetMap', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM, 19],
  terrain: ['Terrain', 'Contours and hill shading (OpenTopoMap)', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', `Map data ${OSM}, SRTM | Style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>`, 17],
  satellite: ['Satellite', 'Aerial and satellite photos (Esri World Imagery)', `${ARC}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, `${ESRI} — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`, 19],
  hybrid: ['Hybrid', 'Satellite with roads and place names', `${ARC}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, `${ESRI} — Source: Esri, Maxar, Earthstar Geographics`, 19, { labels: true }],
  topo: ['Topographic', 'Esri World Topographic Map', `${ARC}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, `${ESRI} — Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS`, 19],
  usgs: ['USGS Topo', 'US topographic maps (United States)', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', 'Tiles courtesy of the <a href="https://usgs.gov/" target="_blank" rel="noopener">U.S. Geological Survey</a>', 16],
  lidar: ['Lidar relief', 'Bare-earth lidar hillshade, United States (USGS 3DEP)', { lidar: 'Hillshade Multidirectional' }, USGS, 19],
  light: ['Light', 'Pale streets (CARTO)', 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`, 20],
  dark: ['Dark', 'Dark streets (CARTO)', 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`, 20],
  cycle: ['Cycling', 'Cycle lanes and routes (CyclOSM)', 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', `${OSM} | <a href="https://www.cyclosm.org" target="_blank" rel="noopener">CyclOSM</a>`, 20],
  hot: ['Humanitarian', 'OpenStreetMap humanitarian style', 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', `${OSM}, tiles by the Humanitarian OpenStreetMap Team`, 19],
  night: ['Night lights', 'Earth at night (NASA Black Marble)', 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png', 'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>', 12, { maxNativeZoom: 8 }],
};

// Layers on top: [name, what it is, url, attribution, max zoom, default opacity, extra].
const OVERLAYS = {
  hillshade: ['Hillshade', 'Shaded relief, worldwide (Esri)', `${ARC}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`, ESRI, 19, 0.45, { blend: 'multiply' }],
  lidarShade: ['Lidar hillshade', 'Bare-earth lidar, United States (USGS 3DEP)', { lidar: 'Hillshade Gray' }, USGS, 19, 0.6, { blend: 'multiply', group: 'Lidar (United States)' }],
  lidarMulti: ['Lidar multidirectional', 'Lit from six directions: shows banks, ditches and old earthworks', { lidar: 'Hillshade Multidirectional' }, USGS, 19, 0.6, { blend: 'multiply', group: 'Lidar (United States)' }],
  lidarSlope: ['Lidar slope', 'Steepness from lidar (steeper is darker)', { lidar: 'Slope Degrees' }, USGS, 19, 0.5, { blend: 'multiply', group: 'Lidar (United States)' }],
  labels: ['Labels', 'Place names and borders', `${ARC}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, ESRI, 19, 1],
  roads: ['Roads', 'Road names (for satellite)', `${ARC}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, ESRI, 19, 1],
  hiking: ['Hiking trails', 'Marked walking routes (Waymarked Trails)', 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', `${OSM} | <a href="https://waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a>`, 18, 0.9],
  cycling: ['Cycle routes', 'Signed cycle routes (Waymarked Trails)', 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png', `${OSM} | <a href="https://waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a>`, 18, 0.9],
  rail: ['Railways', 'Rail lines and stations (OpenRailwayMap)', 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', `${OSM} | <a href="https://www.openrailwaymap.org" target="_blank" rel="noopener">OpenRailwayMap</a>`, 19, 0.9],
  sea: ['Sea marks', 'Buoys, lights and harbours (OpenSeaMap)', 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', `<a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a>`, 18, 1],
  radar: ['Weather radar', 'Rain and snow in the last few minutes (RainViewer)', { radar: true }, '<a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>', 19, 0.7, { maxNativeZoom: 7 }],
};
const GROUPS = [['Terrain', ['hillshade']], ['Lidar (United States)', ['lidarShade', 'lidarMulti', 'lidarSlope']], ['Labels', ['labels', 'roads']], ['Routes', ['hiking', 'cycling', 'rail', 'sea']], ['Weather', ['radar']]];

const PREFS = 'mediadesk.maps';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* full */ } };

async function api(path) {
  const res = await fetch(`/portal/maps${path}`, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Lidar from the USGS 3D Elevation Program: an ArcGIS image service drawn with one of its
// renderings, asked for one map tile at a time.
function lidarLayer(L, rendering, opts) {
  const Layer = L.TileLayer.extend({
    getTileUrl(c) {
      const size = this.getTileSize();
      const nw = L.point(c.x * size.x, c.y * size.y);
      const se = nw.add(size);
      const crs = L.CRS.EPSG3857;
      const a = crs.project(this._map.unproject(nw, c.z));
      const b = crs.project(this._map.unproject(se, c.z));
      const p = new URLSearchParams({
        bbox: [a.x, b.y, b.x, a.y].map((n) => n.toFixed(2)).join(','), bboxSR: '3857', imageSR: '3857', size: `${size.x},${size.y}`,
        format: 'png', transparent: 'true', f: 'image', renderingRule: JSON.stringify({ rasterFunction: rendering }),
      });
      return `${DEP}/exportImage?${p}`;
    },
  });
  return new Layer('', opts);
}

// The latest radar picture from RainViewer.
let radarInfo = null;
async function radarUrl() {
  if (!radarInfo || Date.now() - radarInfo.at > 5 * 60e3) {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json').then((x) => x.json());
    const last = r.radar?.past?.at(-1);
    if (!last) throw new Error('No radar picture right now');
    radarInfo = { at: Date.now(), url: `${r.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`, time: last.time * 1000 };
  }
  return radarInfo;
}

function makeLayer(L, def, extra = {}) {
  const [, , url, attribution, maxZoom, opacity, more = {}] = def;
  const opts = { attribution, maxZoom: 20, maxNativeZoom: more.maxNativeZoom || maxZoom, subdomains: 'abc', crossOrigin: false, referrerPolicy: 'strict-origin-when-cross-origin', opacity: opacity ?? 1, ...extra };
  if (url?.lidar) return lidarLayer(L, url.lidar, opts);
  return L.tileLayer(url, opts);
}

// Distances and areas, in the units chosen.
const fmtDist = (m, miles) => (miles ? (m < 1609.344 * 0.2 ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${(m / 1609.344).toLocaleString(undefined, { maximumFractionDigits: m < 16093 ? 2 : 1 })} mi`) : (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: m < 10000 ? 2 : 1 })} km`));
const fmtArea = (m2, miles) => (miles ? (m2 < 2589988 * 0.05 ? `${(m2 / 4046.856).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres` : `${(m2 / 2589988).toLocaleString(undefined, { maximumFractionDigits: 2 })} sq mi`) : (m2 < 1e6 ? `${(m2 / 1e4).toLocaleString(undefined, { maximumFractionDigits: 2 })} ha` : `${(m2 / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`));
const fmtHeight = (m, miles) => (miles ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);
// The area of a polygon on the Earth (spherical excess, good enough for fields and towns).
function geoArea(pts) {
  const R = 6378137, rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += (b.lng - a.lng) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs((s * R * R) / 2);
}
const dms = (v, pos, neg) => {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v >= 0 ? pos : neg}`;
};

export const mapsApp = {
  id: 'maps', name: 'Maps', icon: appIcon.maps, size: [1180, 760], description: 'Maps with satellite, terrain, lidar and more layers',
  open(win, opts = {}) {
    if (!document.querySelector('link[data-css=maps]')) document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/maps.css', import.meta.url).href, 'data-css': 'maps' }));
    new MapsApp(win, opts);
  },
};

class MapsApp {
  constructor(win, opts) {
    this.win = win;
    const saved = readPrefs();
    this.prefs = { base: 'streets', overlays: {}, center: [39.5, -98.35], zoom: 4, miles: true, ...saved };
    if (!BASES[this.prefs.base]) this.prefs.base = 'streets';
    this.layers = {};
    this.measure = null;
    // For the route planner.
    this.api = api;
    this.fmtDist = fmtDist;
    this.build();
    this.start(opts).catch((err) => clear(this.mapEl, h('div', { class: 'empty error' }, err.message)));
  }

  build() {
    this.mapEl = h('div', { class: 'mp-map' });
    this.search = h('input', { class: 'input mp-search', type: 'search', placeholder: 'Search for a place or address, or paste coordinates…', autocomplete: 'off', spellcheck: 'false' });
    this.results = h('div', { class: 'mp-results', hidden: true });
    this.panel = h('div', { class: 'mp-panel', hidden: true });
    this.status = h('div', { class: 'mp-status' });
    const tool = (title, ic, onclick, cls = '') => h('button', { class: `mp-tool ${cls}`, type: 'button', title, 'aria-label': title, html: ic, onclick });
    this.layersBtn = tool('Map layers', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>', () => this.togglePanel());
    this.measureBtn = tool('Measure distance and area', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>', () => this.toggleMeasure());
    this.locateBtn = tool('Show where I am', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>', () => this.locate());
    this.routeBtn = tool('Directions', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 12l10 10 10-10z"/><path d="M9 14v-2a2 2 0 0 1 2-2h4M13 8l2 2-2 2"/></svg>', () => (this.planner.open ? this.planner.hide() : this.planner.show()), 'mp-route-btn');
    this.unitsBtn = h('button', { class: 'mp-tool mp-units', type: 'button', title: 'Miles or kilometres', onclick: () => { this.prefs.miles = !this.prefs.miles; this.save(); this.drawUnits(); } });
    const bar = h('div', { class: 'mp-bar' }, h('div', { class: 'mp-searchbox' }, h('span', { class: 'mp-searchicon', html: icon.search }), this.search, this.results),
      h('div', { class: 'mp-tools' }, this.routeBtn, this.layersBtn, this.measureBtn, this.locateBtn, this.unitsBtn));
    this.measureBox = h('div', { class: 'mp-measure', hidden: true });
    this.planner = new RoutePlanner(this);
    this.win.body.append(h('div', { class: 'mp' }, this.mapEl, bar, this.panel, this.planner.el, this.measureBox, this.status));
    this.drawUnits();
    this.search.addEventListener('input', debounce(() => this.suggest(), 250));
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.find(); }
      if (e.key === 'Escape') { this.results.hidden = true; }
      if (e.key === 'ArrowDown') { this.results.querySelector('button')?.focus(); e.preventDefault(); }
    });
  }

  async start(opts) {
    const L = this.L = await loadLeaflet();
    const map = this.map = L.map(this.mapEl, { zoomControl: false, worldCopyJump: true, attributionControl: true }).setView(this.prefs.center, this.prefs.zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    this.scale = L.control.scale({ position: 'bottomleft', imperial: this.prefs.miles, metric: !this.prefs.miles }).addTo(map);
    this.setBase(this.prefs.base);
    for (const [k, v] of Object.entries(this.prefs.overlays)) if (v?.on && OVERLAYS[k]) this.setOverlay(k, true, v.opacity);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(this.mapEl);
    this.win.on?.('close', () => ro.disconnect());
    map.on('moveend zoomend', () => { const c = map.getCenter(); this.prefs.center = [+c.lat.toFixed(5), +c.lng.toFixed(5)]; this.prefs.zoom = map.getZoom(); this.save(); this.drawStatus(); });
    map.on('mousemove', (e) => { this.cursor = e.latlng; this.drawStatus(); });
    map.on('click', (e) => (this.planner.picking >= 0 ? this.planner.pick(e.latlng) : this.measure ? this.addMeasurePoint(e.latlng) : this.whatsHere(e.latlng)));
    // Right-click (or long-press): directions from or to here, what's here.
    map.on('contextmenu', (e) => {
      const ev = e.originalEvent;
      ev.preventDefault();
      const here = () => ({ lat: +e.latlng.lat.toFixed(6), lon: +L.Util.wrapNum(e.latlng.lng, [-180, 180], true).toFixed(6), name: '' });
      const put = (which) => { const p = here(); this.planner.setPoint(which, p); this.planner.nameIt(p); };
      contextMenu(ev.clientX, ev.clientY, [
        { label: 'Directions from here', icon: icon.arrowUp, action: () => put('from') },
        { label: 'Directions to here', icon: icon.download, action: () => put('to') },
        ...(this.planner.points.filter(Boolean).length >= 2 ? [{ label: 'Add a stop here', icon: icon.plus, action: () => put('stop') }] : []),
        '-',
        { label: 'What’s here?', icon: icon.search, action: () => this.whatsHere(e.latlng) },
        { label: 'Copy coordinates', action: () => { navigator.clipboard?.writeText(`${here().lat}, ${here().lon}`); toast('Copied', { timeout: 1200 }); } },
      ]);
    });
    this.drawStatus();
    if (opts.lat != null && opts.lon != null) this.show({ lat: opts.lat, lon: opts.lon, name: opts.name || '' }, opts.zoom || 15);
  }

  save() { writePrefs({ base: this.prefs.base, overlays: this.prefs.overlays, center: this.prefs.center, zoom: this.prefs.zoom, miles: this.prefs.miles, routeMode: this.prefs.routeMode, routeAvoid: this.prefs.routeAvoid }); }

  // ---- Layers ----
  setBase(key) {
    const L = this.L;
    if (this.base) this.map.removeLayer(this.base);
    if (this.baseLabels) { this.map.removeLayer(this.baseLabels); this.baseLabels = null; }
    const def = BASES[key];
    this.base = makeLayer(L, [def[0], def[1], def[2], def[3], def[4], 1, def[5]]).addTo(this.map);
    this.base.bringToBack();
    if (def[5]?.labels) {
      this.baseLabels = makeLayer(L, OVERLAYS.labels, { pane: 'overlayPane' }).addTo(this.map);
      this.baseLabels.setZIndex(50);
    }
    this.mapEl.dataset.base = key;
    this.prefs.base = key;
    this.save();
    if (!this.panel.hidden) this.drawPanel();
  }

  async setOverlay(key, on, opacity) {
    const def = OVERLAYS[key];
    const cur = this.prefs.overlays[key] || { opacity: def[5] };
    if (opacity != null) cur.opacity = opacity;
    cur.on = on;
    this.prefs.overlays[key] = cur;
    this.save();
    if (this.layers[key]) { this.map.removeLayer(this.layers[key]); delete this.layers[key]; }
    if (!on) return;
    let extra = {};
    if (def[2]?.radar) {
      try { const r = await radarUrl(); extra = { attribution: `${def[3]} · ${new Date(r.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` }; def[2] = { radar: true, url: r.url }; } catch (err) { toastError(err, 'The weather radar couldn’t be loaded'); cur.on = false; this.save(); this.drawPanel(); return; }
    }
    const layer = def[2]?.radar ? this.L.tileLayer(def[2].url, { attribution: extra.attribution, opacity: cur.opacity, maxNativeZoom: 7, maxZoom: 20 }) : makeLayer(this.L, def, { opacity: cur.opacity });
    layer.addTo(this.map);
    const order = Object.keys(OVERLAYS).indexOf(key);
    layer.setZIndex(10 + order);
    if (def[6]?.blend) layer.getContainer().style.mixBlendMode = def[6].blend;
    this.layers[key] = layer;
  }

  togglePanel() {
    this.panel.hidden = !this.panel.hidden;
    this.layersBtn.classList.toggle('on', !this.panel.hidden);
    if (!this.panel.hidden) this.drawPanel();
  }

  drawPanel() {
    const ov = (key) => {
      const def = OVERLAYS[key];
      const cur = this.prefs.overlays[key] || { opacity: def[5] };
      const on = Boolean(this.prefs.overlays[key]?.on);
      const box = h('input', { type: 'checkbox', checked: on, onchange: async () => { const p = this.setOverlay(key, box.checked); this.drawPanel(); await p; if (!this.panel.hidden) this.drawPanel(); } });
      const slider = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: cur.opacity, class: 'mp-opacity', 'aria-label': `${def[0]} opacity`, disabled: !on,
        oninput: () => { this.layers[key]?.setOpacity(Number(slider.value)); cur.opacity = Number(slider.value); this.prefs.overlays[key] = { ...cur, on: true }; this.save(); } });
      return h('div', { class: `mp-ov ${on ? 'on' : ''}` }, h('label', { class: 'mp-ov-name', title: def[1] }, box, h('span', {}, h('b', {}, def[0]), h('small', {}, def[1]))), slider);
    };
    clear(this.panel,
      h('div', { class: 'mp-panel-head' }, h('b', {}, 'Map'), h('button', { class: 'btn btn-icon btn-sm', title: 'Close', html: icon.x, onclick: () => this.togglePanel() })),
      h('div', { class: 'mp-bases' }, Object.entries(BASES).map(([k, d]) => h('button', { type: 'button', class: `mp-base ${this.prefs.base === k ? 'on' : ''}`, dataset: { base: k }, title: d[1], onclick: () => this.setBase(k) },
        h('span', { class: `mp-thumb mp-thumb-${k}` }), h('span', {}, d[0])))),
      GROUPS.map(([g, keys]) => h('div', { class: 'mp-group' }, h('div', { class: 'mp-group-title' }, g), keys.map(ov))),
      h('p', { class: 'small muted mp-note' }, 'Lidar layers cover the United States (USGS 3D Elevation Program) and show the bare ground, without trees or buildings. Zoom in for the finest detail.'));
  }

  // ---- Search ----
  async suggest() {
    const q = this.search.value.trim();
    if (q.length < 3 || this.coords(q)) { this.results.hidden = true; return; }
    try { this.showResults((await api(`/suggest?${new URLSearchParams({ q })}`)).places, q); } catch { /* typing on */ }
  }
  coords(q) {
    const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  async find() {
    const q = this.search.value.trim();
    if (!q) return;
    const c = this.coords(q);
    if (c) { this.show({ ...c, name: `${c.lat}, ${c.lon}` }, 15); this.whatsHere(this.L.latLng(c.lat, c.lon)); return; }
    try {
      const c2 = this.map.getCenter();
      const places = (await api(`/search?${new URLSearchParams({ q, near: `${c2.lat},${c2.lng}` })}`)).places;
      if (!places.length) { toast('Nothing found', { body: q, timeout: 2500 }); return; }
      if (places.length === 1) { this.results.hidden = true; this.show(places[0]); } else this.showResults(places, q);
    } catch (err) { toastError(err, 'Search didn’t work'); }
  }
  showResults(places, q) {
    if (!places.length || this.search.value.trim() !== q) { this.results.hidden = true; return; }
    clear(this.results, places.slice(0, 8).map((p) => h('button', { type: 'button', class: 'mp-result', onclick: () => { this.results.hidden = true; this.search.value = p.name; this.show(p); },
      onkeydown: (e) => { if (e.key === 'ArrowDown') e.target.nextElementSibling?.focus(); if (e.key === 'ArrowUp') (e.target.previousElementSibling || this.search).focus(); } },
    h('b', {}, p.name), h('small', {}, p.address && p.address !== p.name ? p.address : ''))));
    this.results.hidden = false;
  }
  show(p, zoom) {
    const L = this.L;
    const kind = p.kind || p.category;
    const z = zoom || ({ country: 5, state: 7, region: 7, county: 9, city: 12, town: 13, village: 14 }[kind] || 16);
    this.map.setView([p.lat, p.lon], z);
    this.pin?.remove();
    this.pin = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'mp-pin', html: '<div></div>', iconSize: [26, 34], iconAnchor: [13, 32] }) }).addTo(this.map);
    this.pin.on('click', () => this.whatsHere(L.latLng(p.lat, p.lon), p));
  }

  // ---- What's here ----
  async whatsHere(ll, known = null) {
    const L = this.L;
    const lat = +ll.lat.toFixed(6), lon = +L.Util.wrapNum(ll.lng, [-180, 180], true).toFixed(6);
    const coord = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const height = h('div', { class: 'mp-pop-row' }, 'Height: …');
    const place = h('div', { class: 'mp-pop-place' }, known?.name ? h('b', {}, known.name) : 'Looking…');
    const body = h('div', { class: 'mp-pop' }, place,
      h('div', { class: 'mp-pop-row mp-mono' }, coord, h('button', { class: 'mp-copy', type: 'button', title: 'Copy', onclick: () => { navigator.clipboard?.writeText(coord); toast('Copied', { timeout: 1200 }); } }, 'Copy')),
      h('div', { class: 'mp-pop-row mp-mono small' }, `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`),
      height,
      h('div', { class: 'mp-pop-dir' },
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => { this.map.closePopup(); this.planner.setPoint('to', { lat, lon, name: place.querySelector('b')?.textContent && place.querySelector('b').textContent !== 'Here' ? place.querySelector('b').textContent : coord }); } }, 'Directions to here'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { this.map.closePopup(); this.planner.setPoint('from', { lat, lon, name: place.querySelector('b')?.textContent && place.querySelector('b').textContent !== 'Here' ? place.querySelector('b').textContent : coord }); } }, 'From here')),
      h('div', { class: 'mp-pop-links' },
        h('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`, target: '_blank', rel: 'noopener' }, 'OpenStreetMap'),
        h('a', { href: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, target: '_blank', rel: 'noopener' }, 'Google Maps')));
    L.popup({ maxWidth: 320, className: 'mp-popup' }).setLatLng(ll).setContent(body).openOn(this.map);
    api(`/elevation?lat=${lat}&lon=${lon}`).then((r) => { clear(height, `Height: `, h('b', {}, fmtHeight(r.meters, this.prefs.miles)), h('small', { class: 'muted' }, ` · ${r.source}`)); }).catch(() => { clear(height, h('span', { class: 'muted' }, 'Height not available')); });
    if (!known?.name) api(`/reverse?lat=${lat}&lon=${lon}`).then((r) => { clear(place, h('b', {}, r.place?.name || 'Here'), r.place?.address && r.place.address !== r.place.name ? h('div', { class: 'small muted' }, r.place.address) : null); }).catch(() => { clear(place, h('b', {}, 'Here')); });
  }

  // ---- Where am I ----
  locate() {
    if (!navigator.geolocation) { toast('This browser can’t tell where you are'); return; }
    if (!window.isSecureContext) { toast('Finding you needs MediaDesk’s https:// address', { type: 'error' }); return; }
    this.locateBtn.classList.add('busy');
    navigator.geolocation.getCurrentPosition((pos) => {
      this.locateBtn.classList.remove('busy');
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      this.me?.remove();
      this.me = this.L.layerGroup([
        this.L.circle([lat, lon], { radius: accuracy, color: '#3b82f6', weight: 1, fillOpacity: 0.12 }),
        this.L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 }),
      ]).addTo(this.map);
      this.map.setView([lat, lon], Math.max(this.map.getZoom(), 15));
    }, (err) => { this.locateBtn.classList.remove('busy'); toastError(new Error(err.code === 1 ? 'Location isn’t allowed for this site' : err.message), 'Couldn’t find you'); }, { enableHighAccuracy: true, timeout: 15000 });
  }

  // ---- Measuring ----
  toggleMeasure() {
    if (this.measure) {
      this.measure.group.remove();
      this.measure = null;
      this.measureBox.hidden = true;
      this.measureBtn.classList.remove('on');
      this.mapEl.classList.remove('measuring');
      return;
    }
    this.map.closePopup();
    this.measure = { pts: [], group: this.L.layerGroup().addTo(this.map), closed: false };
    this.measureBtn.classList.add('on');
    this.mapEl.classList.add('measuring');
    this.drawMeasure();
  }
  addMeasurePoint(ll) {
    const m = this.measure;
    if (m.closed) { m.pts = []; m.closed = false; }
    m.pts.push(ll);
    this.drawMeasure();
  }
  drawMeasure() {
    const m = this.measure, L = this.L;
    m.group.clearLayers();
    let dist = 0;
    for (let i = 1; i < m.pts.length; i++) dist += m.pts[i - 1].distanceTo(m.pts[i]);
    if (m.pts.length > 1) (m.closed ? L.polygon(m.pts, { color: '#e8590c', weight: 3, fillOpacity: 0.15 }) : L.polyline(m.pts, { color: '#e8590c', weight: 3, dashArray: '6 6' })).addTo(m.group);
    m.pts.forEach((p, i) => L.circleMarker(p, { radius: 5, color: '#e8590c', weight: 2, fillColor: '#fff', fillOpacity: 1 })
      .on('click', (e) => { L.DomEvent.stop(e); if (i === 0 && m.pts.length > 2) { m.closed = true; this.drawMeasure(); } }).addTo(m.group));
    const miles = this.prefs.miles;
    const total = m.closed ? dist + m.pts.at(-1).distanceTo(m.pts[0]) : dist;
    clear(this.measureBox,
      h('div', {}, h('b', {}, m.pts.length < 2 ? 'Click the map to measure' : m.closed ? `Area ${fmtArea(geoArea(m.pts), miles)}` : `Distance ${fmtDist(dist, miles)}`)),
      h('div', { class: 'small muted' }, m.pts.length < 2 ? 'Click points along the way; click the first point again to measure an area.' : m.closed ? `Around the edge ${fmtDist(total, miles)}` : 'Click the first point to close the shape and get its area.'),
      h('div', { class: 'btn-row' },
        m.pts.length ? h('button', { class: 'btn btn-sm', onclick: () => { m.pts.pop(); m.closed = false; this.drawMeasure(); } }, 'Undo') : null,
        m.pts.length ? h('button', { class: 'btn btn-sm', onclick: () => { m.pts = []; m.closed = false; this.drawMeasure(); } }, 'Clear') : null,
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => this.toggleMeasure() }, 'Done')));
    this.measureBox.hidden = false;
  }

  drawUnits() {
    this.unitsBtn.textContent = this.prefs.miles ? 'mi' : 'km';
    if (this.scale && this.map) { this.scale.remove(); this.scale = this.L.control.scale({ position: 'bottomleft', imperial: this.prefs.miles, metric: !this.prefs.miles }).addTo(this.map); }
    if (this.measure) this.drawMeasure();
    if (this.planner?.open) this.planner.draw();
  }
  drawStatus() {
    if (!this.map) return;
    const c = this.cursor || this.map.getCenter();
    this.status.textContent = `${c.lat.toFixed(5)}, ${this.L.Util.wrapNum(c.lng, [-180, 180], true).toFixed(5)} · zoom ${this.map.getZoom()}`;
  }
}
