// Live scores in the menu bar (NFL, NBA, NHL and MLB): while games are on, each one shows in turn
// (both teams' logos and scores, the quarter, period or inning, who has the ball, the bases in
// baseball), a game that just changed score shows next with a flash, and clicking opens the day's
// (or the NFL week's) games, league by league. Hidden when nothing's on; each league can be turned
// off, or limited to some teams, in Settings → General.

import { h, clear } from './ui.js';
import { state } from './api.js';

export const LEAGUES = [['nfl', 'NFL'], ['nba', 'NBA'], ['nhl', 'NHL'], ['mlb', 'MLB']];
const NAME = Object.fromEntries(LEAGUES);
const SHOW_MS = 6000;
const prefs = () => state.config?.appSettings?.general || {};
const enabled = (l) => prefs()[`${l}Scores`] !== false;
const teamsWanted = (l) => String(prefs()[`${l}Teams`] || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
const wanted = (g) => { const t = teamsWanted(g.league); return !t.length || t.includes(g.home.abbr) || t.includes(g.away.abbr); };

// The game clock, short: "4:12 - 3rd" → "Q3 4:12" (NFL, NBA) or "P3 4:12" (NHL); "Top 5th" → "▲5".
export function clock(league, s) {
  s = String(s || '');
  if (league === 'mlb') return s.replace(/^Top (\d+)\w*$/, '▲$1').replace(/^Bot(?:tom)? (\d+)\w*$/, '▼$1').replace(/^Mid (\d+)\w*$/, 'Mid $1').replace(/^End (\d+)\w*$/, 'End $1');
  const p = league === 'nhl' ? 'P' : 'Q';
  return s.replace(/^(\d+:\d\d(?:\.\d)?) - (\d)(?:st|nd|rd|th)$/, `${p}$2 $1`).replace(/^(\d+:\d\d) - (\d?OT)$/, '$2 $1');
}
const logo = (t, size = 18) => h('img', { class: 'nfl-logo', src: t.logo, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async', draggable: 'false' });
// Baseball: a little diamond with the runners, and the outs.
function diamond(g, size = 15) {
  const b = g.bases || [false, false, false];
  const base = (x, y, on) => `<rect x="${x - 3.2}" y="${y - 3.2}" width="6.4" height="6.4" transform="rotate(45 ${x} ${y})" fill="${on ? '#f59f00' : 'none'}" stroke="currentColor" stroke-width="1.3"/>`;
  return h('span', { class: 'mlb-diamond', title: `${g.outs ?? 0} out${g.outs === 1 ? '' : 's'}` },
    h('span', { html: `<svg width="${size}" height="${size}" viewBox="0 0 20 20">${base(15, 10, b[0])}${base(10, 5, b[1])}${base(5, 10, b[2])}</svg>` }),
    h('span', { class: 'mlb-outs' }, [0, 1, 2].map((i) => h('i', { class: i < (g.outs || 0) ? 'on' : '' }))));
}

export function scoresTicker() {
  const el = h('button', { class: 'tray-item tray-nfl', hidden: true, 'aria-live': 'polite', title: 'Scores' });
  const boards = {};          // league → scoreboard
  let live = [];
  let at = 0;
  let poll = null;
  let paused = false;
  const last = new Map();     // game id → "away-home" score last time
  const scored = new Map();   // game id → { at, side }
  let showing = null;         // the game on show (a game that just scored goes in ahead of the turn)
  const queue = [];           // games that just scored, to show next

  function draw(animate = true) {
    if (!live.length) { el.hidden = true; return; }
    el.hidden = false;
    const g = live.find((x) => x.id === showing) || live[at % live.length];
    showing = g.id;
    const s = scored.get(g.id);
    const fresh = s && Date.now() - s.at < 20e3;
    const leagues = new Set(live.map((x) => x.league));
    const side = (t, which) => h('span', { class: `nfl-side ${fresh && s.side === which ? 'up' : ''} ${g.possession === which ? 'ball' : ''}` },
      which === 'away' ? [logo(t), h('span', { class: 'nfl-abbr' }, t.abbr), h('b', { class: 'nfl-score' }, t.score ?? 0)] : [h('b', { class: 'nfl-score' }, t.score ?? 0), h('span', { class: 'nfl-abbr' }, t.abbr), logo(t)]);
    clear(el, h('span', { class: `nfl-game ${animate ? 'in' : ''} ${fresh ? 'scored' : ''} ${g.redZone ? 'redzone' : ''}` },
      leagues.size > 1 ? h('span', { class: `sc-league sc-${g.league}` }, NAME[g.league]) : null,
      side(g.away, 'away'), h('span', { class: 'nfl-dash' }, '–'), side(g.home, 'home'),
      h('span', { class: 'nfl-clock' }, clock(g.league, g.status)),
      g.league === 'mlb' && g.bases ? diamond(g) : null,
      live.length > 1 ? h('span', { class: 'nfl-count' }, `${live.indexOf(g) + 1}/${live.length}`) : null));
    el.title = `${NAME[g.league]}: ${g.away.name} ${g.away.score ?? 0}, ${g.home.name} ${g.home.score ?? 0} · ${g.detail}${g.down ? ` · ${g.down}` : ''}${g.possession ? ` · ${g[g.possession].abbr} ball` : ''}${g.bases ? ` · ${g.outs} out${g.outs === 1 ? '' : 's'}${g.count ? `, ${g.count} count` : ''}` : ''}`;
  }

  // The next game: one that just scored, or the next in turn (the turn carries on from where it was).
  const next = () => {
    if (paused || live.length < 2) return;
    while (queue.length && !live.some((g) => g.id === queue[0])) queue.shift();
    if (queue.length) showing = queue.shift();
    else { at = (at + 1) % live.length; showing = live[at].id; }
    draw();
  };

  async function refresh() {
    clearTimeout(poll);
    let wait = 5 * 60e3;
    const on = LEAGUES.map(([l]) => l).filter(enabled);
    if (on.length && document.visibilityState !== 'hidden') {
      await Promise.all(on.map(async (l) => {
        try { const res = await fetch(`/portal/sports/${l}`, { credentials: 'same-origin' }); if (res.ok) boards[l] = await res.json(); } catch { /* keep the last one */ }
      }));
      for (const l of Object.keys(boards)) if (!on.includes(l)) delete boards[l];
      const turn = live[at % (live.length || 1)]?.id;
      live = on.flatMap((l) => (boards[l]?.games || []).filter((g) => g.state === 'in' && wanted(g)));
      let jump = -1;
      // A game whose score changed shows next, with a flash.
      for (const g of live) {
        const key = `${g.away.score}-${g.home.score}`;
        const before = last.get(g.id);
        if (before && before !== key) {
          const [a, b] = before.split('-').map(Number);
          scored.set(g.id, { at: Date.now(), side: (g.away.score ?? 0) > a ? 'away' : (g.home.score ?? 0) > b ? 'home' : null });
          jump = live.indexOf(g);
          if (!queue.includes(g.id)) queue.push(g.id);
        }
        last.set(g.id, key);
      }
      at = Math.max(0, live.findIndex((g) => g.id === turn));
      // A goal, run, basket or touchdown shows straight away (unless the pointer is holding a game).
      if (jump >= 0 && !paused) { showing = queue.shift(); draw(true); } else draw(false);
      if (panel?.isConnected) drawPanel();
      // Every 20 seconds during games; a minute when one starts soon; otherwise every 5 minutes.
      const all = Object.values(boards).flatMap((b) => b.games || []);
      const soon = all.some((g) => g.state === 'pre' && new Date(g.start) - Date.now() < 20 * 60e3);
      wait = all.some((g) => g.state === 'in') ? 20e3 : soon ? 60e3 : 5 * 60e3;
    } else { live = []; draw(); }
    poll = setTimeout(refresh, wait);
  }

  // The day's games, from the menu bar, a tab per league.
  let panel = null;
  let tab = null;
  function drawPanel() {
    const leagues = LEAGUES.filter(([l]) => enabled(l) && boards[l]);
    if (!leagues.some(([l]) => l === tab)) tab = leagues.find(([l]) => boards[l].games.some((g) => g.state === 'in'))?.[0] || leagues[0]?.[0];
    const board = boards[tab];
    const row = (g) => {
      const team = (t, which) => h('div', { class: `nfl-row-team ${g.possession === which ? 'ball' : ''} ${g.state === 'post' && (t.score ?? 0) > (g[which === 'home' ? 'away' : 'home'].score ?? 0) ? 'won' : ''}` },
        logo(t, 26), h('span', { class: 'nfl-row-name' }, t.short || t.abbr, t.record ? h('small', {}, ` ${t.record}`) : null), g.state === 'pre' ? null : h('b', {}, t.score ?? 0));
      return h('div', { class: `nfl-row ${g.state} ${g.redZone ? 'redzone' : ''}` },
        h('div', { class: 'nfl-row-teams' }, team(g.away, 'away'), team(g.home, 'home')),
        h('div', { class: 'nfl-row-status' },
          h('b', {}, g.state === 'pre' ? new Date(g.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : g.state === 'post' ? g.status : clock(g.league, g.status)),
          g.down ? h('span', {}, g.down) : null,
          g.redZone ? h('span', { class: 'nfl-rz' }, 'Red zone') : null,
          g.bases && g.state === 'in' ? h('span', { class: 'mlb-line' }, diamond(g, 18), `${g.outs} out${g.outs === 1 ? '' : 's'}${g.count ? ` · ${g.count}` : ''}`) : null,
          g.tv ? h('span', { class: 'muted' }, g.tv) : null),
        g.state === 'in' && (g.batter || g.lastPlay) ? h('div', { class: 'nfl-row-play small muted' }, g.batter ? `${g.batter} batting${g.pitcher ? `, ${g.pitcher} pitching` : ''}. ` : '', g.lastPlay) : null);
    };
    const groups = board ? [['Live', board.games.filter((g) => g.state === 'in')], ['Final', board.games.filter((g) => g.state === 'post')], ['Coming up', board.games.filter((g) => g.state === 'pre')]] : [];
    clear(panel,
      leagues.length > 1 ? h('div', { class: 'sc-tabs', role: 'tablist' }, leagues.map(([l, name]) => {
        const n = boards[l].games.filter((g) => g.state === 'in').length;
        return h('button', { type: 'button', role: 'tab', class: `sc-tab ${l === tab ? 'on' : ''}`, 'aria-selected': String(l === tab), onclick: () => { tab = l; drawPanel(); } }, name, n ? h('span', { class: 'sc-live' }, n) : null);
      })) : null,
      board ? h('div', { class: 'nfl-panel-head' }, h('b', {}, `${board.name}${board.label ? ` · ${board.label}` : ''}`), teamsWanted(tab).length ? h('span', { class: 'small muted' }, `Menu bar: ${teamsWanted(tab).join(', ')}`) : null) : null,
      board?.games.length ? groups.filter(([, list]) => list.length).map(([title, list]) => h('div', { class: 'nfl-group' }, h('div', { class: 'nfl-group-title' }, title), list.map(row)))
        : h('div', { class: 'muted small' }, board ? 'No games today.' : 'Scores aren’t available right now.'),
      h('div', { class: 'nfl-credit small muted' }, 'Scores from ESPN. Choose leagues and teams in Settings → General.'));
  }
  el.addEventListener('click', () => {
    if (panel?.isConnected) { panel.remove(); return; }
    if (!Object.keys(boards).length) return;
    tab = live.find((g) => g.id === showing)?.league || tab;
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

  const timer = setInterval(next, SHOW_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // Settings changed (leagues on or off, which teams): look again.
  addEventListener('mediadesk:prefs', () => { at = 0; refresh(); });
  setTimeout(refresh, 1500);
  el.destroy = () => { clearInterval(timer); clearTimeout(poll); };
  return el;
}
