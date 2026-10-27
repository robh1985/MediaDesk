// Plex: manage a Plex Media Server — libraries, what's playing, history, scheduled tasks and
// maintenance. Watching happens in Plex Viewer (plexviewer.js).

import { h, clear, timeAgo, debounce, toast, toastError, confirmDialog, spinner, emptyState, errorState, progressBar, badge, sidebarLayout, poll, formatBytes } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { plex, plexGet, isConfigured } from '../api.js';
import { notConfigured } from './common.js';
import { statCard } from './arr.js';
import { openApp } from '../wm.js';
import { serverInfo, titleOf, subOf, posterOf, artOf, plexCard, isWatched, scrobble, plexWebLink, SECTION_ICON, msToTime } from './plex-common.js';

export const plexApp = {
  id: 'plex', name: 'Plex', icon: appIcon.plex, size: [1120, 740], description: 'Manage your Plex Media Server',
  open(win, opts = {}) {
    if (!isConfigured('plex')) return clear(win.body, notConfigured('Plex', 'plex'));
    const ctx = { win };
    const layout = sidebarLayout([
      { id: 'overview', label: 'Overview', icon: icon.server, render: (c) => renderOverview(c, ctx) },
      { id: 'sessions', label: 'Now Playing', icon: icon.play, render: (c) => renderSessions(c, ctx) },
      { id: 'libraries', label: 'Libraries', icon: icon.library, render: (c) => renderLibraries(c, ctx) },
      { id: 'history', label: 'History', icon: icon.clock, render: (c) => renderHistory(c, ctx) },
      { id: 'tasks', label: 'Scheduled tasks', icon: icon.calendar, render: (c) => renderTasks(c, ctx) },
      { id: 'maintenance', label: 'Maintenance', icon: icon.sliders, render: (c) => renderMaintenance(c, ctx) },
    ], { initial: opts.section });
    ctx.layout = layout;
    win.body.append(layout.root);
    if (opts.ratingKey) openItem(opts.ratingKey, ctx);
    win.on('reopen', (o) => { if (o?.section) layout.show(o.section); if (o?.ratingKey) openItem(o.ratingKey, ctx); });
  },
};

const plexPassBadge = (info) => (info.myPlexSubscription ? badge('Plex Pass', 'plexpass') : null);
const needsPass = (info, what) => (info.myPlexSubscription ? null
  : h('div', { class: 'notice' }, `${what} needs Plex Pass on the server owner’s account.`));

// Plex refuses Now Playing, history and tasks unless MediaDesk has the owner's token.
const needsOwner = (err) => h('div', { class: 'empty error' },
  h('div', { class: 'empty-title' }, 'Plex won’t share this with MediaDesk'),
  h('div', {}, err.message),
  h('button', { class: 'btn btn-primary', onclick: () => openApp('settings', { tab: 'plex' }) }, 'Open Settings → Plex'));

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function sectionCounts() {
  const sections = (await plexGet('library/sections')).Directory || [];
  return Promise.all(sections.map(async (s) => {
    const size = { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 };
    const [all, leaves] = await Promise.all([
      plexGet(`library/sections/${s.key}/all`, size).catch(() => ({})),
      s.type === 'show' ? plexGet(`library/sections/${s.key}/all`, { ...size, type: 4 }).catch(() => ({})) : null,
    ]);
    return { ...s, count: all.totalSize ?? all.size ?? 0, episodes: leaves ? leaves.totalSize ?? leaves.size ?? 0 : null };
  }));
}

