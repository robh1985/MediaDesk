// The desktop shell: wallpaper, menu bar, dock, desktop icons, widgets and the launcher.

import { h, clear, formatSpeed, formatBytes, timeOf, debounce, toast, toastError, contextMenu, onNotify, notifications, timeAgo } from './ui.js';
import { icon, appIcon } from './icons.js';
import { radarr, sonarr, nzbget, jellyfin, isConfigured, serviceLink, portal, state } from './api.js';
import { getApps, getApp, openApp, toggleApp, onChange, openWindows, focusedWindow, close as closeWindow } from './wm.js';
import { live, subscribe } from './live.js';
import { upcoming, posterUrl } from './apps/arr.js';
import { itemImage, searchJellyfin } from './apps/jellyfin.js';

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export const WALLPAPERS = {
  aurora: { name: 'Aurora', css: 'radial-gradient(at 20% 15%, #7c3aed 0, transparent 50%), radial-gradient(at 85% 20%, #0ea5e9 0, transparent 45%), radial-gradient(at 70% 85%, #ec4899 0, transparent 50%), radial-gradient(at 10% 90%, #14b8a6 0, transparent 45%), #1e1b4b' },
  dusk: { name: 'Dusk', css: 'radial-gradient(at 80% 0%, #f97316 0, transparent 50%), radial-gradient(at 0% 50%, #db2777 0, transparent 50%), radial-gradient(at 80% 100%, #4338ca 0, transparent 55%), #312e81' },
  ocean: { name: 'Ocean', css: 'radial-gradient(at 0% 0%, #22d3ee 0, transparent 50%), radial-gradient(at 100% 30%, #2563eb 0, transparent 50%), radial-gradient(at 30% 100%, #0f766e 0, transparent 55%), #0c4a6e' },
  meadow: { name: 'Meadow', css: 'radial-gradient(at 10% 10%, #a3e635 0, transparent 45%), radial-gradient(at 90% 30%, #10b981 0, transparent 50%), radial-gradient(at 50% 100%, #0891b2 0, transparent 55%), #064e3b' },
  ember: { name: 'Ember', css: 'radial-gradient(at 30% 20%, #fbbf24 0, transparent 45%), radial-gradient(at 90% 60%, #dc2626 0, transparent 50%), radial-gradient(at 0% 100%, #7c2d12 0, transparent 55%), #450a0a' },
  graphite: { name: 'Graphite', css: 'radial-gradient(at 20% 20%, #475569 0, transparent 50%), radial-gradient(at 80% 80%, #334155 0, transparent 50%), #0f172a' },
  daylight: { name: 'Daylight', css: 'radial-gradient(at 15% 10%, #bae6fd 0, transparent 50%), radial-gradient(at 85% 20%, #fbcfe8 0, transparent 45%), radial-gradient(at 60% 90%, #c7d2fe 0, transparent 55%), #e0e7ff' },
};
export const ACCENTS = { blue: '#3b82f6', violet: '#8b5cf6', pink: '#ec4899', orange: '#f97316', green: '#22c55e', teal: '#14b8a6', graphite: '#64748b' };
const DEFAULTS = { theme: 'auto', accent: 'blue', wallpaper: 'aurora', widgets: true, icons: true, reduceMotion: false };

export function appearance() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mediadesk.appearance') || '{}') }; } catch { return { ...DEFAULTS }; }
}

