// Demo-mode stand-in for a Plex Media Server (see mock.js). It answers the Plex API calls the Plex
// and Plex Viewer apps make, using the same sample films and shows as the other demo services, and
// serves a short generated HLS stream so the player has something to play (needs ffmpeg).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const DAY = 864e5;

function createMockPlex({ movies, series, episodes, posterSvg, overview, hash }) {
  const now = Date.now();
  const sec = (t) => Math.floor(t / 1000);
  const MACHINE = 'mockplex0001';
  const items = new Map();       // ratingKey -> metadata
  const children = new Map();    // ratingKey -> [ratingKeys]
  const add = (m) => { items.set(String(m.ratingKey), m); return m; };
  const thumbOf = (rk) => `/library/metadata/${rk}/thumb/1700000000`;
  const artOf = (rk) => `/library/metadata/${rk}/art/1700000000`;
  let partId = 9000;

  const media = (i, { hevc = i % 3 !== 0, minutes = 110 } = {}) => {
    const pid = partId++;
    return [{
      id: pid, duration: minutes * 60e3, bitrate: 8200 + (i % 5) * 1500, width: 1920, height: 1080, aspectRatio: 1.78,
      audioChannels: i % 2 ? 6 : 2, audioCodec: i % 2 ? 'eac3' : 'aac', videoCodec: hevc ? 'hevc' : 'h264', videoResolution: '1080', container: 'mkv', videoFrameRate: '24p',
      Part: [{
        id: pid, key: `/library/parts/${pid}/1700000000/file.mkv`, duration: minutes * 60e3, file: `/media/file-${pid}.mkv`, size: 4.2e9 + (i % 7) * 7e8, container: 'mkv',
        Stream: [
          { id: pid * 10 + 1, streamType: 1, codec: hevc ? 'hevc' : 'h264', displayTitle: `1080p (${hevc ? 'HEVC Main 10' : 'H.264'})`, selected: true },
          { id: pid * 10 + 2, streamType: 2, codec: i % 2 ? 'eac3' : 'aac', language: 'English', languageCode: 'eng', displayTitle: `English (${i % 2 ? 'EAC3 5.1' : 'AAC Stereo'})`, selected: true },
          { id: pid * 10 + 3, streamType: 2, codec: 'aac', language: 'Français', languageCode: 'fra', displayTitle: 'Français (AAC Stereo)' },
          { id: pid * 10 + 4, streamType: 3, codec: 'srt', language: 'English', languageCode: 'eng', displayTitle: 'English (SRT)' },
          { id: pid * 10 + 5, streamType: 3, codec: 'srt', language: 'Español', languageCode: 'spa', displayTitle: 'Español (SRT)' },
        ],
      }],
    }];
  };

  // Films
  movies.filter((m) => m.hasFile).forEach((m, i) => add({
    ratingKey: String(1000 + m.id), key: `/library/metadata/${1000 + m.id}`, guid: `plex://movie/${hash(m.title)}`, type: 'movie', librarySectionID: 1, librarySectionTitle: 'Movies',
    title: m.title, titleSort: m.title.replace(/^(The|A|An) /, ''), year: m.year, summary: m.overview || overview, studio: 'Atlas Films', contentRating: m.certification || 'PG-13',
    rating: 6 + (hash(m.title) % 35) / 10, audienceRating: 6.5 + (hash(m.title + 'a') % 30) / 10, tagline: 'Every story has a second act.',
    duration: (m.runtime || 110) * 60e3, addedAt: sec(new Date(m.added).getTime()), updatedAt: sec(now), originallyAvailableAt: `${m.year}-06-14`,
    thumb: thumbOf(1000 + m.id), art: artOf(1000 + m.id), viewCount: i % 4 === 0 ? 1 : undefined, viewOffset: i % 6 === 1 ? (m.runtime || 110) * 60e3 * 0.4 : undefined, lastViewedAt: i % 4 === 0 ? sec(now - i * DAY) : undefined,
    Genre: (m.genres || ['Drama']).map((tag) => ({ tag })), Director: [{ tag: 'Ava Martins' }], Writer: [{ tag: 'Leo Grant' }],
    Role: ['Mara Quinn', 'Theo Vance', 'Isla Moreau', 'Dev Patel'].map((tag, k) => ({ tag, role: ['Captain Hale', 'Jonah', 'Dr. Lane', 'Marcus'][k], thumb: '' })),
    Media: media(i, { minutes: m.runtime || 110 }),
  }));

  // Shows → seasons → episodes
  series.forEach((s, i) => {
    const rk = 5000 + s.id;
    const eps = episodes.filter((e) => e.seriesId === s.id && e.hasFile);
    const seasons = [...new Set(eps.map((e) => e.seasonNumber))].sort((a, b) => a - b);
    const show = add({
      ratingKey: String(rk), key: `/library/metadata/${rk}/children`, type: 'show', librarySectionID: 2, librarySectionTitle: 'TV Shows', title: s.title, titleSort: s.title.replace(/^(The|A|An) /, ''),
      year: s.year, summary: s.overview || overview, studio: s.network, contentRating: 'TV-14', rating: 7 + (hash(s.title) % 25) / 10, thumb: thumbOf(rk), art: artOf(rk),
      addedAt: sec(new Date(s.added).getTime()), childCount: seasons.length, leafCount: eps.length, viewedLeafCount: Math.floor(eps.length * (i % 3) / 3),
      Genre: (s.genres || ['Drama']).map((tag) => ({ tag })), Role: [{ tag: 'June Park', role: 'Nova' }, { tag: 'Rafe Osei', role: 'Kit' }],
    });
    children.set(show.ratingKey, []);
    seasons.forEach((n) => {
      const srk = `${6000 + s.id * 10 + n}`;
      const sEps = eps.filter((e) => e.seasonNumber === n);
      add({ ratingKey: srk, key: `/library/metadata/${srk}/children`, type: 'season', title: `Season ${n}`, index: n, parentRatingKey: show.ratingKey, parentTitle: s.title,
        librarySectionID: 2, thumb: show.thumb, parentThumb: show.thumb, art: show.art, leafCount: sEps.length, viewedLeafCount: 0 });
      children.get(show.ratingKey).push(srk);
      children.set(srk, []);
      sEps.forEach((e, k) => {
        const erk = String(7000 + e.id);
        add({ ratingKey: erk, key: `/library/metadata/${erk}`, type: 'episode', title: e.title, index: e.episodeNumber, parentIndex: n,
          parentRatingKey: srk, grandparentRatingKey: show.ratingKey, grandparentTitle: s.title, parentTitle: `Season ${n}`, librarySectionID: 2,
          summary: overview, duration: 45 * 60e3, addedAt: sec(new Date(e.airDateUtc).getTime()), originallyAvailableAt: e.airDateUtc.slice(0, 10),
          thumb: artOf(erk), parentThumb: show.thumb, grandparentThumb: show.thumb, art: show.art, grandparentArt: show.art,
          viewCount: k < sEps.length - 2 && i % 2 ? 1 : undefined, viewOffset: k === sEps.length - 2 && i % 2 ? 45 * 60e3 * 0.3 : undefined, Media: media(e.id, { minutes: 45 }) });
        children.get(srk).push(erk);
      });
    });
  });

  // Music (enough for counts and browsing)
  const ARTISTS = ['The Lanterns', 'Velvet Sea', 'Aurora Kid', 'Echo Park'];
  ARTISTS.forEach((a, i) => {
    const rk = String(8000 + i);
    add({ ratingKey: rk, key: `/library/metadata/${rk}/children`, type: 'artist', title: a, librarySectionID: 3, thumb: thumbOf(rk), addedAt: sec(now - i * DAY), childCount: 1 });
    const alb = String(8100 + i);
    add({ ratingKey: alb, key: `/library/metadata/${alb}/children`, type: 'album', title: ['Midnight Static', 'Golden Hour Tapes', 'Northern Lights EP', 'City of Echoes'][i], parentTitle: a, parentRatingKey: rk, year: 2020 + i, librarySectionID: 3, thumb: thumbOf(alb), addedAt: sec(now - i * DAY), leafCount: 5 + i });
    children.set(rk, [alb]);
  });

  const sections = [
    { key: '1', type: 'movie', title: 'Movies', agent: 'tv.plex.agents.movie', scanner: 'Plex Movie', language: 'en-US', Location: [{ id: 1, path: '/media/movies' }] },
    { key: '2', type: 'show', title: 'TV Shows', agent: 'tv.plex.agents.series', scanner: 'Plex TV Series', language: 'en-US', Location: [{ id: 2, path: '/media/tv' }] },
    { key: '3', type: 'artist', title: 'Music', agent: 'tv.plex.agents.music', scanner: 'Plex Music', language: 'en-US', Location: [{ id: 3, path: '/media/music' }] },
  ].map((s) => ({ ...s, uuid: `uuid-${s.key}`, updatedAt: sec(now - DAY), scannedAt: sec(now - 3 * 3600e3), refreshing: false, thumb: `/:/resources/${s.type}.png` }));

  const topLevel = (key) => [...items.values()].filter((m) => String(m.librarySectionID) === String(key) && ['movie', 'show', 'artist'].includes(m.type));

  // Activities (library scans etc.)
  const activities = [];
  function startActivity(title, subtitle) {
    const a = { uuid: `act-${Date.now()}`, type: 'library.update.section', cancellable: false, userID: 1, title, subtitle, progress: 0 };
    activities.push(a);
    const t = setInterval(() => { a.progress += 12; if (a.progress >= 100) { clearInterval(t); activities.splice(activities.indexOf(a), 1); sections.forEach((s) => { s.refreshing = false; }); } }, 600);
    t.unref();
  }

  // Sessions
  const sessStart = Date.now();
  const firstMovie = [...items.values()].find((m) => m.type === 'movie');
  const someEpisode = [...items.values()].find((m) => m.type === 'episode');
  const sessions = [
    { id: 'plexsess1', user: 'alex', player: { title: 'Living Room Shield', product: 'Plex for Android (TV)', platform: 'Android', state: 'playing', address: '192.168.1.31', local: true }, item: firstMovie, offset: 0.27, decision: 'directplay' },
    { id: 'plexsess2', user: 'sam', player: { title: 'Chrome', product: 'Plex Web', platform: 'Chrome', state: 'playing', address: '73.14.22.9', local: false }, item: someEpisode, offset: 0.64, decision: 'transcode' },
  ];
  const sessionJson = (s, i) => ({
    ...s.item, sessionKey: String(i + 1), viewOffset: Math.min(s.item.duration, s.item.duration * s.offset + (s.player.state === 'playing' ? Date.now() - sessStart : 0)),
    User: { id: String(i + 1), title: s.user, thumb: '' }, Player: { ...s.player, machineIdentifier: `player-${i}` },
    Session: { id: s.id, bandwidth: s.decision === 'transcode' ? 6200 : 9800, location: s.player.local ? 'lan' : 'wan' },
    TranscodeSession: s.decision === 'transcode' ? { key: `/transcode/sessions/tc-${i}`, throttled: false, progress: 41.5, speed: 2.4, videoDecision: 'transcode', audioDecision: 'copy', container: 'mpegts', videoCodec: 'h264', audioCodec: 'aac', width: 1280, height: 720, transcodeHwRequested: true, transcodeHwFullPipeline: true, sourceVideoCodec: 'hevc' } : undefined,
  });

  const history = [...items.values()].filter((m) => m.type === 'movie' || m.type === 'episode').slice(0, 14).map((m, i) => ({
    historyKey: `/status/sessions/history/${i}`, ratingKey: m.ratingKey, title: m.title, type: m.type, grandparentTitle: m.grandparentTitle, parentIndex: m.parentIndex, index: m.index,
    thumb: m.thumb, viewedAt: sec(now - i * 7 * 3600e3), accountID: (i % 3) + 1, deviceID: i % 2 + 1,
  }));
  const accounts = [{ id: 1, name: 'alex', thumb: '' }, { id: 2, name: 'sam', thumb: '' }, { id: 3, name: 'jo', thumb: '' }];
  const butler = [
    ['BackupDatabase', 'Back up database', 'Create a backup copy of the server’s database in the configured backup directory', 3],
    ['CleanOldBundles', 'Remove old bundles', 'Remove old bundles from the server’s database', 7],
    ['CleanOldCacheFiles', 'Remove old cache files', 'Remove old cache files', 7],
    ['DeepMediaAnalysis', 'Perform extensive media analysis', 'Analyse bitrate information across media files to improve streaming', 1],
    ['GenerateChapterThumbs', 'Generate chapter thumbnails', 'Generate chapter thumbnails for video items', 1],
    ['OptimizeDatabase', 'Optimize database', 'Optimize the server’s database', 7],
    ['RefreshLibraries', 'Update all libraries', 'Scan all libraries for new or changed media', 1],
    ['RefreshPeriodicMetadata', 'Refresh metadata periodically', 'Refresh metadata for items in your libraries', 3],
    ['UpgradeMediaAnalysis', 'Upgrade media analysis', 'Re-analyse media to add information required by newer features', 1],
  ].map(([name, title, description, interval]) => ({ name, title, description, interval, enabled: true, scheduleRandomized: false }));

  // A short HLS stream for the player: VP9 + Opus in fragmented MP4, made with ffmpeg once.
  const hlsDir = path.join(os.tmpdir(), 'mediadesk-demo-plex-hls');
  let fullLength = false;
  const sessionLength = new Map();
  let hlsReady = null;
  function ensureHls() {
    if (hlsReady) return hlsReady;
    hlsReady = new Promise((resolve, reject) => {
      if (fs.existsSync(path.join(hlsDir, 'index.m3u8'))) return resolve(true);
      fs.mkdirSync(hlsDir, { recursive: true });
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
        '-t', '90', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '1500k', '-g', '48', '-pix_fmt', 'yuv420p',
        '-c:a', 'libopus', '-b:a', '96k', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(hlsDir, 'seg%03d.m4s'), path.join(hlsDir, 'index.m3u8')];
      let child;
      try { child = spawn('ffmpeg', args, { windowsHide: true }); } catch (e) { reject(e); return; }
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(true) : reject(new Error(`ffmpeg exited with ${code}`))));
    }).catch((e) => { hlsReady = null; throw e; });
    return hlsReady;
  }

  const container = (extra) => ({ MediaContainer: { size: (extra.Metadata || extra.Directory || []).length, ...extra } });
  function page(list, q, headers) {
    const start = Number(q.get('X-Plex-Container-Start') ?? headers['x-plex-container-start'] ?? 0);
    const size = Number(q.get('X-Plex-Container-Size') ?? headers['x-plex-container-size'] ?? list.length);
    return container({ totalSize: list.length, offset: start, Metadata: list.slice(start, start + size) });
  }
  const sortBy = (list, sort = 'titleSort') => {
    const [field, dir] = sort.split(':');
    const val = (m) => (field === 'titleSort' ? (m.titleSort || m.title).toLowerCase() : m[field] ?? 0);
    return [...list].sort((a, b) => { const x = val(a), y = val(b); const r = x < y ? -1 : x > y ? 1 : 0; return dir === 'desc' ? -r : r; });
  };
  const hub = (type, title, list, hubIdentifier) => ({ type, title, hubIdentifier, size: list.length, Metadata: list });

  function route(method, rest, q, headers) {
    const p = `/${rest}`;
    if (p === '/' ) return container({ friendlyName: 'media-server', version: '1.42.2.10156', platform: 'Linux', platformVersion: '24.04', machineIdentifier: MACHINE, myPlex: true, myPlexUsername: 'alex@example.com', myPlexSubscription: true, transcoderActiveVideoSessions: 1, updatedAt: sec(now) });
    if (p === '/identity') return container({ machineIdentifier: MACHINE, version: '1.42.2.10156' });
    if (p === '/library/sections') return container({ Directory: sections });
    let m;
    if ((m = /^\/library\/sections\/(\d+)\/all$/.exec(p))) {
      let list = topLevel(m[1]);
      const type = q.get('type');
      if (type === '4') list = [...items.values()].filter((x) => x.type === 'episode' && String(x.librarySectionID) === m[1]);
      if (q.get('unwatched') === '1') list = list.filter((x) => (x.type === 'show' ? x.viewedLeafCount < x.leafCount : !x.viewCount));
      const title = (q.get('title') || '').toLowerCase();
      if (title) list = list.filter((x) => x.title.toLowerCase().includes(title));
      const genre = q.get('genre');
      if (genre) list = list.filter((x) => x.Genre?.some((g) => g.tag === genre));
      return page(sortBy(list, q.get('sort') || 'titleSort'), q, headers);
    }
    if ((m = /^\/library\/sections\/(\d+)\/genre$/.exec(p))) {
      const tags = [...new Set(topLevel(m[1]).flatMap((x) => (x.Genre || []).map((g) => g.tag)))].sort();
      return container({ Directory: tags.map((t) => ({ key: t, title: t })) });
    }
    if ((m = /^\/library\/sections\/(\d+)\/refresh$/.exec(p))) {
      const s = sections.find((x) => x.key === m[1]);
      if (s) { s.refreshing = true; s.scannedAt = sec(Date.now()); startActivity(`Scanning ${s.title}`, 'Looking for new files'); }
      return null;
    }
    if (/^\/library\/sections\/\d+\/emptyTrash$/.test(p) || p === '/library/clean/bundles' || p === '/library/optimize') { startActivity(p.includes('optimize') ? 'Optimizing database' : p.includes('bundles') ? 'Cleaning bundles' : 'Emptying trash', ''); return null; }
    if ((m = /^\/library\/sections\/(\d+)$/.exec(p)) && method === 'GET') return container({ Directory: sections.filter((s) => s.key === m[1]) });
    if ((m = /^\/library\/metadata\/(\d+)$/.exec(p))) {
      const it = items.get(m[1]);
      if (!it) return { __status: 404, error: 'Not found' };
      if (method === 'DELETE') { items.delete(m[1]); return null; }
      return container({ Metadata: [it] });
    }
    if ((m = /^\/library\/metadata\/(\d+)\/children$/.exec(p))) return container({ Metadata: (children.get(m[1]) || []).map((k) => items.get(k)).filter(Boolean) });
    if ((m = /^\/library\/metadata\/(\d+)\/allLeaves$/.exec(p))) {
      const leaves = (children.get(m[1]) || []).flatMap((k) => (children.get(k) || [k])).map((k) => items.get(k)).filter((x) => x?.type === 'episode');
      return container({ Metadata: leaves });
    }
    if ((m = /^\/library\/metadata\/(\d+)\/refresh$/.exec(p))) { startActivity(`Refreshing ${items.get(m[1])?.title || 'item'}`, 'Updating metadata'); return null; }
    if (p === '/library/onDeck' || p === '/hubs/continueWatching/items') {
      const list = [...items.values()].filter((x) => x.viewOffset && (x.type === 'movie' || x.type === 'episode')).sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0));
      return container({ Metadata: list });
    }
    if (p === '/library/recentlyAdded' || (m = /^\/library\/sections\/(\d+)\/recentlyAdded$/.exec(p))) {
      let list = [...items.values()].filter((x) => ['movie', 'show', 'album'].includes(x.type));
      if (m) list = list.filter((x) => String(x.librarySectionID) === m[1]);
      return container({ Metadata: sortBy(list, 'addedAt:desc').slice(0, Number(q.get('X-Plex-Container-Size')) || 30) });
    }
    if (p === '/hubs/search') {
      const term = (q.get('query') || '').toLowerCase();
      const found = [...items.values()].filter((x) => ['movie', 'show', 'episode'].includes(x.type) && `${x.title} ${x.grandparentTitle || ''}`.toLowerCase().includes(term));
      return container({ Hub: [hub('movie', 'Movies', found.filter((x) => x.type === 'movie'), 'movie'), hub('show', 'Shows', found.filter((x) => x.type === 'show'), 'show'), hub('episode', 'Episodes', found.filter((x) => x.type === 'episode').slice(0, 10), 'episode')].filter((h) => h.size) });
    }
    if (p === '/:/scrobble' || p === '/:/unscrobble') {
      const it = items.get(q.get('key'));
      if (it) { if (p === '/:/scrobble') { it.viewCount = (it.viewCount || 0) + 1; it.viewOffset = undefined; it.lastViewedAt = sec(Date.now()); } else { it.viewCount = undefined; } }
      return null;
    }
    if (p === '/:/timeline') {
      const it = items.get(q.get('ratingKey'));
      if (it) {
        const t = Number(q.get('time')) || 0;
        if (q.get('state') === 'stopped' && t > it.duration * 0.9) { it.viewCount = (it.viewCount || 0) + 1; it.viewOffset = undefined; }
        else if (t > 60e3) { it.viewOffset = t; }
        it.lastViewedAt = sec(Date.now());
      }
      return container({});
    }
    if (p === '/status/sessions') return container({ Metadata: sessions.map(sessionJson) });
    if (p === '/status/sessions/terminate') { const i = sessions.findIndex((s) => s.id === q.get('sessionId')); if (i >= 0) sessions.splice(i, 1); return null; }
    if (p === '/status/sessions/history/all') return container({ Metadata: history });
    if (p === '/accounts') return container({ Account: accounts });
    if (p === '/transcode/sessions') return container({ TranscodeSession: sessions.filter((s) => s.decision === 'transcode').map((s, i) => sessionJson(s, i).TranscodeSession) });
    if (p === '/butler' && method === 'GET') return { ButlerTasks: { ButlerTask: butler } };
    if ((m = /^\/butler\/(\w+)$/.exec(p)) && method === 'POST') { const t = butler.find((b) => b.name === m[1]); if (t) startActivity(t.title, 'Running now'); return null; }
    if (p === '/butler' && method === 'DELETE') { activities.length = 0; return null; }
    if (p === '/activities') return container({ Activity: activities });
    if (p === '/updater/status') return container({ canInstall: false, checkedAt: sec(now - 5 * 3600e3), downloadURL: '', status: 0 });
    if (p === '/updater/check') return null;
    if (p === '/video/:/transcode/universal/stop') return null;
    return undefined;
  }

  async function handle(req, res, rest, url, { sendJson, sendRange }) {
    const q = url.searchParams;
    // Pictures
    let m = /^library\/metadata\/(\d+)\/(thumb|art)\//.exec(rest);
    if (rest.startsWith('photo/:/transcode')) m = /\/library\/metadata\/(\d+)\/(thumb|art)/.exec(q.get('url') || '');
    if (m) {
      const it = items.get(m[1]);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
      return res.end(posterSvg(it?.grandparentTitle || it?.title || 'Plex', m[2] === 'art' ? 'fanart' : 'poster'));
    }
    // Streaming
    // Real Plex servers send one of two kinds of stream: one starting at the requested offset (the
    // default here) or one covering the whole title from 0:00. GET plex/__mode?full=1 switches the
    // demo to the second kind, for testing the player against both.
    if (rest === '__mode') { fullLength = q.get('full') === '1'; return sendJson(res, 200, { fullLength }); }
    if (rest === 'video/:/transcode/universal/start.m3u8') {
      try { await ensureHls(); } catch { return sendJson(res, 503, { error: 'The demo player needs ffmpeg installed' }); }
      const session = q.get('session') || 'demo';
      const rk = /\/library\/metadata\/(\d+)/.exec(q.get('path') || '')?.[1];
      sessionLength.set(session, (items.get(rk)?.duration || 0) / 1000);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' });
      return res.end(`#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\nsession/${encodeURIComponent(session)}/base/index.m3u8\n`);
    }
    if ((m = /^video\/:\/transcode\/universal\/session\/[^/]+\/base\/([\w.]+)$/.exec(rest))) {
      const file = path.join(hlsDir, m[1]);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
      const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4';
      const sess = decodeURIComponent(rest.split('/')[5] || '');
      if (fullLength && m[1] === 'index.m3u8' && sessionLength.get(sess) > 120) {
        // Loop the 90-second clip until the playlist is as long as the whole title.
        const text = fs.readFileSync(file, 'utf8');
        const head = text.slice(0, text.indexOf('#EXTINF'));
        const body = text.slice(text.indexOf('#EXTINF')).replace('#EXT-X-ENDLIST', '').trim();
        const loops = Math.ceil(sessionLength.get(sess) / 90);
        const out = `${head}${Array.from({ length: loops }, (_, i) => body.replace(/^(seg\d+\.m4s)$/gm, `$1?loop=${i}`)).join('\n#EXT-X-DISCONTINUITY\n')}\n#EXT-X-ENDLIST\n`;
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(out);
      }
      return sendRange(req, res, fs.readFileSync(file), type);
    }
    let out;
    try { out = route(req.method, rest, q, req.headers); } catch (err) { return sendJson(res, 400, { error: err.message }); }
    if (out === undefined) return sendJson(res, 404, { error: `Mock: no route for plex/${rest}` });
    if (out && out.__status) return sendJson(res, out.__status, { error: out.error });
    if (out === null) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
    setTimeout(() => sendJson(res, 200, out), 50 + Math.random() * 100);
  }

  return { handle };
}

module.exports = { createMockPlex };
