// Family Organizer settings: profiles, connected calendars, the phone calendar address, weather,
// meals, the photo frame, sleep mode and the parent PIN.

import { h, clear, toast, toastError } from '../../ui.js';
import { sheet, field, input, select, toggle, avatar, memberPicker, emojiButton, colorPicker, COLORS, ICONS, parentGate, lockParent } from './shared.js';
import { SLOTS } from './meals.js';
import { portal, state, appPref } from '../../api.js';
import { familyAuth, DEFAULT_QUICK_PICKS, DEFAULT_EXTRA_CHORES } from './store.js';
import { describeChoreRepeat, PARTS, DAY_SHORT } from './dates.js';

const PROVIDERS = [
  ['Google Calendar', 'On a computer, open Google Calendar → Settings → pick the calendar → “Integrate calendar” → copy the “Secret address in iCal format”.'],
  ['Outlook / Microsoft 365', 'Outlook on the web → Settings → Calendar → Shared calendars → “Publish a calendar” → choose “Can view all details” → copy the ICS link.'],
  ['iCloud', 'In the Calendar app on a Mac or iCloud.com, share the calendar as a “Public Calendar” and copy the webcal:// link.'],
  ['Yahoo', 'Yahoo Calendar → the calendar’s menu → Share → copy the “link to import into other calendar apps” (.ics).'],
  ['Cozi, TeamSnap, school and sports sites', 'Look for “Export”, “Subscribe” or “iCal feed” and copy the address.'],
];

