// The Game Console's ten looks. Each is inspired by a console or TV menu people found easy:
// one 1980s/90s living-room entertainment centre, one Apple TV-style, and eight more. They all
// draw the same library (model.collections: Continue playing, Favorites, then one per console)
// and are driven by the same controls (input.js); a theme only decides layout and movement.
//
// render(root, model, app) builds the screen and returns optional hooks:
//   onFocus(el)          something got focus (update a big picture, scroll a carousel...)
//   onMove(el, dir)      return true to handle a move yourself
//   onTab(d)             L / R: previous / next collection
//   onBack()             B / Esc on the home screen
//   destroy()

import { h, clear } from '../../ui.js';
import { SYSTEMS } from './systems.js';

const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateStr = () => new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// The collection a theme is showing (remembered per theme).
function pick(model, app, themeId) {
  const st = app.stateFor(themeId);
  const cols = model.collections;
  let col = cols.find((c) => c.id === st.sel) || cols[0];
  return { st, cols, col, index: Math.max(0, cols.indexOf(col)) };
}
function setCol(app, themeId, id) { app.stateFor(themeId).sel = id; app.saveUi(); }
const gameOf = (app, el) => app.byId.get(el?.dataset.game);

function emptyRow(model) {
  return h('div', { class: 'gc-none' }, model.demo ? 'Nothing here yet.' : 'No games found. Add some to your games folder, then choose “Look for new games” in Settings.');
}

// A focusable collection chip/tab; focusing or choosing it switches collections.
function colButton(app, themeId, c, cls, content, { switchOnFocus = false } = {}) {
  const b = h('button', { class: cls, 'data-nav': `col:${c.id}`, dataset: { col: c.id }, style: c.system ? { '--sys': SYSTEMS[c.system].color } : {} }, content || c.short);
  b.onActivate = () => { setCol(app, themeId, c.id); app.render(`col:${c.id}`); };
  if (switchOnFocus) b.switchOnFocus = true;
  return b;
}

function cycleCol(app, themeId, model, d, focusPrefix = 'col:') {
  const { cols, index } = pick(model, app, themeId);
  if (!cols.length) return;
  const next = cols[(index + d + cols.length) % cols.length];
  setCol(app, themeId, next.id);
  if (focusPrefix === 'first') app.render(undefined, { fresh: true });
  else app.render(`${focusPrefix}${next.id}`);
}

// ---------------------------------------------------------------------------
// 1. Living Room '89 — the wood-panelled entertainment centre: a CRT TV on top, a VCR with a
//    glowing clock, and your games on the shelf below. Change "channel" to change console.
// ---------------------------------------------------------------------------

