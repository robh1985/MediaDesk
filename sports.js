// Live NFL scores for the menu bar: this week's games from ESPN's public scoreboard (no key), asked
// for at most every 15 seconds while games are on (every 5 minutes otherwise) however many browsers
// are open, and the teams' logos, downloaded once and kept with MediaDesk's settings. When a logo
// can't be had, a badge in the team's colours is drawn instead.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SCOREBOARD = process.env.NFL_SCOREBOARD_URL || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const LOGO = (abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;

// Colours for the drawn badges (and the demo).
const TEAMS = {
  ARI: ['Arizona Cardinals', '97233f'], ATL: ['Atlanta Falcons', 'a71930'], BAL: ['Baltimore Ravens', '241773'], BUF: ['Buffalo Bills', '00338d'],
  CAR: ['Carolina Panthers', '0085ca'], CHI: ['Chicago Bears', '0b162a'], CIN: ['Cincinnati Bengals', 'fb4f14'], CLE: ['Cleveland Browns', '311d00'],
  DAL: ['Dallas Cowboys', '003594'], DEN: ['Denver Broncos', 'fb4f14'], DET: ['Detroit Lions', '0076b6'], GB: ['Green Bay Packers', '203731'],
  HOU: ['Houston Texans', '03202f'], IND: ['Indianapolis Colts', '002c5f'], JAX: ['Jacksonville Jaguars', '006778'], KC: ['Kansas City Chiefs', 'e31837'],
  LV: ['Las Vegas Raiders', '000000'], LAC: ['Los Angeles Chargers', '0080c6'], LAR: ['Los Angeles Rams', '003594'], MIA: ['Miami Dolphins', '008e97'],
  MIN: ['Minnesota Vikings', '4f2683'], NE: ['New England Patriots', '002244'], NO: ['New Orleans Saints', 'd3bc8d'], NYG: ['New York Giants', '0b2265'],
  NYJ: ['New York Jets', '125740'], PHI: ['Philadelphia Eagles', '004c54'], PIT: ['Pittsburgh Steelers', 'ffb612'], SF: ['San Francisco 49ers', 'aa0000'],
  SEA: ['Seattle Seahawks', '002244'], TB: ['Tampa Bay Buccaneers', 'd50a0a'], TEN: ['Tennessee Titans', '4b92db'], WSH: ['Washington Commanders', '5a1414'],
};

function badge(abbr, color) {
  const c = /^[0-9a-f]{6}$/i.test(color || '') ? color : TEAMS[abbr]?.[1] || '555555';
  const light = parseInt(c.slice(0, 2), 16) * 0.3 + parseInt(c.slice(2, 4), 16) * 0.59 + parseInt(c.slice(4, 6), 16) * 0.11 > 170;
  const size = abbr.length > 2 ? 26 : 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#${c}"/><circle cx="32" cy="32" r="27" fill="none" stroke="${light ? '#0006' : '#fff6'}" stroke-width="2"/><text x="32" y="${32 + size * 0.36}" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-weight="800" font-size="${size}" fill="${light ? '#111' : '#fff'}">${abbr}</text></svg>`;
}

