// The Game Console's player page (console-player.html): runs one game in EmulatorJS with this
// browser's controller mappings and the console's settings, keeps battery saves and save
// states on the MediaDesk server, and adds a console-style pause menu (Esc, or the Home /
// Select+Start buttons on a controller).

import { SYSTEMS, CORES, buttonsFor, keyName, padName, padStyle, findDcBios } from './systems.js';
import { emulatorControls, bindings, pads } from './controls.js';
import { Nav, blip } from './input.js';
import { TouchPad, loadLayout, openEditor } from './touchpad.js';

const EJS_VERSION = '4.2.3';
const params = new URLSearchParams(location.search);
const gameId = params.get('id') || '';
const embedded = window.parent !== window;
const overlay = document.getElementById('overlay');
const ui = (() => { try { return JSON.parse(localStorage.getItem('mediadesk.console.ui')) || {}; } catch { return {}; } })();
const accent = /^#[0-9a-f]{6}$/i.test(params.get('accent') || '') ? params.get('accent') : '#e5a00d';
document.documentElement.style.setProperty('--accent', accent);

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const api = async (url, opts = {}) => {
  const res = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'X-MediaDesk': '1', ...(opts.headers || {}) } });
  if (!res.ok) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* not JSON */ } throw Object.assign(new Error(msg), { status: res.status }); }
  return res;
};
const fileUrl = (rel) => `/portal/games/file/${rel.split('/').map(encodeURIComponent).join('/')}`;
const toast = (text) => {
  const t = h('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 1800);
  setTimeout(() => t.remove(), 2300);
};
const post = (msg) => { if (embedded) window.parent.postMessage({ source: 'mediadesk-console', ...msg }, location.origin); };

let game, system, sys, settings, emu, startedAt = 0, menuOpen = false, nav, lastBatteryHash = '';
let pad = null, padWanted = false, padIdle = false;

function fail(title, detail) {
  overlay.className = 'show';
  overlay.replaceChildren(h('div', { class: 'panel message' },
    h('h2', {}, title), detail ? h('p', {}, detail) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', 'data-nav': 'quit', onclick: quit }, embedded ? 'Back to games' : 'Close'))));
  nav ||= new Nav(overlay, { onAction: menuAction, isActive: () => true });
  nav.restore('quit');
  post({ type: 'console-error', message: title });
}

async function start() {
  // ?layout=<console>: just the on-screen controls editor, over a stand-in game screen.
  const layoutOnly = params.get('layout');
  if (layoutOnly && SYSTEMS[layoutOnly]) {
    document.title = `${SYSTEMS[layoutOnly].short} on-screen controls — The Game Console`;
    openEditor({ system: layoutOnly, accent, preview: true, onDone: () => { if (embedded) post({ type: 'console-exit' }); else window.close(); } });
    return;
  }
  let lib;
  try { lib = await (await api('/portal/games/library')).json(); } catch (err) { return fail('Couldn’t load your games', err.message); }
  game = lib.games.find((g) => g.id === gameId);
  if (!game) return fail('Game not found', 'It may have been moved or deleted from the games folder.');
  system = game.system;
  sys = SYSTEMS[system];
  settings = lib.systems?.[system] || {};
  document.title = `${game.title} — The Game Console`;
  if (game.sample) return fail(game.title, 'This is a sample entry in demo mode. Add your own games to the games folder to play them.');
  if (sys?.unsupported) return fail(`${sys.name} games can’t be played yet`, sys.unsupported);
  const core = CORES[system].includes(settings.core) ? settings.core : CORES[system][0];
  if (sys.threads && !crossOriginIsolated) {
    if (embedded) { post({ type: 'console-needs-tab' }); return fail(`${sys.short} games open in their own tab`, 'Its emulator needs a page of its own. Use “Open in a new tab”.'); }
  }

  // Battery save and the state to resume from, fetched before the game starts.
  const [battery, resume] = await Promise.all([
    api(`/portal/games/saves/${gameId}/battery`).then((r) => r.arrayBuffer()).catch(() => null),
    params.get('resume') ? api(`/portal/games/saves/${gameId}/state/${params.get('resume')}`).then((r) => r.arrayBuffer()).catch(() => null) : null,
  ]);

  const bios = settings.bios && lib.bios.some((b) => b.path === settings.bios) ? settings.bios : null;
  const dreamcast = system === 'dreamcast';
  if (sys.webgl2 && !document.createElement('canvas').getContext('webgl2')) {
    return fail(`${sys.short} games need WebGL 2`, 'This browser or its graphics driver doesn’t offer WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari, with hardware acceleration on.');
  }
  if (dreamcast) {
    const dcBios = findDcBios(lib.bios);
    if (!dcBios.boot || !dcBios.flash) {
      return fail('Dreamcast games need the Dreamcast BIOS', 'Put your own dc_boot.bin and dc_flash.bin (copied from your Dreamcast) in a “BIOS” folder in your games folder, then try again.');
    }
    prepareDreamcast(dcBios, battery);
  }
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: core,
    EJS_gameUrl: fileUrl(game.path),
    EJS_gameName: game.base,
    EJS_pathtodata: `/portal/games/emulator/${EJS_VERSION}/data/`,
    EJS_biosUrl: bios && !dreamcast ? fileUrl(bios) : '',
    EJS_externalFiles: game.parts?.length ? Object.fromEntries(game.parts.map((p) => [`/${p.split('/').pop()}`, fileUrl(p)])) : undefined,
    EJS_startOnLoaded: true,
    EJS_defaultControls: emulatorControls(system),
    // EmulatorJS picks layouts and labels by console; given only a core shared by several
    // consoles (Genesis Plus GX), it would use the first one's (the Master System's).
    EJS_controlScheme: system,
    EJS_disableLocalStorage: true,
    EJS_language: 'en-US',
    EJS_disableAutoLang: false,
    EJS_color: accent,
    EJS_backgroundColor: '#000',
    EJS_volume: (settings.volume ?? 80) / 100,
    EJS_threads: Boolean(sys.threads && crossOriginIsolated),
    EJS_defaultOptions: {
      shader: settings.shader || 'disabled',
      rewindEnabled: settings.rewind ? 'enabled' : 'disabled',
      'ff-ratio': settings.ffRatio || '3.0',
      // MediaDesk draws its own on-screen controls (see touchpad.js).
      'virtual-gamepad': 'disabled',
      ...(dreamcast ? flycastOptions() : {}),
    },
    // MediaDesk's pause menu does saving, loading, controls and quitting.
    EJS_Buttons: { saveState: false, loadState: false, gamepad: false, cheat: false, cacheManager: false, saveSavFiles: false, loadSavFiles: false, exitEmulation: false, netplay: false, screenRecord: false, settings: false, quickSave: false, quickLoad: false, restart: false, fullscreen: false, screenshot: false, contextMenu: false, diskButton: true },
    EJS_ready: () => post({ type: 'console-ready' }),
    EJS_onGameStart: () => {
      emu = window.EJS_emulator;
      startedAt = Date.now();
      const gm = emu.gameManager;
      if (battery?.byteLength && !dreamcast) {
        try {
          const p = gm.getSaveFilePath();
          gm.FS.writeFile(p, new Uint8Array(battery));
          gm.loadSaveFiles();
          lastBatteryHash = quickHash(new Uint8Array(battery));
        } catch { /* this game has no battery save */ }
      }
      if (resume?.byteLength) {
        setTimeout(() => { try { gm.loadState(new Uint8Array(resume)); toast('Continuing where you left off'); } catch { toast('Couldn’t load the saved state'); } }, 300);
      }
      api('/portal/games/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: gameId, start: true }) }).catch(() => {});
      post({ type: 'console-started' });
      assignPads();
      // Touch screens have no Esc or Home button: give them one for the game menu.
      const touchScreen = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
      if (touchScreen) {
        document.body.append(h('button', { class: 'menu-btn', 'aria-label': 'Game menu', onclick: openMenu }, 'Menu'));
      }
      startPad(touchScreen);
      addEventListener('gamepadconnected', () => setTimeout(assignPads, 100));
      setInterval(assignPads, 2000);
      hint();
      setInterval(syncBattery, 30e3);
    },
  });
  const s = document.createElement('script');
  s.src = `/portal/games/emulator/${EJS_VERSION}/data/loader.js`;
  s.onerror = () => fail('Couldn’t load the emulator', 'The MediaDesk server downloads emulators the first time each console is played. Check its internet connection.');
  document.body.append(s);
  watchPads();
}

// EmulatorJS gives a controller to a player when it sees it connect; one that was already
// plugged in when the game started can be missed. Give each unassigned controller a free player.
function assignPads() {
  const sel = emu?.gamepadSelection;
  const list = emu?.gamepad?.gamepads;
  if (!Array.isArray(sel) || !Array.isArray(list)) return;
  for (const gp of list) {
    const key = `${gp.id}_${gp.index}`;
    if (sel.includes(key)) continue;
    const free = sel.indexOf('');
    if (free < 0) break;
    sel[free] = key;
  }
}

function hint() {
  const padNow = pads()[0];
  const touchOnly = !padNow && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  const t = h('div', { class: 'hint' }, padNow ? 'Press Home (or Select + Start) for the menu' : touchOnly ? 'Tap Menu for the game menu' : 'Press Esc for the menu');
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4200);
}

// ---- On-screen controls ----

function startPad(touchScreen) {
  padWanted = settings.touchControls === true || (settings.touchControls !== false && touchScreen);
  if (!padWanted) return;
  pad = new TouchPad({ system, layout: loadLayout(system), send: (id, value) => emu?.gameManager?.simulateInput(0, id, value) });
  // Put away while a game controller is in use; back as soon as the screen is touched.
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && padIdle) { padIdle = false; showPad(); } }, true);
  showPad();
}
function showPad() {
  const on = Boolean(pad) && padWanted && !menuOpen && !padIdle;
  pad?.show(on);
  // EmulatorJS's own bar (pause, volume) would sit under the buttons; the game menu covers it.
  document.body.classList.toggle('tp-on', on);
}
function padInUse() {
  if (!pad || padIdle || pad.layout.hideWithPad === false) return;
  padIdle = true;
  showPad();
}

