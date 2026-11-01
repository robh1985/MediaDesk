// Trip Planner: plan trips day by day on a map, keep the bookings, split the costs, pack, and share
// the plan. Every trip is shared by everyone who signs in to MediaDesk; changes show up for the
// others within a few seconds.

import { h, clear, toast, toastError, confirmDialog } from '../../ui.js';
import { appIcon } from '../../icons.js';
import { api, TripStore } from './store.js';
import { PlanView } from './plan.js';
import { BookingsView } from './bookings.js';
import { CostsView } from './costs.js';
import { ListsView } from './lists.js';
import { FilesView } from './files.js';
import { NotesView } from './notes.js';
import { AtlasView } from './atlas.js';
import { printTrip } from './print.js';
import {
  today, addDays, fmtRange, countdown, CURRENCIES, DAY_COLORS, avatar, sheet, field, input, select, textarea, emptyState,
} from './util.js';

let cssAdded = false;
function addCss() {
  if (cssAdded) return;
  cssAdded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../../css/trips.css', import.meta.url).href }));
}

export const tripsApp = {
  id: 'trips', name: 'Trip Planner', icon: appIcon.trips, size: [1320, 860], description: 'Plan trips on a map: days, bookings, costs, packing and sharing',
  open(win, opts = {}) { addCss(); new TripPlanner(win, opts); },
};

const TABS = [['plan', '🗺️', 'Plan'], ['bookings', '🎫', 'Bookings'], ['costs', '💶', 'Costs'], ['packing', '🧳', 'Packing'], ['todo', '✅', 'To-dos'], ['files', '📎', 'Files'], ['notes', '💬', 'Notes']];
const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#4263eb', '#495057'];
const COVERS = ['🏖️', '🏔️', '🏙️', '🏕️', '🚗', '✈️', '🚆', '⛵', '🗼', '🏛️', '🌋', '🌴', '❄️', '🍷', '🎒', '🗺️'];

class TripPlanner {
  constructor(win, opts) {
    this.win = win;
    this.root = h('div', { class: 'tp' });
    clear(win.body, this.root);
    win.body.classList.add('tp-window');
    this.filter = 'upcoming';
    win.on('close', () => this.leave());
    win.on('reopen', (o) => { if (o?.trip) this.openTrip(o.trip); });
    if (opts.trip) this.openTrip(opts.trip); else this.showDashboard();
  }

  leave() {
    this.view?.destroy?.();
    this.view = null;
    this.store?.stop();
    this.unsub?.();
    this.store = null;
  }

  // --- All the trips ----------------------------------------------------------------------------

  async showDashboard() {
    this.leave();
    this.win.setTitle?.('Trip Planner');
    clear(this.root, h('div', { class: 'tp-loading' }, 'Loading trips…'));
    let data;
    try { data = await api('list'); } catch (err) { clear(this.root, emptyState('⚠️', err.message, h('button', { class: 'btn', onclick: () => this.showDashboard() }, 'Try again'))); return; }
    this.list = data;
    this.drawDashboard();
  }

