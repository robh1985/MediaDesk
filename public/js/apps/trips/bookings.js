// Trip Planner: bookings. Flights, trains, stays, cars, tables, tickets: when, where, the booking
// code, who's going, what it cost (which can go straight into the costs), and its files. Flights
// and other journeys have legs, with airports looked up by code or name.

import { h, clear, toast, toastError } from '../../ui.js';
import { geo } from './store.js';
import {
  tripDays, fmtDay, fmtTime, BOOKING_TYPES, bookingType, STATUS, STAYS, CURRENCIES, money, avatar,
  sheet, field, input, select, textarea, peoplePicker, emptyState,
} from './util.js';

let airports = null;
export async function loadAirports() {
  if (!airports) airports = fetch('/vendor/airports/airports.json').then((r) => r.json()).then((d) => d.rows.map((r) => Object.fromEntries(d.fields.map((f, i) => [f, r[i]]))));
  return airports;
}
export async function findAirports(q) {
  const list = await loadAirports();
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const exact = list.filter((a) => a.iata.toLowerCase() === s || a.icao.toLowerCase() === s);
  const score = (a) => { const c = a.city.toLowerCase(); const n = a.name.toLowerCase(); return c === s ? 0 : c.startsWith(s) ? 1 : n.startsWith(s) || n.includes(` ${s}`) ? 2 : n.includes(s) ? 3 : 9; };
  const rest = list.filter((a) => !exact.includes(a)).map((a) => [score(a), a]).filter(([sc]) => sc < 9).sort((a, b) => a[0] - b[0]).map(([, a]) => a);
  return [...exact, ...rest].slice(0, 8);
}
const airportByCode = async (code) => (await loadAirports()).find((a) => a.iata === String(code || '').toUpperCase()) || null;

// "2026-05-04T07:10" in the airport's own time → shown as it is (times are local where they happen).
const localTime = (s) => (s ? fmtTime(s) : '');

export class BookingsView {
  constructor(app) { this.app = app; this.store = app.store; this.filter = 'all'; }

