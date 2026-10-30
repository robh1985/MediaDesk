// Settings: a page per app (connection, notifications, preferences), plus general options.

import { h, clear, toast, toastError, spinner, sidebarLayout, confirmDialog, contextMenu, debounce } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { portal, state, radarr, sonarr, nzbget, jellyfin, isConfigured } from '../api.js';
import { applyAppearance, appearance, WALLPAPERS, ACCENTS, WALLPAPER_FITS, useCustomWallpaper, setWallpaperFromFile } from '../desktop.js';
import { pickFile } from '../fileapi.js';
import { layout, updateDock, updateDesktop, resetLayout, PLACEABLE_EXCLUDE } from '../layout.js';
import { getApps } from '../wm.js';
import { SCREENSAVERS } from '../savers.js';
import * as screensaver from '../screensaver.js';

const SERVICES = {
  radarr: { name: 'Radarr', port: 7878, hint: 'Radarr → Settings → General → Security → API Key' },
  sonarr: { name: 'Sonarr', port: 8989, hint: 'Sonarr → Settings → General → Security → API Key' },
  nzbget: { name: 'NZBGet', port: 6789, hint: 'NZBGet → Settings → Security → ControlUsername / ControlPassword' },
  jellyfin: { name: 'Jellyfin', port: 8096, hint: 'Jellyfin → Dashboard → API Keys → +' },
  pikvm: { name: 'PiKVM', port: 443, hint: 'the PiKVM web login (user admin unless you changed it). MediaDesk signs in for you; the password stays on the MediaDesk server.' },
  plex: { name: 'Plex', port: 32400, hint: 'easiest is “Sign in with Plex” above. To paste a token instead: in Plex Web open any movie → ⋯ → Get Info → View XML, and copy X-Plex-Token from the address bar.' },
};

const NOTIFICATIONS = {
  radarr: [['notifyImported', 'A movie finishes downloading'], ['notifyGrabbed', 'A release is grabbed (sent to the downloader)'], ['notifyHealth', 'Radarr reports a problem']],
  sonarr: [['notifyImported', 'An episode finishes downloading'], ['notifyGrabbed', 'A release is grabbed (sent to the downloader)'], ['notifyHealth', 'Sonarr reports a problem']],
  nzbget: [['notifyComplete', 'A download finishes'], ['notifyFailed', 'A download fails']],
  jellyfin: [['notifyPlayback', 'Someone starts watching something']],
  pikvm: [],
  plex: [['notifyPlayback', 'Someone starts watching something'], ['notifyAdded', 'New movies or episodes are added']],
};

export const settingsApp = {
  id: 'settings', name: 'Settings', icon: appIcon.settings, size: [900, 680], description: 'Apps, connections & appearance',
  open(win, opts = {}) {
    const page = (id, label, ic, render) => ({ id, label, icon: ic, render });
    const appIconSmall = (svc) => `<span class="settings-nav-app">${appIcon[svc]}</span>`;
    const layout = sidebarLayout([
      page('general', 'General', icon.sliders, renderGeneral),
      ...Object.keys(SERVICES).map((svc) => page(svc, SERVICES[svc].name, appIconSmall(svc), (c) => renderApp(c, svc))),
      page('music', 'Music', appIconSmall('music'), renderMusic),
      page('files', 'Files', appIconSmall('files'), renderFiles),
      page('console', 'The Game Console', appIconSmall('console'), renderConsole),
      page('appearance', 'Appearance', icon.image, renderAppearance),
      page('dock', 'Dock & Desktop', icon.grid, renderDockPage),
      page('screensaver', 'Screensaver', icon.moon, renderScreensaver),
      page('about', 'About', icon.heartPulse, renderAbout),
    ], { initial: opts.tab });
    win.body.append(h('div', { class: 'settings' }, layout.root));
    win.on('reopen', (o) => { if (o?.tab) layout.show(o.tab); });
  },
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const prefs = (app) => state.config.appSettings?.[app] || {};
const connected = (version) => `Connected${version ? ` · ${/^\d/.test(version) ? 'v' : ''}${version}` : ''}`;

// Preferences save as soon as they change; a small "Saved" appears next to the section title.
async function savePref(app, patch, status) {
  try {
    state.config = await portal.saveConfig({ appSettings: { [app]: patch } });
    if (status) {
      clear(status, h('span', { html: icon.check }), 'Saved');
      status.classList.add('show');
      clearTimeout(status.timer);
      status.timer = setTimeout(() => status.classList.remove('show'), 1500);
    }
  } catch (err) { toastError(err, 'Could not save'); }
}

function section(title, ...children) {
  const status = h('span', { class: 'saved-flag' });
  const el = h('section', { class: 'settings-section' }, h('h3', { class: 'section-title' }, title, status), ...children);
  el.status = status;
  return el;
}

function toggle(app, key, label, help, sec) {
  const input = h('input', { type: 'checkbox', checked: prefs(app)[key] });
  input.addEventListener('change', () => savePref(app, { [key]: input.checked }, sec().status));
  return h('label', { class: 'pref-row' }, input, h('span', {}, h('span', {}, label), help ? h('span', { class: 'small muted pref-help' }, help) : null));
}

function select(app, key, label, options, sec, { numeric = false, help } = {}) {
  const el = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(prefs(app)[key]) === String(v) }, l)));
  el.addEventListener('change', () => savePref(app, { [key]: numeric ? Number(el.value) : el.value }, sec().status));
  return h('label', { class: 'pref-row pref-select' }, h('span', {}, h('span', {}, label), help ? h('span', { class: 'small muted pref-help' }, help) : null), el);
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function renderGeneral(container, nav) {
  const cfg = state.config;
  const statusList = h('div', { class: 'conn-list' });
  let sec;
  const popups = h('input', { type: 'checkbox', checked: prefs('general').actionPopups !== false });
  popups.addEventListener('change', () => savePref('general', { actionPopups: popups.checked }, sec.status));
  sec = section('Pop-ups',
    h('label', { class: 'pref-row' }, popups, h('span', {}, h('span', {}, 'Show a pop-up to confirm things I do'),
      h('span', { class: 'small muted pref-help' }, 'For example “Movie added” or “Downloads paused”. Errors always pop up.'))));

  container.append(
    h('div', { class: 'pane-header' }, h('h2', {}, 'General')),
    cfg.mock ? h('div', { class: 'notice' }, 'Demo mode: connections and folders can’t be changed, but preferences can be tried out until the demo restarts.') : null,
    section('Connections',
      h('p', { class: 'small muted' }, 'Each app’s connection details are on its own page in the sidebar.'),
      statusList,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => testAll() }, h('span', { html: icon.heartPulse }), 'Test all connections'))),
    section('Notifications',
      h('p', { class: 'small muted' }, 'Things that happen in your apps, such as a finished download, add to the number on that app’s icon instead of popping up. Opening the app clears its number, and the bell in the menu bar lists everything. MediaDesk keeps counting even when no browser is open. Choose what counts on each app’s page.')),
    sec);

  const testAll = async () => {
    clear(statusList, Object.entries(SERVICES).map(([svc, s]) => h('div', { class: 'conn-row' }, h('span', { class: 'service-icon', html: appIcon[svc] }), s.name, h('span', { class: 'conn-status' }, h('span', { class: 'spinner sm' })))));
    try {
      const res = await portal.test();
      clear(statusList, Object.entries(SERVICES).map(([svc, s]) => {
        const r = res[svc];
        return h('button', { class: 'conn-row', title: `${s.name} settings`, onclick: () => nav.show(svc) },
          h('span', { class: 'service-icon', html: appIcon[svc] }), s.name,
          h('span', { class: 'conn-status' }, h('span', { class: `dot ${r.ok ? 'ok' : 'bad'}` }), r.ok ? connected(r.version) : r.error));
      }));
    } catch (err) { toastError(err); }
  };
  testAll();
}