export function applyAppearance(a = appearance()) {
  try { localStorage.setItem('mediadesk.appearance', JSON.stringify(a)); } catch { /* ignore */ }
  const root = document.documentElement;
  const dark = a.theme === 'dark' || (a.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', ACCENTS[a.accent] || ACCENTS.blue);
  root.classList.toggle('reduce-motion', a.reduceMotion);
  root.classList.toggle('hide-widgets', !a.widgets);
  root.classList.toggle('hide-icons', !a.icons);
  const wp = document.getElementById('wallpaper');
  if (wp) wp.style.background = (WALLPAPERS[a.wallpaper] || WALLPAPERS.aurora).css;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111827' : '#f8fafc');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance());

export function openWebView(svc) {
  if (!serviceLink(svc)) return toast('No URL configured for this service', { type: 'error' });
  openApp('webview', { key: svc });
}

// ---------------------------------------------------------------------------
// Boot the desktop
// ---------------------------------------------------------------------------

const DOCK_APPS = ['dashboard', 'radarr', 'sonarr', 'nzbget', 'jellyfin', 'files'];

export function startDesktop() {
  buildMenuBar();
  buildDock();
  buildDesktopIcons();
  buildWidgets();
  setupShortcuts();
  document.getElementById('desktop').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.window, .widget, .desktop-icon')) return;
    e.preventDefault();
    const a = appearance();
    const keys = Object.keys(WALLPAPERS);
    contextMenu(e.clientX, e.clientY, [
      { label: 'Overview', icon: icon.grid, action: () => openApp('dashboard') },
      { label: 'Search…', icon: icon.search, action: openLauncher },
      '-',
      { label: 'Next wallpaper', icon: icon.image, action: () => applyAppearance({ ...a, wallpaper: keys[(keys.indexOf(a.wallpaper) + 1) % keys.length] }) },
      { label: a.widgets ? 'Hide widgets' : 'Show widgets', icon: icon.grid, action: () => applyAppearance({ ...a, widgets: !a.widgets }) },
      { label: 'Settings…', icon: icon.sliders, action: () => openApp('settings') },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------

function buildMenuBar() {
  const bar = document.getElementById('menubar');
  const appName = h('div', { class: 'menu-appname' }, 'MediaDesk');
  const logo = h('button', { class: 'menu-logo', title: 'MediaDesk menu', 'aria-haspopup': 'menu', html: appIcon.dashboard });
  // A pointerdown outside an open menu closes it, so remember whether this click should toggle it shut.
  let menuWasOpen = false;
  logo.addEventListener('pointerdown', () => { menuWasOpen = Boolean(document.querySelector('.context-menu')); });
  logo.addEventListener('click', () => {
    if (menuWasOpen) return;
    const r = logo.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'Search & apps', icon: icon.search, action: openLauncher },
      { label: 'Overview', icon: icon.grid, action: () => openApp('dashboard') },
      { label: 'Settings', icon: icon.sliders, action: () => openApp('settings') },
      ...(state.config?.auth ? ['-', { label: 'Log out', icon: icon.lock, action: logOut }] : []),
    ]);
  });
  const speed = h('button', { class: 'tray-item', title: 'NZBGet', onclick: () => openApp('nzbget') });
  const streams = h('button', { class: 'tray-item', title: 'Jellyfin streams', onclick: () => openApp('jellyfin', { section: 'sessions' }) });
  const bell = h('button', { class: 'tray-item tray-icon', title: 'Notifications', html: icon.bell, onclick: toggleNotificationCenter });
  const theme = h('button', { class: 'tray-item tray-icon', title: 'Toggle dark mode' });
  const clock = h('button', { class: 'tray-item tray-clock', onclick: toggleNotificationCenter });
  const paintTheme = () => { theme.innerHTML = document.documentElement.dataset.theme === 'dark' ? icon.sun : icon.moon; };
  theme.onclick = () => {
    const a = appearance();
    applyAppearance({ ...a, theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
    paintTheme();
  };
  paintTheme();

  clear(bar,
    h('div', { class: 'menu-left' },
      logo,
      appName,
      h('button', { class: 'menu-link', onclick: openLauncher }, 'Apps'),
      h('button', { class: 'menu-link', onclick: () => openApp('dashboard') }, 'Overview')),
    h('div', { class: 'menu-right' }, speed, streams, bell, theme, clock));

  onChange(() => {
    const w = focusedWindow();
    appName.textContent = w ? (getApp(w.appId)?.name || 'MediaDesk') : 'MediaDesk';
  });
  subscribe((l) => {
    if (isConfigured('nzbget') && l.nzb) {
      clear(speed, h('span', { class: 'tray-glyph', html: l.nzb.DownloadPaused ? icon.pause : icon.download }), l.nzb.DownloadPaused ? 'Paused' : formatSpeed(l.nzb.speed));
      speed.classList.toggle('active', l.nzb.speed > 0 && !l.nzb.DownloadPaused);
      speed.hidden = false;
    } else speed.hidden = true;
    if (isConfigured('jellyfin') && l.sessions.length) {
      clear(streams, h('span', { class: 'tray-glyph', html: icon.play }), `${l.sessions.length} streaming`);
      streams.hidden = false;
    } else streams.hidden = true;
  });
  onNotify(() => bell.classList.add('has-new'));
  const tick = () => {
    const d = new Date();
    clear(clock, h('span', { class: 'clock-date' }, d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })), h('span', {}, timeOf(d)));
  };
  tick();
  setInterval(tick, 10e3);
}

async function logOut() {
  try {
    await portal.logout();
    location.reload();
  } catch (err) { toastError(err, 'Could not log out'); }
}

function toggleNotificationCenter() {
  const existing = document.querySelector('.notif-center');
  if (existing) return existing.remove();
  document.querySelector('.tray-icon.has-new')?.classList.remove('has-new');
  const list = notifications();
  const panel = h('div', { class: 'notif-center glass' },
    h('div', { class: 'notif-cal' },
      h('div', { class: 'notif-day' }, new Date().toLocaleDateString(undefined, { weekday: 'long' })),
      h('div', { class: 'notif-date' }, new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))),
    h('h4', {}, 'Notifications'),
    list.length ? list.map((n) => h('div', { class: `notif notif-${n.type}` },
      n.icon ? h('div', { class: 'notif-icon', html: n.icon }) : null,
      h('div', {}, h('strong', {}, n.title), n.body ? h('div', { class: 'small' }, n.body) : null, h('div', { class: 'small muted' }, timeAgo(n.at)))))
      : h('div', { class: 'muted small' }, 'You’re all caught up.'));
  document.body.append(panel);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (!panel.contains(e.target) && !e.target.closest('.tray-item')) { panel.remove(); document.removeEventListener('pointerdown', off); }
  }), 0);
}

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------

