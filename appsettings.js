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
  files: {
    showHidden: false,
  },
};

const ALLOWED = {
  'radarr.minimumAvailability': ['announced', 'inCinemas', 'released'],
  'sonarr.monitor': ['all', 'future', 'missing', 'existing', 'firstSeason', 'latestSeason', 'pilot', 'none'],
  'radarr.calendarDays': [7, 14, 28, 60],
  'sonarr.calendarDays': [7, 14, 28, 60],
  'nzbget.defaultPriority': [-100, -50, 0, 50, 100, 900],
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
