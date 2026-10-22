// Background polling shared by the menu bar, widgets and apps, plus completion notifications.

import { nzbget, jellyfin, radarr, sonarr, isConfigured } from './api.js';
import { toast } from './ui.js';
import { appIcon } from './icons.js';

const subs = new Set();
export const live = {
  nzb: null,             // last NZBGet status()
  nzbError: null,
  speedHistory: [],      // bytes/s samples, newest last
  sessions: [],          // active Jellyfin sessions with something playing
  health: { radarr: [], sonarr: [] },
};
export const subscribe = (fn) => { subs.add(fn); fn(live); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => fn(live));

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

let lastHistoryId = null;
async function pollNzbHistory() {
  if (!isConfigured('nzbget')) return;
  try {
    const items = await nzbget('history', false);
    const newest = items[0]?.NZBID ?? 0;
    if (lastHistoryId !== null) {
      for (const it of items.filter((i) => i.NZBID > lastHistoryId).slice(0, 5)) {
        const ok = String(it.Status).startsWith('SUCCESS');
        toast(ok ? 'Download complete' : 'Download failed', { body: it.Name, type: ok ? 'success' : 'error', icon: appIcon.nzbget, timeout: 7000 });
      }
    }
    lastHistoryId = Math.max(lastHistoryId ?? 0, newest);
  } catch { /* status poll reports errors */ }
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
    try {
      const health = await api.get('health');
      const fresh = health.filter((x) => x.type === 'error' && !live.health[svc].some((o) => o.message === x.message));
      fresh.forEach((x) => toast(`${svc === 'radarr' ? 'Radarr' : 'Sonarr'} health issue`, { body: x.message, type: 'error', icon: appIcon[svc], timeout: 10000 }));
      live.health[svc] = health;
    } catch { /* ignore */ }
  }
  emit();
}

function every(fn, ms) {
  const run = () => { if (!document.hidden) fn(); };
  run();
  return setInterval(run, ms);
}

export function startLive() {
  every(pollNzb, 2000);
  every(pollNzbHistory, 15000);
  every(pollSessions, 10000);
  every(pollHealth, 5 * 60000);
}
