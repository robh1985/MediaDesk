// Books for the eBook Reader: EPUB (reflowing text laid out into pages that fit the book on
// screen), PDF (drawn with PDF.js) and comic books (CBZ: pictures in a zip). Each gives the reader
// the same things: how many pages, their shape, each page drawn on request, the contents, search.
//
// EPUB chapters are XHTML from inside the file, so they're rebuilt from an allow-list of plain
// tags and attributes (no scripts, styles, frames or event handlers) before being shown.

import { h } from '../../ui.js';

// --- Libraries (in public/vendor, loaded the first time they're needed) -----------------------
let zipLib = null;
function jszip() {
  zipLib ||= new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return; }
    const s = document.createElement('script');
    s.src = '/vendor/jszip/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Couldn’t load the zip reader'));
    document.head.append(s);
  });
  return zipLib;
}
const PDF_BASE = '/vendor/pdfjs/';
let pdfLib = null;
function pdfjs() {
  pdfLib ||= import(`${PDF_BASE}pdf.min.mjs`).then((m) => { m.GlobalWorkerOptions.workerSrc = `${PDF_BASE}pdf.worker.min.mjs`; return m; });
  return pdfLib;
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolvePath(base, rel) {
  if (/^[a-z]+:/i.test(rel)) return rel;
  const parts = (dirOf(base) + rel).split('/');
  const out = [];
  for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.' && part !== '') out.push(part); }
  return out.join('/');
}
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

async function fetchBytes(src, onProgress) {
  if (src.data) return src.data;
  const res = await fetch(src.url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(res.status === 404 ? 'That book can’t be found' : `Couldn’t open the book (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// Mark every match of a search in an element's text.
export function markText(root, q) {
  if (!q) return;
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const low = text.toLowerCase();
    let i = low.indexOf(needle);
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (i >= 0) {
      frag.append(text.slice(last, i), h('mark', { class: 'ebk-hit' }, text.slice(i, i + q.length)));
      last = i + q.length;
      i = low.indexOf(needle, last);
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// A generated cover (for books without one): the title and author on a colour from the title.
export function madeCover(title, author, big = true) {
  let hash = 0;
  for (const c of title || '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return h('div', { class: `ebk-madecover ${big ? '' : 'small'}`, style: { '--h': hue } },
    h('div', { class: 'ebk-madecover-title' }, title || 'Untitled'), author ? h('div', { class: 'ebk-madecover-author' }, author) : null);
}

// A drop cap on a chapter's opening paragraph (a real paragraph after its heading, not a title
// page's author line).
function dropCap(node) {
  const head = node.querySelector('h1, h2');
  if (!head || node.querySelector('.drop')) return;
  let p = head.nextElementSibling;
  while (p && p.localName !== 'p') { if (p.textContent.trim()) return; p = p.nextElementSibling; }
  if (p && p.textContent.trim().length > 140 && !p.style.textAlign && /^[A-Za-z“"‘']/.test(p.textContent.trim())) p.classList.add('ebk-drop');
}

// --- EPUB ----------------------------------------------------------------------------------------

const BLOCK = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure', 'figcaption', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const INLINE = new Set(['span', 'a', 'em', 'i', 'strong', 'b', 'u', 's', 'small', 'big', 'sub', 'sup', 'br', 'code', 'cite', 'q', 'abbr', 'mark', 'ruby', 'rt', 'rp', 'img', 'del', 'ins', 'kbd', 'var', 'dfn', 'time', 'bdi', 'bdo', 'wbr']);
const RENAME = { center: 'div', font: 'span', big: 'span', tt: 'code', strike: 's', body: 'div' };
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'title', 'head', 'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'canvas', 'template', 'noscript', 'math']);
const STYLE_KEEP = /^(text-align|font-style|font-weight|text-decoration|text-indent|font-variant)$/;

class EpubBook {
  constructor(src) { this.src = src; this.format = 'epub'; this.hardCovers = true; this.reflows = true; this.urls = []; }

  async load(onProgress) {
    const bytes = await fetchBytes(this.src, (p) => onProgress?.(p * 0.6));
    const JSZip = await jszip();
    const zip = await JSZip.loadAsync(bytes);
    this.zip = zip;
    const text = async (p) => { const f = zip.file(p) || zip.file(safeDecode(p)); return f ? f.async('string') : null; };
    const xml = (s) => new DOMParser().parseFromString(s || '', 'application/xml');
    const container = xml(await text('META-INF/container.xml'));
    const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) throw new Error('This EPUB is missing its contents list');
    const opf = xml(await text(opfPath));
    const meta = (tag) => [...opf.getElementsByTagNameNS('*', tag)].map((n) => n.textContent.trim()).filter(Boolean);
    this.title = meta('title')[0] || this.src.title || 'Untitled';
    this.author = meta('creator').join(', ') || this.src.author || '';
    const manifest = new Map();
    for (const item of opf.getElementsByTagNameNS('*', 'item')) {
      manifest.set(item.getAttribute('id'), { href: resolvePath(opfPath, safeDecode(item.getAttribute('href') || '')), type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' });
    }
    const coverId = [...opf.getElementsByTagNameNS('*', 'meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    const coverItem = [...manifest.values()].find((i) => /cover-image/.test(i.props)) || (coverId && manifest.get(coverId)?.type.startsWith('image/') ? manifest.get(coverId) : null)
      || [...manifest.entries()].find(([id, i]) => i.type.startsWith('image/') && /cover/i.test(`${id} ${i.href}`))?.[1];
    this.coverUrl = coverItem ? await this.blobUrl(coverItem.href) : null;
    const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].filter((r) => r.getAttribute('linear') !== 'no').map((r) => manifest.get(r.getAttribute('idref'))).filter((i) => i && /html|xml/.test(i.type));
    // Chapters: cleaned up, with pictures from inside the book.
    this.chapters = [];
    for (let n = 0; n < spine.length; n++) {
      const item = spine[n];
      const raw = await text(item.href);
      if (raw == null) continue;
      let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
      if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(raw, 'text/html');
      const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
      const node = h('div', { class: 'ebk-chapter' });
      await this.clean(body, node, item.href);
      // A chapter that's only its cover picture (already the book's cover) is skipped.
      const textLen = node.textContent.trim().length;
      const imgs = node.querySelectorAll('img');
      if (n === 0 && !textLen && imgs.length === 1 && this.coverUrl && imgs[0].getAttribute('src') === this.coverUrl) continue;
      if (!textLen && !imgs.length) continue;
      // The chapter's heading, for the running header ("Chapter 3<br>The Storm" → "Chapter 3 · The Storm").
      const hEl = node.querySelector('h1, h2, h3')?.cloneNode(true);
      hEl?.querySelectorAll('br').forEach((br) => br.replaceWith(' · '));
      const heading = hEl?.textContent.trim() || '';
      dropCap(node);
      this.chapters.push({ href: item.href, node, title: heading.replace(/\s+/g, ' ').slice(0, 80) });
      onProgress?.(0.6 + 0.35 * (n / spine.length));
    }
    if (!this.chapters.length) throw new Error('This EPUB has no readable chapters');
    // Contents: EPUB 3's nav, or EPUB 2's NCX.
    this.tocEntries = [];
    const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.props));
    if (navItem) {
      const navDoc = new DOMParser().parseFromString(await text(navItem.href) || '', 'application/xhtml+xml');
      const toc = [...navDoc.getElementsByTagName('nav')].find((n) => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').includes('toc')) || navDoc.getElementsByTagName('nav')[0];
      const walk = (ol, level) => {
        for (const li of ol?.children || []) {
          if (li.localName !== 'li') continue;
          const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
          const href = a?.getAttribute('href');
          if (a) this.tocEntries.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), href: href ? resolvePath(navItem.href, safeDecode(href)) : null, level });
          walk([...li.children].find((c) => c.localName === 'ol'), level + 1);
        }
      };
      walk(toc && [...toc.getElementsByTagName('ol')][0], 0);
    }
    if (!this.tocEntries.length) {
      const ncxItem = [...manifest.values()].find((i) => i.type === 'application/x-dtbncx+xml');
      if (ncxItem) {
        const ncx = xml(await text(ncxItem.href));
        const walk = (parent, level) => {
          for (const np of parent.children) {
            if (np.localName !== 'navPoint') continue;
            const label = np.getElementsByTagNameNS('*', 'text')[0]?.textContent.trim() || '';
            const src = np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
            this.tocEntries.push({ label, href: src ? resolvePath(ncxItem.href, safeDecode(src)) : null, level });
            walk(np, level + 1);
          }
        };
        const map = ncx.getElementsByTagNameNS('*', 'navMap')[0];
        if (map) walk(map, 0);
      }
    }
    if (!this.tocEntries.length) this.tocEntries = this.chapters.filter((c) => c.title).map((c) => ({ label: c.title, href: c.href, level: 0 }));
    onProgress?.(1);
  }

  async blobUrl(path) {
    this.blobs ||= new Map();
    if (this.blobs.has(path)) return this.blobs.get(path);
    const f = this.zip.file(path) || this.zip.file(safeDecode(path));
    if (!f) return null;
    const ext = path.split('.').pop().toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) return null;
    const blob = new Blob([await f.async('uint8array')], { type });
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    this.blobs.set(path, url);
    return url;
  }

  // A picture in the book (an <img> in a chapter at `base`), as a blob: address.
  async imageUrl(node, base) {
    const src = node.getAttribute('src');
    return src ? this.blobUrl(resolvePath(base, safeDecode(src))) : null;
  }

  // Copy the allowed parts of a chapter's XHTML.
  async clean(from, into, base) {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === 3) { into.append(node.nodeValue); continue; }
      if (node.nodeType !== 1) continue;
      let tag = (node.localName || '').toLowerCase();
      if (DROP.has(tag)) continue;
      // Pictures drawn with SVG <image> (a common way to show a full-page picture).
      if (tag === 'svg') {
        const im = node.getElementsByTagNameNS('*', 'image')[0];
        const href = im && (im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
        if (href) { const url = await this.blobUrl(resolvePath(base, safeDecode(href))); if (url) into.append(h('img', { src: url, alt: '', class: 'ebk-fullimg' })); }
        continue;
      }
      tag = RENAME[tag] || tag;
      if (!BLOCK.has(tag) && !INLINE.has(tag)) { await this.clean(node, into, base); continue; }
      const el = document.createElement(tag);
      if (tag === 'img') {
        const url = await this.imageUrl(node, base);
        if (!url) continue;
        el.src = url;
        el.alt = node.getAttribute('alt') || '';
        el.loading = 'eager';
      }
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer'; } else if (href && !/^[a-z]+:/i.test(href)) {
          const [p, frag] = href.split('#');
          el.dataset.href = `${p ? resolvePath(base, safeDecode(p)) : base}${frag ? `#${frag}` : ''}`;
          el.href = '#';
        }
      }
      const id = node.getAttribute('id') || node.getAttribute('name');
      if (id) el.dataset.anchor = `${base}#${id}`;
      for (const a of ['alt', 'title', 'colspan', 'rowspan', 'start', 'lang', 'dir']) { const v = node.getAttribute(a); if (v != null && tag !== 'img') el.setAttribute(a, v.slice(0, 200)); }
      const style = node.getAttribute('style');
      if (style) for (const decl of style.split(';')) { const [k, v] = decl.split(':').map((x) => x?.trim()); if (k && v && STYLE_KEEP.test(k) && !/url\(|expression/i.test(v)) el.style.setProperty(k, v); }
      const cls = node.getAttribute('class') || '';
      if (/\b(center|centered|centre)\b/i.test(cls)) el.style.textAlign = 'center';
      if (/\bitalic\b/i.test(cls)) el.style.fontStyle = 'italic';
      if (tag !== 'img' && tag !== 'br' && tag !== 'hr') await this.clean(node, el, base);
      into.append(el);
    }
  }

  // Lay the chapters out into pages of this size: each chapter flows into columns exactly one
  // page wide, and each column is a page.
  paginate({ width, height, double }, prefs) {
    this.prefs = prefs;
    const padX = Math.round(Math.max(18, width * 0.085));
    const padTop = Math.round(Math.max(22, height * 0.07));
    const padBottom = Math.round(Math.max(26, height * 0.075));
    this.cw = width - padX * 2;
    this.ch = height - padTop - padBottom;
    this.gap = padX * 2;
    this.pad = { x: padX, top: padTop, bottom: padBottom };
    const host = h('div', { class: 'ebk-measure' });
    document.body.append(host);
    this.pages = [{ kind: 'cover' }, { kind: 'blank' }];
    this.chapterStart = [];
    this.anchors = new Map();
    this.chapters.forEach((c, ci) => {
      const flow = this.flowEl(c);
      const vp = h('div', { class: 'ebk-vp', style: { width: `${this.cw}px`, height: `${this.ch}px` } }, flow);
      host.replaceChildren(vp);
      const cols = Math.max(1, Math.ceil((flow.scrollWidth + this.gap - 2) / (this.cw + this.gap)));
      c.cols = cols;
      this.chapterStart[ci] = this.pages.length;
      const left = flow.getBoundingClientRect().left;
      for (const el of flow.querySelectorAll('[data-anchor]')) {
        const r = el.getBoundingClientRect();
        this.anchors.set(el.dataset.anchor, this.pages.length + Math.max(0, Math.min(cols - 1, Math.floor((r.left - left + 2) / (this.cw + this.gap)))));
      }
      this.anchors.set(c.href, this.pages.length);
      for (let col = 0; col < cols; col++) this.pages.push({ kind: 'text', ch: ci, col });
    });
    host.remove();
    // The back cover on a left-hand page, so the book closes.
    if (double && this.pages.length % 2 === 0) this.pages.push({ kind: 'blank' });
    this.pages.push({ kind: 'back' });
    this.count = this.pages.length;
    this.toc = this.tocEntries.map((t) => ({ ...t, page: t.href ? this.pageOfHref(t.href) : null })).filter((t) => t.page != null);
    return this.count;
  }

  flowEl(c) {
    const p = this.prefs || {};
    return h('div', {
      class: `ebk-flow ebk-font-${p.font || 'serif'}`,
      style: { width: `${this.cw}px`, height: `${this.ch}px`, columnWidth: `${this.cw}px`, columnGap: `${this.gap}px`, fontSize: `${p.size || 17}px`, lineHeight: String(p.leading || 1.55), '--ch': `${this.ch}px`, textAlign: p.justify === false ? 'left' : 'justify' },
    }, c.node.cloneNode(true));
  }

  pageOfHref(href) {
    if (this.anchors.has(href)) return this.anchors.get(href);
    const [p] = href.split('#');
    return this.anchors.get(p) ?? null;
  }
  chapterOf(i) { const pg = this.pages[i]; return pg?.kind === 'text' ? pg.ch : null; }

  // Where a page is, in a form that survives a different page size: chapter and how far in.
  anchorOf(i) {
    let k = i;
    while (k < this.count && this.pages[k]?.kind !== 'text') k++;
    const pg = this.pages[k];
    if (!pg) return '';
    return `${pg.ch}:${(pg.col / this.chapters[pg.ch].cols).toFixed(4)}`;
  }
  pageOfAnchor(a) {
    const [ch, f] = String(a || '').split(':').map(Number);
    if (!Number.isFinite(ch) || this.chapterStart[ch] == null) return null;
    return this.chapterStart[ch] + Math.min(this.chapters[ch].cols - 1, Math.round(f * this.chapters[ch].cols));
  }

  renderPage(i, size) {
    const pg = this.pages[i];
    if (!pg) return null;
    if (pg.kind === 'cover') {
      return this.coverUrl ? h('div', { class: 'ebk-cover' }, h('img', { src: this.coverUrl, alt: this.title, draggable: 'false' })) : madeCover(this.title, this.author);
    }
    if (pg.kind === 'blank') return h('div', { class: 'ebk-blankpage' });
    if (pg.kind === 'back') return h('div', { class: 'ebk-backcover' }, h('div', { class: 'ebk-back-title' }, this.title), this.author ? h('div', { class: 'ebk-back-author' }, this.author) : null);
    const c = this.chapters[pg.ch];
    const flow = this.flowEl(c);
    if (this.highlight) markText(flow, this.highlight);
    flow.style.transform = `translateX(${-pg.col * (this.cw + this.gap)}px)`;
    const left = size?.double ? i % 2 === 1 : false;
    return h('div', { class: 'ebk-textpage', style: { padding: `${this.pad.top}px ${this.pad.x}px ${this.pad.bottom}px` } },
      h('div', { class: `ebk-run ${left ? 'left' : ''}` }, left ? this.title : c.title || this.title),
      h('div', { class: 'ebk-vp', style: { width: `${this.cw}px`, height: `${this.ch}px` } }, flow),
      h('div', { class: `ebk-num ${left ? 'left' : ''}` }, String(i)));
  }

  pageLabel(i) { const pg = this.pages[i]; return pg?.kind === 'cover' ? 'Cover' : pg?.kind === 'back' ? 'Back cover' : String(i); }

  async search(q) {
    const out = [];
    if (!q || q.length < 2) return out;
    const needle = q.toLowerCase();
    const host = h('div', { class: 'ebk-measure' });
    document.body.append(host);
    try {
      this.chapters.forEach((c, ci) => {
        if (!c.node.textContent.toLowerCase().includes(needle)) return;
        const flow = this.flowEl(c);
        host.replaceChildren(h('div', { class: 'ebk-vp', style: { width: `${this.cw}px`, height: `${this.ch}px` } }, flow));
        const left = flow.getBoundingClientRect().left;
        const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
        while (walker.nextNode() && out.length < 300) {
          const node = walker.currentNode;
          const low = node.nodeValue.toLowerCase();
          let i = low.indexOf(needle);
          while (i >= 0 && out.length < 300) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + q.length);
            const r = range.getClientRects()[0];
            const col = r ? Math.max(0, Math.min(c.cols - 1, Math.floor((r.left - left + 2) / (this.cw + this.gap)))) : 0;
            const ctx = node.nodeValue;
            out.push({ page: this.chapterStart[ci] + col, snippet: `${i > 40 ? '…' : ''}${ctx.slice(Math.max(0, i - 40), i + q.length + 50).trim()}${i + q.length + 50 < ctx.length ? '…' : ''}`, chapter: c.title });
            i = low.indexOf(needle, i + q.length);
          }
        }
      });
    } finally { host.remove(); }
    return out;
  }

  destroy() { for (const u of this.urls) URL.revokeObjectURL(u); }
}