// ---- Saves ----

const quickHash = (u8) => { let x = 2166136261 >>> 0; for (let i = 0; i < u8.length; i += 7) x = Math.imul(x ^ u8[i], 16777619) >>> 0; return `${u8.length}:${x}`; };

async function syncBattery() {
  try {
    const data = system === 'dreamcast' ? readVmu() : emu?.gameManager?.getSaveFile();
    if (!data?.length) return;
    const hash = quickHash(data);
    if (hash === lastBatteryHash) return;
    await api(`/portal/games/saves/${gameId}/battery`, { method: 'PUT', body: data });
    lastBatteryHash = hash;
  } catch { /* try again next time */ }
}

async function saveState(slot) {
  const gm = emu?.gameManager;
  if (!gm) return;
  try {
    const state = gm.getState().slice();
    // The picture was taken as the menu opened (the emulator only draws one while running).
    const shot = menuShot ? await menuShot : null;
    await api(`/portal/games/saves/${gameId}/state/${slot}`, { method: 'PUT', body: state });
    if (shot) await api(`/portal/games/saves/${gameId}/shot/${slot}`, { method: 'PUT', body: shot }).catch(() => {});
    return true;
  } catch (err) { toast(`Couldn’t save: ${err.message}`); return false; }
}

async function loadState(slot) {
  try {
    const buf = await (await api(`/portal/games/saves/${gameId}/state/${slot}`)).arrayBuffer();
    emu.gameManager.loadState(new Uint8Array(buf));
    return true;
  } catch (err) { toast(err.status === 404 ? 'Nothing saved in that slot' : `Couldn’t load: ${err.message}`); return false; }
}