function retro(root, model, app) {
  const id = 'retro';
  const { cols, col } = pick(model, app, id);
  const screen = h('div', { class: 'rt-screen' });
  const label = h('div', { class: 'rt-osd' });
  const channel = h('div', { class: 'rt-ch' });
  const vcrClock = h('span', { class: 'rt-led' }, clock().replace(/\s?[AP]M/i, ''));
  const shelf = h('div', { class: 'rt-shelf' });
  const show = (g) => {
    clear(screen, g ? app.cover(g) : h('div', { class: 'rt-snow' }), h('div', { class: 'rt-scan' }));
    label.textContent = g ? g.title : col ? col.name : 'NO SIGNAL';
    screen.classList.remove('flip'); void screen.offsetWidth; screen.classList.add('flip');
  };
  root.append(h('div', { class: 'rt' },
    h('div', { class: 'rt-top' },
      h('div', { class: 'rt-tv' }, h('div', { class: 'rt-bezel' }, screen, label, channel), h('div', { class: 'rt-tv-knobs' }, h('span'), h('span'), h('i', {}, 'TRINITONE'))),
      h('div', { class: 'rt-side' },
        h('div', { class: 'rt-vcr' }, h('div', { class: 'rt-vcr-slot' }), h('div', { class: 'rt-vcr-face' }, vcrClock, h('span', { class: 'rt-vcr-brand' }, 'HI-FI STEREO'))),
        h('div', { class: 'rt-chrome' }, app.chrome()))),
    h('div', { class: 'rt-channels' }, cols.map((c, i) => colButton(app, id, c, `rt-chbtn ${c.id === col?.id ? 'on' : ''}`, [h('span', { class: 'rt-chnum' }, String(i + 1).padStart(2, '0')), h('span', {}, c.short)]))),
    shelf));
  channel.textContent = col ? `CH ${String(cols.indexOf(col) + 1).padStart(2, '0')}` : '';
  if (col?.games.length) {
    for (const g of col.games) {
      const sys = SYSTEMS[g.system] || {};
      const b = h('button', { class: `rt-tape ${sys.disc ? 'disc' : sys.kind}`, 'data-nav': `game:${g.id}`, dataset: { game: g.id }, style: { '--sys': sys.color } },
        h('span', { class: 'rt-tape-band' }, sys.short), h('span', { class: 'rt-tape-title' }, g.title));
      b.onActivate = () => app.openGame(g);
      shelf.append(b);
    }
  } else shelf.append(emptyRow(model));
  show(col?.games[0]);
  const tick = setInterval(() => { vcrClock.textContent = clock().replace(/\s?[AP]M/i, ''); }, 15e3);
  return {
    onFocus: (el) => { if (el?.dataset.game) show(gameOf(app, el)); },
    onTab: (d) => cycleCol(app, id, model, d),
    destroy: () => clearInterval(tick),
  };
}

// ---------------------------------------------------------------------------
// 2. Couch TV — Apple TV-style: a big "top shelf" for whatever is focused, then rows of
//    rounded tiles that lift when selected.
// ---------------------------------------------------------------------------

function tv(root, model, app) {
  const id = 'tv';
  const st = app.stateFor(id);
  const hero = h('div', { class: 'tv-hero' });
  const rows = h('div', { class: 'tv-rows' });
  const showHero = (g) => {
    if (!g) return;
    const sys = SYSTEMS[g.system] || {};
    clear(hero, h('div', { class: 'tv-hero-art' }, app.cover(g)), h('div', { class: 'tv-hero-text' },
      h('div', { class: 'tv-hero-sys' }, sys.name), h('h1', {}, g.title),
      h('div', { class: 'tv-hero-hint' }, model.played[g.id] ? 'Press A to continue' : 'Press A to play')));
    hero.style.setProperty('--sys', sys.color || '#333');
  };
  const header = h('div', { class: 'tv-top' }, h('div', { class: 'tv-tabs' },
    h('span', { class: 'tv-brand' }, 'Games'),
    model.collections.filter((c) => c.system).slice(0, 8).map((c) => colButton(app, id, c, `tv-tab ${st.grid === c.id ? 'on' : ''}`, c.short))),
  h('div', { class: 'tv-chrome' }, h('span', { class: 'tv-clock' }, clock()), app.chrome()));
  // Choosing a console tab shows all its games in a grid.
  header.querySelectorAll('.tv-tab').forEach((t) => { t.onActivate = () => { st.grid = st.grid === t.dataset.col ? null : t.dataset.col; app.saveUi(); app.render(`col:${t.dataset.col}`); }; });
  root.append(h('div', { class: 'tv' }, header, hero, rows));
  if (st.grid) {
    const c = model.collections.find((x) => x.id === st.grid);
    if (c) {
      rows.append(h('h2', { class: 'tv-row-title' }, `${c.name} · ${c.games.length}`), h('div', { class: 'tv-grid' }, c.games.map((g) => app.gameTile(g, { cls: 'tv-tile', wide: true }))));
      showHero(c.games[0]);
      return { system: () => c.system || null, onBack: () => { st.grid = null; app.saveUi(); app.render(`col:${c.id}`); }, onFocus: (el) => el?.dataset.game && showHero(gameOf(app, el)), onTab: (d) => moveGrid(d) };
    }
  }
  function moveGrid(d) {
    const sysCols = model.collections.filter((c) => c.system);
    const i = sysCols.findIndex((c) => c.id === st.grid);
    st.grid = sysCols[(i + d + sysCols.length) % sysCols.length]?.id || null;
    app.saveUi(); app.render(`col:${st.grid}`);
  }
  for (const c of model.collections) {
    if (!c.games.length) continue;
    const row = h('div', { class: 'tv-row-items' }, c.games.slice(0, 40).map((g) => app.gameTile(g, { cls: 'tv-tile', wide: true })));
    if (c.games.length > 40) {
      const more = h('button', { class: 'gc-tile tv-tile tv-more', 'data-nav': `more:${c.id}` }, h('span', {}, `All ${c.games.length}`), h('span', { class: 'gc-small' }, c.short));
      more.onActivate = () => { st.grid = c.id; app.saveUi(); app.render(); };
      row.append(more);
    }
    rows.append(h('section', { class: 'tv-row' }, h('h2', { class: 'tv-row-title' }, c.name), row));
  }
  if (!rows.children.length) rows.append(emptyRow(model));
  showHero(model.collections[0]?.games[0]);
  // L / R jump straight into a console's full grid.
  return { system: () => null, onFocus: (el) => { if (el?.dataset.game) showHero(gameOf(app, el)); }, onTab: (d) => { const first = model.collections.find((c) => c.system); if (first) { st.grid = first.id; moveGrid(d > 0 ? 0 : -1); } } };
}

