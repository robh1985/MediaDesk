// Convert: a unit converter in the spirit of Josh Madison's Convert. Pick a category, a From and a
// To unit, and type a value (sums like 5'11 = 5*12+11 work too). The answer updates as you type,
// with a choice of decimal places, scientific notation and digit grouping, and a table of the
// value in every unit. Add your own units to any category, or whole new categories.

import { h, clear, toast, confirmDialog } from '../ui.js';
import { appIcon } from '../icons.js';
import { CATEGORIES, toBase, fromBase } from './convert-units.js';
import { evaluate } from './calc-math.js';

const KEY = 'mediadesk.convert';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };

const SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';

export const convertApp = {
  id: 'convert', name: 'Convert', icon: appIcon.convert, size: [900, 620], description: 'Convert between units of measurement',
  open(win) { new Converter(win); },
};

// Turns what's typed into a number: plain numbers (with , or space grouping), or a sum.
function parseValue(text) {
  const t = String(text).trim().replace(/[−]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  if (!t) return NaN;
  const plain = t.replace(/(?<=\d)[,\s_](?=\d{3}\b)/g, '');
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(plain)) return Number(plain);
  try { const v = evaluate(plain); return typeof v === 'number' ? v : NaN; } catch { return NaN; }
}

export function formatNumber(v, { places = 'auto', sci = false, group = true } = {}) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  const abs = Math.abs(v);
  const auto = places === 'auto';
  const d = auto ? null : Number(places);
  if (sci || abs >= 1e21 || (auto && abs !== 0 && abs < 1e-12)) {
    const [m, e] = (auto ? Number(v.toPrecision(15)).toExponential() : v.toExponential(d)).split('e');
    return `${m}E${Number(e) >= 0 ? '+' : ''}${Number(e)}`.replace(/-/g, '−');
  }
  let s;
  if (auto) {
    s = String(Number(v.toPrecision(15)));
    if (/e/.test(s)) s = Number(v.toPrecision(15)).toFixed(20).replace(/\.?0+$/, '');
  } else s = v.toFixed(d);
  if (group) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? `.${f}` : '');
  }
  return s.replace('-', '−');
}

class Converter {
  constructor(win) {
    this.win = win;
    this.state = { cat: 'distance', sel: {}, places: 'auto', sci: false, group: true, value: '1', custom: { units: {}, categories: [] }, showAll: true, ...load() };
    this.state.custom ||= { units: {}, categories: [] };
    this.build();
    this.selectCategory(this.state.cat, false);
  }

  persist() { save(this.state); }

  categories() {
    const custom = (this.state.custom.categories || []).map((c) => ({ ...c, custom: true }));
    return [...CATEGORIES, ...custom].map((c) => ({ ...c, units: [...c.units, ...(this.state.custom.units[c.id] || []).map((x) => ({ ...x, custom: true }))] }));
  }

  build() {
    this.catList = h('div', { class: 'cv-cats', role: 'listbox', 'aria-label': 'Categories' });
    this.catSelect = h('select', { class: 'input cv-cat-select', 'aria-label': 'Category', onchange: () => this.selectCategory(this.catSelect.value) });
    this.input = h('input', { class: 'input cv-input', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Value', value: this.state.value });
    this.input.addEventListener('input', () => { this.state.value = this.input.value; this.persist(); this.update(); });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.input.select(); } });
    this.fromFilter = h('input', { class: 'input cv-filter', placeholder: 'Filter…', spellcheck: 'false', 'aria-label': 'Filter From units' });
    this.toFilter = h('input', { class: 'input cv-filter', placeholder: 'Filter…', spellcheck: 'false', 'aria-label': 'Filter To units' });
    this.fromList = h('div', { class: 'cv-units', role: 'listbox', tabindex: '0', 'aria-label': 'From' });
    this.toList = h('div', { class: 'cv-units', role: 'listbox', tabindex: '0', 'aria-label': 'To' });
    this.fromFilter.addEventListener('input', () => this.drawUnits());
    this.toFilter.addEventListener('input', () => this.drawUnits());
    for (const [list, side] of [[this.fromList, 'from'], [this.toList, 'to']]) list.addEventListener('keydown', (e) => this.listKey(e, side));
    this.result = h('input', { class: 'input cv-result', readonly: true, 'aria-label': 'Result' });
    this.formula = h('div', { class: 'cv-formula' });
    this.fromLabel = h('span', { class: 'cv-unit-label' });
    this.toLabel = h('span', { class: 'cv-unit-label' });
    const placeSel = h('select', { class: 'input cv-places', 'aria-label': 'Decimal places', onchange: () => { this.state.places = placeSel.value; this.persist(); this.update(); } },
      h('option', { value: 'auto' }, 'Auto'), Array.from({ length: 16 }, (_, i) => h('option', { value: String(i) }, String(i))));
    placeSel.value = String(this.state.places);
    const opt = (label, key) => {
      const c = h('input', { type: 'checkbox', onchange: () => { this.state[key] = c.checked; this.persist(); this.update(); } });
      c.checked = Boolean(this.state[key]);
      return h('label', { class: 'check' }, c, label);
    };
    this.allTable = h('div', { class: 'cv-all' });
    const allToggle = h('button', { class: 'btn btn-sm', onclick: () => { this.state.showAll = !this.state.showAll; this.persist(); this.allTable.hidden = !this.state.showAll; allToggle.textContent = this.state.showAll ? 'Hide all units' : 'Show all units'; this.update(); } }, this.state.showAll ? 'Hide all units' : 'Show all units');
    this.allTable.hidden = !this.state.showAll;
    this.addUnitBtn = h('button', { class: 'btn btn-sm', onclick: () => this.addUnit() }, '+ Unit');

