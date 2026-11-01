// Trip Planner: packing lists and to-dos. Packing lists have categories, quantities, who packs
// what, and bags (with how much they weigh); they can start from a template, and be saved as one.
// To-dos have a due date, a priority and someone to do them.

import { h, clear, toast, toastError } from '../../ui.js';
import { api } from './store.js';
import { avatar, sheet, field, input, select, emptyState, fmtDay, today } from './util.js';

const BUILT_IN = [
  { id: 'b-basics', name: 'The basics', items: [['Passport / ID', 'Documents'], ['Tickets & bookings', 'Documents'], ['Travel insurance', 'Documents'], ['Bank cards & cash', 'Documents'], ['Phone & charger', 'Electronics'], ['Power bank', 'Electronics'], ['Travel adapter', 'Electronics'], ['Headphones', 'Electronics'], ['Toothbrush & toothpaste', 'Toiletries'], ['Deodorant', 'Toiletries'], ['Medicines', 'Toiletries'], ['Underwear', 'Clothes', 5], ['Socks', 'Clothes', 5], ['T-shirts', 'Clothes', 4], ['Trousers', 'Clothes', 2], ['Pyjamas', 'Clothes'], ['Jumper', 'Clothes']] },
  { id: 'b-beach', name: 'Beach', items: [['Swimsuit', 'Clothes', 2], ['Sunscreen', 'Toiletries'], ['Sunglasses', 'Accessories'], ['Sun hat', 'Accessories'], ['Beach towel', 'Accessories'], ['Flip-flops', 'Clothes'], ['After-sun', 'Toiletries'], ['Book', 'Other']] },
  { id: 'b-hiking', name: 'Hiking', items: [['Walking boots', 'Clothes'], ['Rain jacket', 'Clothes'], ['Fleece', 'Clothes'], ['Daypack', 'Gear'], ['Water bottle', 'Gear'], ['First-aid kit', 'Gear'], ['Map / offline maps', 'Gear'], ['Head torch', 'Gear'], ['Snacks', 'Food'], ['Blister plasters', 'Toiletries']] },
  { id: 'b-city', name: 'City break', items: [['Comfortable shoes', 'Clothes'], ['Day bag', 'Accessories'], ['Umbrella', 'Accessories'], ['Smart outfit', 'Clothes'], ['Guidebook / app', 'Other'], ['Reusable bottle', 'Accessories']] },
  { id: 'b-winter', name: 'Winter', items: [['Warm coat', 'Clothes'], ['Gloves', 'Clothes'], ['Hat & scarf', 'Clothes'], ['Thermals', 'Clothes', 2], ['Lip balm', 'Toiletries'], ['Boots', 'Clothes']] },
  { id: 'b-baby', name: 'With a baby', items: [['Nappies', 'Baby', 30], ['Wipes', 'Baby', 3], ['Baby food & bottles', 'Baby'], ['Pushchair', 'Baby'], ['Baby carrier', 'Baby'], ['Toys', 'Baby'], ['Calpol', 'Baby']] },
].map((t) => ({ ...t, builtIn: true, items: t.items.map(([text, category, quantity = 1]) => ({ text, category, quantity })) }));

const PRIORITY = { high: ['High', '#e03131'], normal: ['Normal', '#868e96'], low: ['Low', '#adb5bd'] };

export class ListsView {
  constructor(app, kind) { this.app = app; this.store = app.store; this.kind = kind; this.listId = null; this.show = 'all'; }

