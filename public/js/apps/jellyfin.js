// Jellyfin: browse libraries, watch active streams, and run server tasks.

import { h, clear, formatDuration, timeAgo, debounce, toast, toastError, confirmDialog,
  spinner, emptyState, errorState, progressBar, badge, sidebarLayout, poll } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { jellyfin, jellyfinUserId, jellyfinImage, serviceLink, isConfigured, appPref } from '../api.js';
import { notConfigured } from './common.js';
import { statCard } from './arr.js';
import { openApp } from '../wm.js';
import { fromJellyfin } from './music-engine.js';

const TICKS = 1e7;
const FIELDS = 'PrimaryImageAspectRatio,ProductionYear,Overview,Genres';

export const jellyfinApp = {
  id: 'jellyfin', name: 'Jellyfin', icon: appIcon.jellyfin, size: [1100, 720], description: 'Media server',
  open(win, opts = {}) {
    if (!isConfigured('jellyfin')) return clear(win.body, notConfigured('Jellyfin', 'jellyfin'));
    const ctx = { win };
    const layout = sidebarLayout([
      { id: 'home', label: 'Home', icon: icon.home, render: (c) => renderHome(c, ctx) },
      { id: 'libraries', label: 'Libraries', icon: icon.library, render: (c) => renderLibraries(c, ctx) },
      { id: 'search', label: 'Search', icon: icon.search, render: (c) => renderSearch(c, ctx) },
      { id: 'sessions', label: 'Now Playing', icon: icon.play, render: (c) => renderSessions(c, ctx) },
      { id: 'server', label: 'Server', icon: icon.server, render: (c) => renderServer(c, ctx) },
    ], { initial: opts.section });
    ctx.layout = layout;
    win.body.append(layout.root);
    if (opts.itemId) openItem({ Id: opts.itemId }, ctx);
    win.on('reopen', (o) => { if (o?.section) layout.show(o.section); if (o?.itemId) openItem({ Id: o.itemId }, ctx); });
  },
};

export function itemImage(item, height = 360) {
  if (item.ImageTags?.Primary) return jellyfinImage(item.Id, { height, tag: item.ImageTags.Primary });
  if (item.SeriesId && item.SeriesPrimaryImageTag) return jellyfinImage(item.SeriesId, { height, tag: item.SeriesPrimaryImageTag });
  if (item.AlbumId && item.AlbumPrimaryImageTag) return jellyfinImage(item.AlbumId, { height, tag: item.AlbumPrimaryImageTag });
  return null;
}

function itemTitle(item) {
  if (item.Type === 'Episode') return item.SeriesName || item.Name;
  return item.Name;
}
function itemSub(item) {
  if (item.Type === 'Episode') return `S${item.ParentIndexNumber ?? '?'}E${item.IndexNumber ?? '?'} · ${item.Name}`;
  if (item.Type === 'Series' && item.ChildCount) return `${item.ProductionYear || ''}${item.ChildCount ? ` · ${item.ChildCount} new` : ''}`;
  if (item.Type === 'MusicAlbum') return item.AlbumArtist || item.ProductionYear || '';
  return item.ProductionYear || '';
}

