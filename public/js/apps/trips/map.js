// Maps for the Trip Planner: Leaflet (public/vendor/leaflet) with OpenStreetMap tiles, markers that
// show each place's kind and number in the day, clusters when zoomed out, and route lines.

import { catOf } from './util.js';

let loading = null;
export function loadLeaflet() {
  if (loading) return loading;
  const css = (href) => { if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href })); };
  const js = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Couldn’t load the map')); document.head.append(s); });
  css('/vendor/leaflet/leaflet.css');
  css('/vendor/leaflet.markercluster/MarkerCluster.css');
  css('/vendor/leaflet.markercluster/MarkerCluster.Default.css');
  loading = (window.L ? Promise.resolve() : js('/vendor/leaflet/leaflet.js')).then(() => (window.L.markerClusterGroup ? null : js('/vendor/leaflet.markercluster/leaflet.markercluster.js'))).then(() => window.L);
  return loading;
}

// Map styles, all from OpenStreetMap data and free to use without a key. The dark style is
// OpenStreetMap's own map with its colours turned round.
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
export const STYLES = {
  osm: ['Standard', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM, 19],
  dark: ['Dark', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM, 19, true],
  topo: ['Terrain', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', `Map data ${OSM}, SRTM | Style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>`, 17],
};

// Tile servers want to know which site a map is on (MediaDesk sends no Referer to other sites by
// default, and OpenStreetMap refuses tiles without one), so tiles say where they're from: the
// address of this MediaDesk, never the page.
export function tileLayer(L, key) {
  const [, url, attribution, maxZoom] = STYLES[key] || STYLES.osm;
  return L.tileLayer(url, { attribution, maxZoom, subdomains: 'abc', referrerPolicy: 'strict-origin-when-cross-origin' });
}

export async function makeMap(el, { style, center = [48, 10], zoom = 4 } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView(center, zoom);
  map.setStyle = (k) => {
    if (!STYLES[k]) k = 'osm';
    if (map.tiles) map.removeLayer(map.tiles);
    map.tiles = tileLayer(L, k).addTo(map);
    el.classList.toggle('tp-dark-tiles', Boolean(STYLES[k][4]));
  };
  map.setStyle(style || (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'osm'));
  // Leaflet needs telling when its box changes size (windows resize, panels open).
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  map.on('unload', () => ro.disconnect());
  return map;
}

// A marker: the place's kind as an emoji on a pin in its day's colour, with its number in the day.
export function placeIcon(L, p, { color, n, selected, faded } = {}) {
  const [, emoji, catColor] = catOf(p.category);
  const c = color || catColor;
  return L.divIcon({
    className: `tp-pin ${selected ? 'selected' : ''} ${faded ? 'faded' : ''}`,
    html: `<div class="tp-pin-body" style="--c:${c}"><span>${emoji}</span>${n != null ? `<b>${n}</b>` : ''}</div>`,
    iconSize: [34, 40], iconAnchor: [17, 38], popupAnchor: [0, -34],
  });
}

export function fitTo(map, points, maxZoom = 15) {
  const L = window.L;
  const pts = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!pts.length) return;
  if (pts.length === 1) { map.setView([pts[0].lat, pts[0].lon], Math.min(maxZoom, 14)); return; }
  map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom });
}