function buildDock() {
  const dock = document.getElementById('dock');
  const render = () => {
    const running = new Set(openWindows().map((w) => w.appId));
    const focused = focusedWindow()?.appId;
    const item = (id, opts = {}) => {
      const app = getApp(id);
      const badgeCount = opts.badge ?? 0;
      return h('button', {
        class: `dock-item ${running.has(id) ? 'running' : ''} ${focused === id ? 'focused' : ''}`,
        dataset: { app: id }, 'aria-label': app.name,
        onclick: opts.onclick || (() => toggleApp(id)),
        oncontextmenu: (e) => { e.preventDefault(); dockMenu(e, id); },
      },
      h('span', { class: 'dock-icon', html: opts.icon || app.icon }),
      h('span', { class: 'dock-label' }, opts.label || app.name),
      badgeCount ? h('span', { class: 'dock-badge' }, badgeCount) : null);
    };
    const healthCount = (svc) => live.health[svc].filter((x) => x.type === 'error' || x.type === 'warning').length;
    const webviews = openWindows().filter((w) => w.appId === 'webview');
    clear(dock,
      h('div', { class: 'dock-inner glass' },
        item('launcher', { icon: appIcon.dashboard, label: 'Search', onclick: openLauncher }),
        h('div', { class: 'dock-sep' }),
        DOCK_APPS.map((id) => item(id, {
          badge: id === 'jellyfin' ? live.sessions.length : id === 'radarr' || id === 'sonarr' ? healthCount(id) : 0,
        })),
        h('div', { class: 'dock-sep' }),
        webviews.length ? item('webview', { label: `Web UI (${webviews.length})` }) : null,
        item('settings')));
    dock.querySelector('[data-app="launcher"] .dock-icon').innerHTML = `<span class="launcher-glyph">${icon.grid}</span>`;
  };
  onChange(render);
  subscribe(debounce(render, 50));
  render();
}

function dockMenu(e, id) {
  const wins = openWindows().filter((w) => w.appId === id);
  const items = [{ label: wins.length ? 'Show' : 'Open', icon: icon.external, action: () => toggleApp(id) }];
  if (['radarr', 'sonarr', 'nzbget', 'jellyfin'].includes(id) && serviceLink(id)) items.push({ label: 'Open full web UI', icon: icon.globe, action: () => openWebView(id) });
  if (wins.length) items.push('-', { label: wins.length > 1 ? `Close ${wins.length} windows` : 'Close', icon: icon.x, action: () => wins.forEach(closeWindow) });
  contextMenu(e.clientX, e.clientY - 10, items);
}

