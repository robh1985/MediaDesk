// Gift lists: Christmas (a list per person in a yearly folder, with Santa and stocking gifts kept
// from the kids, shipping cutoffs and a card list), birthdays (tied to the calendar, with a wish
// list the birthday person keeps, party planning and thank-you notes) and lists for any occasion
// (from a template, with fields of your own, who may see, edit or claim, and a share link).
// They all share claiming ("I'll get it"), hiding purchases from whoever the list is for, gift
// status, budgets, store links, priorities, price filters and reminders.
//
// The server decides what each person gets (family-gifts.js): the person a list is for only has
// their own wishes, without who's getting them; kids never get Santa's or the stockings' gifts.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, parseYmd, fmtDate, todayYmd, dayDiff, addDays } from './dates.js';
import { sheet, field, input, select, avatar, memberPicker, emojiButton, colorPicker, toggle, parentGate, ICONS } from './shared.js';

export const GIFT_KINDS = ['christmas', 'birthday', 'gift'];
export const isGift = (l) => GIFT_KINDS.includes(l?.kind);
// Gift lists and the Christmas card list (which lives in the Christmas folder too).
export const isGiftish = (l) => isGift(l) || l?.kind === 'cards';
// A Christmas list's name: “Emma 2026 Christmas List”.
// A name ending in s gets just an apostrophe (James’), the rest ’s (Emma’s).
export const possessive = (name) => (name ? (/s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`) : '');
export const christmasName = (person, year) => `${person ? `${possessive(person)} ` : ''}${year} Christmas List`;
// Names this list could have been given automatically (with or without the ’s).
const autoChristmasNames = (person, year) => [christmasName(person, year), `${person} ${year} Christmas List`, person];
export const KIND_LABELS = { christmas: 'Christmas list', birthday: 'Birthday list', gift: 'Gift list', cards: 'Christmas cards' };

const STATUS = [['idea', '💡', 'Idea'], ['bought', '🛍️', 'Bought'], ['wrapped', '🎀', 'Wrapped'], ['given', '🎁', 'Given']];
const RSVP = [['', '❔', 'No answer yet'], ['yes', '✅', 'Coming'], ['maybe', '🤔', 'Maybe'], ['no', '❌', 'Can’t come']];
const SECRETS = [['', 'No'], ['santa', '🎅 From Santa'], ['stocking', '🧦 Stocking stuffer']];
const MILESTONES = new Set([1, 5, 10, 13, 16, 18, 21, 30, 40, 50, 60, 65, 70, 75, 80, 90, 100]);
const REMINDER_CHOICES = [[30, '1 month before'], [14, '2 weeks before'], [7, '1 week before'], [2, '2 days before'], [1, 'The day before'], [0, 'On the day']];
const PRICE_RANGES = [['', 'Any price'], ['0-25', 'Under $25'], ['25-50', '$25–50'], ['50-100', '$50–100'], ['100-', '$100+']];
const SORTS = [['wanted', 'Most wanted first'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['name', 'Name'], ['status', 'Status'], ['new', 'Newest first']];
const PARTY_PARTS = [['guest', '👥 Guests', 'Add a guest'], ['food', '🍰 Food & drinks', 'Add food or drinks'], ['decor', '🎈 Decorations', 'Add decorations']];

// Lists for any occasion start from one of these (or a blank one).
export const TEMPLATES = [
  { id: 'wedding', label: 'Wedding', emoji: '💍', color: '#c2255c', fields: [['Store', 'text'], ['Color / finish', 'text'], ['How many', 'number']], reminders: [30, 7], starter: [] },
  { id: 'baby', label: 'Baby shower', emoji: '🍼', color: '#1098ad', fields: [['Size', 'text'], ['Store', 'text']], reminders: [14, 2], starter: ['Diapers', 'Onesies', 'Baby wipes', 'Swaddle blankets', 'Board books'] },
  { id: 'graduation', label: 'Graduation', emoji: '🎓', color: '#4263eb', fields: [['Store', 'text']], reminders: [14, 2], starter: [] },
  { id: 'holiday', label: 'Holiday', emoji: '🕎', color: '#2f9e44', fields: [['Store', 'text']], reminders: [14, 2], starter: [] },
  { id: 'housewarming', label: 'Housewarming', emoji: '🏡', color: '#e8590c', fields: [['Room', 'text'], ['Store', 'text']], reminders: [7], starter: [] },
  { id: 'anniversary', label: 'Anniversary', emoji: '💐', color: '#ae3ec9', fields: [], reminders: [14, 2], starter: [] },
  { id: 'blank', label: 'Blank list', emoji: '🎁', color: '#d6336c', fields: [], reminders: [], starter: [] },
];

// Typical last days to send for Christmas in the US (carriers publish them each autumn; change
// them in the Christmas folder).
const defaultShipping = (y) => [
  ['UPS & FedEx Ground', `${y}-12-15`], ['USPS Ground Advantage', `${y}-12-17`], ['USPS Priority Mail', `${y}-12-18`],
  ['Amazon (free shipping)', `${y}-12-19`], ['USPS Priority Mail Express', `${y}-12-20`],
].map(([label, date]) => ({ label, date }));

const isGiftItem = (i) => !i.part || i.part === 'gift';
const taken = (i) => Boolean(i.claimedBy || i.claimedName || ['bought', 'wrapped', 'given'].includes(i.status));
const urlIn = (s) => /https?:\/\/[^\s<>"']+/i.exec(String(s || ''))?.[0] || '';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const newId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
const cleanName = (s) => String(s || '').trim().toLowerCase();

let revealed = false;
try { revealed = sessionStorage.getItem('fam-gift-reveal') === '1'; } catch { /* private window */ }

export class GiftLists {
  constructor(view) {
    this.view = view;
    this.app = view.app;
    this.store = view.store;
    this.tabs = {}; // list id -> 'gifts' | 'party' | 'thanks'
    this.sort = 'wanted';
    this.range = '';
  }

  get viewer() { return this.store.viewer || { parent: true, profile: null }; }
  get me() { return this.viewer.profile; }
  isRecipient(l) { return Boolean(this.me && l?.recipient === this.me); }
  canEdit(l) {
    const e = l?.access?.edit;
    if (!Array.isArray(e) || !e.length) return true;
    if (!this.me) return this.viewer.parent;
    return e.includes(this.me) || l.owner === this.me;
  }
  canClaim(l) {
    if (this.isRecipient(l)) return false;
    const c = l?.access?.claim;
    if (!Array.isArray(c) || !c.length) return true;
    if (!this.me) return this.viewer.parent;
    return c.includes(this.me) || l.owner === this.me;
  }
  // A screen nobody's signed in to as a family member (the kitchen tablet, MediaDesk itself):
  // surprises stay hidden until a parent shows them.
  get sharedScreen() { return !this.me; }
  get hidden() { return this.sharedScreen && !revealed; }
  async reveal() {
    if (!(await parentGate(this.app.root, this.store, 'Show what’s been bought and the surprises?'))) return;
    revealed = true;
    try { sessionStorage.setItem('fam-gift-reveal', '1'); } catch { /* this page only */ }
    this.view.render(this.view.el);
  }
  hideAgain() {
    revealed = false;
    try { sessionStorage.removeItem('fam-gift-reveal'); } catch { /* fine */ }
    this.view.render(this.view.el);
  }

  money(n) {
    if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: this.store.settings.currency || 'USD', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n)); } catch { return `$${n}`; }
  }

  // Who a list is for: a family member, or someone else by name.
  who(l) {
    const m = l?.recipient ? this.store.member(l.recipient) : null;
    return { member: m, name: m?.name || l?.recipientName || '' };
  }
  recipientKey(l) { return l?.recipient ? `m:${l.recipient}` : l?.recipientName ? `n:${cleanName(l.recipientName)}` : ''; }

  // The day a list is for: Christmas Day, the next birthday, or the occasion's date.
  nextDate(l, today = new Date()) {
    if (l.kind === 'christmas' || l.kind === 'cards') return `${l.year || today.getFullYear()}-12-25`;
    if (l.kind === 'birthday') {
      const src = this.birthdaySource(l);
      if (!src) return null;
      const [, mo, d] = src.split('-').map(Number);
      let y = today.getFullYear();
      const t = ymd(today);
      const at = (yy) => `${yy}-${String(mo).padStart(2, '0')}-${String(Math.min(d, new Date(yy, mo, 0).getDate())).padStart(2, '0')}`;
      if (at(y) < t) y++;
      return at(y);
    }
    return l.date || null;
  }
  // A birthday's date: the calendar event it's tied to, the person's own birthday, or its own.
  birthdaySource(l) {
    const ev = l.eventId ? this.store.get('events', l.eventId) : null;
    if (ev?.start) return String(ev.start).slice(0, 10);
    const m = l.recipient ? this.store.member(l.recipient) : null;
    return m?.birthday || l.date || null;
  }
  birthYear(l) {
    if (l.birthYear) return Number(l.birthYear);
    const m = l.recipient ? this.store.member(l.recipient) : null;
    return m?.birthday ? Number(m.birthday.slice(0, 4)) : null;
  }
  age(l) {
    const d = this.nextDate(l);
    const y = this.birthYear(l);
    if (!d || !y) return null;
    const a = Number(d.slice(0, 4)) - y;
    return a > 0 && a < 130 ? a : null;
  }
  // The year a list's gifts count for (given this year, or in years before).
  cycleYear(l) { return Number((this.nextDate(l) || todayYmd()).slice(0, 4)); }

  gifts(l) { return this.view.items(l.id).filter(isGiftItem); }
  spent(l) {
    return this.gifts(l).filter(taken).reduce((s, i) => s + (i.group ? (i.chips || []).reduce((t, c) => t + (Number(c.amount) || 0), 0) : Number(i.price) || 0), 0);
  }

  // Gifts given to the same person before (in other lists, or in earlier years of this one).
  history(l) {
    const key = this.recipientKey(l);
    if (!key) return [];
    const year = this.cycleYear(l);
    return this.store.all('listitems').filter((i) => {
      if (i.status !== 'given' || !isGiftItem(i)) return false;
      const other = this.store.get('lists', i.list);
      if (!other || !isGift(other) || this.recipientKey(other) !== key) return false;
      return i.list !== l.id || (i.givenYear && i.givenYear < year);
    }).sort((a, b) => (b.givenYear || 0) - (a.givenYear || 0));
  }

  // --- The menu --------------------------------------------------------------------

  // The Lists menu: everyday lists, then each Christmas folder with its lists under it, birthdays
  // (soonest first), other gift lists, and the archive.
  menu(lists) {
    const out = [];
    const plain = lists.filter((l) => !isGiftish(l));
    const active = lists.filter((l) => isGiftish(l) && !l.archived);
    for (const l of plain) out.push({ list: l });
    const folders = [...new Set(active.filter((l) => l.kind === 'christmas' || l.kind === 'cards').map((l) => l.folder || `Christmas ${l.year || new Date().getFullYear()}`))].sort().reverse();
    for (const f of folders) {
      const inside = active.filter((l) => (l.kind === 'christmas' || l.kind === 'cards') && (l.folder || `Christmas ${l.year}`) === f)
        .sort((a, b) => (a.kind === 'cards') - (b.kind === 'cards') || String(a.title).localeCompare(String(b.title)));
      const days = dayDiff(new Date(), parseYmd(this.nextDate(inside[0])));
      out.push({ id: `folder:${f}`, title: f, emoji: '🎄', color: '#2f9e44', cls: 'fam-list-folder', count: days >= 0 ? `${days}d` : null });
      for (const l of inside) out.push({ list: l, cls: 'fam-list-child', quiet: true });
    }
    const soon = (l) => this.nextDate(l) || '9999';
    for (const l of active.filter((x) => x.kind === 'birthday').sort((a, b) => soon(a).localeCompare(soon(b)))) out.push({ list: l });
    for (const l of active.filter((x) => x.kind === 'gift').sort((a, b) => soon(a).localeCompare(soon(b)))) out.push({ list: l });
    const archived = lists.filter((l) => isGiftish(l) && l.archived).length;
    if (archived) out.push({ id: 'archive', title: 'Archived lists', emoji: '🗄️', color: '#868e96', count: archived });
    return out;
  }

  // What a list shows beside it in the menu: a countdown for gift lists.
  menuCount(l) {
    if (!isGift(l)) return null;
    const d = this.nextDate(l);
    if (!d) return null;
    const n = dayDiff(new Date(), parseYmd(d));
    return n === 0 ? 'Today' : n > 0 && n <= 60 ? `${n}d` : null;
  }

  // --- A gift list -------------------------------------------------------------------

  draw(main, l) {
    if (l.kind === 'cards') return this.drawCards(main, l);
    const mine = this.isRecipient(l);
    const hide = !mine && this.hidden;
    const tab = l.kind === 'birthday' ? this.tabs[l.id] || 'gifts' : 'gifts';
    const parts = [this.header(l, { mine, hide }), this.banner(l, { mine, hide })];
    if (l.kind === 'birthday') {
      parts.push(h('div', { class: 'fam-gift-tabs', role: 'tablist' }, [['gifts', mine ? '🎁 My wish list' : '🎁 Gifts'], ['party', '🎈 Party'], ['thanks', '💌 Thank-yous']].map(([id, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(tab === id), class: `fam-chip ${tab === id ? 'on' : ''}`, onclick: () => { this.tabs[l.id] = id; this.view.render(this.view.el); },
      }, label))));
    }
    if (tab === 'party') parts.push(this.party(l, { mine }));
    else if (tab === 'thanks') parts.push(this.thanks(l));
    else parts.push(...this.giftsTab(l, { mine, hide }));
    clear(main, parts);
  }

  header(l, { mine, hide }) {
    const { member, name } = this.who(l);
    const d = this.nextDate(l);
    const days = d ? dayDiff(new Date(), parseYmd(d)) : null;
    const chips = [];
    if (days != null) {
      const what = l.kind === 'christmas' ? 'Christmas' : l.kind === 'birthday' ? 'the birthday' : l.occasion || 'the day';
      chips.push(h('span', { class: 'fam-gift-chip count', title: fmtDate(parseYmd(d), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) },
        days === 0 ? (l.kind === 'christmas' ? '🎄 It’s Christmas!' : '🎉 Today!') : days > 0 ? `${l.kind === 'christmas' ? '🎄' : l.kind === 'birthday' ? '🎂' : '📅'} ${plural(days, 'day')} to ${what}` : `📅 ${fmtDate(parseYmd(d), { month: 'short', day: 'numeric', year: 'numeric' })}`));
    }
    const age = l.kind === 'birthday' ? this.age(l) : null;
    if (age) chips.push(h('span', { class: `fam-gift-chip ${MILESTONES.has(age) ? 'milestone' : ''}` }, MILESTONES.has(age) ? `⭐ Turning ${age} — a milestone!` : `Turning ${age}`));
    if (!mine && !hide && Number(l.budget) > 0) {
      const spent = this.spent(l);
      const pct = Math.min(100, Math.round((spent / Number(l.budget)) * 100));
      chips.push(h('span', { class: `fam-gift-budget ${spent > Number(l.budget) ? 'over' : ''}`, title: 'What’s been claimed or bought, against the budget' },
        h('span', {}, `${this.money(spent)} of ${this.money(l.budget)}`), h('span', { class: 'fam-gift-bar' }, h('i', { style: { width: `${pct}%` } }))));
    }
    return h('div', { class: 'fam-toolbar fam-gift-head', style: { '--c': l.color || '#d6336c' } },
      h('div', { class: 'fam-toolbar-title' }, h('span', {}, l.emoji || '🎁'), ' ', l.title,
        l.kind === 'christmas' && l.folder ? h('small', { class: 'fam-muted' }, ` · ${l.folder}`) : null),
      member && member.name !== l.title ? h('span', { class: 'fam-list-for' }, 'For ', h('span', {}, avatar(member, 'xs'), member.name)) : !member && name && name !== l.title ? h('span', { class: 'fam-list-for' }, `For ${name}`) : null,
      ...chips,
      h('div', { class: 'fam-spacer' }),
      isGift(l) && this.canEdit(l) && !mine ? h('button', { class: 'fam-btn', title: 'A link for people outside the family', onclick: () => this.shareSheet(l) }, l.shareToken ? '🔗 Shared' : '🔗 Share') : null,
      h('button', { class: 'fam-icon-btn', title: 'More', 'aria-label': 'More for this list', html: ICONS.more, onclick: () => this.moreSheet(l) }),
      this.canEdit(l) ? h('button', { class: 'fam-icon-btn', title: 'List settings', 'aria-label': 'List settings', html: ICONS.edit, onclick: () => this.editList(l) }) : null);
  }

  banner(l, { mine, hide }) {
    const { member, name } = this.who(l);
    if (mine) return h('div', { class: 'fam-gift-note' }, '🎁 ', h('b', {}, 'This is your wish list.'), ' Add what you’d like (paste a store link and the details fill in). What the family gets you stays a surprise: you won’t see their ideas or what’s been bought.');
    if (hide) {
      return h('div', { class: 'fam-gift-note hide' }, '🙈 Surprises are hidden on this screen, since nobody’s signed in as a family member: only the wishes on the list show.',
        h('button', { class: 'fam-btn small', onclick: () => this.reveal() }, 'Show them'));
    }
    const bits = [];
    if (member) bits.push(`${member.name} only sees what they add themselves — not your ideas, who’s getting what, or the budget.`);
    if (l.kind === 'christmas' && this.viewer.parent) bits.push('Santa and stocking gifts never show for kids.');
    return h('div', { class: 'fam-gift-note quiet' }, member ? '🤫 ' : '', bits.join(' ') || (name ? `Gifts for ${name}.` : ''),
      this.sharedScreen ? h('button', { class: 'fam-btn small', onclick: () => this.hideAgain() }, 'Hide surprises') : null);
  }

  giftsTab(l, { mine, hide }) {
    const out = [];
    if (l.kind === 'christmas' && !mine) out.push(this.shippingStrip(l));
    out.push(this.aboutPanel(l), this.boardPanel(l));
    if (this.canEdit(l) || mine) out.push(this.addRow(l, { mine }));
    let items = this.gifts(l);
    const year = this.cycleYear(l);
    // Given in earlier years: kept in the history, not the list.
    items = items.filter((i) => !(i.status === 'given' && i.givenYear && i.givenYear < year));
    // A shared screen shows what the person themselves would: their own wishes, nothing secret.
    if (hide) items = items.filter((i) => !i.secret && (!l.recipient || i.addedBy === l.recipient));
    const total = items.length;
    out.push(this.filterBar(l, total));
    if (this.range) {
      const [lo, hi] = this.range.split('-').map((x) => (x === '' ? null : Number(x)));
      items = items.filter((i) => i.price != null && i.price !== '' && (lo == null || Number(i.price) >= lo) && (hi == null || Number(i.price) < hi));
    }
    items = this.sorted(items);
    const body = h('div', { class: 'fam-list-items fam-gift-items' });
    if (mine || hide) body.append(...items.map((i) => this.row(i, l, { mine, hide })));
    else {
      const groups = [['Still to get', items.filter((i) => !taken(i))], ['Getting', items.filter((i) => taken(i) && i.status !== 'given')], ['Given', items.filter((i) => i.status === 'given')]];
      for (const [label, list] of groups) if (list.length) body.append(h('div', { class: 'fam-aisle' }, `${label} · ${list.length}`), ...list.map((i) => this.row(i, l, { mine, hide })));
    }
    if (!total) body.append(h('div', { class: 'fam-muted fam-list-empty' }, mine ? 'Nothing on your wish list yet. Add the first thing you’d like.' : 'No gifts yet. Add an idea, or paste a link from a store.'));
    else if (!items.length) body.append(h('div', { class: 'fam-muted fam-list-empty' }, 'Nothing in that price range.'));
    if (!mine && !hide) {
      const past = this.history(l);
      if (past.length) {
        body.append(h('details', { class: 'fam-gift-history' }, h('summary', {}, `🕰️ Given before · ${past.length}`),
          past.map((i) => h('div', { class: 'fam-gift-past' }, h('span', {}, i.text), h('small', { class: 'fam-muted' }, [i.givenYear, this.store.get('lists', i.list)?.title].filter(Boolean).join(' · '))))));
      }
    }
    out.push(body);
    return out;
  }

  sorted(items) {
    const st = (i) => STATUS.findIndex((s) => s[0] === (i.status || 'idea'));
    const by = {
      wanted: (a, b) => Number(Boolean(b.mostWanted)) - Number(Boolean(a.mostWanted)) || (b.stars || 0) - (a.stars || 0) || (a.order ?? 0) - (b.order ?? 0),
      low: (a, b) => (a.price === '' || a.price == null ? 1e12 : Number(a.price)) - (b.price === '' || b.price == null ? 1e12 : Number(b.price)),
      high: (a, b) => (b.price === '' || b.price == null ? -1 : Number(b.price)) - (a.price === '' || a.price == null ? -1 : Number(a.price)),
      name: (a, b) => String(a.text).localeCompare(String(b.text)),
      status: (a, b) => st(a) - st(b),
      new: (a, b) => (b.created || 0) - (a.created || 0),
    }[this.sort] || (() => 0);
    return items.slice().sort(by);
  }

  filterBar(l, total) {
    if (total < 2 && !this.range) return null;
    const sort = select(SORTS, this.sort, { class: 'fam-input fam-gift-sort', 'aria-label': 'Sort the gifts', onchange: (e) => { this.sort = e.target.value; this.view.render(this.view.el); } });
    return h('div', { class: 'fam-gift-filters' },
      PRICE_RANGES.map(([v, label]) => h('button', { type: 'button', class: `fam-chip ${this.range === v ? 'on' : ''}`, onclick: () => { this.range = v; this.view.render(this.view.el); } }, label)),
      sort);
  }

  addRow(l, { mine }) {
    const entry = input({ class: 'fam-input fam-list-entry fam-gift-entry', placeholder: 'Or type one and press Enter, or paste a store link', maxlength: 2000, enterkeyhint: 'enter', autocomplete: 'off', 'aria-label': 'Quick add' });
    // Enter adds what's typed straight away; Add Gift Idea opens the gift's screen (with it).
    const add = async () => {
      const text = entry.value.trim();
      if (!text) { entry.focus(); return; }
      entry.value = '';
      const link = urlIn(text);
      if (link) await this.addFromLink(l, link, text.replace(link, '').trim());
      else await this.addGift(l, { text });
      this.view.el?.querySelector('.fam-gift-entry')?.focus();
    };
    const open = () => {
      const typed = entry.value.trim();
      const link = urlIn(typed);
      entry.value = '';
      this.newGift(l, { text: link ? cleanShareText(typed.replace(link, '')) : typed, url: link || '' });
    };
    entry.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    // A pasted store link opens the gift's screen and reads the store's page.
    entry.addEventListener('paste', (e) => {
      const t = e.clipboardData.getData('text');
      if (urlIn(t) && !entry.value.trim()) { e.preventDefault(); entry.value = t.trim(); open(); }
    });
    return h('div', { class: 'fam-gift-addbox' },
      h('div', { class: 'fam-list-add fam-gift-add' }, h('button', { class: 'fam-btn primary fam-gift-new', onclick: open }, h('span', { html: ICONS.plus }), mine ? 'Add to My Wish List' : 'Add Gift Idea'), h('div', { class: 'fam-list-entry-wrap' }, entry)),
      h('button', { type: 'button', class: 'fam-gift-howto', onclick: () => this.browserButton() }, '🛍️ Shopping on Amazon, Walmart or Best Buy? Add gifts straight from the store’s page'));
  }

  // A new gift's screen, filled in with what's known; a store link is read straight away.
  async newGift(l, fields = {}) {
    const i = { list: l.id, text: '', ...fields };
    const auto = Boolean(i.url) && !i.image && i.price == null;
    if (auto) setTimeout(() => [...this.app.root.querySelectorAll('.fam-sheet .fam-btn')].find((b) => b.textContent === 'Fill in from the link')?.click(), 50);
    return this.editGift(i, l);
  }

  // A gift on the list; a heads-up if they've had it before.
  async addGift(l, fields, { open = false } = {}) {
    const text = String(fields.text || '').trim().slice(0, 300);
    if (!text) return null;
    const before = this.history(l).find((i) => cleanName(i.text) === cleanName(text));
    if (before && !this.isRecipient(l)) toast(`Heads up: ${this.who(l).name || 'they'} got “${before.text}”${before.givenYear ? ` in ${before.givenYear}` : ''}`, { timeout: 6000 });
    const item = { id: newId(), list: l.id, text, done: false, status: 'idea', order: Date.now(), ...fields, text };
    for (const k of Object.keys(item)) if (item[k] === null || item[k] === '') delete item[k];
    try {
      const [saved] = await this.store.batch([{ op: 'put', col: 'listitems', item }]);
      if (open && saved && !saved.deleted) this.editGift(saved, l);
      return saved;
    } catch (err) { toastError(err, 'Couldn’t add that'); return null; }
  }

  // A store link: its name, picture and price are read from the store's page where it allows it.
  // A store link: the gift's screen opens and reads the store's page (where the store allows it).
  addFromLink(l, link, name = '') { return this.newGift(l, { text: cleanShareText(name), url: link }); }

  row(i, l, { mine, hide }) {
    const st = STATUS.find((s) => s[0] === (i.status || 'idea')) || STATUS[0];
    const fields = (l.fields || []).map((f) => (i.values?.[f.id] ? h('small', { class: 'fam-gift-field' }, `${f.label}: ${i.values[f.id]}`) : null));
    const chipped = i.group ? (i.chips || []).reduce((t, c) => t + (Number(c.amount) || 0), 0) : 0;
    return h('div', { class: `fam-item fam-gift ${i.status === 'given' && !mine && !hide ? 'done' : ''} ${i.mostWanted ? 'wanted' : ''}`, style: { '--c': l.color || '#d6336c' } },
      i.image ? h('img', { class: 'fam-gift-pic', src: this.store.imageUrl(i.image), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : h('span', { class: 'fam-gift-pic none' }, i.secret === 'santa' ? '🎅' : i.secret === 'stocking' ? '🧦' : '🎁'),
      h('button', { class: 'fam-item-text', onclick: () => this.editGift(i, l) },
        h('span', {}, i.mostWanted ? h('b', { class: 'fam-gift-want', title: 'Most wanted' }, '♥ ') : null, i.text),
        i.price != null && i.price !== '' ? h('small', { class: 'fam-gift-price' }, this.money(i.price)) : null,
        i.stars ? h('small', { class: 'fam-gift-stars', title: `${i.stars} of 3 stars` }, '★'.repeat(i.stars)) : null,
        ...fields,
        i.secret && !hide ? h('small', { class: 'fam-gift-secret' }, i.secret === 'santa' ? '🎅 From Santa' : '🧦 Stocking') : null,
        !mine && !hide && l.recipient && i.addedBy === l.recipient ? h('small', { class: 'fam-gift-wish', title: 'They added this to their own wish list' }, '⭐ On their wish list') : null,
        i.group && !hide && !mine ? h('small', { class: 'fam-gift-group' }, `👥 ${this.money(chipped)}${i.price ? ` of ${this.money(i.price)}` : ''} chipped in`) : null,
        i.notes ? h('small', {}, i.notes) : null,
        i.url ? h('a', { class: 'fam-gift-link', href: i.url, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, `${i.store || 'Store'} ↗`) : null),
      !mine && !hide ? h('button', { class: `fam-gift-status s-${st[0]}`, title: `${st[2]} — tap for the next step`, 'aria-label': `Status: ${st[2]}. Change`, onclick: () => this.nextStatus(i, l) }, h('span', {}, st[1]), h('span', { class: 'fam-hide-sm' }, st[2])) : null,
      !mine && !hide ? this.claimButton(i, l) : null,
      this.canEdit(l) || (mine && i.addedBy === this.me) ? h('button', { class: 'fam-item-remove', title: 'Remove', 'aria-label': `Remove ${i.text}`, html: ICONS.close, onclick: () => this.view.removeItem(i) }) : null);
  }

  claimButton(i, l) {
    if (i.claimedBy) {
      const m = this.store.member(i.claimedBy);
      const yours = i.claimedBy === this.me;
      return h('button', { class: `fam-gift-claim taken ${yours ? 'yours' : ''}`, title: yours ? 'You’re getting this (tap to give it back)' : `${m?.name || 'Someone'} is getting this`, disabled: !yours && !this.viewer.parent, onclick: () => this.unclaim(i) },
        m ? avatar(m, 'xs') : null, h('span', {}, yours ? 'You' : m?.name || 'Taken'));
    }
    if (i.claimedName) return h('button', { class: 'fam-gift-claim taken link', title: `${i.claimedName} is getting this (from the share link)`, disabled: !this.viewer.parent, onclick: () => this.unclaim(i) }, h('span', {}, `🔗 ${i.claimedName}`));
    if (!this.canClaim(l)) return null;
    return h('button', { class: 'fam-gift-claim', title: 'So nobody else buys it too', onclick: () => this.claim(i, l) }, 'I’ll get it');
  }

  async claim(i, l) {
    let who = this.me;
    if (!who) {
      // A shared screen: who's getting it?
      const pick = memberPicker(this.store.members().filter((m) => m.id !== l.recipient), [], { single: true });
      who = await sheet(this.app.root, {
        title: `Who’s getting “${i.text}”?`, body: h('div', { class: 'fam-form' }, pick),
        actions: [{ label: 'Cancel' }, { label: 'That’s me', primary: true, submit: true, onClick: (close) => { const v = pick.value()[0]; if (!v) return toast('Pick who’s getting it', { timeout: 2000 }); close(v); } }],
      });
      if (!who) return;
    }
    try {
      await this.store.put('listitems', { ...i, claimedBy: who, claimedAt: Date.now() });
      toast(`${who === this.me ? 'You’re' : `${this.store.member(who)?.name || 'They’re'} is`} getting “${i.text}”`, { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.put('listitems', { ...i }).catch((e) => toastError(e)) } });
    } catch (err) { toastError(err); }
  }

  async unclaim(i) {
    const back = { ...i, claimedBy: null, claimedName: null, claimedAt: null, claimKey: undefined, status: i.status === 'given' ? 'given' : 'idea' };
    try {
      await this.store.put('listitems', back);
      toast(`“${i.text}” is up for grabs again`, { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.put('listitems', { ...i }).catch((e) => toastError(e)) } });
    } catch (err) { toastError(err); }
  }

  // Idea → bought → wrapped → given (and round again). Buying it claims it for you.
  async nextStatus(i, l) {
    const n = STATUS.findIndex((s) => s[0] === (i.status || 'idea'));
    const next = STATUS[(n + 1) % STATUS.length][0];
    const patch = { status: next, done: next === 'given', doneAt: next === 'given' ? Date.now() : null };
    if (next === 'given') patch.givenYear = this.cycleYear(l);
    if (next === 'idea') patch.givenYear = null;
    if (next === 'bought' && !i.claimedBy && !i.claimedName && this.me && this.canClaim(l)) patch.claimedBy = this.me;
    try { await this.store.put('listitems', { ...i, ...patch }); } catch (err) { toastError(err); }
  }

  // A gift's screen; a new one (no id yet) for "Add Gift Idea", the browser button and sharing.
  async editGift(i, l) {
    const isNew = !i.id;
    const mine = this.isRecipient(l);
    const buyer = !mine && !this.hidden;
    const text = input({ value: i.text || '', required: true, autofocus: !i.url || Boolean(i.text), maxlength: 300, placeholder: 'What’s the gift?' });
    // When a store won't show its page to the server: how to bring the price and picture anyway.
    const blockedHint = h('div', { class: 'fam-gift-blocked', hidden: true });
    const url = input({ type: 'url', value: i.url || '', placeholder: 'https://…', maxlength: 2000 });
    const price = input({ value: i.price ?? '', inputmode: 'decimal', placeholder: '0.00', maxlength: 12 });
    let image = i.image || null;
    const pic = h('div', { class: 'fam-gift-pic-edit' });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try { image = await this.store.uploadRecipeImage(f); drawPic(); } catch (err) { toastError(err, 'Couldn’t add that picture'); }
    } });
    const drawPic = () => clear(pic, image ? h('img', { src: this.store.imageUrl(image), alt: '' }) : h('span', { class: 'fam-gift-pic none' }, '🎁'),
      h('button', { type: 'button', class: 'fam-btn small', onclick: () => file.click() }, image ? 'Change picture' : 'Add a picture'),
      image ? h('button', { type: 'button', class: 'fam-btn small', onclick: () => { image = null; drawPic(); } }, 'Remove') : null, file);
    drawPic();
    const fill = h('button', { type: 'button', class: 'fam-btn small', onclick: async () => {
      if (!url.value.trim()) return url.focus();
      fill.disabled = true;
      fill.textContent = 'Reading…';
      try {
        const p = await this.store.giftPreview(url.value.trim());
        if (p.title && (!text.value.trim() || text.value === i.text)) text.value = p.title;
        if (p.price != null) price.value = p.price;
        if (p.image) { image = p.image; drawPic(); }
        if (p.blocked) {
          clear(blockedHint, h('span', {}, p.note), h('button', { type: 'button', class: 'fam-btn small', onclick: () => this.browserButton() }, 'Get the 🎁 Add to gift list button'));
          blockedHint.hidden = false;
        } else if (p.note) toast(p.note, { timeout: 4000 });
      } catch (err) { toastError(err, 'Couldn’t read that link'); }
      fill.disabled = false;
      fill.textContent = 'Fill in from the link';
    } }, 'Fill in from the link');
    const stars = select([['0', 'No stars'], ['1', '★'], ['2', '★★'], ['3', '★★★']], String(i.stars || 0));
    let wanted = Boolean(i.mostWanted);
    const wantedBox = toggle('♥ Most wanted', wanted, (v) => { wanted = v; });
    const values = { ...(i.values || {}) };
    const custom = (l.fields || []).map((f) => field(f.label, input({ value: values[f.id] ?? '', type: f.type === 'number' ? 'number' : f.type === 'link' ? 'url' : 'text', maxlength: 200, oninput: (e) => { values[f.id] = e.target.value; } })));
    const notes = input({ value: i.notes || '', placeholder: 'Size, colour, where to find it…', maxlength: 300 });
    // For whoever's buying.
    const status = select(STATUS.map(([v, e, label]) => [v, `${e} ${label}`]), i.status || 'idea');
    const people = this.store.members().filter((m) => m.id !== l.recipient);
    const claimer = select([['', 'Nobody yet'], ...people.map((m) => [m.id, m.name]), ...(i.claimedName ? [['__link', `${i.claimedName} (share link)`]] : [])], i.claimedBy || (i.claimedName ? '__link' : ''));
    const secret = select(SECRETS, i.secret || '');
    let group = Boolean(i.group);
    let chips = (i.chips || []).map((c) => ({ ...c }));
    const chipsEl = h('div', { class: 'fam-gift-chips' });
    const drawChips = () => {
      const total = chips.reduce((t, c) => t + (Number(c.amount) || 0), 0);
      clear(chipsEl, chips.map((c, n) => h('div', { class: 'fam-gift-line fam-gift-chip-row' },
        select([['', 'Someone else'], ...people.map((m) => [m.id, m.name])], c.who || '', { onchange: (e) => { c.who = e.target.value || null; drawChips(); } }),
        c.who ? null : input({ value: c.name || '', placeholder: 'Name', maxlength: 60, oninput: (e) => { c.name = e.target.value; } }),
        input({ value: c.amount ?? '', inputmode: 'decimal', placeholder: 'Amount', maxlength: 12, class: 'fam-input fam-gift-price-in', oninput: (e) => { c.amount = parsePrice(e.target.value); totalEl.textContent = summary(); } }),
        toggle('Paid', c.paid, (v) => { c.paid = v; }),
        h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove', html: ICONS.close, onclick: () => { chips.splice(n, 1); drawChips(); } }))),
      h('button', { type: 'button', class: 'fam-btn small', onclick: () => { chips.push({ who: this.me && this.me !== l.recipient ? this.me : null, amount: null }); drawChips(); } }, '+ Someone chipping in'),
      totalEl);
      totalEl.textContent = summary(total);
    };
    const summary = () => {
      const t = chips.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const goal = parsePrice(price.value);
      return `${this.money(t) || '$0'} chipped in${goal ? ` of ${this.money(goal)} (${this.money(Math.max(0, goal - t)) || '$0'} to go)` : ''}`;
    };
    const totalEl = h('div', { class: 'fam-muted small' });
    const groupWrap = h('div', { class: 'fam-form', hidden: !group }, chipsEl);
    const groupBox = toggle('👥 Group gift — several people chip in', group, (v) => { group = v; groupWrap.hidden = !v; if (v && !chips.length) chips.push({ who: this.me && this.me !== l.recipient ? this.me : null, amount: null }); drawChips(); });
    drawChips();
    const editable = this.canEdit(l) || (mine && i.addedBy === this.me);
    const out = await sheet(this.app.root, {
      title: isNew ? (mine ? 'Add to my wish list' : 'Add Gift Idea') : mine ? 'On my wish list' : 'Gift', wide: true,
      body: h('div', { class: 'fam-form' }, field('Gift', text),
        h('div', { class: 'fam-row-wrap' }, field('Store link', url, 'Paste a link from the store, then Fill in.'), h('div', { class: 'fam-field' }, h('span', { class: 'fam-label' }, ' '), fill)),
        blockedHint,
        h('div', { class: 'fam-row-wrap' }, field('Price', price), field('Priority', stars), h('div', { class: 'fam-field' }, h('span', { class: 'fam-label' }, ' '), wantedBox)),
        pic, custom.length ? h('div', { class: 'fam-row-wrap' }, custom) : null, field('Notes', notes),
        buyer ? h('div', { class: 'fam-gift-buyer' },
          h('div', { class: 'fam-label' }, l.recipient ? `Only buyers see this — ${this.who(l).name} doesn’t` : 'For whoever’s buying'),
          h('div', { class: 'fam-row-wrap' }, field('Status', status), this.canClaim(l) || this.viewer.parent ? field('Who’s getting it', claimer) : null,
            l.kind === 'christmas' && this.viewer.parent ? field('Santa or stocking?', secret, 'Hidden from the kids') : null),
          groupBox, groupWrap) : null),
      actions: [editable && !isNew ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: isNew ? 'Add to the list' : 'Save', primary: true, submit: true, onClick: (close) => {
        if (!text.value.trim()) return text.focus();
        const next = { ...i, text: text.value.trim().slice(0, 300), url: url.value.trim() || null, store: url.value.trim() ? storeLabel(url.value.trim()) : null, price: parsePrice(price.value), image, stars: Number(stars.value) || 0, mostWanted: wanted, values, notes: notes.value.trim() };
        if (buyer) {
          next.status = status.value;
          next.done = status.value === 'given';
          if (status.value === 'given' && i.status !== 'given') next.givenYear = this.cycleYear(l);
          if (status.value !== 'given') next.givenYear = null;
          if (claimer.value !== '__link') { next.claimedBy = claimer.value || null; if (claimer.value || !i.claimedName) next.claimedName = null; }
          if (l.kind === 'christmas' && this.viewer.parent) next.secret = secret.value || null;
          next.group = group;
          next.chips = group ? chips.filter((c) => c.who || String(c.name || '').trim() || c.amount).map((c) => ({ who: c.who || null, name: c.who ? undefined : String(c.name || '').trim().slice(0, 60), amount: c.amount ?? null, paid: Boolean(c.paid) })) : [];
        }
        close(next);
      } }],
    });
    if (!out) return;
    if (isNew) return this.addGift(l, out);
    try {
      if (out === 'delete') await this.view.removeItem(i);
      else await this.store.put('listitems', out);
    } catch (err) { toastError(err); }
  }

  // --- Sizes & favourites, and the pinboard ----------------------------------------------

  aboutPanel(l) {
    const a = l.about || {};
    const sizes = sizeList(a);
    const has = sizes.length || a.sizes || a.favorites || a.dislikes;
    const mine = this.isRecipient(l);
    if (!has && !this.canEdit(l) && !mine) return null;
    const { name } = this.who(l);
    return h('details', { class: 'fam-gift-panel', open: has && !this.app.subMq?.matches ? true : null },
      h('summary', {}, `👕 Sizes & favorites${name && !mine ? ` · ${name}` : ''}`, has ? null : h('small', { class: 'fam-muted' }, ' — nothing yet')),
      has ? h('dl', { class: 'fam-gift-about' },
        sizes.length ? [h('dt', {}, 'Sizes'), h('dd', { class: 'fam-gift-sizes' }, sizes.map((x) => h('span', { class: 'fam-gift-chip' }, `${x.kind}: `, h('b', {}, x.value))))] : null,
        a.sizes ? [h('dt', {}, sizes.length ? 'Size notes' : 'Sizes'), h('dd', {}, a.sizes)] : null,
        a.favorites ? [h('dt', {}, 'Loves'), h('dd', {}, a.favorites)] : null,
        a.dislikes ? [h('dt', {}, 'Not a fan of'), h('dd', {}, a.dislikes)] : null) : null,
      h('button', { class: 'fam-btn small', onclick: () => this.editAbout(l) }, has ? 'Change' : 'Add sizes and favorites'));
  }

  // Sizes are picked from drop-downs: what it's for (the ten most asked-for, or one of your own)
  // and the size (the usual ones for it, or one of your own).
  async editAbout(l) {
    const a = l.about || {};
    const rows = sizeList(a).map((x) => ({ ...x }));
    if (!rows.length) rows.push({ kind: SIZE_KINDS[0][0], value: '' });
    const list = h('div', { class: 'fam-form fam-gift-size-rows' });
    const other = (sel, onText, placeholder, value) => {
      const box = input({ value, placeholder, maxlength: 40, hidden: true, class: 'fam-input fam-gift-size-other', oninput: (e) => onText(e.target.value) });
      const sync = () => { box.hidden = sel.value !== '__other'; if (!box.hidden) box.focus(); };
      sel.addEventListener('change', sync);
      return { box, show: () => { box.hidden = sel.value !== '__other'; } };
    };
    const draw = () => clear(list, rows.map((r, n) => {
      const known = SIZE_KINDS.some(([k]) => k === r.kind);
      const kind = h('select', { class: 'fam-input', 'aria-label': 'What the size is for' },
        SIZE_KINDS.map(([k]) => h('option', { value: k }, k)), h('option', { value: '__other' }, 'Something else…'));
      kind.value = known ? r.kind : '__other';
      const kindOther = other(kind, (v) => { r.kind = v; }, 'e.g. Ring, Hat, Gloves', known ? '' : r.kind);
      kindOther.show();
      kind.addEventListener('change', () => { if (kind.value !== '__other') { r.kind = kind.value; draw(); } else r.kind = kindOther.box.value; });
      const groups = sizeChoices(r.kind);
      const all = groups.flatMap(([, vs]) => vs);
      const size = h('select', { class: 'fam-input', 'aria-label': 'Size' }, h('option', { value: '' }, 'Pick a size'),
        groups.map(([g, vs]) => h('optgroup', { label: g }, vs.map((v) => h('option', { value: v }, v)))), h('option', { value: '__other' }, 'Another size…'));
      size.value = !r.value ? '' : all.includes(r.value) ? r.value : '__other';
      const sizeOther = other(size, (v) => { r.value = v; }, 'Type the size', all.includes(r.value) ? '' : r.value || '');
      sizeOther.show();
      size.addEventListener('change', () => { r.value = size.value === '__other' ? sizeOther.box.value : size.value; });
      return h('div', { class: 'fam-gift-line fam-gift-size-row' }, kind, kindOther.box, size, sizeOther.box,
        h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove this size', html: ICONS.close, onclick: () => { rows.splice(n, 1); draw(); } }));
    }), h('button', { type: 'button', class: 'fam-btn small', onclick: () => { const used = new Set(rows.map((r) => r.kind)); rows.push({ kind: (SIZE_KINDS.find(([k]) => !used.has(k)) || SIZE_KINDS[0])[0], value: '' }); draw(); } }, '+ Add a size'));
    draw();
    const notes = h('textarea', { class: 'fam-input', rows: 2, maxlength: 400, placeholder: 'Anything else: runs small, prefers loose fit, ring size 7…' }, a.sizes || '');
    const fav = h('textarea', { class: 'fam-input', rows: 3, maxlength: 600, placeholder: 'Colours, hobbies, favourite characters, books they’ve read…' }, a.favorites || '');
    const dis = h('textarea', { class: 'fam-input', rows: 2, maxlength: 400, placeholder: 'Allergies, things they already have…' }, a.dislikes || '');
    const out = await sheet(this.app.root, {
      title: `Sizes & favorites${this.who(l).name ? ` — ${this.who(l).name}` : ''}`, wide: true,
      body: h('div', { class: 'fam-form' }, field('Sizes', list), field('Size notes', notes), field('Favorites', fav), field('Not a fan of / already has', dis), h('p', { class: 'fam-muted small' }, 'Kept with every list for this person, so it’s there next time too.')),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({
        sizeList: rows.map((r) => ({ kind: String(r.kind || '').trim().slice(0, 40), value: String(r.value || '').trim().slice(0, 40) })).filter((r) => r.kind && r.value),
        sizes: notes.value.trim(), favorites: fav.value.trim(), dislikes: dis.value.trim(),
      }) }],
    });
    if (!out) return;
    // The same person's other lists get it too.
    const key = this.recipientKey(l);
    const ops = this.store.all('lists').filter((x) => x.id === l.id || (key && isGift(x) && this.recipientKey(x) === key && this.canEdit(x))).map((x) => ({ op: 'put', col: 'lists', item: { ...x, about: out } }));
    try { await this.store.batch(ops); } catch (err) { toastError(err); }
  }

  boardPanel(l) {
    const b = l.board || {};
    const has = b.notes || (b.links || []).length || (b.photos || []).length;
    if (!has && !this.canEdit(l)) return null;
    return h('details', { class: 'fam-gift-panel' },
      h('summary', {}, '📌 Pinned photos, links & notes', has ? h('small', { class: 'fam-muted' }, ` · ${[(b.photos || []).length && plural(b.photos.length, 'photo'), (b.links || []).length && plural(b.links.length, 'link'), b.notes && 'notes'].filter(Boolean).join(', ')}`) : null),
      (b.photos || []).length ? h('div', { class: 'fam-gift-photos' }, b.photos.map((p) => h('a', { href: this.store.imageUrl(p), target: '_blank', rel: 'noopener' }, h('img', { src: this.store.imageUrl(p), alt: '', loading: 'lazy' })))) : null,
      (b.links || []).length ? h('ul', { class: 'fam-gift-links' }, b.links.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title || x.url)))) : null,
      b.notes ? h('div', { class: 'fam-gift-notes' }, b.notes) : null,
      this.canEdit(l) ? h('button', { class: 'fam-btn small', onclick: () => this.editBoard(l) }, has ? 'Change' : 'Pin something') : null);
  }

  async editBoard(l) {
    const b = l.board || {};
    const notes = h('textarea', { class: 'fam-input', rows: 4, maxlength: 4000, placeholder: 'Registry numbers, the party’s dress code, gift receipts kept in the desk drawer…' }, b.notes || '');
    let links = (b.links || []).map((x) => ({ ...x }));
    let photos = [...(b.photos || [])];
    const linksEl = h('div', { class: 'fam-form' });
    const drawLinks = () => clear(linksEl, links.map((x, n) => h('div', { class: 'fam-gift-line' },
      input({ value: x.title || '', placeholder: 'Name', maxlength: 80, oninput: (e) => { x.title = e.target.value; } }),
      input({ type: 'url', value: x.url || '', placeholder: 'https://…', maxlength: 2000, oninput: (e) => { x.url = e.target.value; } }),
      h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove', html: ICONS.close, onclick: () => { links.splice(n, 1); drawLinks(); } }))),
    h('button', { type: 'button', class: 'fam-btn small', onclick: () => { links.push({ title: '', url: '' }); drawLinks(); } }, '+ Link'));
    drawLinks();
    const photosEl = h('div', { class: 'fam-gift-photos edit' });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
      for (const f of file.files) { try { photos.push(await this.store.uploadRecipeImage(f)); } catch (err) { toastError(err, 'Couldn’t add that picture'); } }
      file.value = '';
      drawPhotos();
    } });
    const drawPhotos = () => clear(photosEl, photos.map((p, n) => h('div', { class: 'fam-gift-photo' }, h('img', { src: this.store.imageUrl(p), alt: '' }),
      h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove the photo', html: ICONS.close, onclick: () => { photos.splice(n, 1); drawPhotos(); } }))),
    h('button', { type: 'button', class: 'fam-btn small', onclick: () => file.click() }, '+ Photos'), file);
    drawPhotos();
    const out = await sheet(this.app.root, {
      title: 'Pinned to this list', wide: true,
      body: h('div', { class: 'fam-form' }, field('Photos', photosEl), field('Links', linksEl), field('Notes', notes)),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({ notes: notes.value.trim(), photos, links: links.filter((x) => /^https?:\/\//i.test(String(x.url || '').trim())).map((x) => ({ title: String(x.title || '').trim().slice(0, 80), url: x.url.trim() })) }) }],
    });
    if (!out) return;
    try { await this.store.put('lists', { ...l, board: out }); } catch (err) { toastError(err); }
  }

  // --- Christmas: shipping cutoffs, the yearly folder and the card list ---------------------

  shipping(year) {
    const own = this.store.settings.giftShipping?.[year];
    return Array.isArray(own) ? own : defaultShipping(year);
  }

  shippingStrip(l) {
    const today = todayYmd();
    const soon = this.shipping(l.year || new Date().getFullYear()).filter((s) => s.date >= today).slice(0, 3);
    if (!soon.length) return null;
    return h('div', { class: 'fam-gift-ship' }, h('span', { class: 'fam-muted' }, '📦 Last days to ship:'),
      soon.map((s) => {
        const n = dayDiff(new Date(), parseYmd(s.date));
        return h('span', { class: `fam-gift-chip ${n <= 3 ? 'urgent' : ''}` }, `${s.label} · ${fmtDate(parseYmd(s.date), { month: 'short', day: 'numeric' })}${n === 0 ? ' (today)' : n === 1 ? ' (tomorrow)' : n <= 10 ? ` (${n} days)` : ''}`);
      }));
  }

  folderLists(folder) { return this.view.lists().filter((l) => (l.kind === 'christmas' || l.kind === 'cards') && (l.folder || `Christmas ${l.year}`) === folder && !l.archived); }

  drawFolder(main, folder) {
    const lists = this.folderLists(folder);
    const year = Number(/\d{4}/.exec(folder)?.[0]) || new Date().getFullYear();
    const people = lists.filter((l) => l.kind === 'christmas');
    const cards = lists.find((l) => l.kind === 'cards');
    const days = dayDiff(new Date(), parseYmd(`${year}-12-25`));
    const hide = this.hidden;
    const budget = people.reduce((s, l) => s + (Number(l.budget) || 0), 0);
    const spent = hide ? 0 : people.filter((l) => !this.isRecipient(l)).reduce((s, l) => s + this.spent(l), 0);
    const missing = this.store.members().filter((m) => !people.some((l) => l.recipient === m.id));
    const cardItems = cards ? this.view.items(cards.id) : [];
    clear(main,
      h('div', { class: 'fam-toolbar fam-gift-head', style: { '--c': '#2f9e44' } },
        h('div', { class: 'fam-toolbar-title' }, h('span', {}, '🎄'), ' ', folder),
        days >= 0 ? h('span', { class: 'fam-gift-chip count' }, days === 0 ? 'It’s Christmas!' : `${plural(days, 'day')} to Christmas`) : h('span', { class: 'fam-gift-chip' }, 'Done for the year'),
        !hide && budget ? h('span', { class: `fam-gift-budget ${spent > budget ? 'over' : ''}` }, h('span', {}, `${this.money(spent)} of ${this.money(budget)} in all`), h('span', { class: 'fam-gift-bar' }, h('i', { style: { width: `${Math.min(100, Math.round((spent / budget) * 100))}%` } }))) : null,
        h('div', { class: 'fam-spacer' }),
        h('button', { class: 'fam-btn', onclick: () => this.copyFolder(folder, year) }, `Start ${year + 1} from this`)),
      hide ? this.banner({ kind: 'christmas' }, { hide: true }) : null,
      this.shippingStrip({ year }),
      h('div', { class: 'fam-gift-people' },
        people.map((l) => {
          const { member, name } = this.who(l);
          const all = this.gifts(l);
          const got = all.filter(taken).length;
          const mine = this.isRecipient(l);
          return h('button', { class: 'fam-gift-person', style: { '--c': member?.color || l.color || '#2f9e44' }, onclick: () => this.view.open(l.id) },
            member ? avatar(member, 'md') : h('span', { class: 'fam-avatar md', style: { '--c': l.color || '#2f9e44' } }, (name || '?').slice(0, 1).toUpperCase()),
            h('b', {}, l.title || name),
            mine ? h('small', {}, 'Your wish list') : hide ? h('small', {}, plural(all.length, 'gift')) : h('small', {}, `${plural(all.length, 'gift')} · ${got} got`),
            !mine && !hide && Number(l.budget) > 0 ? h('span', { class: 'fam-gift-bar' }, h('i', { style: { width: `${Math.min(100, Math.round((this.spent(l) / Number(l.budget)) * 100))}%` } })) : null,
            !mine && !hide && Number(l.budget) > 0 ? h('small', {}, `${this.money(this.spent(l))} of ${this.money(l.budget)}`) : null);
        }),
        h('button', { class: 'fam-gift-person add', onclick: () => this.editList(null, 'christmas', { year }) }, h('span', { html: ICONS.plus }), h('b', {}, 'Add someone')),
        missing.length && this.viewer.parent ? h('button', { class: 'fam-gift-person add', onclick: () => this.listsForEveryone(year, missing) }, h('span', {}, '👨‍👩‍👧‍👦'), h('b', {}, `A list for ${missing.length === 1 ? missing[0].name : `everyone (${missing.length})`}`)) : null),
      h('div', { class: 'fam-gift-row' },
        cards ? h('button', { class: 'fam-btn', onclick: () => this.view.open(cards.id) }, `💌 Christmas cards · ${cardItems.filter((i) => i.done).length} of ${cardItems.length} sent`)
          : h('button', { class: 'fam-btn', onclick: () => this.makeCards(year) }, '💌 Keep track of Christmas cards'),
        h('button', { class: 'fam-btn', onclick: () => this.editShipping(year) }, '📦 Shipping dates')));
  }

  async listsForEveryone(year, members) {
    const prev = (m) => this.view.lists().filter((l) => l.kind === 'christmas' && l.recipient === m.id).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    const ops = members.map((m, n) => ({ op: 'put', col: 'lists', item: { id: newId(), kind: 'christmas', title: christmasName(m.name, year), emoji: '🎄', color: m.color || '#2f9e44', recipient: m.id, year, folder: `Christmas ${year}`, reminders: [14], order: Date.now() + n, about: prev(m)?.about, budget: prev(m)?.budget } }));
    try { await this.store.batch(ops); toast(`Made ${plural(ops.length, 'list')} for Christmas ${year}`, { type: 'success', timeout: 3000 }); } catch (err) { toastError(err); }
  }

  async makeCards(year, from = null) {
    const l = { id: newId(), kind: 'cards', title: 'Christmas cards', emoji: '💌', color: '#c2255c', year, folder: `Christmas ${year}`, order: Date.now() };
    const ops = [{ op: 'put', col: 'lists', item: l }];
    const last = from || this.view.lists().filter((x) => x.kind === 'cards' && (x.year || 0) < year).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    if (last) this.view.items(last.id).forEach((i, n) => ops.push({ op: 'put', col: 'listitems', item: { id: newId(), list: l.id, text: i.text, notes: i.notes || undefined, done: false, order: Date.now() + n } }));
    try {
      await this.store.batch(ops);
      if (last && ops.length > 1) toast(`Copied ${plural(ops.length - 1, 'name')} from ${last.year}`, { timeout: 3000 });
      this.view.open(l.id);
    } catch (err) { toastError(err); }
  }

  // Next year's folder, from this one: the same people, budgets, sizes and the gift ideas nobody
  // got to (what was given stays in the history); the card list's names, not yet sent.
  async copyFolder(folder, year) {
    const next = year + 1;
    const nextFolder = `Christmas ${next}`;
    const there = this.folderLists(nextFolder);
    const lists = this.folderLists(folder).filter((l) => !there.some((t) => t.kind === l.kind && this.recipientKey(t) === this.recipientKey(l)));
    if (!lists.length) { toast(`${nextFolder} already has everyone`, { timeout: 2500 }); return; }
    const keep = toggle('Bring over gift ideas nobody got to', true);
    const ok = await sheet(this.app.root, {
      title: `Start ${nextFolder}`, body: h('div', { class: 'fam-form' }, h('p', {}, `Makes ${plural(lists.filter((l) => l.kind === 'christmas').length, 'list')} for ${nextFolder} with the same people, budgets and sizes${lists.some((l) => l.kind === 'cards') ? ', and the card list’s names' : ''}. Gifts given this year stay in each person’s history.`), keep),
      actions: [{ label: 'Cancel' }, { label: 'Start it', primary: true, value: true }],
    });
    if (!ok) return;
    const carry = keep.querySelector('input').checked;
    const ops = [];
    let first = null;
    for (const l of lists) {
      const copy = { ...l, id: newId(), year: next, folder: nextFolder, order: Date.now() + ops.length, archived: false, title: this.nextYearTitle(l, next) };
      delete copy.shareToken; delete copy.created; delete copy.updated;
      first ||= copy.id;
      ops.push({ op: 'put', col: 'lists', item: copy });
      for (const i of this.view.items(l.id)) {
        if (l.kind === 'cards') { ops.push({ op: 'put', col: 'listitems', item: { id: newId(), list: copy.id, text: i.text, notes: i.notes || undefined, done: false, order: i.order } }); continue; }
        if (!carry || !isGiftItem(i) || taken(i)) continue;
        ops.push({ op: 'put', col: 'listitems', item: resetGift(i, copy.id) });
      }
    }
    try { await this.store.batch(ops); toast(`${nextFolder} is ready`, { type: 'success', timeout: 3000 }); this.view.open(`folder:${nextFolder}`); } catch (err) { toastError(err); }
  }

  async editShipping(year) {
    let rows = this.shipping(year).map((s) => ({ ...s }));
    const body = h('div', { class: 'fam-form' });
    const draw = () => clear(body, h('p', { class: 'fam-muted small' }, 'The last days to send so gifts arrive by Christmas. These are typical US dates; carriers publish the real ones each autumn. You get a reminder two days before each, and on the day.'),
      rows.map((r, n) => h('div', { class: 'fam-gift-line' },
        input({ value: r.label, maxlength: 60, placeholder: 'Carrier or service', oninput: (e) => { r.label = e.target.value; } }),
        input({ type: 'date', value: r.date, oninput: (e) => { r.date = e.target.value; } }),
        h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove', html: ICONS.close, onclick: () => { rows.splice(n, 1); draw(); } }))),
      h('div', { class: 'fam-row-wrap' }, h('button', { type: 'button', class: 'fam-btn small', onclick: () => { rows.push({ label: '', date: `${year}-12-15` }); draw(); } }, '+ Another'),
        h('button', { type: 'button', class: 'fam-btn small', onclick: () => { rows = defaultShipping(year); draw(); } }, 'Typical dates')));
    draw();
    const out = await sheet(this.app.root, { title: `Shipping dates for ${year}`, body, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, value: true }] });
    if (!out) return;
    const all = { ...(this.store.settings.giftShipping || {}), [year]: rows.filter((r) => r.label.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).map((r) => ({ label: r.label.trim().slice(0, 60), date: r.date })).sort((a, b) => a.date.localeCompare(b.date)) };
    try { await this.store.setSettings({ giftShipping: all }); this.view.render(this.view.el); } catch (err) { toastError(err); }
  }

  drawCards(main, l) {
    const items = this.view.items(l.id);
    const sent = items.filter((i) => i.done).length;
    const got = items.filter((i) => i.received).length;
    const entry = input({ class: 'fam-input fam-list-entry', placeholder: 'Add a name (paste several, one per line)', maxlength: 2000, enterkeyhint: 'enter' });
    const add = async () => {
      const names = entry.value.split(/\n/).map((s) => s.trim()).filter(Boolean);
      if (!names.length) return entry.focus();
      entry.value = '';
      const have = new Set(items.map((i) => cleanName(i.text)));
      const ops = names.filter((n) => !have.has(cleanName(n))).map((n, k) => ({ op: 'put', col: 'listitems', item: { id: newId(), list: l.id, text: n.slice(0, 200), done: false, order: Date.now() + k } }));
      if (!ops.length) return toast('Already on the list', { timeout: 2000 });
      try { await this.store.batch(ops); } catch (err) { toastError(err); }
      this.view.el?.querySelector('.fam-list-entry')?.focus();
    };
    entry.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    entry.addEventListener('paste', (e) => { const t = e.clipboardData.getData('text'); if (t.includes('\n')) { e.preventDefault(); entry.value = t; add(); } });
    const last = this.view.lists().filter((x) => x.kind === 'cards' && x.id !== l.id && (x.year || 0) < (l.year || 0)).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    const body = h('div', { class: 'fam-list-items' }, items.map((i) => h('div', { class: `fam-item ${i.done ? 'done' : ''}`, style: { '--c': l.color || '#c2255c' } },
      h('button', { class: 'fam-item-check', 'aria-label': i.done ? 'Not sent' : 'Sent', title: 'Sent', html: ICONS.check, onclick: () => this.store.put('listitems', { ...i, done: !i.done, doneAt: i.done ? null : Date.now() }).catch((e) => toastError(e)) }),
      h('button', { class: 'fam-item-text', onclick: () => this.editCard(i) }, h('span', {}, i.text), i.notes ? h('small', {}, i.notes) : null),
      h('button', { class: `fam-gift-got ${i.received ? 'on' : ''}`, title: i.received ? 'Got one from them (tap to undo)' : 'Tap when one comes from them', 'aria-pressed': String(Boolean(i.received)), onclick: () => this.store.put('listitems', { ...i, received: !i.received }).catch((e) => toastError(e)) }, i.received ? '📬 Got theirs' : '📭'),
      h('button', { class: 'fam-item-remove', 'aria-label': `Remove ${i.text}`, html: ICONS.close, onclick: () => this.view.removeItem(i) }))));
    if (!items.length) body.append(h('div', { class: 'fam-muted fam-list-empty' }, 'Who do you send cards to?', last ? h('div', {}, h('button', { class: 'fam-btn', onclick: () => this.copyCards(l, last) }, `Copy the ${plural(this.view.items(last.id).length, 'name')} from ${last.year}`)) : null));
    clear(main,
      h('div', { class: 'fam-toolbar', style: { '--c': l.color || '#c2255c' } },
        h('div', { class: 'fam-toolbar-title' }, h('span', {}, l.emoji || '💌'), ' ', l.title, l.folder ? h('small', { class: 'fam-muted' }, ` · ${l.folder}`) : null),
        items.length ? h('span', { class: 'fam-gift-chip' }, `✉️ ${sent} of ${items.length} sent`) : null,
        items.length ? h('span', { class: 'fam-gift-chip' }, `📬 ${got} received`) : null,
        h('div', { class: 'fam-spacer' }),
        h('button', { class: 'fam-icon-btn', title: 'More', 'aria-label': 'More for this list', html: ICONS.more, onclick: () => this.moreSheet(l) })),
      h('div', { class: 'fam-list-add' }, h('div', { class: 'fam-list-entry-wrap' }, entry), h('button', { class: 'fam-btn primary', onclick: add }, 'Add')),
      body);
  }

  async copyCards(l, from) {
    const ops = this.view.items(from.id).map((i, n) => ({ op: 'put', col: 'listitems', item: { id: newId(), list: l.id, text: i.text, notes: i.notes || undefined, done: false, order: Date.now() + n } }));
    try { await this.store.batch(ops); } catch (err) { toastError(err); }
  }

  async editCard(i) {
    const text = input({ value: i.text, required: true, autofocus: true, maxlength: 200 });
    const notes = h('textarea', { class: 'fam-input', rows: 3, maxlength: 500, placeholder: 'Address, kids’ names…' }, i.notes || '');
    const out = await sheet(this.app.root, {
      title: 'Card', body: h('div', { class: 'fam-form' }, text, field('Notes', notes)),
      actions: [{ label: 'Delete', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({ ...i, text: text.value.trim() || i.text, notes: notes.value.trim() }) }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.view.removeItem(i); else await this.store.put('listitems', out); } catch (err) { toastError(err); }
  }

  // --- Birthdays: the party and thank-yous ------------------------------------------------

  party(l, { mine }) {
    const items = this.view.items(l.id);
    const p = l.party || {};
    const guests = items.filter((i) => i.part === 'guest');
    const coming = guests.filter((g) => g.rsvp === 'yes').length;
    const surprise = l.surprise && !mine;
    const details = h('div', { class: 'fam-gift-party-head' },
      h('div', {}, h('b', {}, p.date ? `🎈 ${fmtDate(parseYmd(p.date), { weekday: 'long', month: 'long', day: 'numeric' })}${p.time ? ` at ${p.time}` : ''}` : 'No party date yet'),
        p.place ? h('div', { class: 'fam-muted' }, `📍 ${p.place}`) : null,
        guests.length ? h('div', { class: 'fam-muted' }, `${plural(guests.length, 'guest')} invited · ${coming} coming${guests.filter((g) => g.rsvp === 'maybe').length ? ` · ${guests.filter((g) => g.rsvp === 'maybe').length} maybe` : ''}`) : null,
        surprise ? h('div', { class: 'fam-gift-chip' }, `🤫 Surprise party — hidden from ${this.who(l).name}`) : null),
      this.canEdit(l) ? h('button', { class: 'fam-btn', onclick: () => this.editParty(l) }, 'Party details') : null);
    const section = (part, label, placeholder) => {
      const list = items.filter((i) => i.part === part);
      const entry = input({ class: `fam-input fam-party-entry-${part}`, placeholder, maxlength: 2000, enterkeyhint: 'enter' });
      const add = async () => {
        const lines = entry.value.split(/\n|,(?=\s*\S)/).map((s) => s.trim()).filter(Boolean);
        if (!lines.length) return entry.focus();
        entry.value = '';
        const ops = lines.map((t, n) => ({ op: 'put', col: 'listitems', item: { id: newId(), list: l.id, part, text: t.slice(0, 200), done: false, order: Date.now() + n } }));
        try { await this.store.batch(ops); } catch (err) { toastError(err); }
        this.view.el?.querySelector(`.fam-party-entry-${part}`)?.focus();
      };
      entry.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      return h('section', { class: 'fam-gift-section' }, h('div', { class: 'fam-aisle' }, `${label}${list.length ? ` · ${list.length}` : ''}`),
        list.map((i) => this.partyRow(i, l)),
        this.canEdit(l) || mine ? h('div', { class: 'fam-list-add' }, h('div', { class: 'fam-list-entry-wrap' }, entry), h('button', { class: 'fam-btn', onclick: add }, 'Add')) : null);
    };
    return h('div', { class: 'fam-list-items fam-gift-party' }, details, PARTY_PARTS.map(([part, label, ph]) => section(part, label, ph)));
  }

  partyRow(i, l) {
    if (i.part === 'guest') {
      const r = RSVP.find((x) => x[0] === (i.rsvp || '')) || RSVP[0];
      const n = RSVP.indexOf(r);
      return h('div', { class: 'fam-item', style: { '--c': l.color || '#d6336c' } },
        h('button', { class: `fam-gift-rsvp r-${r[0] || 'none'}`, title: `${r[2]} — tap to change`, 'aria-label': `RSVP: ${r[2]}. Change`, onclick: () => this.store.put('listitems', { ...i, rsvp: RSVP[(n + 1) % RSVP.length][0] }).catch((e) => toastError(e)) }, r[1], h('span', { class: 'fam-hide-sm' }, ` ${r[2]}`)),
        h('button', { class: 'fam-item-text', onclick: () => this.renameItem(i) }, h('span', {}, i.text), i.notes ? h('small', {}, i.notes) : null),
        h('button', { class: 'fam-item-remove', 'aria-label': `Remove ${i.text}`, html: ICONS.close, onclick: () => this.view.removeItem(i) }));
    }
    return h('div', { class: `fam-item ${i.done ? 'done' : ''}`, style: { '--c': l.color || '#d6336c' } },
      h('button', { class: 'fam-item-check', 'aria-label': i.done ? 'Untick' : 'Tick', html: ICONS.check, onclick: () => this.store.put('listitems', { ...i, done: !i.done, doneAt: i.done ? null : Date.now() }).catch((e) => toastError(e)) }),
      h('button', { class: 'fam-item-text', onclick: () => this.renameItem(i) }, h('span', {}, i.text), i.notes ? h('small', {}, i.notes) : null),
      h('button', { class: 'fam-item-remove', 'aria-label': `Remove ${i.text}`, html: ICONS.close, onclick: () => this.view.removeItem(i) }));
  }

  async renameItem(i) {
    const text = input({ value: i.text, required: true, autofocus: true, maxlength: 200 });
    const notes = input({ value: i.notes || '', placeholder: 'Notes', maxlength: 300 });
    const out = await sheet(this.app.root, {
      title: i.part === 'guest' ? 'Guest' : i.part === 'thanks' ? 'Thank-you note' : 'Item', body: h('div', { class: 'fam-form' }, text, notes),
      actions: [{ label: 'Delete', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({ ...i, text: text.value.trim() || i.text, notes: notes.value.trim() }) }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.view.removeItem(i); else await this.store.put('listitems', out); } catch (err) { toastError(err); }
  }

  async editParty(l) {
    const p = l.party || {};
    const date = input({ type: 'date', value: p.date || this.nextDate(l) || '' });
    const time = input({ type: 'time', value: p.time || '' });
    const place = input({ value: p.place || '', placeholder: 'Home, the park, the bowling alley…', maxlength: 120 });
    let surprise = Boolean(l.surprise);
    const out = await sheet(this.app.root, {
      title: 'The party',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-row-wrap' }, field('Date', date), field('Time', time)), field('Where', place),
        l.recipient ? toggle(`Surprise party (hidden from ${this.who(l).name})`, surprise, (v) => { surprise = v; }) : null,
        h('p', { class: 'fam-muted small' }, 'Saving puts the party on the family calendar too.')),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({ date: date.value || null, time: time.value || null, place: place.value.trim() }) }],
    });
    if (!out) return;
    const ops = [];
    let eventId = p.eventId || null;
    if (out.date) {
      eventId ||= `party-${l.id}`;
      const { name, member } = this.who(l);
      const start = out.time ? new Date(`${out.date}T${out.time}`) : null;
      const prev = this.store.get('events', eventId);
      ops.push({ op: 'put', col: 'events', item: { ...(prev || {}), id: eventId, title: `${name ? `${name}’s ` : ''}birthday party 🎈`, allDay: !start, start: start ? start.toISOString() : out.date, end: start ? new Date(start.getTime() + 3 * 3600e3).toISOString() : out.date, location: out.place || '', members: member && !surprise ? [member.id] : [], private: surprise || undefined } });
    } else if (eventId && this.store.get('events', eventId)) { ops.push({ op: 'delete', col: 'events', id: eventId }); eventId = null; }
    ops.push({ op: 'put', col: 'lists', item: { ...l, party: { ...out, eventId }, surprise } });
    try { await this.store.batch(ops); } catch (err) { toastError(err); }
  }

  thanks(l) {
    const items = this.view.items(l.id);
    const list = items.filter((i) => i.part === 'thanks');
    const sent = list.filter((i) => i.done).length;
    const came = items.filter((i) => i.part === 'guest' && i.rsvp === 'yes' && !list.some((t) => cleanName(t.text).startsWith(cleanName(i.text))));
    const entry = input({ class: 'fam-input fam-thanks-entry', placeholder: 'Who to thank, and for what (Grandma — the LEGO set)', maxlength: 2000, enterkeyhint: 'enter' });
    const add = async (lines = entry.value.split(/\n/).map((s) => s.trim()).filter(Boolean)) => {
      if (!lines.length) return entry.focus();
      entry.value = '';
      try { await this.store.batch(lines.map((t, n) => ({ op: 'put', col: 'listitems', item: { id: newId(), list: l.id, part: 'thanks', text: t.slice(0, 200), done: false, order: Date.now() + n } }))); } catch (err) { toastError(err); }
      this.view.el?.querySelector('.fam-thanks-entry')?.focus();
    };
    entry.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'fam-list-items fam-gift-thanks' },
      h('div', { class: 'fam-gift-party-head' }, h('div', {}, h('b', {}, list.length ? `💌 ${sent} of ${list.length} thank-you notes sent` : '💌 Thank-you notes'), h('div', { class: 'fam-muted small' }, 'Tick each one off once it’s sent.')),
        came.length ? h('button', { class: 'fam-btn', onclick: () => add(came.map((g) => g.text)) }, `Add the ${plural(came.length, 'guest')} who came`) : null),
      list.sort((a, b) => a.done - b.done || (a.order ?? 0) - (b.order ?? 0)).map((i) => this.partyRow(i, l)),
      h('div', { class: 'fam-list-add' }, h('div', { class: 'fam-list-entry-wrap' }, entry), h('button', { class: 'fam-btn primary', onclick: () => add() }, 'Add')));
  }

  // --- Sharing, copying and archiving ------------------------------------------------------

  shareUrl(l) { return l.shareToken ? `${location.origin}/gifts/${l.shareToken}` : ''; }

  async shareSheet(l) {
    const body = h('div', { class: 'fam-form' });
    let cur = l;
    const draw = () => {
      const url = this.shareUrl(cur);
      clear(body,
        h('p', { class: 'fam-muted' }, 'Anyone with the link can see this list and mark a gift as taken, with their name — no account needed. They don’t see Santa or stocking gifts, party plans or who in the family is getting what.'),
        url ? [
          h('div', { class: 'fam-row-wrap' }, input({ value: url, readonly: true, class: 'fam-input fam-gift-share-url', onfocus: (e) => e.target.select() }),
            h('button', { type: 'button', class: 'fam-btn primary', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied', { timeout: 2000 }); } catch { body.querySelector('.fam-gift-share-url')?.select(); } } }, 'Copy')),
          toggle('Let people mark gifts as taken', cur.shareClaims !== false, async (v) => { try { cur = (await this.store.batch([{ op: 'put', col: 'lists', item: { ...cur, shareClaims: v } }]))[0]; } catch (err) { toastError(err); } }),
          field('A note at the top (optional)', (() => { const t = h('textarea', { class: 'fam-input', rows: 2, maxlength: 500, placeholder: 'Thanks for thinking of us! Gifts can go to…' }, cur.shareNote || ''); t.addEventListener('change', async () => { try { cur = (await this.store.batch([{ op: 'put', col: 'lists', item: { ...cur, shareNote: t.value.trim() } }]))[0]; } catch (err) { toastError(err); } }); return t; })()),
          h('div', { class: 'fam-row-wrap' },
            h('a', { class: 'fam-btn', href: url, target: '_blank', rel: 'noopener' }, 'Open it'),
            h('button', { type: 'button', class: 'fam-btn', onclick: async () => { try { cur = await this.store.giftShare(cur.id, true); draw(); toast('New link made — the old one no longer works', { timeout: 3000 }); } catch (err) { toastError(err); } } }, 'Make a new link'),
            h('button', { type: 'button', class: 'fam-btn danger', onclick: async () => { try { cur = await this.store.giftShare(cur.id, false); draw(); } catch (err) { toastError(err); } } }, 'Stop sharing')),
        ] : h('button', { type: 'button', class: 'fam-btn primary', onclick: async () => { try { cur = await this.store.giftShare(cur.id, true); draw(); } catch (err) { toastError(err); } } }, 'Make a share link'));
    };
    draw();
    await sheet(this.app.root, { title: `Share “${l.title}”`, body, actions: [{ label: 'Done', primary: true, value: true }] });
  }

  async moreSheet(l) {
    const can = this.canEdit(l);
    const actions = [];
    const item = (label, fn, hint) => h('button', { type: 'button', class: 'fam-gift-menu-item', onclick: () => { menu.close(); fn(); } }, h('b', {}, label), hint ? h('small', { class: 'fam-muted' }, hint) : null);
    if (isGift(l) && can) actions.push(item('📋 Make a copy', () => this.reuse(l), 'A new list with the same settings and the gifts nobody got to'));
    if (l.kind === 'christmas' && can) {
      const older = this.view.lists().filter((x) => x.kind === 'christmas' && x.id !== l.id && this.recipientKey(x) === this.recipientKey(l) && (x.year || 0) < (l.year || 0)).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
      if (older) actions.push(item(`⏮️ Copy ideas from ${older.year}`, () => this.copyItems(older, l), `Gift ideas from ${older.folder || older.year} that nobody got to`));
    }
    if (can) actions.push(item(l.archived ? '📤 Take out of the archive' : '🗄️ Archive', () => this.archive(l, !l.archived), l.archived ? null : 'For when the day is over: it leaves the menu, and can be reused later'));
    if (isGift(l)) actions.push(item('👕 Sizes & favorites', () => this.editAbout(l)));
    if (isGift(l) && can) actions.push(item('📌 Pinned photos, links & notes', () => this.editBoard(l)));
    if (this.sharedScreen && revealed) actions.push(item('🙈 Hide surprises on this screen', () => this.hideAgain()));
    if (can) actions.push(item('⚙️ List settings', () => (l.kind === 'cards' ? this.view.editPlainList(l) : this.editList(l))));
    const menu = sheet(this.app.root, { title: l.title, body: h('div', { class: 'fam-gift-menu' }, actions), actions: [{ label: 'Close' }] });
    await menu;
  }

  async copyItems(from, to) {
    const have = new Set(this.view.items(to.id).map((i) => cleanName(i.text)));
    const ops = this.view.items(from.id).filter((i) => isGiftItem(i) && !taken(i) && !have.has(cleanName(i.text))).map((i) => ({ op: 'put', col: 'listitems', item: resetGift(i, to.id) }));
    if (!ops.length) return toast('Nothing new to copy', { timeout: 2000 });
    try { await this.store.batch(ops); toast(`Copied ${plural(ops.length, 'idea')}`, { timeout: 2500 }); } catch (err) { toastError(err); }
  }

  async archive(l, on) {
    try {
      await this.store.put('lists', { ...l, archived: on });
      if (on) {
        toast(`Archived “${l.title}”`, { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.put('lists', { ...l, archived: false }).catch((e) => toastError(e)) } });
        this.view.open(null);
      }
    } catch (err) { toastError(err); }
  }

  // Next year's name for a Christmas list: the year in it moves on, and an old-style name (just
  // the person's) becomes “Name Year Christmas List”.
  nextYearTitle(l, year) {
    if (l.kind !== 'christmas') return l.title;
    const name = this.who(l).name || '';
    if (!l.title || autoChristmasNames(name, l.year).includes(l.title)) return christmasName(name, year);
    return l.year && l.title.includes(String(l.year)) ? l.title.replaceAll(String(l.year), String(year)) : l.title;
  }

  // A new list from an old one: same settings, the gifts nobody got to, and a fresh date.
  async reuse(l) {
    const copy = { ...l, id: newId(), title: l.kind === 'gift' ? `${l.title} (copy)` : l.title, archived: false, order: Date.now() };
    delete copy.shareToken; delete copy.created; delete copy.updated; delete copy.party;
    if (copy.kind === 'christmas') { copy.year = Math.max(new Date().getFullYear(), (l.year || 0) + 1); copy.folder = `Christmas ${copy.year}`; copy.title = this.nextYearTitle(l, copy.year); }
    if (copy.kind === 'gift') copy.date = null;
    const ops = [{ op: 'put', col: 'lists', item: copy }, ...this.gifts(l).filter((i) => !taken(i)).map((i) => ({ op: 'put', col: 'listitems', item: resetGift(i, copy.id) }))];
    try {
      await this.store.batch(ops);
      this.view.open(copy.id);
      if (copy.kind === 'gift') this.editList(this.store.get('lists', copy.id));
    } catch (err) { toastError(err); }
  }

  drawArchive(main) {
    const lists = this.view.lists().filter((l) => isGiftish(l) && l.archived).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    clear(main,
      h('div', { class: 'fam-toolbar' }, h('div', { class: 'fam-toolbar-title' }, h('span', {}, '🗄️'), ' Archived lists')),
      h('p', { class: 'fam-muted' }, 'Lists whose day is over. Open one to look back, reuse it for the next occasion, or bring it back.'),
      h('div', { class: 'fam-list-items' }, lists.map((l) => h('div', { class: 'fam-item fam-gift-archived', style: { '--c': l.color || '#868e96' } },
        h('span', { class: 'fam-gift-pic none' }, l.emoji || '🎁'),
        h('button', { class: 'fam-item-text', onclick: () => this.view.open(l.id) }, h('span', {}, l.title), h('small', {}, [KIND_LABELS[l.kind], l.folder, plural(this.view.items(l.id).length, 'item')].filter(Boolean).join(' · '))),
        this.canEdit(l) && isGift(l) ? h('button', { class: 'fam-btn small', onclick: () => this.reuse(l) }, 'Reuse') : null,
        this.canEdit(l) ? h('button', { class: 'fam-btn small', onclick: () => this.archive(l, false) }, 'Bring back') : null)),
      lists.length ? null : h('div', { class: 'fam-muted fam-list-empty' }, 'Nothing archived.')));
  }

  // --- New lists and their settings --------------------------------------------------------

  // Which kind of list: the everyday ones, or a gift list.
  async pickKind() {
    const tile = (kind, emoji, label, hint) => h('button', { type: 'button', class: 'fam-gift-kind', onclick: () => out.close(kind) }, h('span', { class: 'fam-gift-kind-emoji' }, emoji), h('b', {}, label), h('small', { class: 'fam-muted' }, hint));
    const out = sheet(this.app.root, {
      title: 'New list', wide: true,
      body: h('div', { class: 'fam-form' },
        h('div', { class: 'fam-gift-kinds' },
          tile('grocery', '🛒', 'Groceries', 'Sorted into aisles'), tile('todo', '✅', 'To-do list', 'With a person and a due date'), tile('other', '📝', 'Other list', 'Packing lists and anything else')),
        h('div', { class: 'fam-label' }, 'Gift lists'),
        h('div', { class: 'fam-gift-kinds' },
          tile('christmas', '🎄', 'Christmas list', 'One per person, in a folder for the year'), tile('birthday', '🎂', 'Birthday list', 'Tied to their birthday, with a party plan'), tile('gift', '🎁', 'Gift list', 'Wedding, baby shower, graduation or your own'))),
      actions: [{ label: 'Cancel' }],
    });
    return out;
  }

  async pickTemplate() {
    const out = sheet(this.app.root, {
      title: 'What’s the occasion?', wide: true,
      body: h('div', { class: 'fam-gift-kinds' }, TEMPLATES.map((t) => h('button', { type: 'button', class: 'fam-gift-kind', style: { '--c': t.color }, onclick: () => out.close(t) },
        h('span', { class: 'fam-gift-kind-emoji' }, t.emoji), h('b', {}, t.label), h('small', { class: 'fam-muted' }, t.fields.length ? `With ${t.fields.map((f) => f[0].toLowerCase()).join(', ')}` : t.id === 'blank' ? 'Start from nothing' : 'Gifts and a date')))),
      actions: [{ label: 'Cancel' }],
    });
    return out;
  }

  // A gift list's settings (or a new one of a kind). preset: { year } for Christmas.
  async editList(l, kind = l?.kind, preset = {}) {
    let tpl = null;
    if (!l && kind === 'gift') { tpl = await this.pickTemplate(); if (!tpl) return; }
    const year0 = l?.year || preset.year || (new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear());
    const members = this.store.members();
    const d = l || { kind, emoji: tpl?.emoji || (kind === 'christmas' ? '🎄' : kind === 'birthday' ? '🎂' : '🎁'), color: tpl?.color || (kind === 'christmas' ? '#2f9e44' : kind === 'birthday' ? '#f08c00' : '#d6336c'), reminders: tpl?.reminders || (kind === 'birthday' ? [14, 2] : [14]), fields: (tpl?.fields || []).map(([label, type]) => ({ id: newId(), label, type })), occasion: tpl && tpl.id !== 'blank' ? tpl.label : '', template: tpl?.id };
    const emoji = emojiButton(d.emoji);
    const title = input({ value: l?.title || (tpl && tpl.id !== 'blank' ? tpl.label : ''), placeholder: kind === 'christmas' ? 'e.g. Emma 2026 Christmas List' : kind === 'birthday' ? 'Leave empty for “Name’s birthday”' : 'List name', maxlength: 80, autofocus: true });
    // Who it's for.
    const bdayEvents = this.store.all('events').filter((e) => e.allDay && e.rrule?.freq === 'yearly' && !String(e.id).startsWith('bday-') && /birthday|bday|b-day/i.test(e.title || ''));
    const ownOnly = kind === 'christmas' && !this.viewer.parent && Boolean(this.me) && (!l || l.recipient === this.me || !l.recipient);
    const forOpts = ownOnly ? members.filter((m) => m.id === this.me).map((m) => [m.id, `${m.name} (you)`]) : [['', kind === 'gift' ? 'Nobody in particular' : 'Pick someone'], ...members.map((m) => [m.id, `${m.name}${kind === 'birthday' && m.birthday ? ` (${fmtDate(parseYmd(m.birthday), { month: 'short', day: 'numeric' })})` : ''}`]),
      ...(kind === 'birthday' ? bdayEvents.map((e) => [`ev:${e.id}`, `📅 ${e.title.replace(/[’']s birthday.*$/i, '').replace(/\s*🎂/, '')} (${fmtDate(parseYmd(String(e.start).slice(0, 10)), { month: 'short', day: 'numeric' })}, from the calendar)`]) : []),
      ['__name', 'Someone else…']];
    const forSel = select(forOpts, d.recipient || (d.eventId ? `ev:${d.eventId}` : d.recipientName ? '__name' : '') || (ownOnly ? this.me : '') || (kind === 'christmas' && preset.recipient ? preset.recipient : ''));
    if (ownOnly) forSel.disabled = forOpts.length < 2;
    const forName = input({ value: d.recipientName || '', placeholder: 'Their name', maxlength: 60 });
    const nameField = field('Their name', forName);
    const date = input({ type: 'date', value: kind === 'birthday' ? (!d.recipient && !d.eventId ? d.date || '' : '') : d.date || '' });
    const dateField = field(kind === 'birthday' ? 'Birthday' : 'Date', date, kind === 'birthday' ? 'Any year; the year it’s in counts as the year they were born if you leave the next box empty.' : null);
    const birthYear = input({ type: 'number', value: d.birthYear || '', placeholder: 'e.g. 2012', min: 1900, max: 2100 });
    const birthField = field('Year they were born (for their age)', birthYear);
    const occasion = input({ value: d.occasion || '', placeholder: 'e.g. Sam & Alex’s wedding', maxlength: 80 });
    const year = input({ type: 'number', value: year0, min: 2000, max: 2100 });
    const budget = input({ value: d.budget ?? '', inputmode: 'decimal', placeholder: 'No budget', maxlength: 12 });
    // Christmas: start from last year's list for the same person.
    const fromSel = !l && kind === 'christmas' ? select([['', 'Start empty'], ...this.view.lists().filter((x) => x.kind === 'christmas' && (!ownOnly || x.recipient === this.me)).sort((a, b) => (b.year || 0) - (a.year || 0)).map((x) => [x.id, `${x.title} (${x.folder || x.year})`])], '') : null;
    const syncFrom = () => {
      if (!fromSel) return;
      const who = forSel.value;
      const last = this.view.lists().filter((x) => x.kind === 'christmas' && who && x.recipient === who).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
      if (last) fromSel.value = last.id;
    };
    // Christmas lists are named “Name Year Christmas List” until someone types their own name.
    const personNow = () => { const f = forSel.value; return members.find((x) => x.id === f)?.name || (f === '__name' ? forName.value.trim() : ''); };
    let autoTitle = kind === 'christmas' ? (l ? christmasName(this.who(l).name, l.year || year0) : '') : null;
    const syncTitle = () => {
      if (kind !== 'christmas') return;
      const was = title.value.trim();
      const next = christmasName(personNow(), Number(year.value) || year0);
      if (!was || was === autoTitle || (l && autoChristmasNames(this.who(l).name || '', l.year || year0).includes(was))) title.value = personNow() ? next : '';
      autoTitle = next;
    };
    const syncFor = () => {
      nameField.hidden = forSel.value !== '__name';
      if (kind === 'birthday') {
        const m = members.find((x) => x.id === forSel.value);
        dateField.hidden = forSel.value !== '__name';
        if (m?.birthday && !birthYear.value) birthYear.placeholder = m.birthday.slice(0, 4);
        if (m && !m.birthday) { dateField.hidden = false; dateField.querySelector('.fam-hint').textContent = `${m.name} has no birthday in their profile yet — add it here (it’s saved to their profile too).`; }
      }
      syncFrom();
      syncTitle();
    };
    forSel.addEventListener('change', syncFor);
    forName.addEventListener('input', syncTitle);
    year.addEventListener('input', syncTitle);
    // Reminders.
    const rem = new Set(d.reminders || []);
    const remRow = h('div', { class: 'fam-row-wrap' });
    const drawRem = () => clear(remRow, REMINDER_CHOICES.map(([n, label]) => h('button', { type: 'button', class: `fam-chip ${rem.has(n) ? 'on' : ''}`, onclick: () => { if (rem.has(n)) rem.delete(n); else rem.add(n); drawRem(); } }, label)));
    drawRem();
    // Custom fields.
    const fields = (d.fields || []).map((f) => ({ ...f }));
    const fieldsEl = h('div', { class: 'fam-form' });
    const drawFields = () => clear(fieldsEl, fields.map((f, n) => h('div', { class: 'fam-gift-line' },
      input({ value: f.label, placeholder: 'e.g. Size, Colour, Store', maxlength: 40, oninput: (e) => { f.label = e.target.value; } }),
      select([['text', 'Text'], ['number', 'Number'], ['link', 'Link']], f.type || 'text', { onchange: (e) => { f.type = e.target.value; } }),
      h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Remove the field', html: ICONS.close, onclick: () => { fields.splice(n, 1); drawFields(); } }))),
    h('button', { type: 'button', class: 'fam-btn small', onclick: () => { fields.push({ id: newId(), label: '', type: 'text' }); drawFields(); } }, '+ Add a field'));
    drawFields();
    // Who can see, edit and claim.
    const acc = d.access || {};
    const see = memberPicker(members, acc.see || []);
    const edit = memberPicker(members, acc.edit || []);
    const claim = memberPicker(members, acc.claim || []);
    let color = d.color;
    const colors = colorPicker(color, (c) => { color = c; });
    syncFor();
    const show = (on, el) => (on ? el : null);
    const out = await sheet(this.app.root, {
      title: l ? 'List settings' : kind === 'christmas' ? 'New Christmas list' : kind === 'birthday' ? 'New birthday list' : `New ${tpl?.id === 'blank' ? 'gift' : tpl?.label.toLowerCase() || 'gift'} list`, wide: true,
      body: h('div', { class: 'fam-form' },
        h('div', { class: 'fam-title-row' }, emoji, title),
        h('div', { class: 'fam-row-wrap' }, field(kind === 'birthday' ? 'Whose birthday' : 'Who it’s for', forSel, kind === 'christmas' || kind === 'birthday' ? 'A family member’s list doesn’t show them your ideas or what’s bought.' : null), nameField),
        show(kind === 'birthday', h('div', { class: 'fam-row-wrap' }, dateField, birthField)),
        show(kind === 'gift', h('div', { class: 'fam-row-wrap' }, field('Occasion', occasion), field('Date', date))),
        show(kind === 'christmas', h('div', { class: 'fam-row-wrap' }, field('Christmas', year), fromSel ? field('Start from', fromSel, 'Gift ideas nobody got to') : null)),
        this.isRecipient(l) || ownOnly ? null : field('Budget', budget, 'Spending so far is added up from what’s claimed or bought.'),
        field('Reminders', remRow, kind === 'christmas' ? 'Shipping cutoffs remind you too.' : 'While the organizer is open, like event reminders.'),
        show(kind === 'gift', field('Extra fields for each gift', fieldsEl)),
        this.isRecipient(l) && !this.viewer.parent ? null : h('details', { class: 'fam-gift-access', open: (acc.see || []).length || (acc.edit || []).length || (acc.claim || []).length ? true : null },
          h('summary', {}, 'Who can see, edit or claim'),
          h('p', { class: 'fam-muted small' }, 'Pick nobody to leave it open to everyone. Whoever made the list can always see and change it.'),
          field('Who can see it', see), field('Who can change it', edit), field('Who can claim gifts', claim)),
        field('Colour', colors)),
      actions: [l ? { label: 'Delete list', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: l ? 'Save' : 'Make the list', primary: true, submit: true, onClick: (close) => {
        const f = forSel.value;
        if (ownOnly && f !== this.me) { toast('You can make your own Christmas list. A parent can make one for anyone.', { timeout: 3500 }); return; }
        if ((kind === 'christmas' || kind === 'birthday') && !f) { toast(kind === 'birthday' ? 'Whose birthday is it?' : 'Who’s the list for?', { timeout: 2500 }); return forSel.focus(); }
        if (f === '__name' && !forName.value.trim()) return forName.focus();
        if (kind === 'birthday' && f === '__name' && !date.value) return date.focus();
        const m = members.find((x) => x.id === f);
        const ev = f.startsWith('ev:') ? this.store.get('events', f.slice(3)) : null;
        const person = m?.name || (ev ? ev.title.replace(/[’']s birthday.*$/i, '').replace(/\s*🎂/, '').trim() : forName.value.trim());
        const y = Number(year.value) || year0;
        const next = {
          ...(l || { id: newId(), order: Date.now() }), kind, emoji: emoji.value, color,
          title: title.value.trim() || (kind === 'christmas' ? christmasName(person, y) : kind === 'birthday' ? `${person}’s birthday` : occasion.value.trim() || 'Gift list'),
          recipient: m ? m.id : null, recipientName: m ? null : person || null, eventId: ev ? ev.id : null,
          date: kind === 'gift' ? date.value || null : kind === 'birthday' && !m && !ev ? date.value || null : kind === 'birthday' && m && !m.birthday ? date.value || null : l?.date || null,
          birthYear: Number(birthYear.value) || null, occasion: kind === 'gift' ? occasion.value.trim() : l?.occasion,
          budget: parsePrice(budget.value), reminders: [...rem].sort((a, b) => b - a),
          fields: kind === 'gift' ? fields.filter((x) => x.label.trim()).map((x) => ({ ...x, label: x.label.trim() })) : l?.fields || [],
          access: { see: see.value(), edit: edit.value(), claim: claim.value() },
        };
        if (kind === 'christmas') { next.year = y; next.folder = `Christmas ${y}`; }
        if (!l) next.about = this.view.lists().filter((x) => isGift(x) && x.about && this.recipientKey(x) === this.recipientKey(next)).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0]?.about;
        close({ list: next, from: fromSel?.value || null, starter: tpl?.starter || [], memberBirthday: kind === 'birthday' && m && !m.birthday && date.value ? { m, date: date.value } : null });
      } }],
    });
    if (!out) return;
    try {
      if (out === 'delete') {
        const n = this.view.items(l.id).length;
        const sure = await sheet(this.app.root, { title: 'Delete list', body: h('p', {}, `Delete “${l.title}”${n ? ` and everything on it` : ''}? Archiving keeps it for next time instead.`), actions: [{ label: 'Cancel' }, { label: 'Archive', value: 'archive' }, { label: 'Delete', danger: true, value: true }] });
        if (sure === 'archive') return this.archive(l, true);
        if (!sure) return;
        await this.store.batch([{ op: 'delete', col: 'lists', id: l.id }]);
        for (const i of this.view.items(l.id)) delete this.store.data.listitems[i.id];
        this.view.open(null);
        return;
      }
      const ops = [{ op: 'put', col: 'lists', item: out.list }];
      if (out.from) { const src = this.store.get('lists', out.from); if (src) for (const i of this.gifts(src).filter((x) => !taken(x))) ops.push({ op: 'put', col: 'listitems', item: resetGift(i, out.list.id) }); }
      out.starter.forEach((t, n) => ops.push({ op: 'put', col: 'listitems', item: { id: newId(), list: out.list.id, text: t, status: 'idea', done: false, order: Date.now() + n } }));
      if (out.memberBirthday && this.viewer.parent) ops.push({ op: 'put', col: 'members', item: { ...out.memberBirthday.m, birthday: out.memberBirthday.date } });
      await this.store.batch(ops);
      if (out.memberBirthday && this.viewer.parent) await this.app.views.settings?.syncBirthday?.({ ...out.memberBirthday.m, birthday: out.memberBirthday.date }).catch(() => {});
      this.view.open(out.list.id);
    } catch (err) { toastError(err); }
  }

  // --- Adding from a store's page in the browser ------------------------------------------

  // Amazon, Walmart and Best Buy turn servers away, but the page is right there in your browser:
  // a bookmark button reads it there (name, price, picture) and opens the organizer with it.
  // Android phones can also Share a page (or a product in the store's app) to the organizer.
  async browserButton() {
    const code = bookmarklet(location.origin);
    const btn = h('a', { class: 'fam-gift-bookmarklet', href: code, title: 'Drag me to your bookmarks bar', onclick: (e) => { e.preventDefault(); toast('Drag the button to your bookmarks bar, then click it on a product’s page', { timeout: 4000 }); } }, '🎁 Add to gift list');
    const copy = h('button', { type: 'button', class: 'fam-btn small', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied — paste it as the bookmark’s address', { timeout: 3000 }); } catch { toast('Couldn’t copy here; long-press the button instead', { timeout: 3000 }); } } }, 'Copy the button’s code');
    await sheet(this.app.root, {
      title: 'Add gifts straight from a store', wide: true,
      body: h('div', { class: 'fam-form fam-gift-howto-sheet' },
        h('p', {}, 'Amazon, Walmart and Best Buy don’t let other servers read their pages, so a pasted link only brings the gift’s name. This button reads the page in your own browser instead, while you’re looking at it, and works on any store.'),
        h('h4', {}, '💻 On a computer'),
        h('ol', {}, h('li', {}, 'Drag this button to your browser’s bookmarks bar: ', btn), h('li', {}, 'Open a product’s page at Amazon, Walmart, Best Buy, Target or any store.'), h('li', {}, 'Click 🎁 Add to gift list. The organizer opens with the name, price, picture and link filled in, and asks which list it goes on.')),
        h('h4', {}, '📱 On an iPhone or iPad'),
        h('ol', {}, h('li', {}, copy), h('li', {}, 'In Safari, bookmark any page, then edit that bookmark: name it “Add to gift list” and paste the code as its address.'), h('li', {}, 'On a product’s page, open your bookmarks and tap it.')),
        h('h4', {}, '🤖 On Android'),
        h('p', {}, 'Add the organizer to your home screen (Chrome’s menu → Add to Home screen or Install). Then on a store’s page, or a product in the Amazon or Walmart app, tap Share → Family. The name and link come across; prices and pictures from Amazon and Walmart are added by hand.'),
        h('p', { class: 'fam-muted small' }, `Pasted links from stores that do show their pages to servers (Home Depot, Costco, Target, and most smaller shops) fill in everything by themselves.`)),
      actions: [{ label: 'Done', primary: true, value: true }],
    });
  }

  // A gift sent from the browser button or Android's Share: which list, then its screen.
  async takeIncoming() {
    let gift = null;
    try { gift = JSON.parse(sessionStorage.getItem('fam-incoming-gift') || 'null'); sessionStorage.removeItem('fam-incoming-gift'); } catch { return; }
    if (!gift || (!gift.u && !gift.t)) return;
    const link = /^https?:\/\//i.test(gift.u || '') ? gift.u : urlIn(gift.t);
    const name = cleanShareText(String(gift.t || '').replace(link || '\u0000', ''));
    const fields = { text: name, url: link || '', price: parsePrice(gift.p), image: /^https:\/\//i.test(gift.i || '') ? gift.i : null };
    if (fields.url) fields.store = storeLabel(fields.url);
    this.app.go('lists');
    const lists = this.view.lists().filter((l) => isGift(l) && !l.archived && (this.canEdit(l) || this.isRecipient(l)));
    const pick = sheet(this.app.root, {
      title: name ? `Add “${name.length > 60 ? `${name.slice(0, 60)}…` : name}” to…` : 'Add this gift to…', wide: true,
      body: h('div', { class: 'fam-form' },
        fields.image ? h('img', { class: 'fam-gift-incoming-pic', src: fields.image, alt: '' }) : null,
        lists.length ? h('div', { class: 'fam-gift-kinds' }, lists.map((l) => h('button', { type: 'button', class: 'fam-gift-kind', style: { '--c': l.color || '#d6336c' }, onclick: () => pick.close(l.id) },
          h('span', { class: 'fam-gift-kind-emoji' }, l.emoji || '🎁'), h('b', {}, l.title), h('small', { class: 'fam-muted' }, this.isRecipient(l) ? 'Your wish list' : [KIND_LABELS[l.kind], l.folder].filter(Boolean).join(' · ')))))
          : h('p', { class: 'fam-muted' }, 'There are no gift lists yet.'),
        h('button', { type: 'button', class: 'fam-btn', onclick: () => pick.close('__new') }, '+ A new gift list')),
      actions: [{ label: 'Cancel' }],
    });
    let id = await pick;
    if (!id) return;
    if (id === '__new') {
      const kind = await this.pickKind();
      if (!GIFT_KINDS.includes(kind)) return;
      await this.editList(null, kind);
      id = this.view.listId;
    }
    const l = this.store.get('lists', id);
    if (l) { this.view.open(l.id); await this.newGift(l, fields); }
  }

  // --- Reminders (from the organizer's clock, while it's open) ------------------------------

  reminders(from, now) {
    const due = [];
    const at9 = (date, before) => { const x = addDays(parseYmd(date), -before); x.setHours(9, 0, 0, 0); return x.getTime(); };
    const years = new Set();
    for (const l of this.store.all('lists')) {
      if (!isGift(l) || l.archived) continue;
      if (l.kind === 'christmas') years.add(l.year || new Date().getFullYear());
      const date = this.nextDate(l, new Date(from));
      if (!date) continue;
      for (const n of l.reminders || []) {
        const t = at9(date, n);
        if (t > from && t <= now) {
          const left = this.isRecipient(l) ? 0 : this.gifts(l).filter((i) => !taken(i)).length;
          const what = l.kind === 'christmas' ? 'Christmas' : l.kind === 'birthday' ? `${this.who(l).name || l.title}’s birthday` : l.occasion || l.title;
          due.push([`${l.emoji || '🎁'} ${what} ${n === 0 ? 'is today' : `is ${n === 1 ? 'tomorrow' : n === 7 ? 'in a week' : n === 14 ? 'in 2 weeks' : n === 30 ? 'in a month' : `in ${n} days`}`}`, left && !this.hidden ? `${plural(left, 'gift')} still to get on ${l.title}` : l.title, `gift-${l.id}-${date}-${n}`]);
        }
      }
    }
    for (const y of years) {
      for (const s of this.shipping(y)) {
        for (const n of [2, 0]) {
          const t = at9(s.date, n);
          if (t > from && t <= now) due.push([`📦 ${n ? 'Two days left' : 'Last day'} to ship with ${s.label}`, 'So Christmas gifts arrive in time', `ship-${y}-${s.label}-${n}`]);
        }
      }
    }
    for (const [title, body, tag] of due) {
      toast(title, { body, icon: ICONS.gift, timeout: 15000 });
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag }); } catch { /* not allowed */ }
    }
  }
}

// The ten sizes people ask about most, and the usual sizes for each.
const ADULT = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const KIDS = ['Kids XS (4–5)', 'Kids S (6–7)', 'Kids M (8)', 'Kids L (10–12)', 'Kids XL (14–16)', 'Kids 4', 'Kids 5', 'Kids 6', 'Kids 7', 'Kids 8', 'Kids 10', 'Kids 12', 'Kids 14', 'Kids 16'];
const LITTLE = ['2T', '3T', '4T', '5T'];
const BABY = ['Newborn', '0–3 months', '3–6 months', '6–9 months', '6–12 months', '12 months', '18 months', '24 months'];
const WOMENS = ['0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'];
const CLOTHES = [['Adult', ADULT], ['Kids', KIDS], ['Toddler', LITTLE], ['Baby', BABY]];
export const SIZE_KINDS = [
  ['Shirt / top', CLOTHES],
  ['Sweater / hoodie', CLOTHES],
  ['Jacket / coat', CLOTHES],
  ['Pants', [['Adult', ADULT], ['Waist', ['28', '30', '32', '34', '36', '38', '40', '42']], ['Women’s', WOMENS], ['Kids', KIDS], ['Toddler', LITTLE], ['Baby', BABY]]],
  ['Jeans', [['Waist × length', ['28×30', '29×30', '30×30', '30×32', '31×32', '32×30', '32×32', '33×32', '34×30', '34×32', '36×30', '36×32', '38×32', '40×32']], ['Women’s', WOMENS], ['Kids', KIDS], ['Toddler', LITTLE]]],
  ['Dress', [['Women’s', WOMENS], ['Letter', ADULT], ['Kids', KIDS], ['Toddler', LITTLE], ['Baby', BABY]]],
  ['Shoes', [['Men’s', ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14']], ['Women’s', ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '11']], ['Big kids', ['1Y', '1.5Y', '2Y', '2.5Y', '3Y', '3.5Y', '4Y', '4.5Y', '5Y', '5.5Y', '6Y', '7Y']], ['Little kids', ['10C', '10.5C', '11C', '11.5C', '12C', '12.5C', '13C', '13.5C']], ['Toddler', ['4C', '5C', '6C', '7C', '8C', '9C']]]],
  ['Pajamas', CLOTHES],
  ['Underwear', CLOTHES],
  ['Socks', [['Adult', ['S', 'M', 'L', 'XL', 'Shoe 6–9', 'Shoe 9–12', 'Shoe 12–15']], ['Kids', ['Kids S', 'Kids M', 'Kids L', 'Toddler', 'Baby']]]],
];
const sizeChoices = (kind) => SIZE_KINDS.find(([k]) => k === kind)?.[1] || [['Usual sizes', [...ADULT, ...KIDS.slice(0, 5)]]];
const sizeList = (a) => (Array.isArray(a?.sizeList) ? a.sizeList.filter((x) => x && x.kind && x.value) : []);

// Text that comes with a shared link ("Check out this deal on Amazon: …") without the chatter.
export function cleanShareText(t) {
  return String(t || '').replace(/^\s*(check out (this|these)( deal| item| product)?( on [\w.]+)?|i found this on [\w.]+|look at this|shared from [\w. ]+)\s*[:!\-–—]?\s*/i, '')
    .replace(/\s*(via @?\w+|on (amazon|walmart|best buy|target|ebay)(\.com)?)\s*$/i, '').replace(/^["'“]+|["'”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// A store's name from its address.
const STORE_LABELS = { 'amazon.com': 'Amazon', 'a.co': 'Amazon', 'amzn.to': 'Amazon', 'walmart.com': 'Walmart', 'bestbuy.com': 'Best Buy', 'target.com': 'Target', 'ebay.com': 'eBay', 'etsy.com': 'Etsy', 'costco.com': 'Costco', 'homedepot.com': 'Home Depot', 'lowes.com': 'Lowe’s', 'kohls.com': 'Kohl’s', 'macys.com': 'Macy’s' };
export function storeLabel(url) {
  try { const host = new URL(url).hostname.replace(/^(www|smile|m)\./, ''); return STORE_LABELS[host] || host; } catch { return null; }
}

// The browser button: run on a store's page, it reads the product there (its schema.org details,
// Amazon's own page parts, or the sharing tags) and opens the organizer with it.
function bookmarklet(origin) {
  const src = `(()=>{const d=document,q=s=>d.querySelector(s),m=n=>q('meta[property="'+n+'"],meta[name="'+n+'"]')?.content,t=x=>(x||'').replace(/\\s+/g,' ').trim();let j={};for(const s of d.querySelectorAll('script[type="application/ld+json"]')){try{const w=x=>{if(!x||typeof x!='object')return;if(Array.isArray(x))return x.forEach(w);if(/product/i.test([].concat(x['@type']).join()))j=j.name?j:x;w(x['@graph'])};w(JSON.parse(s.textContent))}catch(e){}}const o=[].concat(j.offers||[])[0]||{},im=q('#landingImage'),pic=im?.getAttribute('data-old-hires')||im?.src||[].concat(j.image||[]).map(x=>typeof x=='string'?x:x?.url)[0]||m('og:image')||'',g={u:location.href.split('#')[0],t:t(q('#productTitle')?.textContent)||t(j.name)||m('og:title')||d.title,p:t(q('#corePrice_feature_div .a-offscreen,#corePriceDisplay_desktop_feature_div .a-offscreen,.a-price .a-offscreen')?.textContent)||String(o.price||o.lowPrice||[].concat(o.offers||[])[0]?.price||'')||m('product:price:amount')||q('[itemprop=price]')?.getAttribute('content')||t(q('[data-test=product-price],[data-testid=customer-price] span,.priceView-customer-price span')?.textContent),i:pic};window.open(${JSON.stringify(`${origin}/family#gift=`)}+encodeURIComponent(JSON.stringify(g)),'_blank')})()`;
  return `javascript:${src}`;
}

// A gift copied to a new list: the idea, without who got it or how far it got.
function resetGift(i, list) {
  const copy = { ...i, id: newId(), list, status: 'idea', done: false, order: i.order ?? Date.now() };
  for (const k of ['claimedBy', 'claimedName', 'claimedAt', 'claimKey', 'chips', 'givenYear', 'doneAt', 'created', 'updated', 'addedBy']) delete copy[k];
  return copy;
}

export function parsePrice(v) {
  const s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const n = Number(s.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