function renderOverview(container) {
  const body = h('div', {}, spinner());
  const acts = h('div', {});
  container.append(h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.plex }), h('h2', {}, 'Overview')), body);
  (async () => {
    const [info, sections, sessions] = await Promise.all([serverInfo(true), sectionCounts(), plexGet('status/sessions').catch(() => ({}))]);
    const web = await plexWebLink();
    const playing = sessions.Metadata || [];
    clear(body,
      h('div', { class: 'cards' },
        statCard('Server', info.friendlyName || 'Plex', [`v${info.version || '?'}`, info.platform].filter(Boolean).join(' · ')),
        statCard('Streaming now', playing.length, playing.length ? `${playing.filter((s) => s.TranscodeSession?.videoDecision === 'transcode').length} transcoding` : 'Nobody is watching'),
        ...sections.map((s) => statCard(s.title, s.count.toLocaleString(), s.episodes != null ? `${s.episodes.toLocaleString()} episodes` : s.type === 'movie' ? 'films' : s.type === 'artist' ? 'artists' : ''))),
      h('div', { class: 'chips plex-chips' }, plexPassBadge(info), info.myPlexUsername ? badge(`Signed in as ${info.myPlexUsername}`) : null, info.transcoderActiveVideoSessions != null ? badge(`${info.transcoderActiveVideoSessions} active transcode${info.transcoderActiveVideoSessions === 1 ? '' : 's'}`) : null),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: () => scanAll(sections) }, h('span', { html: icon.refresh }), 'Scan all libraries'),
        h('button', { class: 'btn', onclick: () => checkUpdates() }, h('span', { html: icon.download }), 'Check for updates'),
        h('button', { class: 'btn', onclick: () => openApp('plexviewer') }, h('span', { html: appIcon.plexviewer }), 'Open Plex Viewer'),
        web ? h('a', { class: 'btn', href: web, target: '_blank', rel: 'noopener' }, h('span', { html: icon.globe }), 'Plex Web') : null),
      h('h3', { class: 'section-title' }, 'Activity'), acts);
    const drawActs = async () => {
      const a = (await plexGet('activities').catch(() => ({}))).Activity || [];
      clear(acts, a.length ? h('div', { class: 'tasks' }, a.map((x) => h('div', { class: 'task' },
        h('div', { class: 'task-name' }, h('strong', {}, x.title), h('span', { class: 'muted small' }, x.subtitle || '')),
        progressBar(x.progress || 0, 'plex'), h('span', { class: 'small muted' }, `${Math.round(x.progress || 0)}%`))))
        : h('div', { class: 'muted small' }, 'Nothing running right now.'));
    };
    poll(acts, drawActs, 3000);
  })().catch((err) => clear(body, errorState(err)));
}

async function scanAll(sections) {
  try {
    const list = sections || (await plexGet('library/sections')).Directory || [];
    await Promise.all(list.map((s) => plex.get(`library/sections/${s.key}/refresh`)));
    toast('Scanning all libraries', { icon: appIcon.plex });
  } catch (err) { toastError(err); }
}

async function checkUpdates() {
  try {
    await plex.put('updater/check', undefined, { download: 0 });
    const st = await plexGet('updater/status');
    const rel = (st.Release || [])[0];
    toast(rel ? `Update available: ${rel.version}` : 'Plex is up to date', { body: rel?.fixed?.slice(0, 120) || '', icon: appIcon.plex, timeout: 5000 });
  } catch (err) { toastError(err, 'Could not check for updates'); }
}

// ---------------------------------------------------------------------------
// Now playing
// ---------------------------------------------------------------------------

function renderSessions(container) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Now Playing')), body);
  const draw = async () => {
    try {
      const [mc, info] = await Promise.all([plexGet('status/sessions'), serverInfo()]);
      const list = mc.Metadata || [];
      if (!list.length) return clear(body, emptyState('Nobody is watching', 'Active streams will show up here.'));
      const bandwidth = list.reduce((a, s) => a + (s.Session?.bandwidth || 0), 0);
      clear(body,
        h('div', { class: 'muted small plex-bw' }, `${list.length} stream${list.length === 1 ? '' : 's'} · ${(bandwidth / 1000).toFixed(1)} Mbps total`),
        h('div', { class: 'sessions' }, list.map((s) => sessionCard(s, info, draw))));
    } catch (err) { clear(body, err.status === 401 || err.status === 403 ? needsOwner(err) : errorState(err, draw)); }
  };
  return poll(container, draw, 4000);
}