// ---------------------------------------------------------------------------
// Desktop icons
// ---------------------------------------------------------------------------

function buildDesktopIcons() {
  const host = document.getElementById('desktop-icons');
  const entries = [
    ...DOCK_APPS.map((id) => ({ id, name: getApp(id).name, icon: getApp(id).icon, open: () => openApp(id) })),
    { id: 'settings', name: 'Settings', icon: appIcon.settings, open: () => openApp('settings') },
  ];
  clear(host, entries.map((e) => {
    const el = h('button', { class: 'desktop-icon', dataset: { app: e.id } },
      h('span', { class: 'desktop-icon-img', html: e.icon }), h('span', { class: 'desktop-icon-label' }, e.name));
    el.addEventListener('click', () => {
      host.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      if (matchMedia('(pointer: coarse)').matches) e.open();
    });
    el.addEventListener('dblclick', e.open);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') e.open(); });
    return el;
  }));
  document.getElementById('desktop').addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.desktop-icon')) host.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
  });
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

function buildWidgets() {
  const host = document.getElementById('widgets');
  const widget = (title, appId, body, onOpen) => h('section', { class: 'widget glass' },
    h('header', { onclick: onOpen || (() => openApp(appId)) }, h('span', { class: 'widget-icon', html: appIcon[appId] }), title),
    body);

  // Clock
  const time = h('div', { class: 'w-clock-time' });
  const date = h('div', { class: 'w-clock-date' });
  const clockTick = () => {
    const d = new Date();
    time.textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };
  clockTick();
  setInterval(clockTick, 10e3);
  host.append(h('section', { class: 'widget widget-clock glass' }, time, date));

  // Downloads
  if (isConfigured('nzbget')) {
    const speed = h('div', { class: 'w-big' }, '—');
    const sub = h('div', { class: 'small muted' });
    const spark = h('div', { class: 'w-spark' });
    const pause = h('button', { class: 'btn btn-sm' });
    pause.onclick = () => nzbget(live.nzb?.DownloadPaused ? 'resumedownload' : 'pausedownload').catch(toastError);
    host.append(widget('Downloads', 'nzbget', h('div', {}, h('div', { class: 'w-row' }, h('div', {}, speed, sub), pause), spark)));
    subscribe((l) => {
      if (!l.nzb) { speed.textContent = l.nzbError ? 'Offline' : '—'; return; }
      speed.textContent = l.nzb.DownloadPaused ? 'Paused' : formatSpeed(l.nzb.speed);
      sub.textContent = `${formatBytes(l.nzb.RemainingSizeMB * 1048576)} in queue`;
      clear(pause, h('span', { html: l.nzb.DownloadPaused ? icon.play : icon.pause }));
      pause.title = l.nzb.DownloadPaused ? 'Resume downloads' : 'Pause downloads';
      const data = l.speedHistory.slice(-40);
      const max = Math.max(...data, 1);
      const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${29 - (v / max) * 27}`).join(' ');
      spark.innerHTML = data.length > 1 ? `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polygon points="0,30 ${pts} 100,30" class="area"/><polyline points="${pts}" class="line" vector-effect="non-scaling-stroke"/></svg>` : '';
    });
  }

  // Upcoming
  const kinds = ['radarr', 'sonarr'].filter(isConfigured);
  if (kinds.length) {
    const list = h('div', { class: 'w-list' }, h('div', { class: 'small muted' }, 'Loading…'));
    host.append(widget('Up next', kinds.includes('sonarr') ? 'sonarr' : 'radarr', list));
    const load = () => Promise.all(kinds.map((k) => upcoming(k, 7).catch(() => []))).then((all) => {
      const items = all.flat().filter((i) => new Date(i.date) >= new Date(Date.now() - 6 * 3600e3)).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);
      clear(list, items.length ? items.map((it) => h('button', { class: 'w-item', onclick: () => openApp(it.kind, { itemId: it.id }) },
        h('span', { class: `w-dot cal-${it.kind}` }),
        h('span', { class: 'grow' }, h('strong', {}, it.title), h('span', { class: 'small muted' }, it.sub)),
        h('span', { class: 'small muted nowrap' }, new Date(it.date).toLocaleDateString(undefined, { weekday: 'short' }))))
        : h('div', { class: 'small muted' }, 'Nothing this week'));
    });
    load();
    setInterval(load, 30 * 60e3);
  }

  // Now playing
  if (isConfigured('jellyfin')) {
    const body = h('div', { class: 'w-list' });
    const w = widget('Now playing', 'jellyfin', body, () => openApp('jellyfin', { section: 'sessions' }));
    host.append(w);
    subscribe((l) => {
      w.hidden = !l.sessions.length;
      clear(body, l.sessions.slice(0, 3).map((s) => {
        const it = s.NowPlayingItem;
        const pct = it.RunTimeTicks ? ((s.PlayState?.PositionTicks || 0) / it.RunTimeTicks) * 100 : 0;
        const img = itemImage(it, 100);
        return h('div', { class: 'w-media' },
          h('div', { class: 'w-thumb' }, img ? h('img', { src: img, alt: '' }) : null),
          h('div', { class: 'grow' },
            h('strong', {}, it.SeriesName || it.Name),
            h('div', { class: 'small muted' }, `${s.UserName} · ${s.DeviceName}`),
            h('div', { class: 'progress jf' }, h('div', { class: 'progress-fill', style: { width: `${pct}%` } }))));
      }));
    });
  }
}

// ---------------------------------------------------------------------------
// Launcher / universal search
// ---------------------------------------------------------------------------

const libCache = {};
async function cachedLibrary(svc) {
  const c = libCache[svc];
  if (c && Date.now() - c.at < 5 * 60e3) return c.items;
  const items = await (svc === 'radarr' ? radarr.get('movie') : sonarr.get('series'));
  libCache[svc] = { at: Date.now(), items };
  return items;
}

export function openLauncher() {
  if (document.querySelector('.launcher')) return closeLauncher();
  const input = h('input', { class: 'launcher-input', type: 'search', placeholder: 'Search apps, movies, shows, or type a command…', autocomplete: 'off', spellcheck: 'false' });
  const results = h('div', { class: 'launcher-results' });
  const overlay = h('div', { class: 'launcher-overlay', onclick: (e) => { if (e.target === overlay) closeLauncher(); } },
    h('div', { class: 'launcher glass' },
      h('div', { class: 'launcher-search' }, h('span', { html: icon.search }), input, h('kbd', {}, 'esc')),
      results));
  document.body.append(overlay);
  input.focus();

  let rows = [];
  let active = 0;
  const select = (i) => {
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, idx) => r.el.classList.toggle('active', idx === active));
    rows[active]?.el.scrollIntoView({ block: 'nearest' });
  };
  const run = (r) => { closeLauncher(); r.action(); };
  const row = (r) => {
    r.el = h('button', { class: 'launcher-row', onclick: () => run(r), onmousemove: () => select(rows.indexOf(r)) },
      h('span', { class: `launcher-thumb ${r.poster ? 'poster' : ''}` }, r.poster ? h('img', { src: r.poster, alt: '', loading: 'lazy' }) : h('span', { html: r.icon || '' })),
      h('span', { class: 'launcher-text' }, h('strong', {}, r.title), r.sub ? h('span', { class: 'small muted' }, r.sub) : null),
      h('span', { class: 'launcher-kind small muted' }, r.kind || ''));
    return r;
  };
  const renderGroups = (groups) => {
    rows = [];
    clear(results, groups.filter((g) => g.items.length).map((g) => [
      h('div', { class: 'launcher-group' }, g.title),
      g.items.map((it) => { rows.push(row(it)); return it.el; }),
    ]));
    if (!rows.length) results.append(h('div', { class: 'launcher-empty muted' }, 'No results'));
    select(0);
  };

  const appsGrid = () => {
    rows = [];
    const apps = [...DOCK_APPS, 'settings'].map((id) => getApp(id));
    clear(results, h('div', { class: 'launcher-apps' }, apps.map((a) => {
      const r = { title: a.name, action: () => openApp(a.id) };
      r.el = h('button', { class: 'launcher-app', onclick: () => run(r) }, h('span', { html: a.icon }), h('span', {}, a.name), h('span', { class: 'small muted' }, a.description || ''));
      rows.push(r);
      return r.el;
    })), h('div', { class: 'launcher-hint small muted' }, 'Try “pause”, “scan”, a movie or show title, or “add Dune”.'));
    select(0);
  };

  const commands = () => [
    isConfigured('nzbget') && { title: 'Pause all downloads', icon: icon.pause, kind: 'NZBGet', keys: 'pause stop downloads', action: () => nzbget('pausedownload').then(() => toast('Downloads paused')).catch(toastError) },
    isConfigured('nzbget') && { title: 'Resume all downloads', icon: icon.play, kind: 'NZBGet', keys: 'resume start downloads unpause', action: () => nzbget('resumedownload').then(() => toast('Downloads resumed')).catch(toastError) },
    isConfigured('jellyfin') && { title: 'Scan all Jellyfin libraries', icon: icon.refresh, kind: 'Jellyfin', keys: 'scan refresh library jellyfin', action: () => jellyfin.post('Library/Refresh').then(() => toast('Library scan started')).catch(toastError) },
    isConfigured('radarr') && { title: 'Search for all missing movies', icon: icon.search, kind: 'Radarr', keys: 'missing search movies', action: () => radarr.post('command', { name: 'MissingMoviesSearch' }).then(() => toast('Searching missing movies')).catch(toastError) },
    isConfigured('sonarr') && { title: 'Search for all missing episodes', icon: icon.search, kind: 'Sonarr', keys: 'missing search episodes', action: () => sonarr.post('command', { name: 'MissingEpisodeSearch' }).then(() => toast('Searching missing episodes')).catch(toastError) },
    { title: 'Settings', icon: icon.sliders, kind: 'System', keys: 'settings config preferences connections', action: () => openApp('settings') },
    ...['radarr', 'sonarr', 'nzbget', 'jellyfin'].filter((s) => serviceLink(s)).map((s) => ({ title: `Open ${getApp(s).name} web UI`, icon: icon.globe, kind: 'Web UI', keys: `web ui native open ${s}`, action: () => openWebView(s) })),
  ].filter(Boolean);

  let seq = 0;
  const search = debounce(async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return appsGrid();
    const mine = ++seq;
    const words = q.split(/\s+/);
    const appHits = getApps().filter((a) => a.id !== 'launcher' && a.id !== 'webview' && a.name.toLowerCase().includes(q)).map((a) => ({ title: a.name, sub: a.description, icon: a.icon, kind: 'App', action: () => openApp(a.id) }));
    const cmdHits = commands().filter((c) => words.every((w) => (c.title + ' ' + c.keys).toLowerCase().includes(w)));
    const addTerm = q.startsWith('add ') ? input.value.trim().slice(4) : null;
    const addHits = addTerm ? [
      isConfigured('radarr') && { title: `Add movie “${addTerm}”`, icon: appIcon.radarr, kind: 'Radarr', action: () => openApp('radarr', { section: 'add', term: addTerm }) },
      isConfigured('sonarr') && { title: `Add series “${addTerm}”`, icon: appIcon.sonarr, kind: 'Sonarr', action: () => openApp('sonarr', { section: 'add', term: addTerm }) },
    ].filter(Boolean) : [];
    const groups = [{ title: 'Actions', items: [...addHits, ...cmdHits] }, { title: 'Apps', items: appHits }];
    renderGroups(groups);
    if (q.length < 2 || addTerm) return;

    const term = addTerm || q;
    const libs = await Promise.all([
      isConfigured('radarr') ? cachedLibrary('radarr').then((items) => items.filter((m) => m.title.toLowerCase().includes(term)).slice(0, 6).map((m) => ({
        title: m.title, sub: `${m.year || ''} · ${m.hasFile ? 'Downloaded' : 'Missing'}`, poster: posterUrl(m, 'radarr'), kind: 'Radarr', action: () => openApp('radarr', { itemId: m.id }),
      }))).catch(() => []) : [],
      isConfigured('sonarr') ? cachedLibrary('sonarr').then((items) => items.filter((s) => s.title.toLowerCase().includes(term)).slice(0, 6).map((s) => ({
        title: s.title, sub: `${s.year || ''} · ${s.statistics?.episodeFileCount ?? 0}/${s.statistics?.episodeCount ?? 0} episodes`, poster: posterUrl(s, 'sonarr'), kind: 'Sonarr', action: () => openApp('sonarr', { itemId: s.id }),
      }))).catch(() => []) : [],
      isConfigured('jellyfin') ? searchJellyfin(term, 8).then((items) => items.map((it) => ({
        title: it.Type === 'Episode' ? `${it.SeriesName} — ${it.Name}` : it.Name, sub: `${it.Type}${it.ProductionYear ? ' · ' + it.ProductionYear : ''}`, poster: itemImage(it, 120), kind: 'Jellyfin', action: () => openApp('jellyfin', { itemId: it.Id }),
      }))).catch(() => []) : [],
    ]);
    if (mine !== seq) return;
    const wanted = !libs[0].length && !libs[1].length && !addHits.length ? [
      isConfigured('radarr') && { title: `Add movie “${input.value.trim()}”`, sub: 'Search Radarr', icon: appIcon.radarr, kind: 'Radarr', action: () => openApp('radarr', { section: 'add', term: input.value.trim() }) },
      isConfigured('sonarr') && { title: `Add series “${input.value.trim()}”`, sub: 'Search Sonarr', icon: appIcon.sonarr, kind: 'Sonarr', action: () => openApp('sonarr', { section: 'add', term: input.value.trim() }) },
    ].filter(Boolean) : [];
    renderGroups([...groups, { title: 'Movies', items: libs[0] }, { title: 'Series', items: libs[1] }, { title: 'In Jellyfin', items: libs[2] }, { title: 'Not in your library', items: wanted }]);
  }, 160);

  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    const cols = results.querySelector('.launcher-apps') ? 3 : 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + cols); }
    if (e.key === 'ArrowUp') { e.preventDefault(); select(active - cols); }
    if (e.key === 'ArrowRight' && cols > 1) { e.preventDefault(); select(active + 1); }
    if (e.key === 'ArrowLeft' && cols > 1) { e.preventDefault(); select(active - 1); }
    if (e.key === 'Enter' && rows[active]) { e.preventDefault(); run(rows[active]); }
    if (e.key === 'Escape') closeLauncher();
  });
  appsGrid();
}

function closeLauncher() {
  const o = document.querySelector('.launcher-overlay');
  if (!o) return;
  o.classList.add('leaving');
  setTimeout(() => o.remove(), 150);
}

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && (e.code === 'Space' || e.key.toLowerCase() === 'k')) { e.preventDefault(); openLauncher(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openLauncher(); }
    else if (e.altKey && e.key.toLowerCase() === 'w') { const w = focusedWindow(); if (w) { e.preventDefault(); w.close(); } }
  });
}

// ---------------------------------------------------------------------------
// Lock screen (only when a portal password is configured)
// ---------------------------------------------------------------------------

export function showLockScreen(onUnlock) {
  const time = h('div', { class: 'lock-time' });
  const date = h('div', { class: 'lock-date' });
  const tick = () => { const d = new Date(); time.textContent = timeOf(d); date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); };
  tick();
  const timer = setInterval(tick, 10e3);
  const pw = h('input', { class: 'lock-input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', autofocus: true });
  const err = h('div', { class: 'lock-error' });
  const form = h('form', { class: 'lock-form' },
    h('div', { class: 'lock-avatar', html: appIcon.dashboard }),
    h('div', { class: 'lock-name' }, 'MediaDesk'),
    h('div', { class: 'lock-field' }, pw, h('button', { class: 'lock-go', type: 'submit', 'aria-label': 'Unlock', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' })),
    err);
  const screen = h('div', { class: 'lock' }, h('div', { class: 'lock-clock' }, time, date), form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await import('./api.js').then((m) => m.portal.login(pw.value));
      clearInterval(timer);
      screen.classList.add('leaving');
      setTimeout(() => { screen.remove(); onUnlock(); }, 350);
    } catch (ex) {
      err.textContent = ex.message;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      pw.select();
    }
  });
  document.body.append(screen);
  setTimeout(() => pw.focus(), 50);
}

