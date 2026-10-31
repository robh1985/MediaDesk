// The Family Organizer's desktop widget: what's left today (and tomorrow's first events), how
// everyone's doing with today's chores, and what's for dinner. It shows once the family has
// been set up in the organizer, and can be turned off in the organizer's settings.

import { h, clear } from './ui.js';
import { openApp } from './wm.js';
import { appPref } from './api.js';
import { expand, choreDue, ymd, addDays, startOfDay, fmtTime } from './apps/family/dates.js';

const MAX_ROWS = 5;
const get = (path) => fetch(`/portal/family/${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

export function familyWidget(widget, relayout) {
  const body = h('div', { class: 'w-fam' });
  const el = widget('Family', 'family', body, () => openApp('family', { tab: 'calendar' }));
  el.classList.add('widget-family');
  el.hidden = true;
  let data = null;
  let feeds = [];
  let rev = 0;
  let feedsAt = 0;
  // Compact: when the desktop's widget column is short, just the next two events and the
  // chores, so the other widgets keep their room.
  let compact = false;
  const maxRows = () => (compact ? 2 : MAX_ROWS);

  const color = (ev, members) => {
    const cal = ev.calendar ? data.collections.calendars?.[ev.calendar] : null;
    if (cal?.custom && cal.color && !(cal.members || []).length) return cal.color;
    const m = (ev.members || []).map((id) => members[id]).find(Boolean);
    return m?.color || (!(ev.members || []).length && ev.color) || data.settings?.familyColor || '#5c7cfa';
  };

  function draw(quiet = false) {
    const members = data.collections.members || {};
    const people = Object.values(members).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const cals0 = data.collections.calendars || {};
    // The family's events, less those on one of its own calendars that's turned off.
    const own = Object.values(data.collections.events || {}).filter((e) => !(e.calendar && cals0[e.calendar]?.custom && cals0[e.calendar].enabled === false))
      .map((e) => (cals0[e.calendar]?.custom && !(e.members || []).length ? { ...e, members: cals0[e.calendar].members || [] } : e));
    const cals = data.collections.calendars || {};
    const subscribed = feeds.flatMap((f) => (cals[f.id] && cals[f.id].enabled !== false && !cals[f.id].custom ? f.events.map((e) => ({ ...e, members: cals[f.id].members || [], color: cals[f.id].color })) : []));
    const off = appPref('family', 'widget') === false;
    el.hidden = off || (!people.length && !own.length);
    if (el.hidden) { if (!quiet) relayout(); return; }

    const now = new Date();
    const today = startOfDay(now);
    const occ = [...own, ...subscribed].flatMap((ev) => expand(ev, today, addDays(today, 2)))
      .filter((o) => o.end > now)
      .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
    const todays = occ.filter((o) => o.start < addDays(today, 1));
    const tomorrow = occ.filter((o) => o.start >= addDays(today, 1) && !(o.allDay && o.start < addDays(today, 1)));
    const shown = todays.slice(0, maxRows());
    const more = Math.max(0, maxRows() - shown.length);
    const row = (o) => h('button', { class: 'w-item w-fam-event', onclick: () => openApp('family', { tab: 'calendar' }) },
      h('span', { class: 'w-dot', style: { background: color(o.ev, members) } }),
      h('span', { class: 'small muted w-fam-time' }, o.allDay ? 'All day' : o.start < startOfDay(new Date()) ? 'Now' : fmtTime(o.start)),
      h('span', { class: 'grow' }, h('strong', {}, o.ev.title)),
      h('span', { class: 'w-fam-who' }, (o.ev.members || []).map((id) => members[id]).filter(Boolean).slice(0, 3).map((m) => h('i', { style: { '--c': m.color }, title: m.name }, m.emoji || m.name[0]))));

    // Chores and routines due today, done or not, per person.
    const key = ymd(now);
    const chores = Object.values(data.collections.chores || {}).filter((c) => !c.paused && choreDue(c, now));
    const log = data.collections.chorelog || {};
    const progress = people.map((m) => {
      const mine = chores.filter((c) => (c.members || []).includes(m.id));
      const done = mine.filter((c) => log[`${c.id}|${m.id}|${key}`]).length;
      return { m, done, total: mine.length };
    }).filter((p) => p.total);

    const dinner = Object.values(data.collections.meals || {}).find((x) => x.date === key && x.slot === 'dinner');
    const recipe = dinner?.recipe ? data.collections.recipes?.[dinner.recipe] : null;

    clear(body,
      h('div', { class: 'w-sub' }, 'Today'),
      shown.length ? shown.map(row) : h('div', { class: 'small muted w-empty' }, 'Nothing else today'),
      todays.length > shown.length ? h('button', { class: 'w-more small muted', onclick: () => openApp('family', { tab: 'calendar' }) }, `+${todays.length - shown.length} more today`) : null,
      more && tomorrow.length && !compact ? [h('div', { class: 'w-sub' }, 'Tomorrow'), tomorrow.slice(0, Math.min(more, 2)).map(row)] : null,
      progress.length ? h('button', { class: 'w-fam-chores', title: 'Today’s chores', onclick: () => openApp('family', { tab: 'chores' }) },
        progress.map(({ m, done, total }) => h('span', { class: `w-fam-ring ${done === total ? 'all' : ''}`, style: { '--c': m.color, '--p': done / total }, title: `${m.name}: ${done} of ${total} done` },
          h('span', {}, m.emoji || m.name[0])))) : null,
      dinner && !compact ? h('button', { class: 'w-fam-dinner small', onclick: () => openApp('family', { tab: 'meals' }) }, `${recipe?.emoji || '🍽️'} Dinner: `, h('strong', {}, dinner.title || recipe?.title || 'planned')) : null);
    if (!quiet) relayout();
  }

  async function load() {
    if (document.hidden) return;
    try {
      const d = await get(`data${rev ? `?since=${rev}` : ''}`);
      if (!d.same) { data = d; rev = d.rev; }
      if (Date.now() - feedsAt > 10 * 60e3 && Object.keys(data.collections.calendars || {}).length) {
        feedsAt = Date.now();
        feeds = (await get('feeds')).feeds || [];
      }
      draw();
    } catch { /* the organizer isn't reachable; try again later */ }
  }
  load();
  setInterval(load, 60e3);
  // Redraw on the minute, so finished events drop off.
  setInterval(() => { if (data) draw(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('mediadesk:family-changed', () => { rev = 0; load(); });
  // For the desktop's column layout; redraws (without asking for another layout) when it changes.
  el.setCompact = (v) => { if (v !== compact) { compact = v; if (data) draw(true); } };
  return el;
}
