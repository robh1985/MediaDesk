// The family calendar: month, week, day (a column for each person) and schedule views, the event
// editor with repeats, reminders and countdowns, and quick add.

import { h, clear, toast, toastError } from '../../ui.js';
import {
  ymd, parseYmd, addDays, addMonths, startOfDay, sameDay, startOfWeek, dayDiff, expand, eventSpan, describeRule,
  fmtTime, fmtDate, fmtRange, WEEKDAYS, DAY_SHORT, DAY_NAMES, MONTHS, parseQuickAdd, pad,
} from './dates.js';
import { sheet, field, input, select, toggle, avatar, memberPicker, ICONS, weatherIcon } from './shared.js';

const HOUR = 52; // pixels per hour in the day and week views
const FAMILY_COLOR = '#5c7cfa';

export class CalendarView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.view = app.store.settings.calendarView || 'month';
    this.date = startOfDay(new Date());
    this.scrolled = false;
  }

  get weekStart() { return Number(this.store.settings.weekStart) || 0; }

  // --- Events to show --------------------------------------------------------

  colorOf(ev) {
    // On one of the family's own calendars that's everyone's: that calendar's colour (someone's
    // calendar is in their colour, as a connected one is).
    const cal = ev.calendar ? this.store.get('calendars', ev.calendar) : null;
    if (cal?.custom && cal.color && !(cal.members || []).length) return cal.color;
    if (ev.color && !(ev.members || []).length) return ev.color;
    const m = (ev.members || []).map((id) => this.store.member(id)).find(Boolean);
    return m?.color || ev.color || this.store.settings.familyColor || FAMILY_COLOR;
  }

  visible(ev) {
    // Calendars hidden on this device (the Calendars button).
    const hidden = this.app.prefs.hiddenCalendars;
    if (hidden?.length && hidden.includes(ev.calendar && this.store.get('calendars', ev.calendar) ? ev.calendar : 'family')) return false;
    const f = this.app.filter;
    if (!f.size) return true;
    const ms = ev.members || [];
    return !ms.length ? f.has('family') || this.store.settings.showFamilyEvents !== false : ms.some((id) => f.has(id));
  }

  occurrences(from, to) {
    const out = [];
    for (const ev of this.store.events()) if (this.visible(ev)) out.push(...expand(ev, from, to));
    return out.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || (b.end - b.start) - (a.end - a.start) || a.ev.title.localeCompare(b.ev.title));
  }

  weatherFor(date) {
    const w = this.app.weather;
    return w?.daily?.find((d) => d.date === ymd(date)) || null;
  }

  // --- Layout ------------------------------------------------------------------

  render(el) {
    this.el = el;
    const views = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['schedule', 'Schedule']];
    const title = h('div', { class: 'fam-cal-title' });
    const bar = h('div', { class: 'fam-toolbar' },
      h('button', { class: 'fam-btn', onclick: () => { this.date = startOfDay(new Date()); this.scrolled = false; this.draw(); } }, 'Today'),
      h('div', { class: 'fam-nav' },
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Previous', html: ICONS.left, onclick: () => this.step(-1) }),
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Next', html: ICONS.right, onclick: () => this.step(1) })),
      title,
      h('div', { class: 'fam-spacer' }),
      this.store.all('calendars').length ? h('button', { class: `fam-btn fam-cals-btn ${this.app.prefs.hiddenCalendars?.length ? 'filtered' : ''}`, title: 'Show or hide calendars', onclick: () => this.chooseCalendars() }, h('span', { html: ICONS.calendar }), h('span', { class: 'fam-hide-sm' }, 'Calendars')) : null,
      h('div', { class: 'fam-seg' }, views.map(([id, label]) => h('button', {
        class: this.view === id ? 'on' : '', dataset: { view: id },
        onclick: () => { this.view = id; this.scrolled = false; this.store.setSettings({ calendarView: id }).catch(() => {}); this.render(el); },
      }, label))));
    this.titleEl = title;
    this.countdownEl = h('div', { class: 'fam-countdowns' });
    this.body = h('div', { class: `fam-cal fam-cal-${this.view}` });
    clear(el, bar, this.countdownEl, this.body);
    this.draw();
    // Swipe left and right to move through the calendar on touch screens.
    let sx = null;
    this.body.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') sx = [e.clientX, e.clientY, Date.now()]; });
    this.body.addEventListener('pointerup', (e) => {
      if (!sx) return;
      const [x, y, t] = sx; sx = null;
      const dx = e.clientX - x;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(e.clientY - y) * 1.5 && Date.now() - t < 600) this.step(dx < 0 ? 1 : -1);
    });
  }

  step(n) {
    const d = this.date;
    if (this.view === 'month') this.date = addMonths(new Date(d.getFullYear(), d.getMonth(), 1), n);
    else if (this.view === 'week') this.date = addDays(d, 7 * n);
    else if (this.view === 'schedule') this.date = addDays(d, 14 * n);
    else this.date = addDays(d, n);
    this.draw();
  }

  draw() {
    if (!this.body?.isConnected) return;
    const keep = this.body.querySelector('.fam-grid-scroll')?.scrollTop;
    this.drawCountdowns();
    if (this.view === 'month') this.drawMonth();
    else if (this.view === 'week') this.drawWeek();
    else if (this.view === 'day') this.drawDay();
    else this.drawSchedule();
    const sc = this.body.querySelector('.fam-grid-scroll');
    if (sc && keep !== undefined && this.scrolled) sc.scrollTop = keep;
  }

  drawCountdowns() {
    const now = new Date();
    const list = [];
    for (const ev of this.store.events()) {
      if (!ev.countdown || !this.visible(ev)) continue;
      const next = expand(ev, startOfDay(now), addDays(now, 400)).find((o) => o.end > now);
      if (next) list.push(next);
    }
    list.sort((a, b) => a.start - b.start);
    clear(this.countdownEl, list.slice(0, 6).map((o) => {
      const days = dayDiff(now, o.start);
      return h('button', { class: 'fam-countdown', style: { '--c': this.colorOf(o.ev) }, onclick: () => this.showEvent(o) },
        h('span', { class: 'fam-countdown-n' }, days <= 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`),
        h('span', { class: 'fam-countdown-t' }, o.ev.title));
    }));
    this.countdownEl.hidden = !list.length;
  }

  // --- Month -----------------------------------------------------------------------

  drawMonth() {
    const first = new Date(this.date.getFullYear(), this.date.getMonth(), 1);
    this.titleEl.textContent = `${MONTHS[first.getMonth()]} ${first.getFullYear()}`;
    const start = startOfWeek(first, this.weekStart);
    const weeks = Math.ceil((dayDiff(start, first) + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    const end = addDays(start, weeks * 7);
    const occ = this.occurrences(start, end);
    const today = new Date();
    const grid = h('div', { class: 'fam-month', style: { '--weeks': weeks } },
      Array.from({ length: 7 }, (_, i) => h('div', { class: 'fam-month-dow' }, DAY_SHORT[(i + this.weekStart) % 7])));
    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(start, i);
      const next = addDays(day, 1);
      const items = occ.filter((o) => o.start < next && o.end > day);
      const w = this.weatherFor(day);
      const cell = h('div', {
        class: `fam-month-cell ${day.getMonth() !== first.getMonth() ? 'other' : ''} ${sameDay(day, today) ? 'today' : ''} ${day < startOfDay(today) ? 'past' : ''}`,
        onclick: (e) => { if (e.target.closest('.fam-pill, .fam-more')) return; this.edit(null, { date: day }); },
      },
      h('div', { class: 'fam-month-head' },
        h('button', { class: 'fam-daynum', onclick: (e) => { e.stopPropagation(); this.date = day; this.view = 'day'; this.render(this.el); } }, day.getDate()),
        w ? h('span', { class: 'fam-month-wx', title: weatherIcon(w.code)[1] }, weatherIcon(w.code)[0], ` ${Math.round(w.hi)}°`) : null),
      h('div', { class: 'fam-month-events' }, items.map((o) => this.pill(o, day))));
      grid.append(cell);
    }
    clear(this.body, grid);
    // Show as many as fit in each day, then "+3 more".
    requestAnimationFrame(() => {
      for (const cell of grid.querySelectorAll('.fam-month-cell')) {
        const box = cell.querySelector('.fam-month-events');
        const pills = [...box.children];
        if (box.scrollHeight <= box.clientHeight + 1) continue;
        let hidden = 0;
        while (pills.length && box.scrollHeight > box.clientHeight + 1) { pills.pop().hidden = true; hidden++; if (pills.length && hidden === 1) { pills.pop().hidden = true; hidden++; } }
        const idx = [...cell.parentNode.children].indexOf(cell) - 7;
        box.append(h('button', { class: 'fam-more', onclick: (e) => { e.stopPropagation(); this.dayList(addDays(start, idx)); } }, `+${hidden} more`));
      }
    });
  }

  pill(o, day) {
    const color = this.colorOf(o.ev);
    const others = (o.ev.members || []).slice(1).map((id) => this.store.member(id)).filter(Boolean);
    const startsToday = sameDay(o.start, day);
    const multi = o.allDay ? dayDiff(o.start, o.end) > 1 : !sameDay(o.start, new Date(o.end - 1));
    return h('button', {
      class: `fam-pill ${o.allDay || multi ? 'solid' : ''} ${o.end < new Date() ? 'done' : ''}`, style: { '--c': color },
      title: `${o.ev.title}\n${o.allDay ? 'All day' : `${fmtTime(o.start)} – ${fmtTime(o.end)}`}`,
      onclick: (e) => { e.stopPropagation(); this.showEvent(o); },
    },
    !o.allDay && startsToday ? h('span', { class: 'fam-pill-time' }, fmtTime(o.start)) : null,
    h('span', { class: 'fam-pill-title' }, !startsToday && multi ? `↳ ${o.ev.title}` : o.ev.title),
    others.length ? h('span', { class: 'fam-pill-dots' }, others.map((m) => h('i', { style: { background: m.color } }))) : null);
  }

  dayList(day) {
    const occ = this.occurrences(day, addDays(day, 1));
    const s = sheet(this.app.root, {
      title: fmtDate(day),
      body: h('div', { class: 'fam-daylist' }, occ.map((o) => h('button', { class: 'fam-agenda-row', style: { '--c': this.colorOf(o.ev) }, onclick: () => { s.close(); this.showEvent(o); } },
        h('span', { class: 'fam-agenda-time' }, o.allDay ? 'All day' : fmtTime(o.start)), h('span', { class: 'fam-agenda-bar' }), h('span', { class: 'fam-agenda-title' }, o.ev.title)))),
      actions: [{ label: 'Add event', primary: true, onClick: (close) => { close(); this.edit(null, { date: day }); } }],
    });
  }

  // --- Week and day: hours down the side -------------------------------------------

  drawWeek() {
    const start = startOfWeek(this.date, this.weekStart);
    const end = addDays(start, 7);
    const sameMonth = start.getMonth() === addDays(end, -1).getMonth();
    this.titleEl.textContent = sameMonth ? `${MONTHS[start.getMonth()]} ${start.getFullYear()}` : `${MONTHS[start.getMonth()].slice(0, 3)} – ${MONTHS[addDays(end, -1).getMonth()].slice(0, 3)} ${addDays(end, -1).getFullYear()}`;
    const occ = this.occurrences(start, end);
    const cols = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const w = this.weatherFor(day);
      return {
        day, member: null,
        head: [h('span', { class: 'fam-col-dow' }, DAY_SHORT[day.getDay()]), h('span', { class: `fam-col-num ${sameDay(day, new Date()) ? 'today' : ''}` }, day.getDate()),
          w ? h('span', { class: 'fam-col-wx' }, `${weatherIcon(w.code)[0]} ${Math.round(w.hi)}°`) : null],
        onHead: () => { this.date = day; this.view = 'day'; this.render(this.el); },
        occ: occ.filter((o) => o.start < addDays(day, 1) && o.end > day),
      };
    });
    this.timeGrid(cols);
  }

  drawDay() {
    const day = this.date;
    const next = addDays(day, 1);
    this.titleEl.textContent = fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: day.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
    const occ = this.occurrences(day, next);
    const f = this.app.filter;
    const members = this.store.members().filter((m) => !f.size || f.has(m.id));
    const cols = members.map((m) => ({
      day, member: m,
      head: [avatar(m, 'sm'), h('span', { class: 'fam-col-name' }, m.name)],
      occ: occ.filter((o) => (o.ev.members || []).includes(m.id)),
    }));
    const shared = occ.filter((o) => !(o.ev.members || []).length);
    if (shared.length || !cols.length) cols.unshift({ day, member: null, head: [avatar(null, 'sm'), h('span', { class: 'fam-col-name' }, 'Everyone')], occ: shared });
    this.timeGrid(cols, this.dayExtras(day));
  }

  // What's for dinner and the weather, above the day view.
  dayExtras(day) {
    const meals = this.store.all('meals').filter((m) => m.date === ymd(day));
    const w = this.weatherFor(day);
    if (!meals.length && !w) return null;
    const order = ['breakfast', 'lunch', 'dinner', 'snack'];
    meals.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
    return h('div', { class: 'fam-day-extras' },
      w ? h('span', { class: 'fam-day-wx' }, `${weatherIcon(w.code)[0]} ${weatherIcon(w.code)[1]} · ${Math.round(w.hi)}° / ${Math.round(w.lo)}°${w.rain >= 30 ? ` · ${w.rain}% rain` : ''}`) : null,
      meals.map((m) => h('button', { class: 'fam-day-meal', onclick: () => this.app.go('meals') }, h('b', {}, `${m.slot[0].toUpperCase()}${m.slot.slice(1)}: `), m.title)));
  }

  timeGrid(cols, extras = null) {
    const allDay = h('div', { class: 'fam-allday', style: { '--cols': cols.length } }, h('div', { class: 'fam-gutter small' }, 'All day'));
    const head = h('div', { class: 'fam-grid-head', style: { '--cols': cols.length } }, h('div', { class: 'fam-gutter' }));
    const grid = h('div', { class: 'fam-grid', style: { '--cols': cols.length, '--hour': `${HOUR}px` } });
    const gutter = h('div', { class: 'fam-gutter fam-hours' });
    for (let hr = 0; hr < 24; hr++) gutter.append(h('div', { class: 'fam-hour-label' }, hr === 0 ? '' : fmtTime(new Date(2000, 0, 1, hr))));
    grid.append(gutter);
    const now = new Date();
    cols.forEach((c) => {
      head.append(h('button', { class: 'fam-col-head', onclick: c.onHead || null }, c.head));
      const dayStart = startOfDay(c.day);
      const all = c.occ.filter((o) => o.allDay || o.end - o.start >= 864e5);
      allDay.append(h('div', { class: 'fam-allday-col', onclick: (e) => { if (e.target === e.currentTarget) this.edit(null, { date: c.day, allDay: true, member: c.member?.id }); } }, all.map((o) => this.pill(o, c.day))));
      const col = h('div', { class: 'fam-col', dataset: { day: ymd(c.day) } });
      col.addEventListener('click', (e) => {
        if (e.target !== col) return;
        const mins = Math.floor((e.offsetY / HOUR) * 2) * 30;
        const at = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, mins);
        this.edit(null, { start: at, member: c.member?.id });
      });
      const timed = c.occ.filter((o) => !o.allDay && o.end - o.start < 864e5);
      for (const p of layoutColumns(timed)) col.append(this.block(p, dayStart, c));
      if (sameDay(c.day, now)) col.append(h('div', { class: 'fam-now', style: { top: `${((now - dayStart) / 36e5) * HOUR}px` } }));
      grid.append(col);
    });
    const scroll = h('div', { class: 'fam-grid-scroll' }, grid);
    clear(this.body, extras, head, allDay.childElementCount > 1 && [...allDay.children].some((x) => x.childElementCount) ? allDay : null, scroll);
    if (!this.scrolled) {
      requestAnimationFrame(() => {
        const first = Math.min(...cols.flatMap((c) => c.occ.filter((o) => !o.allDay).map((o) => o.start.getHours())), 24);
        const target = cols.some((c) => sameDay(c.day, now)) ? Math.max(0, now.getHours() - 1.5) : Math.min(first, 7.5);
        scroll.scrollTop = target * HOUR;
        this.scrolled = true;
      });
    }
  }

  block({ o, col, cols }, dayStart, c) {
    const top = Math.max(0, (o.start - dayStart) / 36e5);
    const bottom = Math.min(24, (o.end - dayStart) / 36e5);
    const short = bottom - top < 0.75;
    const el = h('div', {
      class: `fam-block ${short ? 'short' : ''} ${o.end < new Date() ? 'done' : ''}`, tabindex: '0',
      style: { '--c': this.colorOf(o.ev), top: `${top * HOUR}px`, height: `${Math.max(0.4, bottom - top) * HOUR - 2}px`, left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 3px)` },
    },
    h('div', { class: 'fam-block-title' }, o.ev.title),
    h('div', { class: 'fam-block-time' }, `${fmtTime(o.start)} – ${fmtTime(o.end)}`),
    !short && o.ev.location ? h('div', { class: 'fam-block-loc' }, o.ev.location) : null,
    !c.member && (o.ev.members || []).length > 1 ? h('div', { class: 'fam-block-who' }, o.ev.members.map((id) => this.store.member(id)).filter(Boolean).map((m) => avatar(m, 'xs'))) : null);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.showEvent(o); });
    this.dragBlock(el, o, dayStart);
    return el;
  }

  // Drag an event to another time (or day, in the week view); drag its bottom edge to change
  // how long it is. Repeating and subscribed events open instead.
  dragBlock(el, o, dayStart) {
    const movable = !o.ev.readonly && !o.ev.rrule;
    if (movable) el.append(h('div', { class: 'fam-block-resize' }));
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const resize = e.target.classList.contains('fam-block-resize');
      const sx = e.clientX;
      const sy = e.clientY;
      const top0 = parseFloat(el.style.top);
      const h0 = parseFloat(el.style.height);
      const cols = [...el.closest('.fam-grid').querySelectorAll('.fam-col')];
      const col0 = el.parentNode;
      let moved = false;
      let dMin = 0;
      let target = col0;
      const timer = e.pointerType === 'touch' ? setTimeout(() => { moved = moved || 'ready'; el.classList.add('lifted'); }, 350) : null;
      const move = (ev) => {
        const dy = ev.clientY - sy;
        const dx = ev.clientX - sx;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        if (e.pointerType === 'touch' && moved !== 'ready' && moved !== true) { clearTimeout(timer); cleanup(); return; }
        if (!movable) return;
        moved = true;
        ev.preventDefault();
        el.classList.add('dragging');
        dMin = Math.round((dy / HOUR) * 4) * 15;
        if (resize) el.style.height = `${Math.max(HOUR / 4, h0 + (dMin / 60) * HOUR)}px`;
        else {
          el.style.top = `${top0 + (dMin / 60) * HOUR}px`;
          const over = cols.find((c) => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; });
          if (over && over !== target && this.view === 'week') { target = over; over.append(el); }
        }
      };
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
      const cancel = () => { cleanup(); this.draw(); };
      const up = async () => {
        cleanup();
        el.classList.remove('lifted');
        if (moved !== true) { this.showEvent(o); return; }
        const dayShift = dayDiff(dayStart, parseYmd(target.dataset.day));
        if (!dMin && !dayShift) { this.draw(); return; }
        const st = new Date(o.start); const en = new Date(o.end);
        if (resize) en.setMinutes(en.getMinutes() + dMin);
        else { st.setDate(st.getDate() + dayShift); st.setMinutes(st.getMinutes() + dMin); en.setDate(en.getDate() + dayShift); en.setMinutes(en.getMinutes() + dMin); }
        if (en <= st) en.setTime(st.getTime() + 15 * 60e3);
        try { await this.store.put('events', { ...this.store.get('events', o.ev.id), start: st.toISOString(), end: en.toISOString() }); } catch (err) { toastError(err, 'Couldn’t move the event'); }
        this.draw();
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
  }

  // --- Schedule ------------------------------------------------------------------------

  drawSchedule() {
    const start = startOfDay(this.date);
    const days = 28;
    const end = addDays(start, days);
    this.titleEl.textContent = `${fmtDate(start, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const occ = this.occurrences(start, end);
    const list = h('div', { class: 'fam-agenda' });
    const today = startOfDay(new Date());
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      const items = occ.filter((o) => o.start < addDays(day, 1) && o.end > day);
      if (!items.length && !sameDay(day, today)) continue;
      const w = this.weatherFor(day);
      const rel = dayDiff(today, day);
      list.append(h('div', { class: `fam-agenda-day ${rel === 0 ? 'today' : ''}` },
        h('div', { class: 'fam-agenda-date' },
          h('span', { class: 'fam-agenda-num' }, day.getDate()),
          h('span', {}, h('b', {}, rel === 0 ? 'Today' : rel === 1 ? 'Tomorrow' : DAY_NAMES[day.getDay()]), h('br'), fmtDate(day, { month: 'long', year: day.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })),
          w ? h('span', { class: 'fam-agenda-wx' }, `${weatherIcon(w.code)[0]} ${Math.round(w.hi)}° / ${Math.round(w.lo)}°`) : null),
        h('div', { class: 'fam-agenda-items' }, items.length ? items.map((o) => h('button', { class: 'fam-agenda-row', style: { '--c': this.colorOf(o.ev) }, onclick: () => this.showEvent(o) },
          h('span', { class: 'fam-agenda-time' }, o.allDay || !sameDay(o.start, day) ? 'All day' : `${fmtTime(o.start)}`),
          h('span', { class: 'fam-agenda-bar' }),
          h('span', { class: 'fam-agenda-title' }, o.ev.title, o.ev.location ? h('small', {}, o.ev.location) : null),
          h('span', { class: 'fam-agenda-who' }, (o.ev.members || []).map((id) => this.store.member(id)).filter(Boolean).map((m) => avatar(m, 'xs'))))) : h('div', { class: 'fam-muted small fam-agenda-empty' }, 'Nothing planned'))));
    }
    list.append(h('button', { class: 'fam-btn fam-agenda-more', onclick: () => this.step(1) }, 'Later'));
    clear(this.body, list);
  }

  // Show or hide calendars on this device: the main family calendar, the family's own, and connected ones.
  async chooseCalendars() {
    const hidden = new Set(this.app.prefs.hiddenCalendars || []);
    const all = [{ id: 'family', name: 'Family', color: this.store.settings.familyColor || FAMILY_COLOR, note: 'Events not on another calendar' },
      ...this.store.customCalendars().map((c) => ({ id: c.id, name: c.name, color: c.color, note: c.enabled === false ? 'Turned off in Settings' : '' })),
      ...this.store.all('calendars').filter((c) => !c.custom).map((c) => ({ id: c.id, name: c.name, color: c.color, note: 'Connected' }))];
    const body = h('div', { class: 'fam-cal-choose' }, all.map((c) => {
      const box = h('input', { type: 'checkbox', checked: !hidden.has(c.id), onchange: () => { if (box.checked) hidden.delete(c.id); else hidden.add(c.id); } });
      return h('label', { class: 'fam-cal-choice', style: { '--c': c.color } }, box, h('i', { class: 'fam-cal-dot' }), h('span', {}, h('b', {}, c.name), c.note ? h('small', {}, c.note) : null));
    }));
    const ok = await sheet(this.app.root, { title: 'Calendars to show', body: h('div', {}, h('p', { class: 'fam-muted small' }, 'On this device only.'), body), actions: [{ label: 'Cancel' }, { label: 'Show', primary: true, value: true }] });
    if (!ok) return;
    this.app.prefs.hiddenCalendars = [...hidden];
    this.app.savePrefs();
    this.render(this.el);
  }

  // --- Event details and editing -------------------------------------------------------

  showEvent(o) {
    const ev = o.ev;
    const cal = ev.calendar ? this.store.get('calendars', ev.calendar) : null;
    const who = (ev.members || []).map((id) => this.store.member(id)).filter(Boolean);
    const when = o.allDay
      ? (dayDiff(o.start, o.end) > 1 ? `${fmtDate(o.start)} – ${fmtDate(addDays(o.end, -1))}` : `${fmtDate(o.start)} · All day`)
      : sameDay(o.start, new Date(o.end - 1)) ? `${fmtDate(o.start)} · ${fmtTime(o.start)} – ${fmtTime(o.end)}` : `${fmtDate(o.start)} ${fmtTime(o.start)} – ${fmtDate(o.end)} ${fmtTime(o.end)}`;
    const row = (ic, ...content) => h('div', { class: 'fam-detail-row' }, h('span', { class: 'fam-detail-icon', html: ic }), h('div', {}, ...content));
    const linkify = (text) => String(text).split(/(https?:\/\/[^\s<]+)/g).map((part, i) => (i % 2 ? h('a', { href: part, target: '_blank', rel: 'noopener' }, part) : part));
    const body = h('div', { class: 'fam-detail', style: { '--c': this.colorOf(ev) } },
      h('div', { class: 'fam-detail-title' }, h('i'), ev.title),
      row(ICONS.clock, when),
      ev.rrule ? row(ICONS.repeat, describeRule(ev.rrule, eventSpan(ev).start)) : null,
      ev.location ? row(ICONS.location, h('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`, target: '_blank', rel: 'noopener' }, ev.location)) : null,
      who.length ? row(ICONS.family, h('div', { class: 'fam-detail-who' }, who.map((m) => h('span', {}, avatar(m, 'xs'), m.name)))) : null,
      ev.reminder != null && ev.reminder !== '' ? row(ICONS.bell, reminderText(ev.reminder)) : null,
      ev.notes ? row(ICONS.notes, h('div', { class: 'fam-detail-notes' }, linkify(ev.notes))) : null,
      cal?.custom ? row(ICONS.calendar, h('span', { class: 'fam-cal-name' }, h('i', { style: { background: cal.color } }), cal.name)) : null,
      cal && !cal.custom ? row(ICONS.calendar, `From ${cal.name}`, h('div', { class: 'fam-hint' }, 'Change it in that calendar; it updates here within a few minutes.')) : null);
    sheet(this.app.root, {
      title: 'Event', body,
      actions: ev.readonly ? [{ label: 'Close', primary: true }] : [
        { label: 'Delete', danger: true, left: true, onClick: (close) => { close(); this.remove(o); } },
        { label: 'Duplicate', onClick: (close) => { close(); const copy = { ...ev }; delete copy.id; this.edit(null, { draft: { ...copy, title: `${ev.title}`, rrule: null, exdates: [], ...occurrenceTimes(o) } }); } },
        { label: 'Edit', primary: true, onClick: (close) => { close(); this.edit(o); } },
      ],
    });
  }

  async scope(o, verb) {
    if (!o.ev.rrule) return 'all';
    return sheet(this.app.root, {
      title: `${verb} repeating event`,
      body: h('p', { class: 'fam-muted' }, `“${o.ev.title}” repeats. Which events do you want to ${verb.toLowerCase()}?`),
      actions: [{ label: 'This event', value: 'this' }, { label: 'This and following', value: 'following' }, { label: 'All events', value: 'all', primary: true }],
    });
  }

  async remove(o) {
    const ev = this.store.get('events', o.ev.id);
    if (!ev) return;
    const which = o.ev.rrule ? await this.scope(o, 'Delete') : await sheet(this.app.root, {
      title: 'Delete event', body: h('p', {}, `Delete “${ev.title}”?`), actions: [{ label: 'Cancel' }, { label: 'Delete', danger: true, value: 'all' }],
    });
    if (!which) return;
    try {
      if (which === 'all') await this.store.del('events', ev.id);
      else if (which === 'this') await this.store.put('events', { ...ev, exdates: [...(ev.exdates || []), occKey(o)] });
      else await this.store.put('events', endSeriesBefore(ev, o));
      toast('Event deleted', { type: 'success', timeout: 2500 });
    } catch (err) { toastError(err, 'Couldn’t delete the event'); }
  }

  // The event editor. `o` is the occurrence being edited (null for a new event); `opts` gives
  // a starting day, time, person or a whole draft for new events.
  async edit(o, opts = {}) {
    const master = o ? this.store.get('events', o.ev.id) : null;
    const members = this.store.members();
    let d;
    if (master) d = { ...master, ...occurrenceTimes(o) };
    else if (opts.draft) d = { members: [], ...opts.draft };
    else {
      const st = opts.start || (() => { const n = new Date(); const base = opts.date ? new Date(opts.date) : n; base.setHours(sameDay(base, n) ? n.getHours() + 1 : 9, 0, 0, 0); return base; })();
      d = opts.allDay ? { allDay: true, start: ymd(opts.date || st), end: ymd(opts.date || st) } : { allDay: false, start: st.toISOString(), end: new Date(st.getTime() + 3600e3).toISOString() };
      d.members = opts.member ? [opts.member] : (this.app.filter.size === 1 && !this.app.filter.has('family') ? [...this.app.filter] : []);
    }
    const span = eventSpan(d);
    const title = input({ value: d.title || '', placeholder: 'What’s happening?', required: true, autofocus: true, maxlength: 200 });
    const allDay = h('input', { type: 'checkbox', checked: Boolean(d.allDay) });
    const sDate = input({ type: 'date', value: ymd(span.start), required: true });
    const sTime = input({ type: 'time', value: `${pad(span.start.getHours())}:${pad(span.start.getMinutes())}`, step: 300 });
    const lastDay = d.allDay ? addDays(span.end, -1) : span.end;
    const eDate = input({ type: 'date', value: ymd(lastDay), required: true });
    const eTime = input({ type: 'time', value: `${pad(span.end.getHours())}:${pad(span.end.getMinutes())}`, step: 300 });
    const times = [sTime, eTime];
    const syncAllDay = () => times.forEach((t) => { t.hidden = allDay.checked; });
    allDay.addEventListener('change', syncAllDay);
    syncAllDay();
    // Keep the length the same when the start moves.
    let lenMs = span.end - span.start;
    const readStart = () => new Date(`${sDate.value}T${allDay.checked ? '00:00' : sTime.value || '00:00'}`);
    const readEnd = () => (allDay.checked ? addDays(new Date(`${eDate.value}T00:00`), 1) : new Date(`${eDate.value}T${eTime.value || '00:00'}`));
    const shiftEnd = () => {
      const st = readStart();
      if (Number.isNaN(st.getTime())) return;
      const en = new Date(st.getTime() + (allDay.checked ? Math.max(864e5, lenMs) : lenMs));
      const shown = allDay.checked ? addDays(en, -1) : en;
      eDate.value = ymd(shown);
      eTime.value = `${pad(en.getHours())}:${pad(en.getMinutes())}`;
    };
    sDate.addEventListener('change', shiftEnd);
    sTime.addEventListener('change', shiftEnd);
    [eDate, eTime].forEach((x) => x.addEventListener('change', () => { lenMs = Math.max(0, readEnd() - readStart()); }));

    const rep = repeatEditor(d.rrule, () => readStart());
    const who = memberPicker(members, d.members || []);
    const location = input({ value: d.location || '', placeholder: 'Add a place', maxlength: 300 });
    const notes = h('textarea', { class: 'fam-input', rows: 3, placeholder: 'Notes', maxlength: 4000 }, d.notes || '');
    // Which calendar: the main family calendar, or one of the family's own.
    const ownCals = this.store.customCalendars();
    const calSel = ownCals.length ? select([['', 'Family'], ...ownCals.map((c) => [c.id, c.name])], (opts.calendar || d.calendar || '') && ownCals.some((c) => c.id === (opts.calendar || d.calendar)) ? (opts.calendar || d.calendar) : '') : null;
    const reminder = select([['', 'No reminder'], ['0', 'At the start'], ['5', '5 minutes before'], ['10', '10 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['120', '2 hours before'], ['1440', '1 day before']], d.reminder == null ? '' : String(d.reminder));
    const countdown = toggle('Show a countdown', d.countdown);
    const isPrivate = toggle('Keep off the phone calendar address', d.private);

    const body = h('div', { class: 'fam-form' },
      title,
      h('div', { class: 'fam-when' },
        h('label', { class: 'fam-toggle' }, allDay, h('span', { class: 'fam-switch' }), h('span', {}, 'All day')),
        h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'Starts'), sDate, sTime),
        h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'Ends'), eDate, eTime)),
      field('Repeat', rep.el),
      members.length ? field('Who', who) : null,
      calSel ? field('Calendar', calSel) : null,
      field('Where', location),
      field('Reminder', reminder),
      notes,
      h('div', { class: 'fam-row-wrap' }, countdown, isPrivate));

    const saved = await sheet(this.app.root, {
      title: master ? 'Edit event' : 'New event', body, wide: true,
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
        if (!title.value.trim()) { title.focus(); return; }
        const st = readStart();
        let en = readEnd();
        if (Number.isNaN(st.getTime()) || Number.isNaN(en.getTime())) return;
        if (en <= st) en = allDay.checked ? addDays(st, 1) : new Date(st.getTime() + 30 * 60e3);
        const next = {
          title: title.value.trim(), allDay: allDay.checked,
          start: allDay.checked ? ymd(st) : st.toISOString(), end: allDay.checked ? ymd(addDays(en, -1)) : en.toISOString(),
          rrule: rep.value(), members: who.value(), location: location.value.trim(), notes: notes.value.trim(), calendar: calSel ? calSel.value || null : d.calendar || null,
          reminder: reminder.value === '' ? null : Number(reminder.value),
          countdown: countdown.querySelector('input').checked, private: isPrivate.querySelector('input').checked,
        };
        close(next);
      } }],
    });
    if (!saved) return;
    try {
      if (!master) { await this.store.put('events', { ...saved, exdates: [] }); toast('Event added', { type: 'success', timeout: 2000 }); return; }
      const which = master.rrule ? await this.scope(o, 'Change') : 'all';
      if (!which) return;
      if (which === 'all') {
        // Move the whole series by however much this one moved.
        const delta = (saved.allDay ? parseYmd(saved.start) : new Date(saved.start)) - o.start;
        const ms = eventSpan(master);
        const len = (saved.allDay ? addDays(parseYmd(saved.end), 1) : new Date(saved.end)) - (saved.allDay ? parseYmd(saved.start) : new Date(saved.start));
        const ns = new Date(ms.start.getTime() + delta);
        const ne = new Date(ns.getTime() + len);
        const keepEx = saved.allDay === master.allDay && !delta;
        await this.store.put('events', {
          ...master, ...saved, exdates: keepEx ? master.exdates || [] : [],
          start: saved.allDay ? ymd(ns) : ns.toISOString(), end: saved.allDay ? ymd(addDays(ne, -1)) : ne.toISOString(),
          rrule: saved.rrule ? { ...saved.rrule, byday: saved.rrule.byday } : null,
        });
      } else if (which === 'this') {
        await this.store.batch([
          { op: 'put', col: 'events', item: { ...master, exdates: [...(master.exdates || []), occKey(o)] } },
          { op: 'put', col: 'events', item: { ...saved, rrule: null, exdates: [] } },
        ]);
      } else {
        await this.store.batch([
          { op: 'put', col: 'events', item: endSeriesBefore(master, o) },
          { op: 'put', col: 'events', item: { ...saved, exdates: [] } },
        ]);
      }
      toast('Event saved', { type: 'success', timeout: 2000 });
    } catch (err) { toastError(err, 'Couldn’t save the event'); }
  }

  // Quick add: type an event the way you'd say it, or paste several (one per line), or drop an
  // .ics file. Everything found is shown to check before it's added.
  async quickAdd(prefill = '') {
    const text = h('textarea', { class: 'fam-input fam-quick-text', rows: 4, autofocus: true, placeholder: 'Soccer practice every Tuesday 4:30–6pm\nDentist tomorrow at 3pm for Leo\nGrandma’s birthday May 3 every year\nCamping trip Jun 12 – Jun 15' }, prefill);
    const preview = h('div', { class: 'fam-quick-preview' });
    const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true });
    const members = this.store.members();
    let drafts = [];
    const findMembers = (line) => members.filter((m) => new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?\\b`, 'i').test(line)).map((m) => m.id);
    const stripNames = (title) => members.reduce((t, m) => t.replace(new RegExp(`\\s*\\b(?:for|with)\\s+${m.name}\\b|\\s*\\b${m.name}\\b\\s*(?:&|and)?`, 'gi'), ' '), title).replace(/\s+[-–—,&]\s*$/, '').replace(/\s+/g, ' ').trim();
    const drawPreview = () => clear(preview, drafts.length ? drafts.map((d, i) => {
      const span = eventSpan(d);
      return h('div', { class: 'fam-quick-row', style: { '--c': this.colorOf(d) } },
        h('span', { class: 'fam-agenda-bar' }),
        h('div', { class: 'fam-quick-main' },
          h('b', {}, d.title),
          h('small', {}, d.allDay ? (d.start === d.end ? fmtDate(span.start) : `${fmtDate(span.start, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(span.end, -1), { month: 'short', day: 'numeric' })}`) : `${fmtDate(span.start)} · ${fmtRange({ allDay: false, start: span.start, end: span.end })}`,
            d.rrule ? ` · ${describeRule(d.rrule, span.start)}` : '')),
        h('span', { class: 'fam-agenda-who' }, (d.members || []).map((id) => avatar(this.store.member(id), 'xs'))),
        h('button', { type: 'button', class: 'fam-icon-btn', title: 'Change', html: ICONS.edit, onclick: async () => { s.close(); await this.edit(null, { draft: d }); } }),
        h('button', { type: 'button', class: 'fam-icon-btn', title: 'Leave out', html: ICONS.close, onclick: () => { drafts.splice(i, 1); drawPreview(); } }));
    }) : h('div', { class: 'fam-muted small' }, 'Type above — what you write is turned into events you can check before adding.'));
    const parseText = () => {
      fromFile = null;
      drafts = text.value.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        const d = parseQuickAdd(line);
        d.members = findMembers(line);
        d.title = stripNames(d.title) || d.title;
        return d;
      });
      drawPreview();
    };
    text.addEventListener('input', parseText);
    let fromFile = null; // { name, evs }: an .ics file, imported as one (removable) import
    const loadIcs = async (file) => {
      try {
        const evs = await this.store.parseIcs(await file.text());
        fromFile = { name: file.name || 'Calendar file', ids: new Set() };
        drafts = evs.map((e) => { const d = { title: e.title, allDay: e.allDay, start: e.start, end: e.end, rrule: e.rrule || null, exdates: e.exdates || [], location: e.location, notes: e.notes, members: [], _icsId: e.id }; return d; });
        text.value = '';
        drawPreview();
        if (!drafts.length) toast('No events in that file', { type: 'warning' });
      } catch (err) { toastError(err, 'Couldn’t read that file'); }
    };
    fileIn.addEventListener('change', () => { if (fileIn.files[0]) loadIcs(fileIn.files[0]); });
    const body = h('div', { class: 'fam-form fam-quick' }, text,
      h('div', { class: 'fam-row-wrap fam-muted small' }, 'Names of family members are picked up too. ', h('button', { type: 'button', class: 'fam-link', onclick: () => fileIn.click() }, 'Import an .ics file'), fileIn),
      preview);
    body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drop'); });
    body.addEventListener('dragleave', () => body.classList.remove('drop'));
    body.addEventListener('drop', (e) => { e.preventDefault(); body.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) loadIcs(f); else if (e.dataTransfer.getData('text')) { text.value = e.dataTransfer.getData('text'); parseText(); } });
    const s = sheet(this.app.root, {
      title: 'Quick add', body, wide: true,
      actions: [{ label: 'Cancel' }, { label: 'Add events', primary: true, onClick: async (close) => {
        if (!drafts.length) { text.focus(); return; }
        try {
          if (fromFile && drafts.every((d) => d._icsId)) await this.store.importEvents(drafts.map((d) => ({ ...d, id: d._icsId })), fromFile.name);
          else await this.store.batch(drafts.map(({ _icsId, ...d }) => ({ op: 'put', col: 'events', item: { exdates: [], ...d } })));
          toast(drafts.length === 1 ? 'Event added' : `${drafts.length} events added`, { type: 'success', timeout: 2500 });
          close();
        } catch (err) { toastError(err, 'Couldn’t add the events'); }
      } }],
    });
    if (prefill) parseText(); else drawPreview();
    return s;
  }
}

// Overlapping events side by side.
function layoutColumns(occs) {
  const sorted = [...occs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let group = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = [];
    for (const o of group) {
      let c = cols.findIndex((end) => end <= o.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = o.end;
      out.push({ o, col: c, cols: 0 });
    }
    for (const p of out.slice(out.length - group.length)) p.cols = cols.length;
    group = [];
  };
  for (const o of sorted) {
    if (group.length && o.start >= groupEnd) flush();
    group.push(o);
    groupEnd = Math.max(groupEnd, o.end);
  }
  if (group.length) flush();
  return out;
}

const occKey = (o) => (o.ev.allDay ? ymd(o.start) : o.start.toISOString());

function occurrenceTimes(o) {
  return o.allDay ? { start: ymd(o.start), end: ymd(addDays(o.end, -1)) } : { start: o.start.toISOString(), end: o.end.toISOString() };
}

// A repeating event, stopped just before one of its occurrences.
function endSeriesBefore(ev, o) {
  const until = ev.allDay ? ymd(addDays(o.start, -1)) : new Date(o.start.getTime() - 1000).toISOString();
  const rrule = { ...ev.rrule, until, count: null };
  return { ...ev, rrule };
}

function reminderText(min) {
  const m = Number(min);
  if (!m) return 'At the start';
  if (m % 1440 === 0) return `${m / 1440} day${m > 1440 ? 's' : ''} before`;
  if (m % 60 === 0) return `${m / 60} hour${m > 60 ? 's' : ''} before`;
  return `${m} minutes before`;
}

// The repeat chooser: never, daily, weekly on chosen days, monthly (by date or "second
// Tuesday"), yearly, every N of those, ending never / on a date / after N times.
function repeatEditor(rule, getStart) {
  const r = rule ? { interval: 1, ...rule } : null;
  const kind = select([['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['weekdays', 'Every weekday'], ['monthly', 'Monthly'], ['yearly', 'Yearly']],
    !r ? 'none' : r.freq === 'weekly' && r.interval === 1 && (r.byday || []).join() === 'MO,TU,WE,TH,FR' ? 'weekdays' : r.freq);
  const every = input({ type: 'number', min: 1, max: 99, value: r?.interval || 1, class: 'fam-input tiny' });
  const unit = h('span', { class: 'fam-muted' });
  const days = new Set(r?.byday?.map((c) => c.slice(-2)) || []);
  const dayRow = h('div', { class: 'fam-weekdays' });
  const monthMode = select([['date', ''], ['weekday', '']], r?.byday?.length && r.freq === 'monthly' ? 'weekday' : 'date');
  const endMode = select([['never', 'Forever'], ['until', 'Until'], ['count', 'Number of times']], r?.until ? 'until' : r?.count ? 'count' : 'never');
  const until = input({ type: 'date', value: r?.until ? ymd(new Date(/T/.test(r.until) ? r.until : `${r.until}T12:00`)) : ymd(addMonths(getStart(), 3)) });
  const count = input({ type: 'number', min: 1, max: 999, value: r?.count || 10, class: 'fam-input tiny' });
  const detail = h('div', { class: 'fam-repeat-detail' });
  const ordinal = (d) => { const n = Math.ceil(d.getDate() / 7); const last = d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return { n: last && n >= 4 ? -1 : n, word: last && n >= 4 ? 'last' : ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] }; };
  const draw = () => {
    const k = kind.value;
    const st = getStart();
    if (Number.isNaN(st.getTime())) return;
    if (k === 'weekly' && !days.size) days.add(WEEKDAYS[st.getDay()]);
    clear(dayRow, WEEKDAYS.map((c, i) => h('button', { type: 'button', class: days.has(c) ? 'on' : '', onclick: () => { if (days.has(c) && days.size > 1) days.delete(c); else days.add(c); draw(); } }, DAY_SHORT[i].slice(0, 2))));
    const o = ordinal(st);
    monthMode.options[0].textContent = `On day ${st.getDate()}`;
    monthMode.options[1].textContent = `On the ${o.word} ${DAY_NAMES[st.getDay()]}`;
    unit.textContent = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[k] || '';
    until.hidden = endMode.value !== 'until';
    count.hidden = endMode.value !== 'count';
    clear(detail, k === 'none' || k === 'weekdays' ? null : h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'Every'), every, unit),
      k === 'weekly' ? dayRow : null,
      k === 'monthly' ? monthMode : null,
      k === 'none' ? null : h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'Ends'), endMode, until, count));
  };
  [kind, monthMode, endMode].forEach((x) => x.addEventListener('change', draw));
  draw();
  return {
    el: h('div', { class: 'fam-repeat' }, kind, detail),
    value() {
      const k = kind.value;
      if (k === 'none') return null;
      const st = getStart();
      const out = { freq: k === 'weekdays' ? 'weekly' : k, interval: k === 'weekdays' ? 1 : Math.max(1, Number(every.value) || 1) };
      if (k === 'weekdays') out.byday = ['MO', 'TU', 'WE', 'TH', 'FR'];
      if (k === 'weekly') out.byday = WEEKDAYS.filter((c) => days.has(c));
      if (k === 'monthly' && monthMode.value === 'weekday') { const o = ordinal(st); out.byday = [`${o.n}${WEEKDAYS[st.getDay()]}`]; }
      if (endMode.value === 'until' && until.value) out.until = `${until.value}T23:59:59`;
      if (endMode.value === 'count') out.count = Math.max(1, Number(count.value) || 1);
      return out;
    },
  };
}
