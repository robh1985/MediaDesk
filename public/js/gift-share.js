// A family gift list opened from its share link: anyone with the link sees the list and can mark a
// gift as taken (with their name), so nobody buys the same thing twice. No account needed.

const token = location.pathname.split('/').filter(Boolean)[1] || '';
const main = document.getElementById('gifts');
const KEY = 'mediadesk-gift-key';
let key = '';
try { key = localStorage.getItem(KEY) || ''; } catch { /* private window */ }
if (!key) { key = crypto.getRandomValues(new Uint8Array(18)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''); try { localStorage.setItem(KEY, key); } catch { /* kept for this visit */ } }
let savedName = '';
try { savedName = localStorage.getItem('mediadesk-gift-name') || ''; } catch { /* none */ }

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let data = null;
let sort = 'wanted';
let only = '';

async function call(path, body) {
  const res = await fetch(`/gift-share/${encodeURIComponent(token)}/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, key }) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

const money = (n) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency || 'USD' }).format(n); } catch { return `$${n}`; } };
const RANGES = [['', 'Any price'], ['0-25', 'Under $25'], ['25-50', '$25–50'], ['50-100', '$50–100'], ['100-', '$100+']];

function draw() {
  document.title = data.title;
  document.documentElement.style.setProperty('--c', data.color || '#d6336c');
  let items = data.items.slice();
  if (only) { const [lo, hi] = only.split('-').map((x) => (x === '' ? null : Number(x))); items = items.filter((i) => i.price != null && (lo == null || i.price >= lo) && (hi == null || i.price < hi)); }
  const by = { wanted: () => 0, low: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9), high: (a, b) => (b.price ?? -1) - (a.price ?? -1), name: (a, b) => a.text.localeCompare(b.text) }[sort];
  items.sort(by);
  items.sort((a, b) => Number(a.taken && !a.mine) - Number(b.taken && !b.mine));
  const when = data.date ? new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  main.replaceChildren(...[
    h('header', { class: 'gs-head' }, h('div', { class: 'gs-emoji' }, data.emoji),
      h('div', {}, h('h1', {}, data.title), h('p', { class: 'muted' }, [data.forName ? `For ${data.forName}` : '', when].filter(Boolean).join(' · ') || (data.family ? `The ${data.family} family` : '')))),
    data.note ? h('div', { class: 'gs-note' }, data.note) : null,
    data.claims ? h('p', { class: 'muted' }, 'Getting something? Tap “I’ll get this” so nobody else buys it too. Only the family sees your name.') : null,
    h('div', { class: 'gs-tools' }, RANGES.map(([v, l]) => h('button', { class: only === v ? 'on' : '', onclick: () => { only = v; draw(); } }, l)),
      h('select', { 'aria-label': 'Sort', onchange: (e) => { sort = e.target.value; draw(); } }, [['wanted', 'Most wanted first'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['name', 'Name']].map(([v, l]) => { const o = h('option', { value: v }, l); if (v === sort) o.selected = true; return o; }))),
    items.length ? h('div', { class: 'gs-list' }, items.map(row)) : h('p', { class: 'gs-empty muted' }, data.items.length ? 'Nothing in that price range.' : 'Nothing on the list yet.'),
    h('footer', { class: 'muted' }, 'Shared from a family’s organizer. Prices and links are as the family added them.')].filter(Boolean));
}

function row(i) {
  const extra = data.fields.map((f) => (i.values?.[f.id] ? h('span', {}, `${f.label}: `, h('b', {}, i.values[f.id])) : null));
  return h('div', { class: `gs-item ${i.taken ? 'taken' : ''} ${i.mine ? 'mine' : ''}` },
    i.image ? h('img', { class: 'gs-pic', src: i.image, alt: '', loading: 'lazy' }) : null,
    h('div', { class: 'gs-body' },
      h('div', { class: 'gs-name' }, i.mostWanted ? h('span', { class: 'gs-want' }, '♥ Most wanted · ') : null, i.text),
      h('div', { class: 'gs-meta' }, i.price != null ? h('b', {}, money(i.price)) : null, i.stars ? h('span', { title: `${i.stars} of 3` }, '★'.repeat(i.stars)) : null, extra,
        i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'See it in the store ↗') : null),
      i.notes ? h('div', { class: 'muted' }, i.notes) : null),
    !data.claims ? null
      : i.mine ? h('button', { class: 'gs-btn ghost', onclick: () => act('unclaim', i) }, 'You’re getting this · Undo')
        : i.taken ? h('button', { class: 'gs-btn', disabled: true }, 'Taken')
          : h('button', { class: 'gs-btn', onclick: () => claim(i) }, 'I’ll get this'));
}

function claim(i) {
  const name = h('input', { placeholder: 'Your name', maxlength: 60, value: savedName, required: true, autocomplete: 'name' });
  const err = h('div', { class: 'gs-error' });
  const box = h('div', { class: 'gs-dialog', onclick: (e) => { if (e.target === box) box.remove(); } },
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      savedName = name.value.trim();
      try { localStorage.setItem('mediadesk-gift-name', savedName); } catch { /* fine */ }
      try { data = await call('claim', { item: i.id, name: savedName }); box.remove(); draw(); } catch (ex) { err.textContent = ex.message; }
    } },
    h('h2', {}, `Getting “${i.text}”?`), h('p', { class: 'muted' }, 'The family sees your name, so nobody else buys it. The person it’s for doesn’t.'), name, err,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'gs-btn ghost', onclick: () => box.remove() }, 'Cancel'), h('button', { class: 'gs-btn' }, 'I’ll get it'))));
  document.body.append(box);
  name.focus();
}

async function act(what, i) {
  try { data = await call(what, { item: i.id }); draw(); } catch (ex) { alert(ex.message); } // eslint-disable-line no-alert
}

(async () => {
  try { data = await call(`data?key=${encodeURIComponent(key)}`); draw(); } catch (ex) {
    main.replaceChildren(h('div', { class: 'gs-gone' }, h('h1', {}, '🎁'), h('p', {}, ex.message || 'This list isn’t shared any more.')));
  }
  // Others may take gifts while this is open.
  setInterval(async () => { if (document.hidden || document.querySelector('.gs-dialog')) return; try { data = await call(`data?key=${encodeURIComponent(key)}`); draw(); } catch { /* try again later */ } }, 30e3);
})();
