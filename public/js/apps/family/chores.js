// Chore chart, routines and rewards. Each person has a column of today's chores; ticking one
// off earns its stars (with a little celebration), and stars are spent on rewards.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, parseYmd, addDays, startOfDay, sameDay, choreDue, describeChoreRepeat, fmtDate, DAY_SHORT, PARTS, currentPart, startOfWeek } from './dates.js';
import { sheet, field, input, select, avatar, memberPicker, emojiButton, ICONS, STAR, confetti, parentGate } from './shared.js';

const logId = (choreId, memberId, date) => `${choreId}|${memberId}|${date}`;

export class ChoresView {
  constructor(app, mode = 'chores') {
    this.app = app;
    this.store = app.store;
    this.mode = mode; // chores | routines
    this.date = startOfDay(new Date());
    this.layout = 'day'; // day | week
  }

  members() {
    const f = this.app.filter;
    return this.store.members().filter((m) => !f.size || f.has(m.id));
  }

  choresFor(memberId, date, kind = this.mode === 'routines' ? 'routine' : 'chore') {
    return this.store.all('chores')
      .filter((c) => (c.kind || 'chore') === kind && c.paused !== true && choreDue(c, date) && (memberId === null ? !(c.members || []).length : (c.members || []).includes(memberId)))
      .sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  }

  // Who's signed in (on the organizer's own page): their account and family profile.
  get user() { return this.app.session?.user || null; }
  get me() { return this.user?.profile ? this.store.member(this.user.profile) : null; }
  // A family member's account (not a parent's): makes chores only for themselves, for approval.
  get member() { return Boolean(this.user && this.user.role !== 'parent'); }
  get canApprove() { return !this.member; }
  pending() { return this.store.all('chores').filter((c) => c.approved === false); }

  doneBy(chore, memberId, date) {
    const key = ymd(date);
    if (!(chore.members || []).length) return this.store.all('chorelog').find((l) => l.chore === chore.id && l.date === key && l.shared) || null;
    return this.store.get('chorelog', logId(chore.id, memberId, key));
  }

