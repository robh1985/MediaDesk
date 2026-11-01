// Trip Planner: a printable itinerary (print it, or save it as a PDF from the print dialog). Also
// used by the read-only share page, from the same data.

import { tripDays, fmtDay, fmtTime, fmtRange, catOf, bookingType, money, expenseParts, esc, TRAVEL, travelSummary } from './util.js';

// The itinerary as HTML, from a trip's data ({ trip, places, items, bookings, … }).
export function itineraryHtml(d) {
  const t = d.trip;
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
      if (tr?.mode) rows.push(`<li class="r-travel"><span class="r-icon">${TRAVEL[tr.mode][1]}</span><div><b>${esc(TRAVEL[tr.mode][0])}</b>${travelSummary(tr) ? ` <small>${esc(travelSummary(tr))}</small>` : ''}</div></li>`);
      rows.push(`<li class="r-dest"><span class="r-icon r-num">${i + 1}</span><div><b>${esc(x.name)}</b>${x.arrive ? ` <small>${esc(fmtRange(x.arrive, x.depart || x.arrive))}</small>` : ''}${x.address && x.address !== x.name ? `<br><small>${esc(x.address)}</small>` : ''}</div></li>`);
    });
    html += `<section class="route"><h2>Route</h2><ul class="route-list">${rows.join('')}</ul></section>`;
  }
  html += days.map((day, i) => { const list = items(day); return `<section class="day"><h2>Day ${i + 1} <small>${esc(fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }))}</small></h2>${list.length ? `<ol>${list.map(row).join('')}</ol>` : '<p class="muted">Free day</p>'}</section>`; }).join('');
  const pool = items(null).filter((it) => it.kind === 'place');
  if (pool.length) html += `<section class="day"><h2>Other places</h2><ul>${pool.map(row).join('')}</ul></section>`;
  const bookings = all('bookings').sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  if (bookings.length) {
    html += `<section><h2>Bookings</h2><table><tr><th></th><th>What</th><th>When</th><th>Code</th><th>Price</th></tr>${bookings.map((b) => { const [l, e] = bookingType(b.type); return `<tr${b.status === 'cancelled' ? ' class="x"' : ''}><td>${e}</td><td><b>${esc(b.title || l)}</b>${b.provider ? `<br><small>${esc(b.provider)}</small>` : ''}${(b.legs || []).map((g) => `<br><small>${esc(g.from)} ${fmtTime(g.depart)} → ${esc(g.to)} ${fmtTime(g.arrive)} ${esc(g.number || '')}</small>`).join('')}</td><td>${b.start ? esc(`${fmtDay(b.start.slice(0, 10))} ${fmtTime(b.start)}`) : ''}${b.end ? `<br><small>until ${esc(`${fmtDay(b.end.slice(0, 10))} ${fmtTime(b.end)}`)}</small>` : ''}</td><td>${esc(b.code || '')}</td><td>${b.price ? esc(money(Number(b.price), b.currency || t.currency)) : ''}</td></tr>`; }).join('')}</table></section>`;
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
.route-list { list-style: none; padding: 0; } .route-list li { display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 4px 0; } .route-list .r-travel { padding-left: 4px; color: #555; } .r-icon { width: 24px; text-align: center; flex: none; } .r-num { display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #1c7ed6; color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; } .route-list small { color: #666; } .r-origin small { display: block; }
section.day { break-inside: avoid; }
@media print { body { margin: 0; } }`;

export function printTrip(store) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(store.trip.title)}</title><style>${PRINT_CSS}</style></head><body>${itineraryHtml(store.doc)}<script>setTimeout(() => print(), 300)<\/script></body></html>`);
  w.document.close();
}