  drawDashboard() {
    const t = today();
    const trips = this.list.trips;
    const groups = {
      upcoming: trips.filter((x) => !x.archived && (!x.end || x.end >= t)),
      past: trips.filter((x) => !x.archived && x.end && x.end < t),
      archived: trips.filter((x) => x.archived),
    };
    const shown = groups[this.filter];
    if (this.filter === 'past') shown.reverse();
    const next = groups.upcoming.find((x) => x.start && x.start >= t) || groups.upcoming.find((x) => x.start);
    const card = (x) => h('article', { class: `tp-card ${x.archived ? 'archived' : ''}`, style: { '--c': x.color || '#1c7ed6' }, tabindex: 0, onclick: (e) => { if (!e.target.closest('button')) this.openTrip(x.id); }, onkeydown: (e) => { if (e.key === 'Enter') this.openTrip(x.id); } },
      h('div', { class: 'tp-card-cover' }, h('span', {}, x.cover || '🗺️'), x.start ? h('span', { class: 'tp-card-count' }, countdown(x)) : null),
      h('div', { class: 'tp-card-body' },
        h('h3', {}, x.title),
        h('p', { class: 'muted small' }, [x.destination, x.start ? fmtRange(x.start, x.end) : 'No dates yet'].filter(Boolean).join(' · ')),
        h('div', { class: 'tp-card-foot' },
          h('div', { class: 'tp-avatars' }, x.members.slice(0, 5).map((m) => avatar(m, 22))),
          h('span', { class: 'muted small' }, `📍 ${x.counts.places} · 🎫 ${x.counts.bookings}`),
          h('button', { class: 'tp-icon-btn', 'aria-label': 'More', onclick: (e) => this.tripMenu(x) }, '⋯'))));
    clear(this.root,
      h('div', { class: 'tp-dash' },
        h('header', { class: 'tp-dash-head' },
          h('div', {}, h('h1', {}, 'Trips'), next ? h('p', { class: 'muted' }, `Next: ${next.title} — ${countdown(next).toLowerCase()}`) : h('p', { class: 'muted' }, 'Plan where you’re going next')),
          h('div', { class: 'tp-dash-tools' },
            h('button', { class: 'btn', onclick: () => this.showAtlas() }, '🌍 Atlas'),
            h('button', { class: 'btn', onclick: () => this.calendarFeed() }, '📅 Calendar feed'),
            h('button', { class: 'btn btn-primary', onclick: () => this.newTrip() }, '＋ New trip'))),
        h('div', { class: 'tp-seg', role: 'tablist' }, [['upcoming', 'Upcoming'], ['past', 'Past'], ['archived', 'Archived']].map(([k, l]) => h('button', { class: this.filter === k ? 'on' : '', role: 'tab', 'aria-selected': String(this.filter === k), onclick: () => { this.filter = k; this.drawDashboard(); } }, `${l} (${groups[k].length})`))),
        shown.length ? h('div', { class: 'tp-cards' }, shown.map(card))
          : emptyState(this.filter === 'archived' ? '🗄️' : '🧭', this.filter === 'upcoming' ? 'No trips planned yet.' : this.filter === 'past' ? 'No past trips.' : 'Nothing archived.', this.filter === 'upcoming' ? h('button', { class: 'btn btn-primary', onclick: () => this.newTrip() }, 'Plan a trip') : null)));
  }