function createSports({ dataDir, mock = false, log = console.log }) {
  const logoDir = path.join(dataDir, 'sports-logos');
  let cache = null; // { at, data, live }
  let pending = null;

  const team = (c) => {
    const t = c.team || {};
    const abbr = String(t.abbreviation || '').toUpperCase();
    return {
      id: String(t.id || ''), abbr, name: t.displayName || TEAMS[abbr]?.[0] || abbr, short: t.shortDisplayName || t.name || abbr,
      color: /^[0-9a-f]{6}$/i.test(t.color || '') ? t.color : TEAMS[abbr]?.[1] || '555555',
      score: c.score != null && c.score !== '' ? Number(c.score) : null,
      record: c.records?.[0]?.summary || '',
      logo: `/portal/sports/logo/nfl/${abbr.toLowerCase()}`,
    };
  };
  function shape(data) {
    const games = (data.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const st = e.status?.type || comp.status?.type || {};
      const cs = comp.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home') || cs[0];
      const away = cs.find((c) => c.homeAway === 'away') || cs[1];
      if (!home || !away) return null;
      const sit = comp.situation || {};
      const h = team(home), a = team(away);
      return {
        id: String(e.id), start: e.date, state: st.state || 'pre', final: Boolean(st.completed),
        status: st.shortDetail || st.detail || '', detail: st.detail || '',
        home: h, away: a,
        possession: sit.possession ? (String(sit.possession) === h.id ? 'home' : String(sit.possession) === a.id ? 'away' : null) : null,
        down: sit.shortDownDistanceText || sit.downDistanceText || '', redZone: Boolean(sit.isRedZone),
        lastPlay: sit.lastPlay?.text || '',
        tv: (comp.broadcasts || []).flatMap((b) => b.names || []).join(', '),
      };
    }).filter(Boolean);
    games.sort((x, y) => ({ in: 0, pre: 1, post: 2 }[x.state] - { in: 0, pre: 1, post: 2 }[y.state]) || String(x.start).localeCompare(String(y.start)));
    return { week: data.week?.number || null, season: data.season?.year || null, label: data.week?.number ? `Week ${data.week.number}` : '', games };
  }

  async function scoreboard() {
    if (mock) return demo();
    const fresh = cache && Date.now() - cache.at < (cache.live ? 15e3 : 5 * 60e3);
    if (fresh) return cache.data;
    if (!pending) {
      pending = (async () => {
        try {
          const res = await fetch(SCOREBOARD, { headers: { Accept: 'application/json', 'User-Agent': 'MediaDesk/1.0 (self-hosted media portal)' }, signal: AbortSignal.timeout(10e3) });
          if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
          const data = shape(await res.json());
          cache = { at: Date.now(), data, live: data.games.some((g) => g.state === 'in') };
          return data;
        } catch (err) {
          // Keep showing what we had (for a while) rather than nothing.
          if (cache && Date.now() - cache.at < 30 * 60e3) { cache.at = Date.now() - (cache.live ? 5e3 : 4 * 60e3); return cache.data; }
          throw err;
        } finally { pending = null; }
      })();
    }
    return pending;
  }

  // A team's logo: kept on disk once downloaded; a drawn badge if it can't be.
  async function sendLogo(res, abbr) {
    const up = abbr.toUpperCase();
    const file = path.join(logoDir, `${abbr}.png`);
    const send = (buf, type) => { res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' }); res.end(buf); };
    if (!mock) {
      try { return send(await fsp.readFile(file), 'image/png'); } catch { /* fetch it */ }
      try {
        const r = await fetch(LOGO(abbr), { signal: AbortSignal.timeout(8e3) });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50) {
          await fsp.mkdir(logoDir, { recursive: true });
          await fsp.writeFile(file, buf);
          return send(buf, 'image/png');
        }
      } catch (err) { log(`NFL logo for ${up}: ${err.message}`); }
    }
    const svg = Buffer.from(badge(up, cache?.data.games.flatMap((g) => [g.home, g.away]).find((t) => t.abbr === up)?.color));
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': svg.length, 'Cache-Control': mock ? 'public, max-age=3600' : 'no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(svg);
  }

  // The demo: two games going on (their scores go up as time passes), one finished, two later on.
  function demo() {
    const now = Date.now();
    const t = Math.floor(now / 1000);
    const mk = (abbr, score, home) => ({ id: abbr, abbr, name: TEAMS[abbr][0], short: TEAMS[abbr][0].split(' ').pop(), color: TEAMS[abbr][1], score, record: home ? '6-2' : '5-3', logo: `/portal/sports/logo/nfl/${abbr.toLowerCase()}` });
    const q = 1 + Math.floor((t / 60) % 4);
    const clock = `${14 - Math.floor((t % 60) / 5)}:${String((59 - (t % 60)) % 60).padStart(2, '0')}`;
    const pts = (seed) => [0, 3, 7, 10, 14, 17, 21, 24, 27, 28, 31][Math.floor((t / 45 + seed) % 11)];
    const g = (id, away, aScore, home, hScore, state, status, extra = {}) => ({ id, start: new Date(now + (state === 'pre' ? 3 * 3600e3 : -3600e3)).toISOString(), state, final: state === 'post', status, detail: status, away: mk(away, aScore, false), home: mk(home, hScore, true), possession: null, down: '', redZone: false, lastPlay: '', tv: 'CBS', ...extra });
    return {
      week: 9, season: 2026, label: 'Week 9 (demo)',
      games: [
        g('1', 'BUF', pts(2), 'KC', pts(5), 'in', `${clock} - ${['1st', '2nd', '3rd', '4th'][q - 1]}`, { possession: t % 20 < 10 ? 'home' : 'away', down: '2nd & 7 at BUF 34', redZone: t % 40 < 8, lastPlay: 'P.Mahomes pass short right to T.Kelce for 12 yards.' }),
        g('2', 'DAL', pts(7), 'PHI', pts(1), 'in', `${clock} - ${['1st', '2nd', '3rd', '4th'][(q + 1) % 4]}`, { possession: 'away', down: '3rd & 2 at PHI 41' }),
        g('3', 'GB', 24, 'CHI', 20, 'post', 'Final'),
        g('4', 'SF', null, 'SEA', null, 'pre', 'Sun, 4:25 PM'),
        g('5', 'DET', null, 'MIN', null, 'pre', 'Sun, 8:20 PM', { tv: 'NBC' }),
      ],
    };
  }

  async function handle(req, res, p, { sendJson }) {
    try {
      if (p === '/portal/sports/nfl' && req.method === 'GET') return sendJson(res, 200, await scoreboard());
      const m = /^\/portal\/sports\/logo\/nfl\/([a-z]{2,4})$/.exec(p);
      if (m && req.method === 'GET') return await sendLogo(res, m[1]);
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return sendJson(res, 502, { error: `NFL scores aren’t available right now (${err.cause?.code || err.message})` });
    }
  }
  return { handle, scoreboard, shape };
}

module.exports = { createSports, badge };