// ---------------------------------------------------------------------------
// 3. Wave Bar — a cross-shaped menu over a flowing wave: consoles run left to right, their
//    games top to bottom. (Inspired by the PS3's XrossMediaBar.)
// ---------------------------------------------------------------------------

function xmb(root, model, app) {
  const id = 'xmb';
  const { st, cols, col } = pick(model, app, id);
  const bar = h('div', { class: 'xb-bar' });
  const list = h('div', { class: 'xb-list' });
  const info = h('div', { class: 'xb-clock' }, h('span', {}, dateStr()), h('strong', {}, clock()));
  root.append(h('div', { class: 'xb' }, h('div', { class: 'xb-wave' }, waveSvg()), info, bar, list, h('div', { class: 'xb-chrome' }, app.chrome())));
  const ci = Math.max(0, cols.indexOf(col));
  cols.forEach((c, i) => {
    const b = colButton(app, id, c, `xb-cat ${i === ci ? 'on' : ''}`, [h('span', { class: 'xb-icon', style: c.system ? { '--sys': SYSTEMS[c.system].color } : {} }, c.system ? SYSTEMS[c.system].short.slice(0, 3) : c.id === 'favorites' ? '★' : '⟲'), h('span', { class: 'xb-name' }, c.short)]);
    b.style.setProperty('--i', String(i - ci));
    bar.append(b);
  });
  const games = col?.games || [];
  let gi = Math.min(st.item?.[col?.id] || 0, Math.max(0, games.length - 1));
  games.forEach((g, i) => {
    const b = h('button', { class: 'xb-item', 'data-nav': `game:${g.id}`, dataset: { game: g.id } }, h('span', { class: 'xb-thumb' }, app.cover(g)), h('span', { class: 'xb-text' }, h('strong', {}, g.title), h('span', {}, SYSTEMS[g.system]?.short)));
    b.onActivate = () => app.openGame(g);
    b.style.setProperty('--i', String(i - gi));
    list.append(b);
  });
  if (!games.length) list.append(emptyRow(model));
  const place = () => [...list.children].forEach((el, i) => el.style.setProperty('--i', String(i - gi)));
  const focusItem = () => { const el = list.children[gi]; if (el?.dataset.nav) app.nav.focus(el, { scroll: false }); };
  return {
    onFocus: (el) => {
      if (el?.dataset.game) { gi = [...list.children].indexOf(el); (st.item ||= {})[col.id] = gi; app.saveUi(); place(); }
    },
    onMove: (el, dir) => {
      if (dir === 'left' || dir === 'right') {
        if (el?.closest('.xb-chrome')) return false;
        cycleCol(app, id, model, dir === 'right' ? 1 : -1, 'first');
        return true;
      }
      if (el?.dataset.game) {
        if (dir === 'up' && gi === 0) { app.nav.focus(bar.querySelector('.xb-cat.on')); return true; }
        gi = Math.max(0, Math.min(games.length - 1, gi + (dir === 'down' ? 1 : -1)));
        focusItem(); return true;
      }
      if (el?.dataset.col && dir === 'down' && games.length) { focusItem(); return true; }
      return false;
    },
    onTab: (d) => cycleCol(app, id, model, d, 'first'),
    initial: () => list.children[gi]?.dataset.nav,
  };
}

