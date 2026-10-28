// Demo mode: fake Radarr/Sonarr/NZBGet/Jellyfin APIs so MediaDesk can be tried without servers.
// Started with `npm run demo` (or MOCK=1). Nothing here talks to the network.

'use strict';

const DAY = 864e5;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function posterSvg(title, kind = 'poster') {
  const h = hash(title) % 360;
  const wide = kind === 'fanart' || kind === 'backdrop';
  const [w, hgt] = wide ? [1280, 720] : [400, 600];
  const words = String(title).split(' ');
  const lines = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= 12) lines[lines.length - 1] = last + ' ' + word; else lines.push(word);
  }
  const text = wide ? '' : lines.slice(0, 4).map((l, i) =>
    `<text x="200" y="${430 + i * 40 - (lines.length - 1) * 20}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="34" fill="#fff" opacity=".95">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},65%,22%)"/></linearGradient>
<radialGradient id="r" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
<circle cx="${wide ? 960 : 200}" cy="${wide ? 300 : 220}" r="${wide ? 220 : 110}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="10"/>
<circle cx="${wide ? 960 : 200}" cy="${wide ? 300 : 220}" r="${wide ? 120 : 60}" fill="#fff" fill-opacity=".15"/>${text}</svg>`;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MOVIE_TITLES = [
  ['The Grand Voyage', 2024], ['Midnight Harbor', 2023], ['Echoes of Tomorrow', 2025], ['Paper Lanterns', 2022], ['Iron Meadow', 2021],
  ['The Last Lighthouse', 2019], ['Neon Requiem', 2024], ['Glass Mountains', 2020], ['A Quiet Orbit', 2023], ['Silver Fox Run', 2018],
  ['Kingdom of Salt', 2022], ['The Cartographer', 2017], ['Velvet Thunder', 2025], ['Northern Static', 2021], ['Wild Hours', 2016],
  ['The Clockmaker’s Daughter', 2020], ['Saltwater Saints', 2019], ['Burning Atlas', 2024], ['Hollow Crown Road', 2015], ['Lunar Drift', 2023],
  ['Rivers of Copper', 2022], ['The Orchard', 2018], ['Phantom Signal', 2025], ['Blue Hour', 2021], ['Desert Bloom', 2020],
  ['Small Gods of August', 2017], ['The Long Winter', 2014], ['Static Hearts', 2024], ['Marble Sky', 2023], ['Ashes & Embers', 2022],
  ['Paradox Park', 2019], ['Harbor Lights', 2016], ['The Fifth Season', 2025], ['Golden Circuit', 2026], ['Weightless', 2026],
];
const SERIES_TITLES = [
  ['Starlight Station', 'Orbit', 4], ['The Archivists', 'Lumen', 3], ['Harbor Town', 'Coastline', 6], ['Quantum Kitchen', 'Spice TV', 2],
  ['Night Shift Detectives', 'Noir+', 5], ['Wildwood', 'Verdant', 3], ['Signal Lost', 'Orbit', 2], ['The Embassy', 'Capital', 4],
  ['Copper Valley', 'Frontier', 3], ['Deep Blue Lab', 'Science One', 2], ['Paper Empire', 'Lumen', 1], ['Moonrise Academy', 'Kids&Co', 3],
  ['The Long Game', 'Capital', 2], ['Ironclad', 'Frontier', 4], ['Glasshouse', 'Noir+', 2],
];
const GENRES = ['Drama', 'Sci-Fi', 'Adventure', 'Thriller', 'Comedy', 'Mystery', 'Fantasy', 'Action', 'Romance', 'Documentary'];
const OVERVIEW = 'A sweeping story of ambition, loss and second chances. When an unlikely group is thrown together by circumstance, they must confront the secrets that bind them — and decide what they are willing to risk for the people they love.';

const img = (svc, title, type = 'poster') => [{ coverType: type, remoteUrl: `/api/${svc}/mock-image/${type}/${encodeURIComponent(title)}.svg`, url: '' }];

let nextMovieId = 1;
const movies = MOVIE_TITLES.map(([title, year], i) => {
  const h = hash(title);
  const hasFile = i % 5 !== 1 && year < 2026;
  const size = hasFile ? (4 + (h % 40)) * 1024 ** 3 / 2 : 0;
  return {
    id: nextMovieId++, title, sortTitle: title.toLowerCase(), year, tmdbId: 10000 + i, titleSlug: `${slug(title)}-${10000 + i}`,
    monitored: i % 9 !== 4, hasFile, isAvailable: year < 2026, sizeOnDisk: size, runtime: 90 + (h % 70), certification: ['PG', 'PG-13', 'R', '12A'][h % 4],
    studio: ['Northlight Pictures', 'Blue Ember', 'Atlas Films', 'Moonhouse'][h % 4], genres: [GENRES[h % 10], GENRES[(h >>> 3) % 10]].filter((g, j, a) => a.indexOf(g) === j),
    overview: OVERVIEW, qualityProfileId: 1 + (h % 3), path: `/movies/${title} (${year})`, added: iso(now - (i * 3 + 1) * DAY),
    images: [...img('radarr', title), ...img('radarr', title, 'fanart')],
    movieFile: hasFile ? { size, quality: { quality: { name: ['Bluray-1080p', 'WEBDL-2160p', 'WEBDL-1080p'][h % 3] } } } : null,
    inCinemas: iso(year >= 2026 ? now + ((h % 20) + 1) * DAY : now - 400 * DAY),
    digitalRelease: iso(i % 7 === 3 ? now + ((h % 6) + 1) * DAY : now - 300 * DAY),
  };
});

let nextSeriesId = 1;
let nextEpisodeId = 1;
const episodes = [];
const series = SERIES_TITLES.map(([title, network, seasonCount], i) => {
  const id = nextSeriesId++;
  const h = hash(title);
  const seasons = [];
  let have = 0, total = 0, size = 0;
  for (let sn = 1; sn <= seasonCount; sn++) {
    const count = 6 + ((h >>> sn) % 7);
    const ongoing = sn === seasonCount && i % 3 === 0;
    let sHave = 0;
    for (let e = 1; e <= count; e++) {
      const aired = ongoing ? now + (e - Math.ceil(count / 2)) * 7 * DAY + (i % 7) * DAY : now - (seasonCount - sn + 1) * 365 * DAY + e * 7 * DAY;
      const hasFile = aired < now && !(ongoing && e === Math.ceil(count / 2) - 1) && !(i % 5 === 2 && sn === seasonCount);
      if (hasFile) { sHave++; size += 1.4 * 1024 ** 3; }
      episodes.push({ id: nextEpisodeId++, seriesId: id, seasonNumber: sn, episodeNumber: e, title: `Chapter ${e}`, airDateUtc: iso(aired), hasFile, monitored: true });
    }
    have += sHave; total += count;
    seasons.push({ seasonNumber: sn, monitored: true, statistics: { episodeFileCount: sHave, episodeCount: count, totalEpisodeCount: count } });
  }
  const airedCount = episodes.filter((e) => e.seriesId === id && new Date(e.airDateUtc) < now).length;
  return {
    id, title, sortTitle: title.toLowerCase(), year: 2026 - seasonCount - (h % 4), network, tvdbId: 70000 + i, titleSlug: slug(title),
    status: i % 3 === 0 ? 'continuing' : 'ended', monitored: true, overview: OVERVIEW, qualityProfileId: 1 + (h % 3),
    path: `/tv/${title}`, added: iso(now - (i * 5 + 2) * DAY), genres: [GENRES[h % 10]], images: [...img('sonarr', title), ...img('sonarr', title, 'fanart')], seasons,
    statistics: { seasonCount, episodeFileCount: have, episodeCount: airedCount, totalEpisodeCount: total, sizeOnDisk: size, percentOfEpisodes: airedCount ? (have / airedCount) * 100 : 0 },
  };
});

const profiles = [{ id: 1, name: 'HD-1080p' }, { id: 2, name: 'Ultra-HD' }, { id: 3, name: 'Any' }];
const disks = [{ path: '/movies', label: 'media', freeSpace: 2.1 * 1024 ** 4, totalSpace: 8 * 1024 ** 4 }, { path: '/tv', label: 'media', freeSpace: 2.1 * 1024 ** 4, totalSpace: 8 * 1024 ** 4 }, { path: '/', label: 'root', freeSpace: 80 * 1024 ** 3, totalSpace: 240 * 1024 ** 3 }];

// ---------------------------------------------------------------------------
// NZBGet simulation
// ---------------------------------------------------------------------------

const nzb = {
  paused: false, limit: 0, nextId: 100, started: now,
  groups: [
    { name: 'Neon.Requiem.2024.2160p.WEB-DL.DDP5.1.HDR.H.265', cat: 'movies', size: 18400, done: 7200 },
    { name: 'Starlight.Station.S04E05.1080p.WEB.h264', cat: 'tv', size: 2300, done: 300 },
    { name: 'Night.Shift.Detectives.S05E09.1080p.WEB.h264', cat: 'tv', size: 2100, done: 0 },
    { name: 'Phantom.Signal.2025.1080p.BluRay.x264', cat: 'movies', size: 11200, done: 0, paused: true },
    { name: 'Harbor.Town.S06E10.720p.HDTV.x264', cat: 'tv', size: 1100, done: 0 },
  ].map((g, i) => ({ ...g, id: i + 1, health: 1000 })),
  history: [
    { id: 90, name: 'Copper.Valley.S03E08.1080p.WEB.h264', cat: 'tv', size: 2400, status: 'SUCCESS/ALL', time: now - 2 * 3600e3 },
    { id: 89, name: 'Burning.Atlas.2024.1080p.WEB-DL.DDP5.1', cat: 'movies', size: 6800, status: 'SUCCESS/ALL', time: now - 5 * 3600e3 },
    { id: 88, name: 'Glasshouse.S02E04.720p.WEB.h264', cat: 'tv', size: 900, status: 'FAILURE/PAR', time: now - 9 * 3600e3 },
    { id: 87, name: 'Lunar.Drift.2023.2160p.BluRay.REMUX', cat: 'movies', size: 52000, status: 'SUCCESS/ALL', time: now - 26 * 3600e3 },
    { id: 86, name: 'The.Archivists.S03E02.1080p.WEB.h264', cat: 'tv', size: 2200, status: 'DELETED/MANUAL', time: now - 30 * 3600e3 },
  ],
  log: [],
  last: Date.now(),
  speed: 0,
};
function nzbLog(kind, text) { nzb.log.push({ ID: nzb.log.length + 1, Kind: kind, Time: Math.floor(Date.now() / 1000), Text: text }); if (nzb.log.length > 300) nzb.log.shift(); }
nzbLog('INFO', 'nzbget 24.3 server-mode'); nzbLog('INFO', 'Connected to news.example.net'); nzbLog('WARNING', 'Server news.example.net: article not found, trying backup');

// Radarr/Sonarr download history, fed by the simulated downloads finishing.
const arrHistory = { radarr: [], sonarr: [] };
function recordImport(g, t) {
  const words = g.name.replace(/\./g, ' ');
  const quality = { quality: { name: /2160p/.test(g.name) ? 'WEBDL-2160p' : /720p/.test(g.name) ? 'HDTV-720p' : 'WEBDL-1080p' } };
  const ep = g.name.match(/^(.*)\.S(\d+)E(\d+)/);
  if (ep) {
    const s = series.find((x) => x.title.toLowerCase() === ep[1].replace(/\./g, ' ').toLowerCase());
    arrHistory.sonarr.push({ eventType: 'downloadFolderImported', date: iso(t), sourceTitle: g.name, quality, seriesId: s?.id,
      series: s ? { title: s.title } : { title: ep[1].replace(/\./g, ' ') },
      episode: { seasonNumber: +ep[2], episodeNumber: +ep[3], title: `Chapter ${+ep[3]}` } });
  } else {
    const m = movies.find((x) => words.toLowerCase().startsWith(x.title.toLowerCase()));
    arrHistory.radarr.push({ eventType: 'downloadFolderImported', date: iso(t), sourceTitle: g.name, quality, movieId: m?.id,
      movie: m ? { title: m.title, year: m.year } : { title: words.split(' 20')[0] } });
  }
}

function tickNzb() {
  const t = Date.now();
  const dt = (t - nzb.last) / 1000;
  nzb.last = t;
  const active = nzb.groups.filter((g) => !g.paused);
  if (nzb.paused || !active.length) { nzb.speed = 0; return; }
  let speed = (28 + 18 * Math.sin(t / 7000) + Math.random() * 10) * 1024 * 1024;
  if (nzb.limit) speed = Math.min(speed, nzb.limit);
  nzb.speed = speed;
  let budget = (speed * dt) / 1024 / 1024;
  for (const g of active) {
    if (budget <= 0) break;
    const take = Math.min(budget, g.size - g.done);
    g.done += take; budget -= take;
    if (g.done >= g.size) {
      nzb.groups = nzb.groups.filter((x) => x !== g);
      nzb.history.unshift({ id: nzb.nextId++, name: g.name, cat: g.cat, size: g.size, status: 'SUCCESS/ALL', time: t });
      nzbLog('INFO', `Collection ${g.name} added to history`);
      recordImport(g, t);
    }
  }
}
// Keep the queue topped up so the demo never runs dry.
const REFILL = ['Velvet.Thunder.2025.1080p.WEB-DL', 'Wildwood.S03E07.1080p.WEB.h264', 'Ironclad.S04E02.2160p.WEB.h265', 'Marble.Sky.2023.1080p.BluRay.x264', 'Deep.Blue.Lab.S02E06.720p.WEB'];
setInterval(() => {
  if (nzb.groups.length < 3) {
    const name = REFILL[nzb.nextId % REFILL.length];
    nzb.groups.push({ id: nzb.nextId++, name, cat: name.includes('.S0') ? 'tv' : 'movies', size: 1500 + (hash(name) % 9000), done: 0, health: 1000 });
  }
}, 20e3).unref();

function nzbRpc(method, params) {
  tickNzb();
  const MB = 1024 * 1024;
  switch (method) {
    case 'version': return '24.3';
    case 'status': {
      const remaining = nzb.groups.reduce((a, g) => a + g.size - g.done, 0);
      return {
        DownloadRate: Math.round(nzb.speed), AverageDownloadRate: 31 * MB, RemainingSizeMB: Math.round(remaining), DownloadPaused: nzb.paused,
        DownloadLimit: nzb.limit, FreeDiskSpaceMB: 2.1 * 1024 * 1024, TotalDiskSpaceMB: 8 * 1024 * 1024, UpTimeSec: Math.floor((Date.now() - nzb.started) / 1000) + 86400 * 3,
        DownloadedSizeMB: 4.2 * 1024 * 1024, ThreadCount: 14, PostJobCount: 0, PostPaused: false, ServerStandBy: nzb.speed === 0,
      };
    }
    case 'listgroups': {
      const active = nzb.groups.filter((g) => !g.paused);
      return nzb.groups.map((g) => ({
        NZBID: g.id, NZBName: g.name, Category: g.cat, FileSizeMB: g.size, RemainingSizeMB: Math.round(g.size - g.done), DownloadedSizeMB: Math.round(g.done),
        Status: g.paused ? 'PAUSED' : nzb.paused ? 'QUEUED' : active[0] === g ? 'DOWNLOADING' : 'QUEUED', Health: g.health,
      }));
    }
    case 'history': return nzb.history.map((h) => ({ NZBID: h.id, Name: h.name, Category: h.cat, FileSizeMB: h.size, Status: h.status, HistoryTime: Math.floor(h.time / 1000) }));
    case 'pausedownload': nzb.paused = true; nzbLog('INFO', 'Download paused'); return true;
    case 'resumedownload': nzb.paused = false; nzbLog('INFO', 'Download resumed'); return true;
    case 'rate': nzb.limit = Number(params[0]) * 1024; return true;
    case 'scan': case 'pausepost': case 'resumepost': return true;
    case 'log': return nzb.log.slice(-Number(params[1] || 100));
    case 'config': return [{ Name: 'Category1.Name', Value: 'movies' }, { Name: 'Category2.Name', Value: 'tv' }, { Name: 'Category3.Name', Value: 'music' }];
    case 'append': {
      const id = nzb.nextId++;
      const name = params[0] || String(params[1]).split('/').pop() || `nzb-${id}`;
      nzb.groups.push({ id, name: name.replace(/\.nzb$/i, ''), cat: params[2] || '', size: 3000, done: 0, health: 1000, paused: Boolean(params[5]) });
      nzbLog('INFO', `Added ${name} to queue`);
      return id;
    }
    case 'editqueue': {
      const [cmd, , ids] = params;
      const set = new Set(ids);
      if (cmd === 'GroupPause') nzb.groups.forEach((g) => { if (set.has(g.id)) g.paused = true; });
      if (cmd === 'GroupResume') nzb.groups.forEach((g) => { if (set.has(g.id)) g.paused = false; });
      if (cmd === 'GroupDelete' || cmd === 'GroupFinalDelete') nzb.groups = nzb.groups.filter((g) => !set.has(g.id));
      if (cmd === 'GroupMoveTop') nzb.groups.sort((a, b) => set.has(b.id) - set.has(a.id));
      if (cmd === 'HistoryDelete') nzb.history = nzb.history.filter((h) => !set.has(h.id));
      if (cmd === 'HistoryRedownload') nzb.history.filter((h) => set.has(h.id)).forEach((h) => { nzb.history = nzb.history.filter((x) => x !== h); nzb.groups.push({ id: h.id, name: h.name, cat: h.cat, size: h.size, done: 0, health: 1000 }); });
      return true;
    }
    default: throw new Error(`Unknown method ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Jellyfin data
// ---------------------------------------------------------------------------

const SERVER_ID = 'mockserver0001';
const USER_ID = 'user0001';
const jfItems = [];
const jfViews = [
  { Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies', Type: 'CollectionFolder' },
  { Id: 'lib-tv', Name: 'Shows', CollectionType: 'tvshows', Type: 'CollectionFolder' },
  { Id: 'lib-music', Name: 'Music', CollectionType: 'music', Type: 'CollectionFolder' },
].map((v) => ({ ...v, ServerId: SERVER_ID, ImageTags: { Primary: 'v' } }));
movies.filter((m) => m.hasFile).forEach((m, i) => jfItems.push({
  Id: `m${m.id}`, Name: m.title, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: m.year, ServerId: SERVER_ID, Overview: m.overview,
  Genres: m.genres, RunTimeTicks: m.runtime * 60 * 1e7, OfficialRating: m.certification, CommunityRating: 6 + (hash(m.title) % 35) / 10,
  ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'], DateCreated: m.added, Path: `${m.path}/${m.title}.mkv`,
  UserData: { Played: i % 4 === 0, PlayedPercentage: i % 6 === 1 ? 35 + (i * 7) % 50 : undefined, IsFavorite: i % 7 === 0 },
}));
series.forEach((s) => {
  jfItems.push({ Id: `s${s.id}`, Name: s.title, Type: 'Series', ParentId: 'lib-tv', ProductionYear: s.year, ServerId: SERVER_ID, Overview: s.overview, Genres: s.genres, ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'], DateCreated: s.added, UserData: {} });
  episodes.filter((e) => e.seriesId === s.id && e.hasFile).slice(-3).forEach((e) => jfItems.push({
    Id: `e${e.id}`, Name: e.title, Type: 'Episode', SeriesName: s.title, SeriesId: `s${s.id}`, SeriesPrimaryImageTag: 'p', ParentIndexNumber: e.seasonNumber, IndexNumber: e.episodeNumber,
    ParentId: 'lib-tv-ep', ServerId: SERVER_ID, RunTimeTicks: 45 * 60 * 1e7, DateCreated: e.airDateUtc, Overview: OVERVIEW, ImageTags: {}, UserData: {},
  }));
});
['Midnight Static', 'Golden Hour Tapes', 'Northern Lights EP', 'City of Echoes'].forEach((a, i) => jfItems.push({
  Id: `a${i}`, Name: a, Type: 'MusicAlbum', AlbumArtist: ['The Lanterns', 'Velvet Sea', 'Aurora Kid', 'Echo Park'][i], ParentId: 'lib-music', ProductionYear: 2020 + i, ServerId: SERVER_ID, ImageTags: { Primary: 'p' }, UserData: {}, DateCreated: iso(now - i * DAY),
}));
// --- Music: synthesised songs so the Music app and its visualizer have something to play ---

const ALBUM_TRACKS = [
  ['Neon Rain', 'Static Hearts', 'After Midnight', 'Glass Tower', 'Slow Signal'],
  ['Sunbeam Cassette', 'Warm Tape', 'Porch Lights', 'Golden Hour', 'Last Light'],
  ['Aurora', 'Polar Night', 'Frostbite', 'Northern Drift'],
  ['Echo Chamber', 'Concrete Bloom', 'Subway Lights', 'Rooftops', 'City Hum'],
];
const ALBUMS = ['Midnight Static', 'Golden Hour Tapes', 'Northern Lights EP', 'City of Echoes'];
const ARTISTS = ['The Lanterns', 'Velvet Sea', 'Aurora Kid', 'Echo Park'];
const SONG_RATE = 22050;
const songs = [];
ALBUM_TRACKS.forEach((tracks, a) => tracks.forEach((name, t) => {
  const seed = hash(name);
  const seconds = 40 + (seed % 35);
  songs.push({
    Id: `t${a}_${t}`, Name: name, Type: 'Audio', ParentId: `a${a}`, AlbumId: `a${a}`, Album: ALBUMS[a], AlbumArtist: ARTISTS[a],
    Artists: [ARTISTS[a]], ArtistItems: [{ Id: `ar${a}`, Name: ARTISTS[a] }], AlbumPrimaryImageTag: 'p', IndexNumber: t + 1, ParentIndexNumber: 1,
    RunTimeTicks: seconds * 1e7, Container: 'wav', ServerId: SERVER_ID, ImageTags: {}, UserData: {}, DateCreated: iso(now - a * DAY),
    MediaSources: [{ Container: 'wav', Bitrate: SONG_RATE * 16, MediaStreams: [{ Type: 'Audio', SampleRate: SONG_RATE, Channels: 1, Codec: 'pcm_s16le' }] }],
    seed, seconds,
  });
}));
jfItems.push(...songs);
const jfPlaylists = [{ Id: 'pl1', Name: 'Late Night Drive', Type: 'Playlist', MediaType: 'Audio', ServerId: SERVER_ID, ImageTags: {}, ChildCount: 6, UserData: {},
  items: ['t0_0', 't3_2', 't2_0', 't0_2', 't1_3', 't3_0'] }];
jfItems.push(...jfPlaylists);

// A small seeded synthesiser: drums, bass, chords and an arpeggio, different tempo/key per song.
function synthSong(seed, seconds, rate = SONG_RATE) {
  let r = seed || 1;
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.floor(seconds * rate);
  const out = new Float32Array(n);
  const bpm = 88 + (seed % 48);
  const beat = 60 / bpm;
  const root = 40 + (seed % 12);                       // MIDI note of the key
  const freq = (m) => 440 * 2 ** ((m - 69) / 12);
  const prog = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]].map((c) => c.map((x) => x + root + 12));
  const bassLine = [0, 7, 9, 5];
  const arpStyle = seed % 3;
  const add = (start, len, fn) => {
    const s0 = Math.floor(start * rate), s1 = Math.min(n, s0 + Math.floor(len * rate));
    for (let i = s0; i < s1; i++) out[i] += fn((i - s0) / rate);
  };
  const bars = Math.ceil(seconds / (beat * 4));
  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % 4];
    const t0 = bar * beat * 4;
    const section = Math.floor(bar / 4) % 3;           // vary density through the song
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      // kick
      if (b % 2 === 0 || (section === 2 && b === 3)) add(t, 0.35, (x) => Math.sin(2 * Math.PI * (45 + 110 * Math.exp(-x * 25)) * x) * Math.exp(-x * 9) * 0.9);
      // snare
      if (b % 2 === 1) add(t, 0.22, (x) => ((rand() * 2 - 1) * 0.55 + Math.sin(2 * Math.PI * 190 * x) * 0.3) * Math.exp(-x * 18));
      // hi-hats
      for (let h = 0; h < (section === 0 ? 2 : 4); h++) add(t + h * beat / (section === 0 ? 2 : 4), 0.05, (x) => (rand() * 2 - 1) * 0.22 * Math.exp(-x * 90));
      // bass
      const bf = freq(root + bassLine[bar % 4]);
      for (let e = 0; e < 2; e++) add(t + e * beat / 2, beat / 2 * 0.9, (x) => {
        const env = Math.min(1, x * 200) * Math.exp(-x * 3);
        return (Math.sin(2 * Math.PI * bf * x) + 0.4 * Math.sin(4 * Math.PI * bf * x) + 0.2 * Math.sin(6 * Math.PI * bf * x)) * 0.32 * env;
      });
      // arpeggio
      if (section > 0) {
        for (let k = 0; k < 4; k++) {
          const note = chord[(arpStyle === 0 ? k : arpStyle === 1 ? 3 - k : (k * 2) % 3) % 3] + 12;
          const f = freq(note);
          add(t + k * beat / 4, beat / 4 * 0.8, (x) => (Math.sin(2 * Math.PI * f * x) > 0 ? 1 : -1) * 0.06 * Math.exp(-x * 7));
        }
      }
    }
    // chord pad across the bar
    add(t0, beat * 4, (x) => {
      const env = Math.min(1, x * 3) * Math.min(1, (beat * 4 - x) * 4);
      return chord.reduce((a, m) => a + Math.sin(2 * Math.PI * freq(m) * x + Math.sin(2 * Math.PI * 0.3 * x)), 0) * 0.05 * env;
    });
  }
  // fade in/out and normalise
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] *= Math.min(1, t / 1.5, (seconds - t) / 2.5);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
  const gain = 0.89 / (peak || 1);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * gain * 32767))), 44 + i * 2);
  return pcm;
}
const songCache = new Map();
function songWav(song) {
  if (!songCache.has(song.Id)) {
    if (songCache.size > 6) songCache.delete(songCache.keys().next().value);
    songCache.set(song.Id, synthSong(song.seed, song.seconds));
  }
  return songCache.get(song.Id);
}

const byId = Object.fromEntries(jfItems.map((i) => [i.Id, i]));
const jfStart = Date.now();
const jfSessions = [
  { Id: 'sess1', UserName: 'alex', Client: 'Jellyfin Android TV', DeviceName: 'Living Room TV', item: jfItems.find((i) => i.Type === 'Movie'), method: 'DirectPlay', paused: false, offset: 0.32 },
  { Id: 'sess2', UserName: 'sam', Client: 'Jellyfin Web', DeviceName: 'Firefox', item: jfItems.find((i) => i.Type === 'Episode'), method: 'Transcode', paused: false, offset: 0.71 },
];
const jfTasks = [
  { Id: 't1', Name: 'Scan media library', State: 'Idle' }, { Id: 't2', Name: 'Extract chapter images', State: 'Idle' },
  { Id: 't3', Name: 'Refresh people', State: 'Idle' }, { Id: 't4', Name: 'Clean transcode directory', State: 'Idle' },
].map((t, i) => ({ ...t, LastExecutionResult: { EndTimeUtc: iso(now - (i + 1) * 3 * 3600e3), Status: 'Completed' } }));

function runTask(t) {
  t.State = 'Running'; t.CurrentProgressPercentage = 0;
  const timer = setInterval(() => {
    t.CurrentProgressPercentage += 9;
    if (t.CurrentProgressPercentage >= 100) { clearInterval(timer); t.State = 'Idle'; t.LastExecutionResult = { EndTimeUtc: iso(Date.now()), Status: 'Completed' }; }
  }, 700);
  timer.unref();
}

function sessionJson(s) {
  const run = s.item.RunTimeTicks;
  const elapsed = s.paused ? 0 : (Date.now() - jfStart) * 1e4;
  return {
    Id: s.Id, UserName: s.UserName, Client: s.Client, DeviceName: s.DeviceName,
    NowPlayingItem: s.item, PlayState: { PositionTicks: Math.min(run, run * s.offset + elapsed), IsPaused: s.paused, PlayMethod: s.method },
    TranscodingInfo: s.method === 'Transcode' ? { VideoCodec: 'h264', Width: 1080, Bitrate: 8.2e6 } : undefined,
  };
}

function jellyfinRoute(method, rest, q, body) {
  const parts = rest.split('/');
  if (rest === 'Users') return [{ Id: USER_ID, Name: 'admin', Policy: { IsAdministrator: true } }];
  if (rest === 'System/Info') return { ServerName: 'media-server', Version: '10.10.7', OperatingSystem: 'Linux', Id: SERVER_ID, HasPendingRestart: false };
  if (rest === 'Items/Counts') return { MovieCount: jfItems.filter((i) => i.Type === 'Movie').length, SeriesCount: series.length, EpisodeCount: episodes.filter((e) => e.hasFile).length, AlbumCount: 4, SongCount: 46 };
  if (rest === 'System/ActivityLog/Entries') return { Items: [
    { Name: 'alex started playing ' + jfSessions[0].item.Name, Date: iso(now - 20 * 60e3), Severity: 'Information' },
    { Name: 'sam successfully authenticated', Date: iso(now - 45 * 60e3), Severity: 'Information' },
    { Name: 'Scan media library completed', Date: iso(now - 3 * 3600e3), Severity: 'Information' },
    { Name: 'Failed login attempt from 192.168.1.44', Date: iso(now - 7 * 3600e3), Severity: 'Warning' },
  ] };
  if (rest === 'ScheduledTasks') return jfTasks;
  if (parts[0] === 'ScheduledTasks' && parts[1] === 'Running') { const t = jfTasks.find((x) => x.Id === parts[2]); if (t) { if (method === 'DELETE') t.State = 'Idle'; else runTask(t); } return null; }
  if (rest === 'Library/Refresh' || /^Items\/[^/]+\/Refresh$/.test(rest)) { runTask(jfTasks[0]); return null; }
  if (rest === 'System/Restart') return null;
  if (rest === 'Sessions') return jfSessions.map(sessionJson);
  if (parts[0] === 'Sessions' && parts[2] === 'Playing') {
    const s = jfSessions.find((x) => x.Id === parts[1]);
    if (s && parts[3] === 'PlayPause') s.paused = !s.paused;
    if (s && parts[3] === 'Stop') jfSessions.splice(jfSessions.indexOf(s), 1);
    return null;
  }
  if (parts[0] === 'Sessions' && parts[2] === 'Message') return null;
  if (rest === 'Shows/NextUp') return { Items: jfItems.filter((i) => i.Type === 'Episode').slice(2, 8) };
  if (parts[0] === 'Users' && parts[2] === 'Views') return { Items: jfViews };
  if (parts[0] === 'Users' && parts[2] === 'Items' && parts[3] === 'Latest') return [...jfItems].filter((i) => i.Type !== 'Episode').sort((a, b) => new Date(b.DateCreated) - new Date(a.DateCreated)).slice(0, Number(q.get('Limit')) || 20);
  if (parts[0] === 'Users' && parts[2] === 'Items' && parts[3] === 'Resume') return { Items: jfItems.filter((i) => i.UserData?.PlayedPercentage) };
  if (parts[0] === 'Users' && (parts[2] === 'PlayedItems' || parts[2] === 'FavoriteItems')) {
    const it = byId[parts[3]];
    if (it) it.UserData[parts[2] === 'PlayedItems' ? 'Played' : 'IsFavorite'] = method !== 'DELETE';
    return it?.UserData || {};
  }
  if (parts[0] === 'Users' && parts[2] === 'Items' && parts[3]) return byId[parts[3]] || jfViews.find((v) => v.Id === parts[3]) || null;
  if (rest === 'Artists/AlbumArtists' || rest === 'Artists') {
    return { Items: ARTISTS.map((name, i) => ({ Id: `ar${i}`, Name: name, Type: 'MusicArtist', ServerId: SERVER_ID, ImageTags: {} })), TotalRecordCount: ARTISTS.length };
  }
  if (parts[0] === 'Playlists' && parts[2] === 'Items') {
    const pl = jfPlaylists.find((x) => x.Id === parts[1]);
    return { Items: (pl?.items || []).map((id) => byId[id]).filter(Boolean), TotalRecordCount: pl?.items.length || 0 };
  }
  if (parts[0] === 'Users' && parts[2] === 'Items') {
    let items = jfItems;
    const parent = q.get('ParentId');
    if (parent) items = items.filter((i) => i.ParentId === parent);
    const artist = q.get('ArtistIds') || q.get('AlbumArtistIds');
    if (artist) items = items.filter((i) => i.ArtistItems?.some((a) => a.Id === artist) || (i.Type === 'MusicAlbum' && `ar${ARTISTS.indexOf(i.AlbumArtist)}` === artist));
    const types = q.get('IncludeItemTypes');
    if (types) items = items.filter((i) => types.split(',').includes(i.Type));
    const term = (q.get('searchTerm') || '').toLowerCase();
    if (term) items = items.filter((i) => (i.Name + ' ' + (i.SeriesName || '')).toLowerCase().includes(term));
    const sortBy = (q.get('SortBy') || 'SortName').split(',')[0];
    items = [...items].sort((a, b) => sortBy === 'DateCreated' ? new Date(b.DateCreated) - new Date(a.DateCreated) : sortBy === 'CommunityRating' ? (b.CommunityRating || 0) - (a.CommunityRating || 0) : a.Name.localeCompare(b.Name));
    const start = Number(q.get('StartIndex')) || 0;
    const limit = Number(q.get('Limit')) || 100;
    return { Items: items.slice(start, start + limit), TotalRecordCount: items.length };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Arr routes
// ---------------------------------------------------------------------------

function queueFor(svc) {
  const MB = 1024 * 1024;
  return nzb.groups.filter((g) => (svc === 'radarr' ? g.cat === 'movies' : g.cat === 'tv')).map((g, i) => {
    const size = g.size * MB, left = (g.size - g.done) * MB;
    const base = { id: g.id, title: g.name, size, sizeleft: left, status: g.paused ? 'paused' : 'downloading', trackedDownloadStatus: 'ok', protocol: 'usenet', downloadClient: 'NZBGet',
      timeleft: nzb.speed && !g.paused ? new Date((left / nzb.speed) * 1000).toISOString().slice(11, 19) : null, quality: { quality: { name: /2160p/.test(g.name) ? 'WEBDL-2160p' : '1080p' } } };
    if (svc === 'radarr') return { ...base, movie: movies.find((m) => g.name.replace(/\./g, ' ').startsWith(m.title)) || { title: g.name.split('.20')[0].replace(/\./g, ' ') } };
    const m = g.name.match(/^(.*)\.S(\d+)E(\d+)/);
    return { ...base, series: { title: m ? m[1].replace(/\./g, ' ') : g.name }, episode: m ? { seasonNumber: +m[2], episodeNumber: +m[3], title: `Chapter ${+m[3]}` } : null };
  });
}

const LOOKUP_EXTRA = {
  radarr: ['Dune Messiah', 'The Silent Orchard', 'Starfall', 'Copper Moon', 'Atlas Rising', 'Rainmaker'],
  sonarr: ['The Lighthouse Keepers', 'Starfall Chronicles', 'Midnight Diner', 'Copper Coast', 'Atlas', 'Rain City'],
};

function arrRoute(svc, method, rest, q, body) {
  const list = svc === 'radarr' ? movies : series;
  const entity = svc === 'radarr' ? 'movie' : 'series';
  const path = rest.replace(/^api\/v3\//, '');
  const parts = path.split('/');
  if (path === 'system/status') return { version: svc === 'radarr' ? '5.26.2.10099' : '4.0.15.2941', startTime: iso(now - 4.2 * DAY), osName: 'ubuntu', osVersion: '24.04', branch: 'main' };
  if (path === 'health') return svc === 'sonarr' ? [{ type: 'warning', message: 'Indexer “ExampleIndexer” is unavailable due to failures for more than 6 hours', wikiUrl: '' }] : [];
  if (path === 'diskspace') return disks;
  if (path === 'qualityprofile') return profiles;
  if (path === 'rootfolder') return [{ id: 1, path: svc === 'radarr' ? '/movies' : '/tv', freeSpace: 2.1 * 1024 ** 4 }];
  if (path === 'languageprofile') return { __status: 404, error: 'Not found' };
  if (path === 'command') return { id: 1, name: body?.name, status: 'queued' };
  if (path === 'queue') return { page: 1, totalRecords: 0, records: queueFor(svc) };
  if (parts[0] === 'queue' && method === 'DELETE') { nzb.groups = nzb.groups.filter((g) => g.id !== Number(parts[1])); return {}; }
  if (path === 'calendar') {
    const start = new Date(q.get('start')), end = new Date(q.get('end'));
    if (svc === 'radarr') return movies.filter((m) => [m.inCinemas, m.digitalRelease].some((d) => new Date(d) >= start && new Date(d) < end));
    return episodes.filter((e) => new Date(e.airDateUtc) >= start && new Date(e.airDateUtc) < end).map((e) => ({ ...e, series: series.find((s) => s.id === e.seriesId) }));
  }
  if (path === 'history/since') {
    tickNzb();
    const since = Date.parse(q.get('date') || 0);
    return arrHistory[svc].filter((e) => Date.parse(e.date) > since);
  }
  if (path === 'episode') return episodes.filter((e) => e.seriesId === Number(q.get('seriesId')));
  if (path === `${entity}/lookup`) {
    const term = (q.get('term') || '').toLowerCase();
    const own = list.filter((x) => x.title.toLowerCase().includes(term));
    const extra = LOOKUP_EXTRA[svc].filter((t) => t.toLowerCase().includes(term) || term.length < 3).map((title, i) => ({
      title, year: 2020 + (hash(title) % 6), overview: OVERVIEW, images: img(svc, title), genres: [GENRES[hash(title) % 10]],
      [svc === 'radarr' ? 'tmdbId' : 'tvdbId']: 90000 + hash(title) % 9999, network: svc === 'sonarr' ? 'Lumen' : undefined, studio: svc === 'radarr' ? 'Atlas Films' : undefined,
      runtime: svc === 'radarr' ? 110 : 50,
    }));
    const synthetic = term.length >= 3 && !own.length && !extra.length ? [{ title: q.get('term').replace(/\b\w/g, (c) => c.toUpperCase()), year: 2025, overview: OVERVIEW, images: img(svc, q.get('term')), [svc === 'radarr' ? 'tmdbId' : 'tvdbId']: 95000 + hash(term) % 999 }] : [];
    return [...own, ...extra, ...synthetic];
  }
  if (path === entity && method === 'GET') return list;
  if (path === entity && method === 'POST') {
    const item = { ...body, id: svc === 'radarr' ? nextMovieId++ : nextSeriesId++, added: iso(Date.now()), sortTitle: body.title.toLowerCase(), titleSlug: slug(body.title), path: `${body.rootFolderPath}/${body.title}`, hasFile: false, sizeOnDisk: 0, isAvailable: true, images: [...img(svc, body.title), ...img(svc, body.title, 'fanart')], seasons: body.seasons || [{ seasonNumber: 1, monitored: true }], statistics: { episodeFileCount: 0, episodeCount: 8, percentOfEpisodes: 0, sizeOnDisk: 0, seasonCount: 1 } };
    if (svc === 'sonarr') for (let e = 1; e <= 8; e++) episodes.push({ id: nextEpisodeId++, seriesId: item.id, seasonNumber: 1, episodeNumber: e, title: `Chapter ${e}`, airDateUtc: iso(now - (9 - e) * 7 * DAY), hasFile: false, monitored: true });
    list.push(item);
    return item;
  }
  if (parts[0] === entity && parts[1]) {
    const idx = list.findIndex((x) => x.id === Number(parts[1]));
    if (idx < 0) return { __status: 404, error: 'Not found' };
    if (method === 'PUT') { list[idx] = { ...list[idx], ...body }; return list[idx]; }
    if (method === 'DELETE') { list.splice(idx, 1); return {}; }
    return list[idx];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function sendRange(req, res, buf, type) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = buf.length - 1, status = 200;
  if (m) {
    if (m[1] === '') start = Math.max(0, buf.length - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])); }
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
    status = 206;
  }
  res.writeHead(status, {
    'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${buf.length}` } : {}),
  });
  res.end(buf.subarray(start, end + 1));
}

