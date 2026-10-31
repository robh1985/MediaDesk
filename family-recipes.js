// Family Organizer recipes, in the spirit of Mealie: recipe photos, importing a recipe from any
// website (from the schema.org data recipe sites publish), and keeping the recipe box in step with
// a self-hosted Mealie server (recipes, photos, changes and deletions, on a schedule).
//
// Mealie's address and API token stay on this server; the browser only sees whether it's set up.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { sniff } = require('./wallpapers');

const UA = 'MediaDesk/1.0 (self-hosted; Family Organizer recipe box)';
const IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
const MAX_PAGE = 4 * 1024 * 1024;
const MAX_IMAGE = 15 * 1024 * 1024;
const INTERVALS = [0, 15, 60, 360, 1440]; // minutes between automatic Mealie imports (0: only when asked)

class RecipeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è' };
function decode(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ').trim();
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const names = (v) => list(v).map((x) => decode(typeof x === 'string' ? x : x?.name || x?.text || '')).filter(Boolean);

// "PT1H30M", "1 hour 30 minutes", "1h 30m", "45 min", "1:30", "90" → minutes.
function minutes(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?$/i.exec(s);
  if (iso) { const m = (+(iso[1] || 0)) * 1440 + (+(iso[2] || 0)) * 60 + (+(iso[3] || 0)) + Math.round((+(iso[4] || 0)) / 60); return m || null; }
  const clock = /^(\d+):(\d{2})$/.exec(s);
  if (clock) return +clock[1] * 60 + +clock[2] || null;
  let m = 0;
  let found = false;
  for (const [, n, unit] of s.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)\b/g)) {
    found = true;
    const x = Number(n.replace(',', '.'));
    m += unit.startsWith('d') ? x * 1440 : unit.startsWith('h') ? x * 60 : x;
  }
  if (found) return Math.round(m) || null;
  return /^\d+$/.test(s) ? Number(s) || null : null;
}

// 0.5 → "½", 1.25 → "1 ¼", 0.333 → "⅓"
const FRACTIONS = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];
function quantity(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 0.04) return String(whole);
  const near = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.04);
  if (near) return whole ? `${whole} ${near[1]}` : near[1];
  return String(Math.round(n * 100) / 100);
}

const NUTRITION = {
  calories: 'Calories', fatContent: 'Fat', saturatedFatContent: 'Saturated fat', transFatContent: 'Trans fat', cholesterolContent: 'Cholesterol', sodiumContent: 'Sodium',
  carbohydrateContent: 'Carbohydrates', fiberContent: 'Fibre', sugarContent: 'Sugar', proteinContent: 'Protein', unsaturatedFatContent: 'Unsaturated fat',
};
function nutrition(n) {
  const out = {};
  for (const [k, label] of Object.entries(NUTRITION)) {
    const v = n?.[k];
    if (v != null && String(v).trim() && String(v).trim() !== '0') out[label] = decode(v);
  }
  return Object.keys(out).length ? out : null;
}

// A recipe as the recipe box keeps it. Ingredient and step lines starting "# " are section titles.
function shape(r) {
  const prep = minutes(r.prepTime);
  const cook = minutes(r.cookTime);
  const total = minutes(r.totalTime) || (prep || cook ? (prep || 0) + (cook || 0) : null);
  const yieldText = names(r.recipeYield).find((y) => /\D/.test(y)) || names(r.recipeYield)[0] || '';
  // "4", "4 servings", "Serves 6" are servings; "1 loaf" or "24 cookies" aren't.
  const yields = list(r.recipeYield).map((y) => String(y));
  const serves = yields.map((y) => /^\s*(\d+)\s*$/.exec(y) || /(\d+)\s*(?:servings?|people|persons|portions?)/i.exec(y) || /serves\s*(\d+)/i.exec(y)).find(Boolean);
  const servings = Number(r.recipeServings) || Number(serves?.[1]) || null;
  return {
    title: decode(r.name).slice(0, 200) || 'Recipe',
    description: decode(r.description).slice(0, 3000),
    ingredients: r.ingredients,
    steps: r.steps,
    prepMin: prep, cookMin: cook, minutes: total,
    servings, yield: yieldText.slice(0, 80),
    categories: [...new Set(names(r.recipeCategory))].slice(0, 20),
    tags: [...new Set([...names(r.keywords?.split ? r.keywords.split(',') : r.keywords), ...names(r.recipeCuisine)].map((t) => t.trim()).filter(Boolean))].slice(0, 30),
    tools: [...new Set(names(r.tool))].slice(0, 20),
    nutrition: nutrition(r.nutrition),
    notes: r.notes || '',
  };
}