function waveSvg() {
  const wrap = h('div', { class: 'xb-waves', html: `<svg viewBox="0 0 1200 400" preserveAspectRatio="none">
    <path class="w1" d="M0 220 C 200 140 400 300 600 220 S 1000 140 1200 220 V400 H0z"/>
    <path class="w2" d="M0 240 C 250 180 450 320 700 240 S 1050 170 1200 250 V400 H0z"/>
    <path class="w3" d="M0 260 C 300 210 500 330 800 260 S 1100 200 1200 270 V400 H0z"/></svg>` });
  return wrap;
}

// ---------------------------------------------------------------------------
// 4. Channels — a bright grid of rounded "channels", one per console; pick one to open it.
//    (Inspired by the Wii Menu.)
// ---------------------------------------------------------------------------

function channels(root, model, app) {
  const id = 'channels';
  const st = app.stateFor(id);
  const open = st.open && model.collections.find((c) => c.id === st.open);
  const timeEl = h('div', { class: 'ch-time' }, clock());
  const bottom = h('div', { class: 'ch-bottom' },
    h('div', { class: 'ch-round' }, app.chrome()[0]),
    h('div', { class: 'ch-clock' }, timeEl, h('div', { class: 'ch-date' }, dateStr())),
    h('div', { class: 'ch-round' }, app.chrome()[1]));
  if (open) {
    const sys = open.system && SYSTEMS[open.system];
    const back = h('button', { class: 'ch-menu', 'data-nav': 'ch:menu' }, '‹ Menu');
    back.onActivate = () => { st.open = null; app.saveUi(); app.render(`col:${open.id}`); };
    root.append(h('div', { class: 'ch ch-in', style: sys ? { '--sys': sys.color } : {} },
      h('div', { class: 'ch-banner' }, h('h1', {}, open.name), h('span', {}, `${open.games.length} game${open.games.length === 1 ? '' : 's'}`)),
      h('div', { class: 'ch-games' }, open.games.length ? open.games.map((g) => app.gameTile(g, { cls: 'ch-game' })) : emptyRow(model)),
      h('div', { class: 'ch-bottom' }, back, h('div', { class: 'ch-clock' }, timeEl), h('div', { class: 'ch-round' }, app.chrome()[0]))));
    return { system: () => open.system || null, onBack: () => back.onActivate(), onTab: (d) => { const cs = model.collections; const i = cs.indexOf(open); st.open = cs[(i + d + cs.length) % cs.length].id; app.saveUi(); app.render(); }, destroy: tickClock(timeEl) };
  }
  const grid = h('div', { class: 'ch-grid' });
  for (const c of model.collections) {
    const sys = c.system && SYSTEMS[c.system];
    const b = h('button', { class: 'ch-tile', 'data-nav': `col:${c.id}`, dataset: { col: c.id }, style: sys ? { '--sys': sys.color } : {} },
      h('span', { class: 'ch-tile-art' }, c.games.slice(0, 3).map((g) => app.cover(g))),
      h('span', { class: 'ch-tile-name' }, c.short));
    b.onActivate = () => { st.open = c.id; app.saveUi(); app.render(); };
    grid.append(b);
  }
  // Empty channels make the grid look like the real thing.
  const filler = Math.max(0, 12 - model.collections.length);
  for (let i = 0; i < filler; i++) grid.append(h('div', { class: 'ch-tile blank' }));
  root.append(h('div', { class: 'ch' }, grid, bottom));
  return { system: () => null, destroy: tickClock(timeEl) };
}