// ---- Menu ----

function watchPads() {
  let was = false;
  const tick = () => {
    requestAnimationFrame(tick);
    if (menuOpen) { was = true; return; }
    const list = pads();
    if (pad && !padIdle && list.some((gp) => gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > 0.5))) padInUse();
    const press = list.some((gp) => gp.buttons[16]?.pressed || (gp.buttons[8]?.pressed && gp.buttons[9]?.pressed));
    if (press && !was) openMenu();
    was = press;
  };
  requestAnimationFrame(tick);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menuOpen && emu && !document.fullscreenElement) { e.preventDefault(); openMenu(); }
}, true);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !menuOpen && emu) { /* Esc left full screen */ } });

function menuAction(action, el, dir) {
  if (action === 'focus' || action === 'moved') blip('move', ui.sounds);
  if (action === 'move' || action === 'focus' || action === 'hover' || action === 'moved' || action === 'edge') return false;
  if (action === 'select' && el) { blip('select', ui.sounds); el.click?.(); return true; }
  if (action === 'back' || action === 'menu') { blip('back', ui.sounds); if (overlay.querySelector('.panel.sub')) showMain(); else if (emu) closeMenu(); return true; }
  return false;
}

let menuShot = null;
function openMenu() {
  if (!emu || menuOpen) return;
  menuOpen = true;
  const gm = emu.gameManager;
  menuShot = Promise.race([gm.screenshot().then((png) => png.slice()), new Promise((r) => setTimeout(() => r(null), 800))]).catch(() => null);
  menuShot.finally(() => { if (menuOpen) emu.pause?.(); });
  syncBattery();
  showPad();
  overlay.className = 'show';
  nav ||= new Nav(overlay, { onAction: menuAction, isActive: () => menuOpen || !emu });
  showMain();
  post({ type: 'console-menu', open: true });
}