  tripMenu(x) {
    sheet(this.root, {
      title: x.title,
      body: h('div', { class: 'tp-menu-list' },
        h('button', { class: 'btn', onclick: async (e) => { e.target.closest('.tp-overlay').remove(); try { await api(`trip/${x.id}/copy`, { method: 'POST' }); toast('Trip copied', { type: 'success', timeout: 2000 }); this.showDashboard(); } catch (err) { toastError(err); } } }, '⧉ Make a copy'),
        h('button', { class: 'btn', onclick: async (e) => { e.target.closest('.tp-overlay').remove(); await this.withTrip(x.id, (s) => s.patchTrip({ archived: !x.archived })); this.showDashboard(); } }, x.archived ? '↩ Bring back from the archive' : '🗄 Archive'),
        h('button', { class: 'btn btn-danger', onclick: async (e) => { e.target.closest('.tp-overlay').remove(); if (await this.deleteTrip(x)) this.showDashboard(); } }, '🗑 Delete')),
    });
  }
  async withTrip(id, fn) {
    const s = new TripStore(id);
    try { await s.load(); s.stop(); await fn(s); } catch (err) { toastError(err); } finally { s.stop(); }
  }
  async deleteTrip(x) {
    if (!await confirmDialog({ title: `Delete “${x.title}”?`, message: 'Its plan, bookings, costs, lists and files are deleted for everyone. This can’t be undone.', confirm: 'Delete trip', danger: true })) return false;
    try { await api(`trip/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); toast('Trip deleted', { timeout: 2000 }); return true; } catch (err) { toastError(err); return false; }
  }

  async newTrip() {
    const title = input({ placeholder: 'Summer in Italy', autofocus: true, required: true });
    const dest = input({ placeholder: 'Rome, Florence & Venice' });
    const start = input({ type: 'date', value: addDays(today(), 30) });
    const end = input({ type: 'date', value: addDays(today(), 36) });
    start.addEventListener('change', () => { if (end.value < start.value) end.value = start.value; });
    const cur = select(CURRENCIES.map((c) => [c, c]), 'EUR');
    const r = await sheet(this.root, {
      title: 'New trip',
      body: h('div', { class: 'tp-form' }, field('Name', title), field('Where to', dest), h('div', { class: 'tp-row' }, field('From', start), field('To', end)), field('Money in', cur, 'Costs are added up in this currency')),
      actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, submit: true, value: true }],
    });
    if (!r) return;
    try {
      const me = window.mediadesk?.user?.name || 'Me';
      const { trip } = await api('create', { method: 'POST', body: { title: title.value.trim() || 'New trip', destination: dest.value.trim(), start: start.value || null, end: end.value || null, currency: cur.value, color: COLORS[Math.floor(Math.random() * COLORS.length)], cover: COVERS[Math.floor(Math.random() * COVERS.length)], members: [{ name: me, color: '#3b82f6' }] } });
      this.openTrip(trip.id);
    } catch (err) { toastError(err); }
  }

  calendarFeed() {
    const url = `${location.origin}/trip-feed/${this.list.icsToken}.ics`;
    const box = input({ value: url, readonly: true, onclick: (e) => e.target.select() });
    sheet(this.root, {
      title: 'Calendar feed',
      body: h('div', { class: 'tp-form' }, h('p', { class: 'muted small' }, 'Subscribe to this address in Google Calendar, Apple Calendar or Outlook to see every trip (not archived ones) with its bookings and timed plans. Anyone with the address can see them.'), box,
        h('div', { class: 'tp-row' }, h('button', { type: 'button', class: 'btn', onclick: () => { navigator.clipboard?.writeText(url); toast('Copied', { timeout: 1200 }); } }, 'Copy'), h('a', { class: 'btn', href: url.replace(/^https?:/, 'webcal:') }, 'Subscribe'),
          h('button', { type: 'button', class: 'btn btn-danger tp-left', onclick: async (e) => { const r = await api('ics-token', { method: 'POST' }); this.list.icsToken = r.icsToken; e.target.closest('.tp-overlay').remove(); this.calendarFeed(); toast('A new address was made; the old one stopped working', { timeout: 3000 }); } }, 'Make a new address'))),
      actions: [{ label: 'Done', primary: true }],
    });
  }

  showAtlas() {
    this.leave();
    this.win.setTitle?.('Trip Planner — Atlas');
    this.view = new AtlasView(this);
    this.view.render(this.root);
  }

  // --- One trip -----------------------------------------------------------------------------------

  async openTrip(id, tab = 'plan') {
    this.leave();
    clear(this.root, h('div', { class: 'tp-loading' }, 'Opening the trip…'));
    const store = new TripStore(id);
    try { await store.load(); } catch (err) { clear(this.root, emptyState('⚠️', err.message, h('button', { class: 'btn', onclick: () => this.showDashboard() }, 'Back to trips'))); return; }
    this.store = store;
    this.views = {};
    this.tab = tab;
    this.unsub = store.on((why) => this.refresh(why));
    this.drawShell();
    this.go(tab);
  }

  drawShell() {
    const t = this.store.trip;
    this.win.setTitle?.(`${t.title} — Trip Planner`);
    this.tabsEl = h('nav', { class: 'tp-tabs', role: 'tablist' }, TABS.map(([k, e, l]) => h('button', { role: 'tab', dataset: { tab: k }, onclick: () => this.go(k) }, h('span', { 'aria-hidden': 'true' }, e), h('span', { class: 'tp-tab-label' }, l))));
    this.headEl = h('div', { class: 'tp-trip-title' });
    this.body = h('div', { class: 'tp-body' });
    clear(this.root, h('div', { class: 'tp-trip', style: { '--c': t.color || '#1c7ed6' } },
      h('header', { class: 'tp-trip-head' },
        h('button', { class: 'tp-icon-btn', 'aria-label': 'All trips', title: 'All trips', onclick: () => this.showDashboard() }, '←'),
        this.headEl,
        h('div', { class: 'tp-trip-tools' },
          h('button', { class: 'btn btn-sm', title: 'Share', onclick: () => this.shareDialog() }, '🔗', h('span', { class: 'tp-tab-label' }, 'Share')),
          h('button', { class: 'btn btn-sm', title: 'Print or save as PDF', onclick: () => printTrip(this.store) }, '🖨', h('span', { class: 'tp-tab-label' }, 'Print')),
          h('button', { class: 'btn btn-sm', title: 'Trip settings', onclick: () => this.settingsDialog() }, '⚙', h('span', { class: 'tp-tab-label' }, 'Trip settings')))),
      this.tabsEl, this.body));
    this.drawHead();
  }
  drawHead() {
    const t = this.store.trip;
    clear(this.headEl, h('span', { class: 'tp-trip-cover' }, t.cover || '🗺️'),
      h('div', {}, h('h2', {}, t.title), h('p', { class: 'muted small' }, [t.destination, t.start ? fmtRange(t.start, t.end) : null, t.start ? countdown(t) : null].filter(Boolean).join(' · '))),
      h('div', { class: 'tp-avatars', title: t.members.map((m) => m.name).join(', ') }, t.members.slice(0, 6).map((m) => avatar(m, 26))));
    this.root.querySelector('.tp-trip')?.style.setProperty('--c', t.color || '#1c7ed6');
  }

  go(tab, focus) {
    this.tab = tab;
    this.tabsEl.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const make = { plan: () => new PlanView(this), bookings: () => new BookingsView(this), costs: () => new CostsView(this), packing: () => new ListsView(this, 'packing'), todo: () => new ListsView(this, 'todo'), files: () => new FilesView(this), notes: () => new NotesView(this) };
    if (this.view && this.view !== this.views[tab]) this.view.hide?.();
    this.view = this.views[tab] ||= make[tab]();
    // Each tab keeps its own box, so the map isn't rebuilt when coming back to the plan.
    this.boxes ||= {};
    for (const [k, b] of Object.entries(this.boxes)) b.hidden = k !== tab;
    if (!this.boxes[tab] || !this.boxes[tab].isConnected) { this.boxes[tab] = h('div', { class: `tp-tabbox tp-tab-${tab}` }); this.body.append(this.boxes[tab]); }
    this.boxes[tab].hidden = false;
    this.view.focus = focus;
    this.view.render(this.boxes[tab]);
  }

  refresh() {
    if (!this.store) return;
    this.drawHead();
    this.view?.render(this.boxes[this.tab]);
    for (const [k, v] of Object.entries(this.views)) if (v !== this.view) v.stale = true;
  }

  // --- Sharing ------------------------------------------------------------------------------------

  shareDialog() {
    const t = this.store.trip;
    const o = { map: true, bookings: false, packing: false, costs: false, notes: false, ...(t.shareOptions || {}) };
    const body = h('div', { class: 'tp-form' });
    const draw = () => {
      const t2 = this.store.trip;
      const link = t2.shareToken ? `${location.origin}/trip/${t2.shareToken}` : null;
      const feed = t2.icsToken ? `${location.origin}/trip-feed/${t2.icsToken}.ics` : null;
      const opt = (k, label) => h('label', { class: 'tp-check' }, h('input', { type: 'checkbox', checked: o[k], disabled: k === 'map', onchange: async (e) => { o[k] = e.target.checked; if (t2.shareToken) await this.store.share({ options: o }).catch(toastError); } }), label);
      const copy = (u) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { navigator.clipboard?.writeText(u); toast('Copied', { timeout: 1200 }); } }, 'Copy');
      clear(body,
        h('h4', {}, 'A read-only link'),
        h('p', { class: 'muted small' }, 'Anyone with the link can see the plan and map — without signing in. Choose what else they see:'),
        h('div', { class: 'tp-checks' }, opt('map', 'Plan & map'), opt('bookings', 'Bookings (without booking codes)'), opt('packing', 'Packing & to-dos'), opt('costs', 'Costs'), opt('notes', 'Notes, links & polls')),
        link ? h('div', { class: 'tp-copyrow' }, input({ value: link, readonly: true, onclick: (e) => e.target.select() }), copy(link), h('a', { class: 'btn btn-sm', href: link, target: '_blank', rel: 'noopener' }, 'Open')) : null,
        h('div', { class: 'tp-row' }, link
          ? [h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await this.store.share({ renew: true, options: o }); draw(); } }, 'New link'), h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: async () => { await this.store.share({ enable: false }); draw(); } }, 'Stop sharing')]
          : h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { await this.store.share({ enable: true, options: o }).catch(toastError); draw(); } }, 'Make a link')),
        h('h4', {}, 'Calendar'),
        h('p', { class: 'muted small' }, 'Subscribe to this trip in a calendar app; it stays up to date. Or download it once as a file.'),
        feed ? h('div', { class: 'tp-copyrow' }, input({ value: feed, readonly: true, onclick: (e) => e.target.select() }), copy(feed), h('a', { class: 'btn btn-sm', href: feed.replace(/^https?:/, 'webcal:') }, 'Subscribe')) : null,
        h('div', { class: 'tp-row' }, feed ? h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await this.store.share({ ics: 'renew' }); draw(); } }, 'New address') : h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await this.store.share({ ics: true, enable: Boolean(t2.shareToken) }); draw(); } }, 'Make a calendar address'),
          h('a', { class: 'btn btn-sm', href: `/portal/trips/trip/${encodeURIComponent(this.store.id)}/ics` }, 'Download .ics')));
    };
    draw();
    sheet(this.root, { title: 'Share this trip', body, actions: [{ label: 'Done', primary: true }] });
  }

  // --- The trip's settings ------------------------------------------------------------------------

  settingsDialog() {
    const t = this.store.trip;
    const title = input({ value: t.title, required: true });
    const dest = input({ value: t.destination || '' });
    const desc = textarea(t.description || '', { rows: 2 });
    const start = input({ type: 'date', value: t.start || '' });
    const end = input({ type: 'date', value: t.end || '' });
    const cur = select(CURRENCIES.map((c) => [c, c]), t.currency || 'EUR');
    const budget = input({ type: 'number', min: 0, step: 1, value: t.budget || '', placeholder: 'None' });
    let color = t.color || COLORS[0];
    let cover = t.cover || '🗺️';
    const colors = h('div', { class: 'tp-swatches' });
    const drawColors = () => clear(colors, COLORS.map((c) => h('button', { type: 'button', class: c === color ? 'on' : '', style: { background: c }, 'aria-label': c, onclick: () => { color = c; drawColors(); } })));
    drawColors();
    const covers = h('div', { class: 'tp-covers' });
    const drawCovers = () => clear(covers, COVERS.map((c) => h('button', { type: 'button', class: c === cover ? 'on' : '', onclick: () => { cover = c; drawCovers(); } }, c)));
    drawCovers();
    let members = t.members.map((m) => ({ ...m }));
    const memberBox = h('div', { class: 'tp-members' });
    const drawMembers = () => clear(memberBox, members.map((m, i) => h('div', { class: 'tp-member' },
      h('input', { type: 'color', value: m.color, 'aria-label': 'Colour', oninput: (e) => { m.color = e.target.value; } }),
      input({ value: m.name, 'aria-label': 'Name', oninput: (e) => { m.name = e.target.value; } }),
      h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': `Remove ${m.name}`, disabled: members.length < 2, onclick: () => { members = members.filter((x) => x !== m); drawMembers(); } }, '✕'))),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { members.push({ id: Math.random().toString(36).slice(2, 10), name: '', color: DAY_COLORS[members.length % DAY_COLORS.length] }); drawMembers(); memberBox.querySelector('.tp-member:last-of-type input:not([type=color])')?.focus(); } }, '＋ Add a traveller'));
    drawMembers();
    sheet(this.root, {
      title: 'Trip settings', wide: true,
      body: h('div', { class: 'tp-form tp-settings' },
        field('Name', title), field('Where to', dest), field('About', desc),
        h('div', { class: 'tp-row' }, field('From', start), field('To', end)),
        h('p', { class: 'muted small' }, 'Changing the start date moves the whole plan (and bookings) with it.'),
        h('div', { class: 'tp-row' }, field('Money in', cur), field(`Budget (${t.currency || 'EUR'})`, budget)),
        field('Colour', colors), field('Picture', covers),
        field('Travellers', memberBox, 'Everyone on the trip: for splitting costs, packing and to-dos.')),
      actions: [
        { label: t.archived ? 'Unarchive' : 'Archive', left: true, onClick: async (close) => { close(); await this.store.patchTrip({ archived: !t.archived }).catch(toastError); toast(t.archived ? 'Back from the archive' : 'Archived', { timeout: 1500 }); } },
        { label: 'Delete trip', danger: true, left: true, onClick: async (close) => { close(); if (await this.deleteTrip({ id: this.store.id, title: t.title })) this.showDashboard(); } },
        { label: 'Cancel' },
        { label: 'Save', primary: true, submit: true, onClick: async (close) => {
          close();
          try {
            const used = new Set([...this.store.all('expenses').flatMap((e) => [...Object.keys(e.paidBy || {}), ...Object.keys(e.shares || {})])]);
            const gone = t.members.filter((m) => !members.some((x) => x.id === m.id) && used.has(m.id));
            if (gone.length) { toast(`${gone.map((m) => m.name).join(', ')} can’t be removed: they’re in the costs`, { type: 'error', timeout: 4000 }); members.push(...gone); }
            await this.store.patchTrip({ title: title.value.trim() || t.title, destination: dest.value.trim(), description: desc.value, currency: cur.value, budget: Number(budget.value) || null, color, cover, members: members.map((m) => ({ ...m, name: m.name.trim() || 'Traveller' })) }, { label: 'trip settings' });
            if ((start.value || null) !== (t.start || null) || (end.value || null) !== (t.end || null)) {
              if (start.value) await this.store.redate(start.value, end.value || start.value);
              else await this.store.patchTrip({ start: null, end: null });
            }
          } catch (err) { toastError(err); }
        } }],
    });
  }
}