// Instructions in their many schema.org shapes: a string, strings, HowToSteps, HowToSections.
function stepLines(v) {
  const out = [];
  const add = (x) => {
    if (!x) return;
    if (typeof x === 'string') { for (const line of decode(x).split(/\n+/)) if (line.trim()) out.push(line.trim()); return; }
    const type = list(x['@type']).join(' ');
    if (/HowToSection/i.test(type)) {
      if (x.name) out.push(`# ${decode(x.name)}`);
      for (const y of list(x.itemListElement)) add(y);
      return;
    }
    const t = decode(x.text || x.description || x.name || '');
    if (t) out.push(t.replace(/\s*\n+\s*/g, ' '));
  };
  for (const x of list(v)) add(x);
  return out;
}

// ---------------------------------------------------------------------------
// Importing from a website
// ---------------------------------------------------------------------------

// Only addresses on the public internet: a recipe link mustn't reach into the home network.
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}
async function publicFetch(raw, { accept = 'text/html,application/xhtml+xml', limit = MAX_PAGE } = {}) {
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    let u;
    try { u = new URL(url); } catch { throw new RecipeError(400, 'That isn’t a web address'); }
    if (!/^https?:$/.test(u.protocol)) throw new RecipeError(400, 'Use an http:// or https:// address');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new RecipeError(400, `Couldn’t find ${host}`); });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new RecipeError(400, 'Only public websites can be imported from');
    const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(20e3) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).toString(); continue; }
    if (!res.ok) throw new RecipeError(502, `The website answered ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > limit) throw new RecipeError(413, 'That page is too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > limit) throw new RecipeError(413, 'That page is too large');
    return { buf, url: u.toString(), type: res.headers.get('content-type') || '' };
  }
  throw new RecipeError(502, 'Too many redirects');
}

// The schema.org Recipe in a page's JSON-LD (wherever it's tucked away).
function findRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return null;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) { const r = walk(y); if (r) return r; } return null; }
    if (list(x['@type']).some((t) => String(t).toLowerCase() === 'recipe')) return x;
    for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const r = walk(x[k]); if (r) return r; }
    return null;
  };
  for (const b of blocks) {
    let j;
    try { j = JSON.parse(b.trim().replace(/^<!--|-->$/g, '')); } catch { try { j = JSON.parse(b.replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; } }
    const r = walk(j);
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mealie
// ---------------------------------------------------------------------------

function fromMealie(m) {
  const ingredients = [];
  for (const i of m.recipeIngredient || []) {
    if (i.title) ingredients.push(`# ${decode(i.title)}`);
    let line = decode(i.display || '');
    if (!line) {
      const unit = i.unit && (i.quantity > 1 ? i.unit.pluralName || i.unit.name : i.unit.name);
      const food = i.food && (i.quantity > 1 ? i.food.pluralName || i.food.name : i.food.name);
      line = [quantity(i.quantity), unit, food].filter(Boolean).join(' ');
      if (i.note) line = line ? `${line}, ${decode(i.note)}` : decode(i.note);
    }
    if (!line) line = decode(i.originalText || '');
    if (line) ingredients.push(line);
  }
  const steps = [];
  for (const s of m.recipeInstructions || []) {
    if (s.title) steps.push(`# ${decode(s.title)}`);
    const t = decode(s.text || '').replace(/\s*\n+\s*/g, ' ');
    if (t) steps.push(t);
  }
  const shaped = shape({
    name: m.name, description: m.description, recipeYield: m.recipeYield, recipeServings: m.recipeServings,
    prepTime: m.prepTime, cookTime: m.performTime || m.cookTime, totalTime: m.totalTime,
    recipeCategory: m.recipeCategory, keywords: names(m.tags), tool: m.tools, nutrition: m.nutrition,
    ingredients, steps: steps.join('\n'),
    notes: (m.notes || []).map((n) => [decode(n.title), decode(n.text)].filter(Boolean).join(': ')).join('\n'),
  });
  return { ...shaped, rating: Number(m.rating) || null, url: m.orgURL || null };
}

// ---------------------------------------------------------------------------