export class SettingsView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.section = 'accounts';
  }

  render(el, section) {
    // Older names for parts of a tab: Profiles, Users and Parent PIN are in Accounts; Quick picks
    // and Extra chores in Chores/Routines.
    const ALIASES = { profiles: 'accounts', users: 'accounts', parents: 'accounts', quickpicks: 'chores', extras: 'chores' };
    const same = !section || (ALIASES[section] || section) === this.section;
    const keep = same ? this.el?.querySelector('.fam-settings')?.scrollTop || 0 : 0;
    this.el = el;
    if (section) this.section = ALIASES[section] || section;
    const session = this.app.session || {};
    const sections = [['accounts', 'Accounts'], ['calendars', 'Calendars'], ['general', 'General'], ['display', 'Photo frame & sleep'], ['chores', 'Chores/Routines'],
      session.user ? ['account', 'My account'] : null].filter(Boolean);
    if (!sections.some(([id]) => id === this.section)) this.section = sections[0][0];
    const nav = h('div', { class: 'fam-seg fam-settings-nav' }, sections.map(([id, label]) => h('button', { class: this.section === id ? 'on' : '', onclick: () => { this.section = id; this.render(el); } }, label)));
    const body = h('div', { class: 'fam-settings' });
    clear(el, h('div', { class: 'fam-toolbar' }, h('div', { class: 'fam-toolbar-title' }, 'Settings'), h('div', { class: 'fam-spacer' }), nav), body);
    this[`draw_${this.section}`](body);
    // Redrawn after a change: stay where you were (the account list arrives a moment later).
    if (keep) { body.scrollTop = keep; setTimeout(() => { body.scrollTop = keep; }, 250); }
  }

  // Accounts: the family's profiles, sign-in accounts and invites (for parents), and the parent PIN.
  draw_accounts(body) {
    this.draw_profiles(body);
    if (this.app.session?.parent) this.draw_users(body);
    this.draw_parents(body);
  }

  // Chores/Routines: the quick picks for new chores, and the extra chores menu.
  draw_chores(body) {
    this.draw_quickpicks(body);
    this.draw_extras(body);
  }

  card(title, ...content) { return h('section', { class: 'fam-card' }, title ? h('h3', {}, title) : null, ...content); }

  async save(patch, msg = 'Saved') {
    try { await this.store.setSettings(patch); if (msg) toast(msg, { type: 'success', timeout: 1500 }); } catch (err) { toastError(err); }
  }

  // --- Profiles -----------------------------------------------------------------

  draw_profiles(body) {
    const members = this.store.members();
    body.append(this.card('Family members',
      h('p', { class: 'fam-muted' }, 'Everyone gets a colour, used for their events, chores and lists.'),
      h('div', { class: 'fam-profiles' }, members.map((m, i) => h('div', { class: 'fam-profile', style: { '--c': m.color } },
        avatar(m, 'lg'),
        h('div', { class: 'fam-profile-main' }, h('b', {}, m.name), h('small', {}, m.role === 'parent' ? 'Parent' : m.role === 'kid' ? 'Kid' : 'Family member')),
        h('div', { class: 'fam-profile-move' },
          h('button', { class: 'fam-icon-btn', title: 'Move up', disabled: i === 0, html: ICONS.left, onclick: () => this.move(members, i, -1) }),
          h('button', { class: 'fam-icon-btn', title: 'Move down', disabled: i === members.length - 1, html: ICONS.right, onclick: () => this.move(members, i, 1) })),
        h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.editMember(m) })))),
      h('button', { class: 'fam-btn primary', onclick: () => this.editMember(null) }, h('span', { html: ICONS.plus }), 'Add a person')));
  }

  async move(members, i, d) {
    const list = [...members];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    try { await this.store.batch(list.map((m, n) => ({ op: 'put', col: 'members', item: { ...m, order: n } }))); this.render(this.el); } catch (err) { toastError(err); }
  }

  async editMember(m) {
    if (!(await parentGate(this.app.root, this.store, 'Changing profiles needs a parent.'))) return;
    const used = new Set(this.store.members().map((x) => x.color));
    let color = m?.color || COLORS.find((c) => !used.has(c)) || COLORS[0];
    const name = input({ value: m?.name || '', placeholder: 'Name', required: true, autofocus: true, maxlength: 40 });
    const emoji = emojiButton(m?.emoji || '');
    const colors = colorPicker(color, (c) => { color = c; });
    const role = select([['parent', 'Parent'], ['kid', 'Kid'], ['other', 'Other']], m?.role || 'kid');
    const birthday = input({ type: 'date', value: m?.birthday || '' });
    const out = await sheet(this.app.root, {
      title: m ? `Edit ${m.name}` : 'Add a person',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, name), field('Colour', colors), h('div', { class: 'fam-row-wrap' }, field('Role', role), field('Birthday', birthday, 'Adds a yearly birthday to the calendar.'))),
      actions: [m ? { label: 'Remove', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!name.value.trim()) return name.focus(); close({ ...(m || { order: this.store.members().length }), name: name.value.trim(), emoji: emoji.value, color, role: role.value, birthday: birthday.value || null }); } }],
    });
    if (!out) return;
    try {
      if (out === 'delete') {
        const sure = await sheet(this.app.root, { title: `Remove ${m.name}?`, body: h('p', {}, 'Their events and chores stay, without them. Their stars are lost.'), actions: [{ label: 'Cancel' }, { label: 'Remove', danger: true, value: true }] });
        if (!sure) return;
        const bday = this.store.get('events', `bday-${m.id}`);
        await this.store.batch([{ op: 'delete', col: 'members', id: m.id }, ...(bday ? [{ op: 'delete', col: 'events', id: bday.id }] : [])]);
      } else {
        const [saved] = await this.store.batch([{ op: 'put', col: 'members', item: out }]);
        await this.syncBirthday(saved);
      }
      this.render(this.el);
      this.app.drawFilter();
    } catch (err) { toastError(err); }
  }

  // A person's birthday is a yearly all-day event with a countdown.
  async syncBirthday(m) {
    const id = `bday-${m.id}`;
    const have = this.store.get('events', id);
    if (!m.birthday) { if (have) await this.store.del('events', id); return; }
    await this.store.put('events', { ...(have || {}), id, title: `${m.name}’s birthday 🎂`, allDay: true, start: m.birthday, end: m.birthday, rrule: { freq: 'yearly', interval: 1 }, members: [m.id], countdown: true, exdates: [] });
  }

  // --- Calendars ------------------------------------------------------------------

  draw_calendars(body) {
    const cals = this.store.all('calendars').filter((c) => !c.custom);
    const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) f.text().then((t) => this.importIcs(t, f.name)); } });
    const removeIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: () => { const f = removeIn.files[0]; removeIn.value = ''; if (f) f.text().then((t) => this.removeByFile(t, f.name)); } });
    const own = this.store.customCalendars();
    const counts = new Map();
    for (const e of this.store.all('events')) if (e.calendar) counts.set(e.calendar, (counts.get(e.calendar) || 0) + 1);
    body.append(
      this.card('Family calendars',
        h('p', { class: 'fam-muted' }, 'Calendars of your own, alongside the main family one — for sports, school, work, birthdays or anything else. Start one from an .ics file, or add events to it as you go. Like a connected calendar, it can be someone’s (its events show in their colour and column) or everyone’s (in its own colour), and each can be turned off.'),
        h('div', { class: 'fam-cal-list' }, own.length ? own.map((c) => h('div', { class: `fam-cal-row ${c.enabled === false ? 'fam-off' : ''}`, style: { '--c': c.color } },
          h('i', { class: 'fam-cal-dot' }),
          h('div', { class: 'fam-profile-main' }, h('b', {}, c.name), h('small', {}, [`${counts.get(c.id) || 0} event${counts.get(c.id) === 1 ? '' : 's'}`, c.enabled === false ? 'Turned off' : null].filter(Boolean).join(' · '))),
          h('span', { class: 'fam-agenda-who' }, (c.members || []).map((id) => avatar(this.store.member(id), 'xs'))),
          h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.editOwnCalendar(c) })))
          : h('div', { class: 'fam-muted small' }, 'Only the main family calendar so far.')),
        h('button', { class: 'fam-btn primary', onclick: () => this.editOwnCalendar(null) }, h('span', { html: ICONS.plus }), 'Create a calendar')),
      this.card('Connected calendars',
        h('p', { class: 'fam-muted' }, 'Show events from Google, Outlook, iCloud, Yahoo and other calendars. They are read every few minutes; change them in the calendar they come from.'),
        h('div', { class: 'fam-cal-list' }, cals.length ? cals.map((c) => {
          const f = this.store.feeds.get(c.id);
          return h('div', { class: 'fam-cal-row', style: { '--c': c.color } },
            h('i', { class: 'fam-cal-dot' }),
            h('div', { class: 'fam-profile-main' }, h('b', {}, c.name), h('small', { class: f?.error ? 'fam-error' : '' }, c.enabled === false ? 'Hidden' : f?.error ? f.error : f ? `${f.events.length} events · checked ${new Date(f.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Not read yet')),
            h('span', { class: 'fam-agenda-who' }, (c.members || []).map((id) => avatar(this.store.member(id), 'xs'))),
            h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.editCalendar(c) }));
        }) : h('div', { class: 'fam-muted small' }, 'No calendars connected yet.')),
        h('div', { class: 'fam-row-wrap' },
          h('button', { class: 'fam-btn primary', onclick: () => this.editCalendar(null) }, h('span', { html: ICONS.plus }), 'Connect a calendar'),
          cals.length ? h('button', { class: 'fam-btn', onclick: async () => { try { await this.store.loadFeeds(true); this.render(this.el); toast('Calendars refreshed', { type: 'success', timeout: 1500 }); } catch (err) { toastError(err); } } }, h('span', { html: ICONS.refresh }), 'Refresh now') : null)),
      this.card('On your phones',
        h('p', { class: 'fam-muted' }, 'Subscribe to this address in Google Calendar (“Other calendars → From URL”), Apple Calendar (“File → New Calendar Subscription”, or on iPhone “Settings → Calendar → Accounts → Add Subscribed Calendar”) or Outlook (“Add calendar → Subscribe from web”) to see the family’s events everywhere. Anyone with the address can see the events, so keep it to the family.'),
        h('div', { class: 'fam-copy-row' }, input({ value: this.store.feedUrl(), readonly: true, onfocus: (e) => e.target.select() }),
          h('button', { class: 'fam-btn', onclick: () => navigator.clipboard?.writeText(this.store.feedUrl()).then(() => toast('Address copied', { type: 'success', timeout: 1500 }), () => toast('Select the address and copy it')) }, h('span', { html: ICONS.copy }), 'Copy')),
        h('div', { class: 'fam-row-wrap' },
          h('a', { class: 'fam-btn', href: '/portal/family/family.ics', download: 'family.ics' }, 'Download .ics file'),
          h('button', { class: 'fam-btn', onclick: async () => {
            const ok = await sheet(this.app.root, { title: 'Make a new address?', body: h('p', {}, 'The old address stops working, so phones subscribed to it will need the new one.'), actions: [{ label: 'Cancel' }, { label: 'Make new address', danger: true, value: true }] });
            if (ok && await parentGate(this.app.root, this.store)) { await this.store.newFeedToken(); this.render(this.el); }
          } }, 'Make a new address'))),
      this.card('Import',
        h('p', { class: 'fam-muted' }, 'Copy events from an .ics file (exported from another calendar) into the family calendar. Each import is listed here, so its events can be taken out again.'),
        this.importsList(),
        h('div', { class: 'fam-row-wrap' },
          h('button', { class: 'fam-btn', onclick: () => fileIn.click() }, h('span', { html: ICONS.upload }), 'Import .ics file'), fileIn,
          h('button', { class: 'fam-btn', title: 'Choose an .ics file to take its events back out of the family calendar', onclick: () => removeIn.click() }, h('span', { html: ICONS.trash }), 'Remove events from a file…'), removeIn)));
  }

  // The family's own calendars: a name and colour; events are put on them in the event editor.
  async editOwnCalendar(c) {
    if (!(await parentGate(this.app.root, this.store, 'Changing calendars needs a parent.'))) return;
    const used = new Set(this.store.all('calendars').map((x) => x.color));
    let color = c?.color || COLORS.find((x) => !used.has(x)) || COLORS[3];
    const name = input({ value: c?.name || '', placeholder: 'e.g. Soccer, School, Work', required: true, autofocus: true, maxlength: 60 });
    const colors = colorPicker(color, (x) => { color = x; });
    const on = toggle('Show on the calendar', c ? c.enabled !== false : true);
    const who = memberPicker(this.store.members(), c?.members || []);
    const count = c ? this.store.all('events').filter((e) => e.calendar === c.id).length : 0;
    // Events from an .ics file, to start the calendar with (or add to it).
    let file = null; // { name, evs }
    const fileNote = h('span', { class: 'fam-hint' }, c ? 'Adds the file’s events to this calendar.' : 'Optional: start the calendar with the events from a file exported from another calendar.');
    const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const evs = await this.store.parseIcs(await f.text());
        if (!evs.length) { file = null; fileNote.textContent = `There are no events in “${f.name}”.`; return; }
        file = { name: f.name, evs };
        clear(fileBtn, h('span', { html: ICONS.upload }), f.name);
        fileNote.textContent = `${evs.length} event${evs.length === 1 ? '' : 's'} will be added to this calendar.`;
        if (!name.value.trim()) name.value = f.name.replace(/\.ics$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
      } catch (err) { file = null; fileNote.textContent = err.message; }
    } });
    const fileBtn = h('button', { type: 'button', class: 'fam-btn', onclick: () => fileIn.click() }, h('span', { html: ICONS.upload }), 'Choose .ics file');
    const out = await sheet(this.app.root, {
      title: c ? 'Calendar' : 'Create a calendar', wide: true,
      body: h('div', { class: 'fam-form' },
        field('Name', name),
        field('Whose calendar', who, 'Its events take this person’s colour and show in their column.'),
        field('Colour (when it’s nobody’s in particular)', colors),
        on,
        h('div', { class: 'fam-field' }, h('span', { class: 'fam-label' }, 'Import events from an .ics file'), h('div', { class: 'fam-row-wrap' }, fileBtn, fileIn), fileNote)),
      actions: [c ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: c ? 'Save' : 'Create', primary: true, submit: true, onClick: (close) => {
        if (!name.value.trim()) { name.focus(); return; }
        close({ ...(c || { order: this.store.customCalendars().length }), custom: true, name: name.value.trim(), color, members: who.value(), enabled: on.querySelector('input').checked });
      } }],
    });
    if (!out) return;
    try {
      if (out !== 'delete') {
        const saved = await this.store.put('calendars', out);
        if (file) {
          await this.store.importEvents(file.evs, file.name, saved.id);
          toast(`${file.evs.length} event${file.evs.length === 1 ? '' : 's'} imported to “${saved.name}”`, { type: 'success', timeout: 3000 });
        }
        this.render(this.el);
        return;
      }
      if (out === 'delete') {
        const what = count ? await sheet(this.app.root, {
          title: `Delete “${c.name}”?`, body: h('p', {}, `It has ${count} event${count === 1 ? '' : 's'}. Move them to the main family calendar, or delete them too?`),
          actions: [{ label: 'Cancel' }, { label: 'Delete events too', danger: true, value: 'events' }, { label: 'Move them', primary: true, value: 'move' }],
        }) : await sheet(this.app.root, { title: `Delete “${c.name}”?`, body: h('p', {}, 'It has no events.'), actions: [{ label: 'Cancel' }, { label: 'Delete', danger: true, value: 'move' }] });
        if (!what) return;
        const events = this.store.all('events').filter((e) => e.calendar === c.id);
        await this.store.batch([
          ...events.map((e) => (what === 'events' ? { op: 'delete', col: 'events', id: e.id } : { op: 'put', col: 'events', item: { ...e, calendar: null } })),
          { op: 'delete', col: 'calendars', id: c.id },
        ]);
      }
      this.render(this.el);
    } catch (err) { toastError(err, 'Couldn’t save the calendar'); }
  }

  async importIcs(text, fileName = 'Calendar file') {
    try {
      const evs = await this.store.parseIcs(text);
      if (!evs.length) { toast('No events in that file', { type: 'warning' }); return; }
      const own = this.store.customCalendars();
      const onto = own.length ? select([['', 'Family'], ...own.map((c) => [c.id, c.name])], '') : null;
      const ok = await sheet(this.app.root, { title: 'Import events', body: h('div', { class: 'fam-form' }, h('p', {}, `Add ${evs.length} event${evs.length === 1 ? '' : 's'} from “${fileName}” to the family calendar?`), onto ? field('Put them on', onto) : null), actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, value: true }] });
      if (!ok) return;
      await this.store.importEvents(evs, fileName, onto?.value || null);
      toast(`Imported ${evs.length} events`, { type: 'success', body: 'You can take them out again in Settings → Calendars → Import.' });
      this.render(this.el);
    } catch (err) { toastError(err, 'Couldn’t import that file'); }
  }

  // The imports so far, each with its events (newest first). Events imported before imports were
  // recorded are one group of their own.
  importsList() {
    const groups = new Map();
    for (const e of this.store.all('events')) {
      const key = e.importId || (String(e.id).startsWith('imp-') ? 'earlier' : null);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, name: key === 'earlier' ? 'Earlier import' : e.importName || 'Calendar file', at: e.importedAt || 0, events: [] });
      groups.get(key).events.push(e);
    }
    const list = [...groups.values()].sort((a, b) => b.at - a.at);
    if (!list.length) return h('div', { class: 'fam-muted small' }, 'Nothing imported yet.');
    return h('div', { class: 'fam-cal-list' }, list.map((g) => h('div', { class: 'fam-cal-row' },
      h('span', { class: 'fam-chore-emoji', html: ICONS.upload }),
      h('div', { class: 'fam-profile-main' }, h('b', {}, g.name),
        h('small', {}, [`${g.events.length} event${g.events.length === 1 ? '' : 's'}`, g.at ? `imported ${new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'file name not recorded'].join(' · '))),
      h('button', { class: 'fam-btn small danger', onclick: () => this.removeEvents(g.events, `the ${g.events.length} event${g.events.length === 1 ? '' : 's'} imported from “${g.name}”`) }, 'Remove events'))));
  }

  // Take out the events from an .ics file, matched by title and start: works for any import,
  // including ones from before imports were recorded, or from Quick add.
  async removeByFile(text, fileName) {
    try {
      const evs = await this.store.parseIcs(text);
      const key = (e) => `${String(e.title || '').trim().toLowerCase()}|${e.allDay ? String(e.start).slice(0, 10) : new Date(e.start).getTime()}`;
      const want = new Set(evs.map(key));
      const found = this.store.all('events').filter((e) => want.has(key(e)));
      if (!found.length) { toast(`None of the events in “${fileName}” are on the family calendar`, { timeout: 4000 }); return; }
      await this.removeEvents(found, `${found.length} event${found.length === 1 ? '' : 's'} on the family calendar that match${found.length === 1 ? 'es' : ''} “${fileName}”`);
    } catch (err) { toastError(err, 'Couldn’t read that file'); }
  }

  async removeEvents(events, what) {
    if (!(await parentGate(this.app.root, this.store, 'Removing events needs a parent.'))) return;
    const sample = events.slice(0, 5).map((e) => e.title).join(', ');
    const ok = await sheet(this.app.root, {
      title: 'Remove these events?',
      body: h('div', {}, h('p', {}, `Remove ${what}?`), h('p', { class: 'fam-muted small' }, `${sample}${events.length > 5 ? ', …' : ''}`), h('p', { class: 'fam-muted small' }, 'Any of them you changed since are removed too. This can’t be undone.')),
      actions: [{ label: 'Cancel' }, { label: `Remove ${events.length}`, danger: true, value: true }],
    });
    if (!ok) return;
    try {
      for (let i = 0; i < events.length; i += 200) await this.store.batch(events.slice(i, i + 200).map((e) => ({ op: 'delete', col: 'events', id: e.id })));
      toast(`Removed ${events.length} event${events.length === 1 ? '' : 's'}`, { type: 'success' });
      this.render(this.el);
    } catch (err) { toastError(err, 'Couldn’t remove them'); }
  }

  async editCalendar(c) {
    if (!(await parentGate(this.app.root, this.store, 'Changing calendars needs a parent.'))) return;
    let color = c?.color || COLORS[(this.store.all('calendars').length * 5 + 1) % COLORS.length];
    const url = input({ type: 'url', value: c?.url || '', placeholder: 'https://… or webcal://…', required: true, autofocus: !c, spellcheck: 'false' });
    const name = input({ value: c?.name || '', placeholder: 'e.g. School, Mom’s work', maxlength: 60 });
    url.addEventListener('change', () => { if (!name.value.trim() && url.value.trim()) name.value = guessName(url.value.trim()); });
    const colors = colorPicker(color, (x) => { color = x; });
    const who = memberPicker(this.store.members(), c?.members || []);
    const enabled = toggle('Show on the calendar', c ? c.enabled !== false : true);
    const err = h('div', { class: 'fam-error' });
    const help = h('details', { class: 'fam-help' }, h('summary', {}, 'Where do I find the address?'), h('dl', {}, PROVIDERS.map(([p, t]) => [h('dt', {}, p), h('dd', {}, t)])));
    const out = await sheet(this.app.root, {
      title: c ? 'Calendar' : 'Connect a calendar', wide: true,
      body: h('div', { class: 'fam-form' }, field('iCal address', url), help, field('Name', name), field('Whose calendar', who, 'Events take this person’s colour and show in their column.'), field('Colour (when it’s nobody’s in particular)', colors), enabled, err),
      actions: [c ? { label: 'Remove', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: c ? 'Save' : 'Connect', primary: true, submit: true, onClick: async (close) => {
        if (!url.value.trim()) return url.focus();
        if (!name.value.trim()) name.value = guessName(url.value);
        err.textContent = 'Checking the calendar…';
        try {
          if (!c || c.url !== url.value.trim()) await this.store.checkFeed(url.value.trim());
          close({ ...(c || {}), url: url.value.trim(), name: name.value.trim(), color, members: who.value(), enabled: enabled.querySelector('input').checked });
        } catch (e) { err.textContent = e.message; }
      } }],
    });
    if (!out) return;
    try {
      if (out === 'delete') await this.store.del('calendars', c.id);
      else await this.store.put('calendars', out);
      await this.store.loadFeeds();
      this.render(this.el);
    } catch (e) { toastError(e, 'Couldn’t save the calendar'); }
  }

  // --- General ----------------------------------------------------------------------

  draw_general(body) {
    const s = this.store.settings;
    const famName = input({ value: s.familyName || '', placeholder: 'e.g. Rivera', maxlength: 40 });
    famName.addEventListener('change', () => this.save({ familyName: famName.value.trim() || null }));
    let famColor = s.familyColor || '#5c7cfa';
    const place = input({ type: 'search', placeholder: 'Search for your town or city', value: s.location?.name || '' });
    const results = h('div', { class: 'fam-places' });
    let t = null;
    place.addEventListener('input', () => {
      clearTimeout(t);
      const q = place.value.trim();
      if (q.length < 2) { clear(results); return; }
      t = setTimeout(async () => {
        try {
          const list = await this.store.geocode(q);
          clear(results, list.length ? list.map((p) => h('button', { class: 'fam-place', onclick: async () => { await this.save({ location: { name: p.name, region: p.region, lat: p.lat, lon: p.lon } }, `Weather for ${p.name}`); clear(results); place.value = p.name; this.app.loadWeather(true); } }, h('b', {}, p.name), h('small', {}, p.region))) : h('div', { class: 'fam-muted small' }, 'No places found'));
        } catch (err) { clear(results, h('div', { class: 'fam-error' }, err.message)); }
      }, 350);
    });
    const units = select([['imperial', '°F, mph'], ['metric', '°C, km/h']], s.units || 'imperial', { onchange: (e) => { this.save({ units: e.target.value }); this.app.loadWeather(true); } });
    const week = select([['0', 'Sunday'], ['1', 'Monday'], ['6', 'Saturday']], String(s.weekStart || 0), { onchange: (e) => this.save({ weekStart: Number(e.target.value) }) });
    const startPage = select([['calendar', 'Calendar'], ['chores', 'Chores'], ['meals', 'Meals'], ['lists', 'Lists']], s.startPage || 'calendar', { onchange: (e) => this.save({ startPage: e.target.value }) });
    const slots = new Set(s.mealSlots || ['breakfast', 'lunch', 'dinner']);
    body.append(
      this.card('Family', field('Family name', famName), field('Colour for events that are for everyone', colorPicker(famColor, (c) => { famColor = c; this.save({ familyColor: c }, null); })),
        field('Open on', startPage), field('Weeks start on', week),
        toggle('Show events for everyone when viewing one person', s.showFamilyEvents !== false, (v) => this.save({ showFamilyEvents: v }))),
      this.card('Weather', field('Place', h('div', {}, place, results), s.location ? `Showing ${s.location.name}${s.location.region ? `, ${s.location.region}` : ''}. Forecasts from Open-Meteo.` : 'Shown at the top and on the calendar.'), field('Units', units),
        s.location ? h('button', { class: 'fam-btn', onclick: () => { this.save({ location: null }, 'Weather off'); this.app.loadWeather(true); place.value = ''; } }, 'Turn weather off') : null),
      this.card('Meals', h('div', { class: 'fam-row-wrap' }, SLOTS.map((sl) => toggle(`${sl.emoji} ${sl.label}`, slots.has(sl.id), (v) => { if (v) slots.add(sl.id); else slots.delete(sl.id); this.save({ mealSlots: SLOTS.map((x) => x.id).filter((id) => slots.has(id)) }, null); })))),
      this.mealieCard(),
      this.card('Chores', toggle('Celebrate when a chore is done', s.celebrate !== false, (v) => this.save({ celebrate: v }, null)),
        !this.app.session?.portal ? null : toggle('Show the Family widget on the desktop', appPref('family', 'widget') !== false, async (v) => {
          try { state.config = await portal.saveConfig({ appSettings: { family: { widget: v } } }); window.dispatchEvent(new Event('mediadesk:family-changed')); } catch (err) { toastError(err); }
        }),
        toggle('Remind me about events while the organizer is open', s.reminders !== false, (v) => { this.save({ reminders: v }, null); if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); })));
  }

  // Mealie: recipes imported from the family's own Mealie server, kept in step on a schedule.
  mealieCard() {
    const card = this.card('Mealie recipes', h('div', { class: 'fam-muted' }, 'Loading…'));
    const parent = Boolean(this.app.session?.parent);
    const gate = () => parentGate(this.app.root, this.store, 'Changing the Mealie connection needs a parent');
    const draw = (m) => {
      const url = input({ type: 'url', value: m.url || '', placeholder: 'http://192.168.1.20:9000', disabled: !parent });
      const token = input({ type: 'password', value: '', placeholder: m.configured ? 'Saved — leave blank to keep it' : 'Paste an API token', autocomplete: 'off', disabled: !parent });
      const every = select([['0', 'Only when I ask'], ['15', 'Every 15 minutes'], ['60', 'Every hour'], ['360', 'Every 6 hours'], ['1440', 'Once a day']], String(m.configured ? m.interval : 60), { disabled: !parent });
      const err = h('div', { class: 'fam-error' });
      const when = m.lastSync ? new Date(m.lastSync).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
      const busy = (btn, text, fn) => async () => {
        if (!(await gate())) return;
        const old = btn.textContent;
        btn.disabled = true; btn.textContent = text; err.textContent = '';
        try { await fn(); } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = old; }
      };
      const save = h('button', { class: 'fam-btn primary' }, m.configured ? 'Save' : 'Connect & import');
      save.onclick = busy(save, 'Checking…', async () => {
        const out = await this.store.mealieSave({ url: url.value.trim(), token: token.value.trim(), interval: Number(every.value) });
        toast(m.configured ? 'Mealie settings saved' : 'Connected to Mealie — importing its recipes', { type: 'success', timeout: 3000 });
        draw(out);
        setTimeout(() => this.store.mealieStatus().then((st) => { if (card.isConnected) draw(st); this.store.refresh().catch(() => {}); }).catch(() => {}), 4000);
      });
      const now = h('button', { class: 'fam-btn' }, 'Import now');
      now.onclick = busy(now, 'Importing…', async () => {
        const out = await this.store.mealieSync();
        toast('Mealie recipes imported', { type: 'success', body: `${out.counts.added} new, ${out.counts.updated} changed, ${out.counts.removed} removed` });
        draw(out);
      });
      const off = h('button', { class: 'fam-btn danger' }, 'Disconnect');
      off.onclick = async () => {
        if (!(await gate())) return;
        const keep = h('input', { type: 'checkbox', checked: true });
        const go = await sheet(this.app.root, {
          title: 'Disconnect Mealie?',
          body: h('div', { class: 'fam-form' }, h('p', {}, 'Recipes stop coming in from Mealie.'), h('label', { class: 'fam-inline-check' }, keep, ' Keep the recipes already imported (they become the family’s own)')),
          actions: [{ label: 'Cancel' }, { label: 'Disconnect', danger: true, value: true }],
        });
        if (!go) return;
        try {
          const out = await this.store.mealieDisconnect(!keep.checked);
          await this.store.refresh();
          toast(keep.checked ? 'Mealie disconnected — its recipes stay in the recipe box' : `Mealie disconnected — removed ${out.removed} recipe${out.removed === 1 ? '' : 's'}`, { timeout: 3000 });
          draw({ configured: false });
        } catch (e) { toastError(e); }
      };
      clear(card, h('h3', {}, 'Mealie recipes'),
        h('p', { class: 'fam-muted' }, 'Bring in every recipe from your Mealie server, photos and all. New and changed recipes come across automatically, and recipes deleted in Mealie leave the recipe box. Make an API token in Mealie under your profile → API Tokens.'),
        m.configured ? h('p', { class: m.error ? 'fam-error' : 'fam-muted' }, m.running ? 'Importing now…' : m.error ? `Last import failed: ${m.error}` : `${m.count} recipe${m.count === 1 ? '' : 's'} from Mealie${when ? ` · last imported ${when}` : ''}${m.last ? ` (${m.last.added} new, ${m.last.updated} changed, ${m.last.removed} removed)` : ''}`) : null,
        field('Mealie address', url), field('API token', token), field('Import automatically', every),
        parent ? h('div', { class: 'fam-row-wrap' }, save, m.configured ? now : null, m.configured ? off : null) : h('p', { class: 'fam-muted small' }, 'Only a parent can change this.'),
        err);
    };
    this.store.mealieStatus().then(draw).catch((e) => clear(card, h('h3', {}, 'Mealie recipes'), h('div', { class: 'fam-error' }, e.message)));
    return card;
  }

  // --- Photo frame & sleep ------------------------------------------------------------

  draw_display(body) {
    const s = this.store.settings;
    const sleep = s.sleep || { on: false, from: '21:30', to: '06:30' };
    const from = input({ type: 'time', value: sleep.from || '21:30' });
    const to = input({ type: 'time', value: sleep.to || '06:30' });
    const saveSleep = (patch) => this.save({ sleep: { ...sleep, from: from.value, to: to.value, ...patch } }, null);
    from.addEventListener('change', () => saveSleep({}));
    to.addEventListener('change', () => saveSleep({}));
    body.append(
      this.card('Photo frame',
        field('Each photo for', select([['6', '6 seconds'], ['12', '12 seconds'], ['20', '20 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['300', '5 minutes']], String(s.frameSeconds || 12), { onchange: (e) => this.save({ frameSeconds: Number(e.target.value) }, null) })),
        field('Start the photo frame when nobody has touched the organizer for', select([['0', 'Never'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes']], String(s.frameIdle || 0), { onchange: (e) => this.save({ frameIdle: Number(e.target.value) }, null) })),
        field('Photos', select([['fill', 'Fill the screen'], ['fit', 'Show the whole photo']], s.frameFit || 'fill', { onchange: (e) => this.save({ frameFit: e.target.value }, null) })),
        toggle('Shuffle', s.frameShuffle !== false, (v) => this.save({ frameShuffle: v }, null))),
      this.card('Sleep mode',
        h('p', { class: 'fam-muted' }, 'Darkens the organizer at night, showing only a dim clock. Tap to wake it for 10 minutes.'),
        toggle('Sleep every night', sleep.on, (v) => saveSleep({ on: v })),
        h('div', { class: 'fam-row-wrap' }, field('From', from), field('Until', to)),
        h('button', { class: 'fam-btn', onclick: () => this.app.sleep(true) }, h('span', { html: ICONS.sleep }), 'Sleep now')));
  }

  // --- Users (parents only) -----------------------------------------------------------

  async draw_users(body) {
    const card = this.card('Accounts', h('div', { class: 'fam-muted' }, 'Loading…'));
    const invites = this.card('Invites waiting');
    const make = this.card('Invite someone');
    body.append(make, invites, card);
    let data;
    try { data = await familyAuth.users(); } catch (err) { clear(card, h('h3', {}, 'Accounts'), h('div', { class: 'fam-error' }, err.message)); return; }
    const members = this.store.members();
    const profileName = (id) => this.store.member(id)?.name || '';
    const origin = location.origin;
    const linkFor = (code) => `${origin}/family?invite=${encodeURIComponent(code)}`;
    const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`, { type: 'success', timeout: 1500 }), () => toast('Select it and copy it'));

    // Make an invite: for a parent or a family member, optionally tied to a profile.
    const role = select([['member', 'Family member'], ['parent', 'Parent (can manage accounts and settings)']], 'member');
    const profile = select([['', 'No profile'], ...members.map((m) => [m.id, `${m.emoji || ''} ${m.name}`.trim()])], '');
    const days = select([['1', '1 day'], ['7', '7 days'], ['30', '30 days']], '7');
    const result = h('div', { class: 'fam-invite-result' });
    clear(make, h('h3', {}, 'Invite someone'),
      h('p', { class: 'fam-muted' }, 'Make an invite code and give it to the person. They open the Family Organizer’s own page and create their account with it, entering their name, email, a username and a password. Each code works once.'),
      h('div', { class: 'fam-row-wrap' }, field('They’ll be', role), field('Their profile', profile), field('Code works for', days)),
      h('button', { class: 'fam-btn primary', onclick: async () => {
        try {
          const { invite } = await familyAuth.createInvite({ role: role.value, profile: profile.value || null, days: Number(days.value) });
          clear(result, h('div', { class: 'fam-invite-code' }, invite.code),
            h('div', { class: 'fam-copy-row' }, input({ value: linkFor(invite.code), readonly: true, onfocus: (e) => e.target.select() }),
              h('button', { class: 'fam-btn', onclick: () => copy(linkFor(invite.code), 'Link') }, h('span', { html: ICONS.copy }), 'Copy link'),
              h('button', { class: 'fam-btn', onclick: () => copy(invite.code, 'Code') }, 'Copy code')));
          // Keep showing the new code after the list of invites is redrawn.
          this.lastInvite = result;
          this.render(this.el, 'users');
        } catch (err) { toastError(err, 'Couldn’t make the invite'); }
      } }, h('span', { html: ICONS.plus }), 'Make invite code'), result);
    if (this.lastInvite) result.replaceWith(this.lastInvite);

    clear(invites, h('h3', {}, 'Invites waiting'), data.invites.length ? h('div', { class: 'fam-cal-list' }, data.invites.map((i) => h('div', { class: 'fam-cal-row' },
      h('div', { class: 'fam-profile-main' }, h('b', { class: 'fam-mono' }, i.code),
        h('small', {}, [i.role === 'parent' ? 'Parent' : 'Family member', i.profile ? profileName(i.profile) : null, `works until ${new Date(i.expires).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, i.by ? `by ${i.by}` : null].filter(Boolean).join(' · '))),
      h('button', { class: 'fam-icon-btn', title: 'Copy link', html: ICONS.copy, onclick: () => copy(linkFor(i.code), 'Link') }),
      h('button', { class: 'fam-icon-btn', title: 'Cancel invite', html: ICONS.trash, onclick: async () => { try { await familyAuth.deleteInvite(i.code); this.render(this.el, 'users'); } catch (err) { toastError(err); } } })))) : h('div', { class: 'fam-muted small' }, 'None.'));
    if (!data.invites.length) invites.hidden = true;

    clear(card, h('h3', {}, 'Accounts'),
      h('p', { class: 'fam-muted' }, `Everyone who signs in to the Family Organizer’s own page (${origin}/family). Parents can manage accounts, settings, profiles and calendars; family members can use everything else.`),
      data.users.length ? h('div', { class: 'fam-cal-list' }, data.users.map((u) => {
        const m = u.profile ? this.store.member(u.profile) : null;
        return h('div', { class: `fam-cal-row ${u.disabled ? 'fam-off' : ''}`, style: { '--c': m?.color || '#868e96' } },
          m ? avatar(m, 'sm') : h('span', { class: 'fam-avatar sm' }, (u.first[0] || '?').toUpperCase()),
          h('div', { class: 'fam-profile-main' }, h('b', {}, `${u.first} ${u.last}`, u.id === data.me ? ' (you)' : ''),
            h('small', {}, [u.username, u.email, u.role === 'parent' ? 'Parent' : 'Family member', u.disabled ? 'Turned off' : null, u.lastLogin ? `last signed in ${new Date(u.lastLogin).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · '))),
          h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.editUser(u, data.me) }));
      })) : h('div', { class: 'fam-muted small' }, 'No accounts yet. Make an invite code for a parent above, then create the account with it on the Family Organizer’s own page.'));
  }

  async editUser(u, meId) {
    const first = input({ value: u.first, required: true, maxlength: 60 });
    const last = input({ value: u.last, required: true, maxlength: 60 });
    const email = input({ type: 'email', value: u.email, required: true, maxlength: 200 });
    const role = select([['member', 'Family member'], ['parent', 'Parent']], u.role);
    const profile = select([['', 'No profile'], ...this.store.members().map((m) => [m.id, `${m.emoji || ''} ${m.name}`.trim()])], u.profile || '');
    const off = toggle('Turn this account off (they can’t sign in)', u.disabled);
    const password = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Leave empty to keep their password', minlength: 8 });
    const err = h('div', { class: 'fam-error' });
    const out = await sheet(this.app.root, {
      title: `${u.first} ${u.last}`,
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-muted' }, `Username: ${u.username}`),
        h('div', { class: 'fam-row-wrap' }, field('First name', first), field('Last name', last)), field('Email', email),
        h('div', { class: 'fam-row-wrap' }, field('Role', role), field('Profile', profile)),
        u.id === meId ? null : off, field('New password', password, 'At least 8 characters. Signs them out everywhere.'), err),
      actions: [u.id === meId ? null : { label: 'Remove account', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: async (close) => {
        try {
          await familyAuth.updateUser(u.id, { first: first.value, last: last.value, email: email.value, role: role.value, profile: profile.value || null, ...(u.id === meId ? {} : { disabled: off.querySelector('input').checked }), ...(password.value ? { password: password.value } : {}) });
          close('saved');
        } catch (e) { err.textContent = e.message; }
      } }],
    });
    if (out === 'delete') {
      const sure = await sheet(this.app.root, { title: 'Remove account?', body: h('p', {}, `${u.first} ${u.last} won’t be able to sign in. Their family profile, events and chores stay.`), actions: [{ label: 'Cancel' }, { label: 'Remove', danger: true, value: true }] });
      if (sure) { try { await familyAuth.deleteUser(u.id); } catch (e) { toastError(e); } }
    }
    if (out) this.render(this.el, 'users');
  }

  // --- My account -----------------------------------------------------------------------

  draw_account(body) {
    const u = this.app.session.user;
    const first = input({ value: u.first, maxlength: 60, autocomplete: 'given-name' });
    const last = input({ value: u.last, maxlength: 60, autocomplete: 'family-name' });
    const email = input({ type: 'email', value: u.email, maxlength: 200, autocomplete: 'email' });
    const current = input({ type: 'password', autocomplete: 'current-password' });
    const next = input({ type: 'password', autocomplete: 'new-password', minlength: 8 });
    const again = input({ type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'fam-error' });
    body.append(this.card('My account',
      h('div', { class: 'fam-muted' }, `Username: ${u.username} · ${u.role === 'parent' ? 'Parent' : 'Family member'}`),
      h('div', { class: 'fam-row-wrap' }, field('First name', first), field('Last name', last)), field('Email', email),
      h('h3', {}, 'Change password'), field('Current password', current), h('div', { class: 'fam-row-wrap' }, field('New password', next), field('New password again', again)), err,
      h('div', { class: 'fam-row-wrap' },
        h('button', { class: 'fam-btn primary', onclick: async () => {
          err.textContent = '';
          if (next.value && next.value !== again.value) { err.textContent = 'The new passwords don’t match'; return; }
          try {
            const r = await familyAuth.updateMe({ first: first.value, last: last.value, email: email.value, ...(next.value ? { password: current.value, newPassword: next.value } : {}) });
            this.app.session.user = r.user;
            toast('Saved', { type: 'success', timeout: 1500 });
            this.render(this.el, 'account');
          } catch (e) { err.textContent = e.message; }
        } }, 'Save'),
        h('button', { class: 'fam-btn danger', onclick: async () => { try { await familyAuth.logout(); } catch { /* signed out anyway */ } location.reload(); } }, 'Sign out'))));
  }

  // --- Quick picks ---------------------------------------------------------------------

  draw_quickpicks(body) {
    const picks = this.store.quickPicks();
    const parent = this.app.session?.parent;
    const canEdit = !this.app.session?.user || parent;
    const save = async (next, msg) => {
      if (!(await parentGate(this.app.root, this.store, 'Changing quick picks needs a parent.'))) return;
      await this.save({ quickPicks: next }, msg);
      this.render(this.el, 'quickpicks');
    };
    body.append(this.card('Quick picks',
      h('p', { class: 'fam-muted' }, 'Ready-made chores and routine steps to choose from when adding a chore. Choosing one fills in its name, emoji, stars, how often and part of the day; everything can still be changed before saving.'),
      h('div', { class: 'fam-cal-list' }, picks.length ? picks.map((q, i) => h('div', { class: 'fam-cal-row' },
        h('span', { class: 'fam-chore-emoji' }, q.emoji || '✔️'),
        h('div', { class: 'fam-profile-main' }, h('b', {}, q.title),
          h('small', {}, [q.kind === 'routine' ? `Routine · ${PARTS.find((p) => p.id === q.part)?.label || 'Morning'}` : 'Chore', describeChoreRepeat(q.repeat), q.stars ? `${q.stars} ★` : 'No stars'].join(' · '))),
        canEdit ? h('div', { class: 'fam-profile-move' },
          h('button', { class: 'fam-icon-btn', title: 'Move up', disabled: i === 0, html: ICONS.left, onclick: () => { const n = [...picks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n, null); } }),
          h('button', { class: 'fam-icon-btn', title: 'Move down', disabled: i === picks.length - 1, html: ICONS.right, onclick: () => { const n = [...picks]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n, null); } })) : null,
        canEdit ? h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.editQuickPick(q, picks, save) }) : null))
        : h('div', { class: 'fam-muted small' }, 'No quick picks.')),
      canEdit ? h('div', { class: 'fam-row-wrap' },
        h('button', { class: 'fam-btn primary', onclick: () => this.editQuickPick(null, picks, save) }, h('span', { html: ICONS.plus }), 'Add a quick pick'),
        h('button', { class: 'fam-btn', onclick: async () => {
          const ok = await sheet(this.app.root, { title: 'Use the suggested quick picks?', body: h('p', {}, 'Your quick picks are replaced with MediaDesk’s suggestions. Chores you’ve already made aren’t changed.'), actions: [{ label: 'Cancel' }, { label: 'Use suggestions', primary: true, value: true }] });
          if (ok) save(DEFAULT_QUICK_PICKS.map((q) => ({ ...q })), 'Suggestions restored');
        } }, 'Restore suggestions'))
        : h('p', { class: 'fam-muted small' }, 'A parent can change these.')));
  }

  async editQuickPick(q, picks, save) {
    const emoji = emojiButton(q?.emoji || '🧹');
    const title = input({ value: q?.title || '', placeholder: 'e.g. Feed the fish', required: true, autofocus: true, maxlength: 120 });
    const stars = input({ type: 'number', min: 0, max: 100, value: q?.stars ?? 1, class: 'fam-input tiny' });
    const type = select([['chore', 'Chore'], ['routine', 'Routine step']], q?.kind || 'chore');
    const part = select(PARTS.map((p) => [p.id, `${p.emoji} ${p.label}`]), q?.part && q.part !== 'anytime' ? q.part : 'morning');
    const r = q?.repeat || { kind: 'daily' };
    const kind = select([['daily', 'Every day'], ['weekly', 'On these days'], ['once', 'Just once']], ['daily', 'weekly', 'once'].includes(r.kind) ? r.kind : 'daily');
    const days = new Set(r.kind === 'weekly' ? r.days : [1, 2, 3, 4, 5]);
    const dayRow = h('div', { class: 'fam-weekdays' });
    const partRow = field('Part of the day', part);
    const draw = () => {
      clear(dayRow, kind.value !== 'weekly' ? null : DAY_SHORT.map((d, i) => h('button', { type: 'button', class: days.has(i) ? 'on' : '', onclick: () => { if (days.has(i)) days.delete(i); else days.add(i); draw(); } }, d.slice(0, 2))));
      partRow.hidden = type.value !== 'routine';
    };
    kind.addEventListener('change', draw);
    type.addEventListener('change', draw);
    draw();
    const out = await sheet(this.app.root, {
      title: q ? 'Edit quick pick' : 'New quick pick',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title), field('Type', type), partRow, field('How often', h('div', {}, kind, dayRow)), field('Stars', stars)),
      actions: [q ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
        if (!title.value.trim()) { title.focus(); return; }
        const repeat = { kind: kind.value };
        if (kind.value === 'weekly') repeat.days = [...days].sort();
        close({ id: q?.id || `qp-${Date.now().toString(36)}`, title: title.value.trim(), emoji: emoji.value, stars: Math.max(0, Number(stars.value) || 0), kind: type.value, part: type.value === 'routine' ? part.value : 'anytime', repeat });
      } }],
    });
    if (!out) return;
    if (out === 'delete') await save(picks.filter((x) => x.id !== q.id), 'Quick pick removed');
    else await save(q ? picks.map((x) => (x.id === q.id ? out : x)) : [...picks, out], 'Saved');
  }

  // --- Extra chores ----------------------------------------------------------------------

  draw_extras(body) {
    const items = this.store.extraChores();
    const canEdit = !this.app.session?.user || this.app.session.parent;
    const save = async (next, msg) => {
      if (!(await parentGate(this.app.root, this.store, 'Changing extra chores needs a parent.'))) return;
      await this.save({ extraChores: next }, msg);
      this.render(this.el, 'extras');
    };
    const editItem = async (x) => {
      const emoji = emojiButton(x?.emoji || '⭐');
      const title = input({ value: x?.title || '', placeholder: 'e.g. Wash the car', required: true, autofocus: true, maxlength: 80 });
      const stars = input({ type: 'number', min: 0, max: 100, value: x?.stars ?? 2, class: 'fam-input tiny' });
      const out = await sheet(this.app.root, {
        title: x ? 'Edit extra chore' : 'New extra chore',
        body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title), field('Stars (once a parent approves)', stars)),
        actions: [x ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
          if (!title.value.trim()) { title.focus(); return; }
          close({ id: x?.id || `xc-${Date.now().toString(36)}`, title: title.value.trim(), emoji: emoji.value, stars: Math.max(0, Number(stars.value) || 0) });
        } }],
      });
      if (!out) return;
      if (out === 'delete') await save(items.filter((i) => i.id !== x.id), 'Removed');
      else await save(x ? items.map((i) => (i.id === x.id ? out : i)) : [...items, out], 'Saved');
    };
    body.append(this.card('Extra chores',
      h('p', { class: 'fam-muted' }, 'The menu on the right of the Chores tab, for one-off jobs. Tapping one adds it for whoever is signed in (or asks who did it), already ticked off; its stars count once a parent approves it in Chores → Approve.'),
      h('div', { class: 'fam-cal-list' }, items.length ? items.map((x, i) => h('div', { class: 'fam-cal-row' },
        h('span', { class: 'fam-chore-emoji' }, x.emoji || '✔️'),
        h('div', { class: 'fam-profile-main' }, h('b', {}, x.title), h('small', {}, x.stars ? `${x.stars} ★` : 'No stars')),
        canEdit ? h('div', { class: 'fam-profile-move' },
          h('button', { class: 'fam-icon-btn', title: 'Move up', disabled: i === 0, html: ICONS.left, onclick: () => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n, null); } }),
          h('button', { class: 'fam-icon-btn', title: 'Move down', disabled: i === items.length - 1, html: ICONS.right, onclick: () => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n, null); } })) : null,
        canEdit ? h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => editItem(x) }) : null))
        : h('div', { class: 'fam-muted small' }, 'None — the menu is empty.')),
      canEdit ? h('div', { class: 'fam-row-wrap' },
        h('button', { class: 'fam-btn primary', onclick: () => editItem(null) }, h('span', { html: ICONS.plus }), 'Add an extra chore'),
        h('button', { class: 'fam-btn', onclick: async () => {
          const ok = await sheet(this.app.root, { title: 'Use the suggested extra chores?', body: h('p', {}, 'The menu is replaced with MediaDesk’s suggestions.'), actions: [{ label: 'Cancel' }, { label: 'Use suggestions', primary: true, value: true }] });
          if (ok) save(DEFAULT_EXTRA_CHORES.map((x) => ({ ...x })), 'Suggestions restored');
        } }, 'Restore suggestions'))
        : h('p', { class: 'fam-muted small' }, 'A parent can change these.')));
  }

  // --- Parent PIN ------------------------------------------------------------------------

  draw_parents(body) {
    const has = Boolean(this.store.settings.parentPin);
    const pin = input({ type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: '4 to 8 digits', autocomplete: 'new-password' });
    body.append(this.card('Parent PIN',
      h('p', { class: 'fam-muted' }, 'With a PIN, kids can still tick off chores, add events and use lists, but settings, chores, rewards and stars need a parent.'),
      h('div', { class: 'fam-copy-row' }, pin, h('button', { class: 'fam-btn primary', onclick: async () => {
        if (!/^\d{4,8}$/.test(pin.value)) { toast('Use 4 to 8 digits', { type: 'warning' }); return; }
        if (has && !(await parentGate(this.app.root, this.store, 'Enter the current PIN to change it.'))) return;
        await this.save({ parentPin: pin.value }, 'PIN set');
        lockParent();
        this.render(this.el);
      } }, has ? 'Change PIN' : 'Set PIN')),
      has ? h('button', { class: 'fam-btn danger', onclick: async () => { if (await parentGate(this.app.root, this.store, 'Enter the PIN to turn it off.')) { await this.save({ parentPin: null }, 'PIN turned off'); this.render(this.el); } } }, 'Turn off PIN') : null));
  }
}

function guessName(url) {
  if (/google\.com/i.test(url)) return 'Google Calendar';
  if (/outlook|office365|live\.com/i.test(url)) return 'Outlook';
  if (/icloud\.com/i.test(url)) return 'iCloud';
  if (/yahoo/i.test(url)) return 'Yahoo';
  if (/cozi/i.test(url)) return 'Cozi';
  try { return new URL(url.replace(/^webcal/i, 'https')).hostname.replace(/^www\./, ''); } catch { return 'Calendar'; }
}