// ---------------------------------------------------------------------------
// Per-app pages
// ---------------------------------------------------------------------------

function renderApp(container, svc) {
  const meta = SERVICES[svc];
  const conn = state.config.services[svc];
  const status = h('span', { class: 'conn-status' });
  container.append(
    h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon[svc] }), h('h2', {}, meta.name), status),
    connectionSection(svc, status));

  let notif;
  if (NOTIFICATIONS[svc].length) {
    notif = section('Notifications',
      h('p', { class: 'small muted' }, `Count these on the ${meta.name} icon:`),
      NOTIFICATIONS[svc].map(([key, label]) => toggle(svc, key, label, null, () => notif)));
    container.append(notif);
  }

  const prefsBox = h('div', {});
  container.append(prefsBox);
  if (!conn.configured) {
    prefsBox.append(h('p', { class: 'muted small' }, `Connect ${meta.name} to see its other settings.`));
  } else {
    prefsBox.append(spinner('Loading options…'));
    ({ radarr: arrPrefs, sonarr: arrPrefs, nzbget: nzbgetPrefs, jellyfin: jellyfinPrefs, plex: plexPrefs, pikvm: pikvmPrefs })[svc](prefsBox, svc)
      .catch((err) => clear(prefsBox, h('p', { class: 'small muted' }, `Couldn’t load ${meta.name}’s options: ${err.message}`)));
  }

  portal.test().then((res) => {
    const r = res[svc];
    clear(status, h('span', { class: `dot ${r.ok ? 'ok' : 'bad'}` }), r.ok ? connected(r.version) : r.error);
    if (r.warning) status.parentElement.after(h('div', { class: 'notice' }, r.warning));
  }).catch(() => {});
}

function connectionSection(svc, statusEl) {
  const meta = SERVICES[svc];
  const c = state.config.services[svc];
  const locked = state.config.mock;
  const f = {};
  const field = (key, label, attrs = {}) => {
    f[key] = h('input', { class: 'input', value: attrs.value ?? c[key] ?? '', ...attrs, disabled: locked });
    return h('label', { class: 'field' }, h('span', {}, label), f[key]);
  };
  const save = h('button', { class: 'btn btn-primary', disabled: locked }, h('span', { html: icon.check }), 'Save & reconnect');
  const sec = section('Connection',
    svc === 'plex' ? plexSignInBox(statusEl) : null,
    h('div', { class: 'field-grid' },
      field('url', 'Server URL (as seen by the MediaDesk server)', { placeholder: svc === 'pikvm' ? 'https://192.168.1.50' : `http://192.168.1.10:${meta.port}` }),
      field('publicUrl', 'Browser URL for “Open in…” links (optional)', { placeholder: 'Same as server URL' }),
      svc === 'nzbget' || svc === 'pikvm' ? [
        field('username', 'Username', { placeholder: svc === 'pikvm' ? 'admin' : 'nzbget' }),
        field('password', 'Password', { type: 'password', value: '', placeholder: c.hasPassword ? '•••••••• (unchanged)' : '' }),
      ] : field('apiKey', svc === 'plex' ? 'Plex token' : 'API key', { type: 'password', value: '', placeholder: c.hasApiKey ? '•••••••• (unchanged)' : svc === 'plex' ? 'Paste a Plex token' : 'Paste API key', autocomplete: 'off' })),
    svc === 'pikvm' ? h('label', { class: 'pref-row' }, f.verifyTls = h('input', { type: 'checkbox', checked: Boolean(c.verifyTls), disabled: locked }),
      h('span', {}, h('span', {}, 'Verify the certificate'), h('span', { class: 'small muted pref-help' }, 'Leave off unless your PiKVM has a certificate this server trusts — PiKVM uses its own self-signed one by default.'))) : null,
    h('div', { class: 'small muted' }, `Where to find it: ${meta.hint}`),
    h('div', { class: 'btn-row' }, save));
  save.onclick = async () => {
    save.disabled = true;
    try {
      state.config = await portal.saveConfig({ services: { [svc]: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value])) } });
      const r = (await portal.test())[svc];
      clear(statusEl, h('span', { class: `dot ${r.ok ? 'ok' : 'bad'}` }), r.ok ? connected(r.version) : r.error);
      toast(`${meta.name} saved`, { body: 'Reloading to reconnect…', type: 'success' });
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toastError(err, 'Could not save'); save.disabled = false; }
  };
  return sec;
}

async function arrPrefs(box, svc) {
  const api = svc === 'radarr' ? radarr : sonarr;
  const noun = svc === 'radarr' ? 'movies' : 'series';
  const [profiles, roots] = await Promise.all([api.get('qualityprofile'), api.get('rootfolder')]);
  let add, cal;
  add = section(`Adding ${noun}`,
    select(svc, 'qualityProfileId', 'Quality profile', [[0, 'Last one I used'], ...profiles.map((p) => [p.id, p.name])], () => add, { numeric: true }),
    select(svc, 'rootFolder', 'Root folder', [['', 'Last one I used'], ...roots.map((r) => [r.path, r.path])], () => add),
    svc === 'radarr'
      ? select(svc, 'minimumAvailability', 'Minimum availability', [['announced', 'Announced'], ['inCinemas', 'In cinemas'], ['released', 'Released']], () => add,
        { help: 'When Radarr starts looking for a release.' })
      : select(svc, 'monitor', 'Episodes to monitor', [['all', 'All episodes'], ['future', 'Future episodes'], ['missing', 'Missing episodes'], ['existing', 'Existing episodes'],
        ['firstSeason', 'First season'], ['latestSeason', 'Latest season'], ['pilot', 'Pilot episode'], ['none', 'None']], () => add),
    svc === 'sonarr' ? toggle(svc, 'seasonFolder', 'Use season folders', null, () => add) : null,
    toggle(svc, 'searchOnAdd', 'Start searching as soon as it’s added', null, () => add));
  cal = section('Calendar',
    select(svc, 'calendarDays', 'Show upcoming releases for', [[7, '1 week'], [14, '2 weeks'], [28, '4 weeks'], [60, '2 months']], () => cal, { numeric: true }));
  clear(box, add, cal);
}