// --- PDF ---------------------------------------------------------------------------------------

class PdfBook {
  constructor(src) { this.src = src; this.format = 'pdf'; this.hardCovers = true; this.reflows = false; this.zoom = 1; this.queue = []; this.busy = 0; }

  async load(onProgress) {
    const m = await pdfjs();
    const task = m.getDocument({
      ...(this.src.data ? { data: this.src.data } : { url: this.src.url, withCredentials: true }),
      standardFontDataUrl: `${PDF_BASE}standard_fonts/`, wasmUrl: `${PDF_BASE}wasm/`, enableXfa: false,
    });
    task.onProgress = ({ loaded, total }) => { if (total) onProgress?.(Math.min(0.95, loaded / total)); };
    this.task = task;
    this.doc = await task.promise;
    this.count = this.doc.numPages;
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    this.aspect = vp.width / vp.height;
    const info = await this.doc.getMetadata().catch(() => null);
    this.title = info?.info?.Title?.trim() || this.src.title || 'Untitled';
    this.author = info?.info?.Author?.trim() || this.src.author || '';
    this.toc = await this.outline().catch(() => []);
    onProgress?.(1);
  }

  async outline() {
    const items = await this.doc.getOutline();
    const out = [];
    const walk = async (list, level) => {
      for (const it of list || []) {
        let page = null;
        try {
          const dest = typeof it.dest === 'string' ? await this.doc.getDestination(it.dest) : it.dest;
          if (dest?.[0]) page = typeof dest[0] === 'number' ? dest[0] : await this.doc.getPageIndex(dest[0]);
        } catch { /* a link we can't follow */ }
        if (page != null) out.push({ label: it.title, page, level });
        if (out.length < 400) await walk(it.items, level + 1);
      }
    };
    await walk(items, 0);
    return out;
  }

