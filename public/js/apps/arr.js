// Radarr and Sonarr share most of their API shape, so one factory builds both apps.

import { h, clear, formatBytes, formatDuration, dayLabel, timeOf, debounce, toast, toastError, confirmDialog,
  spinner, emptyState, errorState, progressBar, badge, sidebarLayout, poll } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { radarr, sonarr, serviceLink, isConfigured } from '../api.js';
import { notConfigured } from './common.js';

const KINDS = {
  radarr: {
    name: 'Radarr', noun: 'Movie', nouns: 'Movies', api: radarr, entity: 'movie', idField: 'tmdbId',
    libraryIcon: icon.film,
    sub: (m) => [m.year, m.runtime ? `${m.runtime} min` : null, m.certification].filter(Boolean).join(' · '),
    isDownloaded: (m) => m.hasFile,
    progress: (m) => (m.hasFile ? 100 : 0),
    size: (m) => m.sizeOnDisk || m.movieFile?.size || 0,
    addBody: (item, opts) => ({
      ...item, qualityProfileId: opts.qualityProfileId, rootFolderPath: opts.rootFolderPath, monitored: true,
      minimumAvailability: 'released', addOptions: { searchForMovie: opts.search },
    }),
    searchCmd: (m) => ({ name: 'MoviesSearch', movieIds: [m.id] }),
    missingCmd: { name: 'MissingMoviesSearch' },
    refreshCmd: (m) => ({ name: 'RefreshMovie', movieIds: [m.id] }),
    queueParams: { includeMovie: true },
    queueTitle: (r) => r.movie?.title || r.title,
    queueSub: (r) => r.title,
    webPath: (m) => `/movie/${m.titleSlug || m.tmdbId}`,
  },
  sonarr: {
    name: 'Sonarr', noun: 'Series', nouns: 'Series', api: sonarr, entity: 'series', idField: 'tvdbId',
    libraryIcon: icon.tv,
    sub: (s) => [s.year, s.network, s.statistics ? `${s.statistics.seasonCount ?? s.seasons?.length ?? 0} seasons` : null].filter(Boolean).join(' · '),
    isDownloaded: (s) => (s.statistics?.percentOfEpisodes ?? 0) >= 100,
    progress: (s) => s.statistics?.percentOfEpisodes ?? 0,
    size: (s) => s.statistics?.sizeOnDisk || 0,
    addBody: (item, opts) => ({
      ...item, qualityProfileId: opts.qualityProfileId, rootFolderPath: opts.rootFolderPath, monitored: true,
      seasonFolder: true, languageProfileId: opts.languageProfileId,
      addOptions: { searchForMissingEpisodes: opts.search, monitor: 'all' },
    }),
    searchCmd: (s) => ({ name: 'SeriesSearch', seriesId: s.id }),
    missingCmd: { name: 'MissingEpisodeSearch' },
    refreshCmd: (s) => ({ name: 'RefreshSeries', seriesId: s.id }),
    queueParams: { includeSeries: true, includeEpisode: true },
    queueTitle: (r) => r.series?.title || r.title,
    queueSub: (r) => (r.episode ? `S${pad(r.episode.seasonNumber)}E${pad(r.episode.episodeNumber)} · ${r.episode.title || ''}` : r.title),
    webPath: (s) => `/series/${s.titleSlug}`,
  },
};

const pad = (n) => String(n ?? 0).padStart(2, '0');

export function posterUrl(item, kindId) {
  const img = (item.images || []).find((i) => i.coverType === 'poster');
  if (!img) return null;
  if (img.remoteUrl) return img.remoteUrl;
  if (img.url) return img.url.startsWith('http') ? img.url : `/api/${kindId}${img.url}`;
  return null;
}