function sessionCard(s, info, redraw) {
  const tc = s.TranscodeSession;
  const video = tc?.videoDecision || 'directplay';
  const label = video === 'transcode' ? 'Transcoding' : video === 'copy' ? 'Direct stream' : 'Direct play';
  const pct = s.duration ? ((s.viewOffset || 0) / s.duration) * 100 : 0;
  const stop = async () => {
    const reason = await askReason(s);
    if (reason === null) return;
    try { await plex.get('status/sessions/terminate', { sessionId: s.Session?.id, reason: reason || 'Stopped by the server owner.' }); toast('Stream stopped', { icon: appIcon.plex }); redraw(); }
    catch (err) { toastError(err, 'Could not stop the stream'); }
  };
  return h('div', { class: 'session' },
    h('div', { class: 'session-art' }, posterOf(s, 200) ? h('img', { src: posterOf(s, 200), alt: '' }) : null),
    h('div', { class: 'session-body' },
      h('div', { class: 'session-title' }, titleOf(s)),
      h('div', { class: 'muted small' }, s.type === 'episode' ? subOf(s) : s.year || ''),
      h('div', { class: 'session-meta' }, h('span', { html: icon.users }), s.User?.title || 'Unknown', h('span', { class: 'dot' }),
        `${s.Player?.product || ''} on ${s.Player?.title || s.Player?.platform || 'a device'}`),
      h('div', { class: 'chips' },
        badge(label, video === 'transcode' ? 'warn' : 'ok'),
        tc?.transcodeHwRequested ? badge(tc.transcodeHwFullPipeline ? 'Hardware (full)' : 'Hardware') : video === 'transcode' ? badge('Software') : null,
        tc?.sourceVideoCodec && video === 'transcode' ? badge(`${tc.sourceVideoCodec} → ${tc.videoCodec}`) : null,
        tc?.speed ? badge(`${tc.speed.toFixed(1)}×`) : null,
        s.Session?.bandwidth ? badge(`${(s.Session.bandwidth / 1000).toFixed(1)} Mbps`) : null,
        badge(s.Session?.location === 'wan' ? 'Remote' : 'Local'),
        s.Player?.state === 'paused' ? badge('Paused', 'muted') : s.Player?.state === 'buffering' ? badge('Buffering', 'warn') : null),
      progressBar(pct, 'plex'),
      h('div', { class: 'session-time small muted' }, `${msToTime(s.viewOffset)} / ${msToTime(s.duration)}${s.Player?.address ? ` · ${s.Player.address}` : ''}`),
      h('div', { class: 'btn-row' },
        info.myPlexSubscription ? h('button', { class: 'btn btn-sm btn-danger', onclick: stop }, h('span', { html: icon.stop }), 'Stop stream') : h('span', { class: 'small muted' }, 'Stopping streams needs Plex Pass'))));
}

function askReason(s) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value: 'The server is going down for maintenance.', maxlength: 200 });
    const done = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } },
      h('form', { class: 'dialog', onsubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
        h('h3', {}, `Stop ${s.User?.title || 'this'}’s stream?`),
        h('p', {}, `${titleOf(s)} will stop playing on ${s.Player?.title || 'their device'}. They’ll see this message:`),
        h('label', { class: 'field' }, h('span', {}, 'Message'), input),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn btn-danger', type: 'submit' }, 'Stop stream'))));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);
    input.select();
  });
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