function tickClock(el) {
  const t = setInterval(() => { el.textContent = clock(); }, 15e3);
  return () => clearInterval(t);
}

// ---------------------------------------------------------------------------
// 5. Home Row — one row of big square tiles with the name above the selected one, and round
//    buttons underneath. (Inspired by the Nintendo Switch HOME Menu.)
// ---------------------------------------------------------------------------

function homeRow(root, model, app) {
  const id = 'homerow';
  const { col } = pick(model, app, id);
  const title = h('div', { class: 'hr-title' });
  const row = h('div', { class: 'hr-row' });
  const timeEl = h('span', {}, clock());
  root.append(h('div', { class: 'hr' },
    h('div', { class: 'hr-top' }, h('span', { class: 'hr-avatar' }, '🎮'), h('span', { class: 'hr-top-right' }, timeEl, h('span', { class: 'hr-batt' }))),
    title, row,
    h('div', { class: 'hr-icons' },
      model.collections.map((c) => colButton(app, id, c, `hr-icon ${c.id === col?.id ? 'on' : ''}`, [h('span', { class: 'hr-icon-dot' }, c.system ? SYSTEMS[c.system].short.slice(0, 2) : c.id === 'favorites' ? '★' : '⟲'), h('span', { class: 'hr-icon-label' }, c.short)])),
      app.chrome().map((b) => { b.classList.add('hr-icon'); return b; }))));
  const games = col?.games || [];
  for (const g of games) row.append(app.gameTile(g, { cls: 'hr-tile', label: false }));
  if (!games.length) row.append(emptyRow(model));
  const setTitle = (g) => { title.textContent = g ? g.title : ''; };
  setTitle(games[0]);
  return {
    onFocus: (el) => { if (el?.dataset.game) { setTitle(gameOf(app, el)); title.style.setProperty('--x', `${el.offsetLeft - row.scrollLeft + el.offsetWidth / 2}px`); } else if (el?.dataset.col) title.textContent = model.collections.find((c) => c.id === el.dataset.col)?.name || ''; },
    onTab: (d) => cycleCol(app, id, model, d),
    destroy: tickClock(timeEl),
  };
}

// ---------------------------------------------------------------------------
// 6. Spotlight — small tiles along the top; the selected game fills the screen with its art,
//    name and a Play button. (Inspired by the PS5 home screen.)
// ---------------------------------------------------------------------------

function spotlight(root, model, app) {
  const id = 'spotlight';
  const { cols, col } = pick(model, app, id);
  const bg = h('div', { class: 'sp-bg' });
  const info = h('div', { class: 'sp-info' });
  const row = h('div', { class: 'sp-row' });
  root.append(h('div', { class: 'sp' }, bg,
    h('div', { class: 'sp-top' }, h('div', { class: 'sp-tabs' }, cols.map((c) => colButton(app, id, c, `sp-tab ${c.id === col?.id ? 'on' : ''}`, c.short))), h('div', { class: 'sp-chrome' }, h('span', {}, clock()), app.chrome())),
    row, info));
  const games = col?.games || [];
  for (const g of games) row.append(app.gameTile(g, { cls: 'sp-tile', label: false }));
  if (!games.length) row.append(emptyRow(model));
  const show = (g) => {
    if (!g) return;
    const sys = SYSTEMS[g.system] || {};
    clear(bg, app.cover(g));
    bg.style.setProperty('--sys', sys.color);
    const play = app.navBtn(model.played[g.id] ? '▶ Continue' : '▶ Play', () => app.openGame(g), 'sp:play', 'primary sp-play');
    clear(info, h('div', { class: 'sp-sys' }, sys.name), h('h1', {}, g.title), h('div', { class: 'sp-actions' }, play, app.navBtn('…', () => app.openGame(g), 'sp:more', 'sp-more')));
  };
  show(games[0]);
  return {
    onFocus: (el) => { if (el?.dataset.game) show(gameOf(app, el)); },
    onTab: (d) => cycleCol(app, id, model, d),
  };
}

