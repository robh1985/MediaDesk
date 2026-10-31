// Lists: groceries (sorted into aisles as you add them), to-dos with a person and a due date,
// and any other list the family keeps.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, parseYmd, fmtDate, todayYmd } from './dates.js';
import { sheet, field, input, select, avatar, memberPicker, emojiButton, colorPicker, ICONS } from './shared.js';
import { DEFAULT_AISLES, aisles, aisleFor, findAisle, seedAisles, foods, matchFood, ownFood, searchFoods, guessAisle, foodKey, OTHER } from './groceries.js';

// Which aisle a grocery item is in, from the food database; the family's aisles and foods.
export { aisleFor } from './groceries.js';

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
    // Grocery lists suggest foods from the food database as you type.
    const sugg = h('div', { class: 'fam-food-sugg', hidden: true });
    let picks = [];
    let hi = -1;
    const drawSugg = () => {
      const q = entry.value;
      const one = !/[\n,]/.test(q) && q.trim().length >= 1 && list.kind === 'grocery';
      picks = one ? searchFoods(this.store, splitIngredient(q).name || q, 8) : [];
      const exact = picks.some((f) => f.key === foodKey(splitIngredient(q).name || q));
      sugg.hidden = !one;
      if (!one) return;
      const on = new Set(items.filter((i) => !i.done).map((i) => foodKey(i.text)));
      clear(sugg, picks.map((f, n) => h('button', { type: 'button', class: `fam-food-opt ${n === hi ? 'hi' : ''}`, onpointerdown: (e) => e.preventDefault(), onclick: () => pickFood(f) },
        h('span', {}, findAisle(this.store, f.aisle)?.emoji || '🛍️'), h('span', { class: 'fam-food-name' }, f.name),
        on.has(f.key) ? h('small', {}, '✓ On the list') : h('small', {}, findAisle(this.store, f.aisle)?.name || 'Other'))),
      exact ? null : h('button', { type: 'button', class: `fam-food-opt new ${hi === picks.length ? 'hi' : ''}`, onpointerdown: (e) => e.preventDefault(), onclick: () => this.newFood(splitIngredient(q).name || q.trim(), list) }, h('span', {}, '➕'), h('span', { class: 'fam-food-name' }, `Add “${splitIngredient(q).name || q.trim()}” to the foods…`)));
    };
    const pickFood = async (f) => {
      const { qty } = splitIngredient(entry.value);
      entry.value = '';
      hi = -1;
      drawSugg();
      await this.addItems(list, [qty ? `${qty} ${f.name}` : f.name]);
      this.el.querySelector('.fam-list-entry')?.focus();
    };
    entry.addEventListener('input', () => { hi = -1; drawSugg(); });
    entry.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 150));
    entry.addEventListener('focus', () => { if (entry.value) drawSugg(); });
    entry.addEventListener('keydown', (e) => {
      const n = sugg.hidden ? 0 : sugg.children.length;
      if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : n - 1) + (hi < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n; drawSugg(); return; }
      if (e.key === 'Escape' && !sugg.hidden) { e.stopPropagation(); sugg.hidden = true; return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hi >= 0 && hi < picks.length) pickFood(picks[hi]);
        else if (hi >= 0 && hi === picks.length) this.newFood(splitIngredient(entry.value).name || entry.value.trim(), list);
        else { sugg.hidden = true; add(); }
      }
    });
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
      list.kind === 'grocery' ? h('button', { class: 'fam-btn', onclick: () => this.browseFoods(list) }, '🥕 Foods') : null,
      list.kind === 'grocery' ? h('button', { class: 'fam-btn', onclick: () => this.manageAisles() }, '🗂️ Aisles') : null,
      h('button', { class: 'fam-icon-btn', title: 'List settings', html: ICONS.edit, onclick: () => this.editList(list) }));
    const body = h('div', { class: 'fam-list-items' });
    const visible = items.filter((i) => this.showDone || !i.done);
    if (list.kind === 'grocery' && list.group !== false) {
      const order = aisles(this.store);
      const groups = new Map();
      for (const i of visible.filter((x) => !x.done)) { const a = aisleFor(this.store, i); if (!groups.has(a.id)) groups.set(a.id, { a, items: [] }); groups.get(a.id).items.push(i); }
      const pos = (id) => { const n = order.findIndex((a) => a.id === id); return n < 0 ? 999 : n; };
      for (const { a, items: here } of [...groups.values()].sort((x, y) => pos(x.a.id) - pos(y.a.id))) {
        body.append(h('div', { class: 'fam-aisle', dataset: { aisle: a.id } }, `${a.emoji || '🛍️'} ${a.name}`), ...here.map((i) => this.row(i, list, a)));
      }
      const ticked = visible.filter((x) => x.done);
      if (ticked.length) body.append(h('div', { class: 'fam-aisle' }, '✓ In the cart'), ...ticked.map((i) => this.row(i, list)));
    } else body.append(...visible.map((i) => this.row(i, list)));
    if (!items.length) body.append(h('div', { class: 'fam-muted fam-list-empty' }, 'This list is empty.'));
    clear(main, head, h('div', { class: 'fam-list-add' }, h('div', { class: 'fam-list-entry-wrap' }, entry, sugg), h('button', { class: 'fam-btn primary', onclick: add }, 'Add')), body);
  }

  row(i, list, aisle = null) {
    const m = i.member ? this.store.member(i.member) : null;
    const overdue = i.due && !i.done && i.due < todayYmd();
    return h('div', { class: `fam-item ${i.done ? 'done' : ''}`, style: { '--c': list.color || '#1c7ed6' } },
      h('button', { class: 'fam-item-check', 'aria-label': i.done ? 'Untick' : 'Tick', html: ICONS.check, onclick: () => this.store.put('listitems', { ...i, done: !i.done, doneAt: i.done ? null : Date.now() }).catch((e) => toastError(e)) }),
      h('button', { class: 'fam-item-text', onclick: () => this.editItem(i, list) },
        h('span', {}, i.text),
        i.qty ? h('small', { class: 'fam-item-qty' }, i.qty) : null,
        i.notes ? h('small', {}, i.notes) : null,
        i.due ? h('small', { class: overdue ? 'overdue' : '' }, `Due ${fmtDate(parseYmd(i.due), { weekday: 'short', month: 'short', day: 'numeric' })}`) : null),
      m ? avatar(m, 'xs') : null,
      aisle ? h('button', { class: 'fam-item-aisle', title: `In ${aisle.name} — change the aisle`, 'aria-label': `Aisle: ${aisle.name}. Change`, onclick: () => this.pickAisle(i) }, aisle.emoji || '🛍️') : null);
  }

  async addItems(list, lines) {
    const base = Date.now();
    const grocery = list.kind === 'grocery';
    const key = (t) => (grocery ? foodKey(t) : t.toLowerCase());
    const known = new Set(this.items(list.id).filter((i) => !i.done).map((i) => key(i.text)));
    const ops = [];
    const learned = [];
    for (const line of lines) {
      // Groceries: "2 lb chicken thighs" is Chicken thighs, 2 lb; the food's own name is used.
      let { name, qty } = grocery ? splitIngredient(line) : { name: line, qty: '' };
      if (!name || known.has(key(name))) continue;
      known.add(key(name));
      if (grocery) {
        const food = matchFood(this.store, name);
        if (food && food.key === foodKey(name)) name = food.name;
        // Foods not in the database yet are added to it, in the aisle they seem to belong in.
        if (!food && !learned.some((f) => foodKey(f) === foodKey(name))) {
          learned.push(name);
          ops.push({ op: 'put', col: 'foods', item: { name: name.slice(0, 80), aisle: guessAisle(name) } });
        }
      }
      ops.push({ op: 'put', col: 'listitems', item: { list: list.id, text: name.slice(0, 300), qty: qty || undefined, done: false, order: base + ops.length } });
    }
    if (!ops.length) { toast('Already on the list', { timeout: 2000 }); return; }
    try {
      await this.store.batch(ops);
      if (learned.length) toast(`Added ${learned.length === 1 ? `“${learned[0]}”` : `${learned.length} new foods`} to the foods`, { timeout: 3000, body: 'Put in the wrong aisle? Tap its aisle button to move it.' });
    } catch (err) { toastError(err, 'Couldn’t add that'); }
  }

  // --- Aisles and foods ---------------------------------------------------------------

  aisleSelect(value) {
    const sel = select([...aisles(this.store).map((a) => [a.id, `${a.emoji || '🛍️'} ${a.name}`]), ['__new', '➕ New aisle…']], value || OTHER);
    let last = sel.value;
    sel.addEventListener('change', async () => {
      if (sel.value !== '__new') { last = sel.value; return; }
      const made = await this.newAisle();
      if (made) { sel.insertBefore(h('option', { value: made.id }, `${made.emoji || '🛍️'} ${made.name}`), sel.querySelector('option[value=__new]')); sel.value = made.id; last = made.id; } else sel.value = last;
    });
    return sel;
  }

  // Put an item in another aisle, and remember it for that food.
  async setAisle(i, aisleId) {
    const ops = [{ op: 'put', col: 'listitems', item: { ...i, section: aisleId } }];
    const own = ownFood(this.store, i.text);
    if (own) ops.push({ op: 'put', col: 'foods', item: { ...own, aisle: aisleId, hidden: false } });
    else ops.push({ op: 'put', col: 'foods', item: { name: i.text.slice(0, 80), aisle: aisleId } });
    try { await this.store.batch(ops); } catch (err) { toastError(err); }
  }

  async pickAisle(i) {
    const current = aisleFor(this.store, i);
    const out = sheet(this.app.root, {
      title: `Aisle for ${i.text}`,
      body: h('div', { class: 'fam-form' },
        h('div', { class: 'fam-aisle-grid' }, aisles(this.store).map((a) => h('button', { type: 'button', class: `fam-chip ${a.id === current.id ? 'on' : ''}`, onclick: () => out.close(a.id) }, h('span', {}, a.emoji || '🛍️'), a.name)),
          h('button', { type: 'button', class: 'fam-chip new', onclick: async () => { const made = await this.newAisle(); if (made) out.close(made.id); } }, h('span', {}, '➕'), 'New aisle')),
        h('p', { class: 'fam-muted small' }, `${i.text} will go in this aisle from now on.`)),
      actions: [{ label: 'Cancel' }],
    });
    const id = await out;
    if (id && id !== current.id) await this.setAisle(i, id);
  }

  async newAisle(a = null) {
    const emoji = emojiButton(a?.emoji || '🛍️');
    const name = input({ value: a?.name || '', placeholder: 'e.g. International foods', required: true, autofocus: true, maxlength: 40 });
    const list = aisles(this.store);
    const after = a ? null : select([['', 'At the end'], ...list.filter((x) => x.id !== OTHER).map((x) => [x.id, `After ${x.name}`])], '');
    const out = await sheet(this.app.root, {
      title: a ? 'Aisle' : 'New aisle',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, name), after ? field('Where it is in the store', after) : null),
      actions: [{ label: 'Cancel' }, { label: a ? 'Save' : 'Add aisle', primary: true, submit: true, onClick: (close) => {
        const n = name.value.trim();
        if (!n) return name.focus();
        if (list.some((x) => x.name.toLowerCase() === n.toLowerCase() && x.id !== a?.id)) { toast(`There’s already an aisle called ${n}`, { timeout: 2500 }); return; }
        close({ name: n, emoji: emoji.value, after: after?.value });
      } }],
    });
    if (!out) return null;
    const ops = seedAisles(this.store);
    let item;
    if (a) item = { ...a, name: out.name, emoji: out.emoji };
    else {
      // Number the aisles again so the new one sits where it was put.
      const ordered = list.filter((x) => x.id !== OTHER);
      const at = out.after ? ordered.findIndex((x) => x.id === out.after) + 1 : ordered.length;
      item = { id: `a-${Date.now().toString(36)}`, name: out.name, emoji: out.emoji };
      ordered.splice(at, 0, item);
      ordered.forEach((x, n) => { if (x !== item) ops.push({ op: 'put', col: 'aisles', item: { ...x, order: n } }); });
      item.order = at;
    }
    ops.push({ op: 'put', col: 'aisles', item });
    try { await this.store.batch(ops); return item; } catch (err) { toastError(err); return null; }
  }

  // The aisles in the order they are in the family's store: renamed, moved, added or removed.
  async manageAisles() {
    const body = h('div', { class: 'fam-aisle-list' });
    const draw = () => {
      const list = aisles(this.store);
      clear(body, list.map((a, n) => h('div', { class: 'fam-aisle-row' },
        h('span', { class: 'fam-aisle-emoji' }, a.emoji || '🛍️'), h('span', { class: 'fam-aisle-name' }, a.name),
        h('small', { class: 'fam-muted' }, `${foods(this.store).filter((f) => f.aisle === a.id).length} foods`),
        a.id === OTHER ? h('small', { class: 'fam-muted' }, 'Always last') : [
          h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': `Move ${a.name} up`, disabled: n === 0, onclick: () => move(n, -1) }, '↑'),
          h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': `Move ${a.name} down`, disabled: n >= list.length - 2, onclick: () => move(n, 1) }, '↓'),
          h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': `Rename ${a.name}`, html: ICONS.edit, onclick: async () => { await this.newAisle(a); draw(); } }),
          h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': `Remove ${a.name}`, html: ICONS.trash || ICONS.close, onclick: () => remove(a) })])),
      h('button', { type: 'button', class: 'fam-btn', onclick: async () => { await this.newAisle(); draw(); } }, h('span', { html: ICONS.plus }), 'New aisle'),
      this.store.all('aisles').length ? h('button', { type: 'button', class: 'fam-btn', onclick: () => restore() }, 'Restore the standard aisles') : null);
    };
    const move = async (n, d) => {
      const list = aisles(this.store).filter((x) => x.id !== OTHER);
      const [a] = list.splice(n, 1);
      list.splice(n + d, 0, a);
      const ops = seedAisles(this.store);
      list.forEach((x, i) => ops.push({ op: 'put', col: 'aisles', item: { ...x, order: i } }));
      try { await this.store.batch(ops); } catch (err) { toastError(err); }
      draw();
    };
    const remove = async (a) => {
      const sure = await sheet(this.app.root, { title: `Remove ${a.name}?`, body: h('p', {}, 'Foods and items in this aisle go back to the aisle they’d normally be in (or Other).'), actions: [{ label: 'Cancel' }, { label: 'Remove', danger: true, value: true }] });
      if (!sure) return;
      const ops = [...seedAisles(this.store), { op: 'delete', col: 'aisles', id: a.id }];
      for (const f of this.store.all('foods')) if (f.aisle === a.id) ops.push({ op: 'put', col: 'foods', item: { ...f, aisle: guessAisle(f.name) === a.id ? OTHER : guessAisle(f.name) } });
      for (const i of this.store.all('listitems')) if (i.section === a.id) ops.push({ op: 'put', col: 'listitems', item: { ...i, section: null } });
      try { await this.store.batch(ops); } catch (err) { toastError(err); }
      draw();
    };
    const restore = async () => {
      const sure = await sheet(this.app.root, { title: 'Restore the standard aisles?', body: h('p', {}, 'Aisles you added are removed, and the standard ones come back in their usual order. Foods in removed aisles go back to their usual aisle.'), actions: [{ label: 'Cancel' }, { label: 'Restore', danger: true, value: true }] });
      if (!sure) return;
      const std = new Set(DEFAULT_AISLES.map((a) => a.id));
      const ops = this.store.all('aisles').filter((a) => !std.has(a.id)).map((a) => ({ op: 'delete', col: 'aisles', id: a.id }));
      for (const a of DEFAULT_AISLES) ops.push({ op: 'put', col: 'aisles', item: { ...a } });
      for (const f of this.store.all('foods')) if (f.aisle && !std.has(f.aisle)) ops.push({ op: 'put', col: 'foods', item: { ...f, aisle: guessAisle(f.name) } });
      try { await this.store.batch(ops); } catch (err) { toastError(err); }
      draw();
    };
    draw();
    await sheet(this.app.root, { title: 'Aisles', body: h('div', { class: 'fam-form' }, h('p', { class: 'fam-muted' }, 'Put the aisles in the order you walk through your store; grocery lists follow it.'), body), actions: [{ label: 'Done', primary: true, value: true }] });
  }

  // A food missing from the database: its name and aisle.
  async newFood(name, list = null) {
    const n = input({ value: name || '', placeholder: 'Food name', required: true, autofocus: true, maxlength: 80 });
    const aisle = this.aisleSelect(guessAisle(name || ''));
    const out = await sheet(this.app.root, {
      title: 'Add a food',
      body: h('div', { class: 'fam-form' }, n, field('Aisle', aisle), list ? h('p', { class: 'fam-muted small' }, `It’s added to ${list.title} too.`) : null),
      actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, submit: true, onClick: (close) => { if (!n.value.trim()) return n.focus(); close({ name: n.value.trim(), aisle: aisle.value === '__new' ? OTHER : aisle.value }); } }],
    });
    if (!out) return null;
    const own = ownFood(this.store, out.name);
    try {
      await this.store.batch([{ op: 'put', col: 'foods', item: { ...(own || {}), name: out.name, aisle: out.aisle, hidden: false } }]);
      if (list) {
        const entry = this.el?.querySelector('.fam-list-entry');
        const qty = entry ? splitIngredient(entry.value).qty : '';
        if (entry) entry.value = '';
        await this.addItems(list, [qty ? `${qty} ${out.name}` : out.name]);
      }
      return out;
    } catch (err) { toastError(err); return null; }
  }

  async editFood(f) {
    const n = input({ value: f.name, required: true, autofocus: true, maxlength: 80 });
    const aisle = this.aisleSelect(findAisle(this.store, f.aisle)?.id || OTHER);
    const out = await sheet(this.app.root, {
      title: 'Food',
      body: h('div', { class: 'fam-form' }, n, field('Aisle', aisle), f.builtin ? h('p', { class: 'fam-muted small' }, 'One of the standard foods.') : null),
      actions: [{ label: 'Remove', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!n.value.trim()) return n.focus(); close({ name: n.value.trim(), aisle: aisle.value === '__new' ? OTHER : aisle.value }); } }],
    });
    if (!out) return;
    const own = ownFood(this.store, f.name);
    const ops = [];
    if (out === 'delete') {
      // A standard food is hidden; the family's own is deleted.
      if (f.builtin) ops.push({ op: 'put', col: 'foods', item: { ...(own || {}), name: f.name, aisle: f.aisle, hidden: true } });
      else if (own) ops.push({ op: 'delete', col: 'foods', id: own.id });
    } else {
      const renamed = foodKey(out.name) !== foodKey(f.name);
      if (renamed && f.builtin) ops.push({ op: 'put', col: 'foods', item: { ...(own || {}), name: f.name, aisle: f.aisle, hidden: true } });
      const target = renamed ? ownFood(this.store, out.name) || (f.builtin ? null : own) : own;
      ops.push({ op: 'put', col: 'foods', item: { ...(target || {}), name: out.name, aisle: out.aisle, hidden: false } });
    }
    try { await this.store.batch(ops); } catch (err) { toastError(err); }
  }

  // Browse the food database by aisle and tap foods onto the list.
  async browseFoods(list) {
    const q = input({ type: 'search', placeholder: 'Search foods', autofocus: true, class: 'fam-input' });
    let only = '';
    const chips = h('div', { class: 'fam-row-wrap fam-food-aisles' });
    const body = h('div', { class: 'fam-food-browse' });
    const onList = () => new Map(this.items(list.id).filter((i) => !i.done).map((i) => [foodKey(i.text), i]));
    const draw = () => {
      const all = aisles(this.store);
      clear(chips, h('button', { type: 'button', class: `fam-chip ${only ? '' : 'on'}`, onclick: () => { only = ''; draw(); } }, 'All aisles'),
        all.map((a) => h('button', { type: 'button', class: `fam-chip ${only === a.id ? 'on' : ''}`, onclick: () => { only = only === a.id ? '' : a.id; draw(); } }, `${a.emoji || '🛍️'} ${a.name}`)));
      const term = q.value.trim();
      const have = onList();
      const shown = (term ? searchFoods(this.store, term, 500) : foods(this.store)).filter((f) => !only || (findAisle(this.store, f.aisle)?.id || OTHER) === only);
      const groups = new Map(all.map((a) => [a.id, []]));
      for (const f of shown) (groups.get(findAisle(this.store, f.aisle)?.id || OTHER) || groups.get(OTHER)).push(f);
      clear(body, [...groups].filter(([, fs]) => fs.length).map(([id, fs]) => {
        const a = all.find((x) => x.id === id);
        return h('section', {}, h('div', { class: 'fam-aisle' }, `${a.emoji || '🛍️'} ${a.name}`),
          h('div', { class: 'fam-food-grid' }, fs.sort((x, y) => x.name.localeCompare(y.name)).map((f) => {
            const it = have.get(f.key);
            return h('div', { class: `fam-food ${it ? 'on' : ''}` },
              h('button', { type: 'button', class: 'fam-food-toggle', 'aria-pressed': String(Boolean(it)), onclick: async () => {
                try { if (it) await this.store.del('listitems', it.id); else await this.addItems(list, [f.name]); } catch (err) { toastError(err); }
                draw();
              } }, h('span', { class: 'fam-food-tick' }, it ? '✓' : '+'), f.name),
              h('button', { type: 'button', class: 'fam-food-edit', 'aria-label': `Change ${f.name}`, html: ICONS.edit, onclick: async () => { await this.editFood(f); draw(); } }));
          })));
      }), shown.length ? null : h('div', { class: 'fam-muted' }, term ? `“${term}” isn’t in the foods yet.` : 'No foods in this aisle yet.'),
      term && !shown.some((f) => f.key === foodKey(term)) ? h('button', { type: 'button', class: 'fam-btn', onclick: async () => { await this.newFood(term, list); q.value = ''; draw(); } }, `➕ Add “${term}” as a food`) : null);
    };
    q.addEventListener('input', draw);
    draw();
    await sheet(this.app.root, {
      title: `Foods for ${list.title}`, wide: true, cls: 'fam-foods-sheet',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-row-wrap' }, q, h('button', { type: 'button', class: 'fam-btn', onclick: async () => { await this.newFood(q.value.trim()); draw(); } }, '➕ Add a food')), chips, body),
      actions: [{ label: 'Done', primary: true, value: true }],
    });
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
    const aisle = this.aisleSelect(aisleFor(this.store, i).id);
    const wasAisle = aisle.value;
    const moveTo = select(this.lists().map((l) => [l.id, `${l.emoji || '📝'} ${l.title}`]), list.id);
    const out = await sheet(this.app.root, {
      title: 'Item',
      body: h('div', { class: 'fam-form' }, text,
        list.kind === 'grocery' ? h('div', { class: 'fam-row-wrap' }, field('Amount', qty), field('Aisle', aisle)) : h('div', { class: 'fam-row-wrap' }, field('Due', due)),
        notes, field('For', who), field('List', moveTo)),
      actions: [{ label: 'Delete', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close({
        ...i, text: text.value.trim() || i.text, qty: qty.value.trim(), notes: notes.value.trim(), member: who.value().find((id) => id !== i.member) || who.value()[0] || null, due: due.value || null, section: list.kind === 'grocery' && aisle.value !== wasAisle && aisle.value !== '__new' ? aisle.value : i.section || null, list: moveTo.value,
      }) }],
    });
    if (!out) return;
    try {
      if (out === 'delete') await this.store.del('listitems', i.id);
      else if (out.section && out.section !== i.section) await this.setAisle(out, out.section); // remembered for the food
      else await this.store.put('listitems', out);
    } catch (err) { toastError(err); }
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
  const m = /^\s*((?:\d+[\d./\s–-]*[½⅓⅔¼¾⅛⅜⅝⅞]?|[½⅓⅔¼¾⅛⅜⅝⅞]|(?:a few|an|a|one|two|three|four|some)\b)\s*(?:(?:cups?|c|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|cans?|jars?|packages?|pkgs?|bags?|boxes?|bunch(?:es)?|heads?|cloves?|slices?|sticks?|pinch(?:es)?|dash(?:es)?|stalks?|large|medium|small)\b\.?)?\s*(?:of\s+)?)?(.*)$/i.exec(String(line));
  let name = (m?.[2] || line).replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim();
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return { qty: (m?.[1] || '').trim(), name };
}
