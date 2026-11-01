// eBook Reader: a bookshelf of the EPUB books, PDFs and comic books in the Books folder (and any
// opened from Files or this computer), read as a flipbook in the style of AnyFlip: the book lies
// open on the screen and its pages turn like paper. There are thumbnails of every page, the
// contents, search, bookmarks, zoom, auto-flip, the page-turn sound, one or two pages at a time,
// full screen, and for EPUB books the text size, typeface and page colour. Where each book is up
// to is kept on the MediaDesk server, so it opens at the same page on any device.

import { h, clear, toast, toastError } from '../../ui.js';
import { appIcon } from '../../icons.js';
import { openApp } from '../../wm.js';
import { pickFile, fileUrl, filesEnabled } from '../../fileapi.js';
import { Flipbook } from './flipbook.js';
import { bookFor, formatOf, madeCover, markText } from './sources.js';

let cssAdded = false;
function addCss() {
  if (cssAdded) return;
  cssAdded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../../css/ebooks.css', import.meta.url).href }));
}

const svg = (d, fill = false) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  toc: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  thumbs: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  bookmark: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  bookmarkOn: svg('<path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  single: svg('<rect x="7" y="3" width="10" height="18" rx="1.5"/>'),
  double: svg('<path d="M12 5c-2.5-1.5-6-2-9-1v15c3-1 6.5-.5 9 1 2.5-1.5 6-2 9-1V4c-3-1-6.5-.5-9 1zM12 5v15"/>'),
  text: svg('<path d="M4 19 9 5l5 14M6 14h6M15 19l3.5-9 3.5 9M16.2 16h4.6"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  library: svg('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.9 15-3.8-1z"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.9-3.9L4 9M4 4v5h5M4 13a8 8 0 0 0 14.9 3.9L20 15M20 20v-5h-5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.2 1.2z"/>'),
};

const PREFS_KEY = 'mediadesk.ebooks';
const DEFAULT_PREFS = { font: 'serif', size: 17, leading: 1.55, paper: 'white', backdrop: 'dark', sound: true, mode: 'auto', autoSeconds: 6, justify: true };
const loadPrefs = () => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ } };

