// Per-app preferences, stored in config.json under "appSettings" and shared by every device.
// Anything not listed here is ignored, and values must match the default's type (or allowed list).

'use strict';

const DEFAULTS = {
  general: {
    actionPopups: true,            // pop-up confirmations for things you do (errors always show)
  },
  radarr: {
    notifyHealth: true, notifyImported: true, notifyGrabbed: false,
    qualityProfileId: 0, rootFolder: '', minimumAvailability: 'released', searchOnAdd: true,
    calendarDays: 28,
  },
  sonarr: {
    notifyHealth: true, notifyImported: true, notifyGrabbed: false,
    qualityProfileId: 0, rootFolder: '', monitor: 'all', seasonFolder: true, searchOnAdd: true,
    calendarDays: 28,
  },
  nzbget: {
    notifyComplete: true, notifyFailed: true,
    defaultCategory: '', defaultPriority: 0, speedInMenuBar: true,
  },
  jellyfin: {
    notifyPlayback: false,
    rowResume: true, rowNextUp: true, rowLatest: true, nowPlayingWidget: true,
  },
  plex: {
    notifyPlayback: false, notifyAdded: true,
    rowContinue: true, rowOnDeck: true, rowRecent: true, nowPlayingWidget: true,
    quality: 'original', autoplayNext: true,
  },
  pikvm: {
    confirmPower: true, video: 'stream',
  },
  files: {
    showHidden: false,
  },
  music: {
    visAutoSeconds: 20, visQuality: 'medium', nowPlayingInMenuBar: true,
  },
  family: {
    widget: true,                  // the Family widget on the desktop
  },
  screensaver: {
    enabled: false, timeoutMin: 10, saver: 'toasters', requirePassword: false, skipVideo: true, text: 'MediaDesk',
  },
};

const ALLOWED = {
  'radarr.minimumAvailability': ['announced', 'inCinemas', 'released'],
  'sonarr.monitor': ['all', 'future', 'missing', 'existing', 'firstSeason', 'latestSeason', 'pilot', 'none'],
  'radarr.calendarDays': [7, 14, 28, 60],
  'sonarr.calendarDays': [7, 14, 28, 60],
  'nzbget.defaultPriority': [-100, -50, 0, 50, 100, 900],
  'music.visAutoSeconds': [0, 10, 20, 40, 60],
  'music.visQuality': ['low', 'medium', 'high'],
  'pikvm.video': ['stream', 'snapshots'],
  'plex.quality': ['original', '20000', '12000', '8000', '4000', '2000', '1500', '720'],
  'screensaver.timeoutMin': [1, 2, 3, 5, 10, 15, 20, 30, 45, 60],
  'screensaver.saver': ['random', 'toasters', 'maze', 'pipes', 'starfield', 'mystify', 'text3d', 'bubbles', 'ribbons', 'flurry', 'hello', 'matrix'],
};

// Stored settings merged over the defaults.
function resolve(stored = {}) {
  const out = {};
  for (const [app, defaults] of Object.entries(DEFAULTS)) out[app] = { ...defaults, ...(clean(app, stored[app]) || {}) };
  return out;
}

// Keep only known keys with valid values.
function clean(app, incoming) {
  const defaults = DEFAULTS[app];
  if (!defaults || !incoming || typeof incoming !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in defaults) || typeof value !== typeof defaults[key]) continue;
    if (typeof value === 'string' && value.length > 500) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    const allowed = ALLOWED[`${app}.${key}`];
    if (allowed && !allowed.includes(value)) continue;
    out[key] = value;
  }
  return out;
}

// Merge a partial update from the browser into the stored settings.
function merge(stored = {}, incoming = {}) {
  const next = { ...stored };
  for (const app of Object.keys(DEFAULTS)) {
    const c = clean(app, incoming[app]);
    if (c) next[app] = { ...(stored[app] || {}), ...c };
  }
  return next;
}

module.exports = { DEFAULTS, resolve, merge };
