// The Maps app's server side: finding places (the Trip Planner's search, from OpenStreetMap), what's
// at a point, and the height of the ground there. Heights in the United States come from the USGS
// 3D Elevation Program (mostly lidar, to a metre or better); elsewhere from Open-Meteo (Copernicus
// 90 m terrain). Map tiles load straight from their providers in the browser.

'use strict';

function createMaps({ geo, mock = false }) {
  const cache = new Map();
  async function getJson(url, ms = 12e3) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.data;
    const res = await fetch(url, { headers: { 'User-Agent': 'MediaDesk/1.0 (self-hosted media portal)', Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    const data = await res.json();
    cache.set(url, { at: Date.now(), data });
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
    return data;
  }

  // Metres above sea level, and where the number came from.
  async function elevation(lat, lon) {
    if (mock) return { meters: Math.round(200 + 800 * Math.abs(Math.sin(lat * 3) * Math.cos(lon * 2))), source: 'Demo' };
    const r = (n) => Math.round(n * 1e5) / 1e5;
    lat = r(lat); lon = r(lon);
    // Roughly the United States and its territories: try 3DEP first.
    const us = (lat > 17 && lat < 72 && lon > -180 && lon < -64) || (lat > 13 && lat < 21 && lon > 144 && lon < 146);
    if (us) {
      try {
        const d = await getJson(`https://epqs.nationalmap.gov/v1/json?${new URLSearchParams({ x: lon, y: lat, units: 'Meters', wkid: 4326, includeDate: 'false' })}`);
        const v = Number(d?.value);
        if (Number.isFinite(v) && v > -1000) return { meters: v, source: 'USGS 3DEP (lidar)' };
      } catch { /* try the next */ }
    }
    const d = await getJson(`https://api.open-meteo.com/v1/elevation?${new URLSearchParams({ latitude: lat, longitude: lon })}`);
    const v = Number(d?.elevation?.[0]);
    if (!Number.isFinite(v)) throw new Error('No height for that point');
    return { meters: v, source: 'Copernicus DEM (Open-Meteo)' };
  }

  async function handle(req, res, url, { sendJson }) {
    const p = url.pathname.replace(/^\/portal\/maps/, '');
    const q = url.searchParams;
    const num = (k) => { const v = Number(q.get(k)); if (!Number.isFinite(v)) throw Object.assign(new Error(`Which ${k}?`), { status: 400 }); return v; };
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Not allowed' });
      if (p === '/search') return sendJson(res, 200, { places: await geo.search(String(q.get('q') || '').slice(0, 200), q.get('near')) });
      if (p === '/suggest') return sendJson(res, 200, { places: await geo.suggest(q.get('q')) });
      if (p === '/reverse') return sendJson(res, 200, { place: await geo.reverse(num('lat'), num('lon')) });
      if (p === '/elevation') {
        const lat = num('lat'), lon = num('lon');
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return sendJson(res, 400, { error: 'That isn’t a place on Earth' });
        return sendJson(res, 200, await elevation(lat, lon));
      }
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return sendJson(res, err.status || 502, { error: err.status ? err.message : `Couldn’t look that up (${err.cause?.code || err.message})` });
    }
  }
  return { handle, elevation };
}

module.exports = { createMaps };
