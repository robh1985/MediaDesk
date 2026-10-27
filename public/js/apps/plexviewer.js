// Plex Viewer: browse and watch what's on your Plex server, in the browser. Plex converts the video
// to whatever this browser can play and sends it as HLS; MediaDesk passes it through so the Plex
// token stays on the server. Watch progress is reported back to Plex, so it carries over to your
// other Plex apps.

import { h, clear, debounce, toast, toastError, spinner, emptyState, errorState, badge, formatBytes } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { plex, plexGet, isConfigured, appPref } from '../api.js';
import { notConfigured } from './common.js';
import { openApp } from '../wm.js';
import { serverInfo, titleOf, subOf, posterOf, stillOf, artOf, plexCard, isWatched, progressOf, scrobble, SECTION_ICON, msToTime } from './plex-common.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  volume: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  back10: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">10</text>'),
  fwd30: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">30</text>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  next: svg('<path d="M5 4l10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>'),
};

const QUALITY = {
  original: { label: 'Original quality' },
  20000: { label: '20 Mbps · 1080p', res: '1920x1080' },
  12000: { label: '12 Mbps · 1080p', res: '1920x1080' },
  8000: { label: '8 Mbps · 1080p', res: '1920x1080' },
  4000: { label: '4 Mbps · 720p', res: '1280x720' },
  2000: { label: '2 Mbps · 720p', res: '1280x720' },
  1500: { label: '1.5 Mbps · 480p', res: '854x480' },
  720: { label: '720 kbps · 360p', res: '640x360' },
};

const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
};

export const plexViewerApp = {
  id: 'plexviewer', name: 'Plex Viewer', icon: appIcon.plexviewer, size: [1180, 760], description: 'Watch movies and shows from Plex',
  open(win, opts = {}) {
    if (!isConfigured('plex')) return clear(win.body, notConfigured('Plex', 'plex'));
    const v = new Viewer(win);
    v.start(opts);
    win.on('reopen', (o) => { if (o?.ratingKey) v.openKey(o.ratingKey, o.play); });
    win.on('close', () => v.player?.destroy());
  },
};

class Viewer {
  constructor(win) {
    this.win = win;
    this.history = [];
    this.tabs = h('div', { class: 'pxv-tabs' });
    this.search = h('input', { class: 'input pxv-search', type: 'search', placeholder: 'Search Plex…', 'aria-label': 'Search' });
    this.backBtn = h('button', { class: 'btn btn-icon pxv-back', title: 'Back', 'aria-label': 'Back', html: I.back, onclick: () => this.back() });
    this.page = h('div', { class: 'pxv-page' });
    this.root = h('div', { class: 'pxv' }, h('div', { class: 'pxv-bar' }, this.backBtn, this.tabs, this.search), this.page);
    win.body.append(this.root);
    this.search.addEventListener('input', debounce(() => {
      const q = this.search.value.trim();
      if (q.length >= 2) this.go({ view: 'search', q }, true);
      else if (!q && this.current?.view === 'search') this.back();
    }, 350));
  }

  async start(opts) {
    try {
      this.sections = ((await plexGet('library/sections')).Directory || []).filter((s) => s.type === 'movie' || s.type === 'show');
    } catch (err) { clear(this.page, errorState(err, () => this.start(opts))); return; }
    clear(this.tabs,
      h('button', { class: 'pxv-tab', dataset: { view: 'home' }, onclick: () => this.go({ view: 'home' }, false, true) }, h('span', { html: icon.home }), h('span', {}, 'Home')),
      this.sections.map((s) => h('button', { class: 'pxv-tab', dataset: { view: `lib-${s.key}` }, onclick: () => this.go({ view: 'library', key: s.key }, false, true) },
        h('span', { html: SECTION_ICON[s.type] }), h('span', {}, s.title))));
    this.go({ view: 'home' }, false, true);
    if (opts.ratingKey) this.openKey(opts.ratingKey, opts.play);
  }

