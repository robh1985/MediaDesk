// Controller mappings for The Game Console, kept in this browser (each device has its own
// keyboard and controllers): only the buttons someone changed are stored; everything else
// uses the defaults in systems.js.

import { buttonsFor, defaultBinding, PAD_BUTTONS } from './systems.js';

const KEY = 'mediadesk.console.controls';
export const PLAYERS = 4;

function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } }

// { id: { key, pad } } for one console and player, defaults filled in.
export function bindings(system, player = 0) {
  const saved = read()[system]?.[player] || {};
  const out = {};
  for (const [id] of buttonsFor(system)) {
    const d = defaultBinding(system, id, player);
    const s = saved[id] || {};
    out[id] = { key: 'key' in s ? s.key : d.key, pad: 'pad' in s ? s.pad : d.pad };
  }
  return out;
}

export function setBinding(system, player, id, change) {
  const all = read();
  const sys = (all[system] ||= {});
  const p = (sys[player] ||= {});
  p[id] = { ...p[id], ...change };
  // One key or button does one thing: take it off any other button for this player.
  for (const [other, b] of Object.entries(bindings(system, player))) {
    if (Number(other) === Number(id)) continue;
    if ('key' in change && change.key != null && b.key === change.key) p[other] = { ...p[other], key: null };
    if ('pad' in change && change.pad != null && b.pad === change.pad) p[other] = { ...p[other], pad: null };
  }
  write(all);
}

export function resetBindings(system, player) {
  const all = read();
  if (player == null) delete all[system]; else if (all[system]) delete all[system][player];
  write(all);
}

export const isCustomised = (system) => Boolean(read()[system] && Object.values(read()[system]).some((p) => Object.keys(p).length));

// EmulatorJS's EJS_defaultControls: { player: { buttonId: { value: keyCode, value2: padButton } } }
export function emulatorControls(system) {
  const out = {};
  for (let p = 0; p < PLAYERS; p++) {
    out[p] = {};
    for (const [id, b] of Object.entries(bindings(system, p))) {
      const v = {};
      if (b.key != null) v.value = b.key;
      if (b.pad != null) v.value2 = b.pad;
      out[p][id] = v;
    }
  }
  return out;
}

// ---- Capturing a new key or button ----

// Resolves with a key code, or null when cancelled (Esc) / timed out.
export function captureKey(signal) {
  return new Promise((resolve) => {
    const done = (v) => { removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return done(null);
      done(e.keyCode);
    };
    addEventListener('keydown', onKey, true);
    signal?.addEventListener('abort', () => done(null));
  });
}

// Resolves with { pad: 'BUTTON_1' | 'LEFT_STICK_X:+1' | <number>, index } once any controller
// button is pressed or a stick is pushed (the state at the start is ignored).
export function capturePad(signal) {
  return new Promise((resolve) => {
    const baseline = new Map();
    for (const gp of pads()) baseline.set(gp.index, { buttons: gp.buttons.map((b) => b.pressed), axes: [...gp.axes] });
    let raf;
    const finish = (v) => { cancelAnimationFrame(raf); resolve(v); };
    const tick = () => {
      for (const gp of pads()) {
        const base = baseline.get(gp.index) || { buttons: [], axes: [] };
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i].pressed && !base.buttons[i]) return finish({ pad: PAD_BUTTONS[i] || i, index: gp.index, id: gp.id });
        }
        for (let a = 0; a < Math.min(4, gp.axes.length); a++) {
          const v = gp.axes[a];
          if (Math.abs(v) > 0.6 && Math.abs(base.axes[a] || 0) < 0.3) {
            return finish({ pad: `${['LEFT_STICK_X', 'LEFT_STICK_Y', 'RIGHT_STICK_X', 'RIGHT_STICK_Y'][a]}:${v > 0 ? '+1' : '-1'}`, index: gp.index, id: gp.id });
          }
        }
        if (!baseline.has(gp.index)) baseline.set(gp.index, { buttons: gp.buttons.map((b) => b.pressed), axes: [...gp.axes] });
      }
      raf = requestAnimationFrame(tick);
    };
    signal?.addEventListener('abort', () => finish(null));
    raf = requestAnimationFrame(tick);
  });
}

export function pads() {
  try { return [...(navigator.getGamepads?.() || [])].filter(Boolean); } catch { return []; }
}