  paginate() { return this.count; }
  pageLabel(i) { return String(i + 1); }
  setZoom(z) { this.zoom = z; }

  renderPage(i, size) {
    const canvas = h('canvas', { class: 'ebk-pdfcanvas' });
    const box = h('div', { class: 'ebk-pdfpage' }, canvas);
    this.enqueue(async () => {
      const page = await this.doc.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = (size.width / vp1.width) * Math.min(3, (window.devicePixelRatio || 1) * this.zoom);
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      box.classList.add('ready');
    });
    return box;
  }

  // Draw at most two pages at once, newest first (the ones in view).
  enqueue(job) {
    this.queue.unshift(job);
    const next = () => {
      if (this.busy >= 2 || !this.queue.length) return;
      const j = this.queue.shift();
      this.busy++;
      j().catch(() => {}).finally(() => { this.busy--; next(); });
    };
    next();
  }

  async thumbBlob(width = 360) {
    const page = await this.doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  }

  async search(q, onProgress) {
    const out = [];
    if (!q || q.length < 2) return out;
    this.texts ||= [];
    const needle = q.toLowerCase();
    for (let i = 0; i < this.count && out.length < 300; i++) {
      if (this.texts[i] == null) {
        const page = await this.doc.getPage(i + 1);
        const tc = await page.getTextContent();
        this.texts[i] = tc.items.map((t) => t.str).join(' ');
      }
      const t = this.texts[i];
      const low = t.toLowerCase();
      let k = low.indexOf(needle);
      while (k >= 0 && out.length < 300) {
        out.push({ page: i, snippet: `${k > 40 ? '…' : ''}${t.slice(Math.max(0, k - 40), k + q.length + 50).trim()}…` });
        k = low.indexOf(needle, k + q.length);
      }
      if (i % 10 === 0) onProgress?.(i / this.count);
    }
    return out;
  }