function renderLibraries(container, ctx) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Libraries'),
    h('button', { class: 'btn', onclick: () => scanAll() }, h('span', { html: icon.refresh }), 'Scan all')), body);
  const draw = async () => {
    try {
      const sections = await sectionCounts();
      if (!sections.length) return clear(body, emptyState('No libraries', 'Add libraries in Plex Web.'));
      clear(body, h('div', { class: 'plex-libs' }, sections.map((s) => h('div', { class: 'plex-lib' },
        h('span', { class: 'plex-lib-icon', html: SECTION_ICON[s.type] || SECTION_ICON.movie }),
        h('div', { class: 'grow' },
          h('div', { class: 'plex-lib-title' }, h('strong', {}, s.title), s.refreshing ? badge('Scanning…', 'warn') : null),
          h('div', { class: 'small muted' }, [`${s.count.toLocaleString()} ${s.type === 'show' ? 'shows' : s.type === 'artist' ? 'artists' : s.type === 'photo' ? 'items' : 'films'}`,
            s.episodes != null ? `${s.episodes.toLocaleString()} episodes` : null, s.scannedAt ? `scanned ${timeAgo(s.scannedAt * 1000)}` : null].filter(Boolean).join(' · ')),
          h('div', { class: 'small muted plex-paths' }, (s.Location || []).map((l) => l.path).join(' · '))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => browse(container, s, ctx) }, 'Browse'),
          h('button', { class: 'btn btn-sm', title: 'Look for new and changed files', onclick: () => plex.get(`library/sections/${s.key}/refresh`).then(() => { toast(`Scanning ${s.title}`, { icon: appIcon.plex }); setTimeout(draw, 800); }).catch(toastError) }, h('span', { html: icon.refresh }), 'Scan'),
          h('button', { class: 'btn btn-sm', onclick: (e) => libMenu(e, s, draw) }, '⋯'))))));
    } catch (err) { clear(body, errorState(err, draw)); }
  };
  draw();
}

async function libMenu(e, s, redraw) {
  const { contextMenu } = await import('../ui.js');
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4, [
    { label: 'Refresh all metadata', icon: icon.refresh, action: async () => {
      if (!(await confirmDialog({ title: `Refresh all metadata in ${s.title}?`, message: 'Plex will download new posters and information for everything in this library. This can take a long time for big libraries.', confirm: 'Refresh' }))) return;
      plex.get(`library/sections/${s.key}/refresh`, { force: 1 }).then(() => { toast(`Refreshing ${s.title}`, { icon: appIcon.plex }); redraw(); }).catch(toastError);
    } },
    { label: 'Empty trash', icon: icon.trash, action: () => plex.put(`library/sections/${s.key}/emptyTrash`).then(() => toast(`Emptied ${s.title}’s trash`, { icon: appIcon.plex })).catch(toastError) },
  ]);
}

