// The Game Console: an all-in-one game console for the games on your MediaDesk server.
// Pick a look (ten of them, from a 1989 living room to a modern TV box), browse by console,
// and play with a keyboard or any USB / Bluetooth controller. Games run in EmulatorJS
// (player.js); saves live on the server so they follow you between devices.

import { h, clear, toast, toastError, timeAgo, formatBytes } from '../../ui.js';
import { icon, appIcon } from '../../icons.js';
import { openApp } from '../../wm.js';
import { SYSTEMS, ORDER, CORES, CORE_NAMES, SHADERS, buttonsFor, keyName, padName, padStyle } from './systems.js';
import { bindings, setBinding, resetBindings, captureKey, capturePad, pads, PLAYERS, isCustomised } from './controls.js';
import { Nav, blip } from './input.js';
import { THEMES, THEME_LIST } from './themes.js';
import { sectionBackground, peekBackground, forgetBackgrounds } from './consoleart.js';
import { pickFile, fileUrl, filesEnabled } from '../../fileapi.js';

const UI_KEY = 'mediadesk.console.ui';
const readUi = () => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } };
const writeUi = (v) => { try { localStorage.setItem(UI_KEY, JSON.stringify(v)); } catch { /* blocked */ } };

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../../css/console.css', import.meta.url).href }));
}

