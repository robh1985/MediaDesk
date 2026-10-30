// Family Organizer settings: profiles, connected calendars, the phone calendar address, weather,
// meals, the photo frame, sleep mode and the parent PIN.

import { h, clear, toast, toastError } from '../../ui.js';
import { sheet, field, input, select, toggle, avatar, memberPicker, emojiButton, colorPicker, COLORS, ICONS, parentGate, lockParent } from './shared.js';
import { SLOTS } from './meals.js';
import { portal, state, appPref } from '../../api.js';

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
    this.section = 'profiles';
  }

  render(el, section) {
    this.el = el;
    if (section) this.section = section;
    const sections = [['profiles', 'Profiles'], ['calendars', 'Calendars'], ['general', 'General'], ['display', 'Photo frame & sleep'], ['parents', 'Parent PIN']];
    const nav = h('div', { class: 'fam-seg fam-settings-nav' }, sections.map(([id, label]) => h('button', { class: this.section === id ? 'on' : '', onclick: () => { this.section = id; this.render(el); } }, label)));
    const body = h('div', { class: 'fam-settings' });
    clear(el, h('div', { class: 'fam-toolbar' }, h('div', { class: 'fam-toolbar-title' }, 'Settings'), h('div', { class: 'fam-spacer' }), nav), body);
    this[`draw_${this.section}`](body);
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
    const cals = this.store.all('calendars');
    const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) f.text().then((t) => this.importIcs(t)); } });
    body.append(
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
        h('p', { class: 'fam-muted' }, 'Copy events from an .ics file (exported from another calendar) into the family calendar.'),
        h('button', { class: 'fam-btn', onclick: () => fileIn.click() }, h('span', { html: ICONS.upload }), 'Import .ics file'), fileIn));
  }

  async importIcs(text) {
    try {
      const evs = await this.store.parseIcs(text);
      if (!evs.length) { toast('No events in that file', { type: 'warning' }); return; }
      const ok = await sheet(this.app.root, { title: 'Import events', body: h('p', {}, `Add ${evs.length} event${evs.length === 1 ? '' : 's'} to the family calendar?`), actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, value: true }] });
      if (!ok) return;
      for (let i = 0; i < evs.length; i += 200) {
        await this.store.batch(evs.slice(i, i + 200).map((e) => ({ op: 'put', col: 'events', item: { id: `imp-${e.id}`, title: e.title, allDay: e.allDay, start: e.start, end: e.end, rrule: e.rrule || null, exdates: e.exdates || [], location: e.location, notes: e.notes, members: [] } })));
      }
      toast(`Imported ${evs.length} events`, { type: 'success' });
    } catch (err) { toastError(err, 'Couldn’t import that file'); }
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
      this.card('Chores', toggle('Celebrate when a chore is done', s.celebrate !== false, (v) => this.save({ celebrate: v }, null)),
        toggle('Show the Family widget on the desktop', appPref('family', 'widget') !== false, async (v) => {
          try { state.config = await portal.saveConfig({ appSettings: { family: { widget: v } } }); window.dispatchEvent(new Event('mediadesk:family-changed')); } catch (err) { toastError(err); }
        }),
        toggle('Remind me about events while the organizer is open', s.reminders !== false, (v) => { this.save({ reminders: v }, null); if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); })));
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