  // Navigation: `push` keeps the current page for Back; `reset` starts over from a tab.
  go(state, push = true, reset = false) {
    if (reset) this.history = [];
    else if (push && this.current) this.history.push({ ...this.current, scroll: this.page.scrollTop });
    this.current = state;
    this.render(state);
  }
  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.current = prev;
    if (prev.view !== 'search') this.search.value = '';
    this.render(prev, prev.scroll);
  }

  render(state, scroll = 0) {
    this.backBtn.hidden = !this.history.length;
    const tabKey = state.view === 'library' ? `lib-${state.key}` : state.view === 'home' ? 'home' : null;
    this.tabs.querySelectorAll('.pxv-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === tabKey));
    clear(this.page, spinner());
    this.page.scrollTop = 0;
    const done = () => { if (scroll) this.page.scrollTop = scroll; };
    const views = { home: () => this.home(), library: () => this.library(state), item: () => this.item(state.key), search: () => this.searchView(state.q) };
    Promise.resolve(views[state.view]?.()).then(done).catch((err) => clear(this.page, errorState(err, () => this.render(state))));
  }

  open(m) {
    if (m.type === 'movie' || m.type === 'show' || m.type === 'season' || m.type === 'episode') this.go({ view: 'item', key: m.ratingKey });
  }

  async openKey(ratingKey, play) {
    if (play) {
      const m = ((await plexGet(`library/metadata/${ratingKey}`).catch(() => ({}))).Metadata || [])[0];
      if (m && (m.type === 'movie' || m.type === 'episode')) { this.go({ view: 'item', key: m.type === 'episode' ? m.grandparentRatingKey || ratingKey : ratingKey }); return this.play(m); }
    }
    this.go({ view: 'item', key: ratingKey });
  }

  row(title, list, { wide = false } = {}) {
    if (!list?.length) return null;
    return h('section', { class: 'shelf' }, h('h3', { class: 'section-title' }, title),
      h('div', { class: 'shelf-row' }, list.map((m) => plexCard(m, () => (wide && (m.type === 'movie' || m.type === 'episode') ? this.play(m) : this.open(m)), { wide }))));
  }

  // ---- Home ----

  async home() {
    const size = { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 24 };
    const [cont, deck, ...recent] = await Promise.all([
      appPref('plex', 'rowContinue') !== false ? plexGet('hubs/continueWatching/items', size).catch(() => plexGet('library/onDeck', size)).catch(() => ({})) : {},
      appPref('plex', 'rowOnDeck') !== false ? plexGet('library/onDeck', size).catch(() => ({})) : {},
      ...(appPref('plex', 'rowRecent') !== false ? this.sections.map((s) => plexGet(`library/sections/${s.key}/recentlyAdded`, size).catch(() => ({}))) : []),
    ]);
    const contList = cont.Metadata || [];
    const seen = new Set(contList.map((m) => m.ratingKey));
    const deckList = (deck.Metadata || []).filter((m) => !seen.has(m.ratingKey));
    const hero = contList[0] || recent.flatMap((r) => r.Metadata || [])[0];
    const rows = [
      hero ? this.hero(hero) : null,
      this.row('Continue watching', contList, { wide: true }),
      this.row('On deck', deckList, { wide: true }),
      ...recent.map((r, i) => this.row(`Recently added in ${this.sections[i].title}`, r.Metadata || [])),
    ].filter(Boolean);
    clear(this.page, rows.length ? rows : emptyState('Nothing here yet', 'Add media to your Plex libraries.'));
  }

  hero(m) {
    const art = artOf(m);
    const resume = m.viewOffset && (m.type === 'movie' || m.type === 'episode');
    return h('div', { class: 'pxv-hero', style: art ? { backgroundImage: `url("${art}")` } : {} },
      h('div', { class: 'pxv-hero-shade' }),
      h('div', { class: 'pxv-hero-body' },
        h('div', { class: 'pxv-hero-kicker' }, resume ? 'Pick up where you left off' : 'Recently added'),
        h('h2', {}, titleOf(m)),
        h('div', { class: 'muted' }, subOf(m)),
        m.summary ? h('p', { class: 'pxv-hero-summary' }, m.summary) : null,
        h('div', { class: 'btn-row' },
          m.type === 'movie' || m.type === 'episode'
            ? h('button', { class: 'btn btn-primary', onclick: () => this.play(m) }, h('span', { html: I.play }), resume ? `Resume · ${msToTime(m.duration - m.viewOffset)} left` : 'Play') : null,
          h('button', { class: 'btn', onclick: () => this.open(m.type === 'episode' ? { type: 'show', ratingKey: m.grandparentRatingKey } : m) }, 'More info'))));
  }

  // ---- Library ----

  async library({ key }) {
    const section = this.sections.find((s) => s.key === key);
    const sort = h('select', { class: 'input', 'aria-label': 'Sort' }, [['titleSort', 'Name'], ['addedAt:desc', 'Recently added'], ['originallyAvailableAt:desc', 'Release date'], ['rating:desc', 'Rating'], ['lastViewedAt:desc', 'Recently watched']]
      .map(([v, l]) => h('option', { value: v, selected: v === (this.sortFor?.[key] || 'titleSort') }, l)));
    const genre = h('select', { class: 'input', 'aria-label': 'Genre' }, h('option', { value: '' }, 'All genres'));
    const unwatched = h('input', { type: 'checkbox' });
    const count = h('span', { class: 'muted small' });
    const grid = h('div', { class: 'poster-grid' });
    const more = h('button', { class: 'btn load-more' }, 'Load more');
    clear(this.page, h('div', { class: 'pxv-lib' },
      h('div', { class: 'toolbar' }, h('h2', {}, section?.title || 'Library'), count, h('div', { class: 'grow' }), genre, sort, h('label', { class: 'check small' }, unwatched, ' Unwatched')),
      grid, more));
    plexGet(`library/sections/${key}/genre`).then((g) => genre.append(...(g.Directory || []).map((d) => h('option', { value: d.key }, d.title)))).catch(() => {});
    let start = 0;
    const load = async (reset) => {
      if (reset) { start = 0; clear(grid, spinner()); }
      more.disabled = true;
      try {
        const mc = await plexGet(`library/sections/${key}/all`, { sort: sort.value, genre: genre.value || undefined, unwatched: unwatched.checked ? 1 : undefined, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 90 });
        if (reset) clear(grid);
        const list = mc.Metadata || [];
        const total = mc.totalSize ?? list.length;
        start += list.length;
        grid.append(...list.map((m) => plexCard(m, () => this.open(m))));
        count.textContent = `${total.toLocaleString()} ${section?.type === 'show' ? 'shows' : 'movies'}`;
        if (!total) clear(grid, emptyState('Nothing matches'));
        more.style.display = start < total ? '' : 'none';
      } catch (err) { clear(grid, errorState(err, () => load(true))); }
      more.disabled = false;
    };
    more.onclick = () => load(false);
    sort.onchange = () => { (this.sortFor ||= {})[key] = sort.value; load(true); };
    genre.onchange = () => load(true);
    unwatched.onchange = () => load(true);
    await load(true);
  }

  // ---- Search ----

  async searchView(q) {
    const mc = await plexGet('hubs/search', { query: q, limit: 30 });
    const hubs = (mc.Hub || []).filter((x) => ['movie', 'show', 'episode'].includes(x.type) && x.Metadata?.length);
    clear(this.page, h('h2', { class: 'pxv-h' }, `Results for “${q}”`),
      hubs.length ? hubs.map((x) => this.row(x.title, x.Metadata, { wide: x.type === 'episode' })) : emptyState('Nothing found', 'Try a different title.'));
  }

  // ---- Movie / show / season ----

  async item(key) {
    const m = ((await plexGet(`library/metadata/${key}`)).Metadata || [])[0];
    if (!m) throw new Error('This item is no longer in Plex');
    if (m.type === 'episode') { this.current.key = m.grandparentRatingKey; await this.item(m.grandparentRatingKey); return; }
    const art = artOf(m);
    const watchBtn = h('button', { class: 'btn' });
    let watched = isWatched(m);
    const paintWatch = () => clear(watchBtn, h('span', { html: icon.check }), watched ? 'Watched' : 'Mark watched');
    paintWatch();
    watchBtn.classList.toggle('on', watched);
    watchBtn.onclick = async () => {
      try { await scrobble(m, !watched); watched = !watched; paintWatch(); watchBtn.classList.toggle('on', watched); if (m.type !== 'movie') this.render(this.current, this.page.scrollTop); }
      catch (err) { toastError(err); }
    };
    let playTarget = m.type === 'movie' ? m : null;
    let seasons = [];
    if (m.type === 'show') {
      seasons = (await plexGet(`library/metadata/${key}/children`)).Metadata || [];
      playTarget = await this.nextUnwatched(key);
    }
    const media = m.Media?.[0];
    const crew = (role) => (m[role] || []).slice(0, 3).map((x) => x.tag).join(', ');
    const resume = playTarget?.viewOffset;
    const playLabel = !playTarget ? null : resume ? `Resume${m.type === 'show' ? ` S${playTarget.parentIndex} E${playTarget.index}` : ''} · ${msToTime(playTarget.duration - playTarget.viewOffset)} left`
      : m.type === 'show' ? `Play S${playTarget.parentIndex} E${playTarget.index}` : 'Play';
    const head = h('div', { class: 'pxv-detail', style: art ? { '--art': `url("${art}")` } : {} },
      h('div', { class: 'pxv-detail-shade' }),
      h('div', { class: 'pxv-detail-body' },
        h('div', { class: 'pxv-detail-poster' }, posterOf(m, 400) ? h('img', { src: posterOf(m, 400), alt: '' }) : null),
        h('div', { class: 'pxv-detail-info' },
          h('h2', {}, m.title),
          h('div', { class: 'pxv-meta' }, [m.year, m.type === 'movie' && m.duration ? msToTime(m.duration) : null, m.contentRating, m.type === 'show' && m.childCount ? `${m.childCount} season${m.childCount === 1 ? '' : 's'}` : null,
            m.audienceRating || m.rating ? `★ ${(m.audienceRating || m.rating).toFixed(1)}` : null].filter(Boolean).join(' · ')),
          media ? h('div', { class: 'chips' }, [media.videoResolution ? badge(/^\d+$/.test(media.videoResolution) ? `${media.videoResolution}p` : media.videoResolution.toUpperCase()) : null,
            media.videoCodec ? badge(media.videoCodec.toUpperCase()) : null, media.audioCodec ? badge(`${media.audioCodec.toUpperCase()} ${media.audioChannels || ''}${media.audioChannels ? 'ch' : ''}`.trim()) : null].filter(Boolean)) : null,
          m.tagline ? h('div', { class: 'pxv-tagline' }, m.tagline) : null,
          h('p', { class: 'pxv-summary' }, m.summary || ''),
          (m.Genre || []).length ? h('div', { class: 'small muted' }, (m.Genre || []).map((g) => g.tag).join(', ')) : null,
          crew('Director') ? h('div', { class: 'small muted' }, `Directed by ${crew('Director')}`) : null,
          crew('Role') ? h('div', { class: 'small muted' }, `Starring ${crew('Role')}`) : null,
          playTarget?.viewOffset ? h('div', { class: 'pxv-resume-bar' }, h('div', { style: { width: `${progressOf(playTarget)}%` } })) : null,
          h('div', { class: 'btn-row' },
            playTarget ? h('button', { class: 'btn btn-primary', onclick: () => this.play(playTarget) }, h('span', { html: I.play }), playLabel) : null,
            resume ? h('button', { class: 'btn', onclick: () => this.play(playTarget, { fromStart: true }) }, 'Play from start') : null,
            watchBtn,
            h('button', { class: 'btn btn-icon', title: 'Manage in Plex', 'aria-label': 'Manage in Plex', html: appIcon.plex, onclick: () => openApp('plex', { ratingKey: m.ratingKey }) })))));
    const parts = [head];
    if (m.type === 'show' && seasons.length) {
      const seasonSel = h('div', { class: 'pxv-seasons' });
      const episodes = h('div', { class: 'pxv-episodes' });
      const pick = (s) => {
        seasonSel.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === String(s.ratingKey)));
        this.seasonFor = { ...this.seasonFor, [key]: s.ratingKey };
        this.episodes(episodes, s.ratingKey);
      };
      seasons.forEach((s) => seasonSel.append(h('button', { class: 'pxv-season', dataset: { key: s.ratingKey }, onclick: () => pick(s) }, s.title,
        s.leafCount ? h('span', { class: 'small muted' }, ` ${s.viewedLeafCount || 0}/${s.leafCount}`) : null)));
      parts.push(h('section', { class: 'pxv-section' }, seasonSel, episodes));
      const initial = seasons.find((s) => s.ratingKey === this.seasonFor?.[key])
        || seasons.find((s) => playTarget && String(s.ratingKey) === String(playTarget.parentRatingKey)) || seasons.find((s) => s.index > 0) || seasons[0];
      pick(initial);
    }
    if (m.type === 'movie' && media) {
      const part = media.Part?.[0];
      parts.push(h('dl', { class: 'facts pxv-facts' }, [
        ['Video', [media.videoResolution, media.videoCodec?.toUpperCase(), media.bitrate ? `${(media.bitrate / 1000).toFixed(1)} Mbps` : null].filter(Boolean).join(' · ')],
        ['Audio', (part?.Stream || []).filter((s) => s.streamType === 2).map((s) => s.displayTitle || s.language).join(', ') || media.audioCodec],
        ['Subtitles', (part?.Stream || []).filter((s) => s.streamType === 3).map((s) => s.displayTitle || s.language).join(', ') || 'None'],
        part?.size ? ['Size', formatBytes(part.size)] : null,
      ].filter(Boolean).map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])));
    }
    clear(this.page, parts);
  }

  async episodes(el, seasonKey) {
    clear(el, spinner());
    try {
      const list = (await plexGet(`library/metadata/${seasonKey}/children`)).Metadata || [];
      clear(el, list.length ? list.map((e) => h('div', { class: `pxv-ep ${isWatched(e) ? 'watched' : ''}` },
        h('button', { class: 'pxv-ep-still', 'aria-label': `Play ${e.title}`, onclick: () => this.play(e) },
          stillOf(e, 320) ? h('img', { src: stillOf(e, 320), loading: 'lazy', alt: '', onerror: (ev) => ev.target.remove() }) : null,
          h('span', { class: 'pxv-ep-play', html: I.play }),
          progressOf(e) ? h('span', { class: 'pxv-ep-progress', style: { width: `${progressOf(e)}%` } }) : null),
        h('div', { class: 'pxv-ep-info' },
          h('div', { class: 'pxv-ep-title' }, h('strong', {}, `${e.index ?? ''}. ${e.title}`), isWatched(e) ? h('span', { class: 'pxv-ep-check', html: icon.check }) : null),
          h('div', { class: 'small muted' }, [msToTime(e.duration), e.originallyAvailableAt].filter(Boolean).join(' · ')),
          h('p', { class: 'small pxv-ep-summary' }, e.summary || ''),
          h('button', { class: 'btn btn-sm pxv-ep-mark', onclick: async (ev) => {
            ev.stopPropagation();
            try { await scrobble(e, !isWatched(e)); this.episodes(el, seasonKey); } catch (err) { toastError(err); }
          } }, isWatched(e) ? 'Mark unwatched' : 'Mark watched'))))
        : emptyState('No episodes'));
    } catch (err) { clear(el, errorState(err, () => this.episodes(el, seasonKey))); }
  }

  // The episode to play next in a show: one in progress, else the first unwatched.
  async nextUnwatched(showKey) {
    const leaves = ((await plexGet(`library/metadata/${showKey}/allLeaves`).catch(() => ({}))).Metadata || [])
      .filter((e) => e.parentIndex !== 0).sort((a, b) => a.parentIndex - b.parentIndex || a.index - b.index);
    return leaves.find((e) => e.viewOffset) || leaves.find((e) => !isWatched(e)) || leaves[0] || null;
  }

  async nextEpisode(ep) {
    const leaves = ((await plexGet(`library/metadata/${ep.grandparentRatingKey}/allLeaves`).catch(() => ({}))).Metadata || [])
      .filter((e) => e.parentIndex !== 0).sort((a, b) => a.parentIndex - b.parentIndex || a.index - b.index);
    const i = leaves.findIndex((e) => String(e.ratingKey) === String(ep.ratingKey));
    return i >= 0 ? leaves[i + 1] || null : null;
  }

  // ---- Playing ----

  async play(m, { fromStart = false } = {}) {
    this.player?.destroy();
    let full = m;
    try { full = ((await plexGet(`library/metadata/${m.ratingKey}`)).Metadata || [])[0] || m; } catch { /* play with what we have */ }
    this.player = new Player(this, full, { start: fromStart ? 0 : (full.viewOffset || 0) / 1000 });
  }

  refresh() { if (this.current) this.render(this.current, this.page.scrollTop); }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

