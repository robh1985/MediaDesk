// Notes: a tabbed text and code editor in the spirit of Notepad++. Syntax colouring for ~40
// languages, line numbers, find & replace with regular expressions, line operations, and files
// opened from and saved to the server's shared folders (or this computer). Open tabs, including
// unsaved ones, are remembered in this browser.

import { h, clear, toast, toastError, contextMenu, debounce } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { filesCall, filesEnabled, pickFile } from '../fileapi.js';
import { highlight, detectLanguage, languages, languageName, commentStyle } from './notes-syntax.js';

const STORE = 'mediadesk.notes';
const HIGHLIGHT_LIMIT = 150 * 1024;          // larger files show as plain text so typing stays quick
const STORE_LIMIT = 400 * 1024;              // larger saved files are re-read from the server instead
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  new: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>'),
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 9z"/><path d="M3 19 7 10h16l-4 9z"/>'),
  save: svg('<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  cut: svg('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 20 4M16 16 4 4"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  find: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  replace: svg('<path d="M4 7h11l-3-3M20 17H9l3 3"/>'),
  wrap: svg('<path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M3 18h6"/><path d="m16 16-2 2 2 2"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>'),
  ws: svg('<path d="M4 6h3M10 6h10M4 12h10M17 12h3M4 18h6"/><path d="M14 16v4h6" opacity=".6"/>'),
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split highlighted HTML into lines, closing and reopening spans that cross line breaks.
function toLines(html) {
  const lines = [];
  const stack = [];
  let cur = '';
  const re = /<span class="([^"]*)">|<\/span>|\n|[^<\n]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const t = m[0];
    if (t === '\n') { lines.push(cur + '</span>'.repeat(stack.length)); cur = stack.map((c) => `<span class="${c}">`).join(''); }
    else if (t === '</span>') { stack.pop(); cur += t; }
    else if (m[1] !== undefined) { stack.push(m[1]); cur += t; }
    else cur += t;
  }
  lines.push(cur);
  return lines;
}
const linesHtml = (lines) => lines.map((l) => `<div class="nl">${l || '<br>'}</div>`).join('');

// Make tabs and trailing spaces visible.
function showWhitespace(html) {
  return html.replace(/(>|^)([^<]*)/g, (m, a, text) => a + text.replace(/\t/g, '<span class="ws-tab">→</span>').replace(/ /g, '<span class="ws-sp">·</span>'));
}

let untitledCount = 0;
let docSeq = 0;

export const notesApp = {
  id: 'notes', name: 'Notes', icon: appIcon.notes, size: [1060, 720], description: 'Text and code editor like Notepad++',
  open(win, opts = {}) { new Notes(win, opts); },
};

class Notes {
  constructor(win, opts) {
    this.win = win;
    this.persist = debounce(() => this.persistNow(), 600);
    const s = loadStore();
    this.settings = { wrap: false, fontSize: 13.5, lineNumbers: true, whitespace: false, tabSize: 4, useSpaces: false, ...s.settings };
    this.docs = (s.docs || []).map((d) => ({ ...d, id: ++docSeq, saved: d.saved ?? d.text }));
    untitledCount = Math.max(0, ...this.docs.map((d) => Number(/^new (\d+)$/.exec(d.name)?.[1] || 0)));
    this.find = { query: '', replace: '', caseSensitive: false, word: false, regex: false, matches: [], current: -1 };
    this.build();
    if (!this.docs.length) this.newDoc();
    const active = this.docs[Math.min(s.active ?? 0, this.docs.length - 1)] || this.docs[0];
    this.activate(active);
    // Restore saved files whose text wasn't kept locally.
    for (const d of this.docs) if (d.text === null) this.reload(d, { quiet: true });
    if (opts.root !== undefined && opts.path) this.openServerFile(opts.root, opts.path);
    win.on('reopen', (o) => { if (o?.root !== undefined && o.path) this.openServerFile(o.root, o.path); });
    win.on('close', () => { this.persistNow(); document.removeEventListener('selectionchange', this.onSel); });
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  build() {
    const menu = (label, items) => h('button', { class: 'notes-menu-btn', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 2, items().filter(Boolean).map((it) => (it === '-' ? it : { ...it, action: () => { it.action(); this.focus(); } })));
    } }, label);
    const tool = (glyph, title, fn) => h('button', { class: 'notes-tool', title, 'aria-label': title, html: glyph, onclick: () => { fn(); this.focus(); } });
    this.wrapBtn = tool(I.wrap, 'Word wrap', () => this.setSetting('wrap', !this.settings.wrap));
    this.wsBtn = tool(I.ws, 'Show whitespace', () => this.setSetting('whitespace', !this.settings.whitespace));
    const menubar = h('div', { class: 'notes-menubar' },
      menu('File', () => this.fileMenu()), menu('Edit', () => this.editMenu()), menu('Search', () => this.searchMenu()),
      menu('View', () => this.viewMenu()), menu('Language', () => this.languageMenu()), menu('Encoding', () => this.encodingMenu()));
    const toolbar = h('div', { class: 'notes-toolbar' },
      tool(I.new, `New (Alt+N)`, () => this.newDoc()), tool(I.open, `Open (${MOD}O)`, () => this.openDialog()), tool(I.save, `Save (${MOD}S)`, () => this.save()),
      h('span', { class: 'notes-tsep' }),
      tool(I.cut, 'Cut', () => this.clip('cut')), tool(I.copy, 'Copy', () => this.clip('copy')), tool(I.paste, 'Paste', () => this.clip('paste')),
      h('span', { class: 'notes-tsep' }),
      tool(I.undo, `Undo (${MOD}Z)`, () => this.exec('undo')), tool(I.redo, `Redo (${MOD}Y)`, () => this.exec('redo')),
      h('span', { class: 'notes-tsep' }),
      tool(I.find, `Find (${MOD}F)`, () => this.openFind(false)), tool(I.replace, `Replace (${MOD}H)`, () => this.openFind(true)),
      h('span', { class: 'notes-tsep' }),
      this.wrapBtn, this.wsBtn, tool(I.zoomIn, 'Zoom in', () => this.zoom(1)), tool(I.zoomOut, 'Zoom out', () => this.zoom(-1)));
    this.tabs = h('div', { class: 'notes-tabs', role: 'tablist' });
    this.findBar = this.buildFind();

