// Light and dark mode for the Family Organizer.
//
// The family has a default (Settings → General, parents): Automatic, Light, Dark, or Dark at night.
// Each screen can follow it or choose for itself, which is kept on that device, so the kitchen
// tablet can be dark while phones stay light. Automatic follows MediaDesk's own theme inside
// MediaDesk, and the device's light/dark setting on the organizer's own page.

export const MODES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark'], ['night', 'Dark at night']];
const KEY = 'mediadesk.family.theme';
const deviceDark = matchMedia('(prefers-color-scheme: dark)');

export function deviceTheme() {
  try { return localStorage.getItem(KEY) || 'family'; } catch { return 'family'; }
}
export function setDeviceTheme(v) {
  try { if (!v || v === 'family') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* private mode */ }
}

const minutes = (hhmm, dflt) => { const [h, m] = String(hhmm || dflt).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export function isNight(settings = {}, d = new Date()) {
  const from = minutes(settings.nightFrom, '19:00');
  const to = minutes(settings.nightTo, '07:00');
  const now = d.getHours() * 60 + d.getMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

// The mode in force here: this screen's own choice, or the family's.
export function mode(settings = {}) {
  const own = deviceTheme();
  return own === 'family' ? settings.theme || 'auto' : own;
}

// Light or dark, right now.
export function isDark(settings = {}, { standalone = false } = {}) {
  const m = mode(settings);
  if (m === 'dark') return true;
  if (m === 'light') return false;
  if (m === 'night') return isNight(settings);
  // Automatic: MediaDesk's theme inside MediaDesk, the device's setting on its own page.
  return standalone ? deviceDark.matches : document.documentElement.dataset.theme === 'dark';
}

// Keeps the organizer's colours right: when settings change, MediaDesk's theme or the device's
// setting changes, and each minute (for Dark at night).
export function themeWatcher(app) {
  const apply = () => {
    const dark = isDark(app.store?.settings || {}, { standalone: app.standalone });
    app.root.classList.toggle('fam-dark', dark);
    app.root.classList.toggle('fam-light', !dark);
    if (app.standalone) {
      // On its own page the whole page follows it (the background, the browser's bar colour).
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name=theme-color]:not([media])')?.remove();
      document.head.append(Object.assign(document.createElement('meta'), { name: 'theme-color', content: dark ? '#17191d' : '#f6f3ee' }));
    }
    app.header?.querySelector('.fam-theme-btn')?.replaceChildren(...themeIcon(dark));
    return dark;
  };
  const mo = app.standalone ? null : new MutationObserver(apply);
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  deviceDark.addEventListener?.('change', apply);
  const t = setInterval(apply, 60e3);
  apply();
  return { apply, stop: () => { mo?.disconnect(); deviceDark.removeEventListener?.('change', apply); clearInterval(t); } };
}

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
// The button shows what a tap switches to.
export function themeIcon(dark) {
  const t = document.createElement('template');
  t.innerHTML = dark ? SUN : MOON;
  return [...t.content.childNodes];
}
