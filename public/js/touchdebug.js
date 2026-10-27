// Touch diagnostics: open MediaDesk with ?touchdebug in the address bar to show a panel that logs
// what happens during each swipe (what was touched, which touch-action applies, whether the
// browser cancelled anything, and which element actually scrolled). "Copy" puts the log on the
// clipboard so it can be sent for troubleshooting.

export const JS_REV = 'touchdebug-1';

const short = (el) => {
  if (!el || el === document) return 'document';
  if (el === window) return 'window';
  if (!(el instanceof Element)) return String(el);
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
  const app = el.dataset?.app ? `[${el.dataset.app}]` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}${app}`;
};

export function startTouchDebug() {
  const lines = [];
  const pre = document.createElement('pre');
  const panel = document.createElement('div');
  const copy = document.createElement('button');
  const clearBtn = document.createElement('button');
  const hide = document.createElement('button');
  copy.textContent = 'Copy log'; clearBtn.textContent = 'Clear'; hide.textContent = 'Hide';
  Object.assign(panel.style, { position: 'fixed', left: '4px', right: '4px', top: '4px', maxHeight: '38vh', zIndex: '99999', background: 'rgba(0,0,0,.82)', color: '#9f9', font: '10.5px/1.3 monospace', borderRadius: '8px', display: 'flex', flexDirection: 'column', pointerEvents: 'none' });
  Object.assign(pre.style, { margin: '0', padding: '6px', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: '1' });
  const bar = document.createElement('div');
  Object.assign(bar.style, { display: 'flex', gap: '6px', padding: '4px 6px', pointerEvents: 'auto' });
  for (const b of [copy, clearBtn, hide]) Object.assign(b.style, { font: '12px sans-serif', padding: '4px 10px', borderRadius: '6px', border: '0' });
  bar.append(copy, clearBtn, hide);
  panel.append(bar, pre);
  document.body.append(panel);
  const log = (s) => {
    lines.push(s);
    if (lines.length > 400) lines.shift();
    pre.textContent = lines.slice(-24).join('\n');
  };
  copy.onclick = async () => {
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied!'; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); copy.textContent = 'Copied!'; } catch { copy.textContent = 'Copy failed'; }
      ta.remove();
    }
    setTimeout(() => { copy.textContent = 'Copy log'; }, 1500);
  };
  clearBtn.onclick = () => { lines.length = 0; env(); };
  hide.onclick = () => { panel.style.display = 'none'; };

  const env = () => {
    const vv = window.visualViewport;
    const cssRev = getComputedStyle(document.documentElement).getPropertyValue('--css-rev').trim() || '(none)';
    log(`MediaDesk touch log · css ${cssRev} · js ${JS_REV}`);
    log(`UA ${navigator.userAgent}`);
    log(`inner ${innerWidth}x${innerHeight} · dpr ${devicePixelRatio} · vv ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} scale ${vv.scale.toFixed(2)} off ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : 'n/a'} · coarse ${matchMedia('(pointer: coarse)').matches} · narrow ${innerWidth < 760}`);
    log(`body: ${document.body.className} · desktop overflowY ${getComputedStyle(document.getElementById('desktop')).overflowY} scrollTop ${document.getElementById('desktop').scrollTop} · doc scroll ${document.scrollingElement?.scrollTop}`);
  };
  env();

  let swipe = null;
  const scrolled = new Map();
  document.addEventListener('scroll', (e) => {
    if (!swipe) return;
    const t = e.target === document ? document.scrollingElement : e.target;
    scrolled.set(short(e.target), `${t.scrollTop ?? ''}`);
  }, { capture: true, passive: true });
  window.visualViewport?.addEventListener('scroll', () => { if (swipe) scrolled.set('visualViewport', `${Math.round(visualViewport.offsetTop)}`); });

  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const path = e.composedPath().filter((n) => n instanceof Element).slice(0, 14);
    const blockers = path.map((n) => [short(n), getComputedStyle(n).touchAction, getComputedStyle(n).overflowY]).filter(([, ta]) => ta !== 'auto');
    const scrollers = path.filter((n) => { const oy = getComputedStyle(n).overflowY; return (oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1; });
    const hit = document.elementFromPoint(t.clientX, t.clientY);
    swipe = { y: t.clientY, x: t.clientX, moves: 0, cancelable: [], prevented: 0, tops: scrollers.map((n) => [n, n.scrollTop]) };
    scrolled.clear();
    log(`— touchstart @${Math.round(t.clientX)},${Math.round(t.clientY)} target ${short(e.target)}${hit !== e.target ? ` (elementFromPoint ${short(hit)})` : ''}`);
    log(`  path ${path.slice(0, 7).map(short).join(' < ')}`);
    log(`  touch-action≠auto: ${blockers.length ? blockers.map(([n, ta]) => `${n}=${ta}`).join(', ') : 'none'}`);
    log(`  scrollable ancestors: ${scrollers.length ? scrollers.map((n) => `${short(n)} ${n.scrollTop}/${n.scrollHeight - n.clientHeight}`).join(', ') : 'NONE'}`);
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!swipe) return;
    swipe.moves++;
    swipe.cancelable.push(e.cancelable ? 'c' : 'u');
    setTimeout(() => { if (e.defaultPrevented && swipe) swipe.prevented++; }, 0);
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', (e) => { if (swipe) log(`  pointercancel (${e.pointerType}) — browser took the gesture`); }, true);
  const end = (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const s = swipe;
    setTimeout(() => {
      log(`  touchend dy ${Math.round(t.clientY - s.y)} dx ${Math.round(t.clientX - s.x)} · moves ${s.moves} [${s.cancelable.join('')}] · prevented ${s.prevented}`);
      log(`  scroll events: ${scrolled.size ? [...scrolled].map(([k, v]) => `${k}→${v}`).join(', ') : 'NONE'}`);
      log(`  ancestors now: ${s.tops.map(([n, before]) => `${short(n)} ${before}→${n.scrollTop}`).join(', ') || '—'}`);
      swipe = null;
    }, 450);
  };
  document.addEventListener('touchend', end, { capture: true, passive: true });
  document.addEventListener('touchcancel', end, { capture: true, passive: true });
}