let plexMock = null;
let pikvmMock = null;
const pikvmDemo = () => (pikvmMock ||= require('./mock-pikvm').createMockPikvm());
function pikvmSocket(req, socket) { pikvmDemo().socket(req, socket); }

async function handle(req, res, svc, rest, url, { readJson, sendJson }) {
  if (svc === 'pikvm') return pikvmDemo().handle(req, res, rest, url, { sendJson });
  if (svc === 'plex') {
    plexMock = plexMock || require('./mock-plex').createMockPlex({ movies, series, episodes, posterSvg, overview: OVERVIEW, hash });
    return plexMock.handle(req, res, rest, url, { sendJson, sendRange });
  }
  const imgMatch = rest.match(/^mock-image\/(\w+)\/(.+)\.svg$/) || (svc === 'jellyfin' && rest.match(/^Items\/([^/]+)\/Images\/(\w+)/));
  if (imgMatch) {
    let title, kind;
    if (svc === 'jellyfin') {
      const it = byId[imgMatch[1]] || jfViews.find((v) => v.Id === imgMatch[1]);
      title = it?.Name || imgMatch[1]; kind = imgMatch[2].toLowerCase();
    } else { kind = imgMatch[1]; title = decodeURIComponent(imgMatch[2]); }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
    return res.end(posterSvg(title, kind));
  }

  const audio = svc === 'jellyfin' && rest.match(/^Audio\/([^/]+)\/(stream|universal)/);
  if (audio) {
    const song = byId[audio[1]];
    if (!song || song.Type !== 'Audio') return sendJson(res, 404, { error: 'Not found' });
    return sendRange(req, res, songWav(song), 'audio/wav');
  }

  const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req).catch(() => ({})) : null;
  let out;
  try {
    if (svc === 'nzbget') out = nzbRpc(body.method, body.params || []);
    else if (svc === 'jellyfin') out = jellyfinRoute(req.method, rest, url.searchParams, body);
    else out = arrRoute(svc, req.method, rest, url.searchParams, body);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  if (out === undefined) return sendJson(res, 404, { error: `Mock: no route for ${svc}/${rest}` });
  if (out && out.__status) return sendJson(res, out.__status, { error: out.error });
  if (out === null) { res.writeHead(204); return res.end(); }
  // Small artificial latency so loading states are visible.
  setTimeout(() => sendJson(res, 200, out), 60 + Math.random() * 120);
}

