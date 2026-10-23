// Pointer dragging for icons. With a mouse a drag starts after a few pixels of movement; with a
// finger you hold first (as on Android), so swiping across icons still scrolls the page. The
// long-press menu still appears when you hold without moving; moving then closes it and drags.

import { closeMenu } from './ui.js';

const HOLD_MS = 380;

export function draggable(el, { onStart, onMove, onEnd, canDrag = () => true, threshold = 6 }) {
  let st = null;

  const begin = (e) => {
    st.dragging = true;
    closeMenu();
    el.setPointerCapture?.(e.pointerId);
    onStart?.(st, e);
  };
  const finish = (e, cancelled) => {
    const s = st;
    st = null;
    clearTimeout(s?.timer);
    if (!s?.dragging) return;
    // Swallow the click that follows the drag.
    const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, { capture: true }), 50);
    onEnd?.(s, e, cancelled);
  };

  el.addEventListener('pointerdown', (e) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || !canDrag(e)) return;
    st = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', armed: e.pointerType === 'mouse', dragging: false, id: e.pointerId };
    if (!st.touch) el.setPointerCapture?.(e.pointerId);
    if (st.touch) {
      st.timer = setTimeout(() => { if (st && !st.dragging) { st.armed = true; el.classList.add('drag-armed'); navigator.vibrate?.(10); } }, HOLD_MS);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.x = e.clientX; st.y = e.clientY;
    const dist = Math.hypot(st.x - st.x0, st.y - st.y0);
    if (!st.dragging) {
      if (st.touch && !st.armed) { if (dist > 10) { clearTimeout(st.timer); st = null; } return; }
      if (dist < threshold) return;
      begin(e);
    }
    onMove?.(st, e);
  });
  el.addEventListener('pointerup', (e) => { el.classList.remove('drag-armed'); if (st && e.pointerId === st.id) finish(e, false); });
  el.addEventListener('pointercancel', (e) => { el.classList.remove('drag-armed'); if (st && e.pointerId === st.id) finish(e, true); });
  // While holding or dragging with a finger, don't let the page scroll.
  el.addEventListener('touchmove', (e) => { if (st && (st.armed || st.dragging)) e.preventDefault(); }, { passive: false });
  // Stop the browser's own drag-and-drop of images and links.
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

// A floating copy of an element that follows the pointer.
export function ghostOf(el, x, y) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('selected', 'drag-armed');
  Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '9500', pointerEvents: 'none' });
  ghost.dataset.dx = String(x - r.left);
  ghost.dataset.dy = String(y - r.top);
  document.body.append(ghost);
  return ghost;
}
export function moveGhost(ghost, x, y) {
  ghost.style.left = `${x - Number(ghost.dataset.dx)}px`;
  ghost.style.top = `${y - Number(ghost.dataset.dy)}px`;
}
