// Family Organizer: a family hub in the spirit of a Skylight Calendar. A shared, colour-coded
// family calendar (with Google, Outlook, iCloud and other calendars connected), chore charts,
// routines and rewards, meal planning with a recipe box, grocery and to-do lists, a photo
// frame and sleep mode. Everything is kept on the MediaDesk server, so every device in the
// house shows the same thing.

import { h, clear, toast } from '../../ui.js';
import { appIcon } from '../../icons.js';
import { Store, familyAuth } from './store.js';
import { CalendarView } from './calendar.js';
import { ChoresView, RewardsView, ApprovalsView } from './chores.js';
import { MealsView } from './meals.js';
import { ListsView } from './lists.js';
import { PhotosView, photoFrame, sleepScreen } from './photos.js';
import { SettingsView } from './settings.js';
import { avatar, sheet, ICONS, weatherIcon, setParentSession } from './shared.js';
import { expand, addDays, fmtTime } from './dates.js';

let cssLoaded = false;
const loadCss = () => {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../../css/family.css', import.meta.url).href }));
};

const PREFS = 'mediadesk.family';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* storage blocked */ } };

const TABS = [
  ['calendar', 'Calendar', ICONS.calendar],
  ['chores', 'Chores', ICONS.chores],
  ['rewards', 'Rewards', ICONS.rewards],
  ['meals', 'Meals', ICONS.meals],
  ['lists', 'Lists', ICONS.lists],
  ['photos', 'Photos', ICONS.photos],
];

export const familyApp = {
  id: 'family', name: 'Family Organizer', icon: appIcon.family, size: [1240, 820], description: 'Family calendar, chores, meals, lists and photo frame',
  open(win, opts = {}) {
    loadCss();
    const app = new FamilyOrganizer(win, opts);
    win.on('reopen', (o) => { if (o?.tab) app.go(o.tab, o.section); });
    win.on('close', () => app.destroy());
  },
};

