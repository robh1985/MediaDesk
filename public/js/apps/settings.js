// Settings: service connections, appearance and session.

import { h, clear, toast, toastError, spinner } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { portal, state, radarr, sonarr, nzbget, isConfigured } from '../api.js';
import { applyAppearance, appearance, WALLPAPERS, ACCENTS } from '../desktop.js';
import { tabs } from './common.js';

const SERVICES = [
  { id: 'radarr', name: 'Radarr', port: 7878, hint: 'Settings → General → Security → API Key' },
  { id: 'sonarr', name: 'Sonarr', port: 8989, hint: 'Settings → General → Security → API Key' },
  { id: 'nzbget', name: 'NZBGet', port: 6789, hint: 'Settings → Security → ControlUsername / ControlPassword' },
  { id: 'jellyfin', name: 'Jellyfin', port: 8096, hint: 'Dashboard → API Keys → +' },
];

export const settingsApp = {
  id: 'settings', name: 'Settings', icon: appIcon.settings, size: [820, 640], description: 'Connections & appearance',
  open(win, opts = {}) {
    const content = h('div', { class: 'settings-content' });
    const bar = tabs([['services', 'Connections'], ['files', 'Files'], ['appearance', 'Appearance'], ['about', 'About']], (id) => {
      clear(content);
      ({ services: renderServices, files: renderFiles, appearance: renderAppearance, about: renderAbout })[id](content);
    }, opts.tab);
    win.body.append(h('div', { class: 'settings' }, bar, content));
    win.on('reopen', (o) => { if (o?.tab) bar.select(o.tab); });
  },
};

function renderServices(container) {
  const cfg = state.config;
  const statusEls = {};
  const inputs = {};
  if (cfg.mock) container.append(h('div', { class: 'notice' }, 'Demo mode is on: the portal is showing fake data and settings are read-only. Restart without --mock to use your own servers.'));

  for (const svc of SERVICES) {
    const c = cfg.services[svc.id];
    const f = (inputs[svc.id] = {});
    const field = (key, label, attrs = {}) => {
      f[key] = h('input', { class: 'input', value: attrs.value ?? c[key] ?? '', ...attrs, disabled: cfg.mock });
      return h('label', { class: 'field' }, h('span', {}, label), f[key]);
    };
    statusEls[svc.id] = h('span', { class: 'conn-status' });
    container.append(h('section', { class: 'service-card' },
      h('header', {}, h('span', { class: 'service-icon', html: appIcon[svc.id] }), h('h3', {}, svc.name), statusEls[svc.id]),
      h('div', { class: 'field-grid' },
        field('url', 'Server URL (as seen by the MediaDesk server)', { placeholder: `http://192.168.1.10:${svc.port}` }),
        field('publicUrl', 'Browser URL for “Open in…” links (optional)', { placeholder: 'Same as server URL' }),
        svc.id === 'nzbget' ? [
          field('username', 'Username', { placeholder: 'nzbget' }),
          field('password', 'Password', { type: 'password', value: '', placeholder: c.hasPassword ? '•••••••• (unchanged)' : '' }),
        ] : field('apiKey', 'API key', { type: 'password', value: '', placeholder: c.hasApiKey ? '•••••••• (unchanged)' : 'Paste API key', autocomplete: 'off' }),
        svc.id === 'jellyfin' ? field('userId', 'User ID for browsing (optional — defaults to first admin)', { placeholder: 'Auto' }) : null),
      h('div', { class: 'small muted' }, `Where to find it: ${svc.hint}`)));
  }

  const save = h('button', { class: 'btn btn-primary', disabled: cfg.mock }, h('span', { html: icon.check }), 'Save & reconnect');
  const test = h('button', { class: 'btn' }, h('span', { html: icon.heartPulse }), 'Test connections');
  container.append(h('div', { class: 'btn-row sticky-actions' }, test, save));

  const runTest = async () => {
    Object.values(statusEls).forEach((el) => clear(el, h('span', { class: 'spinner sm' })));
    try {
      const res = await portal.test();
      for (const [svc, r] of Object.entries(res)) {
        clear(statusEls[svc], h('span', { class: `dot ${r.ok ? 'ok' : 'bad'}` }), r.ok ? `Connected · v${r.version}` : r.error);
      }
    } catch (err) { toastError(err); }
  };
  test.onclick = runTest;
  save.onclick = async () => {
    const services = {};
    for (const [svc, f] of Object.entries(inputs)) services[svc] = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    save.disabled = true;
    try {
      state.config = await portal.saveConfig({ services });
      state.jellyfinUser = null;
      toast('Settings saved', { body: 'Reloading to reconnect…', type: 'success' });
      await runTest();
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toastError(err, 'Could not save'); save.disabled = false; }
  };
  runTest();
}

function renderFiles(container) {
  const cfg = state.config;
  const files = cfg.files || { roots: [] };
  const area = h('textarea', { class: 'input fm-roots-input', rows: 6, spellcheck: 'false', disabled: cfg.mock,
    placeholder: 'One folder per line, for example:\nD:\\Media\nC:\\Users\\You\\Downloads' });
  area.value = files.roots.join('\n');
  const suggestions = h('div', { class: 'chips' });
  const save = h('button', { class: 'btn btn-primary', disabled: cfg.mock }, h('span', { html: icon.check }), 'Save folders');

  if (cfg.mock) container.append(h('div', { class: 'notice' }, 'Demo mode: Files is using sample folders in a temporary directory, and this list can’t be changed.'));
  else if (files.reason === 'password') {
    container.append(h('div', { class: 'notice notice-warn' },
      h('strong', {}, 'Files needs a portal password. '),
      'Files can change anything in the folders you share, so it stays switched off until MediaDesk has a password. On Windows, run install-windows.cmd again to set one; otherwise set PORTAL_PASSWORD.'));
  }
  container.append(
    h('h3', { class: 'section-title' }, 'Shared folders'),
    h('p', { class: 'muted small' }, 'The Files app can browse, upload, rename, move and delete anything inside these folders on the computer running MediaDesk, and nothing outside them. Use full paths as that computer sees them.'),
    area,
    h('div', { class: 'small muted', style: { margin: '10px 0 6px' } }, 'Suggestions from your connected apps:'),
    suggestions,
    h('div', { class: 'btn-row sticky-actions' }, save));

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

function renderAppearance(container) {
  const a = appearance();
  const set = (patch) => { applyAppearance({ ...appearance(), ...patch }); clear(container); renderAppearance(container); };
  container.append(
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
      h('div', {}, 'Drag a window to a screen edge to snap it; to the top to maximise.')),
    state.config.auth ? h('button', { class: 'btn', onclick: () => portal.logout().then(() => location.reload()) }, h('span', { html: icon.lock }), 'Log out') : null));
}