const api = async (path, opts = {}) => {
  const res = await fetch(`/portal/ebooks/${path}`, { credentials: 'same-origin', ...opts, headers: { 'X-MediaDesk': '1', ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
};
const FORMAT_LABEL = { epub: 'EPUB', pdf: 'PDF', cbz: 'Comic' };
const isBookName = (name) => Boolean(formatOf(name));

export const ebooksApp = {
  id: 'ebooks', name: 'eBook Reader', icon: appIcon.ebooks, size: [1220, 820], description: 'Read EPUB books, PDFs and comics as a flipbook',
  open(win, opts = {}) { addCss(); new EbookReader(win, opts); },
};

class EbookReader {
  constructor(win, opts) {
    this.win = win;
    this.prefs = loadPrefs();
    this.root = h('div', { class: 'ebk' });
    clear(win.body, this.root);
    win.body.classList.add('ebk-window');
    this.filter = 'all';
    this.sort = 'title';
    this.q = '';
    win.on('close', () => this.closeBook());
    win.on('reopen', (o) => { if (o && (o.id || o.path)) this.openFrom(o); });
    if (opts.id || opts.path) this.openFrom(opts); else this.showLibrary();
  }

  // --- Library ------------------------------------------------------------------------------

  async showLibrary() {
    this.closeBook();
    this.win.setTitle('eBook Reader');
    const head = h('div', { class: 'ebk-libhead' });
    const body = h('div', { class: 'ebk-libbody' }, h('div', { class: 'ebk-loading-inline' }, h('div', { class: 'spinner' }), 'Opening the library…'));
    clear(this.root, h('div', { class: 'ebk-lib' }, head, body));
    let lib;
    try { lib = await api('library'); } catch (err) { clear(body, this.empty('😕', `The library couldn’t be opened: ${err.message}`)); return; }
    this.lib = lib;
    const search = h('input', { class: 'input ebk-search', type: 'search', placeholder: 'Search titles and authors', value: this.q });
    const seg = h('div', { class: 'ebk-seg' }, [['all', 'All'], ['epub', 'Books'], ['pdf', 'PDFs'], ['cbz', 'Comics']].map(([id, label]) => h('button', { class: this.filter === id ? 'on' : '', onclick: () => { this.filter = id; drawShelf(); for (const b of seg.children) b.classList.toggle('on', b.textContent === label); } }, label)));
    const sort = h('select', { class: 'input ebk-sort', onchange: (e) => { this.sort = e.target.value; drawShelf(); } },
      [['title', 'Title'], ['author', 'Author'], ['recent', 'Recently read'], ['added', 'Recently added']].map(([v, l]) => h('option', { value: v, selected: this.sort === v }, l)));
    const openBtn = h('button', { class: 'btn', onclick: (e) => this.openMenu(e.currentTarget) }, h('span', { html: I.open }), 'Open a book');
    clear(head, h('div', { class: 'ebk-libtitle' }, h('span', { class: 'ebk-libicon', html: appIcon.ebooks }), h('h2', {}, 'Library'), h('span', { class: 'muted small' }, lib.configured ? `${lib.books.length} book${lib.books.length === 1 ? '' : 's'}` : '')),
      h('div', { class: 'ebk-libtools' }, search, seg, sort, openBtn,
        h('button', { class: 'btn btn-icon', title: 'Look for new books', 'aria-label': 'Refresh', html: I.refresh, onclick: async () => { await api('library?refresh=1').catch(() => {}); this.showLibrary(); } }),
        h('button', { class: 'btn btn-icon', title: 'Books folder (Settings)', 'aria-label': 'Settings', html: I.settings, onclick: () => openApp('settings', { tab: 'ebooks' }) })));
    const reading = lib.reading || {};
    const shelf = h('div', { class: 'ebk-shelf' });
    const cont = h('div', {});
    const drawShelf = () => {
      const q = this.q.toLowerCase();
      let books = lib.books.filter((b) => (this.filter === 'all' || b.format === this.filter) && (!q || `${b.title} ${b.author} ${b.path}`.toLowerCase().includes(q)));
      const at = (b) => reading[b.id]?.at || 0;
      books = books.sort({
        title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
        author: (a, b) => (a.author || '~').localeCompare(b.author || '~') || a.title.localeCompare(b.title),
        recent: (a, b) => at(b) - at(a) || a.title.localeCompare(b.title),
        added: (a, b) => b.modified - a.modified,
      }[this.sort]);
      clear(shelf, books.length ? books.map((b) => this.bookCard(b, reading[b.id])) : h('div', { class: 'ebk-shelf-empty' }, lib.books.length ? 'No books match.' : ''));
    };
    search.addEventListener('input', () => { this.q = search.value; drawShelf(); });
    // Continue reading: books started and not finished, newest first (library and Files).
    const started = Object.entries(reading).filter(([, s]) => s.progress > 0 && s.progress < 0.985 && !s.finished).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 8)
      .map(([key, s]) => ({ key, s, book: lib.books.find((x) => x.id === key) })).filter((x) => x.book || (x.key.startsWith('f:') && filesEnabled()));
    if (started.length) {
      clear(cont, h('div', { class: 'ebk-cont' }, h('h3', {}, 'Continue reading'),
        h('div', { class: 'ebk-cont-row' }, started.map(({ key, s, book }) => h('button', { class: 'ebk-cont-item', onclick: () => (book ? this.openFrom({ id: book.id }) : this.openFrom(fromKey(key))) },
          h('div', { class: 'ebk-cont-cover' }, book ? this.coverEl(book) : madeCover(s.title, s.author, false)),
          h('div', { class: 'ebk-cont-info' }, h('b', {}, book?.title || s.title || 'Book'), h('span', { class: 'muted small' }, book?.author || s.author || ''),
            h('div', { class: 'ebk-progress' }, h('i', { style: { width: `${Math.round(s.progress * 100)}%` } })),
            h('span', { class: 'muted small' }, `${Math.round(s.progress * 100)}% · ${ago(s.at)}`)))))));
    }
    if (!lib.configured) {
      clear(body, cont, this.empty('📚', 'Choose the folder with your books in Settings → eBook Reader. EPUB books, PDFs and comic books (.cbz) in it show up here.',
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: () => openApp('settings', { tab: 'ebooks' }) }, 'Choose a books folder'), openBtn.cloneNode(true))));
      body.querySelector('.btn-row .btn:last-child')?.addEventListener('click', (e) => this.openMenu(e.currentTarget));
      return;
    }
    clear(body, lib.mock ? h('div', { class: 'notice ebk-notice' }, 'Demo mode: these are small books MediaDesk makes itself.') : null, lib.error ? h('div', { class: 'notice' }, lib.error) : null, cont,
      lib.books.length ? h('h3', { class: 'ebk-shelf-title' }, 'Bookshelf') : this.empty('📚', 'There are no EPUB books, PDFs or comic books in the books folder yet.'), shelf);
    drawShelf();
    this.makePdfCovers(lib.books.filter((b) => b.format === 'pdf' && !b.cover));
  }

  empty(emoji, text, extra = null) { return h('div', { class: 'ebk-empty' }, h('div', { class: 'ebk-empty-emoji' }, emoji), h('p', {}, text), extra); }

  coverEl(b) {
    if (b.cover) return h('img', { class: 'ebk-coverimg', src: `/portal/ebooks/cover/${b.id}?v=${Math.floor(b.modified)}`, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.replaceWith(madeCover(b.title, b.author, false)) });
    return madeCover(b.title, b.author, false);
  }

  bookCard(b, s) {
    const pct = s?.progress ? Math.round(s.progress * 100) : 0;
    return h('button', { class: 'ebk-book', title: `${b.title}${b.author ? ` — ${b.author}` : ''}`, onclick: () => this.openFrom({ id: b.id }) },
      h('div', { class: 'ebk-book-cover', dataset: { id: b.id } }, this.coverEl(b),
        h('span', { class: `ebk-badge ${b.format}` }, FORMAT_LABEL[b.format]),
        pct ? h('div', { class: 'ebk-book-progress' }, h('i', { style: { width: `${pct}%` } })) : null,
        s?.finished || pct >= 99 ? h('span', { class: 'ebk-done' }, '✓') : null),
      h('div', { class: 'ebk-book-label' }, h('b', {}, b.title), b.author ? h('span', {}, b.author) : null));
  }

  // PDFs have no cover inside them: draw the first page once and keep it on the server.
  async makePdfCovers(list) {
    for (const b of list.slice(0, 12)) {
      if (!this.root.querySelector('.ebk-lib')) return;
      try {
        const book = bookFor({ url: `/portal/ebooks/file/${b.id}`, format: 'pdf' });
        await book.load();
        const blob = await book.thumbBlob(360);
        try { book.destroy(); } catch { /* fine */ }
        if (!blob) continue;
        await api(`cover/${b.id}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
        const slot = this.root.querySelector(`.ebk-book-cover[data-id="${b.id}"] .ebk-madecover`);
        slot?.replaceWith(h('img', { class: 'ebk-coverimg', src: URL.createObjectURL(blob), alt: '' }));
        b.cover = true;
      } catch { /* leave the made-up cover */ }
    }
  }

  openMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    document.querySelector('.ebk-menu')?.remove();
    const close = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (!menu.contains(e.target)) close(); };
    const menu = h('div', { class: 'ebk-menu', style: { left: `${Math.min(r.left, innerWidth - 250)}px`, top: `${r.bottom + 6}px` } },
      filesEnabled() ? h('button', { onclick: async () => {
        close();
        const f = await pickFile({ title: 'Open a book', accept: (e) => isBookName(e.name) });
        if (f) this.openFrom({ root: f.root, path: f.path, name: f.name });
      } }, h('span', { html: I.open }), 'From Files…') : null,
      h('button', { onclick: () => {
        close();
        const input = h('input', { type: 'file', accept: '.epub,.pdf,.cbz', onchange: () => { const file = input.files[0]; if (file) this.openFrom({ file }); } });
        input.click();
      } }, h('span', { html: I.download }), 'From this computer…'));
    document.body.append(menu);
    setTimeout(() => document.addEventListener('pointerdown', away, true));
  }

  // --- Opening a book -------------------------------------------------------------------------

  async openFrom(o) {
    let src;
    if (o.id) {
      const lib = this.lib || await api('library').catch(() => null);
      this.lib = lib;
      const b = lib?.books.find((x) => x.id === o.id);
      if (!b) { toast('That book isn’t in the library any more', { type: 'error' }); this.showLibrary(); return; }
      src = { key: b.id, url: `/portal/ebooks/file/${b.id}`, download: `/portal/ebooks/file/${b.id}`, format: b.format, title: b.title, author: b.author, name: b.path.split('/').pop() };
    } else if (o.file) {
      const format = formatOf(o.file.name);
      if (!format) { toast('Open an EPUB, PDF or CBZ file', { type: 'error' }); return; }
      src = { key: `l:${o.file.name}:${o.file.size}`, data: await o.file.arrayBuffer(), format, title: o.file.name.replace(/\.[^.]+$/, ''), name: o.file.name };
    } else {
      const name = o.name || o.path.split('/').pop();
      const format = formatOf(name);
      if (!format) { toast('Open an EPUB, PDF or CBZ file', { type: 'error' }); return; }
      src = { key: `f:${o.root}:${o.path}`, url: fileUrl(o.root, o.path, true), download: fileUrl(o.root, o.path), format, title: name.replace(/\.[^.]+$/, ''), name };
    }
    this.read(src);
  }

  async read(src) {
    this.closeBook();
    this.src = src;
    this.win.setTitle(src.title);
    const bar = h('div', { class: 'ebk-loadbar' }, h('i'));
    const loading = h('div', { class: 'ebk-loading' }, h('div', { class: 'ebk-loading-book', html: appIcon.ebooks }), h('div', {}, `Opening ${src.title}…`), bar);
    this.reader = h('div', { class: `ebk-reader backdrop-${this.prefs.backdrop} paper-${this.prefs.paper}` }, loading);
    clear(this.root, this.reader);
    const book = bookFor(src);
    this.book = book;
    let state = null;
    try {
      const [, s] = await Promise.all([book.load((p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; }), api('state').catch(() => null)]);
      state = s?.books?.[src.key] || null;
    } catch (err) {
      if (this.book !== book) return;
      clear(this.reader, this.empty('😕', `This book couldn’t be opened: ${err.message}`, h('button', { class: 'btn', onclick: () => this.showLibrary() }, 'Back to the library')));
      return;
    }
    if (this.book !== book) return;
    this.state = state || { bookmarks: [] };
    this.state.bookmarks ||= [];
    this.buildReader();
  }

  buildReader() {
    const book = this.book;
    const src = this.src;
    this.win.setTitle(`${book.title}${book.author ? ` — ${book.author}` : ''}`);
    // Top: back to the library, the title, where you are.
    this.whereEl = h('span', { class: 'ebk-where' });
    const top = h('div', { class: 'ebk-top' },
      h('button', { class: 'ebk-tbtn', title: 'Library', 'aria-label': 'Back to the library', html: I.library, onclick: () => this.showLibrary() }),
      h('div', { class: 'ebk-top-title' }, h('b', {}, book.title), book.author ? h('span', {}, book.author) : null),
      this.whereEl);
    // Links in a book are followed by the reader (tap), never by the browser.
    this.stage = h('div', { class: 'ebk-stage', onclick: (e) => { if (e.target.closest('a')) e.preventDefault(); } });
    const arrowL = h('button', { class: 'ebk-arrow left', 'aria-label': 'Previous page', html: I.back, onclick: () => this.fb?.prev() });
    const arrowR = h('button', { class: 'ebk-arrow right', 'aria-label': 'Next page', html: I.next, onclick: () => this.fb?.next() });
    this.arrows = [arrowL, arrowR];
    // Bottom: the page slider and the tools.
    this.slider = h('input', { type: 'range', class: 'ebk-slider', min: 0, max: 1, value: 0, 'aria-label': 'Page' });
    this.sliderTip = h('div', { class: 'ebk-slider-tip', hidden: true });
    this.slider.addEventListener('input', () => { this.sliderTip.hidden = false; this.sliderTip.textContent = this.pageText(Number(this.slider.value)); this.sliderTip.style.left = `${(this.slider.value / Math.max(1, this.slider.max)) * 100}%`; });
    this.slider.addEventListener('change', () => { this.sliderTip.hidden = true; this.fb?.go(Number(this.slider.value)); });
    const tool = (icon, label, fn, cls = '') => h('button', { class: `ebk-tbtn ${cls}`, title: label, 'aria-label': label, html: icon, onclick: fn });
    this.bmBtn = tool(I.bookmark, 'Bookmark this page', () => this.toggleBookmark(), 'ebk-bm');
    this.playBtn = tool(I.play, 'Turn pages automatically', () => this.toggleAuto());
    this.soundBtn = tool(this.prefs.sound ? I.sound : I.mute, 'Page-turn sound', () => { this.prefs.sound = !this.prefs.sound; savePrefs(this.prefs); this.fb.o.sound = this.prefs.sound; this.soundBtn.innerHTML = this.prefs.sound ? I.sound : I.mute; });
    this.modeBtn = tool(I.double, 'One page or two', () => this.cycleMode());
    const tools = h('div', { class: 'ebk-tools' },
      tool(I.toc, 'Contents', () => this.panel('toc')),
      tool(I.thumbs, 'Thumbnails', () => this.thumbs()),
      tool(I.search, 'Search', () => this.panel('search')),
      this.bmBtn,
      tool(svg('<path d="M6 3h12v18l-6-4-6 4z"/><path d="M9 8h6M9 12h4"/>'), 'Bookmarks', () => this.panel('bookmarks')),
      h('span', { class: 'ebk-tsep' }),
      tool(I.zoomOut, 'Zoom out', () => this.fb.setZoom(this.fb.zoom / 1.4)),
      tool(I.zoomIn, 'Zoom in', () => this.fb.setZoom(this.fb.zoom * 1.4)),
      h('span', { class: 'ebk-tsep' }),
      this.playBtn, this.soundBtn, this.modeBtn,
      book.reflows ? tool(I.text, 'Text and page', (e) => this.textSettings(e.currentTarget)) : tool(I.settings, 'Background', (e) => this.textSettings(e.currentTarget)),
      tool(I.full, 'Full screen', () => this.fullscreen()),
      src.download ? h('a', { class: 'ebk-tbtn', title: 'Download', 'aria-label': 'Download', href: src.download, download: src.name || '', html: I.download }) : null);
    const bottom = h('div', { class: 'ebk-bottom' }, h('div', { class: 'ebk-slider-wrap' }, this.slider, this.sliderTip), tools);
    this.side = h('div', { class: 'ebk-side', hidden: true });
    this.strip = h('div', { class: 'ebk-strip', hidden: true });
    clear(this.reader, top, h('div', { class: 'ebk-mid' }, this.side, h('div', { class: 'ebk-stagewrap' }, this.stage, arrowL, arrowR), ), this.strip, bottom);
    this.reader.className = `ebk-reader backdrop-${this.prefs.backdrop} paper-${this.prefs.paper}`;

    // The flipbook. EPUB pages are laid out for the page size it settles on.
    let pending = null;
    const startPage = () => {
      const s = this.state;
      if (book.reflows && s.anchor) { const p = book.pageOfAnchor(s.anchor); if (p != null) return p; }
      return Math.min(s.page || 0, (book.count || 1) - 1);
    };
    const onResize = (size) => {
      this.size = size;
      if (!book.reflows) return;
      if (!this.fb) { pending = size; return; }
      const anchor = this.laidOut ? book.anchorOf(this.fb.page) : null;
      const count = book.paginate(size, this.prefs);
      const page = anchor ? book.pageOfAnchor(anchor) ?? 0 : startPage();
      this.laidOut = true;
      this.fb.reset(count, page);
      this.afterLayout();
    };
    this.fb = new Flipbook(this.stage, {
      count: book.reflows ? 1 : book.count,
      aspect: book.reflows ? 0.68 : book.aspect,
      mode: this.prefs.mode,
      sound: this.prefs.sound,
      hardCovers: book.hardCovers && (book.reflows || book.count > 2),
      renderPage: (i, size) => (book.reflows && !this.laidOut ? null : book.renderPage(i, size)),
      onResize,
      onChange: (page) => this.changed(page),
      onZoom: (z) => { this.reader.classList.toggle('zoomed', z > 1); if (book.setZoom) { book.setZoom(z); clearTimeout(this.zoomT); this.zoomT = setTimeout(() => this.fb.refreshPages(), 250); } },
      onTap: (page, e) => this.tap(e),
    });
    if (book.reflows) onResize(pending || this.size);
    else { this.fb.reset(book.count, startPage()); this.afterLayout(); }
    this.keys = (e) => this.key(e);
    window.addEventListener('keydown', this.keys);
    this.reader.tabIndex = -1;
    this.reader.focus({ preventScroll: true });
  }

  afterLayout() {
    this.slider.max = String(Math.max(0, this.book.count - 1));
    this.updateMode();
    this.changed(this.fb.page);
    if (this.sideKind) this.panel(this.sideKind, true);
  }

  pageText(i) {
    const fb = this.fb;
    const book = this.book;
    const total = book.count;
    if (!fb?.isDouble) return `${book.pageLabel(i)} / ${total}`;
    const [l, r] = fb.pagesAt(fb.spreadOf(i));
    const labels = [l, r].filter((x) => x != null).map((x) => book.pageLabel(x));
    return `${labels.join('–')} / ${total}`;
  }

  changed(page) {
    if (!this.book || !this.fb) return;
    this.whereEl.textContent = this.pageText(page);
    this.slider.value = String(page);
    const [l, r] = this.fb.pagesAt(this.fb.spread);
    this.arrows[0].disabled = !this.fb.canGo(-1);
    this.arrows[1].disabled = !this.fb.canGo(1);
    const marked = this.state.bookmarks.some((b) => b.page === page || b.page === l || b.page === r);
    this.bmBtn.innerHTML = marked ? I.bookmarkOn : I.bookmark;
    this.bmBtn.classList.toggle('on', marked);
    this.strip.querySelectorAll('.ebk-thumb').forEach((t) => t.classList.toggle('on', [l, r].includes(Number(t.dataset.page))));
    if (!this.laidOut && this.book.reflows) return;
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.saveState(), 800);
  }

  saveState(extra = {}) {
    if (!this.src || !this.book || !this.fb) return;
    const book = this.book;
    const page = this.fb.page;
    const last = Math.max(1, book.count - 1);
    const body = { key: this.src.key, page, pages: book.count, progress: Math.min(1, page / last), title: book.title, author: book.author, format: book.format, ...(book.reflows ? { anchor: book.anchorOf(page) } : {}), finished: page >= last - 1, bookmarks: this.state.bookmarks, ...extra };
    Object.assign(this.state, body);
    api('state', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
  }

  // A tap on a page: links inside EPUB books.
  tap(e) {
    const a = e.target.closest?.('a[data-href], a[href^="http"]');
    if (a?.dataset.href === undefined && a) { window.open(a.href, '_blank', 'noopener'); return; }
    if (a && this.book.reflows) {
      e.preventDefault();
      const p = this.book.pageOfHref(a.dataset.href);
      if (p != null) this.fb.go(p);
    }
  }

  key(e) {
    if (!this.fb || !this.reader?.isConnected) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); this.fb.next(); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); this.fb.prev(); } else if (e.key === 'Home') this.fb.go(0);
    else if (e.key === 'End') this.fb.go(this.book.count - 1);
    else if (e.key === '+' || e.key === '=') this.fb.setZoom(this.fb.zoom * 1.4);
    else if (e.key === '-') this.fb.setZoom(this.fb.zoom / 1.4);
    else if (e.key === 'Escape') {
      if (this.fb.zoom > 1) this.fb.setZoom(1);
      else if (!this.side.hidden || !this.strip.hidden) { this.closePanel(); this.strip.hidden = true; } else return;
      e.preventDefault();
    }
  }

  // --- Tools ---------------------------------------------------------------------------------

  cycleMode() {
    const order = ['auto', 'double', 'single'];
    this.prefs.mode = order[(order.indexOf(this.prefs.mode) + 1) % order.length];
    savePrefs(this.prefs);
    this.fb.setMode(this.prefs.mode);
    toast(this.prefs.mode === 'auto' ? 'One or two pages, to fit the window' : this.prefs.mode === 'double' ? 'Two pages side by side' : 'One page at a time', { timeout: 1800 });
    this.updateMode();
  }
  updateMode() {
    this.modeBtn.innerHTML = this.fb.isDouble ? I.double : I.single;
    this.modeBtn.title = `${this.prefs.mode === 'auto' ? 'Automatic' : this.prefs.mode === 'double' ? 'Two pages' : 'One page'} — change`;
  }

  toggleAuto() {
    if (this.auto) { clearInterval(this.auto); this.auto = null; this.playBtn.innerHTML = I.play; this.playBtn.classList.remove('on'); return; }
    this.playBtn.innerHTML = I.pause;
    this.playBtn.classList.add('on');
    this.auto = setInterval(() => { if (this.fb?.canGo(1)) this.fb.next(); else this.toggleAuto(); }, (this.prefs.autoSeconds || 6) * 1000);
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.reader.requestFullscreen?.().catch(() => toast('Full screen isn’t available here', { timeout: 2500 }));
  }

  toggleBookmark() {
    const fb = this.fb;
    const [l, r] = fb.pagesAt(fb.spread);
    const here = this.state.bookmarks.filter((b) => b.page === l || b.page === r || b.page === fb.page);
    if (here.length) {
      this.state.bookmarks = this.state.bookmarks.filter((b) => !here.includes(b));
      toast('Bookmark removed', { timeout: 1500 });
    } else {
      const page = r ?? l ?? fb.page;
      const ch = this.book.chapterOf?.(page);
      const label = ch != null ? `${this.book.chapters[ch].title || 'Chapter'} · page ${this.book.pageLabel(page)}` : `Page ${this.book.pageLabel(page)}`;
      this.state.bookmarks.push({ page, anchor: this.book.reflows ? this.book.anchorOf(page) : undefined, label, at: Date.now() });
      toast('Page bookmarked', { type: 'success', timeout: 1500 });
    }
    this.changed(fb.page);
    this.saveState();
    if (this.sideKind === 'bookmarks') this.panel('bookmarks', true);
  }

  // A side panel: contents, bookmarks or search.
  panel(kind, keep = false) {
    if (!keep && this.sideKind === kind && !this.side.hidden) { this.closePanel(); return; }
    this.sideKind = kind;
    this.side.hidden = false;
    this.reader.classList.add('side-open');
    const book = this.book;
    const title = { toc: 'Contents', bookmarks: 'Bookmarks', search: 'Search' }[kind];
    const body = h('div', { class: 'ebk-side-body' });
    clear(this.side, h('div', { class: 'ebk-side-head' }, h('b', {}, title), h('button', { class: 'ebk-tbtn', 'aria-label': 'Close', html: I.close, onclick: () => this.closePanel() })), body);
    const go = (p) => { this.fb.go(p); if (innerWidth < 760) this.closePanel(); };
    if (kind === 'toc') {
      const list = book.toc?.length ? book.toc : [];
      clear(body, list.length ? list.map((t) => h('button', { class: 'ebk-tocitem', style: { paddingLeft: `${12 + (t.level || 0) * 16}px` }, onclick: () => go(t.page) }, h('span', {}, t.label), h('i', {}, book.pageLabel(t.page))))
        : h('p', { class: 'muted small ebk-side-empty' }, 'This book has no contents list. Thumbnails show every page.'));
    } else if (kind === 'bookmarks') {
      const marks = [...this.state.bookmarks].map((b) => ({ ...b, page: book.reflows && b.anchor ? book.pageOfAnchor(b.anchor) ?? b.page : b.page })).sort((a, b) => a.page - b.page);
      clear(body, marks.length ? marks.map((b) => h('div', { class: 'ebk-bmitem' },
        h('button', { class: 'ebk-tocitem', onclick: () => go(b.page) }, h('span', {}, b.label || `Page ${book.pageLabel(b.page)}`), h('i', {}, book.pageLabel(b.page))),
        h('button', { class: 'ebk-tbtn small', 'aria-label': 'Remove bookmark', html: I.close, onclick: () => { this.state.bookmarks = this.state.bookmarks.filter((x) => x.at !== b.at); this.saveState(); this.changed(this.fb.page); this.panel('bookmarks', true); } })))
        : h('p', { class: 'muted small ebk-side-empty' }, 'No bookmarks yet. The bookmark button marks the page you’re on.'));
    } else {
      const input = h('input', { class: 'input', type: 'search', placeholder: book.format === 'cbz' ? 'Comics can’t be searched' : 'Search this book', value: this.searchQ || '', disabled: book.format === 'cbz' });
      const results = h('div', { class: 'ebk-results' });
      const run = async () => {
        const q = input.value.trim();
        this.searchQ = q;
        if (q.length < 2) { clear(results); if (book.highlight) { book.highlight = ''; this.fb.refreshPages(); } return; }
        clear(results, h('p', { class: 'muted small ebk-side-empty' }, 'Searching…'));
        const hits = await book.search(q, (p) => { results.firstChild && (results.firstChild.textContent = `Searching… ${Math.round(p * 100)}%`); });
        if (this.searchQ !== q) return;
        if (book.reflows) { book.highlight = q; this.fb.refreshPages(); }
        clear(results, h('p', { class: 'muted small ebk-side-empty' }, hits.length ? `${hits.length}${hits.length >= 300 ? '+' : ''} found` : 'Not found'),
          hits.map((r) => { const snip = h('span', {}, r.snippet); markText(snip, q); return h('button', { class: 'ebk-hit-item', onclick: () => go(r.page) }, h('i', {}, `${r.chapter ? `${r.chapter} · ` : ''}${book.pageLabel(r.page)}`), snip); }));
      };
      let t = null;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); run(); } });
      clear(body, input, results);
      if (this.searchQ) run();
      setTimeout(() => input.focus(), 50);
    }
  }
  closePanel() {
    this.side.hidden = true;
    this.sideKind = null;
    this.reader.classList.remove('side-open');
    if (this.book?.highlight) { this.book.highlight = ''; this.fb.refreshPages(); }
  }

  // Thumbnails of every page, along the bottom; the pages draw as they come into view.
  thumbs() {
    if (!this.strip.hidden) { this.strip.hidden = true; return; }
    const book = this.book;
    const fb = this.fb;
    const tw = 84;
    const th = Math.round(tw / (fb.W / fb.H));
    this.strip.hidden = false;
    this.strip.style.setProperty('--th', `${th}px`);
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        io.unobserve(el);
        const i = Number(el.dataset.page);
        const inner = book.renderPage(i, { width: fb.W, height: fb.H, double: false });
        if (!inner) continue;
        const box = h('div', { class: 'ebk-thumb-page', style: { width: `${fb.W}px`, height: `${fb.H}px`, transform: `scale(${tw / fb.W})` } }, inner);
        el.querySelector('.ebk-thumb-img').append(box);
      }
    }, { root: this.strip, rootMargin: '0px 300px' });
    const items = [];
    for (let i = 0; i < book.count; i++) {
      const el = h('button', { class: 'ebk-thumb', dataset: { page: i }, onclick: () => fb.go(i) },
        h('div', { class: 'ebk-thumb-img', style: { width: `${tw}px`, height: `${th}px` } }), h('span', {}, book.pageLabel(i)));
      items.push(el);
      io.observe(el);
    }
    clear(this.strip, h('div', { class: 'ebk-strip-row' }, items));
    this.changed(fb.page);
    this.strip.querySelector('.ebk-thumb.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // Text size, typeface, line spacing and page colour (EPUB); the background behind the book.
  textSettings(anchor) {
    document.querySelector('.ebk-pop')?.remove();
    const p = this.prefs;
    const book = this.book;
    const apply = (patch, relayout = true) => {
      Object.assign(p, patch);
      savePrefs(p);
      this.reader.className = `ebk-reader backdrop-${p.backdrop} paper-${p.paper}${this.reader.classList.contains('side-open') ? ' side-open' : ''}`;
      if (relayout && book.reflows && this.size) {
        const anchorPos = book.anchorOf(this.fb.page);
        const count = book.paginate(this.size, p);
        this.fb.reset(count, book.pageOfAnchor(anchorPos) ?? 0);
        this.afterLayout();
      }
      draw();
    };
    const seg = (items, cur, fn) => h('div', { class: 'ebk-seg small' }, items.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', onclick: () => fn(v) }, l)));
    const pop = h('div', { class: 'ebk-pop' });
    const draw = () => clear(pop,
      book.reflows ? [
        h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Text size'), h('div', { class: 'ebk-size' },
          h('button', { onclick: () => apply({ size: Math.max(12, p.size - 1) }) }, 'A−'), h('b', {}, `${p.size}`), h('button', { onclick: () => apply({ size: Math.min(32, p.size + 1) }) }, 'A+'))),
        h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Typeface'), seg([['serif', 'Serif'], ['sans', 'Sans'], ['readable', 'Readable']], p.font, (v) => apply({ font: v }))),
        h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Spacing'), seg([[1.35, 'Tight'], [1.55, 'Normal'], [1.8, 'Loose']], p.leading, (v) => apply({ leading: v }))),
        h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Page'), seg([['white', 'White'], ['sepia', 'Sepia'], ['night', 'Night']], p.paper, (v) => apply({ paper: v }, false))),
      ] : null,
      h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Background'), seg([['dark', 'Dark'], ['wood', 'Wood'], ['light', 'Light']], p.backdrop, (v) => apply({ backdrop: v }, false))),
      h('div', { class: 'ebk-pop-row' }, h('span', {}, 'Auto-flip'), seg([[3, '3s'], [6, '6s'], [10, '10s']], p.autoSeconds, (v) => { apply({ autoSeconds: v }, false); if (this.auto) { this.toggleAuto(); this.toggleAuto(); } })));
    draw();
    const r = anchor.getBoundingClientRect();
    Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left + r.width / 2 - 150, innerWidth - 310))}px`, bottom: `${innerHeight - r.top + 10}px` });
    document.body.append(pop);
    const away = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', away, true); } };
    setTimeout(() => document.addEventListener('pointerdown', away, true));
  }

  closeBook() {
    if (this.fb) { this.saveState(); this.fb.destroy(); }
    try { this.book?.destroy?.(); } catch { /* already closed */ }
    clearInterval(this.auto);
    this.auto = null;
    if (this.keys) window.removeEventListener('keydown', this.keys);
    this.fb = null;
    this.book = null;
    this.laidOut = false;
    this.sideKind = null;
    this.searchQ = '';
    document.querySelector('.ebk-pop')?.remove();
  }
}

function fromKey(key) {
  const m = /^f:([^:]+):(.*)$/.exec(key);
  return m ? { root: m[1], path: m[2] } : null;
}
function ago(t) {
  if (!t) return '';
  const d = (Date.now() - t) / 60000;
  if (d < 2) return 'just now';
  if (d < 60) return `${Math.round(d)} min ago`;
  if (d < 60 * 24) return `${Math.round(d / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export { isBookName };
