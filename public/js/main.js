import { portal, state } from './api.js';
import { initWM, registerApp, openApp } from './wm.js';
import { applyAppearance, startDesktop, showLockScreen } from './desktop.js';
import { initScreensaver } from './screensaver.js';
import { startLive, addSystemNotice, refreshNotifications } from './live.js';
import { makeArrApp } from './apps/arr.js';
import { nzbgetApp } from './apps/nzbget.js';
import { jellyfinApp } from './apps/jellyfin.js';
import { dashboardApp } from './apps/dashboard.js';
import { settingsApp } from './apps/settings.js';
import { webviewApp } from './apps/webview.js';
import { filesApp } from './apps/files.js';
import { musicApp } from './apps/music.js';
import { calculatorApp } from './apps/calculator.js';
import { notesApp } from './apps/notes.js';
import { previewApp } from './apps/preview.js';
import { plexApp } from './apps/plex.js';
import { plexViewerApp } from './apps/plexviewer.js';
import { consoleApp } from './apps/console/console.js';
import { logViewerApp } from './apps/logviewer.js';
import { archiveApp } from './apps/archive.js';
import { convertApp } from './apps/convert.js';
import { pikvmApp } from './apps/pikvm.js';

applyAppearance();

// Troubleshooting: add ?touchdebug to the address to log what each swipe does.
if (/[?&#]touchdebug\b/.test(location.href)) {
  import('./touchdebug.js').then((m) => m.startTouchDebug());
}

[dashboardApp, makeArrApp('radarr'), makeArrApp('sonarr'), nzbgetApp, jellyfinApp, plexApp, plexViewerApp, pikvmApp, consoleApp, musicApp, filesApp, notesApp, logViewerApp, archiveApp, convertApp, previewApp, calculatorApp, settingsApp, webviewApp,
  { id: 'launcher', name: 'Search', icon: '', open() {} }].forEach(registerApp);

async function boot() {
  state.config = await portal.config();
  applyAppearance();
  initWM(document.getElementById('windows'));
  startDesktop();
  startLive();
  initScreensaver({ onLock: showLocked });
  document.body.classList.add('ready');

  const anyConfigured = Object.values(state.config.services).some((s) => s.configured);
  if (!anyConfigured) {
    openApp('settings');
  } else if (!sessionStorage.getItem('mediadesk.booted')) {
    openApp('dashboard');
  }
  try { sessionStorage.setItem('mediadesk.booted', '1'); } catch { /* ignore */ }
  if (state.config.mock) addSystemNotice({ id: 'demo', title: 'Demo mode', body: 'Showing sample data — no real servers are being contacted.' });
}

// Locked by the screensaver (here or in another tab): show the lock screen over the desktop, keeping
// everything (music included) running underneath. Logging in again unlocks.
function showLocked() {
  state.locked = true;
  showLockScreen(() => { state.locked = false; refreshNotifications(); });
}
addEventListener('mediadesk:logout', async () => {
  if (state.locked) return showLocked();
  try {
    const s = await portal.session();
    if (s.locked) return showLocked();
  } catch { /* fall through */ }
  location.reload();
});

// After MediaDesk is updated, pages that were already open are still running the old code.
// Notice that (by comparing the server's build fingerprint) and offer a reload.
let loadedBuild = null;
let staleShown = false;
function showUpdated() {
  if (staleShown) return;
  staleShown = true;
  addSystemNotice({
    id: 'updated', title: 'MediaDesk was updated', body: 'Reload to start using the new version.', level: 'success',
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
