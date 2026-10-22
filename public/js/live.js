// Background polling shared by the menu bar, widgets, dock badges and apps.

import { nzbget, jellyfin, radarr, sonarr, portal, isConfigured } from './api.js';

const subs = new Set();
export const live = {
  nzb: null,             // last NZBGet status()
  nzbError: null,
  speedHistory: [],      // bytes/s samples, newest last
  sessions: [],          // active Jellyfin sessions with something playing
  health: { radarr: [], sonarr: [] },
  notifications: [],     // recorded by the server, newest first
  unread: {},            // app id -> unread count (shown as a number on the app's icon)
  system: [],            // MediaDesk's own notices, e.g. "MediaDesk was updated"
};
export const subscribe = (fn) => { subs.add(fn); fn(live); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => fn(live));

export const totalUnread = () => Object.values(live.unread).reduce((a, n) => a + n, 0) + live.system.length;

const speedOf = (s) => s.DownloadRate ?? ((s.DownloadRateHi || 0) * 2 ** 32 + (s.DownloadRateLo || 0));

async function pollNzb() {
  if (!isConfigured('nzbget')) return;
  try {
    live.nzb = await nzbget('status');
    live.nzb.speed = speedOf(live.nzb);
    live.nzbError = null;
    live.speedHistory.push(live.nzb.speed);
    if (live.speedHistory.length > 90) live.speedHistory.shift();
  } catch (err) { live.nzbError = err; }
  emit();
}

async function pollSessions() {
  if (!isConfigured('jellyfin')) return;
  try {
    const sessions = await jellyfin.get('Sessions', { activeWithinSeconds: 960 });
    live.sessions = sessions.filter((s) => s.NowPlayingItem);
  } catch { live.sessions = []; }
  emit();
}

async function pollHealth() {
  for (const [svc, api] of [['radarr', radarr], ['sonarr', sonarr]]) {
    if (!isConfigured(svc)) continue;
    try { live.health[svc] = await api.get('health'); } catch { /* ignore */ }
  }
  emit();
}

function applyNotifications(n) {
  live.notifications = n.items;
  live.unread = n.unread;
  emit();
}

export async function refreshNotifications() {
  try { applyNotifications(await portal.notifications()); } catch { /* server restarting */ }
}

// Opening an app clears the number on its icon.
const pendingRead = new Set();
export async function markRead(app) {
  if (!app || pendingRead.has(app)) return;
  if (app === 'system') { live.system = []; emit(); return; }
  if (!live.unread[app]) return;
  pendingRead.add(app);
  live.unread = { ...live.unread, [app]: 0 };
  emit();
  try { applyNotifications(await portal.markRead(app)); } catch { /* ignore */ }
  pendingRead.delete(app);
}
export async function markAllRead() {
  live.system = [];
  try { applyNotifications(await portal.markRead()); } catch { /* ignore */ }
}
export async function clearNotifications() {
  live.system = [];
  try { applyNotifications(await portal.clearNotifications()); } catch { /* ignore */ }
}

export function dismissSystemNotice(id) {
  live.system = live.system.filter((n) => n.id !== id);
  emit();
}

export function addSystemNotice(notice) {
  if (live.system.some((n) => n.id === notice.id)) return;
  live.system = [{ ...notice, at: Date.now() }, ...live.system];
  emit();
}

function every(fn, ms) {
  const run = () => { if (!document.hidden) fn(); };
  run();
  return setInterval(run, ms);
}

export function startLive() {
  every(pollNzb, 2000);
  every(pollSessions, 10000);
  every(pollHealth, 5 * 60000);
  every(refreshNotifications, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifications(); });
}