  destroy() { try { (this.task || this.doc)?.destroy?.(); } catch { /* already closed */ } }
}

// --- Comic books (CBZ) -------------------------------------------------------------------------

class ComicBook {
  constructor(src) { this.src = src; this.format = 'cbz'; this.hardCovers = true; this.reflows = false; this.urls = new Map(); }

  async load(onProgress) {
    const bytes = await fetchBytes(this.src, (p) => onProgress?.(p * 0.8));
    const JSZip = await jszip();
    this.zip = await JSZip.loadAsync(bytes);
    this.files = Object.keys(this.zip.files).filter((n) => !this.zip.files[n].dir && IMAGE_TYPES[n.split('.').pop().toLowerCase()] && !/(^|\/)(__MACOSX|\.)/.test(n)).sort(naturalSort);
    if (!this.files.length) throw new Error('There are no pictures in this comic book');
    this.count = this.files.length;
    this.title = this.src.title || 'Comic';
    this.author = this.src.author || '';
    const first = await this.url(0);
    this.aspect = await new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im.naturalWidth / im.naturalHeight || 0.66); im.onerror = () => resolve(0.66); im.src = first; });
    this.toc = [];
    onProgress?.(1);
  }

  async url(i) {
    if (this.urls.has(i)) return this.urls.get(i);
    const name = this.files[i];
    const blob = new Blob([await this.zip.file(name).async('uint8array')], { type: IMAGE_TYPES[name.split('.').pop().toLowerCase()] });
    const u = URL.createObjectURL(blob);
    this.urls.set(i, u);
    return u;
  }

  paginate() { return this.count; }
  pageLabel(i) { return String(i + 1); }
  renderPage(i) {
    const img = h('img', { class: 'ebk-comicimg', alt: `Page ${i + 1}`, draggable: 'false' });
    this.url(i).then((u) => { img.src = u; });
    return h('div', { class: 'ebk-comicpage' }, img);
  }
  async search() { return []; }
  destroy() { for (const u of this.urls.values()) URL.revokeObjectURL(u); }
}

