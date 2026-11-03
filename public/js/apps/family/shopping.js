// Shopping mode: a list on the whole screen, big enough to read in a store aisle with a trolley in
// the other hand. Items are in aisle order with a bar to jump between aisles; tap an item when it's
// in the cart (or each flavor of it); what's in the cart drops to the bottom. Nothing can be added
// or edited here, and the screen stays on. Changes others make show up as they happen.

import { h, clear, toastError } from '../../ui.js';
import { aisles, aisleFor } from './groceries.js';
import { varietiesOf } from './lists.js';

const SIZE_KEY = 'mediadesk.family.shoppingSize';
const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function shoppingMode(view, list) {
  const store = view.store;
  const root = view.app.root;
  let size = Number(localStorage.getItem(SIZE_KEY)) || 1;
  let showCart = false;
  let wake = null;
  let wentFull = false;

  const progress = h('div', { class: 'fam-shop-progress' });
  const bar = h('div', { class: 'fam-shop-bar' }, h('i'));
  const nav = h('div', { class: 'fam-shop-nav', role: 'navigation', 'aria-label': 'Aisles' });
  const scroller = h('div', { class: 'fam-shop-scroll' });
  const sizeBtn = (d, label) => h('button', { class: 'fam-shop-size', 'aria-label': d > 0 ? 'Bigger text' : 'Smaller text', onclick: () => { size = Math.min(1.6, Math.max(0.8, Math.round((size + d) * 10) / 10)); try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* fine */ } overlay.style.setProperty('--shop-size', size); } }, label);
  const overlay = h('div', { class: 'fam-shop', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Shopping: ${list.title}`, style: { '--c': list.color || '#2f9e44', '--shop-size': size } },
    h('div', { class: 'fam-shop-head' },
      h('div', { class: 'fam-shop-title' }, h('span', {}, list.emoji || '🛒'), h('b', {}, list.title)),
      progress,
      h('div', { class: 'fam-shop-tools' }, sizeBtn(-0.1, 'A−'), sizeBtn(0.1, 'A+'), h('button', { class: 'fam-shop-done', onclick: () => close() }, 'Done'))),
    bar, nav, scroller);

  const groupsOf = (items) => {
    if (list.kind !== 'grocery' || list.group === false) return [{ a: null, items }];
    const order = aisles(store);
    const pos = (id) => { const n = order.findIndex((a) => a.id === id); return n < 0 ? 999 : n; };
    const map = new Map();
    for (const i of items) { const a = aisleFor(store, i); if (!map.has(a.id)) map.set(a.id, { a, items: [] }); map.get(a.id).items.push(i); }
    return [...map.values()].sort((x, y) => pos(x.a.id) - pos(y.a.id));
  };

  const tick = async (i) => {
    const done = !i.done;
    try { await store.put('listitems', { ...i, done, doneAt: done ? Date.now() : null, ...(done ? {} : { gotVarieties: [] }) }); } catch (err) { toastError(err); }
  };

  function row(i) {
    const kinds = varietiesOf(i);
    return h('div', { class: `fam-shop-item ${i.done ? 'done' : ''}`, role: 'button', tabindex: 0, 'aria-pressed': String(Boolean(i.done)),
      onclick: () => tick(i), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tick(i); } } },
    h('span', { class: 'fam-shop-check', 'aria-hidden': 'true' }, i.done ? '✓' : ''),
    h('span', { class: 'fam-shop-text' },
      h('span', { class: 'fam-shop-name' }, i.text),
      i.qty || i.brand || i.notes ? h('span', { class: 'fam-shop-meta' },
        i.qty ? h('b', { class: 'fam-shop-qty' }, i.qty) : null,
        i.brand ? h('span', { class: 'fam-shop-brand' }, `🏷️ ${i.brand}`) : null,
        i.notes ? h('span', { class: 'fam-shop-notes' }, i.notes) : null) : null,
      kinds.length ? h('span', { class: 'fam-shop-kinds' }, kinds.map((v) => {
        const got = (i.gotVarieties || []).some((x) => sameText(x, v));
        return h('button', { type: 'button', class: `fam-shop-kind ${got ? 'got' : ''}`, 'aria-pressed': String(got), onclick: (e) => { e.stopPropagation(); view.toggleFlavor(i, v); } }, got ? `✓ ${v}` : v);
      })) : null));
  }

  function draw() {
    const items = view.items(list.id);
    const left = items.filter((i) => !i.done);
    const inCart = items.filter((i) => i.done);
    const total = items.length;
    clear(progress, total ? `${inCart.length} of ${total} in the cart` : 'Nothing on the list');
    bar.firstChild.style.width = `${total ? (inCart.length / total) * 100 : 0}%`;
    const top = scroller.scrollTop;
    const groups = groupsOf(left);
    // Aisles still to visit, to jump to.
    clear(nav, groups.filter((g) => g.a).map((g) => h('button', { class: 'fam-shop-chip', dataset: { aisle: g.a.id }, onclick: () => {
      const head = scroller.querySelector(`.fam-shop-aisle[data-aisle="${g.a.id}"]`);
      if (head) scroller.scrollTo({ top: head.offsetTop - 4, behavior: 'smooth' });
    } }, `${g.a.emoji || '🛍️'} ${g.a.name}`, h('span', {}, g.items.length))));
    nav.hidden = !nav.children.length;
    clear(scroller,
      groups.map((g) => [g.a ? h('div', { class: 'fam-shop-aisle', dataset: { aisle: g.a.id } }, `${g.a.emoji || '🛍️'} ${g.a.name}`) : null, g.items.map(row)]),
      !left.length && total ? h('div', { class: 'fam-shop-finished' }, h('div', { class: 'fam-shop-party' }, '🎉'), h('b', {}, 'Everything’s in the cart'),
        h('div', { class: 'fam-shop-finish-btns' },
          h('button', { class: 'fam-btn', onclick: async () => { try { await store.batch(inCart.map((i) => ({ op: 'delete', col: 'listitems', id: i.id }))); } catch (err) { toastError(err); } } }, 'Clear the list'),
          h('button', { class: 'fam-btn primary', onclick: () => close() }, 'Done'))) : null,
      inCart.length ? h('button', { class: 'fam-shop-cart-head', 'aria-expanded': String(showCart), onclick: () => { showCart = !showCart; draw(); } }, `✓ In the cart (${inCart.length})`, h('span', {}, showCart ? '▴' : '▾')) : null,
      showCart ? inCart.map(row) : null,
      !total ? h('div', { class: 'fam-shop-finished' }, h('b', {}, 'This list is empty')) : null);
    scroller.scrollTop = top;
    markAisle();
  }

  // The aisle being looked at, highlighted in the bar.
  function markAisle() {
    const heads = [...scroller.querySelectorAll('.fam-shop-aisle')];
    let cur = heads[0]?.dataset.aisle;
    for (const hd of heads) if (hd.offsetTop - scroller.scrollTop <= 40) cur = hd.dataset.aisle;
    nav.querySelectorAll('.fam-shop-chip').forEach((c) => {
      const on = c.dataset.aisle === cur;
      c.classList.toggle('on', on);
      if (on && (c.offsetLeft < nav.scrollLeft || c.offsetLeft + c.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollLeft = c.offsetLeft - 12;
    });
  }
  scroller.addEventListener('scroll', markAisle, { passive: true });

  const unsub = store.on(() => { if (overlay.isConnected) draw(); });
  // Esc leaves (where the browser uses it to leave full screen, that closes shopping mode too).
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const onFull = () => { if (wentFull && !document.fullscreenElement) close(); };
  const keepAwake = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not here */ } };
  const onVisible = () => { if (document.visibilityState === 'visible' && overlay.isConnected) keepAwake(); };

  function close() {
    if (!overlay.isConnected) return;
    unsub();
    removeEventListener('keydown', onKey, true);
    document.removeEventListener('fullscreenchange', onFull);
    document.removeEventListener('visibilitychange', onVisible);
    try { wake?.release(); } catch { /* gone */ }
    if (document.fullscreenElement === overlay) document.exitFullscreen().catch(() => {});
    overlay.remove();
  }

  root.append(overlay);
  draw();
  addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFull);
  document.addEventListener('visibilitychange', onVisible);
  keepAwake();
  // The whole screen where the browser allows it (phones without it get the whole window).
  if (overlay.requestFullscreen && !document.fullscreenElement) overlay.requestFullscreen({ navigationUI: 'hide' }).then(() => { wentFull = true; }).catch(() => {});
  overlay.querySelector('.fam-shop-done').focus({ preventScroll: true });
  return { close };
}