// ---------------------------------------------------------------------------
// 7. Big Picture — a tall grid of box art under section tabs, with button hints along the
//    bottom. (Inspired by Steam's Big Picture mode.)
// ---------------------------------------------------------------------------

function bigPicture(root, model, app) {
  const id = 'bigpicture';
  const { cols, col } = pick(model, app, id);
  const grid = h('div', { class: 'bp-grid' }, col?.games.length ? col.games.map((g) => app.gameTile(g, { cls: 'bp-tile' })) : emptyRow(model));
  root.append(h('div', { class: 'bp' },
    h('div', { class: 'bp-top' }, h('span', { class: 'bp-lb' }, 'LB'), h('div', { class: 'bp-tabs' }, cols.map((c) => colButton(app, id, c, `bp-tab ${c.id === col?.id ? 'on' : ''}`, [c.short, h('span', { class: 'bp-n' }, c.games.length)]))), h('span', { class: 'bp-lb' }, 'RB'), h('div', { class: 'bp-chrome' }, app.chrome())),
    h('div', { class: 'bp-head' }, h('h1', {}, col?.name || 'Library'), h('span', {}, `${col?.games.length || 0} game${col?.games.length === 1 ? '' : 's'}`)),
    grid,
    h('div', { class: 'bp-hints' }, h('span', {}, h('b', { class: 'a' }, 'A'), 'Select'), h('span', {}, h('b', { class: 'b' }, 'B'), 'Back'), h('span', {}, h('b', { class: 'y' }, 'Y'), 'Favorite'), h('span', {}, h('b', {}, '☰'), 'Settings'))));
  return { onTab: (d) => cycleCol(app, id, model, d) };
}

// ---------------------------------------------------------------------------
// 8. Cover Flow — flip through box art in 3D, with reflections, like a record crate.
//    (Inspired by iTunes and the iPod.)
// ---------------------------------------------------------------------------

