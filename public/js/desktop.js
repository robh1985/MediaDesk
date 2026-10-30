// The desktop shell: wallpaper, menu bar, dock, desktop icons, widgets and the launcher.

import { h, clear, formatSpeed, formatBytes, timeOf, debounce, toast, toastError, contextMenu, timeAgo } from './ui.js';
import { icon, appIcon } from './icons.js';
import { radarr, sonarr, nzbget, jellyfin, plex, plexGet, plexImage, isConfigured, serviceLink, portal, state, appPref } from './api.js';
import { getApps, getApp, openApp, onChange, openWindows, focusedWindow } from './wm.js';
import { live, subscribe, markRead, markAllRead, clearNotifications, totalUnread, dismissSystemNotice } from './live.js';
import { upcoming, posterUrl } from './apps/arr.js';
import * as music from './apps/music-engine.js';
import * as screensaver from './screensaver.js';
import { startDock } from './dock.js';
import { startDesktopIcons, desktopMenuItems } from './deskicons.js';
import { PLACEABLE_EXCLUDE } from './layout.js';
import { itemImage, searchJellyfin } from './apps/jellyfin.js';
import { SYSTEMS as GAME_SYSTEMS } from './apps/console/systems.js';
import { familyWidget } from './familywidget.js';

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
const DEFAULTS = { theme: 'auto', accent: 'blue', wallpaper: 'aurora', wallpaperFit: 'fill', customWallpaper: null, widgets: true, icons: true, reduceMotion: false };
// How a custom picture fills the screen, as in Windows: [background-size, background-repeat].
export const WALLPAPER_FITS = { fill: ['Fill', 'cover', 'no-repeat'], fit: ['Fit', 'contain', 'no-repeat'], stretch: ['Stretch', '100% 100%', 'no-repeat'], center: ['Centre', 'auto', 'no-repeat'], tile: ['Tile', 'auto', 'repeat'] };
const THUMB_KEY = 'mediadesk.wallpaperThumb';

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
  if (wp) paintWallpaper(wp, a);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111827' : '#f8fafc');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance());

function paintWallpaper(wp, a) {
  const custom = a.wallpaper === 'custom' && a.customWallpaper?.url;
  if (!custom) { wp.removeAttribute('style'); wp.style.background = (WALLPAPERS[a.wallpaper] || WALLPAPERS.aurora).css; return; }
  const [, size, repeat] = WALLPAPER_FITS[a.wallpaperFit] || WALLPAPER_FITS.fill;
  let thumb = null;
  try { const t = JSON.parse(localStorage.getItem(THUMB_KEY)); if (t?.id === a.customWallpaper.id) thumb = t; } catch { /* none */ }
  // The small saved copy sits underneath, so the picture still shows on the lock screen before
  // signing in (when the full-size file can't be fetched yet).
  const under = thumb && (size === 'cover' || size === '100% 100%');
  wp.style.background = '';
  wp.style.backgroundColor = thumb?.color || '#16181d';
  wp.style.backgroundImage = `url("${a.customWallpaper.url}")${under ? `, url("${thumb.data}")` : ''}`;
  wp.style.backgroundSize = under ? `${size}, ${size}` : size;
  wp.style.backgroundRepeat = under ? `${repeat}, ${repeat}` : repeat;
  wp.style.backgroundPosition = 'center';
}

// Use an uploaded picture ({ id, url }) as the wallpaper.
export async function useCustomWallpaper(entry, fit) {
  try {
    const img = new Image();
    img.src = entry.url;
    await img.decode();
    const w = 480, hgt = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w)) || 270;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: hgt });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, hgt);
    const px = g.getImageData(0, 0, w, hgt).data;
    let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4 * 97) { r += px[i]; gr += px[i + 1]; b += px[i + 2]; n++; }
    const color = `rgb(${Math.round(r / n)}, ${Math.round(gr / n)}, ${Math.round(b / n)})`;
    localStorage.setItem(THUMB_KEY, JSON.stringify({ id: entry.id, data: c.toDataURL('image/jpeg', 0.72), color }));
  } catch { /* the wallpaper still works without a thumbnail */ }
  applyAppearance({ ...appearance(), wallpaper: 'custom', customWallpaper: { id: entry.id, url: entry.url }, ...(fit ? { wallpaperFit: fit } : {}) });
}

