// Reading a cookbook like a book: a cover, a contents page, then each recipe laid out over as
// many pages as it needs, shown as an open book (two pages side by side, one on a phone). Pages
// turn with a page-turn animation: arrows, the keyboard, a swipe, or a tap on a page's edge.

import { h, clear } from '../../ui.js';
import { ICONS } from './shared.js';

const isSection = (line) => /^#\s+/.test(line);
const sectionTitle = (line) => line.replace(/^#\s+/, '');
const stepList = (r) => String(r.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
const fmtMins = (m) => (!m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const TURN_MS = 650;

export function openBook(box, book) {
  const recipes = box.bookRecipes(book).sort((a, b) => a.title.localeCompare(b.title));
  const family = box.store.settings.familyName;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pages = []; // { el, kind, recipe }
  let at = 0; // single: the page shown; spread: the spread shown (0 = the cover on its own)
  let spread = false;
  let turning = false;

  const stage = h('div', { class: 'fam-bk-stage' });
  const where = h('span', { class: 'fam-bk-where' });
  const prev = h('button', { class: 'fam-bk-arrow left', 'aria-label': 'Previous page', html: ICONS.left, onclick: () => turn(-1) });
  const next = h('button', { class: 'fam-bk-arrow right', 'aria-label': 'Next page', html: ICONS.right, onclick: () => turn(1) });
  const root = h('div', { class: 'fam-bk', style: { '--bk': book.color || '#e8590c' }, role: 'dialog', 'aria-label': `${book.name}, a cookbook` },
    h('div', { class: 'fam-bk-top' },
      h('span', { class: 'fam-bk-name' }, `${book.emoji || '📕'} ${book.name}`), where, h('div', { class: 'fam-spacer' }),
      h('button', { class: 'fam-btn small', onclick: () => goTo(contentsPage()) }, 'Contents'),
      h('button', { class: 'fam-icon-btn', 'aria-label': 'Close the book', html: ICONS.close, onclick: () => close() })),
    h('div', { class: 'fam-bk-room' }, prev, stage, next));

  // --- Laying out the pages -----------------------------------------------------------------

  function size() {
    const vw = root.clientWidth || innerWidth;
    const vh = (root.clientHeight || innerHeight) - 64;
    spread = vw >= 820;
    const across = spread ? 2 : 1;
    const maxW = (vw - (spread ? 140 : 24)) / across;
    let w = Math.min(maxW, 560);
    let ht = w / (spread ? 0.72 : 0.6);
    if (ht > vh - 24) { ht = vh - 24; w = Math.min(maxW, ht * 0.72); }
    root.style.setProperty('--pw', `${Math.floor(w)}px`);
    root.style.setProperty('--ph', `${Math.floor(ht)}px`);
  }

  const page = (kind, run = '') => {
    const body = h('div', { class: 'fam-bk-body' });
    const el = h('div', { class: `fam-bk-page ${kind}` }, run ? h('div', { class: 'fam-bk-run' }, run) : null, body, h('div', { class: 'fam-bk-num' }));
    return { el, body, kind };
  };

  // Blocks flow onto pages; a page that overflows starts the next one. A heading never ends a page.
  function flow(blocks, kind, run, measure, recipe) {
    const out = [];
    let cur = null;
    const fresh = () => { cur = page(kind, run); cur.recipe = recipe; measure.replaceChildren(cur.el); out.push(cur); };
    fresh();
    for (const b of blocks) {
      cur.body.append(b);
      if (cur.body.scrollHeight > cur.body.clientHeight + 1 && cur.body.children.length > 1) {
        b.remove();
        const last = cur.body.lastElementChild;
        const carry = last?.classList.contains('fam-bk-h') && cur.body.children.length > 1 ? last : null;
        carry?.remove();
        fresh();
        if (carry) cur.body.append(carry);
        cur.body.append(b);
      }
    }
    measure.replaceChildren();
    return out;
  }

  function recipeBlocks(r) {
    const src = box.img(r);
    const meta = [fmtMins(r.prepMin) && `Prep ${fmtMins(r.prepMin)}`, fmtMins(r.cookMin) && `Cook ${fmtMins(r.cookMin)}`, fmtMins(r.minutes) && `Total ${fmtMins(r.minutes)}`, r.servings && `Serves ${r.servings}`, r.yield && r.yield !== String(r.servings) ? `Makes ${r.yield}` : ''].filter(Boolean);
    const blocks = [h('div', { class: 'fam-bk-rhead' },
      src ? h('img', { class: 'fam-bk-photo', src, alt: '' }) : h('div', { class: 'fam-bk-remoji' }, r.emoji || '🍲'),
      h('h2', {}, r.title),
      meta.length ? h('div', { class: 'fam-bk-meta' }, meta.join(' · ')) : null,
      r.rating ? h('div', { class: 'fam-bk-stars' }, '★'.repeat(Math.round(r.rating))) : null)];
    if (r.description) blocks.push(h('p', { class: 'fam-bk-desc' }, r.description));
    if ((r.ingredients || []).length) {
      blocks.push(h('h3', { class: 'fam-bk-h' }, 'Ingredients'));
      for (const l of r.ingredients) blocks.push(isSection(l) ? h('div', { class: 'fam-bk-sec fam-bk-h' }, sectionTitle(l)) : h('div', { class: 'fam-bk-ing' }, l));
    }
    const steps = stepList(r);
    if (steps.length) {
      blocks.push(h('h3', { class: 'fam-bk-h' }, 'Method'));
      let n = 0;
      for (const s of steps) blocks.push(isSection(s) ? h('div', { class: 'fam-bk-sec fam-bk-h' }, sectionTitle(s)) : h('div', { class: 'fam-bk-step' }, h('b', {}, ++n), h('span', {}, s)));
    }
    if (r.notes) { blocks.push(h('h3', { class: 'fam-bk-h' }, 'Notes')); for (const l of r.notes.split('\n').filter(Boolean)) blocks.push(h('p', { class: 'fam-bk-note' }, l)); }
    blocks.push(h('button', { class: 'fam-bk-open', onclick: () => { close(); box.show(r); } }, 'Open in the recipe box →'));
    return blocks;
  }

  function build() {
    size();
    const measure = h('div', { class: 'fam-bk-measure', 'aria-hidden': 'true' });
    root.append(measure);
    const cover = page('cover');
    cover.body.append(h('div', { class: 'fam-bk-cover' },
      h('div', { class: 'fam-bk-cemoji' }, book.emoji || '📕'), h('h1', {}, book.name),
      book.description ? h('p', {}, book.description) : null,
      h('div', { class: 'fam-bk-cfoot' }, family ? `The ${family} family` : 'Our family', ' · ', `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`)));
    const tocNums = new Map();
    const toc = flow([h('h2', { class: 'fam-bk-toctitle' }, 'Contents'), ...recipes.map((r) => {
      const num = h('span', { class: 'fam-bk-tocnum' });
      tocNums.set(r.id, num);
      return h('button', { class: 'fam-bk-tocline', onclick: () => goTo(Number(num.textContent)) }, h('span', {}, r.title), h('i', {}), num);
    })], 'contents', '', measure);
    const list = [cover, ...toc];
    for (const r of recipes) {
      // In an open book each recipe starts on a left-hand page.
      if (spread && list.length % 2 === 0) { const blank = page('blank'); blank.body.append(h('div', { class: 'fam-bk-orn' }, '❦')); list.push(blank); }
      const ps = flow(recipeBlocks(r), 'recipe', r.title, measure, r);
      tocNums.get(r.id).textContent = list.length;
      list.push(...ps);
    }
    if (!recipes.length) { const empty = page('blank'); empty.body.append(h('div', { class: 'fam-bk-orn' }, 'This cookbook has no recipes yet.')); list.push(empty); }
    if (spread && list.length % 2 === 0) list.push(page('blank'));
    const back = page('back');
    back.body.append(h('div', { class: 'fam-bk-cover' }, h('div', { class: 'fam-bk-orn big' }, '❦'), h('p', {}, 'Made with love in our kitchen')));
    list.push(back);
    list.forEach((p, n) => { if (n && p.kind !== 'back' && p.kind !== 'blank') p.el.querySelector('.fam-bk-num').textContent = n; });
    measure.remove();
    pages = list;
  }

  const contentsPage = () => (pages.length > 1 ? 1 : 0);

  // --- Showing and turning ------------------------------------------------------------------

  // Pages shown at a position: [left, right] in a spread (the cover sits alone on the right).
  const spreadAt = (s) => [s === 0 ? null : pages[2 * s - 1] || null, pages[2 * s] || null];
  const lastAt = () => (spread ? Math.ceil((pages.length - 1) / 2) : pages.length - 1);
  const face = (p, side) => (p ? Object.assign(p.el.cloneNode(true), { className: `${p.el.className} ${side}` }) : h('div', { class: `fam-bk-page empty ${side}` }));
  const wire = (el) => {
    // Clones lose their handlers: contents lines and "Open in the recipe box" are re-wired.
    el.querySelectorAll('.fam-bk-tocline').forEach((b) => { b.onclick = () => goTo(Number(b.querySelector('.fam-bk-tocnum').textContent)); });
    el.querySelectorAll('.fam-bk-open').forEach((b) => { b.onclick = () => { const rec = pages[Number(el.dataset.page)]?.recipe; close(); if (rec) box.show(rec); }; });
    return el;
  };
  const show = (p, side, idx) => { const el = face(p, side); if (p) el.dataset.page = String(idx); return wire(el); };


  function draw() {
    if (spread) {
      const [l, r] = spreadAt(at);
      clear(stage, h('div', { class: `fam-bk-spread ${at === 0 ? 'closed' : ''} ${at === lastAt() && !r ? 'end' : ''}` },
        show(l, 'left', 2 * at - 1), show(r, 'right', 2 * at)));
      const nums = [l && 2 * at - 1, r && 2 * at].filter((x) => x);
      where.textContent = at === 0 ? 'Cover' : `Pages ${nums.join('–')} of ${pages.length - 1}`;
    } else {
      clear(stage, h('div', { class: 'fam-bk-spread single' }, show(pages[at], 'right', at)));
      where.textContent = at === 0 ? 'Cover' : `Page ${at} of ${pages.length - 1}`;
    }
    prev.disabled = at === 0;
    next.disabled = at >= lastAt();
  }

  async function turn(d) {
    if (turning) return;
    const to = at + d;
    if (to < 0 || to > lastAt()) return;
    if (reduced) { at = to; draw(); return; }
    turning = true;
    const sp = stage.firstElementChild;
    let leaf;
    if (spread) {
      const [l, r] = spreadAt(at);
      const [nl, nr] = spreadAt(to);
      // Underneath: what stays put, and what the turning leaf uncovers.
      clear(sp, d > 0 ? show(l, 'left', 2 * at - 1) : show(nl, 'left', 2 * to - 1), d > 0 ? show(nr, 'right', 2 * to) : show(r, 'right', 2 * at));
      sp.classList.toggle('closed', false);
      leaf = h('div', { class: `fam-bk-leaf ${d > 0 ? 'fwd' : 'back'}` },
        h('div', { class: 'fam-bk-face front' }, d > 0 ? show(r, 'right', 2 * at) : show(l, 'left', 2 * at - 1)),
        h('div', { class: 'fam-bk-face rear' }, d > 0 ? show(nl, 'left', 2 * to - 1) : show(nr, 'right', 2 * to)));
    } else {
      clear(sp, show(pages[d > 0 ? to : at], 'right', d > 0 ? to : at));
      leaf = h('div', { class: `fam-bk-leaf single ${d > 0 ? 'fwd' : 'back'}` }, h('div', { class: 'fam-bk-face front' }, show(pages[d > 0 ? at : to], 'right', d > 0 ? at : to)));
    }
    sp.append(leaf);
    requestAnimationFrame(() => requestAnimationFrame(() => leaf.classList.add('go')));
    await new Promise((r) => setTimeout(r, TURN_MS));
    at = to;
    turning = false;
    draw();
  }

  function goTo(n) {
    if (!Number.isFinite(n)) return;
    const to = spread ? Math.ceil(n / 2) : n;
    if (to === at) return;
    if (Math.abs(to - at) === 1) { turn(to - at); return; }
    at = Math.max(0, Math.min(lastAt(), to));
    draw();
  }

  // --- Input ------------------------------------------------------------------------------

  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(pages.length - 1);
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  let sx = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) { turn(dx < 0 ? 1 : -1); return; }
    // A tap near a page's outer edge turns it, as with a real book.
    if (e.target.closest('button, a')) return;
    const box2 = stage.getBoundingClientRect();
    if (e.clientX > box2.right - 70) turn(1);
    else if (e.clientX < box2.left + 70) turn(-1);
  });
  let rt = null;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const page0 = spread ? Math.max(0, 2 * at - 1) : at;
      const recipe = pages[page0]?.recipe;
      build();
      const n = recipe ? pages.findIndex((p) => p.recipe === recipe) : page0;
      at = Math.min(lastAt(), spread ? Math.ceil(Math.max(0, n) / 2) : Math.max(0, n));
      draw();
    }, 200);
  };
  function close() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root.remove();
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  box.app.root.append(root);
  build();
  draw();
  root.focus?.();
  return { close, turn, goTo };
}
