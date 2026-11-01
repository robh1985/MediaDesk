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

// Map styles: OpenStreetMap's own, or CARTO's light and dark (also from OpenStreetMap data).
export const STYLES = {
  osm: ['Standard', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', 19],
  light: ['Light', 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>', 20],
  dark: ['Dark', 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>', 20],
  topo: ['Terrain', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', 'Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>', 17],
};

export async function makeMap(el, { style, center = [48, 10], zoom = 4 } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView(center, zoom);
  const choice = style || (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  map.tiles = L.tileLayer(STYLES[choice][1], { attribution: STYLES[choice][2], maxZoom: STYLES[choice][3], subdomains: 'abcd', crossOrigin: true }).addTo(map);
  map.setStyle = (k) => {
    map.removeLayer(map.tiles);
    map.tiles = L.tileLayer(STYLES[k][1], { attribution: STYLES[k][2], maxZoom: STYLES[k][3], subdomains: 'abcd', crossOrigin: true }).addTo(map);
  };
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