  lists() { return this.store.all('lists').filter((l) => (l.kind || 'packing') === this.kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }

  render(el) {
    this.el = el;
    const lists = this.lists();
    if (!lists.some((l) => l.id === this.listId)) this.listId = lists[0]?.id || null;
    const list = this.listId && this.store.get('lists', this.listId);
    const packing = this.kind === 'packing';
    clear(el, h('div', { class: 'tp-page' },
      h('div', { class: 'tp-page-head' },
        h('div', { class: 'tp-seg tp-listtabs' }, lists.map((l) => h('button', { class: l.id === this.listId ? 'on' : '', onclick: () => { this.listId = l.id; this.render(el); }, ondblclick: () => this.rename(l) }, `${l.name} (${this.entries(l.id).filter((e) => e.done).length}/${this.entries(l.id).length})`)),
          h('button', { title: 'A new list', onclick: () => this.newList() }, '＋')),
        h('span', { class: 'tp-grow' }),
        list ? h('select', { class: 'input tp-mini', 'aria-label': 'Show', onchange: (e) => { this.show = e.target.value; this.render(el); } }, [['all', 'Everything'], ['todo', packing ? 'Not packed yet' : 'Not done yet'], ['mine', 'By person'], ...(packing ? [['bags', 'By bag']] : [])].map(([v, l]) => h('option', { value: v, selected: this.show === v }, l))) : null,
        list && packing ? h('button', { class: 'btn', onclick: () => this.templates(list) }, '📋 Templates') : null,
        list ? h('button', { class: 'btn', onclick: () => this.listMenu(list) }, '⋯') : null),
      list ? this.drawList(list) : emptyState(packing ? '🧳' : '✅', packing ? 'No packing list yet.' : 'No to-do list yet.', h('button', { class: 'btn btn-primary', onclick: () => this.newList() }, packing ? 'Start a packing list' : 'Start a to-do list'))));
  }

  entries(listId) { return this.store.all('entries').filter((e) => e.list === listId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }

  drawList(list) {
    const packing = this.kind === 'packing';
    let entries = this.entries(list.id);
    if (this.show === 'todo') entries = entries.filter((e) => !e.done);
    if (!packing) entries.sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9').localeCompare(b.due || '9') || ['high', 'normal', 'low'].indexOf(a.priority || 'normal') - ['high', 'normal', 'low'].indexOf(b.priority || 'normal'));
    const all = this.entries(list.id);
    const pct = all.length ? Math.round((all.filter((e) => e.done).length / all.length) * 100) : 0;
    // Add a line: "3 socks @Clothes".
    const add = input({ placeholder: packing ? 'Add something to pack… (e.g. “2 swimsuits @Clothes”)' : 'Add a to-do…', class: 'input tp-add' });
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      e.preventDefault();
      let text = add.value.trim();
      let category = null;
      let quantity = 1;
      const cat = /\s@(\S.*)$/.exec(text);
      if (cat) { category = cat[1].trim(); text = text.slice(0, cat.index).trim(); }
      const q = /^(\d{1,3})\s*[x×]?\s+(.+)$/i.exec(text);
      if (packing && q) { quantity = Number(q[1]); text = q[2]; }
      this.store.put('entries', { list: list.id, text, category: category || (packing ? this.lastCategory || null : null), quantity, done: false, order: all.length }, { label: 'add' }).catch(toastError);
      add.value = '';
    });
    let groups;
    if (this.show === 'mine') groups = this.groupBy(entries, (e) => e.assignee || '', (k) => this.store.member(k)?.name || 'Anyone');
    else if (this.show === 'bags') groups = this.groupBy(entries, (e) => e.bag || '', (k) => this.store.get('bags', k)?.name || 'Not in a bag');
    else if (packing) groups = this.groupBy(entries, (e) => e.category || '', (k) => k || 'Other');
    else groups = [['', '', entries]];
    return h('div', { class: 'tp-listbody' },
      h('div', { class: 'tp-progress' }, h('div', { style: { width: `${pct}%` } }), h('span', {}, `${pct}% ${packing ? 'packed' : 'done'}`)),
      add,
      packing ? this.drawBags() : null,
      entries.length ? groups.map(([k, label, list2]) => h('section', { class: 'tp-group' }, label ? h('h5', {}, label, h('small', { class: 'muted' }, ` ${list2.filter((e) => e.done).length}/${list2.length}`)) : null, list2.map((e) => this.entryRow(e))))
        : h('p', { class: 'muted small tp-pad' }, this.show === 'todo' ? 'All done! 🎉' : 'Nothing here yet.'));
  }

  groupBy(entries, key, label) {
    const m = new Map();
    for (const e of entries) { const k = key(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : label(a[0]).localeCompare(label(b[0])))).map(([k, list]) => [k, label(k), list]);
  }

  entryRow(e) {
    const packing = this.kind === 'packing';
    const who = e.assignee && this.store.member(e.assignee);
    const bag = e.bag && this.store.get('bags', e.bag);
    const overdue = !packing && !e.done && e.due && e.due < today();
    return h('div', { class: `tp-entry ${e.done ? 'done' : ''}` },
      h('input', { type: 'checkbox', checked: Boolean(e.done), 'aria-label': e.text, onchange: (ev) => this.store.put('entries', { ...e, done: ev.target.checked }, { label: ev.target.checked ? 'tick' : 'untick' }).catch(toastError) }),
      h('button', { class: 'tp-entry-main', onclick: () => this.editEntry(e) },
        packing && e.quantity > 1 ? h('span', { class: 'tp-qty' }, `${e.quantity}×`) : null,
        h('span', { class: 'tp-entry-text' }, e.text),
        !packing && e.priority === 'high' ? h('span', { class: 'tp-status', style: { '--c': PRIORITY.high[1] } }, 'High') : null,
        !packing && e.due ? h('small', { class: overdue ? 'tp-over' : 'muted' }, `📅 ${fmtDay(e.due)}`) : null,
        bag && this.show !== 'bags' ? h('small', { class: 'muted' }, `🎒 ${bag.name}`) : null,
        packing && e.weight ? h('small', { class: 'muted' }, `${e.weight * (e.quantity || 1)} g`) : null),
      who && this.show !== 'mine' ? avatar(who, 22) : null);
  }

