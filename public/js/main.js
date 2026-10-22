import { portal, state } from './api.js';
import { initWM, registerApp, openApp } from './wm.js';
import { applyAppearance, startDesktop, showLockScreen } from './desktop.js';
import { startLive } from './live.js';
import { toast } from './ui.js';
import { makeArrApp } from './apps/arr.js';
import { nzbgetApp } from './apps/nzbget.js';
import { jellyfinApp } from './apps/jellyfin.js';
import { dashboardApp } from './apps/dashboard.js';
import { settingsApp } from './apps/settings.js';
import { webviewApp } from './apps/webview.js';
import { filesApp } from './apps/files.js';

applyAppearance();

[dashboardApp, makeArrApp('radarr'), makeArrApp('sonarr'), nzbgetApp, jellyfinApp, filesApp, settingsApp, webviewApp,
  { id: 'launcher', name: 'Search', icon: '', open() {} }].forEach(registerApp);

async function boot() {
  state.config = await portal.config();
  initWM(document.getElementById('windows'));
  startDesktop();
  startLive();
  document.body.classList.add('ready');

  const anyConfigured = Object.values(state.config.services).some((s) => s.configured);
  if (!anyConfigured) {
    openApp('settings');
    toast('Welcome to MediaDesk', { body: 'Connect your services to get started.', timeout: 8000 });
  } else if (!sessionStorage.getItem('mediadesk.booted')) {
    openApp('dashboard');
  }
  try { sessionStorage.setItem('mediadesk.booted', '1'); } catch { /* ignore */ }
  if (state.config.mock) toast('Demo mode', { body: 'Showing sample data — no real servers are being contacted.', timeout: 6000 });
}

addEventListener('mediadesk:logout', () => location.reload());

// After MediaDesk is updated, pages that were already open are still running the old code.
// Notice that (by comparing the server's build fingerprint) and offer a reload.
let loadedBuild = null;
let staleShown = false;
function showUpdated() {
  if (staleShown) return;
  staleShown = true;
  toast('MediaDesk was updated', {
    body: 'Reload to start using the new version.', type: 'success', timeout: 0,
    action: { label: 'Reload now', onClick: () => location.reload() },
  });
}
async function checkForUpdate() {
  if (document.hidden || staleShown) return;
  try {
    const s = await portal.session();
    if (loadedBuild && s.build && s.build !== loadedBuild) showUpdated();
  } catch { /* server restarting */ }
}
addEventListener('mediadesk:stale', showUpdated);
document.addEventListener('visibilitychange', checkForUpdate);
setInterval(checkForUpdate, 60e3);

(async () => {
  try {
    const session = await portal.session();
    loadedBuild = session.build;
    if (session.auth && !session.authed) {
      document.body.classList.add('ready', 'locked');
      showLockScreen(() => { document.body.classList.remove('locked'); return boot(); });
    } else await boot();
  } catch (err) {
    document.body.classList.add('ready');
    document.getElementById('desktop').append(Object.assign(document.createElement('div'), {
      className: 'boot-error', textContent: `Could not reach the MediaDesk server: ${err.message}`,
    }));
  }
})();
