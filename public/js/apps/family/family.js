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
import { themeWatcher, isDark, setDeviceTheme, themeIcon } from './theme.js';

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
// On a phone, these stay in the bar along the bottom; the rest are under More (the ☰ drawer).
const PHONE_TABS = new Set(['calendar', 'chores', 'meals', 'lists']);
const TAB_NAMES = { approvals: 'Approvals', settings: 'Settings' };
const PHONE = '(max-width: 760px)';
// Each button on the left has its own colour.
const RAIL_COLORS = { calendar: '#1c7ed6', chores: '#2f9e44', rewards: '#f08c00', meals: '#e8590c', lists: '#7048e8', photos: '#d6336c', approvals: '#1098ad', sleep: '#4263eb', settings: '#5c677d' };

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
    this.standalone = Boolean(opts.standalone);
    this.theme = themeWatcher(this);
    clear(this.root, h('div', { class: 'fam-loading' }, h('div', { class: 'spinner' }), 'Opening the family organizer…'));
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
    this.theme.stop();
    if (this.phoneMq) this.phoneMq.onchange = null;
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
    this.phoneMq = matchMedia(PHONE);
    // Phone ↔ wide (a window resized, a tablet turned): menus and toolbars change shape.
    this.phoneMq.onchange = () => { this.drawFilter(); if (this.tab && this.main.firstElementChild) this.go(this.tab); };
    const extra = (id) => (PHONE_TABS.has(id) ? '' : 'fam-rail-extra');
    this.rail = h('nav', { class: 'fam-rail' },
      TABS.map(([id, label, ic]) => h('button', { class: `fam-rail-btn ${extra(id)}`, style: { '--rc': RAIL_COLORS[id] }, dataset: { tab: id }, onclick: () => this.go(id) }, h('span', { html: ic }), h('span', {}, label))),
      // Signed in as a parent: everything waiting for a parent's approval, in one place.
      this.isParentUser() ? h('button', { class: 'fam-rail-btn fam-rail-extra', style: { '--rc': RAIL_COLORS.approvals }, dataset: { tab: 'approvals' }, onclick: () => this.go('approvals') },
        h('span', { class: 'fam-rail-icon', html: ICONS.approve }), h('span', {}, 'Approvals'), this.approvalBadge = h('span', { class: 'fam-rail-badge', hidden: true })) : null,
      h('div', { class: 'fam-rail-gap' }),
      // Phones: More, for everything not in the bottom bar.
      this.moreTab = h('button', { class: 'fam-rail-btn fam-rail-morebtn', style: { '--rc': RAIL_COLORS.settings }, 'aria-label': 'More', onclick: () => this.openDrawer() },
        h('span', { html: ICONS.menu }), h('span', {}, 'More'), this.moreBadge = h('span', { class: 'fam-rail-badge', hidden: true })),
      h('button', { class: 'fam-rail-btn small fam-rail-extra', style: { '--rc': RAIL_COLORS.sleep }, title: 'Sleep', onclick: () => this.sleep(true) }, h('span', { html: ICONS.sleep }), h('span', {}, 'Sleep')),
      h('button', { class: 'fam-rail-btn small fam-rail-extra', style: { '--rc': RAIL_COLORS.settings }, dataset: { tab: 'settings' }, onclick: () => this.go('settings') }, h('span', { html: ICONS.settings }), h('span', {}, 'Settings')));
    // Phones: a drawer on the left (☰) holds the section's parts and everything under More.
    this.menuBtn = h('button', { class: 'fam-icon-btn fam-menu-btn', 'aria-label': 'Open the menu', 'aria-expanded': 'false', html: ICONS.menu, onclick: () => this.openDrawer() },
      this.menuBadge = h('span', { class: 'fam-menu-dot', hidden: true }));
    // Phones: the section's name (and part) where the clock is on a big screen.
    this.pageTitle = h('div', { class: 'fam-page-title' });
    // Phones: who's shown, as one button instead of the row of faces.
    this.peopleBtn = h('button', { class: 'fam-people-btn', 'aria-label': 'Choose whose things to show', onclick: () => this.choosePeople() });
    this.header = h('header', { class: 'fam-header' },
      this.menuBtn, this.clock, this.pageTitle, this.wx,
      h('div', { class: 'fam-spacer' }),
      this.filterEl, this.peopleBtn,
      h('button', { class: 'fam-btn fam-quick-btn', title: 'Type events the way you’d say them', onclick: () => this.calendar.quickAdd() }, h('span', { html: ICONS.sparkle }), h('span', { class: 'fam-hide-sm' }, 'Quick add')),
      h('button', { class: 'fam-btn primary fam-add-btn', 'aria-label': 'Add', onclick: () => (this.isPhone() ? this.addMenu() : this.add()) }, h('span', { html: ICONS.plus }), h('span', { class: 'fam-hide-sm' }, 'Add')),
      h('button', { class: `fam-icon-btn fam-theme-btn ${this.session?.user ? 'fam-hide-sm' : ''}`, title: 'Light or dark', 'aria-label': 'Switch between light and dark', onclick: () => this.toggleTheme() }, ...themeIcon(this.root.classList.contains('fam-dark'))),
      h('button', { class: 'fam-icon-btn fam-hide-sm', title: 'Full screen', html: ICONS.expand, onclick: () => this.fullscreen() }),
      this.session?.user && !this.session.user.viaMediaDesk ? h('button', { class: 'fam-account-btn', title: `Signed in as ${this.session.user.first} ${this.session.user.last}`, onclick: () => this.accountMenu() },
        `${this.session.user.first[0] || ''}${this.session.user.last[0] || ''}`.toUpperCase()) : null);
    this.main = h('main', { class: 'fam-main' });
    // A second menu beside the left one, for a section with parts of its own (Settings).
    this.subnav = h('nav', { class: 'fam-subrail', hidden: true });
    this.drawerTitle = h('div', { class: 'fam-drawer-title' });
    this.drawerBody = h('nav', { class: 'fam-drawer-part' });
    const moreBtn = (id, label, ic, onclick, badge = null) => h('button', { class: 'fam-rail-btn', style: { '--rc': RAIL_COLORS[id] }, dataset: { tab: id }, onclick: () => { this.closeDrawer(); onclick(); } },
      h('span', { html: ic }), h('span', {}, label), badge);
    this.drawerMore = h('nav', { class: 'fam-drawer-more', 'aria-label': 'More' },
      h('div', { class: 'fam-drawer-title' }, 'More'),
      TABS.filter(([id]) => !PHONE_TABS.has(id)).map(([id, label, ic]) => moreBtn(id, label, ic, () => this.go(id))),
      this.isParentUser() ? moreBtn('approvals', 'Approvals', ICONS.approve, () => this.go('approvals'), this.drawerApprovalBadge = h('span', { class: 'fam-list-count', hidden: true })) : null,
      moreBtn('settings', 'Settings', ICONS.settings, () => this.go('settings')),
      moreBtn('sleep', 'Sleep', ICONS.sleep, () => this.sleep(true)));
    this.drawer = h('div', { class: 'fam-drawer', hidden: true, onkeydown: (e) => { if (e.key === 'Escape') this.closeDrawer(); } },
      h('div', { class: 'fam-drawer-shade', onclick: () => this.closeDrawer() }),
      h('div', { class: 'fam-drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu' },
        h('div', { class: 'fam-drawer-head' }, this.drawerTitle, h('button', { class: 'fam-icon-btn', 'aria-label': 'Close the menu', html: ICONS.close, onclick: () => this.closeDrawer() })),
        h('div', { class: 'fam-drawer-body' }, this.drawerBody, this.drawerMore)));
    clear(this.root, this.rail, this.subnav, h('div', { class: 'fam-content' }, this.header, this.main), this.drawer);
    this.drawFilter();
    this.updateApprovalBadge();
  }

  // The signed-in account: your details, and signing out.
  accountMenu() {
    const u = this.session.user;
    const menu = sheet(this.root, {
      title: `${u.first} ${u.last}`,
      body: h('div', { class: 'fam-form' },
        h('div', { class: 'fam-muted' }, `${u.username} · ${u.email}`),
        h('div', { class: 'fam-muted small' }, u.role === 'parent' ? 'Parent' : 'Family member'),
        // On a phone the light/dark button lives here (the top bar has no room for it).
        h('button', { type: 'button', class: 'fam-btn fam-theme-menu', onclick: () => { menu.close(); this.toggleTheme(); } }, ...themeIcon(this.root.classList.contains('fam-dark')), this.root.classList.contains('fam-dark') ? 'Light mode' : 'Dark mode')),
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
    for (const b of this.root.querySelectorAll('.fam-rail .fam-rail-btn, .fam-drawer-more .fam-rail-btn')) b.classList.toggle('on', b.dataset.tab === tab);
    this.moreTab.classList.toggle('on', !PHONE_TABS.has(tab));
    this.root.dataset.tab = tab;
    if (tab === 'lists' && section) this.views.lists.listId = section;
    const view = this.views[tab];
    // A section with parts of its own puts them back as it draws (subMenu).
    this.subnav.hidden = true;
    clear(this.subnav);
    this.closeDrawer();
    this.drawerBody.hidden = true;
    clear(this.drawerBody);
    this.drawerTitle.textContent = 'Menu';
    this.setPageTitle(this.tabName(tab));
    const el = h('div', { class: `fam-view fam-view-${tab}` });
    clear(this.main, el);
    if (tab === 'settings') view.render(el, section); else view.render(el);
    this.win.setTitle(tab === 'calendar' ? 'Family Organizer' : `Family Organizer — ${this.tabName(tab)}`);
  }

  tabName(tab) { return TAB_NAMES[tab] || TABS.find((t) => t[0] === tab)?.[1] || ''; }

  isPhone() { return this.phoneMq.matches; }

  setPageTitle(name, part = '') {
    clear(this.pageTitle, h('b', {}, name), part && part !== name ? h('span', {}, part) : null);
  }

  // A section's parts (Calendar's views, Chores and Routines, Meal plan and Recipe box, Lists,
  // Settings' pages) as a menu beside the left one, styled like it. On a phone, where there's no
  // room beside it, they go in a drawer that slides in from the left (the ☰ button at the top).
  // Returns null: the section has nothing of the menu's to place itself.
  // items: [id, label, icon (an SVG, or an emoji), colour, { cls, extra }]; after: more to show below.
  subMenu(title, items, current, pick, cls = '', { after = null } = {}) {
    const buttons = items.map(([id, label, icon, color, more = {}]) => h('button', {
      class: `fam-rail-btn ${id === current ? 'on' : ''} ${more.cls || ''}`, style: { '--rc': color }, dataset: { section: id }, 'aria-current': id === current ? 'page' : null, onclick: () => { this.closeDrawer(); pick(id); },
    }, String(icon).startsWith('<') ? h('span', { html: icon }) : h('span', { class: 'fam-rail-emoji' }, icon),
      h('span', {}, ...String(label ?? '').split('/').flatMap((part, i) => (i ? ['/', h('wbr'), part] : [part]))), more.extra || null));
    if (after) buttons.push(after);
    const tab = this.tab;
    const on = items.find((it) => it[0] === current);
    this.setPageTitle(this.tabName(tab), on ? String(on[1]) : '');
    if (!this.isPhone()) {
      this.subnav.hidden = false;
      this.subnav.className = `fam-subrail fam-subrail-${tab} ${cls}`;
      clear(this.subnav, h('div', { class: 'fam-subrail-title' }, title), buttons);
      return null;
    }
    this.subnav.hidden = true;
    clear(this.subnav);
    // Anything else in the menu (Lists' "New list") closes the drawer too.
    after?.addEventListener('click', (e) => { if (e.target.closest('button')) this.closeDrawer(); });
    this.drawer.className = `fam-drawer fam-drawer-${tab} ${cls} ${this.drawer.hidden ? '' : 'open'}`;
    this.drawerTitle.textContent = title;
    clear(this.drawerBody, buttons);
    this.drawerBody.hidden = false;
    return null;
  }

  openDrawer() {
    if (!this.drawer.hidden) return;
    this.drawer.hidden = false;
    this.menuBtn.setAttribute('aria-expanded', 'true');
    // Next frame, so the panel slides in rather than appearing.
    requestAnimationFrame(() => this.drawer.classList.add('open'));
    (this.drawerBody.querySelector('.fam-rail-btn.on') || this.drawerBody.querySelector('button'))?.focus({ preventScroll: true });
  }

  closeDrawer() {
    if (!this.drawer || this.drawer.hidden) return;
    const wasOpen = this.drawer.contains(document.activeElement);
    this.drawer.classList.remove('open');
    this.drawer.hidden = true;
    this.menuBtn.setAttribute('aria-expanded', 'false');
    if (wasOpen) this.menuBtn.focus({ preventScroll: true });
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
    // Phones: Approvals is under More, so More and ☰ show there's something waiting.
    for (const b of [this.moreBadge, this.drawerApprovalBadge]) { if (b) { b.hidden = !n; b.textContent = this.approvalBadge.textContent; } }
    if (this.menuBadge) this.menuBadge.hidden = !n;
  }

  changed(what) {
    this.theme.apply();
    this.updateApprovalBadge();
    if (what === 'settings' && this.tab === 'settings') return;
    this.drawFilter();
    this.refresh();
  }

  // Show everyone again (the "All" button at the top).
  clearFilter() { this.filter = new Set(); this.prefs.filter = []; savePrefs(this.prefs); this.drawFilter(); this.refresh(); }

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
    // The phone's one button: everyone, or the faces of whoever's picked.
    this.peopleBtn.hidden = !members.length;
    const picked = members.filter((m) => this.filter.has(m.id));
    clear(this.peopleBtn, picked.length
      ? h('span', { class: 'fam-people-faces' }, picked.slice(0, 3).map((m) => avatar(m, 'xs')), picked.length > 3 ? h('small', {}, `+${picked.length - 3}`) : null)
      : [h('span', { class: 'fam-people-icon', html: ICONS.family }), h('span', {}, 'All')]);
    this.peopleBtn.classList.toggle('on', Boolean(picked.length));
  }

  // Phones: pick whose things to show, in a sheet (tap people to add or take them away).
  choosePeople() {
    const members = this.store.members();
    const body = h('div', { class: 'fam-people-pick' });
    const set = (next) => { this.filter = next; this.prefs.filter = [...next]; savePrefs(this.prefs); this.drawFilter(); this.refresh(); draw(); };
    const draw = () => clear(body,
      h('button', { type: 'button', class: `fam-people-row ${this.filter.size ? '' : 'on'}`, onclick: () => set(new Set()) },
        h('span', { class: 'fam-people-icon', html: ICONS.family }), h('span', {}, 'Everyone'), h('span', { class: 'fam-people-check', html: ICONS.check })),
      members.map((m) => h('button', {
        type: 'button', class: `fam-people-row ${this.filter.has(m.id) ? 'on' : ''}`, style: { '--c': m.color },
        onclick: () => { const next = new Set(this.filter); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); set(next); },
      }, avatar(m, 'sm'), h('span', {}, m.name), h('span', { class: 'fam-people-check', html: ICONS.check }))));
    draw();
    sheet(this.root, { title: 'Show', body, cls: 'fam-people-sheet', actions: [{ label: 'Done', primary: true }] });
  }

  // Phones: the one + button offers quick add, and adding whatever fits the screen you're on.
  addMenu() {
    const v = this.views[this.tab];
    const label = {
      calendar: 'New event', chores: v?.mode === 'routines' ? 'New routine' : 'New chore', rewards: 'New reward',
      meals: v?.tab === 'recipes' ? 'New recipe' : 'Plan a meal', lists: 'Add to this list', photos: 'Add photos',
    }[this.tab] || 'New event';
    const s = sheet(this.root, {
      title: 'Add', cls: 'fam-add-sheet',
      body: h('div', { class: 'fam-add-menu' },
        h('button', { type: 'button', class: 'fam-add-choice', onclick: () => { s.close(); this.calendar.quickAdd(); } },
          h('span', { html: ICONS.sparkle }), h('span', {}, h('b', {}, 'Quick add'), h('small', {}, 'Type an event the way you’d say it'))),
        h('button', { type: 'button', class: 'fam-add-choice', onclick: () => { s.close(); this.add(); } },
          h('span', { html: ICONS.plus }), h('span', {}, h('b', {}, label)))),
    });
  }

  // A toolbar's less-used buttons: as they are on a big screen, behind one ⋯ button on a phone.
  toolbarMore(buttons, title = 'More') {
    buttons = buttons.filter(Boolean);
    if (!buttons.length || !this.isPhone()) return buttons;
    let open = null;
    for (const b of buttons) {
      if (b.tagName === 'BUTTON') b.type = 'button';
      // Close the sheet first, so whatever the button opens comes up on top.
      b.addEventListener('click', () => open?.close(), { capture: true });
    }
    return h('button', { class: 'fam-icon-btn fam-toolbar-more', title, 'aria-label': title, html: ICONS.more,
      onclick: () => { open = sheet(this.root, { title, cls: 'fam-more-sheet', body: h('div', { class: 'fam-more-list' }, buttons) }); } });
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

  // The sun/moon button: this screen switches to light or dark (Settings → General has the rest).
  toggleTheme() {
    const dark = !isDark(this.store.settings, { standalone: this.standalone });
    setDeviceTheme(dark ? 'dark' : 'light');
    this.theme.apply();
    toast(dark ? 'Dark mode on this screen' : 'Light mode on this screen', { timeout: 3000, action: { label: 'Settings', onClick: () => this.go('settings', 'general') } });
    if (this.tab === 'settings') this.views.settings.render(this.main);
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
    // Gift lists' countdown reminders and Christmas shipping cutoffs.
    try { this.views.lists?.gifts?.reminders(from, now); } catch (err) { console.warn('Family Organizer: gift reminders', err); }
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

