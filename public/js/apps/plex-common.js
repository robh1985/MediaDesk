// Shared bits for the Plex and Plex Viewer apps.

import { h, progressBar } from '../ui.js';
import { icon } from '../icons.js';
import { plex, plexGet, plexImage, serviceLink } from '../api.js';

let infoPromise = null;
// Server name, version, machine id and whether the owner has Plex Pass.
export function serverInfo(refresh = false) {
  if (!infoPromise || refresh) infoPromise = plexGet('').catch((err) => { infoPromise = null; throw err; });
  return infoPromise;
}

export const isWatched = (m) => (m.type === 'show' || m.type === 'season'
  ? m.leafCount > 0 && m.viewedLeafCount >= m.leafCount
  : (m.viewCount || 0) > 0);
export const progressOf = (m) => (m.viewOffset && m.duration ? (m.viewOffset / m.duration) * 100 : 0);

export function titleOf(m) {
  if (m.type === 'episode') return m.grandparentTitle || m.title;
  if (m.type === 'season') return m.parentTitle || m.title;
  return m.title;
}

export function subOf(m) {
  if (m.type === 'episode') return `S${m.parentIndex ?? '?'} · E${m.index ?? '?'} · ${m.title}`;
  if (m.type === 'season') return `${m.title}${m.leafCount ? ` · ${m.leafCount} episodes` : ''}`;
  if (m.type === 'show') return [m.year, m.childCount ? `${m.childCount} season${m.childCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  if (m.type === 'album') return m.parentTitle || m.year || '';
  return m.year || '';
}

export const posterOf = (m, width = 300) => plexImage(m.type === 'episode' ? m.grandparentThumb || m.parentThumb || m.thumb : m.thumb || m.parentThumb, width);
export const stillOf = (m, width = 480) => plexImage(m.type === 'episode' ? m.thumb || m.art : m.art || m.thumb, width, Math.round(width * 9 / 16));
export const artOf = (m, width = 1280) => plexImage(m.art || m.grandparentArt || m.parentArt, width, Math.round(width * 9 / 16));

export function plexCard(m, onOpen, { wide = false, extra = null } = {}) {
  const url = wide ? stillOf(m) : posterOf(m);
  const pct = progressOf(m);
  const unwatched = m.type === 'show' || m.type === 'season' ? Math.max(0, (m.leafCount || 0) - (m.viewedLeafCount || 0)) : 0;
  return h('button', { class: `poster-card ${wide ? 'wide' : ''}`, title: titleOf(m), dataset: { key: m.ratingKey }, onclick: () => onOpen(m) },
    h('div', { class: 'poster' },
      url ? h('img', { src: url, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
      h('div', { class: 'poster-fallback' }, titleOf(m)),
      isWatched(m) ? h('span', { class: 'poster-status status-ok' }, h('span', { html: icon.check })) : null,
      unwatched && !isWatched(m) ? h('span', { class: 'poster-count' }, unwatched) : null,
      pct ? progressBar(pct, 'poster-progress plex') : null,
      extra),
    h('div', { class: 'poster-title' }, wide && m.type === 'episode' ? m.grandparentTitle : titleOf(m)),
    h('div', { class: 'poster-sub' }, subOf(m)));
}

export const scrobble = (m, watched) => plex.get(watched ? ':/scrobble' : ':/unscrobble', { identifier: 'com.plexapp.plugins.library', key: m.ratingKey });

// Link to the item in Plex's own web app.
export async function plexWebLink(m) {
  const base = serviceLink('plex');
  if (!base) return null;
  const info = await serverInfo().catch(() => ({}));
  return `${base}/web/index.html#!/server/${info.machineIdentifier || ''}${m ? `/details?key=${encodeURIComponent(`/library/metadata/${m.ratingKey}`)}` : ''}`;
}

export const SECTION_ICON = {
  movie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 3l3 3 3-3"/></svg>',
  artist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
};

export const msToTime = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${m} min` : `${m} min`;
};
