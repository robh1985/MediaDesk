'use strict';
// Matching game names to libretro-thumbnails box art names. Names differ in small ways —
// "Sonic the Hedgehog (USA)" is "Sonic The Hedgehog (USA)", "Super Metroid (USA)" is
// "Super Metroid (Japan, USA) (En,Ja)", "Legend of Zelda (USA)" is "Legend of Zelda, The (USA)" —
// so titles are compared loosely and the regions, disc number and release type pick the best.

const ARTICLES = /^(.*), (the|a|an|le|la|les|der|die|das)$/i;
function normTitle(title) {
  let t = String(title).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(ARTICLES, '$2 $1').replace(/, (the|a|an) (-|:)/i, ' $2').replace(/^(the|a|an) /, '');
  return t.replace(/&/g, ' and ').replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (r) => ({ ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }[r]))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}
// "Title (USA) (Disc 1) [!]" -> { title: 'Title', tags: ['usa', 'disc 1'] }
function split(name) {
  const m = /^(.*?)\s*([([].*)?$/.exec(String(name));
  const tags = [...String(m[2] || '').matchAll(/[([]([^)\]]*)[)\]]/g)].flatMap((x) => x[1].split(',').map((s) => s.trim().toLowerCase()));
  return { title: m[1].trim(), tags };
}
const REGIONS = ['usa', 'world', 'europe', 'japan', 'uk', 'australia', 'canada', 'france', 'germany', 'spain', 'italy', 'korea', 'asia', 'brazil', 'netherlands', 'sweden', 'china', 'taiwan', 'us', 'eu', 'jp', 'u', 'e', 'j'];
const SHORT = { u: 'usa', us: 'usa', e: 'europe', eu: 'europe', j: 'japan', jp: 'japan' };
const BAD = /^(beta|proto|prototype|demo|sample|pirate|aftermarket|unl|hack|kiosk|promo|debug)\b|virtual console|switch online|collection|classic|edc|program|alt|alternate/;

// Index the names by loose title, once per list.
function indexNames(names) {
  const map = new Map();
  for (const n of names) {
    const { title } = split(n);
    const keys = new Set([normTitle(title)]);
    // "Title - Subtitle" also answers to "Title: Subtitle" (both normalise the same) and to "Title".
    for (const k of keys) { if (!k) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(n); }
  }
  return map;
}

// The best box art name for a game (its names: e.g. the file's and the folder's), or null.
function bestMatch(index, gameNames) {
  const want = gameNames.map(split);
  const tags = new Set(want.flatMap((w) => w.tags).map((t) => SHORT[t] || t));
  const regions = [...tags].filter((t) => REGIONS.includes(t));
  const disc = [...tags].find((t) => /^disc \d+$/.test(t));
  // Titles that match without turning Roman numerals into numbers ("Mega Man X", not "Mega Man 10").
  const plain = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const exact = new Set(want.map((w) => plain(w.title)));
  let found = [];
  for (const w of want) {
    const k = normTitle(w.title);
    if (k && index.has(k)) found = found.concat(index.get(k));
  }
  // "Title - Subtitle" when the game is just "Title", or the other way round.
  if (!found.length) {
    for (const w of want) {
      const short = normTitle(w.title.split(/\s+-\s+|:\s+/)[0]);
      if (short && short.length >= 4 && index.has(short)) found = found.concat(index.get(short));
    }
  }
  if (!found.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const n of new Set(found)) {
    const ct = split(n).tags.map((t) => SHORT[t] || t);
    let score = exact.has(plain(split(n).title)) ? 3 : 0;
    // TOSEC-style names ("(1985)(Nintendo)") and hacks/translations ("[h]", "[tr …]") last.
    if (/\(\d{4}[-)]/.test(n)) score -= 20;
    if (/\[(h|t|tr|b|a|f|o|p)\b/.test(n)) score -= 20;
    if (regions.length) score += ct.some((t) => regions.includes(t)) ? 12 : 0;
    else score += ct.includes('usa') ? 8 : ct.includes('world') ? 7 : ct.includes('europe') ? 4 : 0;
    if (disc) score += ct.includes(disc) ? 6 : ct.some((t) => /^disc \d+$/.test(t)) ? -2 : 0;
    for (const t of ct) {
      if (BAD.test(t) && !tags.has(t)) score -= 5;
      if (/^rev\b|^v\d/.test(t) && !tags.has(t)) score -= 1;
      if (tags.has(t)) score += 1;
    }
    score -= n.length / 200;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}

module.exports = { bestMatch, indexNames, normTitle, split };
