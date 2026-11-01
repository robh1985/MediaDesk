// A trip shared with a read-only link (/trip/<token>): the plan on a map, day by day, and whatever
// else the link was set to show (bookings, packing, costs, notes).

import { tripDays, fmtDay, DAY_COLORS, catOf, esc } from './apps/trips/util.js';
import { itineraryHtml } from './apps/trips/print.js';
import { loadLeaflet, placeIcon, fitTo, tileLayer } from './apps/trips/map.js';

const token = location.pathname.split('/').filter(Boolean)[1];
const main = document.getElementById('trip');

async function start() {
  let d;
  try {
    const r = await fetch(`/trip-share/${encodeURIComponent(token)}/data`);
    d = await r.json();
    if (!r.ok) throw new Error(d.error || 'This trip can’t be shown');
  } catch (err) { main.innerHTML = `<div class="ts-gone"><h1>🧭</h1><p>${esc(err.message)}</p></div>`; return; }
  const t = d.trip;
  document.title = t.title;
  document.documentElement.style.setProperty('--c', t.color || '#1c7ed6');
  const days = tripDays(t);
  const place = (id) => d.places?.[id];
  main.innerHTML = `<div class="ts-layout"><div class="ts-map" id="ts-map"></div><div class="ts-body"><nav class="ts-days" id="ts-days"><button class="on" data-day="">All days</button>${days.map((x, i) => `<button data-day="${x}"><i style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></i>Day ${i + 1}<small>${esc(fmtDay(x))}</small></button>`).join('')}</nav><article class="ts-doc">${itineraryHtml(d)}${notesHtml(d)}</article><footer class="muted">Shared from MediaDesk Trip Planner</footer></div></div>`;
  // Photos of places.
  for (const li of main.querySelectorAll('.ts-doc li')) li.classList.add('ts-li');
  try {
    const L = await loadLeaflet();
    const map = L.map('ts-map', { worldCopyJump: true }).setView([45, 10], 4);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    tileLayer(L, dark ? 'dark' : 'osm').addTo(map);
    if (dark) document.getElementById('ts-map').classList.add('tp-dark-tiles');
    const layers = L.layerGroup().addTo(map);
    const stops = [...(t.origin && Number.isFinite(t.origin.lat) ? [{ ...t.origin, home: true }] : []), ...(t.destinations || []).filter((x) => Number.isFinite(x.lat))];
    const draw = (only) => {
      layers.clearLayers();
      const pts = [];
      days.forEach((day, i) => {
        if (only && only !== day) return;
        const color = DAY_COLORS[i % DAY_COLORS.length];
        const stops = Object.values(d.items || {}).filter((it) => it.date === day && it.kind === 'place').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((it) => place(it.placeId)).filter((p) => p && Number.isFinite(p.lat));
        stops.forEach((p, n) => { L.marker([p.lat, p.lon], { icon: placeIcon(L, p, { color, n: n + 1 }) }).bindPopup(`<b>${esc(p.name)}</b><br>${catOf(p.category)[0]}${p.address ? `<br><small>${esc(p.address)}</small>` : ''}${p.image && d.files?.[p.image] ? `<br><img src="/trip-share/${token}/files/${p.image}" style="max-width:200px;margin-top:6px;border-radius:6px">` : ''}`).addTo(layers); pts.push(p); });
        if (stops.length > 1) L.polyline(stops.map((p) => [p.lat, p.lon]), { color, weight: 4, opacity: 0.8 }).addTo(layers);
      });
      if (!only) for (const p of Object.values(d.places || {})) if (Number.isFinite(p.lat) && !pts.includes(p)) { L.marker([p.lat, p.lon], { icon: placeIcon(L, p, { color: '#868e96' }) }).bindPopup(`<b>${esc(p.name)}</b>`).addTo(layers); pts.push(p); }
      fitTo(map, only ? pts : [...pts, ...stops], 13);
    };
    // Where the trip starts and each destination, with the journeys between them.
    const route = L.layerGroup().addTo(map);
    stops.forEach((x, i) => {
      L.marker([x.lat, x.lon], { icon: L.divIcon({ className: `tp-destpin ${x.home ? 'home' : ''}`, html: x.home ? '🏠' : String((t.destinations || []).indexOf(x) + 1), iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: -500 }).bindTooltip(esc(x.home ? `Starting from ${x.name}` : x.name)).addTo(route);
      if (i) L.polyline([[stops[i - 1].lat, stops[i - 1].lon], [x.lat, x.lon]], { color: x.travel?.mode === 'flight' ? '#7048e8' : '#495057', weight: 2, opacity: 0.6, dashArray: x.travel?.mode === 'flight' ? '2 8' : '6 8' }).addTo(route);
    });
    draw(null);
    main.querySelector('#ts-days').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      main.querySelectorAll('#ts-days button').forEach((x) => x.classList.toggle('on', x === b));
      draw(b.dataset.day || null);
      const i = days.indexOf(b.dataset.day);
      main.querySelectorAll('.ts-doc section.day')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  } catch { document.getElementById('ts-map').remove(); }
}

function notesHtml(d) {
  let html = '';
  const notes = Object.values(d.notes || {});
  if (notes.length) html += `<section><h2>Notes</h2>${notes.map((n) => `<div class="ts-note">${n.title ? `<b>${esc(n.title)}</b><br>` : ''}${esc(n.text).replace(/\n/g, '<br>')}</div>`).join('')}</section>`;
  const links = Object.values(d.links || {});
  if (links.length) html += `<section><h2>Links</h2><ul>${links.map((k) => `<li><a href="${esc(/^https?:/.test(k.url) ? k.url : '#')}" target="_blank" rel="noopener noreferrer">${esc(k.title || k.url)}</a></li>`).join('')}</ul></section>`;
  const polls = Object.values(d.polls || {});
  if (polls.length) html += `<section><h2>Polls</h2>${polls.map((p) => `<div class="ts-note"><b>${esc(p.question)}</b><ul>${p.options.map((o) => `<li>${esc(o.text)} — ${o.votes?.length || 0}</li>`).join('')}</ul></div>`).join('')}</section>`;
  return html;
}

start();
