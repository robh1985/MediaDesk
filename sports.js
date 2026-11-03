// Live scores for the menu bar: NFL, NBA, NHL and MLB games from ESPN's public scoreboards (no
// key), each league asked for at most every 15 seconds while its games are on (every 5 minutes
// otherwise) however many browsers are open, and the teams' logos, downloaded once and kept with
// MediaDesk's settings. When a logo can't be had, a badge in the team's colours is drawn instead.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const LEAGUES = {
  nfl: { name: 'NFL', sport: 'football' },
  nba: { name: 'NBA', sport: 'basketball' },
  nhl: { name: 'NHL', sport: 'hockey' },
  mlb: { name: 'MLB', sport: 'baseball' },
};
const ESPN = (process.env.ESPN_API_URL || 'https://site.api.espn.com/apis/site/v2/sports').replace(/\/+$/, '');
const scoreboardUrl = (league) => process.env[`${league.toUpperCase()}_SCOREBOARD_URL`] || `${ESPN}/${LEAGUES[league].sport}/${league}/scoreboard`;
const LOGO = (league, abbr) => `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr}.png`;

// Names and colours for the drawn badges and the demo (NFL in full; a few of each other league).
const TEAMS = {
  nfl: {
    ARI: ['Arizona Cardinals', '97233f'], ATL: ['Atlanta Falcons', 'a71930'], BAL: ['Baltimore Ravens', '241773'], BUF: ['Buffalo Bills', '00338d'],
    CAR: ['Carolina Panthers', '0085ca'], CHI: ['Chicago Bears', '0b162a'], CIN: ['Cincinnati Bengals', 'fb4f14'], CLE: ['Cleveland Browns', '311d00'],
    DAL: ['Dallas Cowboys', '003594'], DEN: ['Denver Broncos', 'fb4f14'], DET: ['Detroit Lions', '0076b6'], GB: ['Green Bay Packers', '203731'],
    HOU: ['Houston Texans', '03202f'], IND: ['Indianapolis Colts', '002c5f'], JAX: ['Jacksonville Jaguars', '006778'], KC: ['Kansas City Chiefs', 'e31837'],
    LV: ['Las Vegas Raiders', '000000'], LAC: ['Los Angeles Chargers', '0080c6'], LAR: ['Los Angeles Rams', '003594'], MIA: ['Miami Dolphins', '008e97'],
    MIN: ['Minnesota Vikings', '4f2683'], NE: ['New England Patriots', '002244'], NO: ['New Orleans Saints', 'd3bc8d'], NYG: ['New York Giants', '0b2265'],
    NYJ: ['New York Jets', '125740'], PHI: ['Philadelphia Eagles', '004c54'], PIT: ['Pittsburgh Steelers', 'ffb612'], SF: ['San Francisco 49ers', 'aa0000'],
    SEA: ['Seattle Seahawks', '002244'], TB: ['Tampa Bay Buccaneers', 'd50a0a'], TEN: ['Tennessee Titans', '4b92db'], WSH: ['Washington Commanders', '5a1414'],
  },
  nba: { BOS: ['Boston Celtics', '007a33'], LAL: ['Los Angeles Lakers', '552583'], GS: ['Golden State Warriors', '1d428a'], NY: ['New York Knicks', '006bb6'], MIL: ['Milwaukee Bucks', '00471b'], DEN: ['Denver Nuggets', '0e2240'] },
  nhl: { TOR: ['Toronto Maple Leafs', '00205b'], MTL: ['Montreal Canadiens', 'af1e2d'], EDM: ['Edmonton Oilers', '041e42'], BOS: ['Boston Bruins', 'fcb514'], NYR: ['New York Rangers', '0038a8'], VGK: ['Vegas Golden Knights', 'b4975a'] },
  mlb: { NYY: ['New York Yankees', '132448'], BOS: ['Boston Red Sox', 'bd3039'], LAD: ['Los Angeles Dodgers', '005a9c'], SF: ['San Francisco Giants', 'fd5a1e'], CHC: ['Chicago Cubs', '0e3386'], STL: ['St. Louis Cardinals', 'c41e3a'] },
};

