// Pieces the Family Organizer's screens share: sheets (its dialogs), profile avatars and pickers,
// the emoji picker, colour swatches, weather icons and the parent PIN.

import { h, clear } from '../../ui.js';

export const COLORS = ['#e8590c', '#f08c00', '#e0b000', '#66a80f', '#2f9e44', '#0ca678', '#1098ad', '#1c7ed6', '#4263eb', '#7048e8', '#ae3ec9', '#d6336c', '#c2255c', '#868e96', '#495057', '#8d6e63'];

export const EMOJI = {
  People: '👩 👨 👧 👦 👶 👵 👴 🧑 👱‍♀️ 👱 🧔 👩‍🦰 👨‍🦱 🧒 🐶 🐱 🐰 🦊 🐻 🐼 🐨 🦁 🐯 🐸 🦄 🐢 🐠 🦖'.split(' '),
  Chores: '🛏️ 🪥 👕 🎒 📚 ✏️ 🧸 🧺 🧹 🧽 🧼 🚿 🛁 🍽️ 🥣 🗑️ ♻️ 🐶 🐱 🐟 🪴 🌱 🚗 🧦 👟 🎹 🎻 ⚽ 🏀 🏊 💊 🙏 💤 🌙 🌅 ☀️ 📖 💻 🧘'.split(' '),
  Food: '🍎 🍌 🥕 🥦 🥑 🍅 🍞 🧀 🥚 🥛 🍗 🥩 🐟 🍝 🍕 🌮 🌯 🥗 🍲 🍜 🍣 🍔 🥞 🧇 🥪 🍪 🍰 🎂 🍦 🍿 ☕ 🧃'.split(' '),
  Fun: '🎉 🎂 🎁 🎈 🎬 🎮 🎨 🎤 🎧 🎢 🏖️ ⛺ ✈️ 🚀 🏆 ⭐ 🌟 💖 🍦 🧱 📱 🎟️ 🛍️ 💵 ⏰ 🌈 🔥 ✅ 📌 🏠 🏫 🏥 💼 🛒 📦 ❤️'.split(' '),
};

export const STAR = '⭐';

// A sheet: the organizer's dialogs, shown over the organizer itself. Resolves to the value given
// to close(), or null when dismissed.
export function sheet(host, { title, body, actions = [], wide = false, onClose, cls = '' }) {
  let done;
  const result = new Promise((r) => { done = r; });
  const close = (v = null) => { overlay.remove(); window.removeEventListener('keydown', onKey, true); onClose?.(v); done(v); };
  // Escape closes the topmost sheet, wherever the focus is.
  const onKey = (e) => {
    if (e.key !== 'Escape' || !overlay.isConnected) return;
    const sheets = host.querySelectorAll(':scope > .fam-overlay');
    if (sheets[sheets.length - 1] !== overlay || overlay.querySelector('.fam-emoji-pop')) return;
    e.stopPropagation(); e.preventDefault(); close(null);
  };
  window.addEventListener('keydown', onKey, true);
  const foot = h('div', { class: 'fam-sheet-actions' }, actions.map((a) => a && h('button', {
    type: a.submit ? 'submit' : 'button', class: `fam-btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''} ${a.left ? 'left' : ''}`,
    onclick: a.submit ? null : () => a.onClick ? a.onClick(close) : close(a.value ?? null),
  }, a.label)));
  const form = h('form', { class: `fam-sheet ${wide ? 'wide' : ''} ${cls}`, onsubmit: (e) => { e.preventDefault(); const a = actions.find((x) => x?.submit); a?.onClick ? a.onClick(close) : close(a?.value ?? true); } },
    h('div', { class: 'fam-sheet-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Close', onclick: () => close(null), html: ICONS.close })),
    h('div', { class: 'fam-sheet-body' }, body),
    actions.length ? foot : null);
  const overlay = h('div', { class: 'fam-overlay', onpointerdown: (e) => { if (e.target === overlay) overlay.dataset.down = '1'; }, onclick: (e) => { if (e.target === overlay && overlay.dataset.down) close(null); delete overlay.dataset.down; } }, form);
  host.append(overlay);
  requestAnimationFrame(() => form.querySelector('[autofocus]')?.focus());
  result.close = close;
  result.el = form;
  return result;
}