function createRecipes({ dataDir, load, persist, mock = false, log = console.log }) {
  const imgDir = path.join(dataDir, 'family', 'recipe-images');
  let syncing = null;

  function mealieCfg() {
    const d = load();
    d.integrations ||= {};
    return d.integrations.mealie || null;
  }
  const publicStatus = () => {
    const m = mealieCfg();
    if (!m) return { configured: false };
    return { configured: true, url: m.url, interval: m.interval ?? 60, lastSync: m.lastSync || null, count: m.count || 0, error: m.error || null, running: Boolean(syncing), last: m.last || null };
  };

  async function mealie(m, p, { raw = false } = {}) {
    const res = await fetch(`${m.url}${p}`, { headers: { Authorization: `Bearer ${m.token}`, Accept: raw ? '*/*' : 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(30e3) });
    if (res.status === 401 || res.status === 403) throw new RecipeError(400, 'Mealie didn’t accept the API token');
    if (!res.ok) throw new RecipeError(502, `Mealie answered ${res.status} for ${p.split('?')[0]}`);
    return raw ? res : res.json();
  }

  async function saveImage(id, buf) {
    const type = sniff(buf);
    if (!IMAGE_TYPES[type]) throw new RecipeError(415, 'That isn’t a picture (use JPEG, PNG, WebP, GIF or AVIF)');
    await fsp.mkdir(imgDir, { recursive: true });
    const name = `${String(id).replace(/[^\w-]/g, '').slice(0, 80)}-${crypto.randomBytes(4).toString('hex')}.${type}`;
    await fsp.writeFile(path.join(imgDir, name), buf);
    return name;
  }
  const dropImage = (name) => (name ? fsp.rm(path.join(imgDir, path.basename(name)), { force: true }).catch(() => {}) : null);

  // Bring the recipe box in step with Mealie: new and changed recipes (with their photos) come
  // in, and recipes deleted in Mealie go. Recipes made here are never touched.
  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const m = mealieCfg();
      if (!m) throw new RecipeError(400, 'Mealie isn’t set up');
      const d = load();
      const recipes = d.collections.recipes;
      const counts = { added: 0, updated: 0, removed: 0 };
      try {
        // Where recipes are shown in Mealie: /g/<group>/r/<slug> (version 2), /recipe/<slug> (1).
        let link = `${m.url}/recipe/`;
        try { const self = await mealie(m, '/api/users/self'); if (self.groupSlug) link = `${m.url}/g/${self.groupSlug}/r/`; } catch (err) { if (err.status === 400) throw err; }
        const summaries = [];
        for (let page = 1; page < 500; page++) {
          const r = await mealie(m, `/api/recipes?page=${page}&perPage=100&orderBy=name&orderDirection=asc`);
          summaries.push(...(r.items || []));
          const pages = r.total_pages ?? r.totalPages ?? 1;
          if (page >= pages || !(r.items || []).length) break;
        }
        const keep = new Set();
        const queue = [...summaries];
        const work = async () => {
          for (let s = queue.shift(); s; s = queue.shift()) {
            const id = `mealie-${s.id}`;
            keep.add(id);
            const stamp = String(s.updatedAt || s.dateUpdated || s.updateAt || s.date_updated || '');
            const prev = recipes[id];
            if (prev && prev.mealieUpdated === stamp && stamp) continue;
            const full = await mealie(m, `/api/recipes/${encodeURIComponent(s.slug)}`);
            let image = prev?.image || null;
            if (full.image) {
              for (const file of ['min-original.webp', 'original.webp']) {
                try {
                  const res = await mealie(m, `/api/media/recipes/${full.id}/images/${file}`, { raw: true });
                  const buf = Buffer.from(await res.arrayBuffer());
                  if (buf.length && buf.length < MAX_IMAGE && sniff(buf)) { const name = await saveImage(id, buf); if (image && image !== name) dropImage(image); image = name; break; }
                } catch { /* try the other size */ }
              }
            }
            const fresh = fromMealie(full);
            if (prev?.rating) fresh.rating = prev.rating; // a rating given here stays
            recipes[id] = {
              ...(prev || { created: Date.now(), emoji: '🍲' }),
              ...fresh,
              id, image, source: 'mealie', mealieId: full.id, mealieSlug: full.slug, mealieLink: `${link}${full.slug}`, mealieUpdated: stamp, updated: Date.now(),
            };
            if (prev) counts.updated++; else counts.added++;
          }
        };
        await Promise.all([work(), work(), work(), work()]);
        for (const r of Object.values(recipes)) {
          if (r.source === 'mealie' && !keep.has(r.id)) { delete recipes[r.id]; dropImage(r.image); counts.removed++; }
        }
        Object.assign(m, { lastSync: Date.now(), count: keep.size, error: null, last: counts });
        log(`Family Organizer: Mealie import — ${keep.size} recipes (${counts.added} new, ${counts.updated} changed, ${counts.removed} removed)`);
      } catch (err) {
        Object.assign(m, { lastSync: Date.now(), error: err.name === 'TimeoutError' ? 'Mealie took too long to answer' : err.cause?.code === 'ECONNREFUSED' ? `Couldn’t reach Mealie at ${m.url}` : err.message });
        throw err;
      } finally {
        d.rev++;
        await persist();
      }
      return counts;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // Automatic imports, on the schedule chosen in Settings.
  const timer = setInterval(() => {
    const m = mealieCfg();
    if (!m || !m.interval || syncing) return;
    if (Date.now() - (m.lastSync || 0) >= m.interval * 60e3) sync().catch(() => {});
  }, 60e3);
  timer.unref?.();

  async function handle(req, res, p, { sendJson, readJson, readBody, parent }) {
    const needParent = () => { if (!parent) throw new RecipeError(403, 'Only a parent can change the Mealie connection'); };
    if (p === '/mealie' && req.method === 'GET') return sendJson(res, 200, publicStatus());
    if (p === '/mealie' && req.method === 'POST') {
      needParent();
      const body = await readJson(req);
      const d = load();
      d.integrations ||= {};
      const prev = d.integrations.mealie || {};
      let url = String(body.url ?? prev.url ?? '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(url)) url = url ? `http://${url}` : '';
      try { url = new URL(url).toString().replace(/\/+$/, ''); } catch { throw new RecipeError(400, 'Enter Mealie’s address, like http://192.168.1.20:9000'); }
      const token = String(body.token || '').trim() || prev.token;
      if (!token) throw new RecipeError(400, 'Enter an API token from Mealie (your profile → API Tokens)');
      const interval = INTERVALS.includes(Number(body.interval)) ? Number(body.interval) : prev.interval ?? 60;
      const next = { ...prev, url, token, interval };
      // Check it works before keeping it.
      try { await mealie(next, '/api/recipes?page=1&perPage=1'); } catch (err) {
        throw new RecipeError(400, err.status === 400 ? err.message : `Couldn’t reach Mealie at ${url} (${err.cause?.code || err.message})`);
      }
      d.integrations.mealie = next;
      d.rev++;
      await persist();
      sync().catch(() => {});
      return sendJson(res, 200, publicStatus());
    }
    if (p === '/mealie' && req.method === 'DELETE') {
      needParent();
      const d = load();
      const removeRecipes = new URL(req.url, 'http://x').searchParams.get('recipes') === 'remove';
      if (d.integrations) delete d.integrations.mealie;
      let removed = 0;
      for (const r of Object.values(d.collections.recipes)) {
        if (r.source !== 'mealie') continue;
        if (removeRecipes) { delete d.collections.recipes[r.id]; dropImage(r.image); removed++; } else r.source = 'mealie-copy'; // kept: now the family's own
      }
      d.rev++;
      await persist();
      return sendJson(res, 200, { configured: false, removed });
    }
    if (p === '/mealie/sync' && req.method === 'POST') {
      needParent();
      const counts = await sync();
      return sendJson(res, 200, { ...publicStatus(), counts });
    }
    if (p === '/recipes/import-url' && req.method === 'POST') {
      const body = await readJson(req);
      const page = await publicFetch(String(body.url || '').trim());
      const r = findRecipe(page.buf.toString('utf8'));
      if (!r) throw new RecipeError(422, 'No recipe was found on that page (it needs the recipe details recipe sites usually include)');
      const draft = { ...shape({ ...r, ingredients: names(r.recipeIngredient || r.ingredients).map((x) => x.replace(/\s+/g, ' ')), steps: stepLines(r.recipeInstructions).join('\n') }), url: page.url };
      const img = list(r.image).map((x) => (typeof x === 'string' ? x : x?.url || x?.contentUrl)).find(Boolean);
      if (img) {
        try {
          const got = await publicFetch(new URL(img, page.url).toString(), { accept: 'image/*', limit: MAX_IMAGE });
          draft.image = await saveImage('web', got.buf);
        } catch { /* no picture then */ }
      }
      return sendJson(res, 200, { recipe: draft });
    }
    if (p === '/recipes/image' && req.method === 'POST') {
      const buf = await readBody(req, MAX_IMAGE).catch(() => { throw new RecipeError(413, 'Pictures can be up to 15 MB'); });
      return sendJson(res, 200, { image: await saveImage('own', buf) });
    }
    if (p.startsWith('/recipes/image/') && req.method === 'GET') {
      const name = path.basename(decodeURIComponent(p.slice('/recipes/image/'.length)));
      const type = IMAGE_TYPES[path.extname(name).slice(1)];
      if (!type) return sendJson(res, 404, { error: 'Not found' });
      try {
        const buf = await fsp.readFile(path.join(imgDir, name));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
        return res.end(buf);
      } catch { return sendJson(res, 404, { error: 'That picture is gone' }); }
    }
    return null;
  }

  return { handle, sync, dropImage };
}

module.exports = { createRecipes, findRecipe, fromMealie, minutes, shape, stepLines, quantity, RecipeError };
