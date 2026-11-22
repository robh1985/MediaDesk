// Gift lists in the Family Organizer (Christmas, birthdays and lists of any occasion): who may see
// what, so surprises stay surprises; reading a store link for a gift's name, picture and price;
// and the share link that lets people outside the family see a list and mark a gift as taken.
//
// What stays hidden is decided here, on the server, not in the browser: the person a list is for
// only gets the things they added themselves (their wishes), without who's buying them, and
// gifts from Santa or for the stockings never reach anyone who isn't a parent.

'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { publicFetch, decode, IMAGE_TYPES, MAX_IMAGE } = require('./family-recipes');

const GIFT_KINDS = new Set(['christmas', 'birthday', 'gift']);
const isGift = (l) => Boolean(l && GIFT_KINDS.has(l.kind));
// On an item: only the people buying see these.
const BUYER_FIELDS = ['status', 'claimedBy', 'claimedName', 'claimedAt', 'claimKey', 'chips', 'secret', 'givenYear'];
// What changing counts as claiming (anyone allowed to claim may do it, even without edit rights).
const CLAIM_FIELDS = ['status', 'claimedBy', 'claimedName', 'claimedAt', 'chips', 'givenYear', 'done', 'doneAt'];
// On a list: only the people buying see these.
const BUYER_LIST_FIELDS = ['budget'];
const GIFT_PARTS = new Set([undefined, null, '', 'gift']);

class GiftError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// viewer: { parent, profile } — profile is the family member they are (null for MediaDesk itself
// or a parent account not linked to anyone).
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const inList = (arr, id) => Array.isArray(arr) && arr.includes(id);
const restricted = (arr) => Array.isArray(arr) && arr.length > 0;

function canSee(list, v) {
  if (!isGift(list) || !restricted(list.access?.see)) return true;
  if (!v.profile) return v.parent;
  return inList(list.access.see, v.profile) || list.owner === v.profile || list.recipient === v.profile;
}
function canEdit(list, v) {
  if (!isGift(list) || !restricted(list.access?.edit)) return true;
  if (!v.profile) return v.parent;
  return inList(list.access.edit, v.profile) || list.owner === v.profile;
}
function canClaim(list, v) {
  if (!isGift(list)) return true;
  if (isRecipient(list, v)) return false;
  if (!restricted(list.access?.claim)) return true;
  if (!v.profile) return v.parent;
  return inList(list.access.claim, v.profile) || list.owner === v.profile;
}
const isRecipient = (list, v) => Boolean(v.profile && list?.recipient === v.profile);

// May this viewer have this item at all?
function itemVisible(item, list, v) {
  if (!list) return true;
  if (!isGift(list)) return true;
  if (!canSee(list, v)) return false;
  if (item.secret && !v.parent) return false;
  if (isRecipient(list, v)) {
    if (GIFT_PARTS.has(item.part)) return item.addedBy === v.profile && !item.secret;
    // The party and thank-yous are theirs to see, unless the party is a surprise.
    return item.part === 'thanks' || !list.surprise;
  }
  return true;
}

function shapeItem(item, list, v) {
  if (!isGift(list) || !isRecipient(list, v)) return item;
  const out = { ...item };
  for (const k of BUYER_FIELDS) delete out[k];
  return out;
}
function shapeList(list, v) {
  if (!isGift(list)) return list;
  const out = { ...list };
  if (isRecipient(list, v)) for (const k of BUYER_LIST_FIELDS) delete out[k];
  // The share link's secret is only for those who may change the list.
  if (!canEdit(list, v)) delete out.shareToken;
  return out;
}

// The family's data as this viewer may have it.
function viewCollections(collections, v) {
  const lists = {};
  for (const [id, l] of Object.entries(collections.lists || {})) if (canSee(l, v)) lists[id] = shapeList(l, v);
  const listitems = {};
  for (const [id, i] of Object.entries(collections.listitems || {})) {
    const l = collections.lists?.[i.list];
    if (l && !lists[l.id]) continue;
    if (!itemVisible(i, l, v)) continue;
    listitems[id] = shapeItem(i, l, v);
  }
  return { ...collections, lists, listitems };
}

// What came back from a change, as this viewer may have it.
function viewResult(col, item, d, v) {
  if (!item || item.deleted) return item;
  if (col === 'lists') return canSee(item, v) ? shapeList(item, v) : { id: item.id, deleted: true };
  if (col === 'listitems') {
    const l = d.collections.lists[item.list];
    return itemVisible(item, l, v) ? shapeItem(item, l, v) : { id: item.id, deleted: true };
  }
  return item;
}