const api = async (path, opts = {}) => {
  const res = await fetch(`/portal/games${path}`, { credentials: 'same-origin', ...opts, headers: { 'X-MediaDesk': '1', ...(opts.body && !(opts.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  return data;
};

export const consoleApp = {
  id: 'console', name: 'The Game Console', icon: appIcon.console, size: [1180, 760], description: 'Play NES, SNES, N64, PlayStation, Genesis, Game Boy and more',
  open(win, opts = {}) {
    loadCss();
    const app = new GameConsole(win, opts);
    win.on('close', () => app.destroy());
    win.on('reopen', (o) => { if (o?.game) app.openGameById(o.game); });
  },
};

// Pictures you choose are scaled down (smoothly, in halves) to at most 1600 px on the long side,
// keeping their shape; small ones are kept as they are.
async function shrinkPicture(blob, max = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error('That file isn’t a picture this browser can read'); }
  const long = Math.max(bmp.width, bmp.height);
  if (long <= max && blob.size < 3 * 1024 * 1024 && /image\/(png|jpeg|webp|gif)/.test(blob.type)) return blob;
  const scale = Math.min(1, max / long);
  let src = bmp, w = bmp.width, hgt = bmp.height;
  const tw = Math.round(bmp.width * scale), th = Math.round(bmp.height * scale);
  while (w / 2 >= tw) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2); c.height = Math.round(hgt / 2);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; hgt = c.height;
  }
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  const x = out.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, tw, th);
  const png = blob.type === 'image/png';
  return new Promise((resolve) => out.toBlob((b) => resolve(b || blob), png ? 'image/png' : 'image/jpeg', 0.92));
}

class GameConsole {
  constructor(win, opts) {
    this.win = win;
    this.ui = { theme: 'tv', sounds: false, showAll: false, sel: {}, ...readUi() };
    if (!THEMES[this.ui.theme]) this.ui.theme = 'tv';
    this.stage = h('div', { class: 'gc-stage' });
    this.layer = h('div', { class: 'gc-layer' });
    this.root = h('div', { class: 'gc', tabindex: '-1' }, this.stage, this.layer);
    win.body.append(this.root);
    this.layers = [];
    this.capturing = false;
    this.nav = new Nav(this.root, {
      onAction: (a, el, dir) => this.action(a, el, dir),
      isActive: () => !this.player && !this.touchFrame && !this.capturing && this.isFocused(),
    });
    this.applyTheme();
    this.load().then(() => { if (opts.game) this.openGameById(opts.game); });
    this.onPad = () => { if (this.layers.at(-1)?.kind === 'settings') this.layers.at(-1).refresh?.(); };
    addEventListener('gamepadconnected', this.onPad);
    addEventListener('gamepaddisconnected', this.onPad);
  }

  isFocused() {
    return this.win.el.classList.contains('focused') && !this.win.minimized;
  }

  destroy() {
    this.nav.destroy();
    this.themeInst?.destroy?.();
    removeEventListener('gamepadconnected', this.onPad);
    removeEventListener('gamepaddisconnected', this.onPad);
    // Let a running game save before it goes.
    if (this.player) this.stopPlayer(true);
  }

  saveUi() { writeUi(this.ui); }

  // ---- Data ----

  async load(refresh = false) {
    if (!this.lib) clear(this.stage, h('div', { class: 'gc-loading' }, h('div', { class: 'gc-spin' }), 'Loading your games…'));
    try {
      this.lib = await api(`/library${refresh ? '?refresh=1' : ''}`);
    } catch (err) {
      clear(this.stage, h('div', { class: 'gc-empty' }, h('h2', {}, 'Couldn’t load your games'), h('p', {}, err.message),
        this.navBtn('Try again', () => this.load(true), 'retry')));
      this.nav.restore('retry');
      return;
    }
    this.buildModel();
    this.render();
  }

  buildModel() {
    const lib = this.lib;
    const games = lib.games || [];
    this.byId = new Map(games.map((g) => [g.id, g]));
    const fav = new Set(lib.favorites || []);
    const played = lib.played || {};
    const hidden = new Set(Object.entries(lib.systems || {}).filter(([, s]) => s.hidden).map(([k]) => k));
    const visible = games.filter((g) => !hidden.has(g.system));
    const recent = Object.entries(played).sort((a, b) => b[1].at - a[1].at).map(([id]) => this.byId.get(id)).filter((g) => g && !hidden.has(g.system)).slice(0, 20);
    const collections = [];
    if (recent.length) collections.push({ id: 'recent', name: 'Continue playing', short: 'Recent', games: recent });
    const favs = (lib.favorites || []).map((id) => this.byId.get(id)).filter(Boolean);
    if (favs.length) collections.push({ id: 'favorites', name: 'Favorites', short: 'Favorites', games: favs });
    for (const sys of ORDER) {
      if (hidden.has(sys)) continue;
      const list = visible.filter((g) => g.system === sys);
      if (!list.length && !this.ui.showAll) continue;
      collections.push({ id: `sys:${sys}`, system: sys, name: SYSTEMS[sys].name, short: SYSTEMS[sys].short, games: list });
    }
    this.model = { games: visible, all: games, collections, favorites: fav, played, demo: lib.demo, configured: lib.configured };
  }

  // ---- Rendering ----

  applyTheme() {
    this.root.className = `gc theme-${this.ui.theme}`;
    this.root.dataset.theme = this.ui.theme;
  }

  // fresh: start on the theme's first game instead of whatever was focused before.
  render(focusKey, { fresh = false } = {}) {
    const keep = focusKey || (fresh ? null : this.nav.current?.dataset.nav);
    this.themeInst?.destroy?.();
    this.themeInst = null;
    clear(this.stage);
    if (!this.model.configured) return this.renderSetup();
    const theme = THEMES[this.ui.theme];
    this.stage.append(h('div', { class: 'gc-theme' }));
    this.themeInst = theme.render(this.stage.firstChild, this.model, this) || {};
    this.applySysBg();
    // Start on a game (the theme may say which), not on a tab.
    const first = this.themeInst.initial?.() || this.stage.querySelector('.gc-theme [data-nav^="game:"]')?.dataset.nav;
    requestAnimationFrame(() => this.nav.restore(keep || first));
  }

  renderSetup() {
    clear(this.stage, h('div', { class: 'gc-empty gc-setup' },
      h('div', { class: 'gc-setup-icon', html: appIcon.console }),
      h('h2', {}, 'Welcome to The Game Console'),
      h('p', {}, 'Put your games in a folder on the MediaDesk server (one folder per console works best, like “SNES” or “PlayStation”), then choose that folder in Settings.'),
      this.navBtn('Choose the games folder', () => openApp('settings', { tab: 'console' }), 'setup', 'primary')));
    this.nav.restore('setup');
  }

  // A console's section has a picture of the console behind it.
  currentSystem() {
    if (this.themeInst?.system) return this.themeInst.system();
    const cols = this.model.collections;
    const sel = this.stateFor(this.ui.theme).sel;
    return (cols.find((c) => c.id === sel) || cols[0])?.system || null;
  }

  // The picture goes between the theme's own background and its content: the theme's
  // background moves to the theme root, and the picture layer sits on top of it.
  applySysBg() {
    const root = this.stage.querySelector('.gc-theme');
    if (!root) return;
    const main = [...root.children].find((c) => !c.classList.contains('gc-sysbg') && !c.classList.contains('gc-sysbg-credit'));
    const system = this.currentSystem();
    const token = (this.bgToken = {});
    const show = (bg) => {
      if (token !== this.bgToken || !root.isConnected) return;
      root.querySelector('.gc-sysbg')?.remove();
      root.querySelector('.gc-sysbg-credit')?.remove();
      root.classList.toggle('has-sysbg', Boolean(bg));
      if (!bg || !main) return;
      if (!main.dataset.bgMoved) {
        root.style.background = getComputedStyle(main).background;
        main.style.background = 'transparent';
        main.dataset.bgMoved = '1';
      }
      // Photos with a light backdrop (most are white) get a soft spotlight; dark ones fill.
      const rgb = (bg.edge || '').match(/\d+/g)?.map(Number);
      const tone = rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150 ? 'edge-light' : 'edge-dark') : '';
      const layer = h('div', { class: `gc-sysbg ${bg.kind} ${tone}`, style: { '--sysbg-img': `url("${bg.url.replace(/"/g, '%22')}")`, '--sysbg-edge': bg.edge || 'transparent', '--sys': SYSTEMS[system]?.color || '#555' } });
      root.prepend(layer);
      if (bg.credit) root.append(h('div', { class: 'gc-sysbg-credit' }, bg.credit));
    };
    if (!system) return show(null);
    const cfg = this.lib.systems?.[system] || {};
    // Already known: no flicker between screens.
    (peekBackground(system, cfg) || sectionBackground(system, cfg)).then(show);
  }

  // Theme helpers -----------------------------------------------------------

  // A clickable / focusable thing. onActivate runs on Enter, A, click or tap.
  navBtn(label, onActivate, key, cls = '') {
    const b = h('button', { class: `gc-btn ${cls}`, 'data-nav': key || `btn:${label}` }, label);
    b.onActivate = onActivate;
    return b;
  }

  gameTile(game, { cls = '', label = true, sub = false, wide = false } = {}) {
    const el = h('button', { class: `gc-tile ${cls} ${this.model.favorites.has(game.id) ? 'fav' : ''}`, 'data-nav': `game:${game.id}`, 'aria-label': game.title, dataset: { game: game.id } },
      this.cover(game, { wide }),
      label ? h('span', { class: 'gc-tile-title' }, game.title) : null,
      sub ? h('span', { class: 'gc-tile-sub' }, SYSTEMS[game.system]?.short || '') : null);
    el.onActivate = () => this.openGame(game);
    return el;
  }

  // Box art from the server, or a drawn cover in the console's colours.
  cover(game, { wide = false } = {}) {
    const sys = SYSTEMS[game.system] || {};
    const kind = sys.disc ? 'disc' : sys.kind === 'handheld' ? 'handheld' : sys.kind === 'arcade' ? 'arcade' : 'cart';
    const el = h('span', { class: `gc-cover ${kind} ${wide ? 'wide' : ''}`, style: { '--sys': sys.color || '#555' } },
      h('span', { class: 'gc-cover-band' }, sys.short || ''),
      h('span', { class: 'gc-cover-title' }, game.title),
      h('span', { class: 'gc-cover-maker' }, sys.maker || ''));
    // Box art is scaled to fit the frame (nothing cut off) over a blurred copy of itself, unless
    // you chose otherwise for this game (Box art… in its details).
    const prefs = this.lib?.artPrefs?.[game.id] || {};
    el.classList.add(`fit-${prefs.fit || 'fit'}`, `artbg-${prefs.bg || 'blur'}`);
    if (!prefs.none && (!this.model.demo || prefs.v) && !GameConsole.noArt.has(game.id)) {
      const src = `/portal/games/art?id=${game.id}${prefs.v ? `&v=${prefs.v}` : ''}`;
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
      const blur = h('i', { class: 'gc-cover-blur', style: { 'background-image': `url("${src}")` } });
      img.onload = () => el.classList.add('has-art');
      img.onerror = () => { GameConsole.noArt.add(game.id); img.remove(); blur.remove(); };
      img.src = src;
      el.append(blur, img);
    }
    return el;
  }

  sysBadge(system) {
    const s = SYSTEMS[system] || {};
    return h('span', { class: 'gc-sys', style: { '--sys': s.color || '#555' } }, s.short || system);
  }

  chrome() {
    const settings = h('button', { class: 'gc-chrome-btn', 'data-nav': 'act:settings', title: 'Settings (Start / M)', 'aria-label': 'Settings', html: icon.sliders });
    settings.onActivate = () => this.openSettings();
    const full = h('button', { class: 'gc-chrome-btn', 'data-nav': 'act:full', title: 'TV mode (full screen)', 'aria-label': 'Full screen', html: icon.maximize });
    full.onActivate = () => this.toggleFull();
    return [settings, full];
  }

  toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.root.requestFullscreen?.().catch(() => {});
  }

  stateFor(themeId) { return (this.ui.sel[themeId] ||= {}); }

  // ---- Input ----

  action(a, el, dir) {
    const top = this.layers.at(-1);
    const target = top || this.themeInst || {};
    if (a === 'focus' || a === 'moved') { if (a === 'focus') blip('move', this.ui.sounds); target.onFocus?.(el); return; }
    if (a === 'hover') { target.onFocus?.(el, true); return; }
    if (a === 'move') { if (el?.onMove) { el.onMove(dir); blip('move', this.ui.sounds); return true; } return target.onMove?.(el, dir) === true; }
    if (a === 'edge') { target.onEdge?.(el, dir); return; }
    if (a === 'select') {
      if (!el) return;
      blip('select', this.ui.sounds);
      if (el.onActivate) el.onActivate();
      else if (el.tagName === 'BUTTON' && !el.closest('.gc-tile')) { /* plain buttons use their own click handler */ }
      return;
    }
    if (a === 'back') {
      blip('back', this.ui.sounds);
      if (top) { if (top.onBack?.() !== true) this.closeLayer(); return; }
      this.themeInst?.onBack?.();
      return;
    }
    if (a === 'menu') { if (top?.kind === 'settings') this.closeLayer(); else if (!top) this.openSettings(); return; }
    const gameId = el?.dataset.game || (el?.dataset.nav?.startsWith('game:') ? el.dataset.nav.slice(5) : null);
    if (a === 'favorite' && gameId && !top) { this.toggleFavorite(this.byId.get(gameId)); return; }
    if (a === 'details' && gameId && !top) { this.openGame(this.byId.get(gameId)); return; }
    if (a === 'prev' || a === 'next') { (top || this.themeInst)?.onTab?.(a === 'next' ? 1 : -1); }
  }

  // ---- Layers (game details, settings) ----

  openLayer(kind, build) {
    const box = h('div', { class: `gc-sheet gc-${kind}` });
    const layer = { kind, box, focus: this.nav.current?.dataset.nav };
    this.layers.push(layer);
    this.stage.inert = true;
    this.layers.slice(0, -1).forEach((l) => { l.box.inert = true; });
    this.layer.append(box);
    this.layer.classList.add('open');
    build(box, layer);
    return layer;
  }

  closeLayer() {
    const l = this.layers.pop();
    if (!l) return;
    l.onClose?.();
    l.box.classList.add('leaving');
    setTimeout(() => l.box.remove(), 160);
    const below = this.layers.at(-1);
    if (below) below.box.inert = false;
    else { this.stage.inert = false; this.layer.classList.remove('open'); }
    requestAnimationFrame(() => this.nav.restore(l.focus));
  }

  // ---- Game details ----

  openGameById(id) {
    const g = this.byId?.get(id);
    if (g) this.openGame(g);
  }

  openGame(game) {
    if (!game) return;
    const sys = SYSTEMS[game.system] || {};
    this.openLayer('details', async (box, layer) => {
      const played = this.model.played[game.id];
      const fav = h('button', { class: 'gc-btn', 'data-nav': 'd:fav' });
      const paintFav = () => { fav.textContent = this.model.favorites.has(game.id) ? '★ Favorite' : '☆ Add to favorites'; };
      paintFav();
      fav.onActivate = async () => { await this.toggleFavorite(game, false); paintFav(); };
      const actions = h('div', { class: 'gc-actions' }, h('div', { class: 'gc-spin small' }));
      const statesBox = h('div', { class: 'gc-states' });
      const artBox = h('div', { class: 'gc-details-art' }, this.cover(game));
      box.append(h('div', { class: 'gc-details-in' },
        artBox,
        h('div', { class: 'gc-details-info' },
          this.sysBadge(game.system),
          h('h2', {}, game.title),
          h('div', { class: 'gc-meta' }, [game.tags?.filter((t) => t !== 'MediaDesk').join(' · '), formatBytes(game.size),
            played ? `played ${timeAgo(played.at)}${played.seconds > 60 ? ` · ${Math.round(played.seconds / 3600 * 10) / 10 || '<0.1'} h in total` : ''}` : 'never played'].filter(Boolean).join(' · ')),
          game.sample ? h('p', { class: 'gc-note' }, 'This is a sample entry in demo mode — try the Controller Test Cart, or add your own games.') : null,
          sys.unsupported ? h('p', { class: 'gc-note' }, sys.unsupported) : null,
          game.guessed ? h('p', { class: 'gc-note' }, `Guessed to be a ${sys.short} game from its file type. Put it in a folder named after its console if that’s wrong.`) : null,
          actions,
          statesBox,
          h('div', { class: 'gc-small' }, game.path))));
      // Saves decide between "Play" and "Continue".
      let saves = { states: [] };
      if (!game.sample && !sys.unsupported) { try { saves = await api(`/saves/${game.id}`); } catch { /* none */ } }
      const auto = saves.states.find((s) => s.slot === 'auto');
      const playable = !game.sample && !sys.unsupported;
      clear(actions,
        playable && auto ? this.navBtn(`▶ Continue (${timeAgo(auto.at)})`, () => this.play(game, 'auto'), 'd:continue', 'primary') : null,
        playable ? this.navBtn(auto ? 'Start over' : '▶ Play', () => this.play(game), 'd:play', auto ? '' : 'primary') : null,
        fav,
        this.navBtn('Box art…', () => this.openArtEditor(game, () => clear(artBox, this.cover(game))), 'd:art'),
        this.navBtn(`${sys.short || 'Console'} settings`, () => this.openSettings({ tab: 'consoles', system: game.system }), 'd:settings'),
        this.navBtn('Back', () => this.closeLayer(), 'd:back'));
      const slots = saves.states.filter((s) => s.slot !== 'auto');
      if (slots.length && playable) {
        statesBox.append(h('h3', {}, 'Saved states'), h('div', { class: 'gc-state-row' }, slots.map((s) => {
          const b = h('button', { class: 'gc-state', 'data-nav': `d:state:${s.slot}` },
            s.shot ? h('img', { src: `/portal/games/saves/${game.id}/shot/${s.slot}?t=${s.at}`, alt: '' }) : h('span', { class: 'gc-state-ph' }, s.slot),
            h('span', {}, `Slot ${s.slot}`), h('span', { class: 'gc-small' }, timeAgo(s.at)));
          b.onActivate = () => this.play(game, s.slot);
          return b;
        })));
      }
      this.nav.restore(playable ? (auto ? 'd:continue' : 'd:play') : 'd:fav');
    });
  }

  // A console's own background picture, from the shared folders or this device.
  async setConsolePicture(system, from, layer) {
    let blob = null;
    if (from === 'shared') {
      const pick = await pickFile({ title: `Background for ${SYSTEMS[system].short}`, accept: (e) => e.dir || /\.(png|jpe?g|webp|gif)$/i.test(e.name) });
      if (!pick) return;
      const r = await fetch(fileUrl(pick.root, pick.path), { credentials: 'same-origin' });
      if (r.ok) blob = await r.blob();
    } else {
      blob = await new Promise((resolve) => {
        const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' } });
        input.onchange = () => { resolve(input.files?.[0] || null); input.remove(); };
        document.body.append(input);
        input.click();
      });
    }
    if (!blob) return;
    try {
      const small = await shrinkPicture(blob, 2400);
      this.lib.systems = (await api(`/console-art/${system}`, { method: 'PUT', body: new Uint8Array(await small.arrayBuffer()), headers: { 'Content-Type': 'application/octet-stream' } })).systems;
      toast('Background changed', { icon: appIcon.console, timeout: 1500 });
      this.applySysBg();
      layer?.refresh?.();
    } catch (err) { toastError(err, 'Couldn’t use that picture'); }
  }

  // ---- Box art ----

  // Change a game's box art: your own picture (from the shared folders or this device), the
  // downloaded one again, or none; and how it's shown — scaled to fit with nothing cut off (the
  // space around it filled with a blurred copy, the console's colour, black or white), or
  // filling the frame.
  openArtEditor(game, onChanged) {
    this.openLayer('art', (box, layer) => {
      const preview = h('div', { class: 'gc-art-preview' });
      const status = h('div', { class: 'gc-small gc-art-status' });
      const prefs = () => this.lib.artPrefs?.[game.id] || {};
      const paint = () => {
        clear(preview, this.cover(game));
        const p = prefs();
        status.textContent = p.none ? 'No picture: the drawn cover is shown.' : p.v ? 'Showing the picture you chose (or the downloaded one, if you went back to it).' : 'Showing the downloaded box art, or a picture with the same name in your games folder.';
      };
      const changed = (r) => {
        this.lib.artPrefs = r.art;
        GameConsole.noArt.delete(game.id);
        layer.dirty = true;
        paint();
      };
      const busy = async (label, fn) => {
        try { toast(label, { icon: appIcon.console, timeout: 1200 }); changed(await fn()); } catch (err) { if (err) toastError(err, 'Couldn’t change the box art'); }
      };
      const upload = async (blob) => changed(await api(`/art?id=${game.id}`, { method: 'PUT', body: new Uint8Array(await (await shrinkPicture(blob)).arrayBuffer()), headers: { 'Content-Type': 'application/octet-stream' } }));
      const settings = (values) => busy('Saving…', () => api('/art-settings', { method: 'POST', body: JSON.stringify({ id: game.id, ...values }) }));
      const fromDevice = () => {
        const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' } });
        input.onchange = async () => { const f = input.files?.[0]; input.remove(); if (f) try { await upload(f); toast('Box art changed', { icon: appIcon.console, timeout: 1500 }); } catch (err) { toastError(err, 'Couldn’t use that picture'); } };
        document.body.append(input);
        input.click();
      };
      const fromShared = async () => {
        const pick = await pickFile({ title: `Box art for ${game.title}`, accept: (e) => e.dir || /\.(png|jpe?g|webp|gif)$/i.test(e.name) });
        if (!pick) return;
        try {
          const r = await fetch(fileUrl(pick.root, pick.path), { credentials: 'same-origin' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          await upload(await r.blob());
          toast('Box art changed', { icon: appIcon.console, timeout: 1500 });
        } catch (err) { toastError(err, 'Couldn’t use that picture'); }
      };
      const p = prefs();
      box.append(h('div', { class: 'gc-art-in' },
        preview,
        h('div', { class: 'gc-art-opts' },
          h('h2', {}, 'Box art'), h('div', { class: 'gc-small' }, game.title),
          status,
          h('h3', {}, 'Picture'),
          h('div', { class: 'gc-row gc-wrap' },
            filesEnabled() ? this.navBtn('From shared folders…', fromShared, 'art:shared') : null,
            this.navBtn('From this device…', fromDevice, 'art:upload'),
            this.navBtn('Download again', () => settings({ refetch: true }), 'art:refetch'),
            this.navBtn('No picture', () => settings({ none: !prefs().none }), 'art:none')),
          h('h3', {}, 'How it’s shown'),
          this.optionRow('art:fit', 'Size', [['fit', 'Scale to fit (whole picture)'], ['fill', 'Fill the frame (trims the edges)']], p.fit || 'fit', (v) => settings({ fit: v })),
          this.optionRow('art:bg', 'Around it', [['blur', 'Blurred copy of the picture'], ['console', 'The console’s colour'], ['black', 'Black'], ['white', 'White']], p.bg || 'blur', (v) => settings({ bg: v }),
            'Fills the space when the picture’s shape differs from the frame'),
          h('div', { class: 'gc-row' }, this.navBtn('Done', () => this.closeLayer(), 'art:done', 'primary')))));
      paint();
      layer.onClose = () => { if (layer.dirty) { onChanged?.(); this.render(); } };
      this.nav.restore(filesEnabled() ? 'art:shared' : 'art:upload');
    });
  }

  async toggleFavorite(game, rerender = true) {
    if (!game) return;
    const on = !this.model.favorites.has(game.id);
    try {
      const r = await api('/settings', { method: 'POST', body: JSON.stringify({ favorite: game.id, on }) });
      this.lib.favorites = r.favorites;
      this.buildModel();
      toast(on ? 'Added to favorites' : 'Removed from favorites', { body: game.title, icon: appIcon.console, timeout: 1600 });
      if (rerender && !this.layers.length) this.render(`game:${game.id}`);
      else if (!rerender) this.pendingRender = true;
    } catch (err) { toastError(err); }
  }

  // ---- Playing ----

  play(game, resume) {
    const sys = SYSTEMS[game.system];
    const accent = getComputedStyle(this.root).getPropertyValue('--gc-accent').trim();
    const base = new URL('../../../console-player.html', import.meta.url);
    base.search = new URLSearchParams({ id: game.id, ...(resume ? { resume } : {}), ...(/^#[0-9a-f]{6}$/i.test(accent) ? { accent } : {}) }).toString();
    // PSP's emulator needs a page of its own (threads need an isolated page).
    if (sys?.threads) {
      window.open(base.href, '_blank');
      toast(`${sys.short} games open in a new tab`, { icon: appIcon.console });
      return;
    }
    while (this.layers.length) this.closeLayer();
    const frame = h('iframe', { class: 'gc-player', src: base.href, allow: 'autoplay; gamepad; fullscreen', title: game.title });
    this.player = { frame, game };
    this.root.classList.add('playing');
    this.root.append(frame);
    this.win.setTitle(`${game.title} — The Game Console`);
    frame.addEventListener('load', () => frame.focus());
    this.onMsg = (e) => {
      if (e.source !== frame.contentWindow || e.data?.source !== 'mediadesk-console') return;
      if (e.data.type === 'console-exit') this.stopPlayer();
      if (e.data.type === 'console-needs-tab') { window.open(base.href, '_blank'); this.stopPlayer(); }
    };
    addEventListener('message', this.onMsg);
  }

  // The on-screen controls editor, on the player page without a game. Settings stay open
  // underneath; layouts are saved in this browser as they're changed.
  editTouch(system) {
    if (this.touchFrame) return;
    const accent = getComputedStyle(this.root).getPropertyValue('--gc-accent').trim();
    const url = new URL('../../../console-player.html', import.meta.url);
    url.search = new URLSearchParams({ layout: system, ...(/^#[0-9a-f]{6}$/i.test(accent) ? { accent } : {}) }).toString();
    const frame = h('iframe', { class: 'gc-player gc-touch-editor', src: url.href, title: `${SYSTEMS[system].short} on-screen controls` });
    this.touchFrame = frame;
    this.root.append(frame);
    frame.addEventListener('load', () => frame.focus());
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || e.data?.source !== 'mediadesk-console' || e.data.type !== 'console-exit') return;
      removeEventListener('message', onMsg);
      frame.remove();
      this.touchFrame = null;
      this.nav.restore('con:touchedit');
    };
    addEventListener('message', onMsg);
  }

  // Ask the game to save and leave; if the window is closing, keep it alive until it has.
  stopPlayer(closing = false) {
    const p = this.player;
    if (!p) return;
    this.player = null;
    removeEventListener('message', this.onMsg);
    this.root.classList.remove('playing');
    this.win.setTitle('The Game Console');
    if (closing) {
      p.frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
      document.body.append(p.frame);
      const done = (e) => { if (e.source === p.frame.contentWindow && e.data?.type === 'console-exit') { p.frame.remove(); removeEventListener('message', done); } };
      addEventListener('message', done);
      p.frame.contentWindow?.postMessage({ source: 'mediadesk-console-host', type: 'quit' }, location.origin);
      setTimeout(() => p.frame.remove(), 15000);
      return;
    }
    p.frame.remove();
    // Play time, "Continue" and the recent list have changed.
    this.load().then(() => this.nav.restore(`game:${p.game.id}`));
  }

  // ---- Settings ----

  openSettings(opts = {}) {
    if (this.layers.some((l) => l.kind === 'settings')) return;
    this.openLayer('settings', (box, layer) => {
      const tabs = [['appearance', 'Appearance'], ['controls', 'Controls'], ['consoles', 'Consoles'], ['library', 'Games & storage'], ['about', 'About']];
      const side = h('div', { class: 'gc-set-tabs' });
      const pane = h('div', { class: 'gc-set-pane' });
      // Changes are saved as they're made; this just leaves (B / Esc do the same).
      const exit = this.navBtn('Save & exit', () => { toast('Settings saved', { icon: appIcon.console, timeout: 1500 }); this.closeLayer(); }, 'set:exit', 'primary');
      box.append(h('div', { class: 'gc-set' },
        h('div', { class: 'gc-set-head' }, h('h2', {}, 'Settings'), h('span', { class: 'gc-small gc-set-hint' }, 'Saved as you change them · B / Esc to go back'), exit),
        h('div', { class: 'gc-set-body' }, side, pane)));
      const show = (id, extra = {}) => {
        layer.tab = id;
        side.querySelectorAll('.gc-set-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
        clear(pane);
        layer.refresh = () => show(id, { keepFocus: true });
        ({ appearance: () => this.setAppearance(pane), controls: () => this.setControls(pane, layer, extra), consoles: () => this.setConsoles(pane, layer, extra), library: () => this.setLibrary(pane), about: () => this.setAbout(pane) })[id]();
      };
      layer.show = show;
      for (const [id, label] of tabs) {
        const t = h('button', { class: 'gc-set-tab', 'data-nav': `tab:${id}`, dataset: { tab: id } }, label);
        t.onActivate = () => { show(id); requestAnimationFrame(() => this.nav.restore(pane.querySelector('[data-nav]')?.dataset.nav)); };
        side.append(t);
      }
      layer.onTab = (d) => {
        const i = tabs.findIndex(([id]) => id === layer.tab);
        const next = tabs[(i + d + tabs.length) % tabs.length][0];
        show(next);
        this.nav.restore(`tab:${next}`);
      };
      layer.onClose = () => { if (this.pendingRender || layer.dirty) { this.pendingRender = false; this.buildModel(); requestAnimationFrame(() => this.render(layer.focus)); } };
      show(opts.tab || 'appearance', opts);
      this.nav.restore(opts.system ? `sys:${opts.system}` : `tab:${opts.tab || 'appearance'}`);
    });
  }

  // A row whose value changes with left/right (or A), like a console's settings menu.
  optionRow(key, label, values, current, onChange, help) {
    let i = Math.max(0, values.findIndex(([v]) => String(v) === String(current)));
    const val = h('span', { class: 'gc-opt-val' });
    const row = h('button', { class: 'gc-opt', 'data-nav': key }, h('span', { class: 'gc-opt-label' }, label, help ? h('span', { class: 'gc-small' }, help) : null), h('span', { class: 'gc-opt-ctl' }, '‹', val, '›'));
    const paint = () => { val.textContent = values[i][1]; };
    paint();
    const step = (d) => { i = (i + d + values.length) % values.length; paint(); onChange(values[i][0]); };
    // Left/right change the value; up/down still move between rows.
    row.onMove = (dir) => { if (dir === 'left') step(-1); else if (dir === 'right') step(1); else this.navMoveDefault(dir); };
    row.onActivate = () => step(1);
    return row;
  }

  navMoveDefault(dir) {
    const el = this.nav.current;
    const saved = el.onMove;
    el.onMove = null;
    this.nav.move(dir);
    el.onMove = saved;
  }

  setAppearance(pane) {
    pane.append(h('h3', {}, 'Look'), h('p', { class: 'gc-small' }, 'Each look is inspired by a famously easy-to-use console or TV menu. Your choice is kept on this device.'));
    const grid = h('div', { class: 'gc-themes' });
    for (const t of THEME_LIST) {
      const card = h('button', { class: `gc-theme-card ${this.ui.theme === t.id ? 'active' : ''}`, 'data-nav': `theme:${t.id}` },
        h('span', { class: `gc-theme-swatch theme-${t.id}`, style: { background: t.swatch } }, h('span', {}, t.glyph || '')),
        h('span', { class: 'gc-theme-name' }, t.name),
        h('span', { class: 'gc-small' }, t.inspired));
      card.onActivate = () => {
        this.ui.theme = t.id; this.saveUi(); this.applyTheme();
        grid.querySelectorAll('.gc-theme-card').forEach((c) => c.classList.toggle('active', c === card));
        this.render();
        this.nav.restore(`theme:${t.id}`);
      };
      grid.append(card);
    }
    pane.append(grid, h('h3', {}, 'Extras'),
      this.optionRow('opt:sounds', 'Menu sounds', [[false, 'Off'], [true, 'On']], this.ui.sounds, (v) => { this.ui.sounds = v; this.saveUi(); blip('select', v); }),
      this.optionRow('opt:showAll', 'Consoles without games', [[false, 'Hide'], [true, 'Show']], this.ui.showAll, (v) => { this.ui.showAll = v; this.saveUi(); this.buildModel(); this.render(); }));
  }

  setControls(pane, layer, extra) {
    const avail = ORDER.filter((s) => !SYSTEMS[s].unsupported);
    layer.ctlSystem ||= extra.system && avail.includes(extra.system) ? extra.system : (this.model.collections.find((c) => c.system && !SYSTEMS[c.system].unsupported)?.system || 'nes');
    layer.ctlPlayer ||= 0;
    const sys = layer.ctlSystem, player = layer.ctlPlayer;
    const connected = pads();
    const style = padStyle(connected[player]?.id || connected[0]?.id);
    pane.append(h('h3', {}, 'Controllers'),
      h('div', { class: 'gc-pads' }, connected.length ? connected.map((gp, i) => h('div', { class: 'gc-pad' }, h('strong', {}, `Player ${i + 1}`), h('span', { class: 'gc-small' }, gp.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller')))
        : h('div', { class: 'gc-small' }, 'No controller found. Plug one in (USB) or pair it (Bluetooth), then press any button on it. Controllers are assigned to players in the order they’re found.')),
      this.optionRow('ctl:system', 'Console', avail.map((s) => [s, SYSTEMS[s].name]), sys, (v) => { layer.ctlSystem = v; layer.refresh(); this.nav.restore('ctl:system'); }),
      this.optionRow('ctl:player', 'Player', [...Array(PLAYERS).keys()].map((p) => [p, `Player ${p + 1}${p === 0 ? ' (keyboard and controller)' : ' (controller)'}`]), player, (v) => { layer.ctlPlayer = Number(v); layer.refresh(); this.nav.restore('ctl:player'); }),
      h('p', { class: 'gc-small' }, 'Select a box and press the key or controller button you want. Press Y / F on a box to clear it.'));
    const b = bindings(sys, player);
    const table = h('div', { class: 'gc-binds' }, h('div', { class: 'gc-bind head' }, h('span', {}, `${SYSTEMS[sys].short} button`), h('span', {}, 'Keyboard'), h('span', {}, 'Controller')));
    for (const [id, label] of buttonsFor(sys)) {
      const keyBtn = h('button', { class: 'gc-bind-btn', 'data-nav': `bind:k:${id}`, disabled: player !== 0 }, player === 0 ? keyName(b[id].key) : '—');
      const padBtn = h('button', { class: 'gc-bind-btn', 'data-nav': `bind:p:${id}` }, padName(b[id].pad, style));
      keyBtn.onActivate = () => this.capture('key', sys, player, id, label, keyBtn, layer);
      padBtn.onActivate = () => this.capture('pad', sys, player, id, label, padBtn, layer);
      keyBtn.dataset.clear = padBtn.dataset.clear = '1';
      table.append(h('div', { class: `gc-bind ${id >= 24 ? 'hot' : ''}` }, h('span', {}, label), keyBtn, padBtn));
    }
    const reset = this.navBtn(isCustomised(sys) ? `Reset ${SYSTEMS[sys].short} controls to defaults` : 'Using the default controls', () => { resetBindings(sys, player); layer.refresh(); toast('Controls reset', { timeout: 1500 }); }, 'ctl:reset');
    pane.append(table, h('div', { class: 'gc-row' }, reset));
    // Y / F on a binding clears it.
    layer.onFavorite = (el) => {
      const m = /^bind:(k|p):(\d+)$/.exec(el?.dataset.nav || '');
      if (!m) return;
      setBinding(sys, player, Number(m[2]), m[1] === 'k' ? { key: null } : { pad: null });
      layer.refresh(); this.nav.restore(el.dataset.nav);
    };
  }

  async capture(kind, sys, player, id, label, btn, layer) {
    this.capturing = true;
    const ctrl = new AbortController();
    const prompt = h('div', { class: 'gc-capture' }, h('div', { class: 'gc-capture-in' },
      h('div', { class: 'gc-capture-title' }, `${SYSTEMS[sys].short}: ${label}`),
      h('div', {}, kind === 'key' ? 'Press a key…' : `Press a button or push a stick on controller ${player + 1}…`),
      h('div', { class: 'gc-small' }, kind === 'key' ? 'Esc cancels' : 'Esc or wait 8 seconds to cancel')));
    this.root.append(prompt);
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const onEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); ctrl.abort(); } };
    if (kind === 'pad') addEventListener('keydown', onEsc, true);
    let result = null;
    try {
      if (kind === 'key') { const k = await captureKey(ctrl.signal); if (k != null) result = { key: k }; }
      else { const r = await capturePad(ctrl.signal); if (r) result = { pad: r.pad }; }
    } finally {
      clearTimeout(timer);
      removeEventListener('keydown', onEsc, true);
      prompt.remove();
      // Don't let the press that set the binding also act on the menu.
      setTimeout(() => { this.capturing = false; }, 250);
    }
    if (result) { setBinding(sys, player, id, result); blip('select', this.ui.sounds); }
    layer.refresh();
    this.nav.restore(btn.dataset.nav);
  }

  setConsoles(pane, layer, extra) {
    layer.conSystem ||= extra.system || this.model.collections.find((c) => c.system)?.system || 'nes';
    const list = h('div', { class: 'gc-con-list' });
    const detail = h('div', { class: 'gc-con-detail' });
    pane.append(h('div', { class: 'gc-con' }, list, detail));
    const counts = {};
    for (const g of this.model.all) counts[g.system] = (counts[g.system] || 0) + 1;
    for (const s of ORDER) {
      const b = h('button', { class: `gc-con-item ${layer.conSystem === s ? 'active' : ''}`, 'data-nav': `sys:${s}` }, this.sysBadge(s), h('span', { class: 'gc-small' }, `${counts[s] || 0} game${counts[s] === 1 ? '' : 's'}`));
      b.onActivate = () => { layer.conSystem = s; layer.refresh(); requestAnimationFrame(() => this.nav.restore(`sys:${s}`)); };
      list.append(b);
    }
    const sys = layer.conSystem, info = SYSTEMS[sys];
    const cfg = this.lib.systems?.[sys] || {};
    const save = async (values) => {
      try {
        const r = await api('/settings', { method: 'POST', body: JSON.stringify({ system: sys, values }) });
        this.lib.systems = r.systems;
        if ('hidden' in values) layer.dirty = true;
      } catch (err) { toastError(err, 'Could not save'); }
    };
    detail.append(h('h3', {}, info.name), h('div', { class: 'gc-small' }, `${info.maker} · ${info.year}`));
    if (info.unsupported) { detail.append(h('p', { class: 'gc-note' }, info.unsupported)); return; }
    const cores = CORES[sys];
    const em = this.lib.emulator?.systems?.[sys] || [];
    const ready = (c) => em.find((x) => x.core === c)?.ready;
    const biosFiles = (this.lib.bios || []).filter((b) => !b.system || b.system === sys);
    detail.append(
      cores.length > 1 ? this.optionRow('con:core', 'Emulator', cores.map((c) => [c, CORE_NAMES[c] || c]), cfg.core || cores[0], (v) => save({ core: v })) : h('div', { class: 'gc-opt static' }, h('span', { class: 'gc-opt-label' }, 'Emulator'), h('span', {}, CORE_NAMES[cores[0]] || cores[0])),
      this.optionRow('con:shader', 'Screen', SHADERS, cfg.shader || 'disabled', (v) => save({ shader: v }), 'How pixels are drawn — try a CRT look'),
      info.bios || biosFiles.length ? this.optionRow('con:bios', 'BIOS', [['', biosFiles.length ? 'None' : 'None found'], ...biosFiles.map((b) => [b.path, b.name])], cfg.bios || '', (v) => save({ bios: v }),
        info.bios ? 'This console needs one: put it in a “BIOS” folder in your games folder' : 'Optional') : null,
      this.optionRow('con:autosave', 'Save my place when I quit', [[true, 'On'], [false, 'Off']], cfg.autosave !== false, (v) => save({ autosave: v }), 'Lets you pick up exactly where you left off'),
      this.optionRow('con:rewind', 'Rewind', [[false, 'Off'], [true, 'On']], Boolean(cfg.rewind), (v) => save({ rewind: v }), 'Hold the rewind key to go back in time (uses more memory)'),
      this.optionRow('con:ff', 'Fast-forward speed', [['1.5', '1.5×'], ['2.0', '2×'], ['3.0', '3×'], ['4.0', '4×'], ['6.0', '6×'], ['8.0', '8×']], cfg.ffRatio || '3.0', (v) => save({ ffRatio: v })),
      this.optionRow('con:touch', 'On-screen controls', [['auto', 'On touch screens'], [true, 'Always'], [false, 'Never']], cfg.touchControls ?? 'auto', (v) => save({ touchControls: v === 'auto' ? undefined : v }),
        `Move, resize, relabel, recolour and remap them with “Customize on-screen controls”${sys === 'n64' ? ' (including C buttons as four buttons or a stick)' : ''}`),
      this.optionRow('con:bg', 'Background in its section', [['auto', 'Photo of the console'], ['drawn', 'Drawing of the console'], ['custom', 'My picture'], ['none', 'None']], cfg.background || 'auto',
        async (v) => { await save({ background: v }); this.applySysBg(); },
        'Photos are public-domain pictures from Wikimedia Commons, downloaded by the server the first time (a drawing is used offline)'),
      h('div', { class: 'gc-row gc-wrap' },
        filesEnabled() ? this.navBtn('My picture from shared folders…', () => this.setConsolePicture(sys, 'shared', layer), 'con:bgshared') : null,
        this.navBtn('My picture from this device…', () => this.setConsolePicture(sys, 'device', layer), 'con:bgupload'),
        cfg.background === 'custom' ? this.navBtn('Remove my picture', async () => {
          try { this.lib.systems = (await api(`/console-art/${sys}`, { method: 'DELETE' })).systems; this.applySysBg(); layer.refresh(); } catch (err) { toastError(err); }
        }, 'con:bgremove') : null),
      this.optionRow('con:volume', 'Volume', [20, 40, 60, 80, 100].map((v) => [v, `${v}%`]), cfg.volume ?? 80, (v) => save({ volume: Number(v) })),
      this.optionRow('con:hidden', 'Show on the home screen', [[false, 'Yes'], [true, 'No']], Boolean(cfg.hidden), (v) => save({ hidden: v })),
      h('div', { class: 'gc-row' },
        this.navBtn(`Controls for ${info.short}`, () => { layer.ctlSystem = sys; layer.show('controls'); this.nav.restore('ctl:system'); }, 'con:controls'),
        this.navBtn('Customize on-screen controls', () => this.editTouch(sys), 'con:touchedit'),
        this.navBtn(ready(cfg.core || cores[0]) ? 'Emulator downloaded ✓' : 'Download emulator now', async () => {
          const btn = detail.querySelector('[data-nav="con:dl"]');
          btn.textContent = 'Downloading…';
          try { this.lib.emulator = await api('/emulator-install', { method: 'POST', body: JSON.stringify({ system: sys }) }); btn.textContent = 'Emulator downloaded ✓'; }
          catch (err) { btn.textContent = 'Download emulator now'; toastError(err, 'Download failed'); }
        }, 'con:dl')),
      sys === 'psp' ? h('p', { class: 'gc-note' }, 'PSP games open in their own browser tab — their emulator needs a page to itself.') : null,
      ['psx', 'segaSaturn', 'segaCD', 'pce', '3do'].includes(sys) ? h('p', { class: 'gc-small' }, 'Tip: disc games load faster as .chd files (one compressed file per disc). Multi-disc games can use an .m3u playlist.') : null);
  }

  setLibrary(pane) {
    const lib = this.lib;
    const counts = {};
    for (const g of lib.games) counts[g.system] = (counts[g.system] || 0) + 1;
    const em = lib.emulator || {};
    pane.append(h('h3', {}, 'Games folder'),
      h('div', { class: 'gc-opt static' }, h('span', { class: 'gc-opt-label' }, lib.folder || 'Not chosen'), h('span', { class: 'gc-small' }, `${lib.games.length} games`)),
      h('div', { class: 'gc-row' },
        this.navBtn('Look for new games', async () => { toast('Scanning the games folder…', { timeout: 1500 }); await this.load(true); this.openSettings({ tab: 'library' }); }, 'lib:rescan', 'primary'),
        this.navBtn('Change folder (MediaDesk Settings)', () => openApp('settings', { tab: 'console' }), 'lib:folder')),
      h('div', { class: 'gc-counts' }, ORDER.filter((s) => counts[s]).map((s) => h('div', { class: 'gc-count' }, this.sysBadge(s), h('strong', {}, counts[s])))),
      h('h3', {}, 'Emulators'),
      h('p', { class: 'gc-small' }, `The first time you play a console, the MediaDesk server downloads its emulator (EmulatorJS ${em.version || ''}) and keeps it, so later games start quickly and work offline. ${em.bytes ? `Using ${formatBytes(em.bytes)}.` : 'Nothing downloaded yet.'}`),
      h('div', { class: 'gc-row' }, this.navBtn('Remove downloaded emulators', async () => {
        try { this.lib.emulator = await api('/emulator-cache', { method: 'DELETE' }); toast('Emulators removed — they’ll download again when needed'); this.layers.at(-1).refresh(); } catch (err) { toastError(err); }
      }, 'lib:clear')),
      h('h3', {}, 'Saves'),
      h('p', { class: 'gc-small' }, 'Save states, your place when you quit, and in-game (battery) saves are kept on the MediaDesk server, next to its settings — so they’re on every device you play on.'));
  }

  setAbout(pane) {
    pane.append(h('h3', {}, 'The Game Console'),
      h('p', {}, 'Plays games for ', ORDER.filter((s) => !SYSTEMS[s].unsupported).map((s) => SYSTEMS[s].short).join(', '), '.'),
      h('p', { class: 'gc-small' }, 'Emulation by EmulatorJS (GPL-3.0) and the libretro cores it packages, each under its own licence; they’re downloaded to your server from npm, not included with MediaDesk. Cover art comes from the libretro-thumbnails project when your server can reach it. Dreamcast games are listed but can’t be played yet — no Dreamcast emulator runs in a browser today.'),
      h('h3', {}, 'Buttons'),
      h('div', { class: 'gc-help' },
        h('div', {}, h('strong', {}, 'Move'), h('span', {}, 'D-pad, left stick or arrow keys')),
        h('div', {}, h('strong', {}, 'Choose'), h('span', {}, 'A (bottom button) or Enter')),
        h('div', {}, h('strong', {}, 'Back'), h('span', {}, 'B (right button), Esc or Backspace')),
        h('div', {}, h('strong', {}, 'Favorite'), h('span', {}, 'Y (top button) or F')),
        h('div', {}, h('strong', {}, 'Settings'), h('span', {}, 'Start / Menu or M')),
        h('div', {}, h('strong', {}, 'Switch console'), h('span', {}, 'L / R shoulder buttons or [ ]')),
        h('div', {}, h('strong', {}, 'In a game'), h('span', {}, 'Home, or Select + Start, or Esc opens the game menu'))));
  }
}
GameConsole.noArt = new Set();

// Settings layer: Y / F clears a control binding.
const origAction = GameConsole.prototype.action;
GameConsole.prototype.action = function action(a, el, dir) {
  const top = this.layers.at(-1);
  if (a === 'favorite' && top?.onFavorite) { top.onFavorite(el); return; }
  return origAction.call(this, a, el, dir);
};
