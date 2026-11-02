// Trip Planner: a printable itinerary (print it, or save it as a PDF from the print dialog). Also
// used by the read-only share page, from the same data.

import { tripDays, fmtDay, fmtTime, fmtRange, catOf, bookingType, money, expenseParts, esc, TRAVEL, travelSummary, fmtKm, fmtMins, setUnits, STAYS, dayDiff } from './util.js';

const placeKey = (p) => (Number.isFinite(p?.lat) ? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : '');
// The driving route saved for the journey to destination i (if it still fits the journey).
function savedRoute(t, x, i) {
  const r = t.legRoutes?.[x.id];
  const from = i ? t.destinations[i - 1] : t.origin;
  if (!r || !from || r.fromKey !== placeKey(from)) return null;
  if (x.travel?.mode === 'car' && r.toKey !== placeKey(x)) return null;
  return r;
}

// A drawing of the route for paper (map pictures don't print reliably): where the trip starts,
// each destination, the driving routes worked out in the planner, and dashed lines for the rest.
function routeSvg(t) {
  const dests = (t.destinations || []).filter((x) => Number.isFinite(x.lat));
  const origin = Number.isFinite(t.origin?.lat) ? t.origin : null;
  const routes = (t.destinations || []).map((x, i) => savedRoute(t, x, i)).filter(Boolean);
  const pts = [...(origin ? [[origin.lat, origin.lon]] : []), ...dests.map((x) => [x.lat, x.lon]), ...routes.flatMap((r) => r.line)];
  if (pts.length < 2) return '';
  const W = 680;
  const H = 300;
  const pad = 34;
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[1] * k);
  const ys = pts.map((p) => -p[0]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const at = (lat, lon) => [((lon * k - minX) * scale + ox).toFixed(1), ((-lat - minY) * scale + oy).toFixed(1)];
  const out = [];
  // Straight dashed lines between stops, then the driving routes over them.
  const stops = [...(origin ? [origin] : []), ...dests];
  for (let i = 1; i < stops.length; i++) {
    const flight = stops[i].travel?.mode === 'flight';
    out.push(`<line x1="${at(stops[i - 1].lat, stops[i - 1].lon)[0]}" y1="${at(stops[i - 1].lat, stops[i - 1].lon)[1]}" x2="${at(stops[i].lat, stops[i].lon)[0]}" y2="${at(stops[i].lat, stops[i].lon)[1]}" stroke="${flight ? '#7048e8' : '#868e96'}" stroke-width="1.5" stroke-dasharray="${flight ? '2 6' : '6 6'}"/>`);
  }
  for (const r of routes) out.push(`<polyline points="${r.line.map((p) => at(p[0], p[1]).join(',')).join(' ')}" fill="none" stroke="#1c7ed6" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const r of routes) if (r.to?.iata) { const [x, y] = at(r.to.lat, r.to.lon); out.push(`<text x="${x}" y="${Number(y) + 16}" text-anchor="middle" class="svg-small">✈ ${esc(r.to.iata)}</text>`); }
  const label = (p, text, mark) => { const [x, y] = at(p.lat, p.lon); return `<g><circle cx="${x}" cy="${y}" r="11" fill="#fff" stroke="#1c7ed6" stroke-width="2"/><text x="${x}" y="${Number(y) + 4}" text-anchor="middle" class="svg-mark">${mark}</text><text x="${x}" y="${Number(y) - 16}" text-anchor="middle" class="svg-label">${esc(text)}</text></g>`; };
  if (origin) out.push(label(origin, origin.name, '⌂'));
  dests.forEach((x) => out.push(label(x, x.name, (t.destinations.indexOf(x) + 1))));
  return `<svg class="route-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the route">${out.join('')}</svg>`;
}

// The itinerary as HTML, from a trip's data ({ trip, places, items, bookings, … }).
export function itineraryHtml(d, { routeMap = true } = {}) {
  const t = d.trip;
  setUnits(t.units);
  const all = (col) => Object.values(d[col] || {});
  const days = tripDays(t);
  const items = (date) => all('items').filter((it) => (it.date || null) === date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const row = (it) => {
    if (it.kind === 'note') return `<li class="note">✎ ${esc(it.text)}</li>`;
    if (it.kind === 'booking') { const b = d.bookings?.[it.bookingId]; if (!b) return ''; const [l, e] = bookingType(b.type); return `<li class="booking">${e} <b>${esc(b.title || l)}</b>${b.start ? ` · ${fmtTime(b.start)}` : ''}${b.provider ? ` · ${esc(b.provider)}` : ''}</li>`; }
    const p = d.places?.[it.placeId];
    if (!p) return '';
    return `<li>${catOf(p.category)[1]} <b>${esc(p.name)}</b>${it.time ? ` · ${esc(it.time)}` : ''}${p.address ? `<br><small>${esc(p.address)}</small>` : ''}${p.notes ? `<br><small class="n">${esc(p.notes)}</small>` : ''}</li>`;
  };
  let html = `<header><h1>${esc(t.cover || '')} ${esc(t.title)}</h1><p>${[t.destination, t.start ? fmtRange(t.start, t.end) : null].filter(Boolean).map(esc).join(' · ')}</p>${t.description ? `<p>${esc(t.description)}</p>` : ''}<p class="who">${(t.members || []).map((m) => esc(m.name)).join(', ')}</p></header>`;
  // The route: where the trip starts, then each destination and how you get there.
  const dests = t.destinations || [];
  if (dests.length) {
    const rows = [];
    if (t.origin) rows.push(`<li class="r-origin"><span class="r-icon">🏠</span><div><small>Starting from</small><b>${esc(t.origin.name)}</b></div></li>`);
    dests.forEach((x, i) => {
      const tr = x.travel;
      const r = savedRoute(t, x, i);
      const drive = r ? `<br><small class="r-drive">🚗 ${esc(r.to?.iata ? `Driving to ${r.to.iata}` : `Driving to ${x.name}`)}: ${esc(fmtMins(r.duration))} · ${esc(fmtKm(r.distance))}</small>` : '';
      if (tr?.mode) rows.push(`<li class="r-travel"><span class="r-icon">${TRAVEL[tr.mode][1]}</span><div><b>${esc(TRAVEL[tr.mode][0])}</b>${travelSummary(tr) ? ` <small>${esc(travelSummary(tr))}</small>` : ''}${drive}</div></li>`);
      rows.push(`<li class="r-dest"><span class="r-icon r-num">${i + 1}</span><div><b>${esc(x.name)}</b>${x.arrive ? ` <small>${esc(fmtRange(x.arrive, x.depart || x.arrive))}</small>` : ''}${x.address && x.address !== x.name ? `<br><small>${esc(x.address)}</small>` : ''}</div></li>`);
    });
    html += `<section class="route"><h2>Route</h2>${routeMap ? routeSvg(t) : ''}<ul class="route-list">${rows.join('')}</ul></section>`;
  }
  // Where you stay each day: checking in (with the time), staying, or checking out (with the time).
  const when = (v) => (v?.length > 10 ? ` ${fmtTime(v)}` : '');
  const staysOn = (day) => all('bookings').filter((b) => STAYS.has(b.type) && b.status !== 'cancelled' && b.start && b.start.slice(0, 10) <= day && (b.end || b.start).slice(0, 10) >= day).map((b) => {
    if (b.end && b.end.slice(0, 10) === day && b.start.slice(0, 10) !== day) return `<li>🧳 <b>Check-out${esc(when(b.end))}</b> · ${esc(b.title)}</li>`;
    if (b.start.slice(0, 10) === day) return `<li>🛏 <b>Check-in${esc(when(b.start))}</b> · ${esc(b.title)}${b.address ? ` <small>${esc(b.address)}</small>` : ''}</li>`;
    return `<li>🛏 Staying at ${esc(b.title)}</li>`;
  }).join('');
  html += days.map((day, i) => { const list = items(day); const st = staysOn(day); return `<section class="day"><h2>Day ${i + 1} <small>${esc(fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }))}</small></h2>${st ? `<ul class="stays">${st}</ul>` : ''}${list.length ? `<ol>${list.map(row).join('')}</ol>` : '<p class="muted">Free day</p>'}</section>`; }).join('');
  const pool = items(null).filter((it) => it.kind === 'place');
  if (pool.length) html += `<section class="day"><h2>Other places</h2><ul>${pool.map(row).join('')}</ul></section>`;
  const bookings = all('bookings').sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  if (bookings.length) {
    html += `<section><h2>Bookings</h2><table><tr><th></th><th>What</th><th>When</th><th>Code</th><th>Price</th></tr>${bookings.map((b) => { const [l, e] = bookingType(b.type); return `<tr${b.status === 'cancelled' ? ' class="x"' : ''}><td>${e}</td><td><b>${esc(b.title || l)}</b>${b.provider ? `<br><small>${b.type === 'rental' ? 'Booked through ' : ''}${esc(b.provider)}</small>` : ''}${(b.legs || []).map((g) => `<br><small>${esc(g.from)} ${fmtTime(g.depart)} → ${esc(g.to)} ${fmtTime(g.arrive)} ${esc(g.number || '')}</small>`).join('')}</td><td>${STAYS.has(b.type) ? `${b.start ? `<b>Check-in</b> ${esc(`${fmtDay(b.start.slice(0, 10))}${when(b.start)}`)}` : ''}${b.end ? `<br><b>Check-out</b> ${esc(`${fmtDay(b.end.slice(0, 10))}${when(b.end)}`)}` : ''}${b.start && b.end && dayDiff(b.start.slice(0, 10), b.end.slice(0, 10)) > 0 ? `<br><small>${dayDiff(b.start.slice(0, 10), b.end.slice(0, 10))} nights</small>` : ''}` : `${b.start ? esc(`${fmtDay(b.start.slice(0, 10))} ${fmtTime(b.start)}`) : ''}${b.end ? `<br><small>until ${esc(`${fmtDay(b.end.slice(0, 10))} ${fmtTime(b.end)}`)}</small>` : ''}`}</td><td>${esc(b.code || '')}</td><td>${b.price ? esc(money(Number(b.price), b.currency || t.currency)) : ''}</td></tr>`; }).join('')}</table></section>`;
  }
  const lists = all('lists');
  for (const l of lists) {
    const entries = all('entries').filter((e) => e.list === l.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (entries.length) html += `<section class="list"><h2>${esc(l.name)}</h2><ul class="checks">${entries.map((e) => `<li>${e.done ? '☑' : '☐'} ${e.quantity > 1 ? `${e.quantity}× ` : ''}${esc(e.text)}${e.due ? ` <small>(${esc(fmtDay(e.due))})</small>` : ''}</li>`).join('')}</ul></section>`;
  }
  const expenses = all('expenses');
  if (expenses.length) {
    const total = expenses.reduce((a, e) => a + expenseParts(e).total, 0);
    html += `<section><h2>Costs <small>${esc(money(total / 100, t.currency))}</small></h2><table>${expenses.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((e) => `<tr><td>${esc(e.date ? fmtDay(e.date) : '')}</td><td>${esc(e.title)}</td><td>${esc(money(expenseParts(e).total / 100, t.currency))}</td></tr>`).join('')}</table></section>`;
  }
  return html;
}

export const PRINT_CSS = `
body { font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 24px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 16px; border-bottom: 2px solid #ddd; padding-bottom: 3px; margin: 22px 0 8px; } h2 small { color: #666; font-weight: 400; }
header p { margin: 2px 0; color: #444; } .who { color: #666; font-size: 12px; }
ol, ul { margin: 0; padding-left: 22px; } li { margin: 4px 0; } li.note { color: #555; font-style: italic; list-style: none; margin-left: -18px; counter-increment: none; } li.booking { color: #1c4f9c; }
small { color: #666; } small.n { color: #444; } .muted { color: #888; }
table { border-collapse: collapse; width: 100%; } td, th { text-align: left; border-bottom: 1px solid #eee; padding: 5px 6px; vertical-align: top; } tr.x { text-decoration: line-through; color: #888; }
.checks { list-style: none; padding-left: 0; columns: 2; }
ul.stays { list-style: none; padding: 0; margin: 0 0 6px; color: #364fc7; } ul.stays li { margin: 2px 0; } ul.stays small { color: #666; }
.route-map { display: block; width: 100%; max-width: 680px; height: auto; margin: 4px 0 10px; border: 1px solid #ddd; border-radius: 8px; background: #f4f8fb; } .svg-label { font: 600 12px system-ui, sans-serif; fill: #111; paint-order: stroke; stroke: #fff; stroke-width: 3px; } .svg-mark { font: 700 11px system-ui, sans-serif; fill: #1c4f9c; } .svg-small { font: 600 10px system-ui, sans-serif; fill: #5f3dc4; paint-order: stroke; stroke: #fff; stroke-width: 3px; } .r-drive { color: #1c4f9c !important; } .route { break-inside: avoid; }
.route-list { list-style: none; padding: 0; } .route-list li { display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 4px 0; } .route-list .r-travel { padding-left: 4px; color: #555; } .r-icon { width: 24px; text-align: center; flex: none; } .r-num { display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #1c7ed6; color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; } .route-list small { color: #666; } .r-origin small { display: block; }
section.day { break-inside: avoid; }
@media print { body { margin: 0; } }`;

export function printTrip(store) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(store.trip.title)}</title><style>${PRINT_CSS}</style></head><body>${itineraryHtml(store.doc)}<script>setTimeout(() => print(), 300)<\/script></body></html>`);
  w.document.close();
}
