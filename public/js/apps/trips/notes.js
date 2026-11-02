// Trip Planner: notes, links and polls the travellers share. Polls are voted on by traveller (the
// app doesn't know which traveller you are, so you choose who's voting).

import { h, clear, toastError } from '../../ui.js';
import { avatar, sheet, field, input, select, textarea, emptyState } from './util.js';

const VOTER_KEY = 'mediadesk.trips.voter';

export class NotesView {
  constructor(app) { this.app = app; this.store = app.store; }

  get voter() {
    let v = null;
    try { v = localStorage.getItem(`${VOTER_KEY}.${this.store.id}`); } catch { /* not kept */ }
    return this.store.member(v) ? v : this.store.meMember()?.id || this.store.trip.members[0]?.id;
  }
  set voter(v) { try { localStorage.setItem(`${VOTER_KEY}.${this.store.id}`, v); } catch { /* not kept */ } }

  render(el) {
    this.el = el;
    const notes = this.store.all('notes').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || 0) - (a.updated || 0));
    const links = this.store.all('links').sort((a, b) => (b.created || 0) - (a.created || 0));
    const polls = this.store.all('polls').sort((a, b) => (b.created || 0) - (a.created || 0));
    const me = select(this.store.trip.members.map((m) => [m.id, m.name]), this.voter, { class: 'input tp-mini', 'aria-label': 'I am', onchange: (e) => { this.voter = e.target.value; this.render(el); } });
    clear(el, h('div', { class: 'tp-page tp-notes' },
      h('div', { class: 'tp-page-head' }, h('span', { class: 'muted small' }, 'I’m'), me, h('span', { class: 'tp-grow' }),
        h('button', { class: 'btn', onclick: () => this.editPoll(null) }, '📊 New poll'),
        h('button', { class: 'btn', onclick: () => this.editLink(null) }, '🔗 Add a link'),
        h('button', { class: 'btn btn-primary', onclick: () => this.editNote(null) }, '✎ New note')),
      !notes.length && !links.length && !polls.length ? emptyState('💬', 'Share ideas, useful links and quick votes with everyone on the trip.') : null,
      polls.length ? h('section', {}, h('h4', {}, 'Polls'), h('div', { class: 'tp-note-grid' }, polls.map((p) => this.poll(p)))) : null,
      notes.length ? h('section', {}, h('h4', {}, 'Notes'), h('div', { class: 'tp-note-grid' }, notes.map((n) => {
        const by = this.store.member(n.author);
        return h('button', { class: `tp-note ${n.pinned ? 'pinned' : ''}`, style: { '--c': n.color || '#ffe066' }, onclick: () => this.editNote(n) }, n.title ? h('b', {}, n.title) : null, h('p', {}, n.text), by ? h('small', { class: 'muted' }, avatar(by, 16), ` ${by.name}`) : null);
      }))) : null,
      links.length ? h('section', {}, h('h4', {}, 'Links'), h('div', { class: 'tp-linklist' }, links.map((k) => {
        let host = '';
        try { host = new URL(k.url).hostname.replace(/^www\./, ''); } catch { /* not a link */ }
        return h('div', { class: 'tp-link' }, h('span', { 'aria-hidden': 'true' }, '🔗'),
          h('a', { href: k.url, target: '_blank', rel: 'noopener noreferrer' }, h('b', {}, k.title || host || k.url), h('small', { class: 'muted' }, host)),
          k.note ? h('small', { class: 'muted' }, k.note) : null,
          h('button', { class: 'tp-icon-btn', 'aria-label': 'Edit', onclick: () => this.editLink(k) }, '✎'));
      }))) : null));
  }

  poll(p) {
    const total = p.options.reduce((a, o) => a + (o.votes?.length || 0), 0);
    const me = this.voter;
    const vote = (o) => {
      const options = p.options.map((x) => {
        const votes = (x.votes || []).filter((v) => v !== me || (p.multi && x.id !== o.id));
        if (x.id === o.id && !(x.votes || []).includes(me)) votes.push(me);
        return { ...x, votes };
      });
      this.store.put('polls', { ...p, options }, { label: 'vote' }).catch(toastError);
    };
    return h('div', { class: 'tp-poll' },
      h('div', { class: 'tp-poll-head' }, h('b', {}, p.question), h('button', { class: 'tp-icon-btn', 'aria-label': 'Edit', onclick: () => this.editPoll(p) }, '✎')),
      p.options.map((o) => {
        const n = o.votes?.length || 0;
        const mine = (o.votes || []).includes(me);
        return h('button', { class: `tp-poll-opt ${mine ? 'on' : ''}`, disabled: p.closed, onclick: () => vote(o) },
          h('div', { class: 'tp-poll-bar', style: { width: `${total ? (n / total) * 100 : 0}%` } }),
          h('span', {}, `${mine ? '✓ ' : ''}${o.text}`), h('span', { class: 'tp-avatars' }, (o.votes || []).map((v) => avatar(this.store.member(v), 16))), h('b', {}, n));
      }),
      h('small', { class: 'muted' }, `${total} vote${total === 1 ? '' : 's'}${p.multi ? ' · choose several' : ''}${p.closed ? ' · closed' : ''}`));
  }

  async editNote(n) {
    const title = input({ value: n?.title || '', placeholder: 'Title (optional)' });
    const text = textarea(n?.text || '', { rows: 8, autofocus: true, placeholder: 'Write something…' });
    const pinned = h('input', { type: 'checkbox', checked: Boolean(n?.pinned) });
    let color = n?.color || '#ffe066';
    const sw = h('div', { class: 'tp-swatches' });
    const draw = () => clear(sw, ['#ffe066', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#eebefa', '#e9ecef'].map((c) => h('button', { type: 'button', class: c === color ? 'on' : '', style: { background: c }, 'aria-label': c, onclick: () => { color = c; draw(); } })));
    draw();
    const r = await sheet(this.app.root, {
      title: n ? 'Note' : 'New note', wide: true,
      body: h('div', { class: 'tp-form' }, field('Title', title), text, h('div', { class: 'tp-row' }, sw, h('label', { class: 'tp-check' }, pinned, 'Pin to the top'))),
      actions: [n ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') return this.store.del('notes', n.id, { label: 'delete note' }).catch(toastError);
    if (r === 'save' && (text.value.trim() || title.value.trim())) this.store.put('notes', { ...(n || { author: this.voter }), title: title.value.trim(), text: text.value, color, pinned: pinned.checked }, { label: 'note' }).catch(toastError);
  }

  async editLink(k) {
    const url = input({ type: 'url', value: k?.url || '', placeholder: 'https://…', autofocus: true, required: true });
    const title = input({ value: k?.title || '', placeholder: 'What it is' });
    const note = input({ value: k?.note || '' });
    const r = await sheet(this.app.root, {
      title: k ? 'Link' : 'Add a link',
      body: h('div', { class: 'tp-form' }, field('Address', url), field('Name', title), field('Note', note)),
      actions: [k ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') return this.store.del('links', k.id, { label: 'delete link' }).catch(toastError);
    if (r !== 'save' || !url.value.trim()) return;
    const u = /^https?:\/\//i.test(url.value.trim()) ? url.value.trim() : `https://${url.value.trim()}`;
    this.store.put('links', { ...(k || { author: this.voter }), url: u, title: title.value.trim(), note: note.value.trim() }, { label: 'link' }).catch(toastError);
  }

  async editPoll(p) {
    const q = input({ value: p?.question || '', placeholder: 'Where shall we eat on Friday?', autofocus: true });
    const options = (p?.options || [{ text: '' }, { text: '' }]).map((o) => ({ ...o }));
    const multi = h('input', { type: 'checkbox', checked: Boolean(p?.multi) });
    const closed = h('input', { type: 'checkbox', checked: Boolean(p?.closed) });
    const box = h('div', { class: 'tp-form' });
    const draw = () => clear(box, options.map((o, i) => h('div', { class: 'tp-row' }, input({ value: o.text, placeholder: `Choice ${i + 1}`, oninput: (e) => { o.text = e.target.value; } }), h('button', { type: 'button', class: 'tp-icon-btn', disabled: options.length < 3, 'aria-label': 'Remove', onclick: () => { options.splice(i, 1); draw(); } }, '✕'))),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { options.push({ text: '' }); draw(); } }, '＋ Another choice'));
    draw();
    const r = await sheet(this.app.root, {
      title: p ? 'Poll' : 'New poll',
      body: h('div', { class: 'tp-form' }, field('Question', q), box, h('label', { class: 'tp-check' }, multi, 'People can choose more than one'), p ? h('label', { class: 'tp-check' }, closed, 'Closed (no more votes)') : null),
      actions: [p ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: 'save' }],
    });
    if (r === 'delete') return this.store.del('polls', p.id, { label: 'delete poll' }).catch(toastError);
    if (r !== 'save' || !q.value.trim()) return;
    const opts = options.filter((o) => o.text.trim()).map((o) => ({ id: o.id || Math.random().toString(36).slice(2, 8), text: o.text.trim(), votes: o.votes || [] }));
    if (opts.length < 2) return;
    this.store.put('polls', { ...(p || { author: this.voter }), question: q.value.trim(), options: opts, multi: multi.checked, closed: closed.checked }, { label: 'poll' }).catch(toastError);
  }
}