async function nzbgetPrefs(box) {
  const conf = await nzbget('config');
  const cats = conf.filter((o) => /^Category\d+\.Name$/.test(o.Name) && o.Value).map((o) => o.Value);
  let add, bar;
  add = section('Adding NZBs',
    select('nzbget', 'defaultCategory', 'Default category', [['', 'No category'], ...cats.map((c) => [c, c])], () => add),
    select('nzbget', 'defaultPriority', 'Default priority', [[0, 'Normal'], [50, 'High'], [100, 'Very high'], [900, 'Force'], [-50, 'Low'], [-100, 'Very low']], () => add, { numeric: true }));
  bar = section('Menu bar',
    toggle('nzbget', 'speedInMenuBar', 'Show download speed in the menu bar', null, () => bar));
  clear(box, add, bar);
}

async function jellyfinPrefs(box) {
  const users = await jellyfin.get('Users');
  const current = state.config.services.jellyfin.userId || '';
  const userSel = h('select', { class: 'input', disabled: state.config.mock },
    h('option', { value: '' }, 'First administrator (automatic)'),
    users.map((u) => h('option', { value: u.Id, selected: u.Id === current }, `${u.Name}${u.Policy?.IsAdministrator ? ' (admin)' : ''}`)));
  let browse, home, desk;
  userSel.addEventListener('change', async () => {
    try {
      state.config = await portal.saveConfig({ services: { jellyfin: { userId: userSel.value } } });
      state.jellyfinUser = null;
      savePref('jellyfin', {}, browse.status);
    } catch (err) { toastError(err, 'Could not save'); }
  });
  browse = section('Browsing',
    h('label', { class: 'pref-row pref-select' }, h('span', {}, h('span', {}, 'Browse as'),
      h('span', { class: 'small muted pref-help' }, 'Whose watched status, favourites and “Continue watching” MediaDesk shows.')), userSel));
  home = section('Home screen rows',
    toggle('jellyfin', 'rowResume', 'Continue watching', null, () => home),
    toggle('jellyfin', 'rowNextUp', 'Next up', null, () => home),
    toggle('jellyfin', 'rowLatest', 'Recently added', null, () => home));
  desk = section('Desktop',
    toggle('jellyfin', 'nowPlayingWidget', 'Show the Now playing widget', null, () => desk));
  clear(box, browse, home, desk);
}

