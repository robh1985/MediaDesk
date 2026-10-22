// Overview: everything at a glance, pulled from all four services.

import { h, clear, formatBytes, formatSpeed, formatDuration, spinner, emptyState, progressBar, poll } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { radarr, sonarr, nzbget, jellyfin, jellyfinUserId, isConfigured } from '../api.js';
import { live, subscribe } from '../live.js';
import { upcoming, calendarList } from './arr.js';
import { itemImage } from './jellyfin.js';
import { openApp } from '../wm.js';

const MB = 1024 * 1024;

export const dashboardApp = {
  id: 'dashboard', name: 'Overview', icon: appIcon.dashboard, size: [1180, 760], description: 'Everything at a glance',
  open(win) {
    const tiles = h('div', { class: 'dash-tiles' });
    const upcomingBox = h('div', {}, spinner());
    const downloadsBox = h('div', {}, spinner());
    const playingBox = h('div', {});
    const recentBox = h('div', {}, spinner());
    const healthBox = h('div', {});

    const panel = (title, app, body, opts = {}) => h('section', { class: `dash-panel ${opts.class || ''}` },
      h('header', {}, h('span', { class: 'dash-panel-icon', html: appIcon[app] }), h('h3', {}, title),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openApp(app, opts.open || {}) }, 'Open', h('span', { html: icon.external }))),
      body);

    win.body.append(h('div', { class: 'dash' },
      h('div', { class: 'dash-greeting' }, h('h1', {}, greeting()), h('div', { class: 'muted' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))),
      tiles, healthBox,
      h('div', { class: 'dash-grid' },
        panel('Coming up this week', 'sonarr', upcomingBox, { class: 'span-2', open: { section: 'calendar' } }),
        panel('Downloading', 'nzbget', downloadsBox),
        panel('Now playing', 'jellyfin', playingBox, { open: { section: 'sessions' } }),
        panel('Recently added', 'jellyfin', recentBox, { class: 'span-2', open: { section: 'home' } }))));

    // Stat tiles
    const tile = (app, label, value, sub) => h('button', { class: 'dash-tile', onclick: () => openApp(app) },
      h('div', { class: 'dash-tile-icon', html: appIcon[app] }),
      h('div', {}, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-sub' }, sub)));
    const counts = { movies: null, series: null };
    const drawTiles = () => {
      const s = live.nzb;
      clear(tiles,
        isConfigured('radarr') ? tile('radarr', 'Movies', counts.movies ? counts.movies.total : '…', counts.movies ? `${counts.movies.missing} missing · ${formatBytes(counts.movies.size)}` : '') : null,
        isConfigured('sonarr') ? tile('sonarr', 'Series', counts.series ? counts.series.total : '…', counts.series ? `${counts.series.episodes} episodes · ${formatBytes(counts.series.size)}` : '') : null,
        isConfigured('nzbget') ? tile('nzbget', 'Download speed', s ? (s.DownloadPaused ? 'Paused' : formatSpeed(s.speed)) : '…', s ? `${formatBytes(s.RemainingSizeMB * MB)} left · ${formatBytes(s.FreeDiskSpaceMB * MB)} free` : '') : null,
        isConfigured('jellyfin') ? tile('jellyfin', 'Streams', live.sessions.length, live.sessions.length ? live.sessions.map((x) => x.UserName).join(', ') : 'Nobody watching') : null);
      if (!tiles.children.length) clear(tiles, h('div', { class: 'dash-setup' }, 'No services connected yet. ', h('button', { class: 'btn btn-primary btn-sm', onclick: () => openApp('settings') }, 'Open Settings')));
    };

    if (isConfigured('radarr')) radarr.get('movie').then((m) => {
      counts.movies = { total: m.length, missing: m.filter((x) => x.monitored && !x.hasFile && x.isAvailable).length, size: m.reduce((a, x) => a + (x.sizeOnDisk || 0), 0) };
      drawTiles();
    }).catch(() => {});
    if (isConfigured('sonarr')) sonarr.get('series').then((s) => {
      counts.series = { total: s.length, episodes: s.reduce((a, x) => a + (x.statistics?.episodeFileCount || 0), 0), size: s.reduce((a, x) => a + (x.statistics?.sizeOnDisk || 0), 0) };
      drawTiles();
    }).catch(() => {});

    const unsub = subscribe(() => { drawTiles(); drawPlaying(); drawHealth(); });
    win.on('close', unsub);

    // Upcoming
    Promise.all(['radarr', 'sonarr'].filter(isConfigured).map((k) => upcoming(k, 7).catch(() => []))).then((lists) => {
      const items = lists.flat();
      clear(upcomingBox, items.length ? calendarList(items.slice(0, 40), (it) => openApp(it.kind, { itemId: it.id })) : emptyState('Nothing coming up this week'));
    });

    // Downloads
    const drawDownloads = async () => {
      if (!isConfigured('nzbget')) return clear(downloadsBox, emptyState('NZBGet not connected'));
      const groups = await nzbget('listgroups', 0);
      if (!groups.length) return clear(downloadsBox, emptyState('Queue is empty'));
      const rate = live.nzb?.speed || 0;
      clear(downloadsBox, h('div', { class: 'mini-list' }, groups.slice(0, 6).map((g) => {
        const pct = g.FileSizeMB ? ((g.FileSizeMB - g.RemainingSizeMB) / g.FileSizeMB) * 100 : 0;
        return h('div', { class: 'mini-item' },
          h('div', { class: 'mini-title', title: g.NZBName }, g.NZBName),
          progressBar(pct, g.Status === 'PAUSED' ? 'muted' : 'dl'),
          h('div', { class: 'small muted' }, `${pct.toFixed(0)}% · ${formatBytes(g.FileSizeMB * MB)}${g.Status === 'DOWNLOADING' && rate ? ` · ${formatDuration((g.RemainingSizeMB * MB) / rate)}` : g.Status === 'PAUSED' ? ' · paused' : ''}`));
      }), groups.length > 6 ? h('div', { class: 'small muted' }, `+ ${groups.length - 6} more`) : null));
    };
    const stop = poll(downloadsBox, () => drawDownloads().catch(() => clear(downloadsBox, emptyState('NZBGet unreachable'))), 4000);
    win.on('close', stop);

    function drawPlaying() {
      if (!isConfigured('jellyfin')) return clear(playingBox, emptyState('Jellyfin not connected'));
      if (!live.sessions.length) return clear(playingBox, emptyState('Nobody is watching'));
      clear(playingBox, h('div', { class: 'mini-list' }, live.sessions.map((s) => {
        const it = s.NowPlayingItem;
        const pct = it.RunTimeTicks ? ((s.PlayState?.PositionTicks || 0) / it.RunTimeTicks) * 100 : 0;
        const img = itemImage(it, 120);
        return h('div', { class: 'mini-item mini-media' },
          h('div', { class: 'mini-thumb' }, img ? h('img', { src: img, alt: '' }) : null),
          h('div', { class: 'grow' },
            h('div', { class: 'mini-title' }, it.SeriesName ? `${it.SeriesName} — ${it.Name}` : it.Name),
            h('div', { class: 'small muted' }, `${s.UserName} · ${s.DeviceName}${s.PlayState?.IsPaused ? ' · paused' : ''}`),
            progressBar(pct, 'jf')));
      })));
    }

    function drawHealth() {
      const issues = [...live.health.radarr.map((x) => ['radarr', x]), ...live.health.sonarr.map((x) => ['sonarr', x])].filter(([, x]) => x.type !== 'notice');
      clear(healthBox, issues.length ? h('div', { class: 'health' }, issues.slice(0, 4).map(([svc, x]) => h('button', { class: `health-item health-${x.type}`, onclick: () => openApp(svc, { section: 'system' }) },
        h('span', { class: 'health-app', html: appIcon[svc] }), h('div', {}, x.message)))) : null);
    }

    // Recently added
    if (isConfigured('jellyfin')) {
      (async () => {
        const uid = await jellyfinUserId();
        const latest = await jellyfin.get(`Users/${uid}/Items/Latest`, { Limit: 16 });
        clear(recentBox, latest.length ? h('div', { class: 'shelf-row' }, latest.map((it) => {
          const img = itemImage(it, 300);
          return h('button', { class: 'poster-card', onclick: () => openApp('jellyfin', { itemId: it.Id }) },
            h('div', { class: 'poster' }, img ? h('img', { src: img, loading: 'lazy', alt: '' }) : null, h('div', { class: 'poster-fallback' }, it.SeriesName || it.Name)),
            h('div', { class: 'poster-title' }, it.SeriesName || it.Name));
        })) : emptyState('Nothing new'));
      })().catch(() => clear(recentBox, emptyState('Jellyfin unreachable')));
    } else clear(recentBox, emptyState('Jellyfin not connected'));

    drawTiles(); drawPlaying(); drawHealth();
  },
};

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}