let hlsModule = null;
const loadHls = () => (hlsModule ||= import('/vendor/hlsjs/hls.light.min.mjs').then((x) => x.default));
const nativeHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

class Player {
  constructor(viewer, m, { start = 0 } = {}) {
    this.viewer = viewer;
    this.m = m;
    this.duration = (m.duration || 0) / 1000;
    this.offset = 0;
    this.session = `mediadesk-${Math.random().toString(36).slice(2, 12)}`;
    this.quality = String(appPref('plex', 'quality') || 'original');
    this.part = m.Media?.[0]?.Part?.[0];
    const streams = this.part?.Stream || [];
    this.audio = streams.filter((s) => s.streamType === 2);
    this.subs = streams.filter((s) => s.streamType === 3);
    this.audioId = (this.audio.find((s) => s.selected) || this.audio[0])?.id;
    this.subId = this.subs.find((s) => s.selected)?.id || 0;
    this.lastReport = 0;
    this.build();
    this.load(start);
  }

  build() {
    const m = this.m;
    this.video = h('video', { class: 'pxv-video', playsinline: true, autoplay: true });
    this.busy = h('div', { class: 'pv-busy' }, h('div', { class: 'spinner' }));
    this.msg = h('div', { class: 'pxv-player-msg', hidden: true });
    this.playBtn = h('button', { class: 'pv-ctl', title: 'Play/pause (space)', 'aria-label': 'Play or pause', html: I.pause });
    this.time = h('span', { class: 'pv-time' }, '0:00');
    this.total = h('span', { class: 'pv-time muted' }, fmtClock(this.duration));
    this.seek = h('input', { type: 'range', class: 'pv-seek', min: 0, max: Math.max(1, this.duration), step: 1, value: 0, 'aria-label': 'Position' });
    this.vol = h('input', { type: 'range', class: 'pv-vol', min: 0, max: 1, step: 0.02, value: 1, 'aria-label': 'Volume' });
    this.muteBtn = h('button', { class: 'pv-ctl', title: 'Mute (m)', 'aria-label': 'Mute', html: I.volume });
    this.fullBtn = h('button', { class: 'pv-ctl', title: 'Full screen (f)', 'aria-label': 'Full screen', html: I.full });
    this.gearBtn = h('button', { class: 'pv-ctl', title: 'Quality, audio and subtitles', 'aria-label': 'Settings', html: I.gear });
    this.nextBtn = m.type === 'episode' ? h('button', { class: 'pv-ctl', title: 'Next episode', 'aria-label': 'Next episode', html: I.next, onclick: () => this.playNext() }) : null;
    this.menu = h('div', { class: 'pxv-menu', hidden: true });
    this.upNext = h('div', { class: 'pxv-upnext', hidden: true });
    const closeBtn = h('button', { class: 'pv-ctl pxv-close', title: 'Close (Esc)', 'aria-label': 'Close player', html: I.back, onclick: () => this.destroy() });
    const top = h('div', { class: 'pxv-top' }, closeBtn, h('div', { class: 'pxv-top-title' }, h('strong', {}, titleOf(m)), h('span', { class: 'muted' }, m.type === 'episode' ? subOf(m) : m.year || '')));
    const controls = h('div', { class: 'pv-controls pxv-controls' },
      this.playBtn,
      h('button', { class: 'pv-ctl', title: 'Back 10 seconds', 'aria-label': 'Back 10 seconds', html: I.back10, onclick: () => this.jump(-10) }),
      h('button', { class: 'pv-ctl', title: 'Forward 30 seconds', 'aria-label': 'Forward 30 seconds', html: I.fwd30, onclick: () => this.jump(30) }),
      this.time, this.seek, this.total, this.nextBtn, this.muteBtn, this.vol, this.gearBtn, this.fullBtn);
    this.el = h('div', { class: 'pxv-player', tabindex: 0 }, this.video, this.busy, this.msg, top, this.upNext, this.menu, controls);
    this.viewer.root.append(this.el);
    this.el.focus({ preventScroll: true });

    const v = this.video;
    v.addEventListener('waiting', () => { this.busy.hidden = false; });
    v.addEventListener('playing', () => { this.busy.hidden = true; this.msg.hidden = true; this.playBtn.innerHTML = I.pause; this.report('playing'); });
    v.addEventListener('pause', () => { this.playBtn.innerHTML = I.play; if (!this.closing) this.report('paused', true); });
    v.addEventListener('timeupdate', () => this.tick());
    v.addEventListener('ended', () => this.ended());
    v.addEventListener('click', () => this.toggle());
    v.addEventListener('dblclick', () => this.fullBtn.click());
    this.playBtn.onclick = () => this.toggle();
    this.seek.addEventListener('input', () => { this.seeking = true; this.time.textContent = fmtClock(Number(this.seek.value)); this.paintSeek(Number(this.seek.value)); });
    this.seek.addEventListener('change', () => { this.seeking = false; this.load(Number(this.seek.value)); });
    this.vol.addEventListener('input', () => { v.volume = Number(this.vol.value); v.muted = false; this.muteBtn.innerHTML = v.volume ? I.volume : I.mute; });
    this.muteBtn.onclick = () => { v.muted = !v.muted; this.muteBtn.innerHTML = v.muted ? I.mute : I.volume; };
    this.fullBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : this.el.requestFullscreen?.().catch(() => {}));
    this.gearBtn.onclick = (e) => { e.stopPropagation(); this.menu.hidden ? this.showMenu() : (this.menu.hidden = true); };
    this.el.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target) && e.target !== this.gearBtn) this.menu.hidden = true; });
    this.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input[type=search], select')) return;
      const k = e.key;
      if (k === ' ' || k === 'k') { e.preventDefault(); this.toggle(); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.jump(30); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.jump(-10); }
      else if (k === 'f') this.fullBtn.click();
      else if (k === 'm') this.muteBtn.click();
      else if (k === 'Escape' && !document.fullscreenElement) { if (!this.menu.hidden) this.menu.hidden = true; else this.destroy(); }
    });
    // Hide the controls while watching.
    let idle;
    const wake = () => { this.el.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => { if (!v.paused && this.menu.hidden) this.el.classList.add('idle'); }, 3000); };
    this.el.addEventListener('pointermove', wake);
    this.el.addEventListener('pointerdown', wake);
    wake();
    this.reportTimer = setInterval(() => { if (!v.paused) this.report('playing', true); }, 10000);
    this.unload = () => this.report('stopped', true, true);
    addEventListener('pagehide', this.unload);
  }

  position() { return this.offset + (this.video.currentTime || 0); }
  paintSeek(p) { this.seek.style.setProperty('--pct', `${this.duration ? (p / this.duration) * 100 : 0}%`); }

  tick() {
    if (this.seeking) return;
    const p = this.position();
    this.time.textContent = fmtClock(p);
    this.seek.value = String(p);
    this.paintSeek(p);
    // Offer the next episode during the credits.
    if (this.m.type === 'episode' && this.duration && p > this.duration - 30 && this.upNext.hidden && !this.upNextShown && appPref('plex', 'autoplayNext') !== false) {
      this.upNextShown = true;
      this.showUpNext();
    }
  }

  toggle() { if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause(); }
  jump(by) { this.load(this.position() + by); }

  streamUrl(start) {
    const q = QUALITY[this.quality] || QUALITY.original;
    const params = {
      path: `/library/metadata/${this.m.ratingKey}`, mediaIndex: 0, partIndex: 0, protocol: 'hls', offset: Math.floor(start),
      fastSeek: 1, directPlay: 0, directStream: 1, directStreamAudio: 1, copyts: 1, location: 'lan', session: this.session,
      subtitles: this.subId ? 'burn' : 'none', subtitleSize: 100, audioBoost: 100, autoAdjustQuality: 0, hasMDE: 1,
      'X-Plex-Session-Identifier': this.session, 'X-Plex-Platform': 'Chrome', 'X-Plex-Product': 'Plex Web',
    };
    if (q.res) Object.assign(params, { maxVideoBitrate: this.quality, videoResolution: q.res, videoQuality: 100 });
    return plex.url('video/:/transcode/universal/start.m3u8', params);
  }

  async load(start) {
    this.offset = Math.max(0, Math.min(start, Math.max(0, this.duration - 2)));
    this.busy.hidden = false;
    this.msg.hidden = true;
    this.paintSeek(this.offset);
    // Plex keeps converting the old position until it's told to stop.
    if (this.started) await this.stopTranscode();
    this.started = true;
    this.session = `mediadesk-${Math.random().toString(36).slice(2, 12)}`;
    const url = this.streamUrl(this.offset);
    this.hls?.destroy();
    this.hls = null;
    const v = this.video;
    try {
      const Hls = await loadHls();
      if (Hls.isSupported()) {
        this.hls = new Hls({ maxBufferLength: 30, xhrSetup: (xhr) => xhr.setRequestHeader('X-MediaDesk', '1') });
        this.hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.recovered) { this.recovered = true; this.hls.recoverMediaError(); return; }
          this.fail(data.response?.code === 503 || data.response?.code === 400 ? 'Plex couldn’t convert this video. Try a lower quality (⚙).' : `Playback stopped (${data.details}).`);
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(v);
      } else if (nativeHls()) {
        v.src = url;
      } else throw new Error('This browser can’t play Plex streams');
    } catch (err) {
      if (nativeHls()) v.src = url; else return this.fail(err.message);
    }
    v.play().catch(() => { this.playBtn.innerHTML = I.play; this.busy.hidden = true; });
  }

  fail(text) {
    this.busy.hidden = true;
    clear(this.msg, h('div', {}, text), h('button', { class: 'btn btn-sm', onclick: () => this.load(this.position()) }, 'Try again'));
    this.msg.hidden = false;
  }

  stopTranscode() { return plex.get('video/:/transcode/universal/stop', { session: this.session }).catch(() => {}); }

  report(state, force = false, beacon = false) {
    const now = Date.now();
    if (!force && now - this.lastReport < 9000) return;
    this.lastReport = now;
    const params = { ratingKey: this.m.ratingKey, key: `/library/metadata/${this.m.ratingKey}`, state, time: Math.round(this.position() * 1000), duration: this.m.duration || 0, 'X-Plex-Session-Identifier': this.session };
    if (beacon) {
      // Still delivered when the page is closing.
      fetch(plex.url(':/timeline', params), { method: 'GET', keepalive: true, headers: { 'X-MediaDesk': '1', Accept: 'application/json' }, credentials: 'same-origin' }).catch(() => {});
      return;
    }
    plex.get(':/timeline', params).catch(() => {});
  }

  showMenu() {
    const sel = (label, options, value, onPick) => {
      const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
      s.onchange = () => onPick(s.value);
      return h('label', { class: 'pxv-menu-row' }, h('span', {}, label), s);
    };
    const streamName = (s) => s.displayTitle || [s.language, s.codec?.toUpperCase()].filter(Boolean).join(' · ') || `Track ${s.index}`;
    clear(this.menu,
      sel('Quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]), this.quality, (v) => { this.quality = v; this.menu.hidden = true; this.load(this.position()); }),
      this.audio.length > 1 ? sel('Audio', this.audio.map((s) => [s.id, streamName(s)]), this.audioId, (v) => this.pickStreams({ audioStreamID: v })) : null,
      sel('Subtitles', [[0, 'Off'], ...this.subs.map((s) => [s.id, streamName(s)])], this.subId, (v) => this.pickStreams({ subtitleStreamID: v })),
      h('div', { class: 'small muted pxv-menu-note' }, 'Plex converts the video on the server when needed. Lower the quality if it stutters.'));
    this.menu.hidden = false;
  }

  // Plex plays the audio and subtitle tracks chosen on the file, like Plex Web does.
  async pickStreams(change) {
    this.menu.hidden = true;
    if (!this.part?.id) return;
    try {
      await plex.put(`library/parts/${this.part.id}`, undefined, { ...change, allParts: 1 });
      if (change.audioStreamID) this.audioId = Number(change.audioStreamID);
      if (change.subtitleStreamID !== undefined) this.subId = Number(change.subtitleStreamID);
      this.load(this.position());
    } catch (err) { toastError(err, 'Could not change the track'); }
  }

  async showUpNext() {
    const next = await this.viewer.nextEpisode(this.m);
    if (!next || this.closing) return;
    this.next = next;
    let left = 10;
    const count = h('span', {}, `${left}`);
    clear(this.upNext,
      stillOf(next, 240) ? h('img', { src: stillOf(next, 240), alt: '' }) : null,
      h('div', { class: 'pxv-upnext-body' },
        h('div', { class: 'small muted' }, 'Up next'),
        h('strong', {}, `S${next.parentIndex} E${next.index} · ${next.title}`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: () => this.playNext() }, h('span', { html: I.play }), 'Play now (', count, ')'),
          h('button', { class: 'btn btn-sm', onclick: () => { clearInterval(this.upNextTimer); this.upNext.hidden = true; } }, 'Cancel'))));
    this.upNext.hidden = false;
    this.upNextTimer = setInterval(() => { left -= 1; count.textContent = `${left}`; if (left <= 0) this.playNext(); }, 1000);
  }

  async playNext() {
    clearInterval(this.upNextTimer);
    const next = this.next || await this.viewer.nextEpisode(this.m);
    if (!next) { toast('That was the last episode', { icon: appIcon.plexviewer }); return; }
    this.viewer.play(next, { fromStart: true });
  }

  ended() {
    this.report('stopped', true);
    if (this.m.type === 'episode' && appPref('plex', 'autoplayNext') !== false) this.playNext();
    else this.destroy();
  }

  destroy() {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.reportTimer);
    clearInterval(this.upNextTimer);
    removeEventListener('pagehide', this.unload);
    this.report('stopped', true);
    this.stopTranscode();
    this.hls?.destroy();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
    this.el.remove();
    if (this.viewer.player === this) this.viewer.player = null;
    // Progress changed; show it.
    setTimeout(() => this.viewer.refresh(), 400);
  }
}