function browse(container, section, ctx) {
  clear(container);
  const filter = h('input', { class: 'input', type: 'search', placeholder: `Search ${section.title}…` });
  const sort = h('select', { class: 'input' }, [['titleSort', 'Name'], ['addedAt:desc', 'Date added'], ['year:desc', 'Year'], ['rating:desc', 'Rating'], ['lastViewedAt:desc', 'Last watched']].map(([v, l]) => h('option', { value: v }, l)));
  const unwatched = h('input', { type: 'checkbox' });
  const count = h('span', { class: 'muted' });
  const grid = h('div', { class: 'poster-grid' });
  const more = h('button', { class: 'btn load-more' }, 'Load more');
  container.append(
    h('div', { class: 'pane-header' },
      h('button', { class: 'btn btn-icon', title: 'Back', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>', onclick: () => ctx.layout.show('libraries') }),
      h('h2', {}, section.title), count),
    h('div', { class: 'toolbar' }, filter, sort, h('label', { class: 'check small' }, unwatched, ' Unwatched only')),
    grid, more);
  let start = 0, total = 0;
  const load = async (reset) => {
    if (reset) { start = 0; clear(grid, spinner()); }
    more.disabled = true;
    try {
      const mc = await plexGet(`library/sections/${section.key}/all`, {
        sort: sort.value, title: filter.value.trim() || undefined, unwatched: unwatched.checked ? 1 : undefined,
        'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 120,
      });
      if (reset) clear(grid);
      const list = mc.Metadata || [];
      total = mc.totalSize ?? list.length;
      start += list.length;
      grid.append(...list.map((m) => plexCard(m, () => openItem(m.ratingKey, ctx))));
      count.textContent = `${total.toLocaleString()} items`;
      if (!total) clear(grid, emptyState('No items'));
      more.style.display = start < total ? '' : 'none';
    } catch (err) { clear(grid, errorState(err, () => load(true))); }
    more.disabled = false;
  };
  more.onclick = () => load(false);
  filter.addEventListener('input', debounce(() => load(true), 350));
  sort.addEventListener('change', () => load(true));
  unwatched.addEventListener('change', () => load(true));
  load(true);
}

// ---------------------------------------------------------------------------
// Item detail (management view)
// ---------------------------------------------------------------------------

async function openItem(ratingKey, ctx) {
  const { win } = ctx;
  win.body.querySelector('.sheet')?.remove();
  const inner = h('div', { class: 'sheet-inner' }, spinner());
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const sheet = h('div', { class: 'sheet' }, backdrop, inner);
  const close = () => { sheet.classList.add('leaving'); setTimeout(() => sheet.remove(), 200); };
  win.body.append(sheet);
  try {
    const m = ((await plexGet(`library/metadata/${ratingKey}`)).Metadata || [])[0];
    if (!m) throw new Error('This item is no longer in Plex');
    const art = artOf(m);
    if (art) backdrop.style.backgroundImage = `url("${art}")`;
    const web = await plexWebLink(m);
    const media = (m.Media || [])[0];
    const part = media?.Part?.[0];
    const watchedBtn = h('button', { class: 'btn' });
    let watched = isWatched(m);
    const paint = () => clear(watchedBtn, h('span', { html: icon.check }), watched ? 'Mark unwatched' : 'Mark watched');
    paint();
    watchedBtn.onclick = async () => {
      try { await scrobble(m, !watched); watched = !watched; paint(); toast(watched ? 'Marked watched' : 'Marked unwatched', { body: titleOf(m), icon: appIcon.plex }); }
      catch (err) { toastError(err); }
    };
    const playable = ['movie', 'episode', 'show', 'season'].includes(m.type);
    const facts = [
      ['Type', m.type[0].toUpperCase() + m.type.slice(1)],
      m.duration ? ['Runtime', msToTime(m.duration)] : null,
      m.contentRating ? ['Rating', m.contentRating] : null,
      m.audienceRating || m.rating ? ['Score', `★ ${(m.audienceRating || m.rating).toFixed(1)}`] : null,
      m.studio ? ['Studio', m.studio] : null,
      m.addedAt ? ['Added', timeAgo(m.addedAt * 1000)] : null,
      m.leafCount ? ['Episodes', `${m.viewedLeafCount || 0} of ${m.leafCount} watched`] : null,
      media ? ['Video', [media.videoResolution ? `${media.videoResolution}${/^\d+$/.test(media.videoResolution) ? 'p' : ''}` : null, media.videoCodec?.toUpperCase(), media.bitrate ? `${(media.bitrate / 1000).toFixed(1)} Mbps` : null].filter(Boolean).join(' · ')] : null,
      media ? ['Audio', [media.audioCodec?.toUpperCase(), media.audioChannels ? `${media.audioChannels} ch` : null].filter(Boolean).join(' · ')] : null,
      part?.size ? ['Size', formatBytes(part.size)] : null,
      part?.file ? ['File', part.file] : null,
    ].filter(Boolean);
    clear(inner,
      h('button', { class: 'btn btn-icon sheet-close', title: 'Close', html: icon.x, onclick: close }),
      h('div', { class: 'detail-head' },
        h('div', { class: 'detail-poster' }, posterOf(m, 400) ? h('img', { src: posterOf(m, 400), alt: '' }) : h('div', { class: 'poster-fallback' }, titleOf(m))),
        h('div', { class: 'detail-info' },
          h('h2', {}, titleOf(m)),
          h('div', { class: 'muted' }, [m.type === 'episode' ? subOf(m) : null, m.year].filter(Boolean).join(' · ')),
          h('div', { class: 'chips' }, (m.Genre || []).slice(0, 4).map((g) => badge(g.tag))),
          h('p', { class: 'overview' }, m.summary || 'No summary available.'),
          h('div', { class: 'btn-row' },
            playable ? h('button', { class: 'btn btn-primary', onclick: () => openApp('plexviewer', { ratingKey: m.ratingKey, play: m.type === 'movie' || m.type === 'episode' }) }, h('span', { html: icon.play }), m.type === 'movie' || m.type === 'episode' ? 'Play in Plex Viewer' : 'Open in Plex Viewer') : null,
            ['movie', 'episode', 'show', 'season'].includes(m.type) ? watchedBtn : null,
            h('button', { class: 'btn', onclick: () => plex.put(`library/metadata/${m.ratingKey}/refresh`).then(() => toast('Refreshing metadata', { body: titleOf(m), icon: appIcon.plex })).catch(toastError) }, h('span', { html: icon.refresh }), 'Refresh metadata'),
            web ? h('a', { class: 'btn', href: web, target: '_blank', rel: 'noopener' }, h('span', { html: icon.globe }), 'Plex Web') : null,
            h('button', { class: 'btn btn-danger', onclick: async () => {
              const ok = await confirmDialog({ title: `Delete “${titleOf(m)}”?`, message: 'This deletes the media files from the server’s disk, not just from Plex. This can’t be undone. (Plex must allow deleting media: Settings → Library.)', confirm: 'Delete files', danger: true });
              if (!ok) return;
              try { await plex.del(`library/metadata/${m.ratingKey}`); toast('Deleted', { body: titleOf(m), icon: appIcon.plex }); close(); }
              catch (err) { toastError(err, err.status === 403 ? 'Plex doesn’t allow deleting media — turn on “Allow media deletion” in Plex Settings → Library' : 'Could not delete'); }
            } }, h('span', { html: icon.trash }), 'Delete')))),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
  } catch (err) { clear(inner, h('button', { class: 'btn btn-icon sheet-close', html: icon.x, onclick: close }), errorState(err)); }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function renderHistory(container, ctx) {
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'History')), body);
  (async () => {
    const info = await serverInfo();
    const [hist, accounts] = await Promise.all([
      plexGet('status/sessions/history/all', { sort: 'viewedAt:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 100 }),
      plexGet('accounts').catch(() => ({})),
    ]);
    const names = Object.fromEntries((accounts.Account || []).map((a) => [String(a.id), a.name]));
    const list = hist.Metadata || [];
    clear(body, needsPass(info, 'Full watch history'),
      list.length ? h('div', { class: 'table plex-history' },
        h('div', { class: 'tr th' }, h('div', {}, 'Title'), h('div', {}, 'Who'), h('div', {}, 'When')),
        list.map((x) => h('button', { class: 'tr plex-history-row', onclick: () => openItem(x.ratingKey, ctx) },
          h('div', { class: 'td-title' }, h('strong', {}, x.grandparentTitle || x.title), h('span', { class: 'small muted' }, x.type === 'episode' ? ` S${x.parentIndex}E${x.index} · ${x.title}` : '')),
          h('div', { 'data-label': 'Who' }, names[String(x.accountID)] || `Account ${x.accountID ?? '?'}`),
          h('div', { 'data-label': 'When', class: 'muted' }, timeAgo(x.viewedAt * 1000)))))
        : emptyState('Nothing watched yet'));
  })().catch((err) => clear(body, err.status === 401 || err.status === 403 ? needsOwner(err) : errorState(err)));
}

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

function renderTasks(container) {
  const body = h('div', {}, spinner());
  const acts = h('div', {});
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Scheduled tasks')),
    h('p', { class: 'small muted' }, 'Plex runs these during its maintenance window (Plex Settings → Scheduled Tasks). Run one now with Run.'),
    h('h3', { class: 'section-title' }, 'Running now'), acts, h('h3', { class: 'section-title' }, 'Tasks'), body);
  (async () => {
    const tasks = (await plex.get('butler'))?.ButlerTasks?.ButlerTask || [];
    clear(body, tasks.length ? h('div', { class: 'tasks' }, tasks.map((t) => h('div', { class: 'task' },
      h('div', { class: 'task-name' }, h('strong', {}, t.title || t.name), h('span', { class: 'muted small' }, `${t.description || ''}${t.interval ? ` · every ${t.interval} day${t.interval === 1 ? '' : 's'}` : ''}${t.enabled === false ? ' · off' : ''}`)),
      h('div', {}),
      h('button', { class: 'btn btn-sm', onclick: () => plex.post(`butler/${t.name}`).then(() => toast(`Started: ${t.title || t.name}`, { icon: appIcon.plex })).catch(toastError) }, h('span', { html: icon.play }), 'Run'))))
      : emptyState('No scheduled tasks'));
  })().catch((err) => clear(body, err.status === 401 || err.status === 403 ? needsOwner(err) : errorState(err)));
  poll(acts, async () => {
    const a = (await plexGet('activities').catch(() => ({}))).Activity || [];
    clear(acts, a.length ? h('div', { class: 'tasks' }, a.map((x) => h('div', { class: 'task' },
      h('div', { class: 'task-name' }, h('strong', {}, x.title), h('span', { class: 'muted small' }, x.subtitle || '')),
      progressBar(x.progress || 0, 'plex'), h('span', { class: 'small muted' }, `${Math.round(x.progress || 0)}%`))))
      : h('div', { class: 'muted small' }, 'Nothing running right now.'));
  }, 3000);
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

function renderMaintenance(container) {
  const job = (title, help, label, fn, danger = false) => h('div', { class: 'plex-job' },
    h('div', { class: 'grow' }, h('strong', {}, title), h('div', { class: 'small muted' }, help)),
    h('button', { class: `btn ${danger ? 'btn-danger' : ''}`, onclick: fn }, label));
  const run = (promise, msg) => promise.then(() => toast(msg, { icon: appIcon.plex })).catch(toastError);
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Maintenance')),
    h('div', { class: 'plex-jobs' },
      job('Scan all libraries', 'Look for new, changed and removed files in every library.', 'Scan', () => scanAll()),
      job('Empty trash', 'Remove items Plex has marked as deleted (files that are no longer on disk) from every library.', 'Empty trash', async () => {
        const sections = (await plexGet('library/sections')).Directory || [];
        run(Promise.all(sections.map((s) => plex.put(`library/sections/${s.key}/emptyTrash`))), 'Emptying trash');
      }),
      job('Clean bundles', 'Delete artwork and metadata Plex no longer uses, to free disk space.', 'Clean', () => run(plex.put('library/clean/bundles'), 'Cleaning bundles')),
      job('Optimize database', 'Tidy Plex’s database. Plex may be slow while this runs.', 'Optimize', () => run(plex.put('library/optimize', undefined, { async: 1 }), 'Optimizing database')),
      job('Check for updates', 'Ask Plex whether a newer version of Plex Media Server is available.', 'Check', () => checkUpdates()),
      job('Stop all scheduled tasks', 'Stop any maintenance tasks that are running now.', 'Stop tasks', () => run(plex.del('butler'), 'Stopped scheduled tasks'), true)));
}