// Sign in with Plex: Plex's own sign-in page approves MediaDesk, then you pick the server and the
// address MediaDesk should use to reach it. The token is kept on the MediaDesk server.
function plexSignInBox(statusEl) {
  const box = h('div', { class: 'plex-signin' });
  const start = h('button', { class: 'btn btn-primary plex-signin-btn' }, h('span', { html: appIcon.plex }), 'Sign in with Plex');
  const note = h('div', { class: 'small muted' }, 'Opens plex.tv in a new tab. After you approve MediaDesk, choose your server here.');
  box.append(h('div', { class: 'btn-row' }, start), note);
  start.onclick = async () => {
    start.disabled = true;
    // Open the tab straight away (in the click) so pop-up blockers allow it.
    const tab = window.open('about:blank', '_blank');
    try {
      const pin = await portal.plexPin();
      if (tab && pin.authUrl !== 'about:blank') tab.location = pin.authUrl;
      else if (tab) tab.close();
      clear(note, h('span', { class: 'spinner sm' }), ' Waiting for you to approve MediaDesk on plex.tv… ',
        pin.authUrl !== 'about:blank' ? h('a', { href: pin.authUrl, target: '_blank', rel: 'noopener' }, 'Open the sign-in page') : null);
      const began = Date.now();
      let r;
      while (box.isConnected && Date.now() - began < 10 * 60e3) {
        r = await portal.plexPinStatus(pin.id);
        if (r.done) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!r?.done) throw new Error('Sign-in timed out. Try again.');
      chooseServer(pin.id, r.servers);
    } catch (err) {
      tab?.close();
      toastError(err, 'Plex sign-in failed');
      clear(note, 'Opens plex.tv in a new tab. After you approve MediaDesk, choose your server here.');
      start.disabled = false;
    }
  };
  const chooseServer = (pinId, servers) => {
    if (!servers.length) {
      clear(note, 'Signed in, but this Plex account has no servers. Sign in with the account that owns (or was shared) your server.');
      start.disabled = false;
      return;
    }
    const serverSel = h('select', { class: 'input' }, servers.map((s) => h('option', { value: s.id }, `${s.name}${s.owned ? '' : ' (shared with you)'}`)));
    const uriSel = h('select', { class: 'input' });
    const custom = h('input', { class: 'input', placeholder: 'Or type an address, e.g. http://192.168.1.20:32400' });
    const fill = () => {
      const s = servers.find((x) => x.id === serverSel.value);
      // Local addresses first: the MediaDesk server is usually on the same network as Plex.
      const list = [...s.connections].sort((a, b) => (b.local - a.local) || (a.relay - b.relay));
      clear(uriSel, list.map((c) => h('option', { value: c.uri }, `${c.uri}${c.local ? ' · local' : c.relay ? ' · relay (slow)' : ' · remote'}`)));
    };
    serverSel.onchange = fill;
    fill();
    const use = h('button', { class: 'btn btn-primary' }, h('span', { html: icon.check }), 'Use this server');
    use.onclick = async () => {
      use.disabled = true;
      try {
        state.config = await portal.plexUse({ pin: pinId, server: serverSel.value, uri: custom.value.trim() || uriSel.value });
        const t = (await portal.test()).plex;
        clear(statusEl, h('span', { class: `dot ${t.ok ? 'ok' : 'bad'}` }), t.ok ? connected(t.version) : t.error);
        if (!t.ok) { toastError(new Error(t.error), 'Signed in, but MediaDesk can’t reach that address'); use.disabled = false; return; }
        toast('Plex connected', { body: 'Reloading…', type: 'success' });
        setTimeout(() => location.reload(), 1200);
      } catch (err) { toastError(err, 'Could not save'); use.disabled = false; }
    };
    clear(box,
      h('div', { class: 'small' }, 'Signed in to Plex. Choose your server and the address the MediaDesk server should use to reach it:'),
      h('div', { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Server'), serverSel),
        h('label', { class: 'field' }, h('span', {}, 'Address'), uriSel),
        h('label', { class: 'field' }, h('span', {}, 'Custom address (optional)'), custom)),
      h('div', { class: 'btn-row' }, use));
  };
  return box;
}

async function pikvmPrefs(box) {
  let use;
  use = section('Using PiKVM',
    select('pikvm', 'video', 'Screen', [['stream', 'Live video (MJPEG stream)'], ['snapshots', 'Pictures, a few a second (for slow links or proxies that block streams)']], () => use),
    toggle('pikvm', 'confirmPower', 'Ask before power actions', 'Shut down, force off and reset ask first.', () => use));
  clear(box, use);
}

async function plexPrefs(box) {
  const { serverInfo } = await import('./plex-common.js');
  const info = await serverInfo(true);
  let account, home, play, desk;
  account = section('Server',
    h('div', { class: 'pref-row' }, h('span', {}, h('span', {}, info.friendlyName || 'Plex Media Server'),
      h('span', { class: 'small muted pref-help' }, [`Version ${info.version || '?'}`, info.myPlexUsername ? `signed in as ${info.myPlexUsername}` : null].filter(Boolean).join(' · '))),
    h('span', { class: `badge ${info.myPlexSubscription ? 'badge-plexpass' : ''}` }, info.myPlexSubscription ? 'Plex Pass' : 'No Plex Pass')));
  home = section('Plex Viewer home rows',
    toggle('plex', 'rowContinue', 'Continue watching', null, () => home),
    toggle('plex', 'rowOnDeck', 'On deck', null, () => home),
    toggle('plex', 'rowRecent', 'Recently added', null, () => home));
  play = section('Playback',
    select('plex', 'quality', 'Video quality', [['original', 'Original (convert only when needed)'], ['20000', '20 Mbps · 1080p'], ['12000', '12 Mbps · 1080p'], ['8000', '8 Mbps · 1080p'],
      ['4000', '4 Mbps · 720p'], ['2000', '2 Mbps · 720p'], ['1500', '1.5 Mbps · 480p'], ['720', '720 kbps · 360p']], () => play,
    { help: 'Lower it when watching over a slow connection. You can also change it while watching (⚙).' }),
    toggle('plex', 'autoplayNext', 'Play the next episode automatically', null, () => play));
  desk = section('Desktop',
    toggle('plex', 'nowPlayingWidget', 'Show Plex streams in the Now playing widget', null, () => desk));
  clear(box, account, home, play, desk);
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

function renderMusic(container) {
  let vis, bar;
  vis = section('Visualizer',
    select('music', 'visAutoSeconds', 'Change preset every', [[0, 'Never (stay on one)'], [10, '10 seconds'], [20, '20 seconds'], [40, '40 seconds'], [60, '1 minute']], () => vis, { numeric: true }),
    select('music', 'visQuality', 'Picture quality', [['low', 'Low (smoothest on slow devices)'], ['medium', 'Medium'], ['high', 'High (sharpest)']], () => vis,
      { help: 'Takes effect the next time Music opens.' }));
  bar = section('Menu bar', toggle('music', 'nowPlayingInMenuBar', 'Show the playing song in the menu bar', null, () => bar));
  container.append(
    h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.music }), h('h2', {}, 'Music')),
    h('p', { class: 'small muted' }, 'Music plays songs from your Jellyfin music library and from folders shared in Files. Your playlist, volume and equalizer are remembered on each device.'),
    vis, bar);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function renderConsole(container) {
  const cfg = state.config;
  const input = h('input', { class: 'input', value: cfg.games?.folder || '', disabled: cfg.mock, spellcheck: 'false', placeholder: 'For example D:\\Games or /mnt/games' });
  const save = h('button', { class: 'btn btn-primary', disabled: cfg.mock }, h('span', { html: icon.check }), 'Save folder');
  const status = h('div', { class: 'small muted' });
  container.append(h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.console }), h('h2', {}, 'The Game Console')));
  if (cfg.mock) container.append(h('div', { class: 'notice' }, 'Demo mode: The Game Console shows sample games plus a small test cartridge that MediaDesk makes itself, and the folder can’t be changed.'));
  container.append(
    section('Games folder',
      h('p', { class: 'muted small' }, 'The root folder for The Game Console on the computer running MediaDesk, as a full path. Inside it: ROMS\\<console>\\<game files> for cartridge games, ROMS\\<console>\\<game name>\\<disc files> for disc games, BIOS\\<console>\\<BIOS files>, Saves\\<console>\\<game name>\\<save files> and Box Art\\<console>\\<game name>.png. In The Game Console, Settings → Library makes these folders and can move games you already have into them. A folder without a ROMS folder still works the old way (read only, with saves kept by MediaDesk).'),
      h('label', { class: 'field' }, h('span', {}, 'Folder'), input),
      status,
      h('div', { class: 'btn-row' }, save, h('button', { class: 'btn', onclick: () => import('../wm.js').then((wm) => wm.openApp('console')) }, h('span', { html: icon.external }), 'Open The Game Console'))),
    section('Emulators',
      h('p', { class: 'muted small' }, 'Games run in your browser with EmulatorJS. The MediaDesk server downloads each console’s emulator from npm the first time it’s needed and keeps it with its settings, so the server needs internet access once per console. Themes, controller mappings and each console’s options are in the app itself (Start / Menu button, or the ⚙ button).')));
  fetch('/portal/games/library', { credentials: 'same-origin' }).then((r) => r.json()).then((lib) => {
    if (lib.configured) status.textContent = `${lib.games.length} game${lib.games.length === 1 ? '' : 's'} found${lib.bios?.length ? `, ${lib.bios.length} BIOS file${lib.bios.length === 1 ? '' : 's'}` : ''}.`;
  }).catch((err) => { status.textContent = err.message; });
  save.onclick = async () => {
    save.disabled = true;
    try {
      state.config = await portal.saveConfig({ gamesFolder: input.value.trim() });
      toast('Games folder saved', { type: 'success', icon: appIcon.console });
      clear(container);
      renderConsole(container);
    } catch (err) { toastError(err, 'Could not save the folder'); save.disabled = false; }
  };
}

