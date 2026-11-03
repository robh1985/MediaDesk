// Maps: the route planner. Directions by car, bike or on foot from one place to another with stops
// on the way (typed, picked on the map, or from the map's right-click menu), things to avoid,
// alternative routes, and turn-by-turn steps (from OpenStreetMap, routed by the FOSSGIS OSRM
// servers through the MediaDesk server). Drag a marker to change the route; print the directions or
// open them in Google Maps.

import { h, clear, toast, toastError, debounce } from '../ui.js';
import { icon } from '../icons.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MODES = [['car', 'Drive', '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M5 11h14"/><circle cx="8" cy="13.5" r=".5"/><circle cx="16" cy="13.5" r=".5"/>'], ['bike', 'Cycle', '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h6l2 7M10 9 8 6H6M14 6h2"/>'], ['foot', 'Walk', '<circle cx="13" cy="4.5" r="1.5"/><path d="m10 21 2-6-2-3 1-4 3 3 3 1M12 15l3 6M11 8l-3 2-1 3"/>']];
const svg = (inner, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ANGLE = { straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, 'slight left': -45, left: -90, 'sharp left': -135 };

// An arrow for a step.
function stepIcon(s) {
  if (s.type === 'depart') return svg('<circle cx="12" cy="12" r="5"/>');
  if (s.type === 'arrive') return svg('<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>');
  if (s.type === 'roundabout' || s.type === 'rotary' || s.type === 'roundabout turn') return svg('<circle cx="12" cy="10" r="4"/><path d="M12 14v7M16 10h4M18 8l2 2-2 2"/>');
  if (s.modifier === 'uturn') return svg('<path d="M8 21V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/>');
  const a = ANGLE[s.modifier] ?? 0;
  return svg(`<g transform="rotate(${a} 12 12)"><path d="M12 20V5M6 11l6-6 6 6"/></g>`);
}
const fmtTime = (sec) => {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} day${d > 1 ? 's' : ''} ${hr} hr` : `${hr} hr${mm ? ` ${mm} min` : ''}`;
};

export class RoutePlanner {
  // app: the Maps app (map, L, prefs, api, fmtDist, reverse()).
  constructor(app) {
    this.app = app;
    this.mode = app.prefs.routeMode || 'car';
    this.avoid = new Set(app.prefs.routeAvoid || []);
    this.points = [null, null];
    this.routes = [];
    this.sel = 0;
    this.picking = -1;
    this.asked = 0;
    this.layer = null;
    this.el = h('div', { class: 'mp-route', hidden: true });
    this.reroute = debounce(() => this.route(), 350);
  }

  get open() { return !this.el.hidden; }
  show() {
    this.el.hidden = false;
    this.app.routeBtn?.classList.add('on');
    if (!this.layer) this.layer = this.app.L.layerGroup().addTo(this.app.map);
    this.draw();
    setTimeout(() => this.el.querySelector('.mp-rp-input:placeholder-shown')?.focus(), 30);
  }
  hide() {
    this.el.hidden = true;
    this.app.routeBtn?.classList.remove('on');
    this.stopPicking();
  }
  clearAll() {
    this.points = [null, null];
    this.routes = [];
    this.layer?.clearLayers();
    this.draw();
  }

  // From the map: directions from / to a place, or a stop on the way.
  setPoint(which, p) {
    if (!this.open) this.show();
    if (which === 'from') this.points[0] = p;
    else if (which === 'to') this.points[this.points.length - 1] = p;
    else {
      // A stop: in place of an empty one, or just before the destination.
      const empty = this.points.findIndex((x, i) => !x && i > 0 && i < this.points.length - 1);
      if (empty > 0) this.points[empty] = p; else this.points.splice(this.points.length - 1, 0, p);
    }
    this.draw();
    this.route();
  }

  savePrefs() { this.app.prefs.routeMode = this.mode; this.app.prefs.routeAvoid = [...this.avoid]; this.app.save(); }

  draw() {
    const miles = this.app.prefs.miles;
    const rows = this.points.map((p, i) => this.pointRow(p, i));
    const sel = this.routes[this.sel];
    clear(this.el,
      h('div', { class: 'mp-rp-head' }, h('b', {}, 'Directions'),
        h('button', { class: 'btn btn-icon btn-sm', title: 'Close', 'aria-label': 'Close', html: icon.x, onclick: () => this.hide() })),
      h('div', { class: 'mp-rp-modes', role: 'tablist' }, MODES.map(([id, label, path]) => h('button', { type: 'button', class: `mp-rp-mode ${this.mode === id ? 'on' : ''}`, title: label, 'aria-pressed': String(this.mode === id), onclick: () => { this.mode = id; this.savePrefs(); this.draw(); this.route(); } }, h('span', { html: svg(path) }), label))),
      h('div', { class: 'mp-rp-points' }, rows,
        this.points.length === 2 ? h('button', { type: 'button', class: 'mp-rp-swap', title: 'Swap start and destination', 'aria-label': 'Swap start and destination', html: svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>', 16), onclick: () => { this.points.reverse(); this.draw(); this.route(); } }) : null),
      h('div', { class: 'mp-rp-row2' },
        this.points.length < 25 ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { this.points.splice(this.points.length - 1, 0, null); this.draw(); this.el.querySelectorAll('.mp-rp-input')[this.points.length - 2]?.focus(); } }, h('span', { html: icon.plus }), 'Add a stop') : null,
        this.points.some(Boolean) ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.clearAll() }, 'Clear') : null),
      this.mode === 'car' ? h('div', { class: 'mp-rp-avoid' }, h('span', { class: 'small muted' }, 'Avoid'),
        [['toll', 'Tolls'], ['motorway', 'Motorways'], ['ferry', 'Ferries']].map(([k, l]) => h('label', { class: 'check small' },
          h('input', { type: 'checkbox', checked: this.avoid.has(k), onchange: (e) => { if (e.target.checked) this.avoid.add(k); else this.avoid.delete(k); this.savePrefs(); this.route(); } }), ` ${l}`))) : null,
      this.status = h('div', { class: 'mp-rp-status small muted' }, this.points.filter(Boolean).length < 2 ? 'Type a place, choose one on the map (◎), or right-click the map.' : ''),
      this.routes.length ? h('div', { class: 'mp-rp-alts' }, this.routes.map((r, i) => h('button', { type: 'button', class: `mp-rp-alt ${i === this.sel ? 'on' : ''}`, onclick: () => { this.sel = i; this.drawRoutes(); this.draw(); } },
        h('b', {}, fmtTime(r.duration)), h('span', {}, this.app.fmtDist(r.distance, miles)),
        h('small', {}, i === 0 ? `Fastest${r.legs.length === 1 && r.legs[0].summary ? ` · via ${r.legs[0].summary}` : ''}` : r.legs[0]?.summary ? `via ${r.legs[0].summary}` : `Route ${i + 1}`)))) : null,
      this.avoidIgnored ? h('div', { class: 'notice small' }, 'The routing server couldn’t leave out what you chose to avoid, so this route may use them.') : null,
      sel ? h('div', { class: 'mp-rp-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.print() }, h('span', { html: svg('<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>', 15) }), 'Print'),
        h('a', { class: 'btn btn-sm', href: this.googleUrl(), target: '_blank', rel: 'noopener' }, 'Open in Google Maps')) : null,
      sel ? h('div', { class: 'mp-rp-steps' }, sel.legs.map((leg, li) => [
        sel.legs.length > 1 ? h('div', { class: 'mp-rp-leg' }, h('span', { class: 'mp-rp-letter' }, LETTERS[li]), h('span', {}, `${this.label(li)} → ${this.label(li + 1)}`), h('small', {}, `${fmtTime(leg.duration)} · ${this.app.fmtDist(leg.distance, miles)}`)) : null,
        leg.steps.map((s) => h('button', { type: 'button', class: `mp-rp-step ${s.type === 'arrive' ? 'arrive' : ''}`, onclick: () => this.focusStep(s) },
          h('span', { class: 'mp-rp-arrow', html: stepIcon(s) }),
          h('span', { class: 'mp-rp-text' }, s.text),
          s.distance ? h('span', { class: 'mp-rp-dist' }, this.app.fmtDist(s.distance, miles)) : null)),
      ]), h('p', { class: 'small muted mp-rp-credit' }, 'Routes from OpenStreetMap data, by the FOSSGIS OSRM servers. Check the road as you go.')) : null);
  }

  label(i) { const p = this.points[i]; return p?.name || (p ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : '…'); }

  // One of the places: a letter, the box to type in, choose on the map, move and remove.
  pointRow(p, i) {
    const last = this.points.length - 1;
    const input = h('input', { class: 'input mp-rp-input', type: 'search', value: p?.name || '', placeholder: i === 0 ? 'Starting point' : i === last ? 'Destination' : 'Stop', autocomplete: 'off', spellcheck: 'false', 'aria-label': i === 0 ? 'From' : i === last ? 'To' : `Stop ${i}` });
    const list = h('div', { class: 'mp-results mp-rp-results', hidden: true });
    const choose = (place) => { list.hidden = true; this.points[i] = { name: place.name, lat: place.lat, lon: place.lon }; this.draw(); this.route(); };
    const showList = (places) => {
      clear(list, places.slice(0, 7).map((pl) => h('button', { type: 'button', class: 'mp-result', onmousedown: (e) => e.preventDefault(), onclick: () => choose(pl) }, h('b', {}, pl.name), h('small', {}, pl.address && pl.address !== pl.name ? pl.address : ''))));
      list.hidden = !places.length;
    };
    const mine = () => ({ name: 'Your location', address: 'Where this device is', mine: true });
    input.addEventListener('focus', () => { if (!input.value && navigator.geolocation && window.isSecureContext) { clear(list, h('button', { type: 'button', class: 'mp-result', onmousedown: (e) => e.preventDefault(), onclick: () => this.useMyLocation(i) }, h('b', {}, '◉ Your location'), h('small', {}, mine().address))); list.hidden = false; } });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener('input', debounce(async () => {
      const q = input.value.trim();
      if (q.length < 3) { list.hidden = true; return; }
      const c = this.app.coords(q);
      if (c) { showList([{ name: `${c.lat}, ${c.lon}`, lat: c.lat, lon: c.lon }]); return; }
      try { const r = await this.app.api(`/suggest?${new URLSearchParams({ q })}`); if (input.value.trim() === q) showList(r.places); } catch { /* typing on */ }
    }, 280));
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowDown') { list.querySelector('button')?.focus(); e.preventDefault(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const c = this.app.coords(q);
      if (c) { choose({ name: `${c.lat}, ${c.lon}`, lat: c.lat, lon: c.lon }); return; }
      try {
        const ctr = this.app.map.getCenter();
        const r = await this.app.api(`/search?${new URLSearchParams({ q, near: `${ctr.lat},${ctr.lng}` })}`);
        if (!r.places.length) toast('Nothing found', { body: q, timeout: 2500 });
        else if (r.places.length === 1) choose(r.places[0]);
        else { showList(r.places); list.querySelector('button')?.focus(); }
      } catch (err) { toastError(err, 'Search didn’t work'); }
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.target.nextElementSibling?.focus(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { (e.target.previousElementSibling || input).focus(); e.preventDefault(); }
    });
    const small = (title, ic, onclick, extra = {}) => h('button', { type: 'button', class: 'mp-rp-btn', title, 'aria-label': title, html: ic, onclick, ...extra });
    return h('div', { class: `mp-rp-point ${this.picking === i ? 'picking' : ''}`, dataset: { i } },
      h('span', { class: `mp-rp-letter ${i === 0 ? 'start' : i === last ? 'end' : ''}` }, LETTERS[i]),
      h('div', { class: 'mp-rp-field' }, input, list),
      small('Choose on the map', svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>', 16), () => this.startPicking(i)),
      this.points.length > 2 ? small('Move up', svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 14), () => { if (i > 0) { [this.points[i - 1], this.points[i]] = [this.points[i], this.points[i - 1]]; this.draw(); this.route(); } }, { disabled: i === 0 }) : null,
      this.points.length > 2 ? small('Remove', svg('<path d="M6 6l12 12M18 6 6 18"/>', 14), () => { this.points.splice(i, 1); this.draw(); this.route(); }) : null);
  }

  useMyLocation(i) {
    navigator.geolocation.getCurrentPosition((pos) => {
      this.points[i] = { name: 'Your location', lat: pos.coords.latitude, lon: pos.coords.longitude };
      this.draw(); this.route();
    }, (err) => toastError(new Error(err.code === 1 ? 'Location isn’t allowed for this site' : err.message), 'Couldn’t find you'), { enableHighAccuracy: true, timeout: 15000 });
  }

  // Choose a place by clicking the map.
  startPicking(i) {
    this.picking = i;
    this.app.mapEl.classList.add('measuring');
    this.draw();
    toast('Click the map to choose the place', { timeout: 2500 });
  }
  stopPicking() { this.picking = -1; this.app.mapEl.classList.remove('measuring'); }
  pick(ll) {
    const i = this.picking;
    this.stopPicking();
    const p = { name: '', lat: +ll.lat.toFixed(6), lon: +this.app.L.Util.wrapNum(ll.lng, [-180, 180], true).toFixed(6) };
    this.points[i] = p;
    this.nameIt(p);
    this.draw();
    this.route();
  }
  // A picked or dragged place gets the name of what's there.
  async nameIt(p) {
    p.name = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    try {
      const r = await this.app.api(`/reverse?lat=${p.lat}&lon=${p.lon}`);
      const n = r.place?.address || r.place?.name;
      if (n && this.points.includes(p)) { p.name = n.split(',').slice(0, 2).join(','); this.draw(); }
    } catch { /* coordinates it is */ }
  }

  async route() {
    const pts = this.points.filter(Boolean);
    this.drawMarkers();
    if (pts.length < 2) { this.routes = []; this.drawRoutes(); this.draw(); return; }
    const ask = ++this.asked;
    if (this.status) clear(this.status, 'Finding the way…');
    try {
      const r = await this.app.api(`/directions?${new URLSearchParams({ mode: this.mode, points: pts.map((p) => `${p.lat},${p.lon}`).join(';'), avoid: this.mode === 'car' ? [...this.avoid].join(',') : '' })}`);
      if (ask !== this.asked) return;
      this.routes = r.routes;
      this.avoidIgnored = r.avoidIgnored;
      this.sel = 0;
      this.drawRoutes(true);
      this.draw();
    } catch (err) {
      if (ask !== this.asked) return;
      this.routes = [];
      this.drawRoutes();
      this.draw();
      clear(this.status, h('span', { class: 'mp-rp-err' }, err.message));
    }
  }

  drawMarkers() {
    const L = this.app.L;
    this.markers?.forEach((m) => m.remove());
    const last = this.points.length - 1;
    this.markers = this.points.map((p, i) => {
      if (!p) return null;
      const m = L.marker([p.lat, p.lon], { draggable: true, autoPan: true, zIndexOffset: 1000, title: this.label(i),
        icon: L.divIcon({ className: `mp-rp-marker ${i === 0 ? 'start' : i === last ? 'end' : ''}`, html: `<span>${LETTERS[i]}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) });
      // Drag it somewhere else: the route goes there.
      m.on('dragend', () => { const ll = m.getLatLng(); const np = { name: '', lat: +ll.lat.toFixed(6), lon: +L.Util.wrapNum(ll.lng, [-180, 180], true).toFixed(6) }; this.points[i] = np; this.nameIt(np); this.draw(); this.route(); });
      return m.addTo(this.layer);
    }).filter(Boolean);
  }

  drawRoutes(fit = false) {
    const L = this.app.L;
    this.lines?.forEach((l) => l.remove());
    this.lines = [];
    this.routes.forEach((r, i) => {
      if (i === this.sel) return;
      const l = L.polyline(r.line, { color: '#868e96', weight: 6, opacity: 0.75 }).on('click', (e) => { L.DomEvent.stop(e); this.sel = i; this.drawRoutes(); this.draw(); }).addTo(this.layer);
      l.bindTooltip(`${fmtTime(r.duration)} · ${this.app.fmtDist(r.distance, this.app.prefs.miles)}`, { sticky: true });
      this.lines.push(l);
    });
    const r = this.routes[this.sel];
    if (r) {
      this.lines.push(L.polyline(r.line, { color: '#fff', weight: 9, opacity: 0.95 }).addTo(this.layer));
      this.lines.push(L.polyline(r.line, { color: '#1c7ed6', weight: 6 }).addTo(this.layer));
      if (fit) this.app.map.fitBounds(L.latLngBounds(r.line), { paddingTopLeft: [this.el.offsetWidth + 30, 70], paddingBottomRight: [30, 30] });
    }
    this.markers?.forEach((m) => m.setZIndexOffset(1000));
  }

  focusStep(s) {
    if (!Number.isFinite(s.at?.[0])) return;
    const L = this.app.L;
    this.app.map.setView(s.at, Math.max(this.app.map.getZoom(), 16));
    this.spot?.remove();
    this.spot = L.circleMarker(s.at, { radius: 9, color: '#1c7ed6', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(s.text, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(this.layer);
  }

  googleUrl() {
    const pts = this.points.filter(Boolean).map((p) => `${p.lat},${p.lon}`);
    const params = new URLSearchParams({ api: '1', origin: pts[0], destination: pts.at(-1), travelmode: { car: 'driving', bike: 'bicycling', foot: 'walking' }[this.mode] });
    if (pts.length > 2) params.set('waypoints', pts.slice(1, -1).join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
  }

  // The directions on paper: the places, the time and distance, and every step.
  print() {
    const r = this.routes[this.sel];
    if (!r) return;
    const miles = this.app.prefs.miles;
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const mode = { car: 'Driving', bike: 'Cycling', foot: 'Walking' }[this.mode];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(mode)} directions</title><style>
      body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;margin:28px;max-width:760px}
      h1{font-size:20px;margin:0 0 4px} .sum{color:#444;margin-bottom:16px} h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
      ol{padding-left:22px;margin:0} li{padding:5px 0;border-bottom:1px dotted #ddd;display:flex;justify-content:space-between;gap:16px} li span:last-child{color:#555;white-space:nowrap}
      .foot{margin-top:18px;font-size:11px;color:#777}</style></head><body>
      <h1>${esc(mode)} directions: ${esc(this.label(0))} to ${esc(this.label(this.points.length - 1))}</h1>
      <div class="sum">${fmtTime(r.duration)} · ${this.app.fmtDist(r.distance, miles)}${this.mode === 'car' && this.avoid.size ? ` · avoiding ${[...this.avoid].map((a) => ({ toll: 'tolls', motorway: 'motorways', ferry: 'ferries' }[a])).join(', ')}` : ''}</div>
      ${r.legs.map((leg, li) => `<h2>${esc(LETTERS[li])}. ${esc(this.label(li))} → ${esc(LETTERS[li + 1])}. ${esc(this.label(li + 1))} <small>(${fmtTime(leg.duration)}, ${this.app.fmtDist(leg.distance, miles)})</small></h2>
        <ol>${leg.steps.map((s) => `<li><span>${esc(s.text)}</span><span>${s.distance ? this.app.fmtDist(s.distance, miles) : ''}</span></li>`).join('')}</ol>`).join('')}
      <div class="foot">Printed from MediaDesk Maps, ${esc(new Date().toLocaleString())}. Routes from OpenStreetMap data (FOSSGIS OSRM). Check the road as you go.</div>
      <script>onload=()=>setTimeout(()=>print(),200)<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for MediaDesk to print the directions', { type: 'error' }); return; }
    w.document.write(html);
    w.document.close();
  }
}