export function makeArrApp(kindId) {
  const K = KINDS[kindId];
  return {
    id: kindId, name: K.name, icon: appIcon[kindId], size: [1100, 720],
    description: kindId === 'radarr' ? 'Movie collection manager' : 'TV series manager',
    open(win, opts = {}) {
      if (!isConfigured(kindId)) return clear(win.body, notConfigured(K.name, kindId));
      const ctx = { K, kindId, library: null, profiles: null, rootFolders: null, win, pendingTerm: opts.term };
      const layout = sidebarLayout([
        { id: 'library', label: 'Library', icon: K.libraryIcon, render: (c) => renderLibrary(c, ctx) },
        { id: 'add', label: `Add ${K.noun}`, icon: icon.plus, render: (c) => renderAdd(c, ctx) },
        { id: 'queue', label: 'Queue', icon: icon.download, render: (c) => renderQueue(c, ctx) },
        { id: 'calendar', label: 'Calendar', icon: icon.calendar, render: (c) => renderCalendar(c, ctx) },
        { id: 'system', label: 'System', icon: icon.server, render: (c) => renderSystem(c, ctx) },
      ], { initial: opts.section });
      ctx.layout = layout;
      win.body.append(layout.root);
      if (opts.itemId) openItemById(ctx, opts.itemId);
      win.on('reopen', (o) => {
        if (o?.term) ctx.pendingTerm = o.term;
        if (o?.section) layout.show(o.section);
        if (o?.itemId) openItemById(ctx, o.itemId);
      });
    },
  };
}

async function loadLibrary(ctx, force = false) {
  if (ctx.library && !force) return ctx.library;
  const [items, profiles] = await Promise.all([ctx.K.api.get(ctx.K.entity), loadProfiles(ctx)]);
  ctx.library = items;
  ctx.profileNames = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
  return items;
}

async function loadProfiles(ctx) {
  if (!ctx.profiles) ctx.profiles = await ctx.K.api.get('qualityprofile');
  return ctx.profiles;
}

async function command(ctx, body, label) {
  try {
    await ctx.K.api.post('command', body);
    toast(`${ctx.K.name}: ${label}`, { body: 'Task queued', icon: appIcon[ctx.kindId], type: 'success' });
  } catch (err) { toastError(err, `${ctx.K.name}: ${label} failed`); }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function renderLibrary(container, ctx) {
  const { K } = ctx;
  const prefs = JSON.parse(localStorage.getItem(`mediadesk.${ctx.kindId}.lib`) || '{}');
  const search = h('input', { class: 'input', type: 'search', placeholder: `Filter ${K.nouns.toLowerCase()}…`, value: prefs.q || '' });
  const filter = h('select', { class: 'input' },
    ['all:All', 'monitored:Monitored', 'missing:Missing', 'downloaded:Downloaded', 'unmonitored:Unmonitored']
      .map((o) => { const [v, l] = o.split(':'); return h('option', { value: v, selected: prefs.filter === v }, l); }));
  const sort = h('select', { class: 'input' },
    ['title:Title', 'added:Recently added', 'year:Year', 'size:Size on disk']
      .map((o) => { const [v, l] = o.split(':'); return h('option', { value: v, selected: prefs.sort === v }, l); }));
  const count = h('span', { class: 'muted' });
  const grid = h('div', { class: 'poster-grid' });
  const body = h('div', {}, spinner());

  const toolbar = h('div', { class: 'toolbar' },
    search, filter, sort, count, h('div', { class: 'spacer' }),
    h('button', { class: 'btn', title: `Search all missing ${K.nouns.toLowerCase()}`, onclick: () => command(ctx, K.missingCmd, 'Search missing') },
      h('span', { html: icon.search }), 'Search missing'),
    h('button', { class: 'btn btn-icon', title: 'Reload', html: icon.refresh, onclick: () => load(true) }));
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, K.nouns)), toolbar, body);

  let observer;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    try { localStorage.setItem(`mediadesk.${ctx.kindId}.lib`, JSON.stringify({ q: search.value, filter: filter.value, sort: sort.value })); } catch { /* ignore */ }
    let items = ctx.library.filter((m) => !q || m.title.toLowerCase().includes(q) || String(m.year).includes(q));
    const f = filter.value;
    if (f === 'monitored') items = items.filter((m) => m.monitored);
    if (f === 'unmonitored') items = items.filter((m) => !m.monitored);
    if (f === 'missing') items = items.filter((m) => m.monitored && !K.isDownloaded(m));
    if (f === 'downloaded') items = items.filter((m) => K.isDownloaded(m));
    const s = sort.value;
    items.sort((a, b) =>
      s === 'added' ? new Date(b.added) - new Date(a.added)
        : s === 'year' ? (b.year || 0) - (a.year || 0)
          : s === 'size' ? K.size(b) - K.size(a)
            : (a.sortTitle || a.title).localeCompare(b.sortTitle || b.title));
    count.textContent = `${items.length} of ${ctx.library.length}`;
    clear(grid);
    observer?.disconnect();
    if (!items.length) return clear(body, emptyState(ctx.library.length ? 'Nothing matches' : `No ${K.nouns.toLowerCase()} yet`, ctx.library.length ? 'Try a different filter.' : `Use “Add ${K.noun}” to get started.`));
    clear(body, grid);

    // Render in chunks so large libraries stay snappy.
    let shown = 0;
    const sentinel = h('div', { class: 'sentinel' });
    const more = () => {
      const chunk = items.slice(shown, shown + 120);
      shown += chunk.length;
      sentinel.before(...chunk.map((m) => posterCard(m, ctx)));
      if (shown >= items.length) { observer.disconnect(); sentinel.remove(); }
    };
    grid.append(sentinel);
    observer = new IntersectionObserver((e) => { if (e[0].isIntersecting) more(); }, { root: container, rootMargin: '600px' });
    more();
    observer.observe(sentinel);
  };

  const load = async (force) => {
    clear(body, spinner());
    try { await loadLibrary(ctx, force); draw(); } catch (err) { clear(body, errorState(err, () => load(true))); }
  };
  search.addEventListener('input', debounce(draw, 150));
  filter.addEventListener('change', draw);
  sort.addEventListener('change', draw);
  load(false);
  return () => observer?.disconnect();
}