// Aliases (a friendlier name shown under the full path) and colour tags for shared folders.
const TAG_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];
function folderDetails(cfg) {
  const files = cfg.files || {};
  let tags = (files.tags || []).map((t) => ({ ...t }));
  const info = Object.fromEntries((files.folders || []).map((f) => [f.path, { alias: f.alias || '', tags: [...(f.tags || [])] }]));
  const tagBox = h('div', { class: 'fm-tags-edit' });
  const cards = h('div', { class: 'fm-folder-cards' });
  const status = h('span', { class: 'small muted' });
  const save = debounce(async () => {
    try {
      state.config = await portal.saveConfig({ fileTags: tags, fileRootInfo: info });
      // Keep the ids the server settled on.
      tags = (state.config.files.tags || []).map((t) => ({ ...t }));
      dispatchEvent(new Event('mediadesk:folders'));
      status.textContent = 'Saved';
      setTimeout(() => { status.textContent = ''; }, 1500);
    } catch (err) { toastError(err, 'Could not save'); }
  }, 500);
  const chip = (t, on, onclick) => h('button', { class: `tag-chip ${on ? 'on' : ''}`, style: { '--tag': t.color }, onclick, 'aria-pressed': String(on) }, h('span', { class: 'tag-dot' }), t.name);

  const drawTags = () => clear(tagBox,
    tags.map((t) => {
      const name = h('input', { class: 'input tag-name', value: t.name, maxlength: 30, 'aria-label': 'Tag name' });
      name.addEventListener('input', () => { t.name = name.value; drawCards(); save(); });
      const colors = h('div', { class: 'tag-colors' }, TAG_COLORS.map((c) => h('button', { class: `tag-swatch ${t.color === c ? 'on' : ''}`, style: { background: c }, 'aria-label': `Colour ${c}`, onclick: () => { t.color = c; drawTags(); drawCards(); save(); } })));
      return h('div', { class: 'tag-row' }, h('span', { class: 'tag-dot big', style: { '--tag': t.color } }), name, colors,
        h('button', { class: 'btn btn-icon btn-sm', title: 'Delete tag', html: icon.trash, onclick: () => {
          tags = tags.filter((x) => x !== t);
          for (const v of Object.values(info)) v.tags = v.tags.filter((x) => x !== t.id);
          drawTags(); drawCards(); save();
        } }));
    }),
    h('div', { class: 'tag-add' },
      h('button', { class: 'btn btn-sm', onclick: () => {
        const n = tags.length + 1;
        tags.push({ id: Math.random().toString(36).slice(2, 10), name: `Tag ${n}`, color: TAG_COLORS[(n - 1) % TAG_COLORS.length] });
        drawTags(); drawCards(); save();
        tagBox.querySelectorAll('.tag-name')[tags.length - 1]?.select();
      } }, h('span', { html: icon.plus }), 'New tag')));

  const drawCards = () => clear(cards, (files.folders || []).length ? files.folders.map((f) => {
    const v = info[f.path];
    const alias = h('input', { class: 'input fm-alias', value: v.alias, maxlength: 60, placeholder: `Alias (optional) — shown instead of “${f.folderName}”` });
    alias.addEventListener('input', () => { v.alias = alias.value; aliasLine.textContent = v.alias.trim() || ''; aliasLine.hidden = !v.alias.trim(); save(); });
    const aliasLine = h('div', { class: 'fm-card-alias', hidden: !v.alias }, v.alias);
    return h('div', { class: 'fm-card' },
      h('div', { class: 'fm-card-path' }, f.path),
      aliasLine,
      alias,
      tags.length ? h('div', { class: 'tag-chips' }, tags.map((t) => chip(t, v.tags.includes(t.id), () => {
        v.tags = v.tags.includes(t.id) ? v.tags.filter((x) => x !== t.id) : [...v.tags, t.id];
        drawCards(); save();
      }))) : h('div', { class: 'small muted' }, 'Create a tag above to tag this folder.'));
  }) : h('div', { class: 'small muted' }, 'Add a shared folder above first.'));

  drawTags(); drawCards();
  return section('Folder names & tags',
    h('p', { class: 'muted small' }, 'Give a shared folder an alias to show in Files instead of its folder name, and tag folders to group and filter them. Changes save as you type.'),
    h('div', { class: 'fm-tags-head' }, h('strong', {}, 'Tags'), status), tagBox,
    h('div', { class: 'fm-tags-head' }, h('strong', {}, 'Shared folders')), cards);
}

function renderFiles(container) {
  const cfg = state.config;
  const files = cfg.files || { roots: [] };
  const area = h('textarea', { class: 'input fm-roots-input', rows: 6, spellcheck: 'false', disabled: cfg.mock,
    placeholder: 'One folder per line, for example:\nD:\\Media\nC:\\Users\\You\\Downloads' });
  area.value = files.roots.join('\n');
  const suggestions = h('div', { class: 'chips' });
  const save = h('button', { class: 'btn btn-primary', disabled: cfg.mock }, h('span', { html: icon.check }), 'Save folders');

  container.append(h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.files }), h('h2', {}, 'Files')));
  if (cfg.mock) container.append(h('div', { class: 'notice' }, 'Demo mode: Files is using sample folders in a temporary directory, and this list can’t be changed.'));
  else if (files.reason === 'password') {
    container.append(h('div', { class: 'notice notice-warn' },
      h('strong', {}, 'Files needs a portal password. '),
      'Files can change anything in the folders you share, so it stays switched off until MediaDesk has a password. On Windows, run install-windows.cmd again to set one; otherwise set PORTAL_PASSWORD.'));
  }
  let view;
  view = section('Viewing', toggle('files', 'showHidden', 'Show hidden files (names starting with a dot)', null, () => view));
  container.append(
    section('Shared folders',
      h('p', { class: 'muted small' }, 'The Files app can browse, upload, rename, move and delete anything inside these folders on the computer running MediaDesk, and nothing outside them. Use full paths as that computer sees them.'),
      area,
      h('div', { class: 'small muted', style: { margin: '10px 0 6px' } }, 'Suggestions from your connected apps:'),
      suggestions,
      h('div', { class: 'btn-row' }, save)),
    folderDetails(cfg),
    view,
    previewHelpers(cfg));

  const addLine = (p) => {
    const lines = area.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.includes(p)) area.value = [...lines, p].join('\n');
  };
  (async () => {
    const found = [];
    const tryAdd = async (label, fn) => { try { (await fn()).forEach((p) => p && found.push([p, label])); } catch { /* app unreachable */ } };
    await Promise.all([
      isConfigured('radarr') && tryAdd('Radarr', async () => (await radarr.get('rootfolder')).map((r) => r.path)),
      isConfigured('sonarr') && tryAdd('Sonarr', async () => (await sonarr.get('rootfolder')).map((r) => r.path)),
      isConfigured('nzbget') && tryAdd('NZBGet', async () => {
        const conf = await nzbget('config');
        const get = (n) => conf.find((o) => o.Name === n)?.Value || '';
        const main = get('MainDir');
        return [get('DestDir'), get('InterDir')].map((v) => v.replace('${MainDir}', main));
      }),
    ].filter(Boolean));
    clear(suggestions, found.length
      ? found.map(([p, label]) => h('button', { class: 'badge badge-info chip-btn', disabled: cfg.mock, onclick: () => addLine(p) }, `+ ${p} (${label})`))
      : h('span', { class: 'small muted' }, 'None found.'));
  })();

  save.onclick = async () => {
    save.disabled = true;
    try {
      state.config = await portal.saveConfig({ fileRoots: area.value.split('\n').map((l) => l.trim()).filter(Boolean) });
      toast('Folders saved', { body: state.config.files.enabled ? 'Open Files from the dock to manage them.' : '', type: 'success', icon: appIcon.files });
      clear(container);
      renderFiles(container);
    } catch (err) { toastError(err, 'Could not save folders'); save.disabled = false; }
  };
}