  render(el) {
    this.el = el;
    const isToday = sameDay(this.date, new Date());
    const rel = Math.round((this.date - startOfDay(new Date())) / 864e5);
    const label = rel === 0 ? 'Today' : rel === -1 ? 'Yesterday' : rel === 1 ? 'Tomorrow' : fmtDate(this.date, { weekday: 'long', month: 'short', day: 'numeric' });
    const bar = h('div', { class: 'fam-toolbar' },
      h('div', { class: 'fam-seg' },
        h('button', { class: this.mode === 'chores' ? 'on' : '', onclick: () => { this.mode = 'chores'; this.render(el); } }, 'Chores'),
        h('button', { class: this.mode === 'routines' ? 'on' : '', onclick: () => { this.mode = 'routines'; this.render(el); } }, 'Routines')),
      h('div', { class: 'fam-nav' },
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Previous', html: ICONS.left, onclick: () => { this.date = addDays(this.date, this.layout === 'week' ? -7 : -1); this.render(el); } }),
        h('button', { class: 'fam-btn', onclick: () => { this.date = startOfDay(new Date()); this.render(el); } }, this.layout === 'week' ? `Week of ${fmtDate(startOfWeek(this.date, Number(this.store.settings.weekStart) || 0), { month: 'short', day: 'numeric' })}` : label),
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Next', html: ICONS.right, onclick: () => { this.date = addDays(this.date, this.layout === 'week' ? 7 : 1); this.render(el); } })),
      h('div', { class: 'fam-spacer' }),
      this.mode === 'chores' ? h('div', { class: 'fam-seg' },
        h('button', { class: this.layout === 'day' ? 'on' : '', onclick: () => { this.layout = 'day'; this.render(el); } }, 'Day'),
        h('button', { class: this.layout === 'week' ? 'on' : '', onclick: () => { this.layout = 'week'; this.render(el); } }, 'Week')) : null,
      this.canApprove && this.pending().length ? h('button', { class: 'fam-btn fam-approve-btn', onclick: () => this.approvals() }, `Approve (${this.pending().length})`) : null,
      h('button', { class: 'fam-btn', onclick: () => this.manage() }, 'Manage'),
      h('button', { class: 'fam-btn primary', onclick: () => this.edit(null) }, h('span', { html: ICONS.plus }), this.mode === 'routines' ? 'Routine step' : 'Chore'));
    const board = h('div', { class: 'fam-board' });
    clear(el, bar, board);
    if (this.mode === 'chores' && this.layout === 'week') return this.drawWeek(board);
    const members = this.members();
    const cols = members.map((m) => this.column(m, isToday));
    if (this.mode === 'chores' && (!this.app.filter.size || this.app.filter.has('family'))) {
      const shared = this.choresFor(null, this.date);
      if (shared.length) cols.push(this.column(null, isToday, shared));
    }
    if (!members.length) clear(board, h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '👨‍👩‍👧‍👦'), 'Add the people in your family in Settings to give them chores.', h('button', { class: 'fam-btn primary', onclick: () => this.app.go('settings', 'profiles') }, 'Add profiles')));
    else board.append(...cols);
  }

  column(m, isToday, list = null) {
    const chores = list || this.choresFor(m.id, this.date);
    const done = chores.filter((c) => this.doneBy(c, m?.id, this.date)).length;
    const pct = chores.length ? done / chores.length : 0;
    const head = h('div', { class: 'fam-board-head', style: { '--c': m?.color || '#868e96' } },
      m ? avatar(m, 'lg') : h('span', { class: 'fam-avatar lg', style: { '--c': '#868e96' } }, '🙋'),
      h('div', { class: 'fam-board-name' }, h('b', {}, m ? m.name : 'Up for grabs'), m ? h('span', { class: 'fam-stars' }, `${STAR} ${this.store.stars(m.id)}`) : h('span', { class: 'fam-muted small' }, 'Anyone can do these')),
      chores.length ? h('div', { class: 'fam-ring', style: { '--p': pct }, title: `${done} of ${chores.length} done` }, h('span', {}, pct === 1 ? '🎉' : `${done}/${chores.length}`)) : null);
    const body = h('div', { class: 'fam-board-list' });
    if (this.mode === 'routines') {
      const now = currentPart();
      for (const part of PARTS) {
        const items = chores.filter((c) => (c.part || 'morning') === part.id);
        if (!items.length) continue;
        const allDone = items.every((c) => this.doneBy(c, m?.id, this.date));
        const sec = h('details', { class: `fam-routine ${allDone ? 'complete' : ''}`, open: !isToday || part.id === now || !allDone },
          h('summary', {}, h('span', {}, part.emoji), h('b', {}, part.label), h('span', { class: 'fam-muted small' }, `${items.filter((c) => this.doneBy(c, m?.id, this.date)).length}/${items.length}`)),
          items.map((c) => this.card(c, m)));
        body.append(sec);
      }
    } else body.append(...chores.map((c) => this.card(c, m)));
    if (!chores.length) body.append(h('div', { class: 'fam-muted small fam-board-empty' }, this.mode === 'routines' ? 'No routine today' : 'Nothing to do 🎈'));
    if (!this.member || (m && m.id === this.me?.id)) body.append(h('button', { class: 'fam-board-add', onclick: () => this.edit(null, m?.id) }, '+ Add'));
    return h('section', { class: 'fam-board-col', style: { '--c': m?.color || '#868e96' } }, head, body);
  }

  card(c, m) {
    const log = this.doneBy(c, m?.id, this.date);
    const future = this.date > startOfDay(new Date());
    // Done by someone else (up for grabs, or someone helping out): they got the stars.
    const by = log && (!m || log.member !== m.id) ? this.store.member(log.member) : null;
    const waiting = c.approved === false;
    const el = h('div', { class: `fam-chore ${log ? 'done' : ''} ${waiting ? 'waiting' : ''}`, style: { '--c': m?.color || by?.color || '#868e96' } },
      h('button', { class: 'fam-chore-main', onclick: () => this.edit(c) },
        h('span', { class: 'fam-chore-emoji' }, c.emoji || '✔️'),
        h('span', { class: 'fam-chore-text' }, h('b', {}, c.title), h('small', {}, [c.time ? fmtClock(c.time) : null, c.stars ? `${STAR} ${c.stars}${waiting ? ' once approved' : ''}` : null, by ? `Done by ${by.name}` : null].filter(Boolean).join(' · ')),
          waiting ? h('small', { class: 'fam-chore-waiting' }, 'Waiting for a parent to approve') : null)),
      by && m ? h('span', { class: 'fam-chore-by', title: `Done by ${by.name}` }, avatar(by, 'xs')) : null,
      h('button', {
        class: 'fam-check', 'aria-label': log ? 'Mark not done' : 'Mark done', disabled: future, title: future ? 'Can’t be done ahead of time' : '',
        html: ICONS.check, onclick: (e) => this.toggle(c, m, e),
      }));
    return el;
  }

  async toggle(c, m, e) {
    const date = ymd(this.date);
    const existing = this.doneBy(c, m?.id, this.date);
    try {
      if (existing) {
        await this.store.del('chorelog', existing.id);
        return;
      }
      let who = m?.id;
      // Signed in and ticking someone else's chore: the stars are yours. A parent says who did it.
      if (m && this.me && this.me.id !== m.id) {
        if (this.member) who = this.me.id;
        else {
          const s2 = sheet(this.app.root, {
            title: 'Who did it?', body: h('div', { class: 'fam-who-grid' }, [m, this.me].map((x) => h('button', { type: 'button', class: 'fam-who', style: { '--c': x.color }, onclick: () => s2.close(x.id) }, avatar(x, 'lg'), x.name))), actions: [{ label: 'Cancel' }],
          });
          who = await s2;
          if (!who) return;
        }
      }
      if (!m && this.member && this.me) who = this.me.id;
      else if (!m) {
        // Up for grabs: whoever did it gets the stars.
        const s = sheet(this.app.root, {
          title: 'Who did it?', body: h('div', { class: 'fam-who-grid' }, this.store.members().map((x) => h('button', { type: 'button', class: 'fam-who', style: { '--c': x.color }, onclick: () => s.close(x.id) }, avatar(x, 'lg'), x.name))), actions: [{ label: 'Cancel' }],
        });
        who = await s;
        if (!who) return;
      }
      const x = e.clientX || e.target.getBoundingClientRect().left;
      const y = e.clientY || e.target.getBoundingClientRect().top;
      // Kept under the chore's own person; `member` is who gets the stars.
      await this.store.put('chorelog', { id: m ? logId(c.id, m.id, date) : logId(c.id, `shared-${who}`, date), chore: c.id, member: who, for: m?.id || null, by: who, date, stars: Number(c.stars) || 0, shared: !m, at: Date.now() });
      if (this.store.settings.celebrate !== false) confetti(this.app.root, x, y);
      if (m && who !== m.id) toast(`${this.store.member(who)?.name || 'Someone'} did ${m.name}’s chore — the stars are theirs`, { timeout: 2500 });
      if (c.approved === false && c.stars) toast('The stars count once a parent approves this chore', { timeout: 3000 });
      const left = m ? this.choresFor(m.id, this.date).filter((k) => !this.doneBy(k, m.id, this.date)).length : 1;
      if (m && !left) toast(`${m.name} finished everything! 🎉`, { type: 'success', timeout: 3000 });
    } catch (err) { toastError(err, 'Couldn’t save that'); }
  }

  // The week at a glance: each person's chores done per day.
  drawWeek(board) {
    const start = startOfWeek(this.date, Number(this.store.settings.weekStart) || 0);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const members = this.members();
    const table = h('div', { class: 'fam-week-chart', style: { '--cols': 7 } },
      h('div', {}), days.map((d) => h('button', { class: `fam-week-day ${sameDay(d, new Date()) ? 'today' : ''}`, onclick: () => { this.date = d; this.layout = 'day'; this.render(this.el); } }, DAY_SHORT[d.getDay()], h('b', {}, d.getDate()))));
    for (const m of members) {
      table.append(h('div', { class: 'fam-week-who' }, avatar(m, 'sm'), m.name));
      for (const d of days) {
        const list = this.choresFor(m.id, d, 'chore');
        const done = list.filter((c) => this.doneBy(c, m.id, d)).length;
        const past = d < startOfDay(new Date());
        table.append(h('button', {
          class: `fam-week-cell ${list.length && done === list.length ? 'all' : ''} ${past && done < list.length ? 'missed' : ''}`, style: { '--c': m.color, '--p': list.length ? done / list.length : 0 },
          onclick: () => { this.date = d; this.layout = 'day'; this.render(this.el); },
        }, list.length ? `${done}/${list.length}` : '–'));
      }
    }
    clear(board, table);
  }

  async manage() {
    const kind = this.mode === 'routines' ? 'routine' : 'chore';
    const list = h('div', { class: 'fam-manage' });
    const draw = () => {
      const chores = this.store.all('chores').filter((c) => (c.kind || 'chore') === kind).sort((a, b) => a.title.localeCompare(b.title));
      clear(list, chores.length ? chores.map((c) => h('div', { class: `fam-manage-row ${c.paused ? 'paused' : ''}` },
        h('span', { class: 'fam-chore-emoji' }, c.emoji || '✔️'),
        h('div', { class: 'fam-manage-main' }, h('b', {}, c.title), h('small', {}, [describeChoreRepeat(c.repeat), kind === 'routine' ? PARTS.find((p) => p.id === (c.part || 'morning'))?.label : null, c.stars ? `${STAR} ${c.stars}` : null, c.paused ? 'Paused' : null].filter(Boolean).join(' · '))),
        h('span', { class: 'fam-agenda-who' }, (c.members || []).map((id) => avatar(this.store.member(id), 'xs'))),
        h('button', { class: 'fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: async () => { await this.edit(c); draw(); } }))) : h('div', { class: 'fam-muted' }, 'Nothing here yet.'));
    };
    draw();
    await sheet(this.app.root, { title: kind === 'routine' ? 'All routine steps' : 'All chores', body: list, wide: true, actions: [{ label: 'Done', primary: true }] });
  }

  async edit(c, memberId) {
    // A family member makes (and changes) chores only for themselves, until a parent approves them.
    const selfOnly = this.member;
    if (selfOnly) {
      if (c && !(c.createdBy === this.user.id && c.approved === false)) { toast('Only a parent can change this chore', { timeout: 2500 }); return; }
      if (!this.me) { toast('Ask a parent to link your account to your family profile first', { timeout: 3500 }); return; }
    } else if (!(await parentGate(this.app.root, this.store, c ? 'Changing chores needs a parent.' : 'Adding chores needs a parent.'))) return;
    const isRoutine = c ? c.kind === 'routine' : this.mode === 'routines';
    const members = this.store.members();
    const emoji = emojiButton(c?.emoji || (isRoutine ? '🌅' : '🧹'));
    const title = input({ value: c?.title || '', placeholder: isRoutine ? 'e.g. Brush teeth' : 'e.g. Feed the dog', required: true, autofocus: true, maxlength: 120 });
    const who = memberPicker(members, selfOnly ? [this.me.id] : c ? c.members || [] : memberId ? [memberId] : []);
    const stars = input({ type: 'number', min: 0, max: 100, value: c?.stars ?? 1, class: 'fam-input tiny' });
    const r = c?.repeat || { kind: 'daily' };
    const kind = select([['daily', 'Every day'], ['weekly', 'On these days'], ['every', 'Every few days'], ['monthly', 'Once a month'], ['once', 'Just once']], r.kind || 'daily');
    const days = new Set(r.kind === 'weekly' ? r.days : [1, 2, 3, 4, 5]);
    const dayRow = h('div', { class: 'fam-weekdays' });
    const everyN = input({ type: 'number', min: 2, max: 60, value: r.n || 2, class: 'fam-input tiny' });
    const monthDay = input({ type: 'number', min: 1, max: 31, value: r.day || this.date.getDate(), class: 'fam-input tiny' });
    const onceDate = input({ type: 'date', value: r.date || ymd(this.date) });
    const time = input({ type: 'time', value: c?.time || '' });
    const part = select(PARTS.map((p) => [p.id, `${p.emoji} ${p.label}`]), c?.part || currentPart());
    const type = select([['chore', 'Chore'], ['routine', 'Routine step']], isRoutine ? 'routine' : 'chore');
    const paused = h('input', { type: 'checkbox', checked: Boolean(c?.paused) });
    const detail = h('div', { class: 'fam-repeat-detail' });
    const drawRepeat = () => {
      clear(dayRow, DAY_SHORT.map((d, i) => h('button', { type: 'button', class: days.has(i) ? 'on' : '', onclick: () => { if (days.has(i)) days.delete(i); else days.add(i); drawRepeat(); } }, d.slice(0, 2))));
      clear(detail, kind.value === 'weekly' ? dayRow : null,
        kind.value === 'every' ? h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'Every'), everyN, h('span', { class: 'fam-muted' }, 'days')) : null,
        kind.value === 'monthly' ? h('div', { class: 'fam-when-row' }, h('span', { class: 'fam-label' }, 'On day'), monthDay) : null,
        kind.value === 'once' ? onceDate : null);
      partRow.hidden = type.value !== 'routine';
    };
    const partRow = field('Part of the day', part);
    // Quick picks (Settings → Quick picks): choosing one fills in the whole chore.
    const picks = this.store.quickPicks().filter((q) => q.title);
    const quick = c || !picks.length ? null : field('Quick pick', select([['', 'Choose a ready-made chore… (or make your own below)'],
      ...picks.map((q) => [q.id, `${q.emoji ? `${q.emoji} ` : ''}${q.title}${q.stars ? ` · ${q.stars} ★` : ''}${q.kind === 'routine' ? ' · routine' : ''}`])], '', {
      class: 'fam-input fam-quick-pick',
      onchange: (e) => {
        const q = picks.find((x) => x.id === e.target.value);
        if (!q) return;
        emoji.value = q.emoji || ''; emoji.textContent = q.emoji || '➕';
        title.value = q.title;
        stars.value = q.stars ?? 1;
        type.value = q.kind === 'routine' ? 'routine' : 'chore';
        if (q.part && q.part !== 'anytime') part.value = q.part;
        const qr = q.repeat || { kind: 'daily' };
        kind.value = qr.kind || 'daily';
        if (qr.kind === 'weekly') { days.clear(); for (const d of qr.days || []) days.add(d); }
        if (qr.kind === 'every') everyN.value = qr.n || 2;
        if (qr.kind === 'monthly') monthDay.value = qr.day || 1;
        drawRepeat();
      },
    }));
    kind.addEventListener('change', drawRepeat);
    type.addEventListener('change', drawRepeat);
    const body = h('div', { class: 'fam-form' },
      quick,
      h('div', { class: 'fam-title-row' }, emoji, title),
      field('Type', type),
      selfOnly ? h('p', { class: 'fam-note' }, `This chore is for you. A parent needs to approve it before its stars count${c ? '' : ' — you can still tick it off meanwhile'}.`)
        : field('Who', who, 'Each person picked has their own to tick off. Pick nobody to make it “up for grabs”.'),
      !selfOnly && c?.approved === false ? h('p', { class: 'fam-note' }, `Made by ${c.createdByName || 'a family member'} and waiting for approval. Saving here approves it.`) : null,
      field('Repeat', h('div', {}, kind, detail)),
      partRow,
      h('div', { class: 'fam-row-wrap' }, field('Stars', stars), field('Time (optional)', time)),
      c ? h('label', { class: 'fam-toggle' }, paused, h('span', { class: 'fam-switch' }), h('span', {}, 'Paused')) : null);
    drawRepeat();
    const out = await sheet(this.app.root, {
      title: c ? 'Edit' : isRoutine ? 'New routine step' : 'New chore', body,
      actions: [c ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
        if (!title.value.trim()) { title.focus(); return; }
        const repeat = { kind: kind.value };
        if (kind.value === 'weekly') repeat.days = [...days].sort();
        if (kind.value === 'every') { repeat.n = Math.max(2, Number(everyN.value) || 2); repeat.from = c?.repeat?.from || ymd(this.date); }
        if (kind.value === 'monthly') repeat.day = Math.min(31, Math.max(1, Number(monthDay.value) || 1));
        if (kind.value === 'once') repeat.date = onceDate.value || ymd(this.date);
        close({
          ...(c || {}), ...(selfOnly ? {} : { approved: true }), title: title.value.trim(), emoji: emoji.value, members: selfOnly ? [this.me.id] : who.value(), stars: Math.max(0, Number(stars.value) || 0), repeat,
          time: time.value || '', kind: type.value, part: part.value, paused: paused.checked, start: c?.start || ymd(startOfDay(new Date())),
        });
      } }],
    });
    if (!out) return;
    try {
      if (out === 'delete') await this.store.del('chores', c.id);
      else await this.store.put('chores', out);
    } catch (err) { toastError(err, 'Couldn’t save the chore'); }
  }
}

