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
  if (parts[0] === 'Users' && parts[2] === 'Items') {
    let items = jfItems;
    const parent = q.get('ParentId');
    if (parent) items = items.filter((i) => i.ParentId === parent);
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

async function handle(req, res, svc, rest, url, { readJson, sendJson }) {
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
  put('Downloads/complete/Velvet.Thunder.2025.1080p.WEB-DL/Velvet.Thunder.2025.1080p.WEB-DL.mkv', blob(900));
  put('Downloads/complete/Velvet.Thunder.2025.1080p.WEB-DL/Velvet.Thunder.2025.1080p.WEB-DL.nfo', 'Release notes for the demo download.\n');
  put('Downloads/incomplete/Ironclad.S04E02.2160p.WEB.h265.part', blob(300));
  put('Downloads/README.txt', 'Demo folder for MediaDesk Files.\nEverything here is recreated each time demo mode starts.\n');
  demoRoots = [path.join(base, 'Media'), path.join(base, 'Downloads')];
  return demoRoots;
}

module.exports = { handle, demoFileRoots };