// Optional programs that let Preview open more kinds of file.
function previewHelpers(cfg) {
  const m = cfg.media || {};
  const win = /Win/.test(navigator.platform);
  const row = (ok, name, what, install) => h('div', { class: 'helper-row' },
    h('span', { class: `helper-dot ${ok ? 'ok' : ''}` }),
    h('div', { class: 'grow' }, h('strong', {}, name), h('span', { class: 'small muted' }, ok ? ` — found. ${what}` : ` — not found. ${what}`),
      ok ? null : h('div', { class: 'small helper-install' }, install)));
  const ffPath = h('input', { class: 'input', value: m.ffmpegPath || '', placeholder: win ? 'C:\\ffmpeg\\bin\\ffmpeg.exe (optional)' : '/usr/bin/ffmpeg (optional)', disabled: cfg.mock });
  const z = cfg.archive || {};
  const zPath = h('input', { class: 'input', value: z.sevenZipPath || '', placeholder: win ? 'C:\\Program Files\\7-Zip\\7z.exe (optional)' : '/usr/bin/7zz (optional)', disabled: cfg.mock });
  const loPath = h('input', { class: 'input', value: m.libreOfficePath || '', placeholder: win ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe (optional)' : '/usr/bin/soffice (optional)', disabled: cfg.mock });
  const check = h('button', { class: 'btn' }, h('span', { html: icon.refresh }), 'Check again');
  const sec = section('Helper programs',
    h('p', { class: 'muted small' }, 'Preview opens pictures, PDFs and most documents by itself. Free programs on the MediaDesk computer let it (and the Archive Expander) do more:'),
    row(m.ffmpeg, 'ffmpeg', 'Plays any video or audio format (AVI, WMV, MKV with any codec, FLV, MPEG-TS, WMA, AC3, …) and shows TIFF/HEIC pictures.',
      win ? h('span', {}, 'Install: open PowerShell and run ', h('code', {}, 'winget install Gyan.FFmpeg'), ', then restart MediaDesk (restart-windows.cmd).')
        : h('span', {}, 'Install: ', h('code', {}, 'sudo apt install ffmpeg'), ' (Docker images include it), then restart MediaDesk.')),
    row(m.office, 'LibreOffice', 'Shows Word, Excel and PowerPoint files exactly as they print, including older .doc and .ppt files.',
      win ? h('span', {}, 'Install: ', h('code', {}, 'winget install TheDocumentFoundation.LibreOffice'), ', then press Check again.')
        : h('span', {}, 'Install: ', h('code', {}, 'sudo apt install libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress'), ' (Docker: build with ', h('code', {}, '--build-arg WITH_OFFICE=true'), ').')),
    row(z.available, '7-Zip', `${z.available ? `(${z.version}) ` : ''}Lets the Archive Expander open, extract and create archives: 7z, ZIP, RAR, TAR, GZ, ISO, CAB, DMG, WIM and dozens more.`,
      win ? h('span', {}, 'Install: ', h('code', {}, 'winget install 7zip.7zip'), ' (or from 7-zip.org), then press Check again.')
        : h('span', {}, 'Install: ', h('code', {}, 'sudo apt install 7zip'), ' (older systems: ', h('code', {}, 'p7zip-full'), '; for RAR also ', h('code', {}, '7zip-rar'), '; macOS: ', h('code', {}, 'brew install sevenzip'), '; Docker images include it), then press Check again.')),
    h('details', { class: 'helper-paths' }, h('summary', { class: 'small' }, 'Installed somewhere unusual?'),
      h('label', { class: 'field' }, h('span', {}, 'ffmpeg program'), ffPath),
      h('label', { class: 'field' }, h('span', {}, 'LibreOffice program (soffice)'), loPath),
      h('label', { class: 'field' }, h('span', {}, '7-Zip program (7zz, 7z or 7z.exe)'), zPath)),
    h('div', { class: 'btn-row' }, check));
  check.onclick = async () => {
    check.disabled = true;
    try {
      state.config = await portal.saveConfig({ recheckTools: true, ...(cfg.mock ? {} : { ffmpegPath: ffPath.value, libreOfficePath: loPath.value, sevenZipPath: zPath.value }) });
      const t = state.config.media, a = state.config.archive || {};
      toast('Checked', { body: `ffmpeg ${t.ffmpeg ? 'found' : 'not found'} · LibreOffice ${t.office ? 'found' : 'not found'} · 7-Zip ${a.available ? 'found' : 'not found'}`, type: t.ffmpeg && t.office && a.available ? 'success' : 'info' });
      sec.replaceWith(previewHelpers(state.config));
    } catch (err) { toastError(err, 'Could not check'); check.disabled = false; }
  };
  return sec;
}

// ---------------------------------------------------------------------------
// Appearance & About
// ---------------------------------------------------------------------------

function renderAppearance(container) {
  const a = appearance();
  const set = (patch) => { applyAppearance({ ...appearance(), ...patch }); clear(container); renderAppearance(container); };
  container.append(
    h('div', { class: 'pane-header' }, h('h2', {}, 'Appearance')),
    h('p', { class: 'small muted' }, 'Appearance is saved in this browser, so each device can look different.'),
    h('h3', { class: 'section-title' }, 'Theme'),
    h('div', { class: 'seg' }, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) =>
      h('button', { class: `seg-btn ${a.theme === v ? 'active' : ''}`, onclick: () => set({ theme: v }) }, l))),
    h('h3', { class: 'section-title' }, 'Accent colour'),
    h('div', { class: 'swatches' }, Object.entries(ACCENTS).map(([k, v]) =>
      h('button', { class: `swatch ${a.accent === k ? 'active' : ''}`, title: k, style: { background: v }, onclick: () => set({ accent: k }) }))),
    h('h3', { class: 'section-title' }, 'Wallpaper'),
    wallpaperPicker(a, set),
    h('h3', { class: 'section-title' }, 'Desktop'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.widgets, onchange: (e) => set({ widgets: e.target.checked }) }), ' Show widgets on the desktop'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.icons, onchange: (e) => set({ icons: e.target.checked }) }), ' Show desktop icons'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.reduceMotion, onchange: (e) => set({ reduceMotion: e.target.checked }) }), ' Reduce motion & transparency'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => {
      Object.keys(localStorage).filter((k) => k.startsWith('mediadesk.win.')).forEach((k) => localStorage.removeItem(k));
      toast('Window positions reset');
    } }, 'Reset window positions')));
}