// Before a change is saved: who may do what with gift lists, and keeping what the person a list
// is for can't see as it was (they send their items back without it).
function guard(ops, who, d) {
  const v = { parent: Boolean(who.parent), profile: who.user?.profile || null };
  const listOf = (id) => d.collections.lists[id] || ops.find((o) => o.col === 'lists' && o.op === 'put' && o.item?.id === id)?.item || null;
  for (const op of ops) {
    if (op.col !== 'lists' && op.col !== 'listitems') continue;
    const id = op.op === 'delete' ? op.id : op.item?.id;
    const prev = id ? d.collections[op.col]?.[id] : null;
    if (op.col === 'lists') {
      if (prev && !canSee(prev, v)) throw new GiftError(404, 'That list is gone');
      if (prev && isGift(prev) && !canEdit(prev, v)) throw new GiftError(403, 'Only the people this list lets edit it can change it');
      if (op.op !== 'put') continue;
      const item = op.item;
      item.owner = prev ? prev.owner ?? null : v.profile;
      // Made by the server (the share link): never taken from the browser.
      if (prev?.shareToken) item.shareToken = prev.shareToken; else delete item.shareToken;
      if (prev && isRecipient(prev, v)) {
        for (const k of BUYER_LIST_FIELDS) { if (k in prev) item[k] = prev[k]; else delete item[k]; }
        // Who may see or claim their own list isn't theirs to change (unless they're a parent).
        if (!v.parent) item.access = prev.access;
      }
      continue;
    }
    // An item.
    const prevList = prev ? listOf(prev.list) : null;
    if (prev && !itemVisible(prev, prevList, v)) throw new GiftError(404, 'That item is gone');
    if (op.op === 'delete') {
      if (prevList && isGift(prevList) && !canEdit(prevList, v) && !(isRecipient(prevList, v) && prev.addedBy === v.profile)) throw new GiftError(403, 'Only the people this list lets edit it can take things off');
      continue;
    }
    const item = op.item;
    const list = listOf(item.list);
    if (!isGift(list) && !isGift(prevList)) continue;
    if (list && !canSee(list, v)) throw new GiftError(404, 'That list is gone');
    item.addedBy = prev ? prev.addedBy ?? null : v.profile;
    const recipient = isRecipient(list, v) || (prevList && isRecipient(prevList, v));
    if (recipient) {
      // What they can't see stays as it was.
      for (const k of BUYER_FIELDS) { if (prev && k in prev) item[k] = prev[k]; else delete item[k]; }
    } else {
      // Santa's and the stockings' gifts are for parents to mark.
      if (!v.parent) { if (prev?.secret) item.secret = prev.secret; else delete item.secret; }
      const claimChanged = CLAIM_FIELDS.some((k) => !same(item[k], prev?.[k]));
      if (claimChanged && !canClaim(list, v)) throw new GiftError(403, 'This list doesn’t let you claim gifts');
      // Taken through the share link: only that person (or a parent) gives it back.
      if (prev?.claimedName && !prev.claimedBy && !v.parent && (item.claimedName !== prev.claimedName)) throw new GiftError(403, `${prev.claimedName} is getting this one`);
      // Their own claim is someone's to give back: another family member can't take it over.
      if (prev?.claimedBy && item.claimedBy !== prev.claimedBy && !v.parent && prev.claimedBy !== v.profile) throw new GiftError(403, 'Someone else is already getting this');
    }
    const otherChanged = Object.keys({ ...item, ...(prev || {}) }).some((k) => !CLAIM_FIELDS.includes(k) && !['updated', 'created', 'addedBy', 'id'].includes(k) && !same(item[k], prev?.[k]));
    const ownWish = recipient && (!prev || prev.addedBy === v.profile);
    if (otherChanged && list && !canEdit(list, v) && !ownWish) throw new GiftError(403, 'Only the people this list lets edit it can change it');
  }
  return v;
}

// ---------------------------------------------------------------------------
// Store links: a gift's name, picture and price
// ---------------------------------------------------------------------------

const metaContent = (html, names) => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
    const tag = re.exec(html)?.[0];
    const c = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (c) return decode(c);
  }
  return '';
};

function findProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return null;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) { const r = walk(y); if (r) return r; } return null; }
    const types = [].concat(x['@type'] || []).map((t) => String(t).toLowerCase());
    if (types.includes('product') || types.includes('productgroup')) return x;
    for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item', 'hasVariant']) { const r = walk(x[k]); if (r) return r; }
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

const toPrice = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

// A readable name from the address itself (for stores that won't show their page to a server).
function nameFromUrl(raw) {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').map((s) => decodeURIComponent(s)).filter((s) => /[a-z]/i.test(s) && s.length > 3 && !/^(dp|gp|product|products|p|ip|item|itm|s|en|us|shop)$/i.test(s));
    const best = parts.filter((s) => /[-_+]/.test(s)).sort((a, b) => b.length - a.length)[0] || '';
    const text = best.replace(/\.(html?|aspx?|php)$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  } catch { return ''; }
}
const storeName = (raw) => { try { return new URL(raw).hostname.replace(/^(www|smile|m)\./, ''); } catch { return ''; } };