function coverFlow(root, model, app) {
  const id = 'coverflow';
  const { st, cols, col } = pick(model, app, id);
  const games = col?.games || [];
  let at = Math.min(st.at?.[col?.id] || 0, Math.max(0, games.length - 1));
  const stage = h('div', { class: 'cf-stage' });
  const caption = h('div', { class: 'cf-caption' });
  const scrub = h('div', { class: 'cf-scrub' }, h('span'));
  const prev = colButton(app, id, cols[(cols.indexOf(col) - 1 + cols.length) % cols.length] || col || { id: 'x', short: '' }, 'cf-arrow', '‹');
  const next = colButton(app, id, cols[(cols.indexOf(col) + 1) % cols.length] || col || { id: 'x', short: '' }, 'cf-arrow', '›');
  root.append(h('div', { class: 'cf' },
    h('div', { class: 'cf-top' }, prev, h('div', { class: 'cf-col' }, col?.name || ''), next, h('div', { class: 'cf-chrome' }, app.chrome())),
    stage, caption, scrub));
  const els = new Map();
  const draw = () => {
    const lo = Math.max(0, at - 14), hi = Math.min(games.length - 1, at + 14);
    for (const [i, el] of els) if (i < lo || i > hi) { el.remove(); els.delete(i); }
    for (let i = lo; i <= hi; i++) {
      let el = els.get(i);
      if (!el) {
        const g = games[i];
        el = h('button', { class: 'cf-item', 'data-nav': `game:${g.id}`, dataset: { game: g.id, i } }, app.cover(g));
        el.onActivate = () => (i === at ? app.openGame(g) : go(i));
        els.set(i, el);
        stage.append(el);
      }
      const d = i - at;
      el.style.setProperty('--d', String(d));
      el.style.zIndex = String(100 - Math.abs(d));
      el.classList.toggle('center', d === 0);
    }
    const g = games[at];
    clear(caption, g ? [h('strong', {}, g.title), h('span', {}, SYSTEMS[g.system]?.name)] : emptyRow(model));
    scrub.firstChild.style.width = games.length ? `${Math.max(4, 100 / games.length)}%` : '0';
    scrub.firstChild.style.left = games.length > 1 ? `${(at / (games.length - 1)) * (100 - Math.max(4, 100 / games.length))}%` : '0';
  };
  const go = (i) => {
    at = Math.max(0, Math.min(games.length - 1, i));
    (st.at ||= {})[col.id] = at; app.saveUi();
    draw();
    app.nav.focus(els.get(at), { scroll: false });
  };
  draw();
  return {
    onFocus: (el) => { const i = Number(el?.dataset.i); if (el?.dataset.game && i !== at) go(i); },
    onMove: (el, dir) => {
      if (!el?.dataset.game) return dir === 'down' && games.length ? (go(at), true) : false;
      if (dir === 'left' || dir === 'right') { go(at + (dir === 'right' ? 1 : -1)); return true; }
      if (dir === 'down') { cycleCol(app, id, model, 1, 'first'); return true; }
      return false;
    },
    onTab: (d) => cycleCol(app, id, model, d, 'first'),
    initial: () => els.get(at)?.dataset.nav,
  };
}

// ---------------------------------------------------------------------------
// 9. Mini Classic — a single shelf of box art on a soft background, the title above the
//    highlighted game. (Inspired by the SNES Classic Edition.)
// ---------------------------------------------------------------------------

function miniClassic(root, model, app) {
  const id = 'classic';
  const { cols, col } = pick(model, app, id);
  const title = h('div', { class: 'mc-title' });
  const sub = h('div', { class: 'mc-sub' });
  const row = h('div', { class: 'mc-row' });
  root.append(h('div', { class: 'mc' },
    h('div', { class: 'mc-tabs' }, cols.map((c) => colButton(app, id, c, `mc-tab ${c.id === col?.id ? 'on' : ''}`, c.short))),
    h('div', { class: 'mc-head' }, title, sub),
    row,
    h('div', { class: 'mc-menu' }, h('span', { class: 'mc-menu-label' }, 'Options'), app.chrome().map((b) => { b.classList.add('mc-menu-btn'); return b; }))));
  const games = col?.games || [];
  for (const g of games) row.append(app.gameTile(g, { cls: 'mc-tile', label: false }));
  if (!games.length) row.append(emptyRow(model));
  const set = (g) => { title.textContent = g?.title || col?.name || ''; sub.textContent = g ? `${SYSTEMS[g.system]?.short}${model.played[g.id] ? ' · played' : ''}` : ''; };
  set(games[0]);
  return { onFocus: (el) => el?.dataset.game && set(gameOf(app, el)), onTab: (d) => cycleCol(app, id, model, d) };
}

// ---------------------------------------------------------------------------
// 10. Media Center — big category words stacked up and down, each with its row of games to
//     the right, on a deep blue glow. (Inspired by Windows Media Center.)
// ---------------------------------------------------------------------------