// ---------------------------------------------------------------------------
// Demo folders for the Files app (recreated in the system temp folder on every start)
// ---------------------------------------------------------------------------

let demoRoots = null;
function demoFileRoots() {
  if (demoRoots) return demoRoots;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const base = path.join(os.tmpdir(), 'mediadesk-demo-files');
  fs.rmSync(base, { recursive: true, force: true });
  const put = (rel, content) => {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  const blob = (kb) => Buffer.alloc(kb * 1024, 7);
  for (const m of movies.slice(0, 8)) {
    const dir = `Media/Movies/${m.title.replace(/[’']/g, '')} (${m.year})`;
    put(`${dir}/${m.title.replace(/[’']/g, '')} (${m.year}).mkv`, blob(64 + (hash(m.title) % 400)));
    put(`${dir}/poster.svg`, posterSvg(m.title));
    put(`${dir}/movie.nfo`, `<movie>\n  <title>${m.title}</title>\n  <year>${m.year}</year>\n  <plot>${OVERVIEW}</plot>\n</movie>\n`);
  }
  for (const s of series.slice(0, 4)) {
    for (let e = 1; e <= 3; e++) put(`Media/TV/${s.title}/Season 01/${s.title} - S01E0${e}.mkv`, blob(48));
    put(`Media/TV/${s.title}/poster.svg`, posterSvg(s.title));
  }
  put('Media/Music/.hidden-cache', 'cache');
  songs.filter((x) => x.AlbumId === 'a1').slice(0, 3).forEach((x) =>
    put(`Media/Music/${x.AlbumArtist} - ${x.Album}/${String(x.IndexNumber).padStart(2, '0')} ${x.Name}.wav`, synthSong(x.seed, 20, 16000)));
  put('Downloads/complete/Velvet.Thunder.2025.1080p.WEB-DL/Velvet.Thunder.2025.1080p.WEB-DL.mkv', blob(900));
  put('Downloads/complete/Velvet.Thunder.2025.1080p.WEB-DL/Velvet.Thunder.2025.1080p.WEB-DL.nfo', 'Release notes for the demo download.\n');
  put('Downloads/incomplete/Ironclad.S04E02.2160p.WEB.h265.part', blob(300));
  // Logs for the Log Viewer: a Configuration Manager log and a Windows servicing log.
  const cm = (text, comp, type, thread, t) => `<![LOG[${text}]LOG]!><time="${t}.${String((thread * 37) % 1000).padStart(3, '0')}+300" date="01-31-2026" component="${comp}" context="" type="${type}" thread="${thread}" file="">\n`;
  put('Logs/AppEnforce.log', [
    cm('+++ Starting Install enforcement for App DT "Contoso VPN 5.2" ApplicationDeliveryType - ScopeId_1/DeploymentType_7, Revision - 4, ContentPath - C:\\Windows\\ccmcache\\1d, Execution Context - System', 'AppEnforce', 1, 4120, '09:14:02'),
    cm('    Performing detection of app deployment type Contoso VPN 5.2(ScopeId_1/DeploymentType_7, revision 4) for system.', 'AppEnforce', 1, 4120, '09:14:02'),
    cm('+++ Application not discovered. [AppDT Id: ScopeId_1/DeploymentType_7, Revision: 4]', 'AppEnforce', 1, 4120, '09:14:03'),
    cm('    Executing Command line: "C:\\Windows\\system32\\msiexec.exe" /i "ContosoVPN.msi" /qn /l*v C:\\Windows\\Temp\\vpn.log with user context', 'AppEnforce', 1, 4120, '09:14:03'),
    cm('    Working directory C:\\Windows\\ccmcache\\1d', 'AppEnforce', 1, 4120, '09:14:03'),
    cm('    Post install behavior is BasedOnExitCode', 'AppEnforce', 1, 4120, '09:14:04'),
    cm('    Waiting for process 6624 to finish.  Timeout = 120 minutes.', 'AppEnforce', 1, 4120, '09:14:04'),
    cm('    Process 6624 terminated with exitcode: 1618', 'AppEnforce', 1, 4120, '09:15:31'),
    cm('    Looking for exit code 1618 in exit codes table...', 'AppEnforce', 1, 4120, '09:15:31'),
    cm('    Matched exit code 1618 to a FastRetry entry in exit codes table.', 'AppEnforce', 2, 4120, '09:15:31'),
    cm('++++++ App enforcement completed (87 seconds) for App DT "Contoso VPN 5.2" [ScopeId_1/DeploymentType_7], Revision: 4, User SID: ] ++++++', 'AppEnforce', 1, 4120, '09:15:31'),
    cm('Unable to download content for "Contoso Office Add-in". Error 0x87D01201', 'ContentTransferManager', 3, 5236, '09:16:10'),
    cm('Failed to resolve PackageID=CON0004A, Version=2 with error 0x87D00607', 'ContentAccess', 3, 5236, '09:16:10'),
    cm('Retrying download in 60 seconds', 'DataTransferService', 2, 5240, '09:16:11'),
  ].join(''));
  put('Logs/CBS.log', [
    '2026-01-31 09:20:01, Info                  CBS    Starting TrustedInstaller initialization.',
    '2026-01-31 09:20:01, Info                  CBS    Loaded Servicing Stack v10.0.26100.1000 with Core: C:\\Windows\\winsxs\\amd64_microsoft-windows-servicingstack\\cbscore.dll',
    '2026-01-31 09:20:03, Info                  CBS    Session: 31234567_1234567890 initialized by client WindowsUpdateAgent.',
    '2026-01-31 09:20:05, Warning               CBS    Failed to get next element [HRESULT = 0x800f080d - CBS_E_MANIFEST_INVALID_ITEM]',
    '2026-01-31 09:20:09, Error                 CBS    Failed to process single phase execution. [HRESULT = 0x800f0922]',
    '2026-01-31 09:20:10, Info                  CBS    Exec: Processing complete. Session: 31234567_1234567890, Package: Package_for_RollupFix [HRESULT = 0x800f0922]',
    '',
  ].join('\r\n'));
  // An archive for the Archive Expander (a real ZIP; 7-Zip on the server opens it).
  put('Downloads/Archives/Demo Pack.zip', makeZip([
    ['Demo Pack/README.txt', 'This is a demo archive.\nOpen, extract, test or add to it with the Archive Expander.\n'],
    ['Demo Pack/notes/todo.txt', '- Watch Velvet Thunder\n- Tidy the Downloads folder\n'],
    ['Demo Pack/notes/movie.nfo', `<movie>\n  <title>Burning Atlas</title>\n  <plot>${OVERVIEW}</plot>\n</movie>\n`],
    ['Demo Pack/art/poster.svg', posterSvg('Demo Pack')],
    ['Demo Pack/data/sample.bin', blob(40)],
  ]));
  put('Downloads/README.txt', 'Demo folder for MediaDesk Files.\nEverything here is recreated each time demo mode starts.\n');
  demoRoots = [path.join(base, 'Media'), path.join(base, 'Downloads'), path.join(base, 'Logs')];
  return demoRoots;
}

// A minimal ZIP writer (deflate), for the demo archive.
function makeZip(items) {
  const zlib = require('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const local = [], central = [];
  let offset = 0;
  const dosTime = (10 << 11) | (30 << 5), dosDate = ((2026 - 1980) << 9) | (1 << 5) | 31;
  for (const [name, content] of items) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// A few example notifications so the demo shows unread badges straight away.
function seedNotifications(notifier) {
  notifier.add('radarr', 'imported', { title: 'Movie downloaded', body: 'Burning Atlas (2024) · WEBDL-1080p', level: 'success', link: { app: 'radarr', opts: { itemId: movies.find((m) => m.title === 'Burning Atlas')?.id } } });
  notifier.add('sonarr', 'imported', { title: 'Episode downloaded', body: 'Copper Valley S03E08 · Chapter 8 · WEBDL-1080p', level: 'success', link: { app: 'sonarr', opts: {} } });
  notifier.add('sonarr', 'imported', { title: 'Episode downloaded', body: 'The Archivists S03E02 · Chapter 2 · WEBDL-1080p', level: 'success', link: { app: 'sonarr', opts: {} } });
  notifier.add('nzbget', 'failed', { title: 'Download failed', body: 'Glasshouse.S02E04.720p.WEB.h264', level: 'error', link: { app: 'nzbget', opts: { tab: 'history' } } });
}

module.exports = { handle, demoFileRoots, seedNotifications, pikvmSocket };