function posterCard(item, ctx) {
  const { K } = ctx;
  const url = posterUrl(item, ctx.kindId);
  const done = K.isDownloaded(item);
  const pct = K.progress(item);
  const status = !item.monitored ? ['Unmonitored', 'muted'] : done ? ['Downloaded', 'ok'] : pct > 0 ? [`${Math.round(pct)}%`, 'warn'] : ['Missing', 'bad'];
  return h('button', { class: 'poster-card', title: item.title, onclick: () => openDetail(item, ctx) },
    h('div', { class: 'poster' },
      url ? h('img', { src: url, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
      h('div', { class: 'poster-fallback' }, item.title),
      h('span', { class: `poster-status status-${status[1]}` }, status[0]),
      ctx.kindId === 'sonarr' ? progressBar(pct, `poster-progress ${done ? 'ok' : ''}`) : null),
    h('div', { class: 'poster-title' }, item.title),
    h('div', { class: 'poster-sub' }, item.year || ''));
}

async function openItemById(ctx, id) {
  try {
    const item = (ctx.library || []).find((x) => x.id === id) || await ctx.K.api.get(`${ctx.K.entity}/${id}`);
    openDetail(item, ctx);
  } catch (err) { toastError(err); }
}

// ---------------------------------------------------------------------------
// Detail sheet
// ---------------------------------------------------------------------------

function openDetail(item, ctx) {
  const { K, kindId, win } = ctx;
  win.body.querySelector('.sheet')?.remove();
  const close = () => { sheet.classList.add('leaving'); setTimeout(() => sheet.remove(), 200); };
  const url = posterUrl(item, kindId);
  const fanart = (item.images || []).find((i) => i.coverType === 'fanart');
  const fanartUrl = fanart ? (fanart.remoteUrl || `/api/${kindId}${fanart.url}`) : null;
  const link = serviceLink(kindId);

  const monitorBtn = h('button', { class: 'btn' });
  const setMonitorLabel = () => clear(monitorBtn, h('span', { html: item.monitored ? icon.eyeOff : icon.eye }), item.monitored ? 'Unmonitor' : 'Monitor');
  setMonitorLabel();
  monitorBtn.onclick = async () => {
    try {
      const updated = await K.api.put(`${K.entity}/${item.id}`, { ...item, monitored: !item.monitored });
      Object.assign(item, updated);
      setMonitorLabel();
      toast(`${item.title} is now ${item.monitored ? 'monitored' : 'unmonitored'}`, { icon: appIcon[kindId] });
    } catch (err) { toastError(err); }
  };

  const facts = kindId === 'radarr' ? [
    ['Status', item.hasFile ? 'Downloaded' : item.isAvailable ? 'Missing' : 'Not yet available'],
    ['Quality profile', ctx.profileNames?.[item.qualityProfileId] || '—'],
    ['File', item.movieFile ? `${item.movieFile.quality?.quality?.name || ''} · ${formatBytes(item.movieFile.size)}` : '—'],
    ['Studio', item.studio || '—'],
    ['Genres', (item.genres || []).join(', ') || '—'],
    ['Path', item.path || '—'],
  ] : [
    ['Status', item.status ? item.status[0].toUpperCase() + item.status.slice(1) : '—'],
    ['Network', item.network || '—'],
    ['Episodes', item.statistics ? `${item.statistics.episodeFileCount} / ${item.statistics.episodeCount} downloaded` : '—'],
    ['Size on disk', formatBytes(item.statistics?.sizeOnDisk)],
    ['Quality profile', ctx.profileNames?.[item.qualityProfileId] || '—'],
    ['Path', item.path || '—'],
  ];

  const extra = h('div', {});
  const sheet = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-backdrop', style: fanartUrl ? { backgroundImage: `url("${fanartUrl}")` } : {} }),
    h('div', { class: 'sheet-inner' },
      h('button', { class: 'btn btn-icon sheet-close', title: 'Close', html: icon.x, onclick: close }),
      h('div', { class: 'detail-head' },
        h('div', { class: 'detail-poster' }, url ? h('img', { src: url, alt: '' }) : h('div', { class: 'poster-fallback' }, item.title)),
        h('div', { class: 'detail-info' },
          h('h2', {}, item.title),
          h('div', { class: 'muted' }, K.sub(item)),
          h('div', { class: 'chips' },
            badge(item.monitored ? 'Monitored' : 'Unmonitored', item.monitored ? 'ok' : ''),
            K.isDownloaded(item) ? badge('Downloaded', 'ok') : badge('Missing', 'bad'),
            ...(item.genres || []).slice(0, 3).map((g) => badge(g))),
          h('p', { class: 'overview' }, item.overview || 'No overview available.'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', onclick: () => command(ctx, K.searchCmd(item), `Searching for ${item.title}`) }, h('span', { html: icon.search }), 'Search'),
            monitorBtn,
            h('button', { class: 'btn', onclick: () => command(ctx, K.refreshCmd(item), `Refreshing ${item.title}`) }, h('span', { html: icon.refresh }), 'Refresh'),
            link ? h('a', { class: 'btn', href: link + K.webPath(item), target: '_blank', rel: 'noopener' }, h('span', { html: icon.external }), `Open in ${K.name}`) : null,
            h('button', { class: 'btn btn-danger', onclick: () => deleteItem(item, ctx, close) }, h('span', { html: icon.trash }), 'Delete')),
        )),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      extra));
  win.body.append(sheet);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (kindId === 'sonarr') renderSeasons(extra, item, ctx);
}

async function renderSeasons(container, series, ctx) {
  container.append(h('h3', { class: 'section-title' }, 'Seasons'));
  const list = h('div', { class: 'seasons' }, spinner('Loading episodes…'));
  container.append(list);
  let episodes;
  try { episodes = await sonarr.get('episode', { seriesId: series.id }); } catch (err) { return clear(list, errorState(err)); }
  clear(list);
  const seasons = [...(series.seasons || [])].sort((a, b) => b.seasonNumber - a.seasonNumber);
  for (const season of seasons) {
    const eps = episodes.filter((e) => e.seasonNumber === season.seasonNumber).sort((a, b) => a.episodeNumber - b.episodeNumber);
    const have = eps.filter((e) => e.hasFile).length;
    const aired = eps.filter((e) => e.airDateUtc && new Date(e.airDateUtc) < new Date()).length;
    const body = h('div', { class: 'episodes' }, eps.map((e) => h('div', { class: 'episode' },
      h('span', { class: 'ep-num' }, e.episodeNumber),
      h('span', { class: 'ep-title' }, e.title || 'TBA'),
      h('span', { class: 'muted' }, e.airDateUtc ? new Date(e.airDateUtc).toLocaleDateString() : 'TBA'),
      e.hasFile ? badge('Downloaded', 'ok') : e.airDateUtc && new Date(e.airDateUtc) < new Date() ? badge(e.monitored ? 'Missing' : 'Skipped', e.monitored ? 'bad' : '') : badge('Upcoming'),
      h('button', { class: 'btn btn-icon btn-sm', title: 'Search episode', html: icon.search,
        onclick: () => command(ctx, { name: 'EpisodeSearch', episodeIds: [e.id] }, `Searching ${series.title} S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}`) }))));
    const details = h('details', { class: 'season' },
      h('summary', {},
        h('span', { class: 'season-name' }, season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`),
        h('span', { class: 'muted' }, `${have} / ${aired || eps.length} episodes`),
        progressBar(aired ? (have / aired) * 100 : 0, have >= aired && aired ? 'ok' : ''),
        season.monitored ? badge('Monitored', 'ok') : badge('Unmonitored'),
        h('button', { class: 'btn btn-sm', onclick: (ev) => { ev.preventDefault(); command(ctx, { name: 'SeasonSearch', seriesId: series.id, seasonNumber: season.seasonNumber }, `Searching ${series.title} season ${season.seasonNumber}`); } },
          h('span', { html: icon.search }), 'Search')),
      body);
    list.append(details);
  }
}

async function deleteItem(item, ctx, closeSheet) {
  const res = await confirmDialog({
    title: `Delete ${item.title}?`, message: `This removes it from ${ctx.K.name}.`, confirm: 'Delete', danger: true,
    checkbox: 'Also delete files from disk',
  });
  if (!res) return;
  try {
    await ctx.K.api.del(`${ctx.K.entity}/${item.id}`, { deleteFiles: res.checked });
    ctx.library = ctx.library?.filter((x) => x.id !== item.id) || null;
    closeSheet();
    toast(`Deleted ${item.title}`, { icon: appIcon[ctx.kindId] });
    ctx.layout.refresh();
  } catch (err) { toastError(err); }
}

// ---------------------------------------------------------------------------
// Add new
// ---------------------------------------------------------------------------

function renderAdd(container, ctx) {
  const { K, kindId } = ctx;
  const input = h('input', { class: 'input input-lg', type: 'search', placeholder: `Search for a ${K.noun.toLowerCase()} to add…`, autofocus: true });
  const profileSel = h('select', { class: 'input' });
  const rootSel = h('select', { class: 'input' });
  const searchChk = h('input', { type: 'checkbox', checked: true });
  const results = h('div', { class: 'results' }, emptyState(`Find a ${K.noun.toLowerCase()}`, 'Search by title, or use tmdb:/tvdb: IDs.'));
  let languageProfileId;

  container.append(
    h('div', { class: 'pane-header' }, h('h2', {}, `Add ${K.noun}`)),
    h('div', { class: 'toolbar' }, input),
    h('div', { class: 'toolbar toolbar-sub' },
      h('label', {}, 'Quality ', profileSel), h('label', {}, 'Root folder ', rootSel),
      h('label', { class: 'check' }, searchChk, ' Start searching immediately')),
    results);
  setTimeout(() => input.focus(), 50);
  if (ctx.pendingTerm) { input.value = ctx.pendingTerm; ctx.pendingTerm = null; setTimeout(() => input.dispatchEvent(new Event('input')), 0); }

  (async () => {
    try {
      const [profiles, roots] = await Promise.all([loadProfiles(ctx), K.api.get('rootfolder')]);
      ctx.rootFolders = roots;
      clear(profileSel, profiles.map((p) => h('option', { value: p.id }, p.name)));
      clear(rootSel, roots.map((r) => h('option', { value: r.path }, `${r.path} (${formatBytes(r.freeSpace)} free)`)));
      const last = JSON.parse(localStorage.getItem(`mediadesk.${kindId}.add`) || '{}');
      if (last.profile) profileSel.value = last.profile;
      if (last.root) rootSel.value = last.root;
      if (kindId === 'sonarr') {
        // Sonarr v3 needs a language profile; v4 removed them.
        try { languageProfileId = (await sonarr.get('languageprofile'))[0]?.id; } catch { languageProfileId = undefined; }
      }
      if (!ctx.library) loadLibrary(ctx).catch(() => {});
    } catch (err) { toastError(err, 'Could not load profiles'); }
  })();

  let seq = 0;
  const doSearch = debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) return;
    const mine = ++seq;
    clear(results, spinner('Searching…'));
    try {
      const found = await K.api.get(`${K.entity}/lookup`, { term });
      if (mine !== seq) return;
      if (!found.length) return clear(results, emptyState('No results', `Nothing found for “${term}”.`));
      clear(results, found.slice(0, 30).map((item) => resultRow(item)));
    } catch (err) { if (mine === seq) clear(results, errorState(err)); }
  }, 450);
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  const resultRow = (item) => {
    const existing = item.id || ctx.library?.find((x) => x[K.idField] === item[K.idField]);
    const url = posterUrl(item, kindId);
    const btn = h('button', { class: 'btn btn-primary', disabled: Boolean(existing) }, existing ? 'In library' : h('span', { html: icon.plus }), existing ? null : 'Add');
    btn.onclick = async () => {
      if (!rootSel.value) return toast('Pick a root folder first', { type: 'error' });
      btn.disabled = true;
      btn.textContent = 'Adding…';
      try {
        localStorage.setItem(`mediadesk.${kindId}.add`, JSON.stringify({ profile: profileSel.value, root: rootSel.value }));
        const added = await K.api.post(K.entity, K.addBody(item, {
          qualityProfileId: Number(profileSel.value), rootFolderPath: rootSel.value, search: searchChk.checked, languageProfileId,
        }));
        ctx.library?.push(added);
        btn.textContent = 'Added';
        toast(`Added ${item.title}`, { body: searchChk.checked ? 'Searching for releases…' : '', type: 'success', icon: appIcon[kindId] });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Add';
        toastError(err, `Could not add ${item.title}`);
      }
    };
    return h('div', { class: 'result' },
      h('div', { class: 'result-poster' }, url ? h('img', { src: url, loading: 'lazy', alt: '' }) : null),
      h('div', { class: 'result-body' },
        h('div', { class: 'result-title' }, item.title, ' ', h('span', { class: 'muted' }, item.year ? `(${item.year})` : '')),
        h('div', { class: 'muted small' }, [item.network || item.studio, item.runtime ? `${item.runtime} min` : null, (item.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')),
        h('p', { class: 'result-overview' }, item.overview || '')),
      h('div', {}, btn));
  };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function renderQueue(container, ctx) {
  const { K } = ctx;
  const table = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Queue'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => command(ctx, { name: 'RefreshMonitoredDownloads' }, 'Refreshing downloads') }, h('span', { html: icon.refresh }), 'Refresh')), table);

  const draw = async () => {
    try {
      const data = await K.api.get('queue', { page: 1, pageSize: 100, ...K.queueParams });
      const records = data.records || data;
      if (!records.length) return clear(table, emptyState('Queue is empty', 'Nothing is downloading right now.'));
      clear(table, h('div', { class: 'table' },
        h('div', { class: 'tr th' }, h('div', {}, 'Title'), h('div', {}, 'Quality'), h('div', {}, 'Progress'), h('div', {}, 'Time left'), h('div', {})),
        records.map((r) => {
          const pct = r.size ? ((r.size - r.sizeleft) / r.size) * 100 : 0;
          const warn = r.trackedDownloadStatus === 'warning' || r.trackedDownloadStatus === 'error';
          return h('div', { class: 'tr' },
            h('div', { class: 'td-title' }, h('strong', {}, K.queueTitle(r)), h('span', { class: 'muted small' }, K.queueSub(r)),
              warn ? h('span', { class: 'small text-warn' }, (r.statusMessages || []).flatMap((m) => m.messages).join(' ') || r.errorMessage || 'Needs attention') : null),
            h('div', {}, badge(r.quality?.quality?.name || '—')),
            h('div', { class: 'td-progress' }, progressBar(pct, warn ? 'warn' : ''), h('span', { class: 'small muted' }, `${Math.round(pct)}% · ${r.status}`)),
            h('div', { class: 'muted' }, r.timeleft || '—'),
            h('div', {}, h('button', { class: 'btn btn-icon btn-sm', title: 'Remove from queue', html: icon.trash, onclick: () => removeQueue(r) })));
        })));
    } catch (err) { clear(table, errorState(err, draw)); }
  };
  const removeQueue = async (r) => {
    const res = await confirmDialog({ title: 'Remove from queue?', message: K.queueTitle(r), confirm: 'Remove', danger: true, checkbox: 'Blocklist this release' });
    if (!res) return;
    try { await K.api.del(`queue/${r.id}`, { removeFromClient: true, blocklist: res.checked }); toast('Removed from queue'); draw(); } catch (err) { toastError(err); }
  };
  return poll(container, draw, 5000);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function upcoming(kindId, days = 14) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 864e5);
  const params = { start: start.toISOString(), end: end.toISOString() };
  if (kindId === 'sonarr') {
    const eps = await sonarr.get('calendar', { ...params, includeSeries: true });
    return eps.map((e) => ({
      date: e.airDateUtc, title: e.series?.title || 'Unknown', id: e.seriesId, hasFile: e.hasFile,
      sub: `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)} · ${e.title || 'TBA'}`, poster: e.series ? posterUrl(e.series, 'sonarr') : null, kind: 'sonarr',
    })).filter((e) => e.date);
  }
  const movies = await radarr.get('calendar', params);
  const out = [];
  for (const m of movies) {
    for (const [field, label] of [['inCinemas', 'In cinemas'], ['digitalRelease', 'Digital release'], ['physicalRelease', 'Physical release']]) {
      const d = m[field] && new Date(m[field]);
      if (d && d >= start && d < end) out.push({ date: m[field], title: m.title, id: m.id, hasFile: m.hasFile, sub: label, poster: posterUrl(m, 'radarr'), kind: 'radarr', allDay: true });
    }
  }
  return out;
}

function renderCalendar(container, ctx) {
  const list = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Upcoming'), h('span', { class: 'muted' }, 'Next 4 weeks')), list);
  upcoming(ctx.kindId, 28).then((items) => {
    if (!items.length) return clear(list, emptyState('Nothing coming up', 'No releases in the next four weeks.'));
    clear(list, calendarList(items, (it) => openItemById(ctx, it.id)));
  }).catch((err) => clear(list, errorState(err)));
}

export function calendarList(items, onClick) {
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  const groups = new Map();
  for (const it of items) {
    const key = new Date(it.date).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return h('div', { class: 'calendar' }, [...groups.values()].map((group) => h('div', { class: 'cal-day' },
    h('div', { class: 'cal-date' }, dayLabel(group[0].date)),
    h('div', { class: 'cal-items' }, group.map((it) => h('button', { class: `cal-item cal-${it.kind}`, onclick: () => onClick(it) },
      h('div', { class: 'cal-thumb' }, it.poster ? h('img', { src: it.poster, loading: 'lazy', alt: '' }) : null),
      h('div', { class: 'cal-text' }, h('strong', {}, it.title), h('span', { class: 'muted small' }, it.sub)),
      h('span', { class: 'muted small' }, it.allDay ? '' : timeOf(it.date)),
      it.hasFile ? badge('Downloaded', 'ok') : null))))));
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

function renderSystem(container, ctx) {
  const { K, kindId } = ctx;
  const body = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'System')), body);
  Promise.all([K.api.get('system/status'), K.api.get('health'), K.api.get('diskspace')]).then(([status, health, disks]) => {
    clear(body,
      h('div', { class: 'cards' },
        statCard('Version', status.version),
        statCard('Uptime', status.startTime ? formatDuration((Date.now() - new Date(status.startTime)) / 1000) : '—'),
        statCard('OS', `${status.osName || ''} ${status.osVersion || ''}`.trim() || '—'),
        statCard('Branch', status.branch || '—')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => command(ctx, { name: 'RssSync' }, 'RSS sync') }, h('span', { html: icon.refresh }), 'RSS sync'),
        h('button', { class: 'btn', onclick: () => command(ctx, { name: kindId === 'radarr' ? 'RefreshMovie' : 'RefreshSeries' }, `Refresh all ${K.nouns.toLowerCase()}`) }, h('span', { html: icon.refresh }), `Refresh all ${K.nouns.toLowerCase()}`),
        serviceLink(kindId) ? h('button', { class: 'btn', onclick: () => import('../desktop.js').then((d) => d.openWebView(kindId)) }, h('span', { html: icon.globe }), 'Open full web UI') : null),
      h('h3', { class: 'section-title' }, 'Health'),
      health.length ? h('div', { class: 'health' }, health.map((x) => h('div', { class: `health-item health-${x.type}` },
        h('span', { html: icon.alert }), h('div', {}, x.message, x.wikiUrl ? h('a', { href: x.wikiUrl, target: '_blank', rel: 'noopener', class: 'small' }, ' Learn more') : null))))
        : h('div', { class: 'health-ok' }, h('span', { html: icon.check }), 'No issues detected'),
      h('h3', { class: 'section-title' }, 'Disk space'),
      h('div', { class: 'disks' }, disks.map((d) => diskRow(d.path, d.totalSpace, d.freeSpace))));
  }).catch((err) => clear(body, errorState(err)));
}

export const statCard = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);

export function diskRow(path, total, free) {
  const used = total ? ((total - free) / total) * 100 : 0;
  return h('div', { class: 'disk' },
    h('div', { class: 'disk-head' }, h('span', { html: icon.disk }), h('strong', {}, path), h('span', { class: 'muted small' }, `${formatBytes(free)} free of ${formatBytes(total)}`)),
    progressBar(used, used > 90 ? 'bad' : used > 75 ? 'warn' : ''));
}
