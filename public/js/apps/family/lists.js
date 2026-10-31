// Lists: groceries (sorted into aisles as you add them), to-dos with a person and a due date,
// and any other list the family keeps.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, parseYmd, fmtDate, todayYmd } from './dates.js';
import { sheet, field, input, select, avatar, memberPicker, emojiButton, colorPicker, ICONS } from './shared.js';

const AISLES = [
  ['Produce', '🥬', /\b(apple|banana|berr|grape|orange|lemon|lime|melon|peach|pear|plum|cherr|mango|pineapple|kiwi|avocado|tomato|potato|onion|garlic|carrot|celery|lettuce|spinach|kale|arugula|cabbage|broccoli|cauliflower|pepper|cucumber|zucchini|squash|mushroom|corn|bean sprout|herb|cilantro|parsley|basil|mint|ginger|scallion|leek|beet|radish|asparagus|green bean|fruit|veg|salad)/i],
  ['Meat & seafood', '🥩', /\b(chicken|beef|pork|steak|ground|turkey|bacon|sausage|ham|lamb|fish|salmon|tuna|shrimp|cod|tilapia|meat|thigh|breast|wing|rib|mince|chorizo|prosciutto|salami|pepperoni)/i],
  ['Dairy & eggs', '🥛', /\b(milk|cheese|cheddar|mozzarella|parmesan|feta|yog(h)?urt|butter|cream|egg|sour cream|cottage|half and half|kefir)/i],
  ['Bakery', '🍞', /\b(bread|bagel|bun|roll|tortilla|pita|croissant|muffin|baguette|sourdough|naan|cake|donut|wrap)/i],
  ['Frozen', '🧊', /\b(frozen|ice cream|popsicle|ice\b|waffle)/i],
  ['Pantry', '🥫', /\b(pasta|spaghetti|noodle|rice|flour|sugar|salt|oil|vinegar|sauce|ketchup|mustard|mayo|cereal|oat|granola|bean|lentil|chickpea|soup|broth|stock|can|jar|peanut butter|jam|jelly|honey|syrup|spice|seasoning|cinnamon|vanilla|baking|yeast|cracker|chip|pretzel|popcorn|nut|almond|raisin|cookie|snack|tea|coffee|cocoa|pesto|salsa|hummus|olive)/i],
  ['Drinks', '🧃', /\b(juice|soda|water|sparkling|beer|wine|kombucha|lemonade|drink|coke|seltzer)/i],
  ['Household', '🧻', /\b(paper towel|toilet|tissue|napkin|soap|detergent|dish|sponge|trash bag|foil|wrap|bag|bleach|cleaner|wipe|battery|light bulb|shampoo|toothpaste|deodorant|lotion|diaper|razor|floss)/i],
  ['Pets', '🐾', /\b(dog|cat|pet|litter|kibble|treats)/i],
];
export const aisleOf = (text) => AISLES.find(([, , re]) => re.test(text))?.[0] || 'Other';