function cleanTitle(t, url) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*[^:]{2,40}$/, (m) => (/amazon\./i.test(url) ? '' : m));
  // "Thing | Store" and "Thing - Store": the store's name goes.
  const host = storeName(url).split('.')[0].toLowerCase();
  const bits = s.split(/\s+[|–—]\s+|\s+-\s+(?=[^-]{2,30}$)/);
  if (bits.length > 1 && bits[bits.length - 1].toLowerCase().replace(/\W/g, '').includes(host.replace(/\W/g, '').slice(0, 5))) bits.pop();
  return bits.join(' – ').slice(0, 200);
}

function parsePreview(html, url) {
  const p = findProduct(html) || {};
  const offers = [].concat(p.offers || []).flatMap((o) => [o, ...[].concat(o?.offers || [])]).filter(Boolean);
  const price = toPrice(offers.map((o) => o.price ?? o.lowPrice ?? o.priceSpecification?.price).find((x) => x != null))
    ?? toPrice(metaContent(html, ['product:price:amount', 'og:price:amount', 'price', 'twitter:data1']))
    ?? toPrice(/itemprop=["']price["'][^>]*content=["']([^"']+)/i.exec(html)?.[1]);
  const currency = offers.map((o) => o.priceCurrency).find(Boolean) || metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']) || '';
  const img = [].concat(p.image || []).map((x) => (typeof x === 'string' ? x : x?.url || x?.contentUrl)).find(Boolean)
    || metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const title = decode(p.name || '') || metaContent(html, ['og:title', 'twitter:title']) || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const brand = decode(typeof p.brand === 'string' ? p.brand : p.brand?.name || '');
  return { title: cleanTitle(title, url) || nameFromUrl(url), price, currency: String(currency).slice(0, 3).toUpperCase(), image: img ? new URL(img, url).toString() : '', brand };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

function createGifts({ load, persist, recipes, mock = false }) {
  // Share-link claims, per address: a few a minute.
  const tries = new Map();
  const tooMany = (ip) => {
    const now = Date.now();
    const t = (tries.get(ip) || []).filter((x) => now - x < 60e3);
    t.push(now);
    tries.set(ip, t);
    if (tries.size > 5000) tries.clear();
    return t.length > 20;
  };

  async function preview(raw) {
    const url = String(raw || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new GiftError(400, 'Paste a web address that starts with http:// or https://');
    const fallback = (why) => ({ url, title: nameFromUrl(url), price: null, image: null, store: storeName(url), partial: true, note: why });
    if (mock) return { url, title: nameFromUrl(url) || 'Demo gift', price: 24.99, image: null, store: storeName(url), partial: true, note: 'The demo doesn’t read websites' };
    let page;
    try { page = await publicFetch(url); } catch (err) {
      // Big stores often turn servers away: the address still tells us something.
      return fallback(err.status === 400 ? err.message : 'The store didn’t show its page to MediaDesk, so only the name from the address was filled in');
    }
    const info = parsePreview(page.buf.toString('utf8'), page.url);
    let image = null;
    if (info.image) {
      try {
        const got = await publicFetch(info.image, { accept: 'image/*', limit: MAX_IMAGE });
        image = await recipes.saveImage('gift', got.buf);
      } catch { /* no picture then */ }
    }
    const partial = !info.price || !image;
    return { url: page.url, title: info.title || nameFromUrl(url), price: info.price, currency: info.currency, brand: info.brand, image, store: storeName(page.url), partial, note: partial ? 'Some details weren’t on the store’s page — fill in the rest' : '' };
  }

  // Turn a list's share link on (a new secret each time) or off.
  async function setShare(listId, on, v) {
    const d = load();
    const l = d.collections.lists[listId];
    if (!l || !isGift(l) || !canSee(l, v)) throw new GiftError(404, 'That list is gone');
    if (!canEdit(l, v)) throw new GiftError(403, 'Only the people this list lets edit it can share it');
    if (on) l.shareToken = crypto.randomBytes(18).toString('base64url'); else delete l.shareToken;
    l.updated = Date.now();
    d.rev++;
    await persist();
    return { rev: d.rev, list: shapeList(l, v) };
  }

  // --- The share page (no sign-in) ---------------------------------------------------

  const findShared = (token) => {
    const d = load();
    if (!/^[\w-]{20,}$/.test(token)) return null;
    return Object.values(d.collections.lists).find((l) => isGift(l) && l.shareToken && l.shareToken.length === token.length && crypto.timingSafeEqual(Buffer.from(l.shareToken), Buffer.from(token)) && !l.archived) || null;
  };
  const hashKey = (k) => crypto.createHash('sha256').update(String(k || '')).digest('base64url').slice(0, 32);
  const sharedItems = (l) => Object.values(load().collections.listitems).filter((i) => i.list === l.id && GIFT_PARTS.has(i.part) && !i.secret && i.status !== 'given');

  function sharedView(l, key) {
    const d = load();
    const m = l.recipient ? d.collections.members[l.recipient] : null;
    const mine = key ? hashKey(key) : null;
    return {
      title: l.title, emoji: l.emoji || '🎁', color: l.color || '#d6336c', kind: l.kind,
      forName: m?.name || l.recipientName || '', date: l.date || null, family: d.settings.familyName || '',
      note: l.shareNote || '', claims: l.shareClaims !== false, currency: d.settings.currency || 'USD',
      fields: (l.fields || []).map((f) => ({ id: f.id, label: f.label, type: f.type })),
      items: sharedItems(l).sort((a, b) => (b.mostWanted ? 1 : 0) - (a.mostWanted ? 1 : 0) || (b.stars || 0) - (a.stars || 0) || (a.order ?? 0) - (b.order ?? 0)).map((i) => ({
        id: i.id, text: i.text, url: /^https?:\/\//i.test(i.url || '') ? i.url : null, price: i.price ?? null, stars: i.stars || 0, mostWanted: Boolean(i.mostWanted), notes: i.notes || '',
        image: i.image ? `/gift-share/${l.shareToken}/image/${encodeURIComponent(i.image)}` : null, values: i.values || {},
        taken: Boolean(i.claimedBy || i.claimedName || ['bought', 'wrapped', 'given'].includes(i.status)), mine: Boolean(mine && i.claimKey === mine),
      })),
    };
  }

  async function publicHandle(req, res, url, { sendJson, readJson, ip = '' }) {
    const p = url.pathname;
    try {
      let m = /^\/gift-share\/([\w-]{20,})\/data$/.exec(p);
      if (m && req.method === 'GET') {
        const l = findShared(m[1]);
        if (!l) return sendJson(res, 404, { error: 'This list isn’t shared any more' });
        return sendJson(res, 200, sharedView(l, url.searchParams.get('key')));
      }
      m = /^\/gift-share\/([\w-]{20,})\/image\/([^/]+)$/.exec(p);
      if (m && req.method === 'GET') {
        const l = findShared(m[1]);
        const name = path.basename(decodeURIComponent(m[2]));
        if (!l || !sharedItems(l).some((i) => i.image === name)) return sendJson(res, 404, { error: 'Not found' });
        const type = IMAGE_TYPES[path.extname(name).slice(1)];
        try {
          const buf = await fsp.readFile(recipes.imageFile(name));
          res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
          return res.end(buf);
        } catch { return sendJson(res, 404, { error: 'That picture is gone' }); }
      }
      m = /^\/gift-share\/([\w-]{20,})\/(claim|unclaim)$/.exec(p);
      if (m && req.method === 'POST') {
        if (!/application\/json/i.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'Send JSON' });
        if (tooMany(ip)) return sendJson(res, 429, { error: 'Too many tries — wait a minute and try again' });
        const l = findShared(m[1]);
        if (!l) return sendJson(res, 404, { error: 'This list isn’t shared any more' });
        if (l.shareClaims === false) return sendJson(res, 403, { error: 'This list doesn’t take claims' });
        const body = await readJson(req);
        const key = String(body.key || '');
        if (key.length < 16) return sendJson(res, 400, { error: 'Reload the page and try again' });
        const d = load();
        const i = d.collections.listitems[String(body.item || '')];
        if (!i || i.list !== l.id || !sharedItems(l).some((x) => x.id === i.id)) return sendJson(res, 404, { error: 'That gift is gone' });
        if (m[2] === 'claim') {
          const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (!name) return sendJson(res, 400, { error: 'Add your name, so the family knows who’s getting it' });
          if (i.claimedBy || i.claimedName || ['bought', 'wrapped', 'given'].includes(i.status)) return sendJson(res, 409, { error: 'Someone is already getting that one' });
          Object.assign(i, { claimedName: name, claimKey: hashKey(key), claimedAt: Date.now(), status: 'bought', updated: Date.now() });
        } else {
          if (!i.claimKey || i.claimKey !== hashKey(key)) return sendJson(res, 403, { error: 'Only whoever took it can give it back' });
          for (const k of ['claimedName', 'claimKey', 'claimedAt']) delete i[k];
          i.status = 'idea';
          i.updated = Date.now();
        }
        d.rev++;
        await persist();
        return sendJson(res, 200, sharedView(l, key));
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'That request wasn’t understood' });
      return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong' });
    }
  }

  return { preview, setShare, publicHandle };
}

module.exports = { createGifts, guard, viewCollections, viewResult, parsePreview, nameFromUrl, isGift, canSee, canEdit, canClaim, itemVisible, GiftError };