    clear(this.win.body, h('div', { class: 'cv' },
      h('aside', { class: 'cv-side' }, h('div', { class: 'cv-side-title small muted' }, 'Category'), this.catList,
        h('button', { class: 'btn btn-sm cv-newcat', onclick: () => this.addCategory() }, '+ New category')),
      h('section', { class: 'cv-main' },
        this.catSelect,
        h('div', { class: 'cv-io' },
          h('label', { class: 'field' }, h('span', {}, 'Value'), h('div', { class: 'cv-valrow' }, this.input, this.fromLabel)),
          h('button', { class: 'btn btn-icon cv-swap', title: 'Swap From and To (Ctrl+Shift+S)', 'aria-label': 'Swap units', html: SWAP, onclick: () => this.swap() }),
          h('label', { class: 'field' }, h('span', {}, 'Result'), h('div', { class: 'cv-valrow' }, this.result, this.toLabel,
            h('button', { class: 'btn btn-icon btn-sm', title: 'Copy the result', 'aria-label': 'Copy the result', html: COPY, onclick: () => this.copy() })))),
        this.formula,
        h('div', { class: 'cv-lists' },
          h('div', { class: 'cv-list' }, h('div', { class: 'cv-list-head' }, h('strong', {}, 'From'), this.fromFilter), this.fromList),
          h('div', { class: 'cv-list' }, h('div', { class: 'cv-list-head' }, h('strong', {}, 'To'), this.toFilter), this.toList)),
        h('div', { class: 'cv-options' },
          h('label', { class: 'cv-opt' }, 'Decimal places', placeSel), opt('Scientific notation', 'sci'), opt('Digit grouping', 'group'),
          h('span', { class: 'cv-spacer' }), this.addUnitBtn, allToggle),
        this.allTable)));
    this.win.body.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.swap(); }
    });
    setTimeout(() => { this.input.focus(); this.input.select(); });
  }

  drawCategories() {
    const cats = this.categories();
    clear(this.catList, cats.map((c, i) => [
      c.custom && !cats[i - 1]?.custom ? h('div', { class: 'cv-side-title small muted' }, 'Your categories') : null,
      h('button', {
        class: `cv-cat ${c.id === this.cat.id ? 'active' : ''}`, role: 'option', 'aria-selected': String(c.id === this.cat.id),
        onclick: () => this.selectCategory(c.id),
        oncontextmenu: c.custom ? (e) => { e.preventDefault(); this.deleteCategory(c); } : null,
      }, c.name),
    ]));
    clear(this.catSelect, cats.map((c) => h('option', { value: c.id }, c.name)));
    this.catSelect.value = this.cat.id;
  }

  selectCategory(id, focus = true) {
    const cats = this.categories();
    this.cat = cats.find((c) => c.id === id) || cats.find((c) => c.id === 'distance');
    this.state.cat = this.cat.id;
    const remembered = this.state.sel[this.cat.id] || {};
    const byName = (n) => this.cat.units.find((x) => x.name === n);
    this.from = byName(remembered.from) || this.cat.units[0];
    this.to = byName(remembered.to) || this.cat.units[Math.min(1, this.cat.units.length - 1)];
    this.fromFilter.value = '';
    this.toFilter.value = '';
    this.persist();
    this.drawCategories();
    this.drawUnits(true);
    this.update();
    if (focus) this.input.focus();
  }

  drawUnits(scroll = false) {
    const draw = (list, filter, current, side) => {
      const q = filter.value.trim().toLowerCase();
      const units = this.cat.units.filter((x) => !q || x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q));
      clear(list, units.length ? units.map((x) => h('div', {
        class: `cv-unit ${x === current ? 'active' : ''}`, role: 'option', 'aria-selected': String(x === current),
        onclick: () => this.pick(side, x),
        oncontextmenu: x.custom ? (e) => { e.preventDefault(); this.deleteUnit(x); } : null,
        title: x.custom ? 'Your unit (right-click to delete)' : '',
      }, h('span', {}, x.name), h('span', { class: 'cv-sym' }, x.symbol), x.custom ? h('span', { class: 'cv-mine' }, '★') : null)) : h('div', { class: 'cv-none small muted' }, 'No matches'));
      if (scroll) list.querySelector('.active')?.scrollIntoView({ block: 'center' });
    };
    draw(this.fromList, this.fromFilter, this.from, 'from');
    draw(this.toList, this.toFilter, this.to, 'to');
  }

  pick(side, unit) {
    this[side] = unit;
    this.state.sel[this.cat.id] = { from: this.from.name, to: this.to.name };
    this.persist();
    this.drawUnits();
    this.update();
  }

  listKey(e, side) {
    const list = side === 'from' ? this.fromList : this.toList;
    const items = [...list.querySelectorAll('.cv-unit')];
    const names = items.map((el) => el.firstChild.textContent);
    const i = names.indexOf(this[side].name);
    let j = i;
    if (e.key === 'ArrowDown') j = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else return;
    e.preventDefault();
    const unit = this.cat.units.find((x) => x.name === names[j]);
    if (unit) { this.pick(side, unit); list.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); }
  }

  swap() {
    [this.from, this.to] = [this.to, this.from];
    this.state.sel[this.cat.id] = { from: this.from.name, to: this.to.name };
    // Like Convert: the answer becomes the new value.
    const v = parseValue(this.input.value);
    if (Number.isFinite(v)) {
      const out = fromBase(this.from, toBase(this.to, v));
      if (Number.isFinite(out)) this.input.value = this.state.value = String(Number(out.toPrecision(15)));
    }
    this.persist();
    this.drawUnits(true);
    this.update();
  }

  opts() { return { places: this.state.places, sci: this.state.sci, group: this.state.group }; }

  update() {
    const v = parseValue(this.input.value);
    const ok = Number.isFinite(v);
    this.input.classList.toggle('bad', Boolean(this.input.value.trim()) && !ok);
    this.fromLabel.textContent = this.from.symbol;
    this.toLabel.textContent = this.to.symbol;
    const out = ok ? fromBase(this.to, toBase(this.from, v)) : NaN;
    this.result.value = ok ? formatNumber(out, this.opts()) : '';
    this.result.title = ok ? String(out) : '';
    // "1 mile = 1.609344 kilometers"
    if (this.from.f && this.to.f) {
      clear(this.formula, `1 ${this.from.name} = ${formatNumber(this.from.f / this.to.f, { ...this.opts(), places: 'auto' })} ${this.to.name}`);
    } else clear(this.formula, ok ? `${formatNumber(v, { ...this.opts(), places: 'auto' })} ${this.from.symbol} = ${formatNumber(out, this.opts())} ${this.to.symbol}` : '');
    if (!this.state.showAll) return;
    clear(this.allTable, h('table', { class: 'cv-table' }, h('tbody', {}, this.cat.units.map((x) => {
      const r = ok ? fromBase(x, toBase(this.from, v)) : NaN;
      return h('tr', { class: x === this.to ? 'active' : '', onclick: () => this.pick('to', x), title: 'Make this the To unit' },
        h('td', { class: 'num' }, ok ? formatNumber(r, this.opts()) : ''), h('td', { class: 'cv-sym' }, x.symbol), h('td', {}, x.name));
    }))));
  }

  copy() {
    if (!this.result.value) return;
    navigator.clipboard?.writeText(this.result.value.replace(/,/g, '').replace('−', '-')).then(
      () => toast('Copied', { body: `${this.result.value} ${this.to.symbol}`, icon: appIcon.convert, timeout: 1500 }),
      () => { this.result.select(); document.execCommand?.('copy'); });
  }

  // ---- Your own units and categories ----

  form(title, fields, onOk) {
    return new Promise((resolve) => {
      const err = h('div', { class: 'small', style: { color: 'var(--bad)', minHeight: '1em', marginTop: '8px' } });
      const close = (v) => { overlay.remove(); resolve(v); };
      const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(null); } },
        h('form', { class: 'dialog cv-dialog', onsubmit: (e) => { e.preventDefault(); try { close(onOk()); } catch (ex) { err.textContent = ex.message; } } },
          h('h3', {}, title), fields, err,
          h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'))));
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
      document.body.append(overlay);
      overlay.querySelector('input')?.focus();
    });
  }

  addUnit() {
    const cat = this.cat;
    const linear = cat.units.filter((x) => x.f);
    const name = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. smoot' });
    const symbol = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. smoot' });
    const amount = h('input', { class: 'input', inputmode: 'decimal', spellcheck: 'false', placeholder: 'e.g. 1.7018' });
    const of = h('select', { class: 'input' }, linear.map((x, i) => h('option', { value: String(i) }, `${x.name} (${x.symbol})`)));
    const pref = linear.indexOf(this.from);
    if (pref >= 0) of.value = String(pref);
    return this.form(`Add a unit to ${cat.name}`, h('div', { class: 'cv-form' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Symbol'), symbol),
      h('div', { class: 'cv-form-eq' }, h('span', {}, '1 of these ='), amount, of)), () => {
      const n = name.value.trim();
      const val = parseValue(amount.value);
      if (!n) throw new Error('Give the unit a name');
      if (cat.units.some((x) => x.name.toLowerCase() === n.toLowerCase())) throw new Error('There’s already a unit with that name');
      if (!(val > 0) || !Number.isFinite(val)) throw new Error('Enter how many of the other unit one of these is (a positive number)');
      const base = linear[Number(of.value)];
      const unit = { name: n, symbol: symbol.value.trim() || n, f: val * base.f };
      (this.state.custom.units[cat.id] ||= []).push(unit);
      this.persist();
      this.selectCategory(cat.id, false);
      this.pick('to', this.cat.units.find((x) => x.name === n));
      toast('Unit added', { body: `1 ${n} = ${formatNumber(val)} ${base.name}`, icon: appIcon.convert, type: 'success', timeout: 2500 });
      return true;
    });
  }

  async deleteUnit(unit) {
    if (!(await confirmDialog({ title: 'Delete unit', message: `Delete your unit “${unit.name}” from ${this.cat.name}?`, confirm: 'Delete', danger: true }))) return;
    const list = this.state.custom.units[this.cat.id] || [];
    this.state.custom.units[this.cat.id] = list.filter((x) => x.name !== unit.name);
    if (this.cat.custom) {
      const c = this.state.custom.categories.find((x) => x.id === this.cat.id);
      if (c) c.units = c.units.filter((x) => x.name !== unit.name);
    }
    this.persist();
    this.selectCategory(this.cat.id, false);
  }

  addCategory() {
    const name = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. Cooking' });
    const base = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. cup' });
    const symbol = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. c' });
    return this.form('New category', h('div', { class: 'cv-form' },
      h('label', { class: 'field' }, h('span', {}, 'Category name'), name),
      h('label', { class: 'field' }, h('span', {}, 'First unit (the others are measured against it)'), base),
      h('label', { class: 'field' }, h('span', {}, 'Its symbol'), symbol),
      h('p', { class: 'small muted' }, 'Then use “+ Unit” to add more units to it.')), () => {
      const n = name.value.trim(), b = base.value.trim();
      if (!n || !b) throw new Error('Give the category and its first unit a name');
      if (this.categories().some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new Error('There’s already a category with that name');
      const id = `custom-${Date.now().toString(36)}`;
      this.state.custom.categories.push({ id, name: n, base: symbol.value.trim() || b, units: [{ name: b, symbol: symbol.value.trim() || b, f: 1 }] });
      this.persist();
      this.selectCategory(id, false);
      this.addUnit();
      return true;
    });
  }

  async deleteCategory(cat) {
    if (!(await confirmDialog({ title: 'Delete category', message: `Delete your category “${cat.name}” and its units?`, confirm: 'Delete', danger: true }))) return;
    this.state.custom.categories = this.state.custom.categories.filter((c) => c.id !== cat.id);
    delete this.state.custom.units[cat.id];
    delete this.state.sel[cat.id];
    this.persist();
    this.selectCategory(this.cat.id === cat.id ? 'distance' : this.cat.id, false);
  }
}