  render(el) {
    this.el = el;
    const all = this.store.all('bookings').sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
    const counts = { all: all.length, transport: 0, stay: 0, other: 0 };
    const group = (b) => (BOOKING_TYPES[b.type]?.[2] || b.type === 'car' ? 'transport' : STAYS.has(b.type) ? 'stay' : 'other');
    for (const b of all) counts[group(b)]++;
    const shown = all.filter((b) => this.filter === 'all' || group(b) === this.filter);
    const total = all.filter((b) => b.status !== 'cancelled' && b.price).reduce((a, b) => a + (b.currency === this.store.trip.currency ? Number(b.price) : 0), 0);
    const byDay = new Map();
    for (const b of shown) { const d = b.start ? b.start.slice(0, 10) : ''; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(b); }
    clear(el, h('div', { class: 'tp-page' },
      h('div', { class: 'tp-page-head' },
        h('div', { class: 'tp-seg' }, [['all', 'All'], ['transport', 'Getting there'], ['stay', 'Stays'], ['other', 'Tickets & tables']].map(([k, l]) => h('button', { class: this.filter === k ? 'on' : '', onclick: () => { this.filter = k; this.render(el); } }, `${l} (${counts[k]})`))),
        total ? h('span', { class: 'muted small' }, `Booked: ${money(total, this.store.trip.currency)}`) : null,
        h('button', { class: 'btn btn-primary', onclick: () => this.edit(null) }, '＋ Add a booking')),
      shown.length ? [...byDay].map(([d, list]) => h('section', { class: 'tp-bk-day' },
        h('h4', {}, d ? fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }) : 'No date'),
        list.map((b) => this.card(b))))
        : emptyState('🎫', 'No bookings yet. Add flights, hotels, cars, tables and tickets to keep them with the plan.')));
    if (this.focus) { const c = el.querySelector(`[data-id="${this.focus}"]`); c?.scrollIntoView({ block: 'center' }); c?.classList.add('flash'); this.focus = null; }
  }

  card(b) {
    const [label, emoji] = bookingType(b.type);
    const [stLabel, stColor] = STATUS[b.status] || STATUS.confirmed;
    const files = this.store.all('files').filter((f) => f.bookingId === b.id && !f.deleted);
    const people = (b.travellers || []).map((id) => this.store.member(id)).filter(Boolean);
    const onPlan = this.store.all('items').some((it) => it.bookingId === b.id && it.date);
    return h('article', { class: `tp-bk ${b.status === 'cancelled' ? 'cancelled' : ''}`, dataset: { id: b.id } },
      h('div', { class: 'tp-bk-icon' }, emoji),
      h('div', { class: 'tp-bk-main' },
        h('div', { class: 'tp-bk-top' }, h('b', {}, b.title || label), h('span', { class: 'tp-status', style: { '--c': stColor } }, stLabel)),
        h('div', { class: 'muted small' }, [label, b.provider, b.start ? `${fmtDay(b.start.slice(0, 10))} ${localTime(b.start)}` : null, b.end ? `→ ${b.end.slice(0, 10) !== b.start?.slice(0, 10) ? `${fmtDay(b.end.slice(0, 10))} ` : ''}${localTime(b.end)}` : null].filter(Boolean).join(' · ')),
        (b.legs || []).length ? h('div', { class: 'tp-legs' }, b.legs.map((l) => h('div', { class: 'tp-legrow' },
          h('b', {}, l.from || '?'), h('span', { class: 'muted' }, ` ${localTime(l.depart)} → `), h('b', {}, l.to || '?'), h('span', { class: 'muted' }, ` ${localTime(l.arrive)}`),
          l.number ? h('span', { class: 'tp-chip' }, l.number) : null, l.seat ? h('span', { class: 'tp-chip' }, `Seat ${l.seat}`) : null))) : null,
        b.address ? h('div', { class: 'small' }, '📍 ', b.address) : null,
        h('div', { class: 'tp-bk-foot' },
          b.code ? h('button', { class: 'tp-code', title: 'Copy the booking code', onclick: () => { navigator.clipboard?.writeText(b.code); toast('Booking code copied', { timeout: 1200 }); } }, `# ${b.code}`) : null,
          b.price ? h('span', { class: 'tp-chip' }, money(Number(b.price), b.currency || this.store.trip.currency)) : null,
          h('span', { class: 'tp-avatars' }, people.map((m) => avatar(m, 20))),
          files.map((f) => h('a', { class: 'tp-chip', href: this.store.fileUrl(f.id), target: '_blank', rel: 'noopener' }, `📎 ${f.name}`)),
          onPlan ? h('span', { class: 'tp-chip' }, '🗓 On the plan') : null)),
      h('div', { class: 'tp-bk-tools' }, h('button', { class: 'btn btn-sm', onclick: () => this.edit(b) }, 'Edit')));
  }

  async edit(b) {
    const isNew = !b;
    b = b ? JSON.parse(JSON.stringify(b)) : { type: 'flight', status: 'confirmed', currency: this.store.trip.currency, travellers: this.store.trip.members.map((m) => m.id), legs: [] };
    const trip = this.store.trip;
    const days = tripDays(trip);
    const type = select(Object.entries(BOOKING_TYPES).map(([k, [l, e]]) => [k, `${e} ${l}`]), b.type);
    const status = select(Object.entries(STATUS).map(([k, [l]]) => [k, l]), b.status || 'confirmed');
    const title = input({ value: b.title || '', placeholder: 'e.g. London → Lisbon, Hotel Aurora' });
    const provider = input({ value: b.provider || '', placeholder: 'Airline, hotel, website…' });
    const code = input({ value: b.code || '', placeholder: 'Booking reference' });
    const dt = (v) => (v ? (v.length === 10 ? `${v}T12:00` : v.slice(0, 16)) : '');
    const start = input({ type: 'datetime-local', value: dt(b.start) || (days[0] ? `${days[0]}T09:00` : '') });
    const end = input({ type: 'datetime-local', value: dt(b.end) });
    const address = input({ value: b.address || '', placeholder: 'Address (to show it on the map)' });
    let where = Number.isFinite(b.lat) ? { lat: b.lat, lon: b.lon } : null;
    const whereNote = h('small', { class: 'muted' }, where ? '📍 On the map' : '');
    address.addEventListener('change', async () => {
      where = null;
      whereNote.textContent = '';
      if (!address.value.trim()) return;
      try { const r = (await geo.search(address.value.trim()))[0]; if (r) { where = { lat: r.lat, lon: r.lon }; whereNote.textContent = `📍 ${r.address || r.name}`; } else whereNote.textContent = 'Not found on the map'; } catch { /* keep it without a place */ }
    });
    const price = input({ type: 'number', min: 0, step: 0.01, value: b.price ?? '' });
    const cur = select(CURRENCIES.map((c) => [c, c]), b.currency || trip.currency);
    const linked = b.id ? this.store.all('expenses').find((e) => e.bookingId === b.id) : null;
    const addCost = h('input', { type: 'checkbox', checked: Boolean(linked) || isNew });
    const people = peoplePicker(trip.members, b.travellers || []);
    const notes = textarea(b.notes || '', { placeholder: 'Seats, baggage, check-in times…', rows: 2 });
    const onPlan = h('input', { type: 'checkbox', checked: isNew ? true : this.store.all('items').some((it) => it.bookingId === b.id) });
    const legsBox = h('div', { class: 'tp-legs-edit' });
    const legs = (b.legs || []).map((l) => ({ ...l }));
    const drawLegs = () => {
      const has = BOOKING_TYPES[type.value]?.[2];
      legsBox.hidden = !has;
      if (!has) return;
      const flight = type.value === 'flight';
      clear(legsBox, h('div', { class: 'tp-legs-h' }, h('b', {}, flight ? 'Flights' : 'Journey'), h('small', { class: 'muted' }, flight ? 'Type an airport code or city' : '')),
        legs.map((l, i) => h('div', { class: 'tp-leg-edit' },
          flight ? airportField(l, 'from', 'From') : field('From', input({ value: l.from || '', oninput: (e) => { l.from = e.target.value; } })),
          flight ? airportField(l, 'to', 'To') : field('To', input({ value: l.to || '', oninput: (e) => { l.to = e.target.value; } })),
          field('Leaves', input({ type: 'datetime-local', value: dt(l.depart), oninput: (e) => { l.depart = e.target.value; } })),
          field('Arrives', input({ type: 'datetime-local', value: dt(l.arrive), oninput: (e) => { l.arrive = e.target.value; } })),
          field(flight ? 'Flight' : 'Number', input({ value: l.number || '', placeholder: flight ? 'TP1351' : '', oninput: (e) => { l.number = e.target.value; } })),
          field('Seat', input({ value: l.seat || '', oninput: (e) => { l.seat = e.target.value; } })),
          h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': 'Remove', onclick: () => { legs.splice(i, 1); drawLegs(); } }, '✕'))),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const prev = legs.at(-1); legs.push({ from: prev?.to || '', depart: prev?.arrive || start.value }); drawLegs(); } }, legs.length ? '＋ Another leg (a connection or the way back)' : '＋ Add the journey'));
    };
    type.addEventListener('change', () => { if (!legs.length && BOOKING_TYPES[type.value]?.[2]) legs.push({ depart: start.value }); drawLegs(); });
    if (isNew && !legs.length) legs.push({ depart: start.value });
    drawLegs();
    const fileIn = h('input', { type: 'file', multiple: true });
    const existing = b.id ? this.store.all('files').filter((f) => f.bookingId === b.id && !f.deleted) : [];
    const r = await sheet(this.app.root, {
      title: isNew ? 'Add a booking' : 'Booking', wide: true,
      body: h('div', { class: 'tp-form' },
        h('div', { class: 'tp-row' }, field('Kind', type), field('Status', status)),
        field('Name', title),
        h('div', { class: 'tp-row' }, field('Booked with', provider), field('Booking code', code)),
        h('div', { class: 'tp-row' }, field('From', start), field('Until', end)),
        legsBox,
        field('Where', address, whereNote),
        h('div', { class: 'tp-row' }, field('Price', price), field('Currency', cur)),
        h('label', { class: 'tp-check' }, addCost, 'Add the price to the costs (paid by the first traveller, shared by all)'),
        field('Who’s going', people),
        field('Notes', notes),
        field('Files (tickets, confirmations)', h('div', {}, existing.map((f) => h('a', { class: 'tp-chip', href: this.store.fileUrl(f.id), target: '_blank', rel: 'noopener' }, `📎 ${f.name}`)), fileIn)),
        h('label', { class: 'tp-check' }, onPlan, 'Show it on the day plan')),
      actions: [!isNew ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') {
      await this.store.batch([{ op: 'delete', col: 'bookings', id: b.id }, ...(linked ? [{ op: 'delete', col: 'expenses', id: linked.id }] : [])], { label: 'delete booking' }).catch(toastError);
      toast('Booking deleted', { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.undo() } });
      return;
    }
    if (r !== 'save') return;
    const firstLeg = legs.find((l) => l.depart);
    const lastLeg = [...legs].reverse().find((l) => l.arrive);
    const t = type.value;
    const item = {
      ...b, type: t, status: status.value, title: title.value.trim() || defaultTitle(t, legs), provider: provider.value.trim(), code: code.value.trim(),
      start: (BOOKING_TYPES[t]?.[2] && firstLeg?.depart) || start.value || null, end: (BOOKING_TYPES[t]?.[2] && lastLeg?.arrive) || end.value || null,
      legs: BOOKING_TYPES[t]?.[2] ? legs.filter((l) => l.from || l.to) : [], address: address.value.trim(), lat: where?.lat ?? null, lon: where?.lon ?? null,
      price: price.value === '' ? null : Number(price.value), currency: cur.value, travellers: people.value(), notes: notes.value,
    };
    const saved = await this.store.put('bookings', item, { label: isNew ? 'add booking' : 'booking' }).catch(toastError);
    if (!saved) return;
    const ops = [];
    // On the plan, on its first day.
    const day = item.start?.slice(0, 10);
    const planItem = this.store.all('items').find((it) => it.bookingId === saved.id);
    if (onPlan.checked && day && days.includes(day)) { if (!planItem || planItem.date !== day) ops.push({ op: 'put', col: 'items', item: { ...(planItem || { kind: 'booking', bookingId: saved.id, order: -1 }), date: day } }); } else if (planItem) ops.push({ op: 'delete', col: 'items', id: planItem.id });
    // The cost.
    if (addCost.checked && item.price && item.status !== 'cancelled') {
      const rate = item.currency === trip.currency ? 1 : await geo.fx(item.currency, trip.currency).catch(() => null);
      const who = item.travellers.length ? item.travellers : trip.members.map((m) => m.id);
      const payer = linked ? linked.paidBy : { [who[0]]: item.price };
      ops.push({ op: 'put', col: 'expenses', item: { ...(linked || { date: new Date().toISOString().slice(0, 10), split: 'equal', shares: Object.fromEntries(who.map((m) => [m, 1])) }), title: item.title, amount: item.price, currency: item.currency, rate: rate || linked?.rate || 1, category: STAYS.has(t) ? 'stay' : BOOKING_TYPES[t]?.[2] || t === 'car' ? 'transport' : t === 'restaurant' ? 'food' : 'activities', paidBy: Object.keys(payer).length === 1 ? { [Object.keys(payer)[0]]: item.price } : payer, bookingId: saved.id } });
    } else if (linked && !addCost.checked) ops.push({ op: 'delete', col: 'expenses', id: linked.id });
    if (ops.length) await this.store.batch(ops, { undoable: false }).catch(toastError);
    for (const f of fileIn.files) { try { await this.store.upload(f, { bookingId: saved.id }); } catch (err) { toastError(err, `${f.name} wasn’t uploaded`); } }
  }
}

function defaultTitle(t, legs) {
  if (legs.length && (legs[0].from || legs.at(-1).to)) return `${legs[0].from || '?'} → ${legs.at(-1).to || '?'}`;
  return bookingType(t)[0];
}

// An airport, found by its code, city or name.
function airportField(leg, key, label) {
  const box = input({ value: leg[key] || '', placeholder: 'LHR or London', autocomplete: 'off' });
  const list = h('div', { class: 'tp-results', hidden: true });
  const info = h('small', { class: 'muted' });
  const show = async () => { const a = await airportByCode(box.value); info.textContent = a ? `${a.name}, ${a.city}` : ''; };
  show();
  let t;
  box.addEventListener('input', () => {
    leg[key] = box.value.trim().toUpperCase();
    clearTimeout(t);
    t = setTimeout(async () => {
      const found = await findAirports(box.value);
      list.hidden = !found.length;
      clear(list, found.map((a) => h('button', { type: 'button', class: 'tp-result-main', onmousedown: (e) => { e.preventDefault(); box.value = a.iata; leg[key] = a.iata; leg[`${key}Tz`] = a.tz; list.hidden = true; show(); } }, h('b', {}, `${a.iata} · ${a.city}`), h('small', {}, `${a.name}, ${a.country}`))));
    }, 150);
  });
  box.addEventListener('blur', () => setTimeout(() => { list.hidden = true; show(); }, 150));
  return h('label', { class: 'tp-field tp-searchwrap' }, h('span', {}, label), box, list, info);
}