function closeMenu() {
  menuOpen = false;
  menuShot = null;
  overlay.className = '';
  overlay.replaceChildren();
  showPad();
  // Let go of the button that closed the menu before the game sees controller input again.
  setTimeout(() => { emu?.play?.(); document.querySelector('#game')?.focus?.(); }, 180);
  post({ type: 'console-menu', open: false });
}

const item = (key, label, sub, onclick, cls = '') => h('button', { class: `item ${cls}`, 'data-nav': key, onclick }, h('span', { class: 'label' }, label), sub ? h('span', { class: 'sub' }, sub) : null);

function showMain(focus = 'resume') {
  const played = Math.round((Date.now() - startedAt) / 60000);
  overlay.replaceChildren(h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Game menu' },
    h('div', { class: 'head' }, h('div', { class: 'title' }, game.title), h('div', { class: 'sub' }, `${sys.short}${played ? ` · playing for ${played} min` : ''}`)),
    h('div', { class: 'items' },
      item('resume', 'Resume', null, closeMenu, 'primary'),
      item('save', 'Save state', 'Pick a slot', () => showSlots('save')),
      item('load', 'Load state', 'Go back to a save', () => showSlots('load')),
      item('restart', 'Restart', 'From the beginning (unsaved progress is lost)', () => { emu.gameManager.restart(); closeMenu(); toast('Restarted'); }),
      emu.gameManager.getDiskCount?.() > 1 ? item('disc', 'Change disc', `Disc ${emu.gameManager.getCurrentDisk() + 1} of ${emu.gameManager.getDiskCount()}`, () => {
        const n = (emu.gameManager.getCurrentDisk() + 1) % emu.gameManager.getDiskCount();
        emu.gameManager.setCurrentDisk(n); toast(`Disc ${n + 1} inserted`); showMain('disc');
      }) : null,
      item('full', document.fullscreenElement ? 'Leave full screen' : 'Full screen', null, () => { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); setTimeout(() => showMain('full'), 200); }),
      item('controls', 'Controls', 'What each button does', showControls),
      item('touch', 'On-screen controls', 'Move, resize, relabel, recolour and remap them', editTouch),
      item('quit', 'Quit game', settings.autosave === false ? 'Battery saves are kept' : 'Saves your place automatically', quit, 'danger'))));
  nav.restore(focus);
}

async function showSlots(mode) {
  let list = { states: [] };
  try { list = await (await api(`/portal/games/saves/${gameId}`)).json(); } catch { /* none yet */ }
  const bySlot = Object.fromEntries(list.states.map((s) => [s.slot, s]));
  const slots = mode === 'load' ? ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const card = (slot) => {
    const st = bySlot[slot];
    const when = st ? new Date(st.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Empty';
    return h('button', { class: `slot ${st ? '' : 'empty'}`, 'data-nav': `slot-${slot}`, disabled: mode === 'load' && !st, onclick: async () => {
      if (mode === 'save') { if (await saveState(slot)) { toast(`Saved to slot ${slot}`); closeMenu(); } }
      else if (await loadState(slot)) { toast(slot === 'auto' ? 'Loaded your last session' : `Loaded slot ${slot}`); closeMenu(); }
    } },
    h('div', { class: 'shot' }, st?.shot ? h('img', { src: `/portal/games/saves/${gameId}/shot/${slot}?t=${st.at}`, alt: '' }) : h('span', {}, slot === 'auto' ? 'A' : slot)),
    h('div', { class: 'slot-name' }, slot === 'auto' ? 'Last session' : `Slot ${slot}`),
    h('div', { class: 'slot-when' }, when));
  };
  overlay.replaceChildren(h('div', { class: 'panel sub wide' },
    h('div', { class: 'head' }, h('div', { class: 'title' }, mode === 'save' ? 'Save state' : 'Load state'), h('div', { class: 'sub' }, 'Saved on the MediaDesk server, so they’re on all your devices')),
    h('div', { class: 'slots' }, slots.map(card)),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'data-nav': 'back', onclick: () => showMain(mode) }, 'Back'))));
  const firstEmpty = slots.find((s) => !bySlot[s]);
  const newest = list.states.find((s) => slots.includes(s.slot));
  nav.restore(mode === 'save' ? `slot-${firstEmpty || '1'}` : newest ? `slot-${newest.slot}` : 'back');
}