// Built-in wallpapers, your own pictures, and how a picture fills the screen.
function wallpaperPicker(a, set) {
  const grid = h('div', { class: 'wallpapers' });
  const fitRow = h('div', { class: 'wp-fit' });
  const status = h('div', { class: 'small muted wp-status' });
  const isImage = (e) => /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(e.name);
  let customs = [];

  const upload = async (file) => {
    status.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch(`/portal/wallpapers/upload?${new URLSearchParams({ name: file.name })}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      status.textContent = '';
      await useCustomWallpaper(data);
      set({});
    } catch (err) { status.textContent = ''; toastError(err, 'Could not add the picture'); }
  };
  const fromDevice = () => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); input.remove(); });
    document.body.append(input);
    input.click();
  };
  const fromServer = async () => {
    const pick = await pickFile({ mode: 'open', title: 'Choose a picture', accept: isImage });
    if (!pick) return;
    status.textContent = `Adding ${pick.name}…`;
    try { await setWallpaperFromFile(pick.root, pick.path); status.textContent = ''; set({}); }
    catch (err) { status.textContent = ''; toastError(err, 'Could not use that picture'); }
  };
  const remove = async (w) => {
    if (!(await confirmDialog({ title: 'Delete wallpaper?', message: `“${w.name}” will be removed from your wallpapers.`, confirm: 'Delete', danger: true }))) return;
    try {
      const res = await fetch('/portal/wallpapers/delete', { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: w.id }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const cur = appearance();
      set(cur.wallpaper === 'custom' && cur.customWallpaper?.id === w.id ? { wallpaper: 'aurora', customWallpaper: null } : {});
    } catch (err) { toastError(err, 'Could not delete'); }
  };

  const draw = () => {
    clear(grid,
      Object.entries(WALLPAPERS).map(([k, w]) =>
        h('button', { class: `wallpaper-opt ${a.wallpaper === k ? 'active' : ''}`, style: { background: w.css }, onclick: () => set({ wallpaper: k }) }, h('span', {}, w.name))),
      customs.map((w) => h('div', { class: `wallpaper-opt wp-custom ${a.wallpaper === 'custom' && a.customWallpaper?.id === w.id ? 'active' : ''}`, role: 'button', tabindex: '0', title: w.name,
        onclick: async () => { await useCustomWallpaper(w); set({}); },
        onkeydown: async (e) => { if (e.key === 'Enter') { await useCustomWallpaper(w); set({}); } } },
      h('img', { src: w.url, alt: '', loading: 'lazy' }), h('span', {}, w.name),
      h('button', { class: 'wp-delete', title: 'Delete', 'aria-label': `Delete ${w.name}`, html: icon.x, onclick: (e) => { e.stopPropagation(); remove(w); } }))),
      h('button', { class: 'wallpaper-opt wp-add', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        contextMenu(r.left, r.bottom + 4, [
          { label: 'From this device…', icon: icon.upload || icon.plus, action: fromDevice },
          { label: 'From shared folders…', icon: icon.folder, disabled: !state.config.files?.enabled, action: fromServer },
        ]);
      } }, h('span', { class: 'wp-add-icon', html: icon.plus }), h('span', {}, 'Add picture…')));
    fitRow.hidden = a.wallpaper !== 'custom';
    clear(fitRow, h('span', { class: 'small muted' }, 'Picture position'),
      h('div', { class: 'seg' }, Object.entries(WALLPAPER_FITS).map(([k, [label]]) =>
        h('button', { class: `seg-btn ${(a.wallpaperFit || 'fill') === k ? 'active' : ''}`, onclick: () => set({ wallpaperFit: k }) }, label))));
  };
  draw();
  fetch('/portal/wallpapers', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])).then((list) => { customs = list; draw(); }).catch(() => {});
  // Drop a picture onto the grid to add it.
  grid.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); grid.classList.add('drop'); } });
  grid.addEventListener('dragleave', () => grid.classList.remove('drop'));
  grid.addEventListener('drop', (e) => { e.preventDefault(); grid.classList.remove('drop'); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) upload(f); });
  return h('div', {}, grid, fitRow, status, h('p', { class: 'small muted' }, 'Your pictures are stored on the MediaDesk server, so every device can use them.'));
}

function renderDockPage(container) {
  const d = layout().dock;
  const phone = innerWidth < 760;
  const rerender = () => { clear(container); renderDockPage(container); };
  const set = (patch) => { updateDock(patch); rerender(); };
  const slider = (label, key, min, max, disabled) => {
    const out = h('span', { class: 'small muted slider-val' }, `${d[key]} px`);
    const input = h('input', { type: 'range', min, max, step: 2, value: d[key], disabled, class: 'pref-slider' });
    input.addEventListener('input', () => { out.textContent = `${input.value} px`; updateDock({ [key]: Number(input.value) }); });
    return h('label', { class: `pref-row pref-select ${disabled ? 'dimmed' : ''}` }, h('span', {}, h('span', {}, label)), input, out);
  };
  const check = (label, key, help, disabled) => h('label', { class: `pref-row ${disabled ? 'dimmed' : ''}` },
    h('input', { type: 'checkbox', checked: d[key], disabled, onchange: (e) => set({ [key]: e.target.checked }) }),
    h('span', {}, h('span', {}, label), help ? h('span', { class: 'small muted pref-help' }, help) : null));
  const seg = (options, value, onPick, disabled) => h('div', { class: 'seg' }, options.map(([v, l]) =>
    h('button', { class: `seg-btn ${value === v ? 'active' : ''}`, disabled, onclick: () => onPick(v) }, l)));

  const dock = section('Dock',
    phone ? h('p', { class: 'small muted' }, 'On phones the dock always sits at the bottom at a fixed size. Which apps it holds can still be changed below.') : null,
    slider('Size', 'size', 32, 80, phone),
    check('Magnification', 'magnify', 'Icons grow as the pointer passes over them.', phone),
    d.magnify ? slider('Magnified size', 'magnifySize', 48, 128, phone) : null,
    h('div', { class: `pref-row pref-select ${phone ? 'dimmed' : ''}` }, h('span', {}, h('span', {}, 'Position on screen')),
      seg([['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']], d.position, (v) => set({ position: v }), phone)),
    check('Automatically hide and show the Dock', 'autohide', 'Windows get the whole screen; move the pointer to the edge to bring the dock back.', phone),
    check('Show only open apps', 'onlyOpen', 'The Dock holds Search & apps, the apps you have open, and Settings. Turn off to keep your chosen apps in it.'),
    check('Show indicators for open apps', 'indicators'),
    d.onlyOpen ? null : check('Show open apps that aren’t kept in the Dock', 'showOpen'),
    h('div', { class: 'pref-row pref-select' }, h('span', {}, h('span', {}, 'Double-click a window’s title bar to')),
      seg([['zoom', 'Zoom'], ['minimize', 'Minimise']], d.titleDoubleClick, (v) => set({ titleDoubleClick: v }))));

  const l = layout();
  const onDesktop = (id) => l.desktop.items.some((it) => (it.type === 'app' && it.id === id) || (it.type === 'group' && it.apps.includes(id)));
  const apps = getApps().filter((a) => !PLACEABLE_EXCLUDE.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  const list = h('div', { class: 'dock-apps' },
    h('div', { class: 'dock-apps-head small muted' }, h('span', {}, 'App'), h('span', {}, 'In Dock'), h('span', {}, 'On desktop')),
    apps.map((a) => h('div', { class: 'dock-apps-row' },
      h('span', { class: 'dock-apps-name' }, h('span', { class: 'dock-apps-icon', html: a.icon }), a.name),
      h('input', { type: 'checkbox', 'aria-label': `${a.name} in Dock`, checked: d.apps.includes(a.id), disabled: d.onlyOpen, onchange: (e) => set({ apps: e.target.checked ? [...d.apps, a.id] : d.apps.filter((x) => x !== a.id) }) }),
      h('input', { type: 'checkbox', 'aria-label': `${a.name} on desktop`, checked: onDesktop(a.id), onchange: (e) => {
        updateDesktop((dk) => {
          if (e.target.checked) dk.items.push({ type: 'app', id: a.id });
          else {
            dk.items = dk.items.filter((it) => !(it.type === 'app' && it.id === a.id));
            dk.items.forEach((it) => { if (it.type === 'group') it.apps = it.apps.filter((x) => x !== a.id); });
          }
        });
        rerender();
      } }))));
  const appsSec = section('Apps', h('p', { class: 'small muted' }, d.onlyOpen
    ? 'The Dock shows only open apps, so “In Dock” applies when “Show only open apps” is off. Drop one desktop icon onto another to make a group.'
    : 'You can also drag apps in the Dock to reorder them, drag them off to remove them, and drag desktop icons onto the Dock. Drop one desktop icon onto another to make a group.'),
    list,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => { resetLayout('dock'); rerender(); toast('Dock reset'); } }, 'Reset Dock'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmDialog({ title: 'Reset the desktop?', message: 'Icons go back to their original places and groups are removed.', confirm: 'Reset', danger: true }))) return;
        resetLayout('desktop'); rerender(); toast('Desktop reset');
      } }, 'Reset desktop icons & groups')));

  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Dock & Desktop')),
    h('p', { class: 'small muted' }, 'Saved in this browser, so your phone and computer can be arranged differently.'),
    dock, appsSec);
}

function renderScreensaver(container) {
  const p = prefs('screensaver');
  const canLock = screensaver.passwordAvailable();
  let main, pick, opts;
  const enabled = h('input', { type: 'checkbox', checked: p.enabled });
  enabled.addEventListener('change', () => { savePref('screensaver', { enabled: enabled.checked }, main.status); refreshDisabled(); });
  const timeout = select('screensaver', 'timeoutMin', 'Start after', [1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => [m, m === 1 ? '1 minute' : m === 60 ? '1 hour' : `${m} minutes`]), () => main, { numeric: true });
  const lockBox = h('input', { type: 'checkbox', checked: p.requirePassword && canLock, disabled: !canLock });
  lockBox.addEventListener('change', () => savePref('screensaver', { requirePassword: lockBox.checked }, main.status));
  main = section('Screensaver',
    h('label', { class: 'pref-row' }, enabled, h('span', {}, h('span', {}, 'Use a screensaver'),
      h('span', { class: 'small muted pref-help' }, 'Starts when MediaDesk hasn’t been used for a while. Move the mouse, tap or press a key to return.'))),
    timeout,
    h('label', { class: `pref-row ${canLock ? '' : 'disabled'}` }, lockBox, h('span', {}, h('span', {}, 'Require password to return'),
      h('span', { class: 'small muted pref-help' }, canLock
        ? 'Locks MediaDesk in every tab on this browser until the portal password is entered. Jellyfin music keeps playing.'
        : 'Needs a portal password. On Windows, run install-windows.cmd again to set one; otherwise set PORTAL_PASSWORD.'))));
  const refreshDisabled = () => { [timeout, lockBox.closest('.pref-row')].forEach((el) => el.classList.toggle('dimmed', !enabled.checked)); };

  const current = () => prefs('screensaver').saver;
  const card = (id, name, origin) => h('button', { class: `ss-card ${current() === id ? 'active' : ''}`, dataset: { id }, onclick: () => choose(id) },
    h('span', { class: `ss-thumb ss-thumb-${id}` }), h('strong', {}, name), h('span', { class: 'small muted' }, origin));
  const grid = h('div', { class: 'ss-grid' }, card('random', 'Random', 'A different one each time'), SCREENSAVERS.map((s) => card(s.id, s.name, s.origin)));
  const choose = async (id) => {
    await savePref('screensaver', { saver: id }, pick.status);
    grid.querySelectorAll('.ss-card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  };
  pick = section('Choose a screensaver', grid,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: () => screensaver.start({ id: current(), preview: true }) }, h('span', { html: icon.play }), 'Preview')));

  const text = h('input', { class: 'input', value: p.text || '', maxlength: 40, placeholder: 'MediaDesk' });
  text.addEventListener('change', () => savePref('screensaver', { text: text.value.trim() || 'MediaDesk' }, opts.status));
  opts = section('Options',
    toggle('screensaver', 'skipVideo', 'Don’t start while a video is playing', null, () => opts),
    h('label', { class: 'pref-row pref-select' }, h('span', {}, h('span', {}, '3D Text message'), h('span', { class: 'small muted pref-help' }, 'The words shown by the 3D Text screensaver.')), text));

  container.append(h('div', { class: 'pane-header' }, h('h2', {}, 'Screensaver')), main, pick, opts,
    h('p', { class: 'small muted' }, 'Tip: the MediaDesk menu (top left) can start the screensaver or lock the screen at any time.'));
  refreshDisabled();
}

function renderAbout(container) {
  container.append(h('div', { class: 'about' },
    h('div', { class: 'about-logo', html: appIcon.dashboard }),
    h('h2', {}, 'MediaDesk'),
    h('p', { class: 'muted' }, 'One desktop for Radarr, Sonarr, NZBGet and Jellyfin.'),
    h('p', { class: 'small muted' }, `Version ${state.config.version || 'unknown'}`),
    h('p', { class: 'small muted' }, 'API keys stay on the MediaDesk server; your browser only talks to MediaDesk.'),
    h('div', { class: 'kbd-list' },
      h('div', {}, h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'Space'), ' or ', h('kbd', {}, '/'), ' Search everything'),
      h('div', {}, h('kbd', {}, 'Alt'), ' + ', h('kbd', {}, 'W'), ' Close window'),
      h('div', {}, 'Drag a window to a screen edge to snap it; to the top to maximise.'),
      h('div', {}, 'On touch screens, press and hold for the right-click menu.')),
    h('div', { class: 'btn-row about-actions' },
      // The same as "Reload now" after an update: loads MediaDesk afresh.
      h('button', { class: 'btn', title: 'Load MediaDesk again (picks up an update)', onclick: () => location.reload() }, h('span', { html: icon.refresh }), 'Reload'),
      state.config.auth ? h('button', { class: 'btn', onclick: () => portal.logout().then(() => location.reload()) }, h('span', { html: icon.lock }), 'Log out') : null)));
}