export class ListsView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.listId = null;
    this.showDone = true;
  }

  // Signed in on the organizer's own page as a family member (not a parent): they assign to-dos
  // to themselves only. Parents (and MediaDesk itself) assign them to anyone.
  get user() { return this.app.session?.user || null; }
  get me() { return this.user?.profile ? this.store.member(this.user.profile) : null; }
  get selfOnly() { return Boolean(this.user && this.user.role !== 'parent'); }
  canAssign(id) { return !this.selfOnly || id === this.me?.id; }

  // Who a list or item is for: everyone can be picked by a parent; a family member can only tick
  // themselves on or off (the others stay as they are, shown but not changeable).
  assignPicker(selected, { single = false } = {}) {
    const sel = new Set(selected.filter(Boolean));
    const row = h('div', { class: 'fam-member-pick' });
    const draw = () => clear(row, this.store.members().map((m) => {
      const allowed = this.canAssign(m.id);
      return h('button', {
        type: 'button', class: `fam-chip ${sel.has(m.id) ? 'on' : ''} ${allowed ? '' : 'locked'}`, style: { '--c': m.color }, disabled: !allowed,
        title: allowed ? '' : 'Only a parent can assign this to someone else',
        onclick: () => {
          if (sel.has(m.id)) sel.delete(m.id);
          else { if (single) for (const id of [...sel]) if (this.canAssign(id)) sel.delete(id); sel.add(m.id); }
          draw();
        },
      }, avatar(m, 'sm'), m.name);
    }));
    draw();
    row.value = () => [...sel];
    return row;
  }

  // Lists for the people picked at the top (and lists that are everyone's).
  shown(lists) {
    const f = this.app.filter;
    if (!f.size) return lists;
    return lists.filter((l) => !(l.members || []).length || l.members.some((id) => f.has(id)));
  }

  lists() { return this.store.all('lists').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)); }
  items(listId) { return this.store.all('listitems').filter((i) => i.list === listId).sort((a, b) => (a.done - b.done) || (a.order ?? 0) - (b.order ?? 0)); }

  render(el) {
    this.el = el;
    const lists = this.shown(this.lists());
    if (!lists.find((l) => l.id === this.listId)) this.listId = lists[0]?.id || null;
    const side = h('div', { class: 'fam-lists-side' },
      lists.map((l) => {
        const left = this.items(l.id).filter((i) => !i.done).length;
        return h('button', { class: `fam-list-tab ${l.id === this.listId ? 'on' : ''}`, style: { '--c': l.color || '#1c7ed6' }, onclick: () => { this.listId = l.id; this.render(el); } },
          h('span', { class: 'fam-list-emoji' }, l.emoji || '📝'), h('span', { class: 'fam-list-name' }, l.title),
          (l.members || []).length ? h('span', { class: 'fam-agenda-who' }, l.members.map((id) => this.store.member(id)).filter(Boolean).slice(0, 3).map((m) => avatar(m, 'xs'))) : null,
          h('span', { class: 'fam-list-count' }, left || ''));
      }),
      h('button', { class: 'fam-list-tab add', onclick: () => this.editList(null) }, h('span', { class: 'fam-list-emoji', html: ICONS.plus }), h('span', { class: 'fam-list-name' }, 'New list')));
    const main = h('div', { class: 'fam-list-main' });
    clear(el, h('div', { class: 'fam-lists' }, side, main));
    const list = this.store.get('lists', this.listId);
    if (!list) { clear(main, h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '🛒'), 'Make a grocery list, a to-do list or a packing list.', h('button', { class: 'fam-btn primary', onclick: () => this.editList(null) }, 'New list'))); return; }
    this.drawList(main, list);
  }

  drawList(main, list) {
    const items = this.items(list.id);
    const done = items.filter((i) => i.done);
    const entry = input({ placeholder: list.kind === 'grocery' ? 'Add an item (paste several, one per line)' : 'Add something', class: 'fam-input fam-list-entry', maxlength: 500, enterkeyhint: 'enter' });
    const add = async () => {
      const lines = entry.value.split(/\n|,(?=\s*\S)/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return;
      entry.value = '';
      await this.addItems(list, lines);
      this.el.querySelector('.fam-list-entry')?.focus();
    };
    entry.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    entry.addEventListener('paste', (e) => {
      const t = e.clipboardData.getData('text');
      if (t.includes('\n')) { e.preventDefault(); entry.value = t; add(); }
    });
    const head = h('div', { class: 'fam-toolbar', style: { '--c': list.color || '#1c7ed6' } },
      h('div', { class: 'fam-toolbar-title' }, h('span', {}, list.emoji || '📝'), ' ', list.title),
      (list.members || []).length ? h('span', { class: 'fam-list-for' }, 'For ', list.members.map((id) => this.store.member(id)).filter(Boolean).map((m) => h('span', {}, avatar(m, 'xs'), m.name))) : null,
      h('div', { class: 'fam-spacer' }),
      done.length ? h('button', { class: 'fam-btn', onclick: () => { this.showDone = !this.showDone; this.render(this.el); } }, this.showDone ? 'Hide ticked' : `Show ticked (${done.length})`) : null,
      done.length ? h('button', { class: 'fam-btn', onclick: () => this.clearDone(list, done) }, 'Clear ticked') : null,
      h('button', { class: 'fam-icon-btn', title: 'List settings', html: ICONS.edit, onclick: () => this.editList(list) }));
    const body = h('div', { class: 'fam-list-items' });
    const visible = items.filter((i) => this.showDone || !i.done);
    if (list.kind === 'grocery' && list.group !== false) {
      const groups = new Map();
      for (const i of visible.filter((x) => !x.done)) { const a = i.section || aisleOf(i.text); if (!groups.has(a)) groups.set(a, []); groups.get(a).push(i); }
      const order = [...AISLES.map((a) => a[0]), 'Other'];
      for (const a of [...groups.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
        const emoji = AISLES.find((x) => x[0] === a)?.[1] || '🛍️';
        body.append(h('div', { class: 'fam-aisle' }, `${emoji} ${a}`), ...groups.get(a).map((i) => this.row(i, list)));
      }
      const ticked = visible.filter((x) => x.done);
      if (ticked.length) body.append(h('div', { class: 'fam-aisle' }, '✓ In the cart'), ...ticked.map((i) => this.row(i, list)));
    } else body.append(...visible.map((i) => this.row(i, list)));
    if (!items.length) body.append(h('div', { class: 'fam-muted fam-list-empty' }, 'This list is empty.'));
    clear(main, head, h('div', { class: 'fam-list-add' }, entry, h('button', { class: 'fam-btn primary', onclick: add }, 'Add')), body);
  }

  row(i, list) {
    const m = i.member ? this.store.member(i.member) : null;
    const overdue = i.due && !i.done && i.due < todayYmd();
    return h('div', { class: `fam-item ${i.done ? 'done' : ''}`, style: { '--c': list.color || '#1c7ed6' } },
      h('button', { class: 'fam-item-check', 'aria-label': i.done ? 'Untick' : 'Tick', html: ICONS.check, onclick: () => this.store.put('listitems', { ...i, done: !i.done, doneAt: i.done ? null : Date.now() }).catch((e) => toastError(e)) }),
      h('button', { class: 'fam-item-text', onclick: () => this.editItem(i, list) },
        h('span', {}, i.text),
        i.qty ? h('small', { class: 'fam-item-qty' }, i.qty) : null,
        i.notes ? h('small', {}, i.notes) : null,
        i.due ? h('small', { class: overdue ? 'overdue' : '' }, `Due ${fmtDate(parseYmd(i.due), { weekday: 'short', month: 'short', day: 'numeric' })}`) : null),
      m ? avatar(m, 'xs') : null);
  }

  async addItems(list, lines) {
    const base = Date.now();
    const known = new Set(this.items(list.id).filter((i) => !i.done).map((i) => i.text.toLowerCase()));
    const fresh = lines.filter((t) => !known.has(t.toLowerCase()));
    if (!fresh.length) { toast('Already on the list', { timeout: 2000 }); return; }
    try {
      await this.store.batch(fresh.map((text, n) => ({ op: 'put', col: 'listitems', item: { list: list.id, text: text.slice(0, 300), done: false, order: base + n } })));
    } catch (err) { toastError(err, 'Couldn’t add that'); }
  }

  async clearDone(list, done) {
    try { await this.store.batch(done.map((i) => ({ op: 'delete', col: 'listitems', id: i.id }))); toast(`Cleared ${done.length} item${done.length === 1 ? '' : 's'}`, { timeout: 2000 }); } catch (err) { toastError(err); }
  }

  async editItem(i, list) {
    const text = input({ value: i.text, required: true, autofocus: true, maxlength: 300 });
    const qty = input({ value: i.qty || '', placeholder: 'e.g. 2 lb', maxlength: 40 });
    const notes = input({ value: i.notes || '', placeholder: 'Notes', maxlength: 300 });
    const who = this.assignPicker(i.member ? [i.member] : [], { single: true });
    const due = input({ type: 'date', value: i.due || '' });
    const aisle = select([['', 'Automatic'], ...AISLES.map(([a, e]) => [a, `${e} ${a}`]), ['Other', '🛍️ Other']], i.section || '');
    const moveTo = select(this.lists().map((l) => [l.id, `${l.emoji || '📝'} ${l.title}`]), list.id);
    const out = await sheet(this.app.root, {
      title: 'Item',
      body: h('div', { class: 'fam-form' }, text,
        list.kind === 'grocery' ? h('div', { class: 'fam-row-wrap' }, field('Amount', qty), field('Aisle', aisle)) : h('div', { class: 'fam-row-wrap' }, field('Due', due)),
        notes, field('For', who), field('List', moveTo)),
      actions: [{ label: 'Delete', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({
        ...i, text: text.value.trim() || i.text, qty: qty.value.trim(), notes: notes.value.trim(), member: who.value().find((id) => id !== i.member) || who.value()[0] || null, due: due.value || null, section: aisle.value || null, list: moveTo.value,
      }) }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.store.del('listitems', i.id); else await this.store.put('listitems', out); } catch (err) { toastError(err); }
  }

  async editList(l) {
    const emoji = emojiButton(l?.emoji || '📝');
    const title = input({ value: l?.title || '', placeholder: 'List name', required: true, autofocus: true, maxlength: 80 });
    const kind = select([['grocery', 'Grocery list (sorted into aisles)'], ['todo', 'To-do list'], ['other', 'Other']], l?.kind || 'todo');
    let color = l?.color || '#1c7ed6';
    const colors = colorPicker(color, (c) => { color = c; });
    // Who a to-do list is for. A family member's new list starts as theirs.
    const who = this.assignPicker(l ? l.members || [] : this.selfOnly && this.me ? [this.me.id] : []);
    const whoField = field('For', who, this.selfOnly ? 'You can add or take off only yourself; a parent can assign it to anyone.' : 'Pick nobody to make it everyone’s.');
    const syncKind = () => { whoField.hidden = kind.value !== 'todo'; };
    kind.addEventListener('change', syncKind);
    syncKind();
    const out = await sheet(this.app.root, {
      title: l ? 'List settings' : 'New list',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title), field('Kind', kind), whoField, field('Colour', colors)),
      actions: [l ? { label: 'Delete list', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!title.value.trim()) return title.focus(); close({ ...(l || { order: Date.now() }), title: title.value.trim(), emoji: emoji.value, kind: kind.value, color, members: kind.value === 'todo' ? who.value() : l?.members || [] }); } }],
    });
    if (!out) return;
    try {
      if (out === 'delete') {
        const items = this.items(l.id);
        const sure = await sheet(this.app.root, { title: 'Delete list', body: h('p', {}, `Delete “${l.title}”${items.length ? ` and its ${items.length} item${items.length === 1 ? '' : 's'}` : ''}?`), actions: [{ label: 'Cancel' }, { label: 'Delete', danger: true, value: true }] });
        if (!sure) return;
        await this.store.batch([...items.map((i) => ({ op: 'delete', col: 'listitems', id: i.id })), { op: 'delete', col: 'lists', id: l.id }]);
      } else {
        const [saved] = await this.store.batch([{ op: 'put', col: 'lists', item: out }]);
        this.listId = saved.id;
        this.render(this.el);
      }
    } catch (err) { toastError(err); }
  }
}