function showControls() {
  const b = bindings(system, 0);
  const style = padStyle(pads()[0]?.id);
  overlay.replaceChildren(h('div', { class: 'panel sub wide' },
    h('div', { class: 'head' }, h('div', { class: 'title' }, `${sys.short} controls`), h('div', { class: 'sub' }, 'Change them in The Game Console → Settings → Controls')),
    h('div', { class: 'controls' }, h('div', { class: 'ctl head' }, h('span', {}, 'Button'), h('span', {}, 'Keyboard'), h('span', {}, 'Controller')),
      buttonsFor(system).map(([id, label]) => h('div', { class: 'ctl' }, h('span', {}, label), h('span', {}, keyName(b[id]?.key)), h('span', {}, padName(b[id]?.pad, style))))),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'data-nav': 'back', onclick: () => showMain('controls') }, 'Back'))));
  nav.restore('back');
}

// The editor opens over the paused game; the menu comes back when it's done.
function editTouch() {
  overlay.className = '';
  overlay.replaceChildren();
  pad?.show(false);
  openEditor({ system, accent, onDone: (layout) => {
    if (pad) pad.setLayout(layout);
    else if (layout) { padWanted = true; pad = new TouchPad({ system, layout, send: (id, value) => emu?.gameManager?.simulateInput(0, id, value) }); }
    overlay.className = 'show';
    showMain('touch');
    showPad();
  } });
}

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  if (emu) {
    overlay.replaceChildren(h('div', { class: 'panel message' }, h('div', { class: 'spinner' }), h('p', {}, 'Saving…')));
    await syncBattery();
    // Quitting without the menu (the window is closing): take the picture now.
    if (!menuOpen) menuShot = Promise.race([emu.gameManager.screenshot().then((png) => png.slice()), new Promise((r) => setTimeout(() => r(null), 800))]).catch(() => null);
    if (settings.autosave !== false && emu.gameManager?.supportsStates?.()) await saveState('auto');
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    await api('/portal/games/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ played: gameId, seconds }) }).catch(() => {});
    try { emu.pause?.(); } catch { /* gone */ }
  }
  if (embedded) post({ type: 'console-exit' });
  else { window.close(); overlay.replaceChildren(h('div', { class: 'panel message' }, h('h2', {}, 'Saved'), h('p', {}, 'You can close this tab.'))); }
}

// The window around us asks us to wrap up (e.g. it's being closed).
addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.source !== 'mediadesk-console-host') return;
  if (e.data.type === 'quit') { if (params.get('layout')) post({ type: 'console-exit' }); else quit(); }
  if (e.data.type === 'menu') openMenu();
});
addEventListener('pagehide', () => { syncBattery(); });

start();

// ---- Dreamcast (Flycast) ----

// Flycast's settings for the browser, as flycast-wasm recommends them. Its built-in BIOS
// ("HLE") doesn't work in this build, so the Dreamcast's own BIOS is always used.
function flycastOptions() {
  return {
    reicast_boot_to_bios: 'disabled',
    reicast_hle_bios: 'disabled',
    reicast_threaded_rendering: 'disabled',
    reicast_synchronous_rendering: 'disabled',
    reicast_internal_resolution: '640x480',
    reicast_mipmapping: 'disabled',
    reicast_anisotropic_filtering: '1',
    reicast_texupscale: 'disabled',
    reicast_enable_rttb: 'disabled',
    reicast_enable_purupuru: 'disabled',
    reicast_alpha_sorting: 'per-strip (fast, least accurate)',
    reicast_delay_frame_swapping: 'disabled',
    reicast_frame_skipping: 'enabled',
    reicast_framerate: 'normal',
  };
}

