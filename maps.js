// The Maps app's server side: finding places (the Trip Planner's search, from OpenStreetMap), what's
// at a point, and the height of the ground there. Heights in the United States come from the USGS
// 3D Elevation Program (mostly lidar, to a metre or better); elsewhere from Open-Meteo (Copernicus
// 90 m terrain). Map tiles load straight from their providers in the browser.

'use strict';

// Turn-by-turn wording from OSRM's maneuvers (in the spirit of osrm-text-instructions).
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function wayName(st) {
  const name = st.name || '';
  const ref = (st.ref || '').split(';')[0].trim();
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name || ref || '';
}
function instruction(st, i, last) {
  const m = st.maneuver || {};
  const mod = m.modifier || '';
  const way = wayName(st);
  const onto = way ? ` onto ${way}` : '';
  const toward = st.destinations ? ` toward ${st.destinations.split(':').pop().split(',')[0].trim()}` : '';
  const side = /left/.test(mod) ? 'left' : /right/.test(mod) ? 'right' : '';
  const turn = { left: 'Turn left', right: 'Turn right', 'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right', 'slight left': 'Bear left', 'slight right': 'Bear right', straight: 'Go straight', uturn: 'Make a U-turn' }[mod] || 'Turn';
  switch (m.type) {
    case 'depart': return `Head ${COMPASS[Math.round(((m.bearing_after || 0) % 360) / 45) % 8]}${way ? ` on ${way}` : ''}`;
    case 'arrive': return last ? `Arrive at your destination${side ? `, on the ${side}` : ''}` : `Arrive at stop ${i}${side ? `, on the ${side}` : ''}`;
    case 'new name': return `Continue${onto || ' straight'}`;
    case 'continue': return mod === 'uturn' ? `Make a U-turn${onto}` : mod && mod !== 'straight' ? `${turn}${onto}` : `Continue${onto || ' straight'}`;
    case 'merge': return `Merge${side ? ` ${side}` : ''}${onto}`;
    case 'on ramp': return `Take the ramp${side ? ` on the ${side}` : ''}${onto}${toward}`;
    case 'off ramp': return `Take ${st.exits ? `exit ${st.exits.split(';')[0]}` : 'the exit'}${side ? ` on the ${side}` : ''}${onto}${toward}`;
    case 'fork': return `Keep ${side || 'straight'} at the fork${onto}${toward}`;
    case 'end of road': return `${turn} at the end of the road${onto}`;
    case 'roundabout': case 'rotary': {
      const n = m.exit ? ORD[m.exit - 1] || `${m.exit}th` : null;
      return `At the ${m.type === 'rotary' && st.rotary_name ? st.rotary_name : 'roundabout'}, take the ${n ? `${n} ` : ''}exit${onto}`;
    }
    case 'roundabout turn': return `At the roundabout, ${turn.toLowerCase()}${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'use lane': return side ? `Keep ${side}${onto}` : `Continue${onto}`;
    case 'notification': return `Continue${onto}`;
    default: return `${turn}${onto}`;
  }
}
const steps = (leg, legIndex, lastLeg) => (leg.steps || []).map((st) => ({
  text: instruction(st, legIndex + 1, lastLeg),
  type: st.maneuver?.type, modifier: st.maneuver?.modifier || null, exit: st.maneuver?.exit || null,
  distance: st.distance, duration: st.duration, name: wayName(st), at: [st.maneuver?.location?.[1], st.maneuver?.location?.[0]],
}));

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

  // Directions: car, bike or on foot, through up to 25 points, with alternatives for A to B and
  // things to avoid (tolls, motorways, ferries) when the routing server can.
  async function directions(mode, points, { avoid = [], alternatives = true } = {}) {
    if (mock) return demoDirections(mode, points);
    const profile = { car: 'routed-car', bike: 'routed-bike', foot: 'routed-foot' }[mode] || 'routed-car';
    const base = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${points.map(([la, lo]) => `${lo},${la}`).join(';')}`;
    const params = { overview: 'full', geometries: 'geojson', steps: 'true', alternatives: alternatives && points.length === 2 ? '3' : 'false' };
    const ex = mode === 'car' ? avoid.filter((a) => ['toll', 'motorway', 'ferry'].includes(a)) : [];
    let data;
    let avoidIgnored = false;
    try { data = await getJson(`${base}?${new URLSearchParams({ ...params, ...(ex.length ? { exclude: ex.join(',') } : {}) })}`, 25e3); } catch (err) {
      if (!ex.length || !/answered 400/.test(err.message)) throw err;
      avoidIgnored = true; // this server can't leave those out
      data = await getJson(`${base}?${new URLSearchParams(params)}`, 25e3);
    }
    if (data.code && data.code !== 'Ok') throw Object.assign(new Error(data.code === 'NoRoute' ? 'No route was found between those places' : data.message || data.code), { status: 404 });
    return {
      avoidIgnored,
      routes: (data.routes || []).map((r) => ({
        distance: r.distance, duration: r.duration,
        line: r.geometry.coordinates.map(([lo, la]) => [la, lo]),
        legs: r.legs.map((l, i) => ({ distance: l.distance, duration: l.duration, summary: l.summary || '', steps: steps(l, i, i === r.legs.length - 1) })),
      })),
    };
  }
  function demoDirections(mode, points) {
    const speed = { car: 15, bike: 4.5, foot: 1.35 }[mode] || 15;
    const R = 6371e3, rad = Math.PI / 180;
    const hav = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2));
    const make = (bend) => {
      const legs = [], line = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const d = hav(a, b) * 1.25 * (1 + bend / 10);
        const mid = [(a[0] + b[0]) / 2 + bend * 0.01, (a[1] + b[1]) / 2 - bend * 0.01];
        for (let k = 0; k <= 10; k++) { const t = k / 10; line.push([a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * bend * 0.01, a[1] + (b[1] - a[1]) * t]); }
        const roads = ['Main Street', 'Oak Avenue', 'Highway 7', 'River Road'];
        legs.push({ distance: d, duration: d / speed, summary: `${roads[(i + bend) % 4]}, ${roads[(i + bend + 2) % 4]}`, steps: [
          { text: `Head north on ${roads[(i + bend) % 4]}`, type: 'depart', modifier: null, distance: d * 0.3, duration: d * 0.3 / speed, name: roads[(i + bend) % 4], at: a },
          { text: `Turn right onto ${roads[(i + bend + 2) % 4]}`, type: 'turn', modifier: 'right', distance: d * 0.5, duration: d * 0.5 / speed, name: roads[(i + bend + 2) % 4], at: mid },
          { text: 'At the roundabout, take the second exit onto High Street', type: 'roundabout', modifier: 'right', exit: 2, distance: d * 0.2, duration: d * 0.2 / speed, name: 'High Street', at: [mid[0] + (b[0] - mid[0]) * 0.7, mid[1] + (b[1] - mid[1]) * 0.7] },
          { text: i === points.length - 2 ? 'Arrive at your destination, on the right' : `Arrive at stop ${i + 1}`, type: 'arrive', modifier: 'right', distance: 0, duration: 0, name: '', at: b },
        ] });
      }
      return { distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), line, legs };
    };
    return { avoidIgnored: false, routes: points.length === 2 ? [make(0), make(2)] : [make(0)] };
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
      if (p === '/directions') {
        const pts = String(q.get('points') || '').split(';').map((s) => s.split(',').map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180);
        if (pts.length < 2) return sendJson(res, 400, { error: 'Choose where from and where to' });
        if (pts.length > 25) return sendJson(res, 400, { error: 'At most 23 stops along the way' });
        return sendJson(res, 200, await directions(q.get('mode') || 'car', pts, { avoid: String(q.get('avoid') || '').split(',').filter(Boolean), alternatives: q.get('alternatives') !== '0' }));
      }
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
  return { handle, elevation, directions };
}

module.exports = { createMaps, instruction };