// --- Other reflowing books: they become chapters of cleaned HTML, laid out like an EPUB -----------

const imageType = (b) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : b[0] === 0x42 && b[1] === 0x4d ? 'image/bmp' : null);
const decodeText = (bytes, enc) => { try { return new TextDecoder(enc || 'utf-8', { fatal: !enc }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); } };

class HtmlBook extends EpubBook {
  // Chapters from HTML strings: [{ html, base }]; cleaned exactly like EPUB chapters.
  async addChapters(parts, onProgress) {
    this.chapters = [];
    for (let n = 0; n < parts.length; n++) {
      const doc = new DOMParser().parseFromString(`<!doctype html><body>${parts[n].html}</body>`, 'text/html');
      const node = h('div', { class: 'ebk-chapter' });
      await this.clean(doc.body, node, parts[n].base);
      if (!node.textContent.trim() && !node.querySelector('img')) continue;
      dropCap(node);
      const hEl = node.querySelector('h1, h2, h3')?.cloneNode(true);
      hEl?.querySelectorAll('br').forEach((br) => br.replaceWith(' · '));
      this.chapters.push({ href: `${parts[n].base}@${n}`, node, title: (hEl?.textContent.trim() || '').replace(/\s+/g, ' ').slice(0, 80) });
      onProgress?.(0.5 + 0.45 * (n / parts.length));
    }
    if (!this.chapters.length) throw new Error('This book has no readable text');
    // Contents: the chapters' headings (a book's own contents page and its links work too).
    this.tocEntries = this.chapters.filter((c) => c.title).map((c) => ({ label: c.title, href: c.href, level: 0 }));
  }
  blobFrom(bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    this.urls.push(url);
    return url;
  }
}