function mediaCard(item, ctx, { wide = false } = {}) {
  const url = itemImage(item);
  const played = item.UserData?.PlayedPercentage;
  return h('button', { class: `poster-card ${wide ? 'wide' : ''}`, title: item.Name, onclick: () => openItem(item, ctx) },
    h('div', { class: 'poster' },
      url ? h('img', { src: url, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
      h('div', { class: 'poster-fallback' }, itemTitle(item)),
      item.UserData?.Played ? h('span', { class: 'poster-status status-ok' }, h('span', { html: icon.check })) : null,
      played ? progressBar(played, 'poster-progress jf') : null),
    h('div', { class: 'poster-title' }, itemTitle(item)),
    h('div', { class: 'poster-sub' }, itemSub(item)));
}

function shelf(title, items, ctx) {
  if (!items.length) return null;
  return h('section', { class: 'shelf' }, h('h3', { class: 'section-title' }, title),
    h('div', { class: 'shelf-row' }, items.map((i) => mediaCard(i, ctx))));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function renderHome(container, ctx) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Home')), body);
  (async () => {
    const uid = await jellyfinUserId();
    const [resume, nextUp, latest] = await Promise.all([
      jellyfin.get(`Users/${uid}/Items/Resume`, { Limit: 16, Fields: FIELDS, MediaTypes: 'Video' }).catch(() => ({ Items: [] })),
      jellyfin.get('Shows/NextUp', { userId: uid, Limit: 16, Fields: FIELDS }).catch(() => ({ Items: [] })),
      jellyfin.get(`Users/${uid}/Items/Latest`, { Limit: 32, Fields: FIELDS }),
    ]);
    const shelves = [
      appPref('jellyfin', 'rowResume') !== false && shelf('Continue watching', resume.Items || [], ctx),
      appPref('jellyfin', 'rowNextUp') !== false && shelf('Next up', nextUp.Items || [], ctx),
      appPref('jellyfin', 'rowLatest') !== false && shelf('Recently added', latest || [], ctx),
    ].filter(Boolean);
    clear(body, shelves.length ? shelves : emptyState('Nothing here yet', 'Add some media to your libraries.'));
  })().catch((err) => clear(body, errorState(err)));
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

const TYPE_FOR = { movies: 'Movie', tvshows: 'Series', music: 'MusicAlbum', boxsets: 'BoxSet', musicvideos: 'MusicVideo', books: 'Book', homevideos: 'Video,Photo' };

function renderLibraries(container, ctx) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Libraries')), body);
  (async () => {
    const uid = await jellyfinUserId();
    const views = (await jellyfin.get(`Users/${uid}/Views`)).Items || [];
    if (!views.length) return clear(body, emptyState('No libraries'));
    clear(body, h('div', { class: 'library-grid' }, views.map((v) => {
      const img = v.ImageTags?.Primary ? jellyfinImage(v.Id, { height: 300, tag: v.ImageTags.Primary }) : null;
      return h('button', { class: 'library-tile', onclick: () => browse(container, v, ctx) },
        img ? h('img', { src: img, alt: '', loading: 'lazy' }) : null,
        h('span', {}, v.Name));
    })));
  })().catch((err) => clear(body, errorState(err)));
}

function browse(container, view, ctx) {
  clear(container);
  const filter = h('input', { class: 'input', type: 'search', placeholder: `Search ${view.Name}…` });
  const sort = h('select', { class: 'input' },
    [['SortName', 'Name'], ['DateCreated', 'Date added'], ['PremiereDate', 'Release date'], ['CommunityRating', 'Rating']].map(([v, l]) => h('option', { value: v }, l)));
  const count = h('span', { class: 'muted' });
  const grid = h('div', { class: 'poster-grid' });
  const more = h('button', { class: 'btn load-more' }, 'Load more');
  container.append(
    h('div', { class: 'pane-header' },
      h('button', { class: 'btn btn-icon', title: 'Back', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>', onclick: () => ctx.layout.show('libraries') }),
      h('h2', {}, view.Name), count),
    h('div', { class: 'toolbar' }, filter, sort,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => jellyfin.post(`Items/${view.Id}/Refresh`, null, { Recursive: true, MetadataRefreshMode: 'Default', ImageRefreshMode: 'Default' }).then(() => toast(`Scanning ${view.Name}`, { icon: appIcon.jellyfin })).catch(toastError) },
        h('span', { html: icon.refresh }), 'Scan library')),
    grid, more);

  let start = 0, total = 0;
  const load = async (reset) => {
    if (reset) { start = 0; clear(grid, spinner()); }
    more.disabled = true;
    try {
      const uid = await jellyfinUserId();
      const types = TYPE_FOR[view.CollectionType];
      const res = await jellyfin.get(`Users/${uid}/Items`, {
        ParentId: view.Id, Recursive: Boolean(types), IncludeItemTypes: types, SortBy: sort.value + ',SortName',
        SortOrder: sort.value === 'SortName' ? 'Ascending' : 'Descending', StartIndex: start, Limit: 120,
        Fields: FIELDS, searchTerm: filter.value.trim() || undefined, ImageTypeLimit: 1, EnableImageTypes: 'Primary',
      });
      if (reset) clear(grid);
      total = res.TotalRecordCount;
      start += res.Items.length;
      grid.append(...res.Items.map((i) => mediaCard(i, ctx)));
      count.textContent = `${total} items`;
      if (!total) clear(grid, emptyState('No items'));
      more.style.display = start < total ? '' : 'none';
    } catch (err) { clear(grid, errorState(err, () => load(true))); }
    more.disabled = false;
  };
  more.onclick = () => load(false);
  filter.addEventListener('input', debounce(() => load(true), 350));
  sort.addEventListener('change', () => load(true));
  load(true);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchJellyfin(term, limit = 40) {
  const uid = await jellyfinUserId();
  const res = await jellyfin.get(`Users/${uid}/Items`, {
    searchTerm: term, Recursive: true, Limit: limit, Fields: FIELDS,
    IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum,MusicArtist,BoxSet',
  });
  return res.Items || [];
}

function renderSearch(container, ctx) {
  const input = h('input', { class: 'input input-lg', type: 'search', placeholder: 'Search movies, shows, music…' });
  const results = h('div', {}, emptyState('Search your Jellyfin libraries'));
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Search')), h('div', { class: 'toolbar' }, input), results);
  setTimeout(() => input.focus(), 50);
  let seq = 0;
  input.addEventListener('input', debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) return clear(results, emptyState('Search your Jellyfin libraries'));
    const mine = ++seq;
    clear(results, spinner('Searching…'));
    try {
      const items = await searchJellyfin(term);
      if (mine !== seq) return;
      clear(results, items.length ? h('div', { class: 'poster-grid' }, items.map((i) => mediaCard(i, ctx))) : emptyState('No results'));
    } catch (err) { clear(results, errorState(err)); }
  }, 350));
}

