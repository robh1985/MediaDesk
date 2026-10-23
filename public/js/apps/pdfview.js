// A PDF viewer built on PDF.js (public/vendor/pdfjs). Pages render as they scroll into view, with
// zoom, fit-to-width/page, page jumping and a text layer so text can be selected and copied.

import { h, clear } from '../ui.js';

const BASE = '/vendor/pdfjs/';
let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = import(`${BASE}pdf.min.mjs`).then((m) => { m.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`; return m; });
  }
  return lib;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// source: a URL or { data: ArrayBuffer }. Returns { destroy }.
export async function showPdf(container, source, { onError } = {}) {
  const m = await pdfjs();
  const task = m.getDocument({
    ...(typeof source === 'string' ? { url: source, withCredentials: true } : { data: source.data }),
    standardFontDataUrl: `${BASE}standard_fonts/`, wasmUrl: `${BASE}wasm/`,
    enableXfa: false,
  });
  let doc;
  try { doc = await task.promise; }
  catch (err) { onError?.(err); throw err; }

  const pagesEl = h('div', { class: 'pdf-pages' });
  const scroller = h('div', { class: 'pdf-scroller', tabindex: '0' }, pagesEl);
  const pageInput = h('input', { class: 'input pdf-page-input', inputmode: 'numeric', value: '1', 'aria-label': 'Page' });
  const zoomLabel = h('button', { class: 'pdf-zoom-label', title: 'Fit width' });
  const tool = (glyph, title, fn) => h('button', { class: 'btn btn-icon btn-sm btn-ghost', title, 'aria-label': title, html: glyph, onclick: fn });
  const bar = h('div', { class: 'pdf-bar' },
    tool(svg('<path d="m15 18-6-6 6-6"/>'), 'Previous page', () => go(current - 1)),
    pageInput, h('span', { class: 'small muted' }, `/ ${doc.numPages}`),
    tool(svg('<path d="m9 18 6-6-6-6"/>'), 'Next page', () => go(current + 1)),
    h('span', { class: 'pdf-sep' }),
    tool(svg('<path d="M5 12h14"/>'), 'Zoom out', () => setZoom(zoom / 1.2)),
    zoomLabel,
    tool(svg('<path d="M12 5v14M5 12h14"/>'), 'Zoom in', () => setZoom(zoom * 1.2)),
    tool(svg('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'), 'Fit page', () => fit('page')));
  clear(container, h('div', { class: 'pdf' }, bar, scroller));

  // Sizes of every page at scale 1 (cheap: no drawing).
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    sizes.push({ w: v.width, h: v.height });
    if (i > 400) { while (sizes.length < doc.numPages) sizes.push(sizes[0]); break; }
  }
  let zoom = 1, mode = 'width', current = 1;
  const pages = sizes.map((s, i) => {
    const el = h('div', { class: 'pdf-page', dataset: { n: i + 1 } });
    return { el, n: i + 1, rendered: 0, task: null };
  });
  pagesEl.append(...pages.map((p) => p.el));

  const layout = () => {
    pages.forEach((p, i) => {
      p.el.style.width = `${Math.floor(sizes[i].w * zoom)}px`;
      p.el.style.height = `${Math.floor(sizes[i].h * zoom)}px`;
    });
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const fitScale = (how) => {
    const w = scroller.clientWidth - 32, hgt = scroller.clientHeight - 24;
    const s = sizes[current - 1] || sizes[0];
    return how === 'page' ? Math.min(w / s.w, hgt / s.h) : w / s.w;
  };
  const rerender = () => {
    pages.forEach((p) => { if (p.rendered && p.rendered !== zoom) { p.task?.cancel(); p.rendered = 0; } });
    layout();
    observe();
  };
  function setZoom(z, keep = true) {
    const before = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    zoom = Math.max(0.25, Math.min(5, z));
    mode = 'custom';
    rerender();
    if (keep) scroller.scrollTop = before * scroller.scrollHeight;
  }
  function fit(how) {
    mode = how;
    zoom = Math.max(0.25, Math.min(5, fitScale(how)));
    rerender();
  }
  zoomLabel.onclick = () => fit('width');

  async function render(p) {
    if (p.rendered === zoom || p.task) return;
    const page = await doc.getPage(p.n);
    const viewport = page.getViewport({ scale: zoom });
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const canvas = h('canvas', { class: 'pdf-canvas' });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const z = zoom;
    p.task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    try { await p.task.promise; }
    catch { p.task = null; return; }            // cancelled by a zoom change
    p.task = null;
    if (z !== zoom) return;
    const text = h('div', { class: 'textLayer' });
    p.el.style.setProperty('--total-scale-factor', String(zoom * (page.userUnit || 1)));
    clear(p.el, canvas, text);
    p.rendered = zoom;
    try { await new m.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render(); } catch { /* text is optional */ }
  }

  // Draw pages near the visible area; forget far-away ones to save memory.
  let io;
  function observe() {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = pages[Number(e.target.dataset.n) - 1];
        if (e.isIntersecting) render(p);
      }
      const visible = pages.filter((p) => { const r = p.el.getBoundingClientRect(), s = scroller.getBoundingClientRect(); return r.bottom > s.top && r.top < s.bottom; });
      if (visible.length) { current = visible[0].n; if (document.activeElement !== pageInput) pageInput.value = String(current); }
    }, { root: scroller, rootMargin: '600px 0px' });
    pages.forEach((p) => io.observe(p.el));
  }
  scroller.addEventListener('scroll', () => {
    const s = scroller.getBoundingClientRect();
    const mid = pages.find((p) => { const r = p.el.getBoundingClientRect(); return r.bottom > s.top + 40; });
    if (mid) { current = mid.n; if (document.activeElement !== pageInput) pageInput.value = String(current); }
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      if (p.rendered && (r.bottom < s.top - 3000 || r.top > s.bottom + 3000)) { clear(p.el); p.rendered = 0; }
    }
  }, { passive: true });

  function go(n) {
    const t = Math.max(1, Math.min(doc.numPages, n));
    current = t;
    pageInput.value = String(t);
    scroller.scrollTop = pages[t - 1].el.offsetTop - 12;
  }
  pageInput.addEventListener('change', () => go(parseInt(pageInput.value, 10) || 1));
  pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(parseInt(pageInput.value, 10) || 1); pageInput.blur(); } });
  scroller.addEventListener('keydown', (e) => {
    if (e.target !== scroller) return;
    if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
    if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom * 1.2); }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(zoom / 1.2); }
  });
  scroller.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.002)); } }, { passive: false });
  const ro = new ResizeObserver(() => { if (mode !== 'custom') fit(mode); });
  ro.observe(scroller);

  fit('width');
  scroller.focus({ preventScroll: true });
  return { destroy: () => { io?.disconnect(); ro.disconnect(); doc.destroy(); }, numPages: doc.numPages };
}