function mediaCenter(root, model, app) {
  const id = 'mediacenter';
  const { cols, col } = pick(model, app, id);
  const ci = Math.max(0, cols.indexOf(col));
  const strip = h('div', { class: 'mce-strip' });
  cols.forEach((c, i) => {
    const sec = h('div', { class: `mce-cat ${i === ci ? 'on' : ''}`, style: { '--i': String(i - ci) } },
      colButton(app, id, c, 'mce-cat-name', c.short.toLowerCase()));
    if (i === ci) sec.append(h('div', { class: 'mce-items' }, c.games.length ? c.games.map((g) => app.gameTile(g, { cls: 'mce-tile' })) : emptyRow(model)));
    strip.append(sec);
  });
  root.append(h('div', { class: 'mce' }, h('div', { class: 'mce-glow' }), h('div', { class: 'mce-top' }, h('span', { class: 'mce-logo' }, '◉'), h('span', {}, clock()), app.chrome()), strip));
  return {
    onMove: (el, dir) => {
      if (el?.closest('.mce-top')) return false;
      if (dir === 'up' || dir === 'down') {
        if (dir === 'up' && el?.dataset.game) { app.nav.focus(strip.querySelector('.mce-cat.on .mce-cat-name')); return true; }
        if (dir === 'down' && el?.dataset.col && col?.games.length) { app.nav.focus(strip.querySelector('.mce-cat.on .gc-tile')); return true; }
        if (dir === 'up' && ci === 0) return false;
        cycleCol(app, id, model, dir === 'down' ? 1 : -1);
        return true;
      }
      return false;
    },
    onTab: (d) => cycleCol(app, id, model, d),
  };
}

// ---------------------------------------------------------------------------

export const THEME_LIST = [
  { id: 'retro', name: 'Living Room ’89', inspired: 'A 1980s–90s entertainment centre: wood panels, a CRT TV and a VCR', render: retro, swatch: 'linear-gradient(135deg,#5b3a1e,#8a5a2b 40%,#2b1a0d)', glyph: '📺' },
  { id: 'tv', name: 'Couch TV', inspired: 'Inspired by Apple TV: a big top shelf and rows of tiles', render: tv, swatch: 'linear-gradient(135deg,#1c1c1e,#3a3a3c)', glyph: '' },
  { id: 'xmb', name: 'Wave Bar', inspired: 'Inspired by the PlayStation 3’s cross-shaped menu', render: xmb, swatch: 'linear-gradient(135deg,#0b3d91,#2a8fd8 60%,#94d0ff)', glyph: '≋' },
  { id: 'channels', name: 'Channels', inspired: 'Inspired by the Wii Menu: a grid of channels', render: channels, swatch: 'linear-gradient(135deg,#f4f4f4,#d9e3ea)', glyph: '▦' },
  { id: 'homerow', name: 'Home Row', inspired: 'Inspired by the Nintendo Switch HOME Menu', render: homeRow, swatch: 'linear-gradient(135deg,#ebebeb,#ffffff 60%,#00c3e3)', glyph: '▭' },
  { id: 'spotlight', name: 'Spotlight', inspired: 'Inspired by the PS5: the selected game fills the screen', render: spotlight, swatch: 'linear-gradient(135deg,#0d0d1a,#1f2a5c 60%,#3b5bdb)', glyph: '◆' },
  { id: 'bigpicture', name: 'Big Picture', inspired: 'Inspired by Steam Big Picture: a big grid with button hints', render: bigPicture, swatch: 'linear-gradient(135deg,#171a21,#1b2838 50%,#66c0f4)', glyph: '▤' },
  { id: 'coverflow', name: 'Cover Flow', inspired: 'Inspired by iTunes and the iPod: flip through box art in 3D', render: coverFlow, swatch: 'linear-gradient(180deg,#3a3a3a,#000)', glyph: '◫' },
  { id: 'classic', name: 'Mini Classic', inspired: 'Inspired by the SNES Classic Edition’s single shelf', render: miniClassic, swatch: 'linear-gradient(135deg,#e8e2f4,#c8bfe6)', glyph: '▬' },
  { id: 'mediacenter', name: 'Media Center', inspired: 'Inspired by Windows Media Center’s menu strip', render: mediaCenter, swatch: 'linear-gradient(135deg,#0b2a6b,#1f6fd1 70%,#69d2ff)', glyph: '◉' },
];
export const THEMES = Object.fromEntries(THEME_LIST.map((t) => [t.id, t]));