// ---------------------------------------------------------------------------
// Item detail
// ---------------------------------------------------------------------------

async function openItem(stub, ctx) {
  const { win } = ctx;
  win.body.querySelector('.sheet')?.remove();
  const inner = h('div', { class: 'sheet-inner' }, spinner());
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const sheet = h('div', { class: 'sheet' }, backdrop, inner);
  const close = () => { sheet.classList.add('leaving'); setTimeout(() => sheet.remove(), 200); };
  win.body.append(sheet);

  try {
    const uid = await jellyfinUserId();
    const item = await jellyfin.get(`Users/${uid}/Items/${stub.Id}`);
    if (item.BackdropImageTags?.length) backdrop.style.backgroundImage = `url("${jellyfinImage(item.Id, { type: 'Backdrop', height: 720, tag: item.BackdropImageTags[0] })}")`;
    const url = itemImage(item, 600);
    const link = serviceLink('jellyfin');
    const data = item.UserData || {};

    const playedBtn = h('button', { class: 'btn' });
    const favBtn = h('button', { class: 'btn' });
    const paint = () => {
      clear(playedBtn, h('span', { html: icon.check }), data.Played ? 'Mark unwatched' : 'Mark watched');
      clear(favBtn, h('span', { html: '<svg viewBox="0 0 24 24" fill="' + (data.IsFavorite ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.9"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>' }), data.IsFavorite ? 'Favourited' : 'Favourite');
    };
    paint();
    playedBtn.onclick = async () => {
      try {
        const r = data.Played ? await jellyfin.del(`Users/${uid}/PlayedItems/${item.Id}`) : await jellyfin.post(`Users/${uid}/PlayedItems/${item.Id}`);
        Object.assign(data, r || { Played: !data.Played }); paint();
      } catch (err) { toastError(err); }
    };
    favBtn.onclick = async () => {
      try {
        const r = data.IsFavorite ? await jellyfin.del(`Users/${uid}/FavoriteItems/${item.Id}`) : await jellyfin.post(`Users/${uid}/FavoriteItems/${item.Id}`);
        Object.assign(data, r || { IsFavorite: !data.IsFavorite }); paint();
      } catch (err) { toastError(err); }
    };

    const facts = [
      ['Type', item.Type],
      item.RunTimeTicks ? ['Runtime', formatDuration(item.RunTimeTicks / TICKS)] : null,
      item.OfficialRating ? ['Rating', item.OfficialRating] : null,
      item.CommunityRating ? ['Community', `★ ${item.CommunityRating.toFixed(1)}`] : null,
      item.Studios?.length ? ['Studio', item.Studios.map((s) => s.Name).join(', ')] : null,
      item.DateCreated ? ['Added', timeAgo(item.DateCreated)] : null,
      item.Path ? ['Path', item.Path] : null,
    ].filter(Boolean);

    clear(inner,
      h('button', { class: 'btn btn-icon sheet-close', title: 'Close', html: icon.x, onclick: close }),
      h('div', { class: 'detail-head' },
        h('div', { class: 'detail-poster' }, url ? h('img', { src: url, alt: '' }) : h('div', { class: 'poster-fallback' }, item.Name)),
        h('div', { class: 'detail-info' },
          h('h2', {}, itemTitle(item)),
          h('div', { class: 'muted' }, [item.Type === 'Episode' ? itemSub(item) : null, item.ProductionYear].filter(Boolean).join(' · ')),
          h('div', { class: 'chips' }, (item.Genres || []).slice(0, 4).map((g) => badge(g))),
          h('p', { class: 'overview' }, item.Overview || 'No overview available.'),
          h('div', { class: 'btn-row' },
            MUSIC_TYPES.has(item.Type) ? [
              h('button', { class: 'btn btn-primary', onclick: () => sendToMusic(item, true) }, h('span', { html: icon.play }), 'Play in Music'),
              h('button', { class: 'btn', onclick: () => sendToMusic(item, false) }, h('span', { html: icon.plus }), 'Add to Music'),
            ] : null,
            link ? h('a', { class: `btn ${MUSIC_TYPES.has(item.Type) ? '' : 'btn-primary'}`, href: `${link}/web/index.html#/details?id=${item.Id}&serverId=${item.ServerId}`, target: '_blank', rel: 'noopener' }, h('span', { html: icon.play }), 'Play in Jellyfin') : null,
            playedBtn, favBtn,
            h('button', { class: 'btn', onclick: () => jellyfin.post(`Items/${item.Id}/Refresh`, null, { MetadataRefreshMode: 'FullRefresh', ImageRefreshMode: 'FullRefresh', ReplaceAllMetadata: false }).then(() => toast('Refreshing metadata', { body: item.Name, icon: appIcon.jellyfin })).catch(toastError) },
              h('span', { html: icon.refresh }), 'Refresh metadata')))),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
  } catch (err) { clear(inner, h('button', { class: 'btn btn-icon sheet-close', html: icon.x, onclick: close }), errorState(err)); }
}

// Albums, songs, artists and playlists can be sent to the Music app.
const MUSIC_TYPES = new Set(['MusicAlbum', 'Audio', 'Playlist', 'MusicArtist']);
async function sendToMusic(item, play) {
  try {
    const uid = await jellyfinUserId();
    const base = { IncludeItemTypes: 'Audio', Recursive: true, Fields: 'MediaSources' };
    let items;
    if (item.Type === 'Audio') items = [item];
    else if (item.Type === 'Playlist') items = (await jellyfin.get(`Playlists/${item.Id}/Items`, { userId: uid, Fields: 'MediaSources' })).Items;
    else if (item.Type === 'MusicArtist') items = (await jellyfin.get(`Users/${uid}/Items`, { ...base, ArtistIds: item.Id, SortBy: 'Album,ParentIndexNumber,IndexNumber' })).Items;
    else items = (await jellyfin.get(`Users/${uid}/Items`, { ...base, ParentId: item.Id, SortBy: 'ParentIndexNumber,IndexNumber,SortName' })).Items
      .sort((a, b) => ((a.ParentIndexNumber || 1) - (b.ParentIndexNumber || 1)) || ((a.IndexNumber || 0) - (b.IndexNumber || 0)));
    const tracks = await fromJellyfin(items || []);
    if (!tracks.length) return toast('No songs found', { type: 'error' });
    openApp('music', { tracks, play, replace: play });
  } catch (err) { toastError(err); }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function renderSessions(container) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Now Playing')), body);
  const draw = async () => {
    try {
      const sessions = (await jellyfin.get('Sessions', { activeWithinSeconds: 960 })).filter((s) => s.NowPlayingItem);
      if (!sessions.length) return clear(body, emptyState('Nobody is watching', 'Active streams will show up here.'));
      clear(body, h('div', { class: 'sessions' }, sessions.map(sessionCard)));
    } catch (err) { clear(body, errorState(err, draw)); }
  };
  return poll(container, draw, 4000);
}

function sessionCard(s) {
  const item = s.NowPlayingItem;
  const pos = s.PlayState?.PositionTicks || 0;
  const pct = item.RunTimeTicks ? (pos / item.RunTimeTicks) * 100 : 0;
  const paused = s.PlayState?.IsPaused;
  const tc = s.TranscodingInfo;
  const method = s.PlayState?.PlayMethod || (tc ? 'Transcode' : 'DirectPlay');
  const img = itemImage(item, 300);
  const control = (cmd) => jellyfin.post(`Sessions/${s.Id}/Playing/${cmd}`).catch(toastError);
  const message = async () => {
    const text = prompt(`Send a message to ${s.UserName} on ${s.DeviceName}:`);
    if (text) jellyfin.post(`Sessions/${s.Id}/Message`, { Header: 'Message from server', Text: text, TimeoutMs: 8000 }).then(() => toast('Message sent')).catch(toastError);
  };
  return h('div', { class: 'session' },
    h('div', { class: 'session-art' }, img ? h('img', { src: img, alt: '' }) : null),
    h('div', { class: 'session-body' },
      h('div', { class: 'session-title' }, itemTitle(item)),
      h('div', { class: 'muted small' }, item.Type === 'Episode' ? itemSub(item) : item.ProductionYear || ''),
      h('div', { class: 'session-meta' },
        h('span', { html: icon.users }), s.UserName || 'Unknown',
        h('span', { class: 'dot' }), `${s.Client} on ${s.DeviceName}`),
      h('div', { class: 'chips' },
        badge(method === 'Transcode' ? 'Transcoding' : method === 'DirectStream' ? 'Direct stream' : 'Direct play', method === 'Transcode' ? 'warn' : 'ok'),
        tc?.VideoCodec ? badge(`${tc.VideoCodec} ${tc.Width ? tc.Width + 'p' : ''}`.trim()) : null,
        tc?.Bitrate ? badge(`${(tc.Bitrate / 1e6).toFixed(1)} Mbps`) : null,
        paused ? badge('Paused', 'muted') : null),
      progressBar(pct, 'jf'),
      h('div', { class: 'session-time small muted' },
        `${formatDuration(pos / TICKS)} / ${item.RunTimeTicks ? formatDuration(item.RunTimeTicks / TICKS) : '—'}`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-sm', onclick: () => control('PlayPause') }, h('span', { html: paused ? icon.play : icon.pause }), paused ? 'Resume' : 'Pause'),
        h('button', { class: 'btn btn-sm', onclick: () => control('Stop') }, h('span', { html: icon.stop }), 'Stop'),
        h('button', { class: 'btn btn-sm', onclick: message }, h('span', { html: icon.bell }), 'Message'))));
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function renderServer(container) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Server')), body);
  const tasksBox = h('div', {});
  const draw = async () => {
    try {
      const [info, counts, activity] = await Promise.all([
        jellyfin.get('System/Info'), jellyfin.get('Items/Counts'), jellyfin.get('System/ActivityLog/Entries', { limit: 25 }).catch(() => ({ Items: [] })),
      ]);
      clear(body,
        h('div', { class: 'cards' },
          statCard('Server', info.ServerName, `v${info.Version}`),
          statCard('Movies', counts.MovieCount ?? 0),
          statCard('Series', counts.SeriesCount ?? 0, `${counts.EpisodeCount ?? 0} episodes`),
          statCard('Music', counts.AlbumCount ?? 0, `${counts.SongCount ?? 0} songs`)),
        info.HasPendingRestart ? h('div', { class: 'health-item health-warning' }, h('span', { html: icon.alert }), 'A restart is pending to apply updates.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onclick: () => jellyfin.post('Library/Refresh').then(() => toast('Scanning all libraries', { icon: appIcon.jellyfin })).catch(toastError) }, h('span', { html: icon.refresh }), 'Scan all libraries'),
          h('button', { class: 'btn', onclick: async () => {
            if (!(await confirmDialog({ title: 'Restart Jellyfin?', message: 'Anyone watching will be interrupted.', confirm: 'Restart', danger: true }))) return;
            jellyfin.post('System/Restart').then(() => toast('Jellyfin is restarting', { icon: appIcon.jellyfin })).catch(toastError);
          } }, h('span', { html: icon.power }), 'Restart server')),
        h('h3', { class: 'section-title' }, 'Scheduled tasks'), tasksBox,
        h('h3', { class: 'section-title' }, 'Recent activity'),
        (activity.Items || []).length ? h('div', { class: 'activity' }, activity.Items.map((a) => h('div', { class: 'activity-item' },
          h('span', { class: `dot sev-${String(a.Severity).toLowerCase()}` }), h('span', {}, a.Name), h('span', { class: 'muted small' }, timeAgo(a.Date)))))
          : emptyState('No recent activity'));
      drawTasks();
    } catch (err) { clear(body, errorState(err, draw)); }
  };
  const drawTasks = async () => {
    try {
      const tasks = await jellyfin.get('ScheduledTasks', { isHidden: false });
      clear(tasksBox, h('div', { class: 'tasks' }, tasks.sort((a, b) => (b.State === 'Running') - (a.State === 'Running') || a.Name.localeCompare(b.Name)).slice(0, 12).map((t) => h('div', { class: 'task' },
        h('div', { class: 'task-name' }, h('strong', {}, t.Name), h('span', { class: 'muted small' }, t.State === 'Running' ? `Running ${Math.round(t.CurrentProgressPercentage || 0)}%` : t.LastExecutionResult ? `Last run ${timeAgo(t.LastExecutionResult.EndTimeUtc)} · ${t.LastExecutionResult.Status}` : 'Never run')),
        t.State === 'Running' ? progressBar(t.CurrentProgressPercentage || 0, 'jf') : h('div', {}),
        t.State === 'Running'
          ? h('button', { class: 'btn btn-sm', onclick: () => jellyfin.del(`ScheduledTasks/Running/${t.Id}`).then(drawTasks).catch(toastError) }, 'Stop')
          : h('button', { class: 'btn btn-sm', onclick: () => jellyfin.post(`ScheduledTasks/Running/${t.Id}`).then(() => { toast(`Started: ${t.Name}`); setTimeout(drawTasks, 800); }).catch(toastError) }, h('span', { html: icon.play }), 'Run')))));
    } catch (err) { clear(tasksBox, errorState(err)); }
  };
  draw();
  const timer = setInterval(() => { if (tasksBox.isConnected && !document.hidden) drawTasks(); }, 5000);
  return () => clearInterval(timer);
}
