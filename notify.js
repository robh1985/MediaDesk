// Background notifications: the server keeps watching the apps (even with no browser open),
// records new events, and the desktop shows how many are unread as a number on each app's icon.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ITEMS = 300;
const EVERY = { nzbget: 20e3, sessions: 30e3, history: 60e3, health: 5 * 60e3 };

function createNotifier({ file, isConfigured, settings, callApi, log = () => {} }) {
  let data = { items: [], cursors: {}, nextId: 1 };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
      } catch (err) { log(`Could not save notifications: ${err.message}`); }
    }, 500);
  };

  // Settings keys that switch each kind of notification on or off.
  const SWITCH = {
    'radarr.health': 'notifyHealth', 'radarr.imported': 'notifyImported', 'radarr.grabbed': 'notifyGrabbed',
    'sonarr.health': 'notifyHealth', 'sonarr.imported': 'notifyImported', 'sonarr.grabbed': 'notifyGrabbed',
    'nzbget.complete': 'notifyComplete', 'nzbget.failed': 'notifyFailed',
    'jellyfin.playback': 'notifyPlayback',
    'plex.playback': 'notifyPlayback', 'plex.added': 'notifyAdded',
  };

  function add(app, kind, { title, body = '', level = 'info', link = null }) {
    const key = SWITCH[`${app}.${kind}`];
    if (key && !settings()[app]?.[key]) return;
    data.items.unshift({ id: data.nextId++, app, kind, title, body, level, link, at: Date.now(), read: false });
    data.items.length = Math.min(data.items.length, MAX_ITEMS);
    save();
  }

  // --- Watchers -----------------------------------------------------------------

  async function watchNzbget() {
    const items = await callApi('nzbget', '', { method: 'POST', body: { method: 'history', params: [false] } });
    const last = data.cursors.nzbget;
    const newest = Math.max(0, ...items.map((i) => i.NZBID));
    if (last !== undefined) {
      for (const it of items.filter((i) => i.NZBID > last).reverse()) {
        const status = String(it.Status);
        if (status.startsWith('DELETED')) continue;
        const ok = status.startsWith('SUCCESS');
        add('nzbget', ok ? 'complete' : 'failed', {
          title: ok ? 'Download finished' : 'Download failed', body: it.Name, level: ok ? 'success' : 'error',
          link: { app: 'nzbget', opts: { tab: 'history' } },
        });
      }
    }
    data.cursors.nzbget = Math.max(last ?? 0, newest);
    save();
  }

  async function watchHealth(svc) {
    const health = await callApi(svc, 'api/v3/health');
    const seen = new Set(data.cursors[`${svc}Health`] || []);
    const current = health.filter((x) => x.type === 'warning' || x.type === 'error');
    for (const x of current) {
      if (!seen.has(x.message)) {
        add(svc, 'health', { title: 'Needs attention', body: x.message, level: x.type === 'error' ? 'error' : 'warning', link: { app: svc, opts: { section: 'system' } } });
      }
    }
    // Forget resolved issues so they're reported again if they come back.
    data.cursors[`${svc}Health`] = current.map((x) => x.message);
    save();
  }

  async function watchHistory(svc) {
    const key = `${svc}History`;
    const since = data.cursors[key];
    const now = new Date().toISOString();
    if (!since) { data.cursors[key] = now; save(); return; }
    const params = new URLSearchParams({ date: since, ...(svc === 'radarr' ? { includeMovie: 'true' } : { includeSeries: 'true', includeEpisode: 'true' }) });
    const events = await callApi(svc, `api/v3/history/since?${params}`);
    const sinceMs = Date.parse(since);
    let latestMs = sinceMs;
    for (const ev of [...events].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
      const at = Date.parse(ev.date);
      if (!(at > sinceMs)) continue;
      latestMs = Math.max(latestMs, at);
      const type = String(ev.eventType);
      const kind = /import/i.test(type) ? 'imported' : /grab/i.test(type) ? 'grabbed' : null;
      if (!kind) continue;
      const quality = ev.quality?.quality?.name ? ` · ${ev.quality.quality.name}` : '';
      if (svc === 'radarr') {
        const m = ev.movie || {};
        add('radarr', kind, {
          title: kind === 'imported' ? 'Movie downloaded' : 'Release grabbed', level: kind === 'imported' ? 'success' : 'info',
          body: `${m.title || ev.sourceTitle}${m.year ? ` (${m.year})` : ''}${quality}`,
          link: { app: 'radarr', opts: ev.movieId ? { itemId: ev.movieId } : {} },
        });
      } else {
        const s = ev.series || {}, e = ev.episode || {};
        const code = e.seasonNumber != null ? ` S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}` : '';
        add('sonarr', kind, {
          title: kind === 'imported' ? 'Episode downloaded' : 'Release grabbed', level: kind === 'imported' ? 'success' : 'info',
          body: `${s.title || ev.sourceTitle}${code}${e.title ? ` · ${e.title}` : ''}${quality}`,
          link: { app: 'sonarr', opts: ev.seriesId ? { itemId: ev.seriesId } : {} },
        });
      }
    }
    data.cursors[key] = new Date(latestMs).toISOString();
    save();
  }

  async function watchSessions() {
    const sessions = await callApi('jellyfin', 'Sessions?activeWithinSeconds=960');
    const playing = sessions.filter((s) => s.NowPlayingItem);
    const keys = playing.map((s) => `${s.Id}:${s.NowPlayingItem.Id}`);
    const seen = data.cursors.jellyfinPlaying;
    if (seen) {
      for (const s of playing) {
        if (seen.includes(`${s.Id}:${s.NowPlayingItem.Id}`)) continue;
        const it = s.NowPlayingItem;
        add('jellyfin', 'playback', {
          title: `${s.UserName || 'Someone'} started watching`,
          body: `${it.SeriesName ? `${it.SeriesName} — ` : ''}${it.Name} · ${s.DeviceName}`,
          link: { app: 'jellyfin', opts: { section: 'sessions' } },
        });
      }
    }
    data.cursors.jellyfinPlaying = keys;
    save();
  }

  async function watchPlexSessions() {
    const mc = (await callApi('plex', 'status/sessions'))?.MediaContainer || {};
    const playing = mc.Metadata || [];
    const keys = playing.map((s) => `${s.Session?.id || s.sessionKey}:${s.ratingKey}`);
    const seen = data.cursors.plexPlaying;
    if (seen) {
      for (const s of playing) {
        if (seen.includes(`${s.Session?.id || s.sessionKey}:${s.ratingKey}`)) continue;
        add('plex', 'playback', {
          title: `${s.User?.title || 'Someone'} started watching`,
          body: `${s.grandparentTitle ? `${s.grandparentTitle} — ` : ''}${s.title} · ${s.Player?.title || s.Player?.product || ''}`,
          link: { app: 'plex', opts: { section: 'sessions' } },
        });
      }
    }
    data.cursors.plexPlaying = keys;
    save();
  }

  async function watchPlexAdded() {
    const mc = (await callApi('plex', 'library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=40'))?.MediaContainer || {};
    const list = mc.Metadata || [];
    const newest = Math.max(0, ...list.map((m) => Number(m.addedAt) || 0));
    const last = data.cursors.plexAdded;
    if (last !== undefined) {
      for (const m of list.filter((x) => Number(x.addedAt) > last).reverse()) {
        const name = m.type === 'season' ? `${m.parentTitle} — ${m.title}` : m.type === 'episode' ? `${m.grandparentTitle} — ${m.title}` : m.type === 'album' ? `${m.parentTitle} — ${m.title}` : `${m.title}${m.year ? ` (${m.year})` : ''}`;
        add('plex', 'added', {
          title: `Added to ${m.librarySectionTitle || 'Plex'}`, body: name, level: 'success',
          link: { app: 'plexviewer', opts: { ratingKey: m.type === 'season' ? m.parentRatingKey || m.ratingKey : m.ratingKey } },
        });
      }
    }
    data.cursors.plexAdded = Math.max(last ?? 0, newest);
    save();
  }

  // --- Scheduling ---------------------------------------------------------------

  const running = new Set();
  function every(name, ms, fn, when) {
    const tick = async () => {
      if (when() && !running.has(name)) {
        running.add(name);
        try { await fn(); } catch (err) { log(`Notification check "${name}" failed: ${err.message}`); }
        running.delete(name);
      }
    };
    setTimeout(tick, 3000).unref();
    setInterval(tick, ms).unref();
  }

  function start() {
    every('nzbget', EVERY.nzbget, watchNzbget, () => isConfigured('nzbget'));
    every('jellyfin', EVERY.sessions, watchSessions, () => isConfigured('jellyfin'));
    every('plex', EVERY.sessions, watchPlexSessions, () => isConfigured('plex'));
    every('plex-added', EVERY.history, watchPlexAdded, () => isConfigured('plex'));
    for (const svc of ['radarr', 'sonarr']) {
      every(`${svc}-health`, EVERY.health, () => watchHealth(svc), () => isConfigured(svc));
      every(`${svc}-history`, EVERY.history, () => watchHistory(svc), () => isConfigured(svc));
    }
  }

  // --- API for the browser ------------------------------------------------------

  function summary() {
    const unread = {};
    for (const it of data.items) if (!it.read) unread[it.app] = (unread[it.app] || 0) + 1;
    return { items: data.items.slice(0, 100), unread };
  }
  function markRead(app) {
    for (const it of data.items) if (!app || it.app === app) it.read = true;
    save();
  }
  function clear(app) {
    data.items = app ? data.items.filter((it) => it.app !== app) : [];
    save();
  }

  return { start, add, summary, markRead, clear };
}

module.exports = { createNotifier };