// Copy a picture from a shared folder into the wallpapers and use it.
export async function setWallpaperFromFile(root, path) {
  const res = await fetch('/portal/wallpapers/from-file', {
    method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ root, path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  await useCustomWallpaper(data);
  return data;
}

export function openWebView(svc) {
  if (!serviceLink(svc)) return toast('No URL configured for this service', { type: 'error' });
  openApp('webview', { key: svc });
}

// ---------------------------------------------------------------------------
// Boot the desktop
// ---------------------------------------------------------------------------


export function startDesktop() {
  buildMenuBar();
  startDock({ openLauncher, openWebView });
  startDesktopIcons();
  buildWidgets();
  setupShortcuts();
  document.getElementById('desktop').addEventListener('contextmenu', (e) => {
    // Widget backgrounds count as desktop too: on phones the icons and widgets cover nearly all of it.
    if (e.target.closest('.window, .desktop-icon, .widget button, .widget a, .widget input')) return;
    e.preventDefault();
    const a = appearance();
    const keys = Object.keys(WALLPAPERS);
    contextMenu(e.clientX, e.clientY, [
      { label: 'Overview', icon: icon.grid, action: () => openApp('dashboard') },
      { label: 'Search…', icon: icon.search, action: openLauncher },
      '-',
      ...desktopMenuItems(),
      '-',
      { label: 'Change wallpaper…', icon: icon.image, action: () => openApp('settings', { tab: 'appearance' }) },
      { label: 'Next wallpaper', icon: icon.refresh, action: () => applyAppearance({ ...a, wallpaper: keys[(keys.indexOf(a.wallpaper) + 1) % keys.length] }) },
      { label: a.widgets ? 'Hide widgets' : 'Show widgets', icon: icon.grid, action: () => applyAppearance({ ...a, widgets: !a.widgets }) },
      { label: 'Dock & Desktop settings…', icon: icon.sliders, action: () => openApp('settings', { tab: 'dock' }) },
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
      { label: 'Start screensaver', icon: icon.image, action: () => screensaver.start() },
      ...(state.config?.auth ? ['-',
        { label: 'Lock screen', icon: icon.lock, action: () => screensaver.lockNow() },
        { label: 'Log out', icon: icon.power, action: logOut }] : []),
    ]);
  });
  const speed = h('button', { class: 'tray-item', title: 'NZBGet', onclick: () => openApp('nzbget') });
  const nowPlaying = h('button', { class: 'tray-item tray-music', hidden: true, onclick: () => openApp('music') });
  music.subscribe((p) => {
    const t = music.current();
    const show = t && (p.state === 'playing' || p.state === 'loading' || p.state === 'paused') && appPref('music', 'nowPlayingInMenuBar') !== false;
    nowPlaying.hidden = !show;
    if (!show) return;
    const label = t.artist ? `${t.artist} – ${t.title}` : t.title;
    if (nowPlaying.title !== label) {
      nowPlaying.title = label;
      clear(nowPlaying, h('span', { class: 'tray-glyph', html: p.state === 'paused' ? icon.pause : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V6l11-2v11.5"/><circle cx="6.5" cy="18" r="2.8"/><circle cx="17.5" cy="15.5" r="2.8"/></svg>' }), h('span', { class: 'tray-word' }, label));
    }
  });
  // Streams on Jellyfin and Plex; opens whichever has more going on.
  const streams = h('button', { class: 'tray-item', title: 'Streams', onclick: () => openApp(live.plexSessions.length > live.sessions.length ? 'plex' : 'jellyfin', { section: 'sessions' }) });
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
    h('div', { class: 'menu-right' }, nowPlaying, speed, streams, bell, theme, clock));

  onChange(() => {
    document.body.classList.toggle('has-window', openWindows().some((x) => !x.minimized));
    const w = focusedWindow();
    appName.textContent = w ? (getApp(w.appId)?.name || 'MediaDesk') : 'MediaDesk';
    // Looking at an app clears the number on its icon.
    if (w) markRead(w.appId);
  });
  subscribe((l) => {
    const total = totalUnread();
    bell.dataset.count = total > 99 ? '99+' : total || '';
    bell.title = total ? `${total} unread notification${total === 1 ? '' : 's'}` : 'Notifications';
    if (isConfigured('nzbget') && l.nzb && appPref('nzbget', 'speedInMenuBar') !== false) {
      clear(speed, h('span', { class: 'tray-glyph', html: l.nzb.DownloadPaused ? icon.pause : icon.download }), l.nzb.DownloadPaused ? 'Paused' : formatSpeed(l.nzb.speed));
      speed.classList.toggle('active', l.nzb.speed > 0 && !l.nzb.DownloadPaused);
      speed.hidden = false;
    } else speed.hidden = true;
    const nStreams = (isConfigured('jellyfin') ? l.sessions.length : 0) + (isConfigured('plex') ? l.plexSessions.length : 0);
    if (nStreams) {
      clear(streams, h('span', { class: 'tray-glyph', html: icon.play }), `${nStreams}`, h('span', { class: 'tray-word' }, ' streaming'));
      streams.title = [l.sessions.length ? `Jellyfin: ${l.sessions.length}` : null, l.plexSessions.length ? `Plex: ${l.plexSessions.length}` : null].filter(Boolean).join(' · ');
      streams.hidden = false;
    } else streams.hidden = true;
  });
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
  const list = h('div', { class: 'notif-list' });
  const panel = h('div', { class: 'notif-center glass' },
    h('div', { class: 'notif-cal' },
      h('div', { class: 'notif-day' }, new Date().toLocaleDateString(undefined, { weekday: 'long' })),
      h('div', { class: 'notif-date' }, new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))),
    h('div', { class: 'notif-head' }, h('h4', {}, 'Notifications'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => markAllRead() }, 'Mark all read'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => clearNotifications() }, 'Clear')),
    list);
  const draw = (l) => {
    const items = [...l.system.map((n) => ({ ...n, app: 'system', read: false })), ...l.notifications];
    if (!items.length) return clear(list, h('div', { class: 'muted small notif-empty' }, 'You’re all caught up.'));
    clear(list, items.slice(0, 60).map((n) => {
      const app = getApp(n.app);
      const go = () => {
        panel.remove();
        if (n.app === 'system') { dismissSystemNotice(n.id); return n.action?.onClick(); }
        markRead(n.app);
        if (n.link) openApp(n.link.app, n.link.opts || {});
      };
      return h('button', { class: `notif notif-${n.level || 'info'} ${n.read ? 'read' : 'unread'}`, onclick: go },
        h('div', { class: 'notif-icon', html: app?.icon || appIcon.dashboard }),
        h('div', { class: 'grow' },
          h('div', { class: 'notif-title' }, h('strong', {}, n.title), h('span', { class: 'small muted' }, timeAgo(n.at))),
          n.body ? h('div', { class: 'small' }, n.body) : null,
          n.action ? h('span', { class: 'btn btn-sm btn-primary notif-action' }, n.action.label) : null),
        n.read ? null : h('span', { class: 'notif-dot', 'aria-label': 'Unread' }));
    }));
  };
  const unsub = subscribe(draw);
  document.body.append(panel);
  const close = () => { panel.remove(); unsub(); };
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (!panel.isConnected) { unsub(); document.removeEventListener('pointerdown', off); return; }
    if (!panel.contains(e.target) && !e.target.closest('.tray-item')) { close(); document.removeEventListener('pointerdown', off); }
  }), 0);
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

  // Sharing the column's height: Now playing shows up to three sessions, giving some up when
  // Upcoming would otherwise have room for less than about two of each; Upcoming takes the
  // rest of the height and shows as many rows as fit (more on taller screens).
  const fitters = { now: null, upcoming: null, family: null };
  let laying = 0;
  const relayout = () => { cancelAnimationFrame(laying); laying = requestAnimationFrame(layoutColumn); };
  function layoutColumn() {
    const phone = getComputedStyle(host).position === 'static';
    const up = fitters.upcoming?.el;
    fitters.now?.render(3);
    fitters.family?.setCompact(false);
    if (phone || !up) return fitters.upcoming?.fit(Infinity, phone ? 4 : Infinity);
    const room = () => {
      const shown = [...host.children].filter((w) => !w.hidden);
      return host.clientHeight - 12 * (shown.length - 1) - shown.filter((w) => w !== up).reduce((a, w) => a + w.offsetHeight, 0);
    };
    up.hidden = false;
    let n = fitters.now?.count() || 0;
    while (n > 1 && room() < 230) fitters.now.render(--n);
    if (room() < 230) fitters.family?.setCompact(true);
    // Too short for even its summary lines: rather than a sliver, it steps aside.
    const left = room();
    up.hidden = left < 96;
    if (!up.hidden) fitters.upcoming.fit(left, Infinity);
  }
  addEventListener('resize', relayout);
  const ro = new ResizeObserver(relayout);
  queueMicrotask(() => { for (const w of host.children) if (!w.classList.contains('widget-upcoming') && !w.classList.contains('widget-nowplaying')) ro.observe(w); });

  // Family: today's events, chores and dinner from the Family Organizer.
  fitters.family = familyWidget(widget, relayout);
  host.append(fitters.family);

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

  // Upcoming: TV episodes this week and movie releases this month. It takes the height the
  // other widgets leave, showing as many of each as fit (more on taller screens).
  const kinds = ['radarr', 'sonarr'].filter(isConfigured);
  if (kinds.length) {
    const list = h('div', { class: 'w-list w-upcoming' }, h('div', { class: 'small muted' }, 'Loading…'));
    const upcomingWidget = widget('Upcoming', kinds.includes('sonarr') ? 'sonarr' : 'radarr', list, () => openApp(kinds.includes('sonarr') ? 'sonarr' : 'radarr', { section: 'calendar' }));
    upcomingWidget.classList.add('widget-upcoming');
    host.append(upcomingWidget);
    const when = (d) => {
      const dt = new Date(d);
      return dt - Date.now() < 6 * 864e5 ? dt.toLocaleDateString(undefined, { weekday: 'short' }) : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const row = (it) => h('button', { class: 'w-item', onclick: () => openApp(it.kind, { itemId: it.id }) },
      h('span', { class: `w-dot cal-${it.kind}` }),
      h('span', { class: 'grow' }, h('strong', {}, it.title), h('span', { class: 'small muted' }, it.sub)),
      h('span', { class: 'small muted nowrap' }, when(it.date)));
    const calendar = (kind) => openApp(kind, { section: 'calendar' });
    const section = (title, all, n, empty, kind) => [h('div', { class: 'w-sub' }, title),
      all.length ? all.slice(0, n).map(row) : h('div', { class: 'small muted w-empty' }, empty),
      n < all.length ? h('button', { class: 'w-more small muted', onclick: () => calendar(kind) }, `+${all.length - n} more`) : null];
    let data = null;
    const draw = (n) => clear(list,
      data.tv ? section('TV this week', data.tv, n.tv, 'No episodes this week', 'sonarr') : null,
      data.movies ? section('Movie releases', data.movies, n.movies, 'No movie releases this month', 'radarr') : null);
    // Start with everything, then take rows off the longer list until it fits; what doesn't
    // fit is counted in a "+N more" line.
    // maxPx: the height it may take; cap: most rows of each (phones stack the widgets with no
    // height limit, and show four of each).
    const fit = (maxPx, cap) => {
      upcomingWidget.style.maxHeight = Number.isFinite(maxPx) ? `${maxPx}px` : '';
      if (!data || !upcomingWidget.isConnected) return;
      const n = { tv: Math.min(cap, data.tv?.length || 0), movies: Math.min(cap, data.movies?.length || 0) };
      draw(n);
      const over = () => list.scrollHeight > list.clientHeight + 1;
      while (over() && (n.tv > 0 || n.movies > 0)) {
        if ((n.tv >= n.movies && n.tv > 0) || n.movies === 0) n.tv--; else n.movies--;
        draw(n);
      }
      // Not even the headings fit: one line for each.
      if (over()) {
        const line = (kind, count, what) => h('button', { class: 'w-more small', onclick: () => calendar(kind) }, `${count} ${what}`);
        clear(list,
          data.tv ? line('sonarr', data.tv.length, `TV episode${data.tv.length === 1 ? '' : 's'} this week`) : null,
          data.movies ? line('radarr', data.movies.length, `movie release${data.movies.length === 1 ? '' : 's'} this month`) : null);
      }
    };
    fitters.upcoming = { el: upcomingWidget, fit };
    const load = () => Promise.all([
      isConfigured('sonarr') ? upcoming('sonarr', 7).catch(() => []) : null,
      isConfigured('radarr') ? upcoming('radarr', 30).catch(() => []) : null,
    ]).then(([tv, movies]) => {
      const soon = (items) => items.filter((i) => new Date(i.date) >= new Date(Date.now() - 6 * 3600e3)).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 15);
      data = { tv: tv && soon(tv), movies: movies && soon(movies) };
      relayout();
    });
    load();
    setInterval(load, 30 * 60e3);
  }

  // Now playing
  if (isConfigured('jellyfin') || isConfigured('plex')) {
    const body = h('div', { class: 'w-list' });
    const both = isConfigured('jellyfin') && isConfigured('plex');
    const w = widget('Now playing', isConfigured('jellyfin') ? 'jellyfin' : 'plex', body,
      () => openApp(live.plexSessions.length > live.sessions.length || !isConfigured('jellyfin') ? 'plex' : 'jellyfin', { section: 'sessions' }));
    w.classList.add('widget-nowplaying');
    host.append(w);
    // Up to three sessions; fewer (and "+N more") when the column is short.
    let rows = [];
    fitters.now = {
      count: () => rows.length,
      render: (n) => clear(body, rows.slice(0, n), n < rows.length ? h('div', { class: 'w-more small muted' }, `+${rows.length - n} more`) : null),
    };
    const row = (img, title, who, pct, cls, from) => h('div', { class: 'w-media' },
      h('div', { class: 'w-thumb' }, img ? h('img', { src: img, alt: '' }) : null),
      h('div', { class: 'grow' },
        h('strong', {}, title),
        h('div', { class: 'small muted' }, both ? `${who} · ${from}` : who),
        h('div', { class: `progress ${cls}` }, h('div', { class: 'progress-fill', style: { width: `${pct}%` } }))));
    subscribe((l) => {
      const jf = isConfigured('jellyfin') && appPref('jellyfin', 'nowPlayingWidget') !== false ? l.sessions.map((s) => {
        const it = s.NowPlayingItem;
        return row(itemImage(it, 100), it.SeriesName || it.Name, `${s.UserName} · ${s.DeviceName}`, it.RunTimeTicks ? ((s.PlayState?.PositionTicks || 0) / it.RunTimeTicks) * 100 : 0, 'jf', 'Jellyfin');
      }) : [];
      const px = isConfigured('plex') && appPref('plex', 'nowPlayingWidget') !== false ? l.plexSessions.map((s) => row(
        plexImage(s.type === 'episode' ? s.grandparentThumb || s.thumb : s.thumb, 100), s.grandparentTitle || s.title,
        `${s.User?.title || 'Someone'} · ${s.Player?.title || s.Player?.product || ''}`, s.duration ? ((s.viewOffset || 0) / s.duration) * 100 : 0, 'plex', 'Plex')) : [];
      const all = [...jf, ...px];
      w.hidden = !all.length;
      rows = all.slice(0, 3);
      relayout();
    });
  }
}

