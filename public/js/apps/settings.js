// Settings: a page per app (connection, notifications, preferences), plus general options.

import { h, clear, toast, toastError, spinner, sidebarLayout } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { portal, state, radarr, sonarr, nzbget, jellyfin, isConfigured } from '../api.js';
import { applyAppearance, appearance, WALLPAPERS, ACCENTS } from '../desktop.js';

const SERVICES = {
  radarr: { name: 'Radarr', port: 7878, hint: 'Radarr → Settings → General → Security → API Key' },
  sonarr: { name: 'Sonarr', port: 8989, hint: 'Sonarr → Settings → General → Security → API Key' },
  nzbget: { name: 'NZBGet', port: 6789, hint: 'NZBGet → Settings → Security → ControlUsername / ControlPassword' },
  jellyfin: { name: 'Jellyfin', port: 8096, hint: 'Jellyfin → Dashboard → API Keys → +' },
};

const NOTIFICATIONS = {
  radarr: [['notifyImported', 'A movie finishes downloading'], ['notifyGrabbed', 'A release is grabbed (sent to the downloader)'], ['notifyHealth', 'Radarr reports a problem']],
  sonarr: [['notifyImported', 'An episode finishes downloading'], ['notifyGrabbed', 'A release is grabbed (sent to the downloader)'], ['notifyHealth', 'Sonarr reports a problem']],
  nzbget: [['notifyComplete', 'A download finishes'], ['notifyFailed', 'A download fails']],
  jellyfin: [['notifyPlayback', 'Someone starts watching something']],
};

export const settingsApp = {
  id: 'settings', name: 'Settings', icon: appIcon.settings, size: [900, 680], description: 'Apps, connections & appearance',
  open(win, opts = {}) {
    const page = (id, label, ic, render) => ({ id, label, icon: ic, render });
    const appIconSmall = (svc) => `<span class="settings-nav-app">${appIcon[svc]}</span>`;
    const layout = sidebarLayout([
      page('general', 'General', icon.sliders, renderGeneral),
      ...Object.keys(SERVICES).map((svc) => page(svc, SERVICES[svc].name, appIconSmall(svc), (c) => renderApp(c, svc))),
      page('files', 'Files', appIconSmall('files'), renderFiles),
      page('appearance', 'Appearance', icon.image, renderAppearance),
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
  notif = section('Notifications',
    h('p', { class: 'small muted' }, `Count these on the ${meta.name} icon:`),
    NOTIFICATIONS[svc].map(([key, label]) => toggle(svc, key, label, null, () => notif)));
  container.append(notif);

  const prefsBox = h('div', {});
  container.append(prefsBox);
  if (!conn.configured) {
    prefsBox.append(h('p', { class: 'muted small' }, `Connect ${meta.name} to see its other settings.`));
  } else {
    prefsBox.append(spinner('Loading options…'));
    ({ radarr: arrPrefs, sonarr: arrPrefs, nzbget: nzbgetPrefs, jellyfin: jellyfinPrefs })[svc](prefsBox, svc)
      .catch((err) => clear(prefsBox, h('p', { class: 'small muted' }, `Couldn’t load ${meta.name}’s options: ${err.message}`)));
  }

  portal.test().then((res) => {
    const r = res[svc];
    clear(status, h('span', { class: `dot ${r.ok ? 'ok' : 'bad'}` }), r.ok ? connected(r.version) : r.error);
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
    h('div', { class: 'field-grid' },
      field('url', 'Server URL (as seen by the MediaDesk server)', { placeholder: `http://192.168.1.10:${meta.port}` }),
      field('publicUrl', 'Browser URL for “Open in…” links (optional)', { placeholder: 'Same as server URL' }),
      svc === 'nzbget' ? [
        field('username', 'Username', { placeholder: 'nzbget' }),
        field('password', 'Password', { type: 'password', value: '', placeholder: c.hasPassword ? '•••••••• (unchanged)' : '' }),
      ] : field('apiKey', 'API key', { type: 'password', value: '', placeholder: c.hasApiKey ? '•••••••• (unchanged)' : 'Paste API key', autocomplete: 'off' })),
    h('div', { class: 'small muted' }, `Where to find it: ${meta.hint}`),
    h('div', { class: 'btn-row' }, save));
  save.onclick = async () => {
    save.disabled = true;
    try {
      state.config = await portal.saveConfig({ services: { [svc]: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) } });
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

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

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
    view);

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
    h('div', { class: 'wallpapers' }, Object.entries(WALLPAPERS).map(([k, w]) =>
      h('button', { class: `wallpaper-opt ${a.wallpaper === k ? 'active' : ''}`, style: { background: w.css }, onclick: () => set({ wallpaper: k }) }, h('span', {}, w.name)))),
    h('h3', { class: 'section-title' }, 'Desktop'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.widgets, onchange: (e) => set({ widgets: e.target.checked }) }), ' Show widgets on the desktop'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.icons, onchange: (e) => set({ icons: e.target.checked }) }), ' Show desktop icons'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.reduceMotion, onchange: (e) => set({ reduceMotion: e.target.checked }) }), ' Reduce motion & transparency'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => {
      Object.keys(localStorage).filter((k) => k.startsWith('mediadesk.win.')).forEach((k) => localStorage.removeItem(k));
      toast('Window positions reset');
    } }, 'Reset window positions')));
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
    state.config.auth ? h('button', { class: 'btn', onclick: () => portal.logout().then(() => location.reload()) }, h('span', { html: icon.lock }), 'Log out') : null));
}