function badge(abbr, color) {
  const c = /^[0-9a-f]{6}$/i.test(color || '') ? color : '555555';
  const light = parseInt(c.slice(0, 2), 16) * 0.3 + parseInt(c.slice(2, 4), 16) * 0.59 + parseInt(c.slice(4, 6), 16) * 0.11 > 170;
  const size = abbr.length > 2 ? 26 : 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#${c}"/><circle cx="32" cy="32" r="27" fill="none" stroke="${light ? '#0006' : '#fff6'}" stroke-width="2"/><text x="32" y="${32 + size * 0.36}" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-weight="800" font-size="${size}" fill="${light ? '#111' : '#fff'}">${abbr}</text></svg>`;
}

function createSports({ dataDir, mock = false, log = console.log }) {
  const logoDir = path.join(dataDir, 'sports-logos');
  const caches = new Map();  // league → { at, data, live }
  const pending = new Map();
  const colors = new Map();  // "league/ABBR" → colour, for badges

  const team = (league, c) => {
    const t = c.team || {};
    const abbr = String(t.abbreviation || '').toUpperCase();
    const known = TEAMS[league]?.[abbr];
    const color = /^[0-9a-f]{6}$/i.test(t.color || '') ? t.color : known?.[1] || '555555';
    colors.set(`${league}/${abbr}`, color);
    return {
      id: String(t.id || ''), abbr, name: t.displayName || known?.[0] || abbr, short: t.shortDisplayName || t.name || abbr, color,
      score: c.score != null && c.score !== '' ? Number(c.score) : null,
      record: c.records?.[0]?.summary || '',
      logo: `/portal/sports/logo/${league}/${abbr.toLowerCase()}`,
    };
  };
  function shape(league, data) {
    const games = (data.events || []).map((e) => {
      const comp = e.competitions?.[0] || {};
      const st = e.status?.type || comp.status?.type || {};
      const cs = comp.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home') || cs[0];
      const away = cs.find((c) => c.homeAway === 'away') || cs[1];
      if (!home || !away) return null;
      const sit = comp.situation || {};
      const h = team(league, home), a = team(league, away);
      const g = {
        id: `${league}-${e.id}`, league, start: e.date, state: st.state || 'pre', final: Boolean(st.completed),
        status: st.shortDetail || st.detail || '', detail: st.detail || '',
        period: e.status?.period ?? null, home: h, away: a,
        possession: sit.possession ? (String(sit.possession) === h.id ? 'home' : String(sit.possession) === a.id ? 'away' : null) : null,
        down: sit.shortDownDistanceText || sit.downDistanceText || '', redZone: Boolean(sit.isRedZone),
        lastPlay: sit.lastPlay?.text || '',
        tv: (comp.broadcasts || []).flatMap((b) => b.names || []).join(', '),
      };
      // Baseball: the count, outs and who's on base.
      if (league === 'mlb' && (sit.outs != null || sit.onFirst != null)) {
        g.bases = [Boolean(sit.onFirst), Boolean(sit.onSecond), Boolean(sit.onThird)];
        g.outs = Number(sit.outs) || 0;
        g.count = sit.balls != null ? `${sit.balls}-${sit.strikes ?? 0}` : '';
        g.batter = sit.batter?.athlete?.shortName || '';
        g.pitcher = sit.pitcher?.athlete?.shortName || '';
      }
      return g;
    }).filter(Boolean);
    games.sort((x, y) => ({ in: 0, pre: 1, post: 2 }[x.state] - { in: 0, pre: 1, post: 2 }[y.state]) || String(x.start).localeCompare(String(y.start)));
    const label = data.week?.number ? `Week ${data.week.number}` : data.day?.date ? new Date(`${data.day.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    return { league, name: LEAGUES[league].name, label, games };
  }

  async function scoreboard(league) {
    if (mock) return demo(league);
    const cache = caches.get(league);
    if (cache && Date.now() - cache.at < (cache.live ? 15e3 : 5 * 60e3)) return cache.data;
    if (!pending.has(league)) {
      pending.set(league, (async () => {
        try {
          const res = await fetch(scoreboardUrl(league), { headers: { Accept: 'application/json', 'User-Agent': 'MediaDesk/1.0 (self-hosted media portal)' }, signal: AbortSignal.timeout(10e3) });
          if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
          const data = shape(league, await res.json());
          caches.set(league, { at: Date.now(), data, live: data.games.some((g) => g.state === 'in') });
          return data;
        } catch (err) {
          // Keep showing what we had (for a while) rather than nothing.
          const c = caches.get(league);
          if (c && Date.now() - c.at < 30 * 60e3) { c.at = Date.now() - (c.live ? 5e3 : 4 * 60e3); return c.data; }
          throw err;
        } finally { pending.delete(league); }
      })());
    }
    return pending.get(league);
  }

  // A team's logo: kept on disk once downloaded; a drawn badge if it can't be.
  async function sendLogo(res, league, abbr) {
    const up = abbr.toUpperCase();
    const file = path.join(logoDir, league, `${abbr}.png`);
    const send = (buf, type) => { res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' }); res.end(buf); };
    if (!mock) {
      try { return send(await fsp.readFile(file), 'image/png'); } catch { /* fetch it */ }
      // Logos kept before there were other leagues.
      if (league === 'nfl') try { return send(await fsp.readFile(path.join(logoDir, `${abbr}.png`)), 'image/png'); } catch { /* fetch it */ }
      try {
        const r = await fetch(LOGO(league, abbr), { signal: AbortSignal.timeout(8e3) });
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50) {
          await fsp.mkdir(path.dirname(file), { recursive: true });
          await fsp.writeFile(file, buf);
          return send(buf, 'image/png');
        }
      } catch (err) { log(`${LEAGUES[league].name} logo for ${up}: ${err.message}`); }
    }
    const svg = Buffer.from(badge(up, colors.get(`${league}/${up}`) || TEAMS[league]?.[up]?.[1]));
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': svg.length, 'Cache-Control': mock ? 'public, max-age=3600' : 'no-cache', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(svg);
  }

  // The demo: games going on in every league (their scores go up as time passes), some finished,
  // some later on.
  function demo(league) {
    const now = Date.now();
    const t = Math.floor(now / 1000);
    const T = TEAMS[league];
    const mk = (abbr, score, home) => { colors.set(`${league}/${abbr}`, T[abbr][1]); return { id: abbr, abbr, name: T[abbr][0], short: T[abbr][0].split(' ').pop(), color: T[abbr][1], score, record: home ? '6-2' : '5-3', logo: `/portal/sports/logo/${league}/${abbr.toLowerCase()}` }; };
    const clock = (mins) => `${mins - 1 - Math.floor((t % 60) / 5)}:${String((59 - (t % 60)) % 60).padStart(2, '0')}`;
    const g = (n, away, aScore, home, hScore, state, status, extra = {}) => ({ id: `${league}-${n}`, league, start: new Date(now + (state === 'pre' ? 3 * 3600e3 : -3600e3)).toISOString(), state, final: state === 'post', status, detail: status, period: null, away: mk(away, aScore, false), home: mk(home, hScore, true), possession: null, down: '', redZone: false, lastPlay: '', tv: { nfl: 'CBS', nba: 'ESPN', nhl: 'TNT', mlb: 'FOX' }[league], ...extra });
    const k = Object.keys(T);
    const ord = (n) => ['1st', '2nd', '3rd', '4th'][n];
    if (league === 'nfl') {
      const pts = (seed) => [0, 3, 7, 10, 14, 17, 21, 24, 27, 28, 31][Math.floor((t / 45 + seed) % 11)];
      const q = Math.floor((t / 60) % 4);
      return { league, name: 'NFL', label: 'Week 9 (demo)', games: [
        g(1, 'BUF', pts(2), 'KC', pts(5), 'in', `${clock(15)} - ${ord(q)}`, { possession: t % 20 < 10 ? 'home' : 'away', down: '2nd & 7 at BUF 34', redZone: t % 40 < 8, lastPlay: 'P.Mahomes pass short right to T.Kelce for 12 yards.' }),
        g(2, 'DAL', pts(7), 'PHI', pts(1), 'in', `${clock(15)} - ${ord((q + 1) % 4)}`, { possession: 'away', down: '3rd & 2 at PHI 41' }),
        g(3, 'GB', 24, 'CHI', 20, 'post', 'Final'),
        g(4, 'SF', null, 'SEA', null, 'pre', 'Sun, 4:25 PM'),
        g(5, 'DET', null, 'MIN', null, 'pre', 'Sun, 8:20 PM', { tv: 'NBC' }),
      ] };
    }
    if (league === 'nba') {
      const pts = (base) => base + Math.floor((t / 20) % 40);
      return { league, name: 'NBA', label: 'Today (demo)', games: [
        g(1, k[0], pts(78), k[1], pts(81), 'in', `${clock(12)} - ${ord(Math.floor((t / 90) % 4))}`, { lastPlay: 'L. James makes 26-foot three point jumper' }),
        g(2, k[2], 112, k[3], 104, 'post', 'Final'),
        g(3, k[4], null, k[5], null, 'pre', '7:30 PM'),
      ] };
    }
    if (league === 'nhl') {
      const goals = (seed) => Math.floor((t / 120 + seed) % 6);
      return { league, name: 'NHL', label: 'Today (demo)', games: [
        g(1, k[0], goals(1), k[1], goals(3), 'in', `${clock(20)} - ${ord(Math.floor((t / 120) % 3))}`, { lastPlay: 'Goal scored by A. Matthews (wrist shot)' }),
        g(2, k[2], 3, k[3], 4, 'post', 'Final/OT'),
        g(3, k[4], null, k[5], null, 'pre', '7:00 PM'),
      ] };
    }
    const inning = 1 + Math.floor((t / 60) % 9);
    return { league, name: 'MLB', label: 'Today (demo)', games: [
      g(1, k[0], Math.floor((t / 100) % 7), k[1], Math.floor((t / 130) % 6), 'in', `${t % 120 < 60 ? 'Top' : 'Bot'} ${inning}${['st', 'nd', 'rd'][inning - 1] || 'th'}`, { bases: [t % 3 === 0, t % 5 === 0, false], outs: t % 3, count: `${t % 4}-${t % 3}`, batter: 'A. Judge', pitcher: 'B. Bello', lastPlay: 'Judge singled to left.' }),
      g(2, k[2], 5, k[3], 2, 'post', 'Final'),
      g(3, k[4], null, k[5], null, 'pre', '7:05 PM'),
    ] };
  }

  async function handle(req, res, p, { sendJson }) {
    try {
      let m = /^\/portal\/sports\/(nfl|nba|nhl|mlb)$/.exec(p);
      if (m && req.method === 'GET') return sendJson(res, 200, await scoreboard(m[1]));
      m = /^\/portal\/sports\/logo\/(nfl|nba|nhl|mlb)\/([a-z]{2,4})$/.exec(p);
      if (m && req.method === 'GET') return await sendLogo(res, m[1], m[2]);
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return sendJson(res, 502, { error: `Scores aren’t available right now (${err.cause?.code || err.message})` });
    }
  }
  return { handle, scoreboard, shape };
}

module.exports = { createSports, badge, LEAGUES };