    this.ta = h('textarea', { class: 'notes-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', 'aria-label': 'Text' });
    this.hl = h('pre', { class: 'notes-hl', 'aria-hidden': 'true' });
    this.marks = h('pre', { class: 'notes-marks', 'aria-hidden': 'true' });
    this.curLine = h('div', { class: 'notes-curline' });
    this.gutter = h('div', { class: 'notes-gutter', 'aria-hidden': 'true' });
    this.code = h('div', { class: 'notes-code' }, this.curLine, this.marks, this.hl, this.ta);
    this.scroller = h('div', { class: 'notes-scroller' }, h('div', { class: 'notes-inner' }, this.gutter, this.code));
    this.status = h('div', { class: 'notes-status' });
    this.root = h('div', { class: 'notes' }, menubar, toolbar, this.tabs, this.findBar, this.scroller, this.status);
    clear(this.win.body, this.root);
    this.applySettings();

    this.ta.addEventListener('input', () => this.onInput());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('scroll', () => { this.ta.scrollTop = 0; this.ta.scrollLeft = 0; });
    this.onSel = () => { if (document.activeElement === this.ta) this.updateCaret(); };
    document.addEventListener('selectionchange', this.onSel);
    this.ta.addEventListener('click', () => this.updateCaret());
    this.ta.addEventListener('keyup', () => this.updateCaret());
    this.scroller.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
    this.scroller.addEventListener('scroll', () => { if (this.doc) this.doc.scroll = [this.scroller.scrollLeft, this.scroller.scrollTop]; });
    // Keyboard shortcuts that work anywhere in the window.
    this.win.body.addEventListener('keydown', (e) => this.onWindowKey(e));
    new ResizeObserver(() => { if (this.settings.wrap) this.renderGutter(); this.updateCaret(); }).observe(this.scroller);
    // Dropping files from the computer opens them.
    this.root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    this.root.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      [...e.dataTransfer.files].forEach((f) => this.openLocalFile(f));
    });
  }

  buildFind() {
    const f = this.find;
    this.findInput = h('input', { class: 'input notes-find-input', placeholder: 'Find', spellcheck: 'false' });
    this.replaceInput = h('input', { class: 'input notes-find-input', placeholder: 'Replace with', spellcheck: 'false' });
    this.findCount = h('span', { class: 'small muted notes-find-count' });
    const opt = (key, label, title) => {
      const b = h('button', { class: `notes-opt ${f[key] ? 'on' : ''}`, title, 'aria-pressed': String(f[key]), onclick: () => { f[key] = !f[key]; b.classList.toggle('on', f[key]); b.setAttribute('aria-pressed', String(f[key])); this.runFind(); } }, label);
      return b;
    };
    this.replaceRow = h('div', { class: 'notes-find-row' }, this.replaceInput,
      h('button', { class: 'btn btn-sm', onclick: () => this.replaceOne() }, 'Replace'),
      h('button', { class: 'btn btn-sm', onclick: () => this.replaceAll() }, 'Replace all'));
    const bar = h('div', { class: 'notes-find', hidden: true },
      h('div', { class: 'notes-find-row' }, this.findInput,
        opt('caseSensitive', 'Aa', 'Match case'), opt('word', 'W', 'Whole word'), opt('regex', '.*', 'Regular expression'),
        this.findCount,
        h('button', { class: 'btn btn-sm btn-icon', title: 'Previous (Shift+F3)', 'aria-label': 'Previous', html: svg('<path d="m18 15-6-6-6 6"/>'), onclick: () => this.findNext(-1) }),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Next (F3)', 'aria-label': 'Next', html: svg('<path d="m6 9 6 6 6-6"/>'), onclick: () => this.findNext(1) }),
        h('button', { class: 'btn btn-sm btn-icon btn-ghost', title: 'Close (Esc)', 'aria-label': 'Close', html: icon.x, onclick: () => this.closeFind() })),
      this.replaceRow);
    this.findInput.addEventListener('input', () => { f.query = this.findInput.value; this.runFind(true); });
    this.replaceInput.addEventListener('input', () => { f.replace = this.replaceInput.value; });
    const keys = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.target === this.replaceInput && (e.ctrlKey || e.metaKey)) this.replaceAll(); else if (e.target === this.replaceInput) this.replaceOne(); else this.findNext(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
    };
    this.findInput.addEventListener('keydown', keys);
    this.replaceInput.addEventListener('keydown', keys);
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  fileMenu() {
    const d = this.doc;
    const server = filesEnabled();
    return [
      { label: 'New', icon: I.new, shortcut: 'Alt+N', action: () => this.newDoc() },
      { label: 'Open from server…', icon: I.open, shortcut: `${MOD}O`, disabled: !server, action: () => this.openDialog() },
      { label: 'Open from this device…', icon: icon.upload || I.open, action: () => this.openLocal() },
      d?.root !== undefined && d?.path ? { label: 'Reload from disk', icon: icon.refresh, action: () => this.reload(d) } : null,
      '-',
      { label: 'Save', icon: I.save, shortcut: `${MOD}S`, action: () => this.save() },
      { label: 'Save as…', shortcut: `${MOD}Alt+S`, disabled: !server, action: () => this.saveAs() },
      { label: 'Save all', action: () => this.saveAll() },
      { label: 'Download to this device', icon: icon.download, action: () => this.download() },
      '-',
      { label: 'Close tab', icon: icon.x, action: () => this.closeDoc(d) },
      { label: 'Close all but this', disabled: this.docs.length < 2, action: () => this.closeOthers(d) },
      { label: 'Close all', action: () => this.closeAll() },
      !server ? '-' : null,
      !server ? { label: 'Server files are off (Settings → Files)', disabled: true, action: () => {} } : null,
    ];
  }

  editMenu() {
    return [
      { label: 'Undo', icon: I.undo, shortcut: `${MOD}Z`, action: () => this.exec('undo') },
      { label: 'Redo', icon: I.redo, shortcut: `${MOD}Y`, action: () => this.exec('redo') },
      '-',
      { label: 'Cut', icon: I.cut, shortcut: `${MOD}X`, action: () => this.clip('cut') },
      { label: 'Copy', icon: I.copy, shortcut: `${MOD}C`, action: () => this.clip('copy') },
      { label: 'Paste', icon: I.paste, shortcut: `${MOD}V`, action: () => this.clip('paste') },
      { label: 'Select all', shortcut: `${MOD}A`, action: () => { this.ta.select(); this.updateCaret(); } },
      '-',
      { label: 'Duplicate line', shortcut: `${MOD}D`, action: () => this.duplicateLine() },
      { label: 'Delete line', shortcut: `${MOD}L`, action: () => this.deleteLines() },
      { label: 'Move line up', shortcut: 'Alt+↑', action: () => this.moveLines(-1) },
      { label: 'Move line down', shortcut: 'Alt+↓', action: () => this.moveLines(1) },
      { label: 'Join lines', shortcut: `${MOD}J`, action: () => this.transformLines((ls) => [ls.map((l, i) => (i ? l.trimStart() : l.trimEnd())).join(' ')]) },
      { label: 'Toggle comment', shortcut: `${MOD}/`, disabled: !commentStyle(this.doc?.lang), action: () => this.toggleComment() },
      '-',
      { label: 'UPPERCASE', shortcut: `${MOD}Shift+U`, action: () => this.transformSelection((t) => t.toUpperCase()) },
      { label: 'lowercase', shortcut: `${MOD}U`, action: () => this.transformSelection((t) => t.toLowerCase()) },
      { label: 'Title Case', action: () => this.transformSelection((t) => t.toLowerCase().replace(/(^|[\s\-_(["'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())) },
      '-',
      { label: 'Sort lines A → Z', action: () => this.transformLines((ls) => [...ls].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) },
      { label: 'Sort lines Z → A', action: () => this.transformLines((ls) => [...ls].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) },
      { label: 'Remove duplicate lines', action: () => this.transformLines((ls) => [...new Set(ls)]) },
      { label: 'Remove empty lines', action: () => this.transformLines((ls) => ls.filter((l) => l.trim())) },
      { label: 'Trim trailing spaces', action: () => this.transformLines((ls) => ls.map((l) => l.replace(/[ \t]+$/, ''))) },
      { label: 'Tabs → spaces', action: () => this.transformLines((ls) => ls.map((l) => l.replace(/\t/g, ' '.repeat(this.settings.tabSize)))) },
      { label: 'Leading spaces → tabs', action: () => this.transformLines((ls) => ls.map((l) => l.replace(/^( +)/, (m) => '\t'.repeat(Math.floor(m.length / this.settings.tabSize)) + ' '.repeat(m.length % this.settings.tabSize)))) },
      '-',
      { label: 'Insert date and time', action: () => this.insert(new Date().toLocaleString()) },
    ];
  }

  searchMenu() {
    return [
      { label: 'Find…', icon: I.find, shortcut: `${MOD}F`, action: () => this.openFind(false) },
      { label: 'Replace…', icon: I.replace, shortcut: `${MOD}H`, action: () => this.openFind(true) },
      { label: 'Find next', shortcut: 'F3', action: () => this.findNext(1) },
      { label: 'Find previous', shortcut: 'Shift+F3', action: () => this.findNext(-1) },
      '-',
      { label: 'Go to line…', shortcut: `${MOD}G`, action: () => this.goToLine() },
    ];
  }

  viewMenu() {
    const s = this.settings;
    return [
      { label: 'Word wrap', checked: s.wrap, shortcut: 'Alt+Z', action: () => this.setSetting('wrap', !s.wrap) },
      { label: 'Line numbers', checked: s.lineNumbers, action: () => this.setSetting('lineNumbers', !s.lineNumbers) },
      { label: 'Show whitespace', checked: s.whitespace, action: () => this.setSetting('whitespace', !s.whitespace) },
      '-',
      { label: 'Zoom in', icon: I.zoomIn, shortcut: `${MOD}+`, action: () => this.zoom(1) },
      { label: 'Zoom out', icon: I.zoomOut, shortcut: `${MOD}−`, action: () => this.zoom(-1) },
      { label: 'Reset zoom', shortcut: `${MOD}0`, action: () => this.zoom(0) },
      '-',
      ...[2, 4, 8].map((n) => ({ label: `Tab width ${n}`, checked: s.tabSize === n, action: () => this.setSetting('tabSize', n) })),
      { label: 'Indent with spaces', checked: s.useSpaces, action: () => this.setSetting('useSpaces', !s.useSpaces) },
    ];
  }

  languageMenu() {
    return languages().map((l) => ({ label: l.name, checked: this.doc?.lang === l.id, action: () => { this.doc.lang = l.id; this.doc.langSet = true; this.render(); this.persist(); } }));
  }

  encodingMenu() {
    const d = this.doc;
    return [
      { label: 'UTF-8', checked: !d.bom, action: () => { d.bom = false; this.markDirty(); } },
      { label: 'UTF-8 with BOM', checked: d.bom, action: () => { d.bom = true; this.markDirty(); } },
      '-',
      { label: 'Windows line endings (CR LF)', checked: d.eol === '\r\n', action: () => { d.eol = '\r\n'; this.markDirty(); } },
      { label: 'Unix line endings (LF)', checked: d.eol !== '\r\n', action: () => { d.eol = '\n'; this.markDirty(); } },
    ];
  }

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  makeDoc(props) {
    return { id: ++docSeq, name: 'new', text: '', saved: '', lang: 'text', eol: isWindows() ? '\r\n' : '\n', bom: false, cursor: [0, 0], scroll: [0, 0], ...props };
  }

  newDoc() {
    const d = this.makeDoc({ name: `new ${++untitledCount}` });
    this.docs.push(d);
    this.activate(d);
    this.persist();
    return d;
  }

  async openServerFile(root, path) {
    const existing = this.docs.find((d) => d.root === Number(root) && d.path === path);
    if (existing) { this.activate(existing); return; }
    const name = path.split('/').pop();
    const d = this.makeDoc({ name, root: Number(root), path, text: null, lang: detectLanguage(name) });
    // Replace a blank, untouched first tab, as Notepad++ does.
    const blank = this.docs.length === 1 && !this.docs[0].path && !this.docs[0].text && this.docs[0].saved === '' ? this.docs[0] : null;
    this.docs.push(d);
    if (blank) this.docs.splice(this.docs.indexOf(blank), 1);
    this.activate(d);
    await this.reload(d);
  }

  async reload(d, { quiet = false } = {}) {
    if (!quiet && d.text !== null && d.text !== d.saved) {
      if (!(await ask(`Reload “${d.name}”?`, 'Your unsaved changes will be lost.', 'Reload'))) return;
    }
    d.loading = true;
    this.renderTabs();
    try {
      const r = await filesCall('text', { params: { root: d.root, path: d.path } });
      const eol = /\r\n/.test(r.text) ? '\r\n' : '\n';
      const text = r.text.replace(/\r\n?/g, '\n');
      Object.assign(d, { text, saved: text, modified: r.modified, bom: r.bom, eol, loading: false, error: null });
      if (!d.langSet) d.lang = detectLanguage(d.name, text);
      if (d === this.doc) { this.ta.value = text; this.ta.setSelectionRange(...clampSel(d.cursor, text)); this.render(); }
    } catch (err) {
      d.loading = false;
      if (d.text === null) {
        // Couldn't read it: drop the tab.
        toastError(err, `Could not open ${d.name}`);
        this.closeDoc(d, true);
        return;
      }
      toastError(err, `Could not reload ${d.name}`);
    }
    this.renderTabs();
    this.persist();
  }

  async openDialog() {
    if (!filesEnabled()) return this.openLocal();
    const d = this.doc;
    const pick = await pickFile({ mode: 'open', title: 'Open file', start: d?.path ? { root: d.root, path: d.path.split('/').slice(0, -1).join('/') } : this.lastDir });
    this.focus();
    if (!pick) return;
    this.lastDir = { root: pick.root, path: pick.dir };
    this.openServerFile(pick.root, pick.path);
  }

  openLocal() {
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', () => { [...input.files].forEach((f) => this.openLocalFile(f)); input.remove(); });
    document.body.append(input);
    input.click();
  }

  async openLocalFile(file) {
    if (file.size > 10 * 1024 * 1024) { toast('File is too large', { body: `${file.name} is over 10 MB`, type: 'error' }); return; }
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.subarray(0, 8000).includes(0)) { toast('Not a text file', { body: file.name, type: 'error' }); return; }
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const raw = new TextDecoder().decode(buf).replace(/^﻿/, '');
    const text = raw.replace(/\r\n?/g, '\n');
    const d = this.makeDoc({ name: file.name, text, saved: text, local: true, bom, eol: /\r\n/.test(raw) ? '\r\n' : '\n', lang: detectLanguage(file.name, text) });
    this.docs.push(d);
    this.activate(d);
    this.persist();
  }

  activate(d) {
    if (!d) return;
    if (this.doc && this.doc !== d) {
      this.doc.cursor = [this.ta.selectionStart, this.ta.selectionEnd];
      this.doc.scroll = [this.scroller.scrollLeft, this.scroller.scrollTop];
    }
    this.doc = d;
    this.ta.value = d.text ?? '';
    this.ta.readOnly = d.text === null;
    this.render();
    this.ta.setSelectionRange(...clampSel(d.cursor, this.ta.value));
    this.scroller.scrollLeft = d.scroll?.[0] || 0;
    this.scroller.scrollTop = d.scroll?.[1] || 0;
    this.renderTabs();
    this.updateCaret();
    this.win.setTitle(`${d.name} — Notes`);
    if (this.find.query) this.runFind();
    this.focus();
    this.persist();
  }

  async closeDoc(d, force = false) {
    if (!d) return;
    if (!force && d.text !== null && d.text !== d.saved) {
      const choice = await askSave(d.name);
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await this.save(d))) return;
    }
    const i = this.docs.indexOf(d);
    if (i < 0) return;
    this.docs.splice(i, 1);
    if (!this.docs.length) { this.newDoc(); return; }
    if (d === this.doc) { this.doc = null; this.activate(this.docs[Math.min(i, this.docs.length - 1)]); }
    else this.renderTabs();
    this.persist();
  }
  async closeOthers(keep) {
    for (const d of [...this.docs]) if (d !== keep) await this.closeDoc(d);
  }
  async closeAll() {
    for (const d of [...this.docs]) await this.closeDoc(d);
  }

  async save(d = this.doc) {
    if (!d || d.text === null) return false;
    if (d.root === undefined || !d.path) {
      if (filesEnabled()) return this.saveAs(d);
      this.download(d);
      d.saved = d.text;
      this.renderTabs();
      return true;
    }
    const text = d.eol === '\r\n' ? d.text.replace(/\n/g, '\r\n') : d.text;
    try {
      const r = await filesCall('text', { method: 'POST', body: { root: d.root, path: d.path, text, modified: d.modified, bom: d.bom } });
      d.modified = r.modified;
      d.saved = d.text;
      this.renderTabs();
      this.persist();
      toast('Saved', { body: d.name, type: 'success', icon: appIcon.notes, timeout: 1800 });
      return true;
    } catch (err) {
      if (err.status === 409) {
        if (await ask('The file changed on disk', `“${d.name}” was changed by something else since you opened it. Save anyway and replace that version?`, 'Replace')) {
          d.modified = undefined;
          return this.save(d);
        }
        return false;
      }
      toastError(err, `Could not save ${d.name}`);
      return false;
    }
  }

  async saveAs(d = this.doc) {
    if (!filesEnabled()) { this.download(d); return true; }
    const suggested = d.path ? d.name : `${d.name.replace(/\s+/g, '-')}${d.lang && d.lang !== 'text' ? '' : '.txt'}`;
    const pick = await pickFile({ mode: 'save', title: 'Save as', name: suggested, start: d.path ? { root: d.root, path: d.path.split('/').slice(0, -1).join('/') } : this.lastDir });
    this.focus();
    if (!pick) return false;
    if (pick.exists && !(await ask('Replace file?', `“${pick.name}” already exists. Replace it?`, 'Replace'))) return false;
    const text = d.eol === '\r\n' ? d.text.replace(/\n/g, '\r\n') : d.text;
    try {
      const r = await filesCall('text/create', { method: 'POST', body: { root: pick.root, path: pick.dir, name: pick.name, text: (d.bom ? '﻿' : '') + text, overwrite: pick.exists } });
      Object.assign(d, { root: pick.root, path: r.path, name: pick.name, modified: r.modified, saved: d.text, local: false });
      if (!d.langSet) d.lang = detectLanguage(pick.name, d.text);
      this.lastDir = { root: pick.root, path: pick.dir };
      this.render();
      this.renderTabs();
      this.win.setTitle(`${d.name} — Notes`);
      this.persist();
      toast('Saved', { body: d.name, type: 'success', icon: appIcon.notes, timeout: 1800 });
      return true;
    } catch (err) { toastError(err, 'Could not save'); return false; }
  }

  async saveAll() {
    for (const d of this.docs) if (d.text !== null && d.text !== d.saved) await this.save(d);
  }

  download(d = this.doc) {
    const text = (d.bom ? '﻿' : '') + (d.eol === '\r\n' ? d.text.replace(/\n/g, '\r\n') : d.text);
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: /\.\w+$/.test(d.name) ? d.name : `${d.name}.txt` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  persistNow() {
    if (this.doc) { this.doc.cursor = [this.ta.selectionStart, this.ta.selectionEnd]; }
    const docs = this.docs.map((d) => {
      const keepText = d.text !== null && (d.text !== d.saved || d.root === undefined || d.text.length < STORE_LIMIT);
      return {
        name: d.name, root: d.root, path: d.path, lang: d.lang, langSet: d.langSet, eol: d.eol, bom: d.bom, modified: d.modified, local: d.local,
        cursor: d.cursor, scroll: d.scroll, text: keepText ? d.text : null, saved: keepText ? (d.saved === d.text ? null : d.saved) : null,
      };
    });
    const data = { settings: this.settings, docs, active: this.docs.indexOf(this.doc) };
    try { localStorage.setItem(STORE, JSON.stringify(data)); }
    catch {
      // Out of space: keep only unsaved text.
      data.docs = data.docs.map((x, i) => (this.docs[i].text === this.docs[i].saved && this.docs[i].root !== undefined ? { ...x, text: null, saved: null } : x));
      try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* give up */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  renderTabs() {
    clear(this.tabs, this.docs.map((d) => {
      const dirty = d.text !== null && d.text !== d.saved;
      const tab = h('div', {
        class: `notes-tab ${d === this.doc ? 'active' : ''} ${dirty ? 'dirty' : ''}`, role: 'tab', 'aria-selected': String(d === this.doc),
        title: d.path ? `${d.path}${dirty ? ' (unsaved)' : ''}` : d.name,
        onclick: () => { if (d !== this.doc) this.activate(d); },
        onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); this.closeDoc(d); } },
        oncontextmenu: (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
          { label: 'Close', icon: icon.x, action: () => this.closeDoc(d) },
          { label: 'Close all but this', disabled: this.docs.length < 2, action: () => this.closeOthers(d) },
          d.path ? { label: 'Copy path', icon: I.copy, action: () => navigator.clipboard?.writeText(d.path) } : null,
          d.path ? { label: 'Reload from disk', icon: icon.refresh, action: () => this.reload(d) } : null,
        ].filter(Boolean)); },
      },
      h('span', { class: 'notes-tab-icon', html: dirty ? I.save : I.new }),
      h('span', { class: 'notes-tab-name' }, d.loading ? `${d.name} …` : d.name),
      h('button', { class: 'notes-tab-close', title: 'Close', 'aria-label': `Close ${d.name}`, html: icon.x, onclick: (e) => { e.stopPropagation(); this.closeDoc(d); } }));
      return tab;
    }), h('button', { class: 'notes-tab-new', title: 'New (Alt+N)', 'aria-label': 'New tab', html: svg('<path d="M12 5v14M5 12h14"/>'), onclick: () => this.newDoc() }));
    this.tabs.querySelector('.notes-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  render() {
    const d = this.doc;
    if (!d) return;
    const text = this.ta.value;
    const big = text.length > HIGHLIGHT_LIMIT;
    let html = big ? esc(text) : highlight(text, d.lang);
    if (this.settings.whitespace) html = showWhitespace(html);
    this.lines = toLines(html);
    this.hl.innerHTML = linesHtml(this.lines);
    this.root.classList.toggle('notes-plain', big);
    this.renderGutter();
    this.renderMarks();
    this.updateCaret();
    this.updateStatus();
  }

  renderGutter() {
    const n = this.lines?.length || 1;
    this.gutter.style.setProperty('--digits', String(Math.max(3, String(n).length)));
    if (!this.settings.lineNumbers) { this.gutter.textContent = ''; return; }
    if (!this.settings.wrap) {
      if (this.gutter.childElementCount !== 1 || this.gutterCount !== n) {
        this.gutter.innerHTML = `<pre>${Array.from({ length: n }, (_, i) => i + 1).join('\n')}</pre>`;
        this.gutterCount = n;
      }
      return;
    }
    // Wrapped lines take several rows: give each number the height of its line.
    const rows = this.hl.children;
    let out = '';
    for (let i = 0; i < rows.length; i++) out += `<div style="height:${rows[i].offsetHeight}px">${i + 1}</div>`;
    this.gutter.innerHTML = out;
    this.gutterCount = -1;
  }

  renderMarks() {
    const { matches, current } = this.find;
    if (this.findBar.hidden || !matches.length) { this.marks.innerHTML = ''; return; }
    const text = this.ta.value;
    let html = '', last = 0;
    matches.forEach(([s, e], i) => {
      html += esc(text.slice(last, s)) + `<mark class="${i === current ? 'cur' : ''}">${esc(text.slice(s, e)) || ' '}</mark>`;
      last = e;
    });
    html += esc(text.slice(last));
    this.marks.innerHTML = linesHtml(toLines(html.replace(/<mark class="([^"]*)">/g, '<span class="$1 mk">').replace(/<\/mark>/g, '</span>')));
  }

  lineOf(pos) {
    const text = this.ta.value;
    let line = 0;
    for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) line++;
    return line;
  }

  updateCaret() {
    if (!this.doc) return;
    const pos = this.ta.selectionStart;
    const line = this.lineOf(pos);
    const row = this.hl.children[line];
    if (row) {
      this.curLine.style.transform = `translateY(${row.offsetTop}px)`;
      this.curLine.style.height = `${row.offsetHeight}px`;
    }
    this.caretLine = line;
    this.updateStatus();
  }

  updateStatus() {
    const d = this.doc;
    if (!d) return;
    const text = this.ta.value;
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const col = s - lineStart + 1;
    const lines = this.lines?.length || 1;
    const seg = (label, onclick, title) => h(onclick ? 'button' : 'span', { class: 'notes-st', onclick, title }, label);
    clear(this.status,
      seg(languageName(d.lang), (ev) => contextMenu(ev.clientX, ev.clientY - 10, this.languageMenu()), 'Language'),
      h('span', { class: 'grow' }),
      seg(`Ln ${(this.caretLine ?? 0) + 1}, Col ${col}${e !== s ? `, Sel ${e - s}` : ''}`, () => this.goToLine(), 'Go to line'),
      seg(`${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${text.length.toLocaleString()} char${text.length === 1 ? '' : 's'}`),
      seg(d.eol === '\r\n' ? 'Windows (CR LF)' : 'Unix (LF)', (ev) => contextMenu(ev.clientX, ev.clientY - 10, this.encodingMenu().slice(3)), 'Line endings'),
      seg(d.bom ? 'UTF-8 BOM' : 'UTF-8', (ev) => contextMenu(ev.clientX, ev.clientY - 10, this.encodingMenu().slice(0, 2)), 'Encoding'),
      this.root.classList.contains('notes-plain') ? seg('Large file: colouring off', null, 'Syntax colouring is turned off for files over 150 KB') : null);
  }

  applySettings() {
    const s = this.settings;
    this.root.style.setProperty('--notes-font', `${s.fontSize}px`);
    this.root.style.setProperty('--notes-tab', String(s.tabSize));
    this.root.classList.toggle('wrap', s.wrap);
    this.root.classList.toggle('no-gutter', !s.lineNumbers);
    this.ta.setAttribute('wrap', s.wrap ? 'soft' : 'off');
    this.wrapBtn?.classList.toggle('on', s.wrap);
    this.wsBtn?.classList.toggle('on', s.whitespace);
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.applySettings();
    this.gutterCount = -1;
    this.render();
    this.persist();
  }

  zoom(dir) {
    this.settings.fontSize = dir === 0 ? 13.5 : Math.max(8, Math.min(32, this.settings.fontSize + dir));
    this.applySettings();
    this.gutterCount = -1;
    this.render();
    this.persist();
  }

  focus() {
    if (!matchMedia('(pointer: coarse)').matches) this.ta.focus({ preventScroll: true });
  }

  markDirty() {
    // Encoding and line-ending changes count as edits.
    this.doc.saved = this.doc.saved === this.doc.text ? `${this.doc.saved}\u0000` : this.doc.saved;
    this.renderTabs();
    this.updateStatus();
    this.persist();
  }

  onInput() {
    const d = this.doc;
    const wasDirty = d.text !== d.saved;
    d.text = this.ta.value;
    this.render();
    if (this.find.query && !this.findBar.hidden) this.runFind();
    if (wasDirty !== (d.text !== d.saved)) this.renderTabs();
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Editing helpers (execCommand keeps the browser's undo history)
  // ---------------------------------------------------------------------------

  replaceRange(start, end, text, select = 'end') {
    const ta = this.ta;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    const ok = text ? document.execCommand('insertText', false, text) : (start === end || document.execCommand('delete'));
    if (!ok) { ta.setRangeText(text, start, end, 'end'); this.onInput(); }
    if (select === 'select') ta.setSelectionRange(start, start + text.length);
    this.updateCaret();
  }

  insert(text) { this.replaceRange(this.ta.selectionStart, this.ta.selectionEnd, text); }

  exec(cmd) {
    this.ta.focus();
    document.execCommand(cmd);
  }

  async clip(kind) {
    const ta = this.ta;
    const s = ta.selectionStart, e = ta.selectionEnd;
    try {
      if (kind === 'paste') { const t = await navigator.clipboard.readText(); this.insert(t); return; }
      if (s === e) return;
      await navigator.clipboard.writeText(ta.value.slice(s, e));
      if (kind === 'cut') this.replaceRange(s, e, '');
    } catch {
      toast(kind === 'paste' ? `Use ${MOD}V to paste` : `Use ${MOD}${kind === 'cut' ? 'X' : 'C'}`, { timeout: 2500 });
    }
  }

  // The whole lines covered by the selection.
  lineRange() {
    const text = this.ta.value;
    const s = this.ta.selectionStart;
    let e = this.ta.selectionEnd;
    if (e > s && text[e - 1] === '\n') e--;
    const start = text.lastIndexOf('\n', s - 1) + 1;
    let end = text.indexOf('\n', e);
    if (end === -1) end = text.length;
    return { start, end, lines: text.slice(start, end).split('\n') };
  }

  transformLines(fn) {
    let { start, end, lines } = this.lineRange();
    if (this.ta.selectionStart === this.ta.selectionEnd) { start = 0; end = this.ta.value.length; lines = this.ta.value.split('\n'); }
    const out = fn(lines).join('\n');
    if (out !== lines.join('\n')) this.replaceRange(start, end, out, 'select');
  }

  transformSelection(fn) {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (s === e) return;
    this.replaceRange(s, e, fn(this.ta.value.slice(s, e)), 'select');
  }

  duplicateLine() {
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (s !== e) { this.replaceRange(e, e, this.ta.value.slice(s, e)); return; }
    const { end, lines } = this.lineRange();
    this.replaceRange(end, end, `\n${lines.join('\n')}`);
    const off = lines.join('\n').length + 1;
    this.ta.setSelectionRange(s + off, s + off);
    this.updateCaret();
  }

  deleteLines() {
    const text = this.ta.value;
    const { start, end } = this.lineRange();
    const from = end < text.length ? start : Math.max(0, start - 1);
    const to = end < text.length ? end + 1 : end;
    this.replaceRange(from, to, '');
  }

  moveLines(dir) {
    const text = this.ta.value;
    const { start, end, lines } = this.lineRange();
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    if (dir < 0) {
      if (start === 0) return;
      const prevStart = text.lastIndexOf('\n', start - 2) + 1;
      const prev = text.slice(prevStart, start - 1);
      this.replaceRange(prevStart, end, `${lines.join('\n')}\n${prev}`);
      const shift = prev.length + 1;
      this.ta.setSelectionRange(s - shift, e - shift);
    } else {
      if (end >= text.length) return;
      let nextEnd = text.indexOf('\n', end + 1);
      if (nextEnd === -1) nextEnd = text.length;
      const next = text.slice(end + 1, nextEnd);
      this.replaceRange(start, nextEnd, `${next}\n${lines.join('\n')}`);
      const shift = next.length + 1;
      this.ta.setSelectionRange(s + shift, e + shift);
    }
    this.updateCaret();
  }

  toggleComment() {
    const style = commentStyle(this.doc.lang);
    if (!style) return;
    const [line, block] = style;
    if (!line && block) {
      const s = this.ta.selectionStart, e = this.ta.selectionEnd;
      const { start, end } = s === e ? this.lineRange() : { start: s, end: e };
      const t = this.ta.value.slice(start, end);
      const inner = t.startsWith(block[0]) && t.endsWith(block[1]) ? t.slice(block[0].length, -block[1].length).trim() : `${block[0]} ${t} ${block[1]}`;
      this.replaceRange(start, end, inner, 'select');
      return;
    }
    this.transformLines((ls) => {
      const body = ls.filter((l) => l.trim());
      const all = body.length && body.every((l) => l.trimStart().startsWith(line.trim()));
      return ls.map((l) => {
        if (!l.trim()) return l;
        if (all) return l.replace(new RegExp(`^(\\s*)${line.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?`), '$1');
        const indent = /^\s*/.exec(l)[0];
        return `${indent}${line}${line.endsWith(' ') ? '' : ' '}${l.slice(indent.length)}`;
      });
    });
  }

  indent(out) {
    const unit = this.settings.useSpaces ? ' '.repeat(this.settings.tabSize) : '\t';
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    const text = this.ta.value;
    const multi = text.slice(s, e).includes('\n');
    if (!out && !multi) { this.insert(unit); return; }
    const { start, end, lines } = this.lineRange();
    const next = lines.map((l) => {
      if (!out) return l ? unit + l : l;
      if (l.startsWith('\t')) return l.slice(1);
      return l.replace(new RegExp(`^ {1,${this.settings.tabSize}}`), '');
    });
    this.replaceRange(start, end, next.join('\n'), 'select');
  }

  newline() {
    const text = this.ta.value;
    const s = this.ta.selectionStart;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    let indent = /^[ \t]*/.exec(text.slice(lineStart, s))[0];
    // One level deeper after an opening bracket or a colon (Python, YAML).
    if (/[{[(]\s*$|:\s*$/.test(text.slice(lineStart, s)) && this.doc.lang !== 'text') indent += this.settings.useSpaces ? ' '.repeat(this.settings.tabSize) : (indent.includes(' ') && !indent.includes('\t') ? ' '.repeat(this.settings.tabSize) : '\t');
    this.insert(`\n${indent}`);
  }

  // Typing a closing bracket on an otherwise blank line takes it back one indent level.
  dedentClosing(ch) {
    const text = this.ta.value;
    const s = this.ta.selectionStart;
    if (s !== this.ta.selectionEnd) return false;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const before = text.slice(lineStart, s);
    if (!before || /\S/.test(before)) return false;
    const trimmed = before.endsWith('\t') ? before.slice(0, -1) : before.replace(new RegExp(` {1,${this.settings.tabSize}}$`), '');
    this.replaceRange(lineStart, s, trimmed + ch);
    return true;
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Tab' && !mod) { e.preventDefault(); this.indent(e.shiftKey); }
    else if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) { e.preventDefault(); this.newline(); }
    else if ('}])'.includes(e.key) && !mod && this.doc.lang !== 'text' && this.dedentClosing(e.key)) e.preventDefault();
    else if (mod && !e.shiftKey && k === 'd') { e.preventDefault(); this.duplicateLine(); }
    else if (mod && !e.shiftKey && k === 'l') { e.preventDefault(); this.deleteLines(); }
    else if (mod && k === 'j') { e.preventDefault(); this.transformLines((ls) => [ls.map((l, i) => (i ? l.trimStart() : l.trimEnd())).join(' ')]); }
    else if ((e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) || (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) { e.preventDefault(); this.moveLines(e.key === 'ArrowUp' ? -1 : 1); }
    else if (mod && (e.key === '/' || k === 'q')) { e.preventDefault(); this.toggleComment(); }
    else if (mod && e.shiftKey && k === 'u') { e.preventDefault(); this.transformSelection((t) => t.toUpperCase()); }
    else if (mod && !e.shiftKey && k === 'u') { e.preventDefault(); this.transformSelection((t) => t.toLowerCase()); }
    else if (mod && k === 'y' && !isMac) { e.preventDefault(); this.exec('redo'); }
  }

  onWindowKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); if (e.altKey) this.saveAs(); else if (e.shiftKey) this.saveAll(); else this.save(); }
    else if (mod && k === 'o') { e.preventDefault(); this.openDialog(); }
    else if (e.altKey && !mod && k === 'n') { e.preventDefault(); this.newDoc(); }
    else if (mod && k === 'f') { e.preventDefault(); this.openFind(false); }
    else if (mod && k === 'h') { e.preventDefault(); this.openFind(true); }
    else if (mod && k === 'g') { e.preventDefault(); this.goToLine(); }
    else if (e.key === 'F3') { e.preventDefault(); this.findNext(e.shiftKey ? -1 : 1); }
    else if (e.altKey && k === 'z') { e.preventDefault(); this.setSetting('wrap', !this.settings.wrap); }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.zoom(1); }
    else if (mod && e.key === '-') { e.preventDefault(); this.zoom(-1); }
    else if (mod && e.key === '0') { e.preventDefault(); this.zoom(0); }
    else if (mod && e.key === 'Tab') {
      e.preventDefault();
      const i = this.docs.indexOf(this.doc);
      this.activate(this.docs[(i + (e.shiftKey ? -1 : 1) + this.docs.length) % this.docs.length]);
    } else if (e.key === 'Escape' && !this.findBar.hidden && e.target === this.ta) this.closeFind();
  }

  // ---------------------------------------------------------------------------
  // Find & replace
  // ---------------------------------------------------------------------------

  openFind(replace) {
    this.findBar.hidden = false;
    this.replaceRow.hidden = !replace;
    const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
    if (sel && !sel.includes('\n')) { this.findInput.value = sel; this.find.query = sel; }
    this.findInput.focus();
    this.findInput.select();
    this.runFind();
  }

  closeFind() {
    this.findBar.hidden = true;
    this.renderMarks();
    this.ta.focus();
  }

  buildRegex() {
    const f = this.find;
    if (!f.query) return null;
    let src = f.regex ? f.query : f.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (f.word) src = `\\b(?:${src})\\b`;
    try { return new RegExp(src, `g${f.caseSensitive ? '' : 'i'}m`); }
    catch (err) { this.findCount.textContent = 'Invalid pattern'; return null; }
  }

  runFind(jump = false) {
    const f = this.find;
    f.matches = [];
    f.current = -1;
    const re = this.buildRegex();
    if (!re) { if (!f.query) this.findCount.textContent = ''; this.renderMarks(); return; }
    const text = this.ta.value;
    let m;
    while ((m = re.exec(text)) && f.matches.length < 20000) {
      f.matches.push([m.index, m.index + m[0].length]);
      if (m[0] === '') re.lastIndex++;
    }
    const caret = this.ta.selectionStart;
    if (f.matches.length) f.current = Math.max(0, f.matches.findIndex(([s]) => s >= caret));
    if (f.current === -1 && f.matches.length) f.current = 0;
    this.findCount.textContent = f.matches.length ? `${f.current + 1} of ${f.matches.length.toLocaleString()}` : 'No results';
    this.findInput.classList.toggle('notfound', !f.matches.length && Boolean(f.query));
    this.renderMarks();
    if (jump && f.matches.length) this.scrollToPos(f.matches[f.current][0]);
  }

  findNext(dir) {
    const f = this.find;
    if (this.findBar.hidden && !f.query) { this.openFind(false); return; }
    if (!f.matches.length) this.runFind();
    if (!f.matches.length) return;
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    let i;
    if (dir > 0) { i = f.matches.findIndex(([ms, me]) => ms >= e && !(ms === s && me === e)); if (i === -1) i = 0; }
    else { i = -1; for (let j = f.matches.length - 1; j >= 0; j--) if (f.matches[j][0] < s) { i = j; break; } if (i === -1) i = f.matches.length - 1; }
    f.current = i;
    const [ms, me] = f.matches[i];
    this.ta.setSelectionRange(ms, me);
    this.findCount.textContent = `${i + 1} of ${f.matches.length.toLocaleString()}`;
    this.renderMarks();
    this.updateCaret();
    this.scrollToPos(ms);
  }

  replaceOne() {
    const f = this.find;
    const re = this.buildRegex();
    if (!re) return;
    const s = this.ta.selectionStart, e = this.ta.selectionEnd;
    const hit = f.matches.find(([ms, me]) => ms === s && me === e);
    if (hit) {
      const one = new RegExp(re.source, re.flags.replace('g', ''));
      const replacement = this.ta.value.slice(s, e).replace(one, f.regex ? f.replace : f.replace.replace(/\$/g, '$$$$'));
      this.replaceRange(s, e, replacement);
      this.runFind();
    }
    this.findNext(1);
  }

  replaceAll() {
    const f = this.find;
    const re = this.buildRegex();
    if (!re) return;
    const count = f.matches.length;
    if (!count) return;
    const text = this.ta.value;
    const out = text.replace(re, f.regex ? f.replace : f.replace.replace(/\$/g, '$$$$'));
    this.replaceRange(0, text.length, out);
    this.ta.setSelectionRange(0, 0);
    this.runFind();
    toast(`Replaced ${count.toLocaleString()} occurrence${count === 1 ? '' : 's'}`, { timeout: 2000 });
  }

  scrollToPos(pos) {
    const line = this.lineOf(pos);
    const row = this.hl.children[line];
    if (!row) return;
    const top = row.offsetTop, sc = this.scroller;
    if (top < sc.scrollTop + 10 || top + row.offsetHeight > sc.scrollTop + sc.clientHeight - 10) sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
    // Horizontally, bring the match into view when lines don't wrap.
    if (!this.settings.wrap) {
      const col = pos - (this.ta.value.lastIndexOf('\n', pos - 1) + 1);
      const x = col * this.charWidth() + this.gutter.offsetWidth;
      if (x < sc.scrollLeft + this.gutter.offsetWidth || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
    }
  }

  charWidth() {
    if (!this.cw || this.cwSize !== this.settings.fontSize) {
      const probe = h('span', { class: 'notes-probe' }, 'x'.repeat(100));
      this.code.append(probe);
      this.cw = probe.getBoundingClientRect().width / 100;
      this.cwSize = this.settings.fontSize;
      probe.remove();
    }
    return this.cw;
  }

  async goToLine() {
    const total = this.lines?.length || 1;
    const v = await promptText('Go to line', `Line number (1 – ${total.toLocaleString()})`, String((this.caretLine ?? 0) + 1));
    const n = Math.max(1, Math.min(total, parseInt(v, 10) || 0));
    this.focus();
    if (!v) return;
    const text = this.ta.value;
    let pos = 0;
    for (let i = 1; i < n; i++) pos = text.indexOf('\n', pos) + 1;
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos);
    this.updateCaret();
    this.scrollToPos(pos);
  }
}

const isWindows = () => /Win/.test(navigator.platform);
const clampSel = ([s, e] = [0, 0], text) => [Math.min(s || 0, text.length), Math.min(e || 0, text.length)];

// Small dialogs.
function dialog(build) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } });
    overlay.append(build(done));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);
    (overlay.querySelector('input') || overlay.querySelector('.btn-primary'))?.focus();
  });
}
const ask = (title, message, confirm) => dialog((done) => h('div', { class: 'dialog' }, h('h3', {}, title), h('p', {}, message),
  h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: () => done(true) }, confirm))));
const askSave = (name) => dialog((done) => h('div', { class: 'dialog' }, h('h3', {}, `Save changes to “${name}”?`), h('p', {}, 'Your changes will be lost if you don’t save them.'),
  h('div', { class: 'dialog-actions' },
    h('button', { class: 'btn', onclick: () => done('cancel') }, 'Cancel'),
    h('button', { class: 'btn btn-danger', onclick: () => done('discard') }, 'Don’t save'),
    h('button', { class: 'btn btn-primary', onclick: () => done('save') }, 'Save')))).then((v) => v || 'cancel');
const promptText = (title, label, value) => dialog((done) => {
  const input = h('input', { class: 'input', value, inputmode: 'numeric' });
  setTimeout(() => input.select(), 0);
  return h('form', { class: 'dialog', onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } }, h('h3', {}, title),
    h('label', { class: 'field', style: { margin: '14px 0 0' } }, h('span', {}, label), input),
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Go')));
});

