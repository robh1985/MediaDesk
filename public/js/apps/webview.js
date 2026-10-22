// Embeds a service's own web UI in a window, for anything MediaDesk doesn't cover.

import { h, clear } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { serviceLink } from '../api.js';

const NAMES = { radarr: 'Radarr', sonarr: 'Sonarr', nzbget: 'NZBGet', jellyfin: 'Jellyfin' };

export const webviewApp = {
  id: 'webview', name: 'Web UI', icon: appIcon.browser, size: [1200, 780], description: 'Full service web interfaces',
  open(win, opts = {}) {
    const svc = opts.key;
    const url = serviceLink(svc);
    win.setTitle(`${NAMES[svc]} — Web UI`);
    const frame = h('iframe', { class: 'webview-frame', src: url, referrerpolicy: 'no-referrer', allow: 'fullscreen; autoplay' });
    const bar = h('div', { class: 'webview-bar' },
      h('span', { class: 'webview-icon', html: appIcon[svc] }),
      h('div', { class: 'webview-url' }, url),
      h('button', { class: 'btn btn-icon btn-sm', title: 'Reload', html: icon.refresh, onclick: () => { frame.src = url; } }),
      h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, h('span', { html: icon.external }), 'Open in new tab'));
    clear(win.body, h('div', { class: 'webview' }, bar, frame,
      h('div', { class: 'webview-hint small muted' }, 'Blank page? The service may block embedding, or your browser can’t reach this URL — use “Open in new tab”.')));
  },
};
