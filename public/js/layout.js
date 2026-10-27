// The arrangement of the dock and desktop, saved in this browser (like Appearance, so a phone and
// a computer can be set up differently): which apps are in the dock and how it looks, plus where
// each desktop icon sits and the named app groups on the desktop.

const KEY = 'mediadesk.layout';
const listeners = new Set();

export const DEFAULT_DOCK_APPS = ['dashboard', 'radarr', 'sonarr', 'nzbget', 'jellyfin', 'plex', 'plexviewer', 'music', 'files', 'notes', 'calculator', 'settings'];
export const DEFAULT_DESKTOP_APPS = ['dashboard', 'radarr', 'sonarr', 'nzbget', 'jellyfin', 'plex', 'plexviewer', 'music', 'files', 'notes', 'calculator', 'settings'];
// Apps added in later versions show up on desktops arranged before they existed.
const ADDED_LATER = ['plex', 'plexviewer'];
// Apps that can be placed in the dock or on the desktop (Preview and Web UI open from other apps).
export const PLACEABLE_EXCLUDE = new Set(['launcher', 'webview', 'preview']);

const DOCK_DEFAULTS = {
  apps: DEFAULT_DOCK_APPS,
  size: 48,               // icon size in px
  magnify: true,
  magnifySize: 80,        // icon size under the pointer
  position: 'bottom',     // bottom | left | right
  autohide: false,
  indicators: true,       // dots under open apps
  showOpen: true,         // open apps that aren't kept in the dock appear after a divider
  onlyOpen: true,         // show just Search & apps, the open apps and Settings (no kept apps)
  titleDoubleClick: 'zoom',
};

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function layout() {
  const s = read();
  return {
    dock: { ...DOCK_DEFAULTS, ...s.dock },
    desktop: {
      // [{ type: 'app', id } | { type: 'group', id, name, apps: [] }]
      items: Array.isArray(s.desktop?.items) ? withNewApps(s.desktop) : DEFAULT_DESKTOP_APPS.map((id) => ({ type: 'app', id })),
      known: s.desktop?.known,
      // positions per screen shape: { wide: { key: [col, row] }, narrow: { … } }
      pos: s.desktop?.pos || {},
    },
  };
}

function withNewApps(desk) {
  const known = new Set(desk.known || []);
  const has = (id) => desk.items.some((it) => (it.type === 'app' && it.id === id) || (it.type === 'group' && it.apps.includes(id)));
  return [...desk.items, ...ADDED_LATER.filter((id) => !known.has(id) && !has(id)).map((id) => ({ type: 'app', id }))];
}

export function saveLayout(next) {
  // Remember which apps this desktop has seen, so removing one keeps it removed.
  if (next.desktop) next.desktop.known = [...new Set([...(next.desktop.known || []), ...ADDED_LATER])];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  listeners.forEach((fn) => fn(next));
}

export function updateDock(patch) {
  const l = layout();
  l.dock = { ...l.dock, ...patch };
  saveLayout(l);
}

export function updateDesktop(fn) {
  const l = layout();
  fn(l.desktop);
  // Groups with one app left turn back into that app, as on Android.
  l.desktop.items = l.desktop.items.flatMap((it) => {
    if (it.type !== 'group') return [it];
    if (it.apps.length > 1 || it.keepEmpty) return [it];
    if (it.apps.length === 1) {
      const key = `group:${it.id}`;
      for (const shape of Object.values(l.desktop.pos)) { if (shape[key]) { shape[`app:${it.apps[0]}`] = shape[key]; delete shape[key]; } }
      return [{ type: 'app', id: it.apps[0] }];
    }
    return [];
  });
  saveLayout(l);
}

export const onLayout = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const itemKey = (it) => `${it.type}:${it.id}`;

export function resetLayout(part) {
  const s = read();
  if (part === 'dock') delete s.dock;
  else if (part === 'desktop') delete s.desktop;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  const l = layout();
  listeners.forEach((fn) => fn(l));
}

// Space the dock takes from the edge of the screen (windows stay clear of it).
export function dockReserve() {
  const d = layout().dock;
  if (d.autohide) return { side: d.position, px: 0 };
  return { side: d.position, px: d.size + 30 };
}