// A <label> only around a single input: a label around buttons (the people chips, weekdays) would
// pass every click on to its first button.
const labelable = (c) => c instanceof HTMLInputElement || c instanceof HTMLSelectElement || c instanceof HTMLTextAreaElement;
export const field = (label, control, hint) => h(labelable(control) ? 'label' : 'div', { class: 'fam-field' }, h('span', { class: 'fam-label' }, label), control, hint ? h('span', { class: 'fam-hint' }, hint) : null);
export const input = (attrs = {}) => h('input', { class: 'fam-input', ...attrs });
export const select = (options, value, attrs = {}) => {
  const s = h('select', { class: 'fam-input', ...attrs }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value;
  return s;
};
export const toggle = (label, checked, onChange) => {
  const box = h('input', { type: 'checkbox', checked: Boolean(checked), onchange: () => onChange?.(box.checked) });
  return h('label', { class: 'fam-toggle' }, box, h('span', { class: 'fam-switch' }), h('span', {}, label));
};

export function avatar(m, size = 'md') {
  if (!m) return h('span', { class: `fam-avatar ${size} family`, title: 'Everyone', html: ICONS.family });
  return h('span', { class: `fam-avatar ${size}`, style: { '--c': m.color }, title: m.name }, m.emoji || (m.name || '?').slice(0, 1).toUpperCase());
}

// Choose profiles: a row of avatars to tap on and off.
export function memberPicker(members, selected = [], { single = false, allowNone = true, onChange } = {}) {
  const sel = new Set(selected);
  const row = h('div', { class: 'fam-member-pick' });
  const draw = () => clear(row, members.map((m) => h('button', {
    type: 'button', class: `fam-chip ${sel.has(m.id) ? 'on' : ''}`, style: { '--c': m.color },
    onclick: () => {
      if (single) { const had = sel.has(m.id); sel.clear(); if (!had || !allowNone) sel.add(m.id); } else if (sel.has(m.id)) sel.delete(m.id); else sel.add(m.id);
      draw(); onChange?.([...sel]);
    },
  }, avatar(m, 'sm'), m.name)));
  draw();
  row.value = () => [...sel];
  return row;
}

export function emojiButton(value, onPick) {
  const btn = h('button', { type: 'button', class: 'fam-emoji-btn', title: 'Choose an emoji' }, value || '➕');
  btn.value = value || '';
  btn.addEventListener('click', () => {
    const pop = h('div', { class: 'fam-emoji-pop' });
    const custom = input({ placeholder: 'Or type one', maxlength: 8, class: 'fam-input small' });
    const pick = (e) => { btn.value = e; btn.textContent = e || '➕'; onPick?.(e); pop.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener('pointerdown', away, true); } };
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (custom.value.trim()) pick(custom.value.trim()); } });
    pop.append(...Object.entries(EMOJI).map(([group, list]) => h('div', {}, h('div', { class: 'fam-emoji-group' }, group), h('div', { class: 'fam-emoji-grid' }, list.map((e) => h('button', { type: 'button', onclick: () => pick(e) }, e))))),
      h('div', { class: 'fam-emoji-foot' }, custom, h('button', { type: 'button', class: 'fam-btn small', onclick: () => pick('') }, 'None')));
    btn.after(pop);
    document.addEventListener('pointerdown', away, true);
    custom.focus();
  });
  return btn;
}