// ---------------------------------------------------------------------------
// Launcher / universal search
// ---------------------------------------------------------------------------

const libCache = {};
// The Game Console's library, for the launcher (only when a games folder is set).
let gamesCache = null;
async function cachedGames() {
  if (gamesCache && Date.now() - gamesCache.at < 5 * 60e3) return gamesCache.games;
  const lib = await (await fetch('/portal/games/library', { credentials: 'same-origin' })).json();
  gamesCache = { at: Date.now(), games: lib.configured ? lib.games || [] : [] };
  return gamesCache.games;
}
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
    const apps = getApps().filter((a) => !PLACEABLE_EXCLUDE.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
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
    isConfigured('plex') && { title: 'Scan all Plex libraries', icon: icon.refresh, kind: 'Plex', keys: 'scan refresh library plex', action: () => plexGet('library/sections').then((mc) => Promise.all((mc.Directory || []).map((x) => plex.get(`library/sections/${x.key}/refresh`)))).then(() => toast('Plex library scan started')).catch(toastError) },
    isConfigured('radarr') && { title: 'Search for all missing movies', icon: icon.search, kind: 'Radarr', keys: 'missing search movies', action: () => radarr.post('command', { name: 'MissingMoviesSearch' }).then(() => toast('Searching missing movies')).catch(toastError) },
    isConfigured('sonarr') && { title: 'Search for all missing episodes', icon: icon.search, kind: 'Sonarr', keys: 'missing search episodes', action: () => sonarr.post('command', { name: 'MissingEpisodeSearch' }).then(() => toast('Searching missing episodes')).catch(toastError) },
    { title: 'Settings', icon: icon.sliders, kind: 'System', keys: 'settings config preferences connections', action: () => openApp('settings') },
    ...['radarr', 'sonarr', 'nzbget', 'jellyfin', 'plex', 'pikvm'].filter((s) => serviceLink(s)).map((s) => ({ title: `Open ${getApp(s).name} web UI`, icon: icon.globe, kind: 'Web UI', keys: `web ui native open ${s}`, action: () => openWebView(s) })),
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
      isConfigured('plex') ? plexGet('hubs/search', { query: term, limit: 6 }).then((mc) => (mc.Hub || []).filter((x) => ['movie', 'show', 'episode'].includes(x.type)).flatMap((x) => x.Metadata || []).slice(0, 8).map((m) => ({
        title: m.type === 'episode' ? `${m.grandparentTitle} — ${m.title}` : m.title, sub: `${m.type[0].toUpperCase()}${m.type.slice(1)}${m.year ? ' · ' + m.year : ''}`,
        poster: plexImage(m.type === 'episode' ? m.grandparentThumb || m.thumb : m.thumb, 120), kind: 'Plex', action: () => openApp('plexviewer', { ratingKey: m.ratingKey }),
      }))).catch(() => []) : [],
      cachedGames().then((games) => games.filter((g) => g.title.toLowerCase().includes(term)).slice(0, 8).map((g) => ({
        title: g.title, sub: GAME_SYSTEMS[g.system]?.name || g.system, icon: appIcon.console, kind: 'Game', action: () => openApp('console', { game: g.id }),
      }))).catch(() => []),
    ]);
    if (mine !== seq) return;
    const wanted = !libs[0].length && !libs[1].length && !addHits.length ? [
      isConfigured('radarr') && { title: `Add movie “${input.value.trim()}”`, sub: 'Search Radarr', icon: appIcon.radarr, kind: 'Radarr', action: () => openApp('radarr', { section: 'add', term: input.value.trim() }) },
      isConfigured('sonarr') && { title: `Add series “${input.value.trim()}”`, sub: 'Search Sonarr', icon: appIcon.sonarr, kind: 'Sonarr', action: () => openApp('sonarr', { section: 'add', term: input.value.trim() }) },
    ].filter(Boolean) : [];
    renderGroups([...groups, { title: 'Movies', items: libs[0] }, { title: 'Series', items: libs[1] }, { title: 'In Jellyfin', items: libs[2] }, { title: 'In Plex', items: libs[3] }, { title: 'Games', items: libs[4] }, { title: 'Not in your library', items: wanted }]);
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
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openLauncher(); }
    else if (e.altKey && e.key.toLowerCase() === 'w') { const w = focusedWindow(); if (w) { e.preventDefault(); w.close(); } }
  });
}

// ---------------------------------------------------------------------------
// Lock screen (only when a portal password is configured)
// ---------------------------------------------------------------------------

export function showLockScreen(onUnlock) {
  if (document.querySelector('.lock')) return;
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

