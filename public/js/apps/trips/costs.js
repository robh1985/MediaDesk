// Trip Planner: costs. Who paid what, split equally, by shares or by amounts, in any currency
// (changed into the trip's at the day's rate); what everyone owes, the fewest payments that settle
// it, and a log of payments made. Against a budget, by kind, and out as a spreadsheet.

import { h, clear, toast, toastError } from '../../ui.js';
import { geo } from './store.js';
import { CURRENCIES, money, cents, expenseParts, balances, settleUp, avatar, sheet, field, input, select, textarea, emptyState, fmtDay } from './util.js';

export const COST_KINDS = { stay: ['Stay', '🛏️'], transport: ['Transport', '🚆'], food: ['Food & drink', '🍽️'], activities: ['Activities', '🎟️'], shopping: ['Shopping', '🛍️'], other: ['Other', '💶'] };

export class CostsView {
  constructor(app) { this.app = app; this.store = app.store; }

  render(el) {
    this.el = el;
    const trip = this.store.trip;
    const cur = trip.currency || 'EUR';
    const m = (c) => money(c / 100, cur);
    const expenses = this.store.all('expenses').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0));
    const total = expenses.reduce((a, e) => a + expenseParts(e).total, 0);
    const bal = balances(this.store);
    const plan = settleUp(bal);
    const kinds = {};
    for (const e of expenses) kinds[e.category || 'other'] = (kinds[e.category || 'other'] || 0) + expenseParts(e).total;
    const spent = Object.fromEntries(trip.members.map((x) => [x.id, 0]));
    for (const e of expenses) for (const [k, v] of Object.entries(expenseParts(e).owed)) spent[k] = (spent[k] || 0) + v;
    const budget = trip.budget ? cents(trip.budget) : 0;
    const name = (id) => this.store.member(id)?.name || 'Someone';
    clear(el, h('div', { class: 'tp-page tp-costs' },
      h('div', { class: 'tp-page-head' },
        h('div', { class: 'tp-total' }, h('small', { class: 'muted' }, 'Spent'), h('b', {}, m(total)), budget ? h('small', { class: total > budget ? 'tp-over' : 'muted' }, `of ${m(budget)} budget`) : null),
        h('span', { class: 'tp-grow' }),
        h('button', { class: 'btn', onclick: () => this.exportCsv() }, '⤓ Spreadsheet (CSV)'),
        h('button', { class: 'btn', onclick: () => this.settle(null) }, '🤝 Record a payment'),
        h('button', { class: 'btn btn-primary', onclick: () => this.edit(null) }, '＋ Add a cost')),
      budget ? h('div', { class: 'tp-budget' }, h('div', { style: { width: `${Math.min(100, (total / budget) * 100)}%` }, class: total > budget ? 'over' : '' })) : null,
      h('div', { class: 'tp-costs-grid' },
        h('section', { class: 'tp-box' },
          h('h4', {}, 'Who owes whom'),
          trip.members.map((x) => h('div', { class: 'tp-bal' }, avatar(x, 24), h('span', {}, x.name), h('small', { class: 'muted' }, `spent ${m(spent[x.id] || 0)}`), h('b', { class: bal[x.id] > 0 ? 'pos' : bal[x.id] < 0 ? 'neg' : '' }, bal[x.id] > 0 ? `gets ${m(bal[x.id])}` : bal[x.id] < 0 ? `owes ${m(-bal[x.id])}` : 'settled'))),
          plan.length ? h('div', { class: 'tp-settle' }, h('h5', {}, 'To settle up'), plan.map((p) => h('div', { class: 'tp-settle-row' }, h('span', {}, `${name(p.from)} pays ${name(p.to)} `, h('b', {}, m(p.cents))), h('button', { class: 'btn btn-sm', onclick: () => this.settle(p) }, 'Paid')))) : h('p', { class: 'muted small' }, expenses.length ? 'Everyone’s square. 🎉' : '')),
        h('section', { class: 'tp-box' },
          h('h4', {}, 'By kind'),
          Object.keys(kinds).length ? Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'tp-kind' }, h('span', {}, `${(COST_KINDS[k] || COST_KINDS.other)[1]} ${(COST_KINDS[k] || COST_KINDS.other)[0]}`), h('div', { class: 'tp-kind-bar' }, h('div', { style: { width: `${(v / total) * 100}%` } })), h('b', {}, m(v)))) : h('p', { class: 'muted small' }, 'Nothing yet'))),
      h('section', { class: 'tp-box' },
        h('h4', {}, 'Costs'),
        expenses.length ? h('div', { class: 'tp-exp-list' }, expenses.map((e) => this.row(e))) : emptyState('💶', 'No costs yet. Add what you spend and who paid; the app works out who owes what.')),
      this.store.all('settlements').length ? h('section', { class: 'tp-box' }, h('h4', {}, 'Payments made'),
        this.store.all('settlements').sort((a, b) => (b.created || 0) - (a.created || 0)).map((s) => h('div', { class: 'tp-settle-row' }, h('span', {}, `${name(s.from)} paid ${name(s.to)} `, h('b', {}, money(s.amount, cur)), s.date ? h('small', { class: 'muted' }, ` · ${fmtDay(s.date)}`) : null),
          h('button', { class: 'tp-icon-btn', 'aria-label': 'Delete', onclick: () => this.store.del('settlements', s.id, { label: 'delete payment' }).catch(toastError) }, '✕')))) : null));
  }

  row(e) {
    const cur = this.store.trip.currency;
    const { total, paid } = expenseParts(e);
    const payers = Object.keys(paid).map((id) => this.store.member(id)?.name).filter(Boolean);
    const receipt = this.store.all('files').find((f) => f.expenseId === e.id && !f.deleted);
    return h('button', { class: 'tp-exp', onclick: () => this.edit(e) },
      h('span', { class: 'tp-exp-icon' }, (COST_KINDS[e.category] || COST_KINDS.other)[1]),
      h('span', { class: 'tp-exp-main' }, h('b', {}, e.title || 'Cost'), h('small', { class: 'muted' }, [`${payers.join(' & ') || '—'} paid`, e.date ? fmtDay(e.date) : null, e.split === 'equal' ? `split ${Object.keys(e.shares || {}).length} ways` : e.split === 'amounts' ? 'split by amounts' : 'split by shares', receipt ? '🧾' : null].filter(Boolean).join(' · '))),
      h('span', { class: 'tp-exp-amt' }, h('b', {}, money(total / 100, cur)), e.currency !== cur ? h('small', { class: 'muted' }, money(Number(e.amount), e.currency)) : null));
  }

  async edit(e) {
    const trip = this.store.trip;
    const isNew = !e;
    e = e ? JSON.parse(JSON.stringify(e)) : { currency: trip.currency, date: new Date().toISOString().slice(0, 10), split: 'equal', paidBy: {}, shares: Object.fromEntries(trip.members.map((x) => [x.id, 1])), category: 'food' };
    const title = input({ value: e.title || '', placeholder: 'Dinner, tickets, petrol…', autofocus: true });
    const amount = input({ type: 'number', min: 0, step: 0.01, value: e.amount ?? '', required: true });
    const cur = select(CURRENCIES.map((c) => [c, c]), e.currency || trip.currency);
    const rate = input({ type: 'number', min: 0, step: 'any', value: e.rate && e.currency !== trip.currency ? e.rate : '' });
    const rateRow = field(`Rate (1 ${cur.value} in ${trip.currency})`, rate, 'Filled in from the day’s exchange rate; change it to what you actually paid');
    const date = input({ type: 'date', value: e.date || '' });
    const kind = select(Object.entries(COST_KINDS).map(([k, [l, i]]) => [k, `${i} ${l}`]), e.category || 'other');
    const notes = textarea(e.notes || '', { rows: 2, placeholder: 'Notes' });
    const lookRate = async () => {
      rateRow.hidden = cur.value === trip.currency;
      rateRow.querySelector('span').textContent = `Rate (1 ${cur.value} in ${trip.currency})`;
      if (cur.value === trip.currency) return;
      try { const r = await geo.fx(cur.value, trip.currency, date.value); if (r) rate.value = Number(r.toFixed(6)); } catch { /* type it in */ }
    };
    cur.addEventListener('change', lookRate);
    date.addEventListener('change', () => { if (cur.value !== trip.currency) lookRate(); });
    rateRow.hidden = cur.value === trip.currency;
    if (!rateRow.hidden && !rate.value) lookRate();
    // Who paid: one person, or several with amounts.
    const paidBy = { ...e.paidBy };
    // You paid, to start with (or the first traveller).
    if (!Object.keys(paidBy).length) paidBy[(this.store.meMember() || trip.members[0]).id] = Number(e.amount) || 0;
    const payBox = h('div', { class: 'tp-split' });
    const drawPay = () => {
      const many = Object.keys(paidBy).length > 1;
      clear(payBox, trip.members.map((x) => h('div', { class: `tp-split-row ${x.id in paidBy ? 'on' : ''}` },
        h('label', { class: 'tp-check' }, h('input', { type: many ? 'checkbox' : 'radio', name: 'payer', checked: x.id in paidBy, onchange: (ev) => { if (!many) { for (const k of Object.keys(paidBy)) delete paidBy[k]; paidBy[x.id] = Number(amount.value) || 0; } else if (ev.target.checked) paidBy[x.id] = 0; else delete paidBy[x.id]; drawPay(); } }), avatar(x, 20), x.name),
        many && x.id in paidBy ? input({ type: 'number', min: 0, step: 0.01, value: paidBy[x.id] || '', class: 'input tp-split-amt', oninput: (ev) => { paidBy[x.id] = Number(ev.target.value) || 0; } }) : null)),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { if (many) { const first = Object.keys(paidBy)[0]; for (const k of Object.keys(paidBy)) delete paidBy[k]; paidBy[first] = Number(amount.value) || 0; } else paidBy[trip.members.find((x) => !(x.id in paidBy))?.id || Object.keys(paidBy)[0]] = 0; drawPay(); } }, many ? 'One person paid' : 'Several people paid'));
    };
    drawPay();
    // How it's split.
    let split = e.split || 'equal';
    const shares = { ...e.shares };
    const splitBox = h('div', { class: 'tp-split' });
    const drawSplit = () => {
      const total = Number(amount.value) || 0;
      const parts = expenseParts({ amount: total, rate: 1, paidBy: { x: 1 }, split, shares });
      clear(splitBox,
        h('div', { class: 'tp-seg small' }, [['equal', 'Equally'], ['shares', 'By shares'], ['amounts', 'By amounts']].map(([k, l]) => h('button', { type: 'button', class: split === k ? 'on' : '', onclick: () => { if (split === k) return; split = k; for (const id of Object.keys(shares)) shares[id] = k === 'amounts' ? Number(((parts.owed[id] || 0) / 100).toFixed(2)) : 1; drawSplit(); } }, l))),
        trip.members.map((x) => h('div', { class: `tp-split-row ${x.id in shares ? 'on' : ''}` },
          h('label', { class: 'tp-check' }, h('input', { type: 'checkbox', checked: x.id in shares, onchange: (ev) => { if (ev.target.checked) shares[x.id] = split === 'amounts' ? 0 : 1; else delete shares[x.id]; drawSplit(); } }), avatar(x, 20), x.name),
          x.id in shares && split !== 'equal' ? input({ type: 'number', min: 0, step: split === 'amounts' ? 0.01 : 1, value: shares[x.id], class: 'input tp-split-amt', oninput: (ev) => { shares[x.id] = Number(ev.target.value) || 0; out.textContent = summary(); } }) : null,
          h('small', { class: 'muted tp-split-share' }, x.id in shares ? money((parts.owed[x.id] || 0) / 100, cur.value) : ''))),
        out);
      out.textContent = summary();
    };
    const out = h('small', { class: 'muted' });
    const summary = () => {
      if (split !== 'amounts') return '';
      const sum = Object.values(shares).reduce((a, v) => a + Number(v || 0), 0);
      const diff = (Number(amount.value) || 0) - sum;
      return Math.abs(diff) < 0.005 ? 'Adds up ✓' : diff > 0 ? `${money(diff, cur.value)} still to share out` : `${money(-diff, cur.value)} too much`;
    };
    amount.addEventListener('input', () => { if (Object.keys(paidBy).length === 1) paidBy[Object.keys(paidBy)[0]] = Number(amount.value) || 0; drawSplit(); });
    cur.addEventListener('change', drawSplit);
    drawSplit();
    const receiptIn = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment' });
    const receipt = e.id ? this.store.all('files').find((f) => f.expenseId === e.id && !f.deleted) : null;
    const r = await sheet(this.app.root, {
      title: isNew ? 'Add a cost' : 'Cost', wide: true,
      body: h('div', { class: 'tp-form' },
        field('What', title),
        h('div', { class: 'tp-row' }, field('Amount', amount), field('Currency', cur), field('When', date)),
        rateRow,
        field('Kind', kind),
        field('Paid by', payBox),
        field('Split between', splitBox),
        field('Receipt', h('div', {}, receipt ? h('a', { class: 'tp-chip', href: this.store.fileUrl(receipt.id), target: '_blank', rel: 'noopener' }, `🧾 ${receipt.name}`) : null, receiptIn)),
        field('Notes', notes)),
      actions: [!isNew ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') { await this.store.del('expenses', e.id, { label: 'delete cost' }).catch(toastError); toast('Cost deleted', { timeout: 4000, action: { label: 'Undo', onClick: () => this.store.undo() } }); return; }
    if (r !== 'save') return;
    const amt = Number(amount.value) || 0;
    if (!amt) { toast('A cost needs an amount', { type: 'error', timeout: 2500 }); return; }
    if (!Object.keys(shares).length) { toast('Choose who it’s split between', { type: 'error', timeout: 2500 }); return; }
    if (split === 'amounts' && Math.abs(Object.values(shares).reduce((a, v) => a + Number(v || 0), 0) - amt) > 0.009) { toast('The amounts don’t add up to the total', { body: summary(), type: 'error', timeout: 4000 }); return; }
    if (Object.keys(paidBy).length > 1 && Math.abs(Object.values(paidBy).reduce((a, v) => a + v, 0) - amt) > 0.009) { toast('What each person paid doesn’t add up to the total', { type: 'error', timeout: 4000 }); return; }
    const saved = await this.store.put('expenses', { ...e, title: title.value.trim() || 'Cost', amount: amt, currency: cur.value, rate: cur.value === trip.currency ? 1 : Number(rate.value) || 1, date: date.value || null, category: kind.value, notes: notes.value, paidBy: Object.keys(paidBy).length === 1 ? { [Object.keys(paidBy)[0]]: amt } : paidBy, split, shares }, { label: isNew ? 'add cost' : 'cost' }).catch(toastError);
    if (saved && receiptIn.files[0]) { try { await this.store.upload(receiptIn.files[0], { expenseId: saved.id }); } catch (err) { toastError(err, 'The receipt wasn’t uploaded'); } }
  }

  async settle(p) {
    const trip = this.store.trip;
    const from = select(trip.members.map((x) => [x.id, x.name]), p?.from || trip.members[0].id);
    const to = select(trip.members.map((x) => [x.id, x.name]), p?.to || trip.members[1]?.id || trip.members[0].id);
    const amount = input({ type: 'number', min: 0, step: 0.01, value: p ? (p.cents / 100).toFixed(2) : '' });
    const r = await sheet(this.app.root, {
      title: 'Record a payment',
      body: h('div', { class: 'tp-form' }, h('div', { class: 'tp-row' }, field('Who paid', from), field('Paid', to)), field(`How much (${trip.currency})`, amount)),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: true }],
    });
    if (!r || from.value === to.value || !Number(amount.value)) return;
    await this.store.put('settlements', { from: from.value, to: to.value, amount: Number(amount.value), date: new Date().toISOString().slice(0, 10) }, { label: 'payment' }).catch(toastError);
  }

  exportCsv() {
    const trip = this.store.trip;
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Date', 'What', 'Kind', 'Amount', 'Currency', `In ${trip.currency}`, 'Paid by', ...trip.members.map((m) => `${m.name}'s share`)];
    const rows = this.store.all('expenses').sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((e) => {
      const { total, paid, owed } = expenseParts(e);
      return [e.date, e.title, (COST_KINDS[e.category] || COST_KINDS.other)[0], e.amount, e.currency, (total / 100).toFixed(2), Object.entries(paid).map(([k, v]) => `${this.store.member(k)?.name}: ${(v / 100).toFixed(2)}`).join('; '), ...trip.members.map((m) => ((owed[m.id] || 0) / 100).toFixed(2))];
    });
    const csv = [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv' })), download: `${trip.title.replace(/[^\w -]+/g, '')} costs.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