// Kindle MOBI / AZW (and the MOBI copy inside most AZW3 files): a Palm database of compressed
// text records (HTML), with pictures in records of their own.
class MobiBook extends HtmlBook {
  async load(onProgress) {
    const buf = new Uint8Array(await fetchBytes(this.src, (p) => onProgress?.(p * 0.4)));
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const latin = (a, b) => String.fromCharCode(...buf.subarray(a, b));
    if (buf.length < 78 || latin(60, 68) !== 'BOOKMOBI') throw new Error(latin(60, 68) === 'TEXtREAd' ? 'This is a plain Palm document, not a Kindle book' : 'This isn’t a Kindle book');
    const n = dv.getUint16(76);
    const offs = Array.from({ length: n }, (_, i) => dv.getUint32(78 + i * 8));
    const rec = (i) => (i < n ? buf.subarray(offs[i], i + 1 < n ? offs[i + 1] : buf.length) : null);
    const r0 = offs[0];
    const compression = dv.getUint16(r0);
    const textRecords = dv.getUint16(r0 + 8);
    if (dv.getUint16(r0 + 12)) throw new Error('This Kindle book has DRM, so it can only be read in Amazon’s Kindle apps');
    if (compression === 17480) throw new Error('This Kindle book uses a kind of compression MediaDesk can’t read. With Calibre on the server it can be converted.');
    const hlen = dv.getUint32(r0 + 20);
    const encoding = dv.getUint32(r0 + 28) === 65001 ? 'utf-8' : 'windows-1252';
    const firstImage = dv.getUint32(r0 + 108);
    const extraFlags = hlen >= 0xe4 ? dv.getUint16(r0 + 242) : 0;
    // Title, author and cover from EXTH.
    let title = new TextDecoder(encoding).decode(buf.subarray(r0 + dv.getUint32(r0 + 84), r0 + dv.getUint32(r0 + 84) + dv.getUint32(r0 + 88))).trim();
    const authors = [];
    let cover = null;
    if (dv.getUint32(r0 + 128) & 0x40) {
      let p = r0 + 16 + hlen;
      if (latin(p, p + 4) === 'EXTH') {
        const count = dv.getUint32(p + 8);
        p += 12;
        for (let i = 0; i < count && p + 8 <= buf.length; i++) {
          const type = dv.getUint32(p);
          const len = dv.getUint32(p + 4);
          const data = buf.subarray(p + 8, p + len);
          if (type === 100) authors.push(new TextDecoder(encoding).decode(data).trim());
          if (type === 503) title = new TextDecoder(encoding).decode(data).trim() || title;
          if (type === 201 && data.length >= 4) cover = new DataView(data.buffer, data.byteOffset, 4).getUint32(0);
          p += Math.max(8, len);
        }
      }
    }
    this.title = title || this.src.title || 'Untitled';
    this.author = authors.join(', ') || this.src.author || '';
    // The text: each record without its trailing entries, decompressed.
    const trailing = (d) => {
      let size = d.length;
      let num = 0;
      for (let f = extraFlags >> 1; f; f >>= 1) {
        if (!(f & 1)) continue;
        let bit = 0;
        let res = 0;
        let ps = size - num;
        for (;;) { const v = d[ps - 1]; res |= (v & 0x7f) << bit; bit += 7; ps--; if ((v & 0x80) || bit >= 28 || ps === 0) break; }
        num += res;
      }
      if (extraFlags & 1) num += (d[size - num - 1] & 3) + 1;
      return size - num;
    };
    const chunks = [];
    for (let i = 1; i <= textRecords; i++) {
      const d = rec(i);
      if (!d) break;
      const body = d.subarray(0, trailing(d));
      chunks.push(compression === 2 ? palmdoc(body) : body);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    let text = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { text.set(c, o); o += c.length; }
    onProgress?.(0.5);
    // Links point at byte positions in the text: mark those places so they can be found.
    let raw = '';
    for (let i = 0; i < text.length; i += 8192) raw += String.fromCharCode(...text.subarray(i, i + 8192));
    const targets = [...new Set([...raw.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi)].map((m) => Number(m[1])))].filter((x) => x < raw.length).sort((a, b) => b - a);
    for (const t of targets) raw = `${raw.slice(0, t)}<a id="fp${t}"></a>${raw.slice(t)}`;
    raw = raw.replace(/<a([^>]*?)\sfilepos\s*=\s*["']?0*(\d+)["']?/gi, '<a$1 href="#fp$2"');
    text = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    let html = new TextDecoder(encoding).decode(text);
    html = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    // Pictures: <img recindex="00012"> (MOBI) or src="kindle:embed:000C" (KF8).
    this.records = { rec, firstImage };
    if (cover != null && firstImage < 0xffffffff) {
      const c = rec(firstImage + cover);
      const type = c && imageType(c);
      this.coverUrl = type ? this.blobFrom(c, type) : null;
    }
    // Each page break starts a new chapter.
    const parts = html.split(/<mbp:pagebreak\s*\/?>/i).map((x) => ({ html: x, base: 'mobi' }));
    await this.addChapters(parts, onProgress);
    onProgress?.(1);
  }
  async imageUrl(node) {
    const { rec, firstImage } = this.records;
    let idx = node.getAttribute('recindex');
    const src = node.getAttribute('src') || '';
    const kf8 = /kindle:embed:([0-9a-v]+)/i.exec(src);
    if (kf8) idx = parseInt(kf8[1], 32);
    if (idx == null || firstImage >= 0xffffffff) return null;
    const d = rec(firstImage + Number(idx) - 1);
    const type = d && imageType(d);
    return type ? this.blobFrom(d, type) : null;
  }
}

// PalmDOC compression (LZ77 with a few byte codes).
function palmdoc(d) {
  const out = new Uint8Array(d.length * 8 + 16);
  let o = 0;
  for (let i = 0; i < d.length;) {
    const c = d[i++];
    if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < d.length; k++) out[o++] = d[i++]; } else if (c < 0x80) out[o++] = c;
    else if (c >= 0xc0) { out[o++] = 32; out[o++] = c ^ 0x80; } else {
      const c2 = d[i++];
      const v = (c << 8) | c2;
      const dist = (v >> 3) & 0x7ff;
      const len = (v & 7) + 3;
      for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
    }
  }
  return out.subarray(0, o);
}