// The memory card (VMU in slot A1), kept on the server as this game's battery save. Flycast
// looks for it in its data folder; it's put in each place it might look, and read back from
// whichever one the game last wrote.
const VMU_PATHS = ['/dc/vmu_save_A1.bin', '/data/saves/vmu_save_A1.bin', '/data/saves/dc/vmu_save_A1.bin'];
function readVmu() {
  const FS = emu?.gameManager?.FS;
  if (!FS) return null;
  let best = null;
  for (const p of VMU_PATHS) {
    try {
      const st = FS.stat(p);
      if (!best || st.mtime > best.mtime) best = { p, mtime: st.mtime };
    } catch { /* not there */ }
  }
  return best ? FS.readFile(best.p) : null;
}

function prepareDreamcast(dcBios, battery) {
  // flycast-wasm's WebGL 2 fixes, which must be in place before the emulator makes its canvas:
  // report OpenGL ES 3.0 (so Flycast picks its ES shaders), ignore the INVALID_ENUM errors WebGL
  // raises for framebuffer calls that desktop OpenGL allows, and skip texture settings made with
  // no texture bound (which WebGL reports as an error on every frame).
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (!ctx || (type !== 'webgl2' && type !== 'experimental-webgl2') || ctx.__mediadeskFlycast) return ctx;
    ctx.__mediadeskFlycast = true;
    const getParameter = ctx.getParameter.bind(ctx);
    ctx.getParameter = (pname) => (pname === ctx.VERSION ? 'OpenGL ES 3.0 WebGL 2.0' : pname === ctx.SHADING_LANGUAGE_VERSION ? 'OpenGL ES GLSL ES 3.00' : getParameter(pname));
    const getError = ctx.getError.bind(ctx);
    ctx.getError = () => { let e = getError(); while (e === ctx.INVALID_ENUM) e = getError(); return e; };
    const bound = { [ctx.TEXTURE_2D]: ctx.TEXTURE_BINDING_2D, [ctx.TEXTURE_CUBE_MAP]: ctx.TEXTURE_BINDING_CUBE_MAP, [ctx.TEXTURE_3D]: ctx.TEXTURE_BINDING_3D, [ctx.TEXTURE_2D_ARRAY]: ctx.TEXTURE_BINDING_2D_ARRAY };
    for (const fn of ['texParameteri', 'texParameterf']) {
      const orig = ctx[fn].bind(ctx);
      ctx[fn] = (target, pname, param) => { const b = bound[target]; if (b && !getParameter(b)) return undefined; return orig(target, pname, param); };
    }
    return ctx;
  };
  const warn = console.warn;
  console.warn = (...args) => { if (typeof args[0] === 'string' && (args[0].includes('__syscall_mprotect') || args[0].includes('is not a valid value'))) return; warn.apply(console, args); };

  // Just before the game starts: the BIOS files (and memory card) go in Flycast's "dc" folder,
  // and RetroArch is told that its system folder is the top of the file system.
  const files = Promise.all([dcBios.boot, dcBios.flash].map((p) => (p ? api(fileUrl(p)).then((r) => r.arrayBuffer()).catch(() => null) : null)));
  const wait = setInterval(() => {
    const e = window.EJS_emulator;
    if (!e || e.__mediadeskFlycast) return;
    e.__mediadeskFlycast = true;
    clearInterval(wait);
    const startGame = e.startGame;
    e.startGame = async function startWithBios(...args) {
      try {
        const FS = this.gameManager.FS;
        const mk = (d) => { try { if (!FS.analyzePath(d).exists) FS.mkdir(d); } catch { /* there already */ } };
        mk('/dc'); mk('/data'); mk('/data/saves'); mk('/data/saves/dc');
        const [boot, flash] = await files;
        if (boot) FS.writeFile('/dc/dc_boot.bin', new Uint8Array(boot));
        if (flash) FS.writeFile('/dc/dc_flash.bin', new Uint8Array(flash));
        if (battery?.byteLength) {
          for (const p of VMU_PATHS) { try { FS.writeFile(p, new Uint8Array(battery)); } catch { /* folder missing */ } }
          lastBatteryHash = quickHash(new Uint8Array(battery));
        }
        const cfg = '/home/web_user/.config/retroarch/retroarch.cfg';
        const text = new TextDecoder().decode(FS.readFile(cfg));
        if (!text.includes('system_directory')) FS.writeFile(cfg, `${text}system_directory = "/"\n`);
      } catch (err) { console.error('Dreamcast set-up failed', err); }
      return startGame.apply(this, args);
    };
  }, 30);
}