// Parents: chores family members made for themselves, to approve (with the stars they'll earn)
// or decline. Approving also counts the stars from times they were already ticked off.
ChoresView.prototype.approvals = async function approvals() {
  if (!(await parentGate(this.app.root, this.store, 'Approving chores needs a parent.'))) return;
  const list = h('div', { class: 'fam-manage' });
  const draw = () => {
    const pending = this.pending();
    if (!pending.length) { s.close(); return; }
    clear(list, pending.map((c) => {
      const who = (c.members || []).map((id) => this.store.member(id)).filter(Boolean);
      const ticks = this.store.all('chorelog').filter((l) => l.chore === c.id).length;
      const stars = input({ type: 'number', min: 0, max: 100, value: c.stars ?? 1, class: 'fam-input tiny', 'aria-label': 'Stars' });
      return h('div', { class: 'fam-manage-row fam-approval' },
        h('span', { class: 'fam-chore-emoji' }, c.emoji || '✔️'),
        h('div', { class: 'fam-manage-main' }, h('b', {}, c.title),
          h('small', {}, [who.map((m) => m.name).join(', '), describeChoreRepeat(c.repeat), c.createdByName ? `made by ${c.createdByName}` : null, ticks ? `done ${ticks} time${ticks === 1 ? '' : 's'} so far` : null].filter(Boolean).join(' · '))),
        h('label', { class: 'fam-approval-stars' }, stars, STAR),
        h('button', { class: 'fam-btn small', onclick: async () => {
          const ok = await sheet(this.app.root, { title: 'Decline this chore?', body: h('p', {}, `“${c.title}” is removed, and any stars waiting for it with it.`), actions: [{ label: 'Cancel' }, { label: 'Decline', danger: true, value: true }] });
          if (!ok) return;
          try { await this.store.batch([...this.store.all('chorelog').filter((l) => l.chore === c.id).map((l) => ({ op: 'delete', col: 'chorelog', id: l.id })), { op: 'delete', col: 'chores', id: c.id }]); draw(); this.render(this.el); } catch (err) { toastError(err); }
        } }, 'Decline'),
        h('button', { class: 'fam-btn small primary', onclick: async () => {
          const n = Math.max(0, Number(stars.value) || 0);
          try {
            await this.store.put('chores', { ...c, approved: true, stars: n });
            // Times it was already ticked off earn the approved number of stars.
            const logs = this.store.all('chorelog').filter((l) => l.chore === c.id && Number(l.stars) !== n);
            if (logs.length) await this.store.batch(logs.map((l) => ({ op: 'put', col: 'chorelog', item: { ...l, stars: n } })));
            toast(`Approved “${c.title}”`, { type: 'success', timeout: 2000 });
            draw(); this.render(this.el);
          } catch (err) { toastError(err); }
        } }, 'Approve'));
    }));
  };
  const s = sheet(this.app.root, { title: 'Chores to approve', body: list, wide: true, actions: [{ label: 'Done', primary: true }] });
  draw();
  await s;
};