export function colorPicker(value, onPick) {
  let cur = value || COLORS[0];
  const row = h('div', { class: 'fam-colors' });
  const draw = () => clear(row, COLORS.map((c) => h('button', { type: 'button', class: `fam-swatch ${c === cur ? 'on' : ''}`, style: { background: c }, 'aria-label': c, onclick: () => { cur = c; draw(); onPick?.(c); } })),
    h('label', { class: 'fam-swatch custom', title: 'Another colour', style: { background: COLORS.includes(cur) ? '' : cur } }, h('input', { type: 'color', value: cur, oninput: (e) => { cur = e.target.value; draw(); onPick?.(cur); } })));
  draw();
  row.value = () => cur;
  return row;
}

// Little celebrations when a chore is done.
export function confetti(host, x, y) {
  const layer = h('div', { class: 'fam-confetti' });
  const r = host.getBoundingClientRect();
  for (let i = 0; i < 26; i++) {
    const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
    const d = 50 + Math.random() * 70;
    layer.append(h('i', { style: { left: `${x - r.left}px`, top: `${y - r.top}px`, background: COLORS[i % COLORS.length], '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 30}px`, '--r': `${Math.random() * 720 - 360}deg` } }));
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 1100);
}

// Weather codes (WMO) as an emoji and a word.
export function weatherIcon(code, day = true) {
  if (code === 0) return [day ? '☀️' : '🌙', 'Clear'];
  if (code === 1) return [day ? '🌤️' : '🌙', 'Mostly clear'];
  if (code === 2) return ['⛅', 'Partly cloudy'];
  if (code === 3) return ['☁️', 'Cloudy'];
  if (code === 45 || code === 48) return ['🌫️', 'Fog'];
  if (code >= 51 && code <= 57) return ['🌦️', 'Drizzle'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['🌧️', 'Rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['🌨️', 'Snow'];
  if (code >= 95) return ['⛈️', 'Thunderstorms'];
  return ['🌡️', ''];
}

// Parent PIN: when one is set, settings, rewards and other grown-up things ask for it (once
// every few minutes).
let unlockedUntil = 0;
// Signed in as a parent (or to MediaDesk itself): no PIN needed.
let parentSession = false;
export const setParentSession = (v) => { parentSession = Boolean(v); };
export async function parentGate(host, store, why = 'This needs a parent') {
  const pin = store.settings.parentPin;
  if (parentSession || !pin || Date.now() < unlockedUntil) return true;
  const box = input({ type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, autofocus: true, class: 'fam-input fam-pin' });
  const err = h('div', { class: 'fam-error' });
  const ok = await sheet(host, {
    title: 'Parent PIN', body: [h('p', { class: 'fam-muted' }, why), box, err],
    actions: [{ label: 'Cancel' }, { label: 'Unlock', primary: true, submit: true, onClick: (close) => { if (box.value === pin) close(true); else { err.textContent = 'That PIN isn’t right'; box.select(); } } }],
  });
  if (ok) unlockedUntil = Date.now() + 5 * 60e3;
  return Boolean(ok);
}
export const lockParent = () => { unlockedUntil = 0; };

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  calendar: svg('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>'),
  chores: svg('<path d="M9 11l2.5 2.5L16 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>'),
  rewards: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  meals: svg('<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4-3.5 7.5V13H17"/>'),
  lists: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  photos: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8.5"/>'),
  sleep: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  family: svg('<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M3.5 19v-2.5A3.5 3.5 0 0 1 7 13h2a3.5 3.5 0 0 1 3.5 3.5V19M11.5 19v-2.5A3.5 3.5 0 0 1 15 13h2a3.5 3.5 0 0 1 3.5 3.5V19"/>'),
  location: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  notes: svg('<path d="M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  cart: svg('<path d="M3 4h2l2.4 11.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/><circle cx="9.5" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/>'),
  book: svg('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>'),
  dice: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  approve: svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  gift: svg('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8.5h14V12M12 8v12.5M12 8S10.5 3.5 8 4.5 9 8 12 8zm0 0s1.5-4.5 4-3.5S15 8 12 8z"/>'),
};
