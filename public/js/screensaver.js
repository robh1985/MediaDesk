// Screensaver: starts after a period of inactivity, wakes on input, and (optionally) locks
// MediaDesk so the password is needed to get back in. Settings live in Settings → Screensaver.

import { SCREENSAVERS } from './savers.js';
import { state, appPref } from './api.js';

let lastActivity = Date.now();
let active = null;            // { overlay, stop, startedAt, preview }
let lockHandler = null;       // shows the lock screen; supplied by the desktop

const pref = (k) => appPref('screensaver', k);

function markActive() { lastActivity = Date.now(); }

export function initScreensaver({ onLock }) {
  lockHandler = onLock;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) addEventListener(ev, markActive, { passive: true, capture: true });
  let lx = -1, ly = -1;
  addEventListener('pointermove', (e) => {
    // Ignore tiny jitters from a resting mouse.
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 6) { lx = e.clientX; ly = e.clientY; markActive(); }
  }, { passive: true, capture: true });
  setInterval(check, 5000);
}

function videoPlaying() {
  return [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended);
}

function check() {
  if (active || !pref('enabled') || document.querySelector('.lock')) return;
  const timeout = (pref('timeoutMin') || 10) * 60e3;
  if (Date.now() - lastActivity < timeout) return;
  if (pref('skipVideo') !== false && videoPlaying()) { markActive(); return; }
  start();
}

export const passwordAvailable = () => Boolean(state.config?.auth);

// Start a screensaver now. `preview` never locks.
export function start({ id = pref('saver') || 'toasters', preview = false } = {}) {
  if (active) return;
  const list = SCREENSAVERS;
  const saver = id === 'random' ? list[Math.floor(Math.random() * list.length)] : list.find((s) => s.id === id) || list[0];
  const lock = !preview && pref('requirePassword') && passwordAvailable();
  const overlay = document.createElement('div');
  overlay.className = 'ss-overlay';
  overlay.dataset.saver = saver.id;
  document.body.append(overlay);
  document.documentElement.classList.add('ss-on');
  let stop = () => {};
  try { stop = saver.start(overlay, { text: pref('text') }); } catch (err) { console.error(err); }
  active = { overlay, stop, startedAt: Date.now(), lock, saver: saver.id };
  if (lock) {
    // Lock on the server too, so a new tab can't get around it.
    state.locked = true;
    fetch('/portal/lock', { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1' } }).catch(() => {});
  }
  // Wake on the next real input, after a moment so the gesture that started a preview doesn't end it.
  const wake = (e) => {
    if (!active || Date.now() - active.startedAt < 700) return;
    if (e.type === 'pointermove' && Math.hypot(e.movementX || 0, e.movementY || 0) < 3) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    stopSaver();
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) overlay.addEventListener(ev, wake, { capture: true });
  overlay.tabIndex = -1;
  overlay.addEventListener('keydown', wake, { capture: true });
  document.addEventListener('keydown', active.keyWake = wake, { capture: true });
  overlay.focus({ preventScroll: true });
}

export function stopSaver() {
  if (!active) return;
  const { overlay, stop, lock, keyWake } = active;
  document.removeEventListener('keydown', keyWake, { capture: true });
  try { stop(); } catch { /* ignore */ }
  overlay.classList.add('leaving');
  setTimeout(() => overlay.remove(), 250);
  document.documentElement.classList.remove('ss-on');
  active = null;
  markActive();
  if (lock) lockHandler?.();
}

// Lock right away (menu → Lock screen).
export function lockNow() {
  if (!passwordAvailable()) return false;
  state.locked = true;
  fetch('/portal/lock', { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1' } }).catch(() => {});
  lockHandler?.();
  return true;
}

export const isRunning = () => Boolean(active);