  async editEntry(e) {
    const packing = this.kind === 'packing';
    const trip = this.store.trip;
    const text = input({ value: e.text, autofocus: true });
    const cats = [...new Set(this.store.all('entries').filter((x) => x.list === e.list).map((x) => x.category).filter(Boolean))];
    const cat = input({ value: e.category || '', list: 'tp-cats' });
    const qty = input({ type: 'number', min: 1, max: 999, value: e.quantity || 1 });
    const weight = input({ type: 'number', min: 0, step: 10, value: e.weight || '', placeholder: 'grams each' });
    const who = select([['', 'Anyone'], ...trip.members.map((m) => [m.id, m.name])], e.assignee || '');
    const bag = select([['', 'No bag'], ...this.store.all('bags').map((b) => [b.id, b.name])], e.bag || '');
    const due = input({ type: 'date', value: e.due || '' });
    const prio = select(Object.entries(PRIORITY).map(([k, [l]]) => [k, l]), e.priority || 'normal');
    const r = await sheet(this.app.root, {
      title: packing ? 'Item' : 'To-do',
      body: h('div', { class: 'tp-form' }, field(packing ? 'What' : 'To do', text),
        packing ? [h('div', { class: 'tp-row' }, field('Category', cat), field('How many', qty)), h('datalist', { id: 'tp-cats' }, cats.map((c) => h('option', { value: c }))), h('div', { class: 'tp-row' }, field('In the bag', bag), field('Weight', weight))]
          : h('div', { class: 'tp-row' }, field('By', due), field('Priority', prio)),
        field(packing ? 'Who packs it' : 'Who does it', who)),
      actions: [{ label: 'Delete', danger: true, left: true, value: 'delete' }, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') return this.store.del('entries', e.id, { label: 'delete' }).catch(toastError);
    if (r !== 'save') return;
    if (packing && cat.value.trim()) this.lastCategory = cat.value.trim();
    this.store.put('entries', { ...e, text: text.value.trim() || e.text, ...(packing ? { category: cat.value.trim() || null, quantity: Number(qty.value) || 1, bag: bag.value || null, weight: Number(weight.value) || null } : { due: due.value || null, priority: prio.value }), assignee: who.value || null }, { label: 'change' }).catch(toastError);
  }

  // Bags: their weight from what's in them, against a limit.
  drawBags() {
    const bags = this.store.all('bags');
    const weightOf = (b) => this.store.all('entries').filter((e) => e.bag === b.id).reduce((a, e) => a + (e.weight || 0) * (e.quantity || 1), 0) / 1000 + (Number(b.empty) || 0);
    return h('div', { class: 'tp-bags' }, bags.map((b) => {
      const w = weightOf(b);
      const over = b.limit && w > b.limit;
      return h('button', { class: `tp-bag ${over ? 'over' : ''}`, onclick: () => this.editBag(b) }, h('span', {}, `🎒 ${b.name}`), h('small', {}, `${w.toFixed(1)} kg${b.limit ? ` / ${b.limit} kg` : ''}`), b.owner ? avatar(this.store.member(b.owner), 18) : null);
    }), h('button', { class: 'tp-bag add', onclick: () => this.editBag(null) }, '＋ Bag'));
  }
  async editBag(b) {
    const trip = this.store.trip;
    const name = input({ value: b?.name || '', placeholder: 'Big suitcase', autofocus: true });
    const limit = input({ type: 'number', min: 0, step: 0.5, value: b?.limit || '', placeholder: 'kg' });
    const empty = input({ type: 'number', min: 0, step: 0.1, value: b?.empty || '', placeholder: 'kg' });
    const owner = select([['', 'Anyone'], ...trip.members.map((m) => [m.id, m.name])], b?.owner || '');
    const r = await sheet(this.app.root, {
      title: b ? 'Bag' : 'Add a bag',
      body: h('div', { class: 'tp-form' }, field('Name', name), h('div', { class: 'tp-row' }, field('Weight limit', limit), field('Weighs empty', empty)), field('Whose', owner)),
      actions: [b ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') { await this.store.batch([{ op: 'delete', col: 'bags', id: b.id }, ...this.store.all('entries').filter((e) => e.bag === b.id).map((e) => ({ op: 'put', col: 'entries', item: { ...e, bag: null } }))], { label: 'delete bag' }).catch(toastError); return; }
    if (r === 'save') this.store.put('bags', { ...(b || {}), name: name.value.trim() || 'Bag', limit: Number(limit.value) || null, empty: Number(empty.value) || null, owner: owner.value || null }, { label: 'bag' }).catch(toastError);
  }

  async newList() {
    const packing = this.kind === 'packing';
    const name = input({ value: packing ? (this.lists().length ? 'Packing' : 'Packing') : 'To do', autofocus: true });
    const r = await sheet(this.app.root, { title: 'A new list', body: field('Name', name), actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, submit: true, value: true }] });
    if (!r) return;
    const saved = await this.store.put('lists', { kind: this.kind, name: name.value.trim() || 'List', order: this.lists().length }, { label: 'new list' }).catch(toastError);
    if (saved) { this.listId = saved.id; this.render(this.el); if (packing && !this.entries(saved.id).length) this.templates(saved); }
  }
  async rename(l) {
    const name = input({ value: l.name, autofocus: true });
    const r = await sheet(this.app.root, { title: 'Rename the list', body: field('Name', name), actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: true }] });
    if (r) this.store.put('lists', { ...l, name: name.value.trim() || l.name }, { label: 'rename' }).catch(toastError);
  }
  listMenu(l) {
    const packing = this.kind === 'packing';
    const close = () => document.querySelector('.tp-overlay:last-child')?.remove();
    sheet(this.app.root, {
      title: l.name,
      body: h('div', { class: 'tp-menu-list' },
        h('button', { class: 'btn', onclick: () => { close(); this.rename(l); } }, '✎ Rename'),
        h('button', { class: 'btn', onclick: () => { close(); const done = this.entries(l.id).filter((e) => e.done); if (done.length) this.store.batch(done.map((e) => ({ op: 'put', col: 'entries', item: { ...e, done: false } })), { label: 'untick all' }); } }, packing ? '↺ Unpack everything (for the way home)' : '↺ Untick everything'),
        h('button', { class: 'btn', onclick: () => { close(); const done = this.entries(l.id).filter((e) => e.done); if (done.length) this.store.batch(done.map((e) => ({ op: 'delete', col: 'entries', id: e.id })), { label: 'clear done' }); } }, '🧹 Remove ticked items'),
        packing ? h('button', { class: 'btn', onclick: () => { close(); this.saveTemplate(l); } }, '💾 Save as a template') : null,
        h('button', { class: 'btn btn-danger', onclick: () => { close(); this.store.del('lists', l.id, { label: `delete ${l.name}` }).catch(toastError); toast(`Deleted ${l.name}`, { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.undo() } }); } }, '🗑 Delete the list')),
    });
  }

  // Templates: built in, or saved from a list.
  async templates(list) {
    let saved = [];
    try { saved = (await api('templates')).templates; } catch { /* only the built-in ones */ }
    const all = [...BUILT_IN, ...saved];
    const chosen = new Set();
    const body = h('div', { class: 'tp-templates' }, all.map((t) => h('label', { class: 'tp-template' },
      h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(t) : chosen.delete(t)) }),
      h('div', {}, h('b', {}, t.name), h('small', { class: 'muted' }, `${t.items.length} things: ${t.items.slice(0, 5).map((i) => i.text).join(', ')}…`)),
      t.builtIn ? null : h('button', { type: 'button', class: 'tp-icon-btn', 'aria-label': `Delete ${t.name}`, onclick: async (e) => { e.preventDefault(); saved = saved.filter((x) => x !== t); await api('templates', { method: 'POST', body: { templates: saved } }); e.target.closest('.tp-template').remove(); } }, '✕'))));
    const r = await sheet(this.app.root, { title: 'Add from templates', body, actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, value: true }] });
    if (!r || !chosen.size) return;
    const have = new Set(this.entries(list.id).map((e) => e.text.toLowerCase()));
    let order = this.entries(list.id).length;
    const ops = [];
    for (const t of chosen) for (const i of t.items) { if (have.has(i.text.toLowerCase())) continue; have.add(i.text.toLowerCase()); ops.push({ op: 'put', col: 'entries', item: { list: list.id, text: i.text, category: i.category, quantity: i.quantity || 1, done: false, order: order++ } }); }
    if (ops.length) { await this.store.batch(ops, { label: 'add from templates' }).catch(toastError); toast(`Added ${ops.length} things`, { type: 'success', timeout: 2000 }); } else toast('Those are all on the list already', { timeout: 2000 });
  }
  async saveTemplate(l) {
    const name = input({ value: l.name, autofocus: true });
    const r = await sheet(this.app.root, { title: 'Save as a template', body: h('div', { class: 'tp-form' }, h('p', { class: 'muted small' }, 'Use this list again on other trips.'), field('Name', name)), actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: true }] });
    if (!r) return;
    try {
      const { templates } = await api('templates');
      templates.push({ name: name.value.trim() || l.name, items: this.entries(l.id).map((e) => ({ text: e.text, category: e.category, quantity: e.quantity })) });
      await api('templates', { method: 'POST', body: { templates } });
      toast('Template saved', { type: 'success', timeout: 2000 });
    } catch (err) { toastError(err); }
  }
}