const fmtClock = (t) => { const [hh, mm] = t.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

// --- Rewards ----------------------------------------------------------------------------

export class RewardsView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.who = null;
  }

  render(el) {
    this.el = el;
    const members = this.store.members();
    const f = this.app.filter;
    if (!this.who || !this.store.member(this.who)) this.who = (members.find((m) => f.has(m.id)) || members.find((m) => m.role === 'kid') || members[0])?.id || null;
    const bar = h('div', { class: 'fam-toolbar' },
      h('div', { class: 'fam-toolbar-title' }, 'Rewards'),
      h('div', { class: 'fam-spacer' }),
      h('button', { class: 'fam-btn', onclick: () => this.history() }, 'History'),
      h('button', { class: 'fam-btn', onclick: () => this.adjust() }, `${STAR} Give or take stars`),
      h('button', { class: 'fam-btn primary', onclick: () => this.edit(null) }, h('span', { html: ICONS.plus }), 'Reward'));
    const people = h('div', { class: 'fam-star-people' }, members.map((m) => h('button', { class: `fam-star-person ${m.id === this.who ? 'on' : ''}`, style: { '--c': m.color }, onclick: () => { this.who = m.id; this.render(el); } },
      avatar(m, 'lg'), h('b', {}, m.name), h('span', { class: 'fam-stars big' }, `${STAR} ${this.store.stars(m.id)}`))));
    const balance = this.who ? this.store.stars(this.who) : 0;
    const rewards = this.store.all('rewards').filter((r) => !(r.members || []).length || (r.members || []).includes(this.who)).sort((a, b) => a.stars - b.stars);
    const grid = h('div', { class: 'fam-rewards' }, rewards.map((r) => {
      const pct = Math.min(1, balance / Math.max(1, r.stars));
      return h('div', { class: `fam-reward ${pct >= 1 ? 'ready' : ''}` },
        h('button', { class: 'fam-reward-edit fam-icon-btn', title: 'Edit', html: ICONS.edit, onclick: () => this.edit(r) }),
        h('div', { class: 'fam-reward-emoji' }, r.emoji || '🎁'),
        h('b', {}, r.title),
        h('div', { class: 'fam-progress' }, h('i', { style: { width: `${pct * 100}%` } })),
        h('div', { class: 'fam-muted small' }, pct >= 1 ? `${r.stars} ${STAR} — ready!` : `${balance} of ${r.stars} ${STAR}`),
        h('button', { class: `fam-btn ${pct >= 1 ? 'primary' : ''}`, disabled: pct < 1 || !this.who, onclick: () => this.redeem(r) }, 'Redeem'));
    }));
    clear(el, bar, members.length ? people : null, rewards.length ? grid : h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '🎁'), 'Add rewards that stars can be spent on — a movie pick, an outing, extra screen time.'));
  }

  async redeem(r) {
    const m = this.store.member(this.who);
    if (!m) return;
    const ok = await sheet(this.app.root, { title: 'Redeem reward', body: h('p', {}, `Spend ${r.stars} ${STAR} of ${m.name}’s on “${r.title}”?`), actions: [{ label: 'Cancel' }, { label: 'Redeem', primary: true, value: true }] });
    if (!ok || !(await parentGate(this.app.root, this.store, 'A parent needs to approve rewards.'))) return;
    try {
      await this.store.put('redemptions', { reward: r.id, title: r.title, emoji: r.emoji, member: m.id, stars: r.stars, at: Date.now() });
      confetti(this.app.root, this.app.root.getBoundingClientRect().left + this.app.root.clientWidth / 2, this.app.root.getBoundingClientRect().top + this.app.root.clientHeight / 2);
      toast(`${m.name} redeemed ${r.title} ${r.emoji || '🎁'}`, { type: 'success' });
    } catch (err) { toastError(err, 'Couldn’t redeem that'); }
  }

  async adjust() {
    if (!(await parentGate(this.app.root, this.store, 'Changing stars needs a parent.'))) return;
    const members = this.store.members();
    const who = memberPicker(members, this.who ? [this.who] : [], { single: true, allowNone: false });
    const amount = input({ type: 'number', value: 1, class: 'fam-input tiny' });
    const why = input({ placeholder: 'What for? (optional)', maxlength: 100 });
    const mode = select([['give', 'Give'], ['take', 'Take away']], 'give');
    const out = await sheet(this.app.root, {
      title: 'Give or take stars', body: h('div', { class: 'fam-form' }, field('Who', who), h('div', { class: 'fam-when-row' }, mode, amount, h('span', {}, STAR)), why),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => close(true) }],
    });
    const id = who.value()[0];
    const n = Math.abs(Number(amount.value) || 0);
    if (!out || !id || !n) return;
    try { await this.store.put('redemptions', { member: id, stars: mode.value === 'give' ? -n : n, title: why.value.trim() || (mode.value === 'give' ? 'Bonus stars' : 'Stars taken away'), emoji: mode.value === 'give' ? '✨' : '➖', adjust: true, at: Date.now() }); } catch (err) { toastError(err); }
  }

  async history() {
    const rows = [
      ...this.store.all('redemptions').map((r) => ({ at: r.at || r.created, member: r.member, text: r.title, emoji: r.emoji || '🎁', stars: -r.stars })),
      ...this.store.all('chorelog').filter((l) => l.stars).map((l) => {
        const chore = this.store.get('chores', l.chore);
        const waiting = chore?.approved === false;
        const helped = l.for && l.for !== l.member ? this.store.member(l.for)?.name : null;
        return { at: l.at || parseYmd(l.date).getTime() + 12 * 36e5, member: l.member, text: `${chore?.title || 'Chore'}${helped ? ` (for ${helped})` : ''}${waiting ? ' — waiting for a parent' : ''}`, emoji: chore?.emoji || '✔️', stars: waiting ? 0 : l.stars };
      }),
    ].filter((r) => !this.who || r.member === this.who).sort((a, b) => b.at - a.at).slice(0, 200);
    await sheet(this.app.root, {
      title: `Star history${this.who ? ` — ${this.store.member(this.who)?.name}` : ''}`, wide: true,
      body: h('div', { class: 'fam-history' }, rows.length ? rows.map((r) => h('div', { class: 'fam-history-row' },
        h('span', {}, r.emoji), h('span', {}, r.text, h('small', {}, new Date(r.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))),
        h('b', { class: r.stars >= 0 ? 'plus' : 'minus' }, `${r.stars >= 0 ? '+' : ''}${r.stars} ${STAR}`))) : h('div', { class: 'fam-muted' }, 'No stars yet.')),
      actions: [{ label: 'Close', primary: true }],
    });
  }

  async edit(r) {
    if (!(await parentGate(this.app.root, this.store, 'Changing rewards needs a parent.'))) return;
    const emoji = emojiButton(r?.emoji || '🎁');
    const title = input({ value: r?.title || '', placeholder: 'e.g. Pick the movie', required: true, autofocus: true, maxlength: 100 });
    const stars = input({ type: 'number', min: 1, max: 9999, value: r?.stars || 10, class: 'fam-input tiny' });
    const who = memberPicker(this.store.members(), r?.members || []);
    const out = await sheet(this.app.root, {
      title: r ? 'Edit reward' : 'New reward',
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title), field('Costs', h('div', { class: 'fam-when-row' }, stars, h('span', {}, STAR))), field('For', who, 'Pick nobody to make it for everyone.')),
      actions: [r ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!title.value.trim()) return title.focus(); close({ ...(r || {}), title: title.value.trim(), emoji: emoji.value, stars: Math.max(1, Number(stars.value) || 1), members: who.value() }); } }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.store.del('rewards', r.id); else await this.store.put('rewards', out); } catch (err) { toastError(err); }
  }
}
