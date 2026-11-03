// Live NFL scores in the menu bar: while games are on, each one shows in turn (both teams' logos
// and scores, the quarter and clock, who has the ball), a game that just changed score shows next
// with a flash, and clicking opens this week's games. Hidden when nothing's on, or when turned off
// in Settings → General.

import { h, clear } from './ui.js';
import { state } from './api.js';

const SHOW_MS = 6000;
const prefs = () => state.config?.appSettings?.general || {};
const enabled = () => prefs().nflScores !== false;
const teamsWanted = () => String(prefs().nflTeams || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
const wanted = (g) => { const t = teamsWanted(); return !t.length || t.includes(g.home.abbr) || t.includes(g.away.abbr); };

// "4:12 - 3rd" → "Q3 4:12"; "Halftime", "End of 3rd" and "Final/OT" stay as they are.
const clock = (s) => String(s || '').replace(/^(\d+:\d\d) - (\d)(?:st|nd|rd|th)$/, 'Q$2 $1').replace(/^(\d+:\d\d) - OT$/, 'OT $1');
const logo = (t, size = 18) => h('img', { class: 'nfl-logo', src: t.logo, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', draggable: 'false' });

export function nflTicker() {
  const el = h('button', { class: 'tray-item tray-nfl', hidden: true, 'aria-live': 'polite', title: 'NFL scores' });
  let data = null;
  let live = [];
  let at = 0;
  let timer = null;
  let poll = null;
  let paused = false;
  const last = new Map();   // game id → "away-home" score last time
  const scored = new Map(); // game id → { at, side }

  function draw(animate = true) {
    if (!enabled() || !live.length) { el.hidden = true; return; }
    el.hidden = false;
    const g = live[at % live.length];
    const s = scored.get(g.id);
    const fresh = s && Date.now() - s.at < 20e3;
    const side = (t, which) => h('span', { class: `nfl-side ${fresh && s.side === which ? 'up' : ''} ${g.possession === which ? 'ball' : ''}` },
      which === 'away' ? [logo(t), h('span', { class: 'nfl-abbr' }, t.abbr), h('b', { class: 'nfl-score' }, t.score ?? 0)] : [h('b', { class: 'nfl-score' }, t.score ?? 0), h('span', { class: 'nfl-abbr' }, t.abbr), logo(t)]);
    const inner = h('span', { class: `nfl-game ${animate ? 'in' : ''} ${fresh ? 'scored' : ''} ${g.redZone ? 'redzone' : ''}` },
      side(g.away, 'away'), h('span', { class: 'nfl-dash' }, '–'), side(g.home, 'home'),
      h('span', { class: 'nfl-clock' }, clock(g.status)),
      live.length > 1 ? h('span', { class: 'nfl-count' }, `${(at % live.length) + 1}/${live.length}`) : null);
    clear(el, inner);
    el.title = `${g.away.name} ${g.away.score ?? 0}, ${g.home.name} ${g.home.score ?? 0} · ${g.detail}${g.down ? ` · ${g.down}` : ''}${g.possession ? ` · ${g[g.possession].abbr} ball` : ''}`;
  }

  function next() {
    if (paused || live.length < 2) return;
    at = (at + 1) % live.length;
    draw();
  }

  async function refresh() {
    clearTimeout(poll);
    let wait = 5 * 60e3;
    if (enabled() && document.visibilityState !== 'hidden') {
      try {
        const res = await fetch('/portal/sports/nfl', { credentials: 'same-origin' });
        if (res.ok) {
          data = await res.json();
          const now = live[at % (live.length || 1)]?.id;
          live = data.games.filter((g) => g.state === 'in' && wanted(g));
          // A game whose score changed shows next, with a flash.
          for (const g of live) {
            const key = `${g.away.score}-${g.home.score}`;
            const before = last.get(g.id);
            if (before && before !== key) {
              const [a, b] = before.split('-').map(Number);
              scored.set(g.id, { at: Date.now(), side: (g.away.score ?? 0) > a ? 'away' : (g.home.score ?? 0) > b ? 'home' : null });
              at = live.indexOf(g);
            }
            last.set(g.id, key);
          }
          if (!scored.size || ![...scored.values()].some((x) => Date.now() - x.at < 1000)) { const i = live.findIndex((g) => g.id === now); if (i >= 0) at = i; }
          draw(false);
          if (panel?.isConnected) drawPanel();
          // Every 20 seconds during games; a minute when one starts soon; otherwise every 5 minutes.
          const soon = data.games.some((g) => g.state === 'pre' && new Date(g.start) - Date.now() < 20 * 60e3);
          wait = live.length || data.games.some((g) => g.state === 'in') ? 20e3 : soon ? 60e3 : 5 * 60e3;
        }
      } catch { /* try again later */ }
    } else { live = []; draw(); }
    poll = setTimeout(refresh, wait);
  }

  // This week's games, from the menu bar.
  let panel = null;
  function drawPanel() {
    const groups = [['Live', data.games.filter((g) => g.state === 'in')], ['Final', data.games.filter((g) => g.state === 'post')], ['Coming up', data.games.filter((g) => g.state === 'pre')]];
    const row = (g) => {
      const team = (t, which) => h('div', { class: `nfl-row-team ${g.possession === which ? 'ball' : ''} ${g.state === 'post' && (t.score ?? 0) > (g[which === 'home' ? 'away' : 'home'].score ?? 0) ? 'won' : ''}` },
        logo(t, 26), h('span', { class: 'nfl-row-name' }, t.short || t.abbr, t.record ? h('small', {}, ` ${t.record}`) : null), g.state === 'pre' ? null : h('b', {}, t.score ?? 0));
      return h('div', { class: `nfl-row ${g.state} ${g.redZone ? 'redzone' : ''}` },
        h('div', { class: 'nfl-row-teams' }, team(g.away, 'away'), team(g.home, 'home')),
        h('div', { class: 'nfl-row-status' },
          h('b', {}, g.state === 'pre' ? new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : clock(g.status)),
          g.down ? h('span', {}, g.down) : null,
          g.redZone ? h('span', { class: 'nfl-rz' }, 'Red zone') : null,
          g.tv ? h('span', { class: 'muted' }, g.tv) : null),
        g.lastPlay && g.state === 'in' ? h('div', { class: 'nfl-row-play small muted' }, g.lastPlay) : null);
    };
    clear(panel,
      h('div', { class: 'nfl-panel-head' }, h('b', {}, `NFL${data.label ? ` · ${data.label}` : ''}`), teamsWanted().length ? h('span', { class: 'small muted' }, `Menu bar: ${teamsWanted().join(', ')}`) : null),
      data.games.length ? groups.filter(([, list]) => list.length).map(([title, list]) => h('div', { class: 'nfl-group' }, h('div', { class: 'nfl-group-title' }, title), list.map(row)))
        : h('div', { class: 'muted small' }, 'No games this week.'),
      h('div', { class: 'nfl-credit small muted' }, 'Scores from ESPN. Turn them off in Settings → General.'));
  }
  el.addEventListener('click', () => {
    if (panel?.isConnected) { panel.remove(); return; }
    if (!data) return;
    panel = h('div', { class: 'nfl-panel glass' });
    drawPanel();
    document.body.append(panel);
    const r = el.getBoundingClientRect();
    panel.style.top = `${r.bottom + 6}px`;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, r.left + r.width / 2 - panel.offsetWidth / 2))}px`;
    const away = (e) => { if (!panel.contains(e.target) && !el.contains(e.target)) { panel.remove(); removeEventListener('pointerdown', away, true); } };
    addEventListener('pointerdown', away, true);
  });
  el.addEventListener('pointerenter', () => { paused = true; });
  el.addEventListener('pointerleave', () => { paused = false; });

  timer = setInterval(next, SHOW_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // Settings changed (on or off, which teams): look again.
  addEventListener('mediadesk:prefs', () => { at = 0; refresh(); });
  setTimeout(refresh, 1500);
  el.destroy = () => { clearInterval(timer); clearTimeout(poll); };
  return el;
}