// FictionBook (FB2): XML. Its sections become chapters; pictures are inside it, base64.
const FB2_TAGS = { p: 'p', emphasis: 'em', strong: 'strong', strikethrough: 's', sub: 'sub', sup: 'sup', code: 'code', subtitle: 'h4', 'text-author': 'p', v: 'p', stanza: 'div', poem: 'blockquote', cite: 'blockquote', epigraph: 'blockquote', table: 'table', tr: 'tr', td: 'td', th: 'th' };
class Fb2Book extends HtmlBook {
  async load(onProgress) {
    const bytes = new Uint8Array(await fetchBytes(this.src, (p) => onProgress?.(p * 0.4)));
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
    const enc = /encoding=["']([^"']+)/i.exec(head)?.[1];
    const xml = new DOMParser().parseFromString(decodeText(bytes, enc), 'application/xml');
    if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'FictionBook') throw new Error('This isn’t a FictionBook (FB2) file');
    const first = (root, name) => root?.getElementsByTagNameNS('*', name)[0] || null;
    const info = first(xml, 'title-info');
    this.title = first(info, 'book-title')?.textContent.trim() || this.src.title || 'Untitled';
    this.author = [...(info?.getElementsByTagNameNS('*', 'author') || [])].map((a) => ['first-name', 'middle-name', 'last-name'].map((t) => first(a, t)?.textContent.trim()).filter(Boolean).join(' ')).filter(Boolean).join(', ') || this.src.author || '';
    this.binaries = new Map([...xml.getElementsByTagNameNS('*', 'binary')].map((b) => [b.getAttribute('id'), b]));
    const href = (el) => (el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '');
    const coverImg = first(first(info, 'coverpage'), 'image');
    if (coverImg) this.coverUrl = this.binary(href(coverImg).replace(/^#/, ''));
    const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const toHtml = (node, depth) => [...node.childNodes].map((c) => {
      if (c.nodeType === 3) return esc(c.nodeValue);
      if (c.nodeType !== 1) return '';
      const tag = c.localName;
      const id = c.getAttribute('id') ? ` id="${esc(c.getAttribute('id'))}"` : '';
      if (tag === 'section') return `<section${id}>${toHtml(c, depth + 1)}</section>`;
      if (tag === 'title') return `<h${Math.min(5, depth + 1)}${id}>${[...c.children].map((x) => toHtml(x, depth)).join('<br>')}</h${Math.min(5, depth + 1)}>`;
      if (tag === 'image') return `<img src="${esc(href(c))}" alt=""${id}>`;
      if (tag === 'a') return `<a href="${esc(href(c))}"${id}>${toHtml(c, depth)}</a>`;
      if (tag === 'empty-line') return '<br>';
      const t = FB2_TAGS[tag];
      return t ? `<${t}${id}${tag === 'text-author' ? ' style="text-align:right;font-style:italic"' : ''}>${toHtml(c, depth)}</${t}>` : toHtml(c, depth);
    }).join('');
    const parts = [];
    const bodies = [...xml.documentElement.children].filter((c) => c.localName === 'body');
    for (const body of bodies) {
      const notes = /notes|comments/i.test(body.getAttribute('name') || '');
      if (notes) { parts.push({ html: `<h2>Notes</h2>${toHtml(body, 1)}`, base: 'fb2' }); continue; }
      // The body's title and epigraph, then each top-level section on its own.
      let lead = '';
      for (const c of body.children) {
        if (c.localName === 'section') { if (lead) { parts.push({ html: lead, base: 'fb2' }); lead = ''; } parts.push({ html: toHtml({ childNodes: [c] }, 0), base: 'fb2' }); } else if (c.localName === 'title') lead += `<h1>${[...c.children].map((x) => toHtml(x, 0)).join('<br>')}</h1>`;
        else lead += toHtml({ childNodes: [c] }, 0);
      }
      if (lead) parts.push({ html: lead, base: 'fb2' });
    }
    await this.addChapters(parts, onProgress);
    onProgress?.(1);
  }
  binary(id) {
    const b = this.binaries.get(id);
    if (!b) return null;
    try {
      const bytes = Uint8Array.from(atob(b.textContent.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      return this.blobFrom(bytes, imageType(bytes) || b.getAttribute('content-type') || 'image/jpeg');
    } catch { return null; }
  }
  async imageUrl(node) { return this.binary((node.getAttribute('src') || '').replace(/^#/, '')); }
}

// Plain text: paragraphs from blank lines, chapters from "Chapter …" headings.
const CHAPTER_LINE = /^\s*((chapter|book|part|section|canto|letter)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+teen|twenty[\w-]*|thirty[\w-]*)\b.{0,60}|prologue|epilogue|introduction|preface|foreword|afterword|appendix.{0,40})\s*$/i;
class TextBook extends HtmlBook {
  async load(onProgress) {
    const bytes = new Uint8Array(await fetchBytes(this.src, (p) => onProgress?.(p * 0.5)));
    let text = decodeText(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    this.title = this.src.title || 'Untitled';
    this.author = this.src.author || '';
    const blank = /\n[ \t]*\n/.test(text);
    const rawParas = (blank ? text.split(/\n[ \t]*\n+/) : text.split('\n'));
    // A short first line on its own is the title ("A GUIDE TO THE NIGHT SKY" / "By …").
    let lead = '';
    if (blank && rawParas[0] && rawParas[0].includes('\n') && rawParas[0].split('\n')[0].trim().length < 80) {
      const [first, ...rest] = rawParas[0].split('\n');
      rawParas[0] = first;
      lead = rest.join(' ').trim();
    }
    const paras = rawParas.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const heads = paras.map((p, i) => (CHAPTER_LINE.test(p) || (blank && /^CHAPTER\b/.test(p)) ? i : -1)).filter((i) => i >= 0);
    const parts = [];
    let cur = '';
    let count = 0;
    const flush = () => { if (cur) parts.push({ html: cur, base: 'txt' }); cur = ''; count = 0; };
    paras.forEach((p, i) => {
      const lines = p.split(/(?<=[^.!?,;:])\s{2,}/);
      if (heads.length >= 2 && heads.includes(i)) {
        flush();
        // "CHAPTER I The Moon": a chapter line, with a short title line after it.
        const m = /^(\s*(?:chapter|book|part|section)\s+\S+)\s+(.{1,80})$/i.exec(p);
        cur += m ? `<h2>${esc(m[1])}<br>${esc(m[2])}</h2>` : `<h2>${esc(p)}</h2>`;
        return;
      }
      if (i === 0 && p.length < 80 && !/[.!?]$/.test(p)) { cur += `<h1>${esc(p)}</h1>${lead ? `<p style="text-align:center"><i>${esc(lead)}</i></p>` : ''}`; return; }
      cur += `<p>${esc(lines.join(' '))}</p>`;
      // Long stretches without chapters still break up, so pages lay out quickly.
      if (++count >= 160 && heads.length < 2) flush();
    });
    flush();
    await this.addChapters(parts, onProgress);
    onProgress?.(1);
  }
}

export function bookFor(src) {
  const view = src.view || src.format;
  if (view === 'pdf') return new PdfBook(src);
  if (view === 'cbz') return new ComicBook(src);
  if (view === 'mobi') return new MobiBook(src);
  if (view === 'fb2') return new Fb2Book(src);
  if (view === 'txt') return new TextBook(src);
  return new EpubBook(src);
}

// Every kind of file the reader takes, and the format it is (as the server sees it).
export const FORMATS = { epub: 'epub', pdf: 'pdf', cbz: 'cbz', cbr: 'cbr', cb7: 'cb7', cbt: 'cbt', mobi: 'mobi', azw: 'mobi', prc: 'mobi', azw3: 'azw3', fb2: 'fb2', txt: 'txt', rtf: 'rtf', docx: 'docx', odt: 'odt', lit: 'lit' };
export const formatOf = (name) => FORMATS[String(name).split('.').pop().toLowerCase()] || null;
// How a format is read: here as it is, or after the server converts it (as), or not without a tool.
export function viewOf(format, tools = {}) {
  if (['epub', 'pdf', 'cbz', 'mobi', 'fb2', 'txt'].includes(format)) return { view: format };
  if (['cbr', 'cb7', 'cbt'].includes(format)) return tools.sevenZip ? { view: 'cbz', as: 'cbz' } : { view: null, need: '7-Zip' };
  if (format === 'azw3') return tools.calibre ? { view: 'epub', as: 'epub' } : { view: 'mobi' };
  if (['rtf', 'docx', 'odt', 'lit'].includes(format)) return tools.calibre ? { view: 'epub', as: 'epub' } : { view: null, need: 'Calibre' };
  return { view: null };
}
export const ACCEPT = Object.keys(FORMATS).map((x) => `.${x}`).join(',');