// For meals: put ingredients on the first grocery list (making one if there isn't).
export async function addToGroceries(store, lines) {
  let list = store.all('lists').filter((l) => l.kind === 'grocery').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const ops = [];
  if (!list) {
    list = { id: `l-${Date.now().toString(36)}`, title: 'Groceries', emoji: '🛒', color: '#2f9e44', kind: 'grocery', order: 0 };
    ops.push({ op: 'put', col: 'lists', item: list });
  }
  const have = new Set(store.all('listitems').filter((i) => i.list === list.id && !i.done).map((i) => i.text.toLowerCase()));
  const base = Date.now();
  let n = 0;
  for (const raw of lines) {
    const { name, qty } = splitIngredient(raw);
    if (!name || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    ops.push({ op: 'put', col: 'listitems', item: { list: list.id, text: name, qty, done: false, order: base + n++ } });
  }
  if (ops.length) await store.batch(ops);
  return { list, added: n };
}

// "1.5 lb chicken thighs" -> { qty: '1.5 lb', name: 'Chicken thighs' }
export function splitIngredient(line) {
  const m = /^\s*((?:\d+[\d./\s–-]*[½⅓⅔¼¾⅛⅜⅝⅞]?|[½⅓⅔¼¾⅛⅜⅝⅞]|a|an|one|two|three|four|a few|some)\s*(?:(?:cups?|c|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|cans?|jars?|packages?|pkgs?|bags?|boxes?|bunch(?:es)?|heads?|cloves?|slices?|sticks?|pinch(?:es)?|dash(?:es)?|stalks?|large|medium|small)\b\.?)?\s*(?:of\s+)?)?(.*)$/i.exec(String(line));
  let name = (m?.[2] || line).replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim();
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return { qty: (m?.[1] || '').trim(), name };
}