class FamilyOrganizer {
  constructor(win, opts) {
    this.win = win;
    this.prefs = loadPrefs();
    this.filter = new Set(this.prefs.filter || []);
    this.weather = null;
    this.timers = [];
    this.lastActive = Date.now();
    this.wokeAt = 0;
    this.remindedUpTo = Date.now();
    this.store = new Store();
    this.root = h('div', { class: 'fam fam-root' });
    win.body.classList.add('fam-window');
    clear(win.body, this.root);
    clear(this.root, h('div', { class: 'fam-loading' }, h('div', { class: 'spinner' }), 'Opening the family organizer…'));
    this.standalone = Boolean(opts.standalone);
    Promise.all([familyAuth.session(), this.store.load()]).then(([session]) => {
      // Who's using it: a family account (on its own at /family) or MediaDesk's own sign-in.
      this.session = session;
      // A parent's own account skips the parent PIN; MediaDesk (often a shared screen) still asks.
      setParentSession(session.user?.role === 'parent');
      this.start(opts);
    }).catch((err) => {
      clear(this.root, h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '😕'), `The organizer couldn’t load: ${err.message}`, h('button', { class: 'fam-btn primary', onclick: () => { this.destroy(); familyApp.open(win, opts); } }, 'Try again')));
    });
  }

  start(opts) {
    this.calendar = new CalendarView(this);
    this.views = {
      calendar: this.calendar,
      chores: new ChoresView(this),
      rewards: new RewardsView(this),
      meals: new MealsView(this),
      lists: new ListsView(this),
      photos: new PhotosView(this),
      settings: new SettingsView(this),
      approvals: new ApprovalsView(this),
    };
    this.build();
    // First time: there's nobody in the family yet.
    const first = !this.store.members().length;
    this.go(opts.tab || (first ? 'settings' : this.prefs.tab || this.store.settings.startPage || 'calendar'), first ? 'profiles' : opts.section);
    if (first) toast('Welcome! Start by adding the people in your family.', { timeout: 6000 });
    // Keep the browser's time zone, so the phone calendar address uses the family's local time.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && this.store.settings.timeZone !== tz && !this.store.settings.timeZoneFixed) this.store.setSettings({ timeZone: tz }).catch(() => {});
    this.unsub = this.store.on((what) => this.changed(what));
    this.store.start();
    this.loadWeather();
    this.timers.push(setInterval(() => this.tick(), 1000 * 20));
    this.timers.push(setInterval(() => this.loadWeather(), 30 * 60e3));
    this.tickClock();
    this.timers.push(setInterval(() => this.tickClock(), 1000 * 10));
    const active = () => { this.lastActive = Date.now(); };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) this.root.addEventListener(ev, active, { passive: true });
  }

  destroy() {
    this.store.stop();
    this.unsub?.();
    this.timers.forEach(clearInterval);
    this.frameOpen?.();
    this.sleepOpen?.();
  }

  build() {
    this.clock = h('div', { class: 'fam-clock' });
    this.wx = h('button', { class: 'fam-weather', title: 'Weather', onclick: () => this.showWeather() });
    this.filterEl = h('div', { class: 'fam-filter' });
    this.rail = h('nav', { class: 'fam-rail' },
      TABS.map(([id, label, ic]) => h('button', { class: 'fam-rail-btn', dataset: { tab: id }, onclick: () => this.go(id) }, h('span', { html: ic }), h('span', {}, label))),
      // Signed in as a parent: everything waiting for a parent's approval, in one place.
      this.isParentUser() ? h('button', { class: 'fam-rail-btn', dataset: { tab: 'approvals' }, onclick: () => this.go('approvals') },
        h('span', { class: 'fam-rail-icon', html: ICONS.approve }), h('span', {}, 'Approvals'), this.approvalBadge = h('span', { class: 'fam-rail-badge', hidden: true })) : null,
      h('div', { class: 'fam-rail-gap' }),
      h('button', { class: 'fam-rail-btn small', title: 'Sleep', onclick: () => this.sleep(true) }, h('span', { html: ICONS.sleep }), h('span', {}, 'Sleep')),
      h('button', { class: 'fam-rail-btn small', dataset: { tab: 'settings' }, onclick: () => this.go('settings') }, h('span', { html: ICONS.settings }), h('span', {}, 'Settings')));
    this.header = h('header', { class: 'fam-header' },
      this.clock, this.wx,
      h('div', { class: 'fam-spacer' }),
      this.filterEl,
      h('button', { class: 'fam-btn fam-quick-btn', title: 'Type events the way you’d say them', onclick: () => this.calendar.quickAdd() }, h('span', { html: ICONS.sparkle }), h('span', { class: 'fam-hide-sm' }, 'Quick add')),
      h('button', { class: 'fam-btn primary', onclick: () => this.add() }, h('span', { html: ICONS.plus }), h('span', { class: 'fam-hide-sm' }, 'Add')),
      h('button', { class: 'fam-icon-btn fam-hide-sm', title: 'Full screen', html: ICONS.expand, onclick: () => this.fullscreen() }),
      this.session?.user ? h('button', { class: 'fam-account-btn', title: `Signed in as ${this.session.user.first} ${this.session.user.last}`, onclick: () => this.accountMenu() },
        `${this.session.user.first[0] || ''}${this.session.user.last[0] || ''}`.toUpperCase()) : null);
    this.main = h('main', { class: 'fam-main' });
    clear(this.root, this.rail, h('div', { class: 'fam-content' }, this.header, this.main));
    this.drawFilter();
    this.updateApprovalBadge();
  }

  // The signed-in account: your details, and signing out.
  accountMenu() {
    const u = this.session.user;
    sheet(this.root, {
      title: `${u.first} ${u.last}`,
      body: h('div', { class: 'fam-form' },
        h('div', { class: 'fam-muted' }, `${u.username} · ${u.email}`),
        h('div', { class: 'fam-muted small' }, u.role === 'parent' ? 'Parent' : 'Family member')),
      actions: [
        { label: 'Sign out', danger: true, left: true, onClick: async (close) => { close(); try { await familyAuth.logout(); } catch { /* signed out anyway */ } location.reload(); } },
        { label: 'My account', onClick: (close) => { close(); this.go('settings', 'account'); } },
        u.role === 'parent' ? { label: 'Accounts', primary: true, onClick: (close) => { close(); this.go('settings', 'accounts'); } } : { label: 'Close', primary: true },
      ],
    });
  }

  go(tab, section) {
    if (!this.views[tab] || (tab === 'approvals' && !this.isParentUser())) tab = 'calendar';
    this.tab = tab;
    this.prefs.tab = tab;
    savePrefs(this.prefs);
    for (const b of this.rail.querySelectorAll('.fam-rail-btn')) b.classList.toggle('on', b.dataset.tab === tab);
    this.root.dataset.tab = tab;
    if (tab === 'lists' && section) this.views.lists.listId = section;
    const view = this.views[tab];
    const el = h('div', { class: `fam-view fam-view-${tab}` });
    clear(this.main, el);
    if (tab === 'settings') view.render(el, section); else view.render(el);
    this.win.setTitle(tab === 'calendar' ? 'Family Organizer' : `Family Organizer — ${tab === 'settings' ? 'Settings' : tab === 'approvals' ? 'Approvals' : TABS.find((t) => t[0] === tab)[1]}`);
  }

  // Redraw after a change, keeping the place you were typing.
  refresh() {
    const el = this.main.firstElementChild;
    if (!el || this.root.querySelector('.fam-block.dragging')) return;
    const act = document.activeElement;
    const keep = act && el.contains(act) && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA') ? { cls: act.className, value: act.value, pos: act.selectionStart } : null;
    const scroll = [...el.querySelectorAll('.fam-board, .fam-list-items, .fam-agenda, .fam-settings, .fam-meals-body, .fam-photos')].map((x) => x.scrollTop);
    if (this.tab === 'calendar') this.calendar.draw(); else this.views[this.tab].render(el);
    [...el.querySelectorAll('.fam-board, .fam-list-items, .fam-agenda, .fam-settings, .fam-meals-body, .fam-photos')].forEach((x, i) => { if (scroll[i]) x.scrollTop = scroll[i]; });
    if (keep) {
      const again = el.querySelector(`.${keep.cls.trim().split(/\s+/).join('.')}`);
      if (again) { again.value = keep.value; again.focus(); try { again.setSelectionRange(keep.pos, keep.pos); } catch { /* not a text box */ } }
    }
  }

  savePrefs() { savePrefs(this.prefs); }

  isParentUser() { return this.session?.user?.role === 'parent'; }

  updateApprovalBadge() {
    if (!this.approvalBadge) return;
    const n = this.views.approvals.count();
    this.approvalBadge.hidden = !n;
    this.approvalBadge.textContent = n > 99 ? '99+' : String(n);
  }

  changed(what) {
    this.updateApprovalBadge();
    if (what === 'settings' && this.tab === 'settings') return;
    this.drawFilter();
    this.refresh();
  }

  drawFilter() {
    const members = this.store.members();
    for (const id of [...this.filter]) if (id !== 'family' && !this.store.member(id)) this.filter.delete(id);
    const setFilter = (next) => { this.filter = next; this.prefs.filter = [...next]; savePrefs(this.prefs); this.drawFilter(); this.refresh(); };
    clear(this.filterEl, members.length ? [
      h('button', { class: `fam-filter-all ${this.filter.size ? '' : 'on'}`, title: 'Everyone', onclick: () => setFilter(new Set()) }, 'All'),
      members.map((m) => h('button', {
        class: `fam-filter-btn ${this.filter.has(m.id) ? 'on' : ''} ${this.filter.size && !this.filter.has(m.id) ? 'off' : ''}`, style: { '--c': m.color }, title: `Show ${m.name}`,
        onclick: (e) => {
          const next = new Set(this.filter);
          if (e.shiftKey || e.ctrlKey || e.metaKey) { if (next.has(m.id)) next.delete(m.id); else next.add(m.id); } else if (next.size === 1 && next.has(m.id)) next.clear(); else if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
          setFilter(next);
        },
      }, avatar(m, 'md'))),
    ] : null);
  }

  // The + button adds whatever fits the screen you're on.
  add() {
    const v = this.views[this.tab];
    if (this.tab === 'chores') v.edit(null);
    else if (this.tab === 'rewards') v.edit(null);
    else if (this.tab === 'meals') v.tab === 'recipes' ? v.editRecipe(null) : v.editMeal(null, new Date().toISOString().slice(0, 10), 'dinner');
    else if (this.tab === 'lists') this.root.querySelector('.fam-list-entry')?.focus() || v.editList(null);
    else if (this.tab === 'photos') this.root.querySelector('.fam-view-photos input[type=file]')?.click();
    else this.calendar.edit(null, this.tab === 'calendar' && this.calendar.view !== 'month' ? { date: this.calendar.date } : {});
  }

  tickClock() {
    const now = new Date();
    clear(this.clock, h('b', {}, now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })), h('span', {}, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
  }

  async loadWeather(refresh = false) {
    try {
      this.weather = await this.store.weather(refresh);
    } catch { this.weather = null; }
    const w = this.weather;
    if (!w?.configured) { clear(this.wx); this.wx.hidden = true; } else {
      this.wx.hidden = false;
      const today = w.daily?.[0];
      clear(this.wx, h('span', { class: 'fam-wx-icon' }, weatherIcon(w.current.code, w.current.day)[0]), h('b', {}, `${Math.round(w.current.temp)}°`),
        today ? h('small', { class: 'fam-hide-sm' }, `${Math.round(today.hi)}° / ${Math.round(today.lo)}°`) : null);
    }
    if (this.tab === 'calendar') this.calendar.draw();
  }

  showWeather() {
    const w = this.weather;
    if (!w?.configured) return;
    {
      const now = new Date();
      const hours = (w.hourly || []).filter((x) => new Date(x.t) >= new Date(now.getTime() - 36e5)).slice(0, 12);
      sheet(this.root, {
        title: `Weather — ${w.place}`, wide: true,
        body: h('div', { class: 'fam-wx-sheet' },
          h('div', { class: 'fam-wx-now' }, h('span', {}, weatherIcon(w.current.code, w.current.day)[0]), h('div', {}, h('b', {}, `${Math.round(w.current.temp)}°`), h('div', {}, weatherIcon(w.current.code, w.current.day)[1]),
            h('small', { class: 'fam-muted' }, `Feels like ${Math.round(w.current.feels)}° · Wind ${Math.round(w.current.wind)} ${w.units === 'metric' ? 'km/h' : 'mph'} · Humidity ${w.current.humidity}%`))),
          h('div', { class: 'fam-wx-hours' }, hours.map((x) => h('div', {}, h('small', {}, fmtTime(new Date(x.t))), h('span', {}, weatherIcon(x.code)[0]), h('b', {}, `${Math.round(x.temp)}°`), x.rain >= 20 ? h('small', { class: 'rain' }, `${x.rain}%`) : null))),
          h('div', { class: 'fam-wx-days' }, (w.daily || []).slice(0, 10).map((d, i) => h('div', {},
            h('b', {}, i === 0 ? 'Today' : new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })),
            h('span', {}, weatherIcon(d.code)[0]), h('span', {}, `${Math.round(d.hi)}° / ${Math.round(d.lo)}°`), d.rain >= 20 ? h('small', { class: 'rain' }, `${d.rain}%`) : h('small', {}, ''))))),
        actions: [{ label: 'Close', primary: true }],
      });
    }
  }

  async frame(startAt = 0) {
    const list = await this.views.photos.photos();
    if (!list.length) { toast('Add some photos first', { timeout: 2500 }); this.go('photos'); return; }
    this.frameOpen?.();
    photoFrame(this, list, startAt);
  }

  sleep(manual = false) {
    if (this.sleepOpen) return;
    this.frameOpen?.();
    sleepScreen(this, { manual });
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.root.requestFullscreen?.().catch(() => toast('Full screen isn’t available here', { timeout: 2500 }));
  }

  // Every 20 seconds: reminders, sleep mode and the photo frame when nobody's around.
  tick() {
    const now = Date.now();
    const s = this.store.settings;
    if (s.reminders !== false) this.reminders(now);
    const hidden = document.hidden || this.win.minimized;
    if (hidden) return;
    const sl = s.sleep;
    // Asleep at night; after a tap it stays awake until it's been left alone for a few minutes.
    if (sl?.on && !this.sleepOpen && now - this.wokeAt > 10 * 60e3 && now - this.lastActive > 3 * 60e3 && inWindow(new Date(), sl.from, sl.to)) this.sleep(false);
    if (sl?.on && this.sleepOpen && !inWindow(new Date(), sl.from, sl.to)) this.sleepOpen();
    const idle = Number(s.frameIdle) || 0;
    if (idle && !this.frameOpen && !this.sleepOpen && now - this.lastActive > idle * 60e3 && !this.root.querySelector('.fam-overlay')) {
      this.lastActive = now;
      this.frame().catch(() => {});
    }
  }

  reminders(now) {
    const from = this.remindedUpTo;
    this.remindedUpTo = now;
    const due = [];
    for (const ev of this.store.all('events')) {
      if (ev.reminder == null || ev.reminder === '') continue;
      const lead = Number(ev.reminder) * 60e3;
      for (const o of expand(ev, new Date(from + lead - 864e5), addDays(new Date(now + lead), 1))) {
        const at = (o.allDay ? new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate(), 9) : o.start).getTime() - lead;
        if (at > from && at <= now) due.push(o);
      }
    }
    for (const o of due) {
      const when = o.allDay ? 'Today' : `${fmtTime(o.start)}`;
      toast(o.ev.title, { body: `${when}${o.ev.location ? ` · ${o.ev.location}` : ''}`, icon: ICONS.bell, timeout: 15000 });
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(o.ev.title, { body: `${when}${o.ev.location ? ` · ${o.ev.location}` : ''}`, tag: o.key }); } catch { /* not allowed */ }
    }
  }
}

function inWindow(d, from = '21:30', to = '06:30') {
  const m = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const a = fh * 60 + fm;
  const b = th * 60 + tm;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

