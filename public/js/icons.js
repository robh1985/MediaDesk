// Inline SVG icons. UI icons are 24px stroke icons; app icons are full-colour tiles.

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.9-3.9L4 9M4 4v5h5M4 13a8 8 0 0 0 14.9 3.9L20 15M20 20v-5h-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  film: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4"/>'),
  tv: svg('<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="m8 2 4 4 4-4"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  home: svg('<path d="M3 11 12 3l9 8M5 9.5V20h5v-6h4v6h5V9.5"/>'),
  library: svg('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -3.9 15-3.8-1z"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>'),
  power: svg('<path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0"/>'),
  lock: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  alert: svg('<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  disk: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  heartPulse: svg('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  minimize: svg('<path d="M6 12h12"/>'),
  maximize: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  restore: svg('<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/>'),
};

const tile = (from, to, glyph) => `
<svg viewBox="0 0 64 64">
  <defs><linearGradient id="g-${from.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g-${from.slice(1)})"/>
  <rect x="2" y="2" width="60" height="30" rx="15" fill="#fff" opacity=".12"/>
  <g fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;

export const appIcon = {
  radarr: tile('#ffcf3f', '#f08c00', '<rect x="15" y="22" width="34" height="24" rx="3"/><path d="M15 22l6-8M25 22l6-8M35 22l6-8M15 22h34"/><path d="M28 30v9l7-4.5z" fill="#fff" stroke-width="2"/>'),
  sonarr: tile('#4fd1ff', '#1366d6', '<rect x="13" y="20" width="38" height="26" rx="4"/><path d="M25 12l7 8 7-8M24 52h16"/>'),
  nzbget: tile('#5ee08a', '#119a4c', '<path d="M32 14v24M22 29l10 10 10-10M18 48h28"/>'),
  jellyfin: tile('#b86ce0', '#159ee6', '<path d="M32 14 14 46h36z" stroke-width="3.4"/><path d="M32 27 24 41h16z" fill="#fff" stroke-width="1"/>'),
  dashboard: tile('#8b8cff', '#4c3ad9', '<path d="M16 42a16 16 0 1 1 32 0"/><path d="M32 42l8-10"/><circle cx="32" cy="42" r="2.5" fill="#fff"/>'),
  settings: tile('#a9b3c4', '#5a6577', '<circle cx="32" cy="32" r="6"/><path d="M32 14v6M32 44v6M14 32h6M44 32h6M19.3 19.3l4.3 4.3M40.4 40.4l4.3 4.3M19.3 44.7l4.3-4.3M40.4 23.6l4.3-4.3"/>'),
  browser: tile('#6ec3ff', '#2563eb', '<circle cx="32" cy="32" r="16"/><path d="M16 32h32M32 16a24 24 0 0 1 0 32M32 16a24 24 0 0 0 0 32"/>'),
  music: tile('#ffb347', '#e0245e', '<path d="M26 44V18l22-5v26"/><circle cx="20" cy="44" r="6" fill="#fff"/><circle cx="42" cy="39" r="6" fill="#fff"/>'),
  console: tile('#ff6a88', '#6a2ff7', '<path d="M21 23h22a9 9 0 0 1 8.6 6.4l2.6 9.2a5 5 0 0 1-8.7 4.4L42 39H22l-3.5 4a5 5 0 0 1-8.7-4.4l2.6-9.2A9 9 0 0 1 21 23z"/><path d="M22 28v8M18 32h8"/><circle cx="41" cy="29.5" r="1.6" fill="#fff"/><circle cx="45" cy="34" r="1.6" fill="#fff"/>'),
  logs: tile('#94a3b8', '#334155', '<rect x="13" y="12" width="38" height="40" rx="4"/><path d="M19 22h4M27 22h18M19 30h4M27 30h18M19 38h4M27 38h12M19 46h4M27 46h16"/><path d="M27 38h12" stroke="#ff6b6b"/><path d="M27 30h18" stroke="#ffd43b"/>'),
  pikvm: tile('#5fd38d', '#0b6b3a', '<rect x="11" y="13" width="42" height="28" rx="3"/><path d="M26 51h12M32 41v10"/><path d="M19 24h5l3 6 4-10 3 7h11" stroke-width="3"/>'),
  archive: tile('#f9a8d4', '#9d174d', '<rect x="16" y="12" width="32" height="40" rx="4"/><path d="M32 12v6M28 18h4M32 22h4M28 26h4M32 30h4"/><rect x="27.5" y="34" width="9" height="9" rx="2"/>'),
  convert: tile('#67e8f9', '#0e7490', '<path d="M16 24h30M38 16l8 8-8 8"/><path d="M48 40H18M26 32l-8 8 8 8"/>'),
  files: tile('#5eead4', '#0d7d74', '<path d="M13 21h11l4 4h14a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3z"/><path d="M13 30h32"/>'),
  plex: `<svg viewBox="0 0 64 64"><defs><linearGradient id="g-plex" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3f47"/><stop offset="1" stop-color="#16181c"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g-plex)"/><rect x="2" y="2" width="60" height="30" rx="15" fill="#fff" opacity=".08"/><path d="M22 14h11l13 18-13 18H22l13-18z" fill="#e5a00d"/></svg>`,
  plexviewer: `<svg viewBox="0 0 64 64"><defs><linearGradient id="g-plexv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7c843"/><stop offset="1" stop-color="#cc7b00"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g-plexv)"/><rect x="2" y="2" width="60" height="30" rx="15" fill="#fff" opacity=".14"/><rect x="12" y="17" width="40" height="27" rx="4" fill="none" stroke="#fff" stroke-width="3.6"/><path d="M28 24v13l11-6.5z" fill="#fff"/><path d="M24 50h16" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>`,
  calculator: tile('#f6a54a', '#e2571e', '<rect x="18" y="12" width="28" height="40" rx="4"/><rect x="23" y="17" width="18" height="8" rx="1.5" fill="#fff" stroke-width="1"/><path d="M24 33h.01M32 33h.01M40 33h.01M24 40h.01M32 40h.01M40 40h.01M24 47h.01M32 47h8" stroke-width="4.4"/>'),
  notes: tile('#9be15d', '#1f9d55', '<path d="M20 12h17l9 9v31H20z"/><path d="M37 12v9h9M25 30h16M25 37h16M25 44h10"/>'),
  preview: tile('#7dd3fc', '#4f46e5', '<rect x="13" y="15" width="38" height="34" rx="4"/><path d="m19 41 8-9 6 6 4-4 8 7"/><circle cx="25" cy="24" r="3" fill="#fff"/>'),
  activity: tile('#ff8a8a', '#e0245e', '<path d="M14 34h9l4-10 8 18 4-8h11"/>'),
};
