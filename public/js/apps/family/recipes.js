// The recipe box, in the spirit of Mealie: photos, descriptions, prep and cook times, servings that
// scale the ingredients, ingredient and step sections, notes, nutrition, categories, tags and tools,
// ratings and favourites, searching and filtering, importing from any recipe website, a cook mode
// (one step at a time, timers, the screen kept on), printing, and recipes kept in step with Mealie.
//
// Ingredient and step lines starting "# " are section titles.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, fmtDate } from './dates.js';
import { sheet, field, input, select, emojiButton, parentGate, ICONS } from './shared.js';

// --- Amounts ------------------------------------------------------------------------------

const VULGAR = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])';
const LEAD = new RegExp(`^(\\s*)(${NUM})(\\s*(?:-|–|to)\\s*(${NUM}))?`);
function parseNum(s) {
  const t = s.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return +m[1] + +m[2] / +m[3];
  m = /^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/.exec(t);
  if (m) return +m[1] + VULGAR[m[2]];
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return +m[1] / +m[2];
  if (VULGAR[t]) return VULGAR[t];
  return Number(t.replace(',', '.'));
}
const FRACTIONS = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];
export function fmtAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 0.04) return String(whole);
  if (whole < 10) {
    const near = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.04);
    if (near) return whole ? `${whole} ${near[1]}` : near[1];
  }
  return String(Math.round(n * 10) / 10);
}
// "1 ½ cups flour" × 2 → "3 cups flour"; "2-3 cloves" × 2 → "4–6 cloves".
export function scaleLine(line, factor) {
  if (factor === 1 || /^#\s/.test(line)) return line;
  const m = LEAD.exec(line);
  if (!m) return line;
  const a = parseNum(m[2]) * factor;
  const b = m[4] ? parseNum(m[4]) * factor : null;
  return `${m[1]}${fmtAmount(a)}${b ? `–${fmtAmount(b)}` : ''}${line.slice(m[0].length)}`;
}

const isSection = (line) => /^#\s+/.test(line);
const sectionTitle = (line) => line.replace(/^#\s+/, '');
const stepList = (r) => String(r.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
const fmtMins = (m) => (!m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const splitList = (v) => String(v || '').split(',').map((t) => t.trim()).filter(Boolean);

// --- The recipe box -------------------------------------------------------------------------

export class RecipeBox {
  constructor(meals) {
    this.meals = meals; // the Meals view: the meal plan and groceries
    this.app = meals.app;
    this.store = meals.store;
    this.q = '';
    this.filters = { category: '', tag: '', tool: '', fav: false, source: '' };
    this.sort = 'name';
    this.mealie = null;
  }

  img(r) { return this.store.recipeImageUrl(r); }
  // Parents, and MediaDesk itself (behind the parent PIN).
  canManage() { return Boolean(this.app.session?.parent); }

  render(body) {
    const all = this.store.all('recipes');
    const values = (key) => [...new Set(all.flatMap((r) => r[key] || []))].sort((a, b) => a.localeCompare(b));
    const q = input({ type: 'search', placeholder: 'Search recipes, ingredients, tags…', value: this.q, class: 'fam-input fam-recipe-search' });
    const pick = (key, label, opts) => (opts.length ? select([['', label], ...opts.map((o) => [o, o])], this.filters[key], { class: 'fam-input fam-recipe-filter', onchange: (e) => { this.filters[key] = e.target.value; draw(); } }) : null);
    const fromMealie = all.some((r) => r.source === 'mealie');
    const filters = h('div', { class: 'fam-recipe-filters' }, q,
      h('button', { class: `fam-chip ${this.filters.fav ? 'on' : ''}`, onclick: (e) => { this.filters.fav = !this.filters.fav; e.currentTarget.classList.toggle('on', this.filters.fav); draw(); } }, '♥ Favourites'),
      pick('category', 'All categories', values('categories')), pick('tag', 'All tags', values('tags')), pick('tool', 'All tools', values('tools')),
      fromMealie ? select([['', 'All recipes'], ['mealie', 'From Mealie'], ['ours', 'Made here']], this.filters.source, { class: 'fam-input fam-recipe-filter', onchange: (e) => { this.filters.source = e.target.value; draw(); } }) : null,
      select([['name', 'A–Z'], ['new', 'Newest'], ['rating', 'Top rated'], ['quick', 'Quickest'], ['made', 'Recently made']], this.sort, { class: 'fam-input fam-recipe-filter', onchange: (e) => { this.sort = e.target.value; draw(); } }));
    const status = h('div', { class: 'fam-mealie-status' });
    const grid = h('div', { class: 'fam-recipes' });
    const draw = () => {
      const term = this.q.toLowerCase();
      const f = this.filters;
      let list = all.filter((r) => (!term || [r.title, r.description, ...(r.ingredients || []), ...(r.tags || []), ...(r.categories || [])].join(' ').toLowerCase().includes(term))
        && (!f.category || (r.categories || []).includes(f.category)) && (!f.tag || (r.tags || []).includes(f.tag)) && (!f.tool || (r.tools || []).includes(f.tool))
        && (!f.fav || r.favorite) && (!f.source || (f.source === 'mealie' ? r.source === 'mealie' : r.source !== 'mealie')));
      const by = {
        name: (a, b) => a.title.localeCompare(b.title),
        new: (a, b) => (b.created || 0) - (a.created || 0),
        rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title),
        quick: (a, b) => (a.minutes || 9999) - (b.minutes || 9999),
        made: (a, b) => String(b.lastMade || '').localeCompare(String(a.lastMade || '')),
      };
      list = list.sort(by[this.sort] || by.name);
      clear(grid, list.length ? list.map((r) => this.card(r))
        : h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '📖'), all.length ? 'No recipes match.' : 'Keep the family’s recipes here: type them in, import them from a recipe website, or connect Mealie in Settings → General.'));
    };
    q.addEventListener('input', () => { this.q = q.value; draw(); });
    draw();
    clear(body, filters, status, grid);
    this.drawStatus(status);
  }

  card(r) {
    const src = this.img(r);
    return h('button', { class: 'fam-recipe', onclick: () => this.show(r) },
      h('div', { class: 'fam-recipe-cover' }, src ? h('img', { src, alt: '', loading: 'lazy' }) : h('span', { class: 'fam-recipe-emoji' }, r.emoji || '🍲'),
        r.favorite ? h('span', { class: 'fam-recipe-fav', title: 'Favourite' }, '♥') : null,
        r.source === 'mealie' ? h('span', { class: 'fam-recipe-src' }, 'Mealie') : null),
      h('div', { class: 'fam-recipe-info' },
        h('b', {}, r.title),
        h('small', {}, [fmtMins(r.minutes), r.servings ? `Serves ${r.servings}` : null].filter(Boolean).join(' · ')),
        r.rating ? h('span', { class: 'fam-stars-row', title: `${r.rating} out of 5` }, '★'.repeat(Math.round(r.rating)), h('i', {}, '★'.repeat(5 - Math.round(r.rating)))) : null));
  }

  // Mealie: how many recipes came from it, when, and (for parents) importing now.
  async drawStatus(el) {
    try { this.mealie = await this.store.mealieStatus(); } catch { this.mealie = null; }
    const m = this.mealie;
    if (!m?.configured || !el.isConnected) return;
    const when = m.lastSync ? new Date(m.lastSync).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
    clear(el, h('span', { class: 'fam-mealie-badge' }, '🍳 Mealie'),
      h('span', { class: m.error ? 'fam-error' : 'fam-muted' }, m.error ? `Import failed: ${m.error}` : `${m.count} recipe${m.count === 1 ? '' : 's'} · imported ${when}${m.interval ? '' : ' · imports only when asked'}`),
      this.canManage() ? h('button', { class: 'fam-btn small', onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await parentGate(this.app.root, this.store, 'Importing from Mealie needs a parent'))) return;
        btn.disabled = true; btn.textContent = 'Importing…';
        try {
          const r = await this.store.mealieSync();
          toast('Mealie recipes imported', { type: 'success', body: `${r.counts.added} new, ${r.counts.updated} changed, ${r.counts.removed} removed` });
        } catch (err) { toastError(err, 'Couldn’t import from Mealie'); }
        this.meals.render(this.meals.el);
      } }, 'Import now') : null);
  }

  // --- Viewing ---------------------------------------------------------------------------

  async show(r0) {
    const r = this.store.get('recipes', r0.id) || r0;
    let factor = 1;
    const base = r.servings || null;
    const ingList = h('ul', { class: 'fam-ingredients' });
    const servingsEl = h('b', {});
    const drawIngredients = () => {
      servingsEl.textContent = base ? fmtAmount(base * factor) : `×${fmtAmount(factor)}`;
      clear(ingList, (r.ingredients || []).map((line) => (isSection(line) ? h('li', { class: 'fam-ing-section' }, sectionTitle(line))
        : h('li', {}, h('label', {}, h('input', { type: 'checkbox' }), h('span', {}, scaleLine(line, factor)))))));
    };
    const scale = (d) => {
      factor = base ? Math.max(1, base * factor + d) / base : Math.max(0.5, factor + d * 0.5);
      drawIngredients();
    };
    drawIngredients();
    let n = 0;
    const steps = stepList(r).map((s) => (isSection(s) ? h('li', { class: 'fam-step-section' }, sectionTitle(s)) : h('li', { class: 'fam-step', dataset: { n: ++n } }, h('span', {}, s))));
    const rating = h('span', { class: 'fam-rate' });
    const drawRating = (val) => clear(rating, [1, 2, 3, 4, 5].map((i) => h('button', { type: 'button', class: i <= (val || 0) ? 'on' : '', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, onclick: () => save({ rating: i === val ? null : i }).then(() => drawRating(i === val ? null : i)) }, '★')));
    const save = (patch) => this.store.put('recipes', { ...this.store.get('recipes', r.id), ...patch }).catch((err) => toastError(err));
    drawRating(r.rating);
    const fav = h('button', { type: 'button', class: `fam-fav-btn ${r.favorite ? 'on' : ''}`, title: 'Favourite', onclick: (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); save({ favorite: on }); } }, '♥');
    const meta = [['Prep', fmtMins(r.prepMin)], ['Cook', fmtMins(r.cookMin)], ['Total', fmtMins(r.minutes)], ['Makes', r.yield && r.yield !== String(r.servings) ? r.yield : '']].filter(([, v]) => v);
    const chips = (label, vals) => ((vals || []).length ? h('div', { class: 'fam-recipe-chips' }, h('span', { class: 'fam-label' }, label), vals.map((v) => h('span', { class: 'fam-tag' }, v))) : null);
    const src = this.img(r);
    const made = r.madeCount ? `Made ${r.madeCount} time${r.madeCount === 1 ? '' : 's'}, last on ${fmtDate(new Date(`${r.lastMade}T12:00`), { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Not made yet';
    const body = h('div', { class: 'fam-recipe-view' },
      src ? h('div', { class: 'fam-recipe-photo' }, h('img', { src, alt: '' })) : null,
      h('div', { class: 'fam-recipe-head' },
        src ? null : h('span', { class: 'fam-recipe-bigemoji' }, r.emoji || '🍲'),
        h('div', { class: 'fam-recipe-titles' }, h('h2', {}, r.title), h('div', { class: 'fam-recipe-rateline' }, rating, fav, h('span', { class: 'fam-muted small' }, made))),
      ),
      r.description ? h('p', { class: 'fam-recipe-desc' }, r.description) : null,
      meta.length ? h('div', { class: 'fam-recipe-meta' }, meta.map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v)))) : null,
      h('div', { class: 'fam-recipe-tools' },
        h('button', { type: 'button', class: 'fam-btn primary', onclick: () => { s.close(); this.cook(r, factor); } }, '👩‍🍳 Cook mode'),
        h('button', { type: 'button', class: 'fam-btn', onclick: async () => { const today = ymd(new Date()); await save({ madeCount: (this.store.get('recipes', r.id)?.madeCount || 0) + 1, lastMade: today }); toast(`Marked “${r.title}” as made today`, { type: 'success', timeout: 2000 }); } }, '✓ Made it today'),
        h('button', { type: 'button', class: 'fam-btn', onclick: () => this.print(r, factor, false) }, '📄 Print view'),
        h('button', { type: 'button', class: 'fam-btn', onclick: () => this.print(r, factor) }, '🖨 Print'),
        r.mealieLink ? h('a', { class: 'fam-btn', href: r.mealieLink, target: '_blank', rel: 'noopener' }, 'Open in Mealie') : null,
        r.url ? h('a', { class: 'fam-btn', href: r.url, target: '_blank', rel: 'noopener' }, 'Original recipe') : null),
      h('div', { class: 'fam-recipe-cols' },
        (r.ingredients || []).length ? h('section', {}, h('div', { class: 'fam-recipe-h' }, h('h4', {}, 'Ingredients'),
          h('div', { class: 'fam-scale' }, h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'Fewer', onclick: () => scale(-1) }, '−'), h('span', {}, base ? 'Serves ' : 'Amount ', servingsEl), h('button', { type: 'button', class: 'fam-icon-btn', 'aria-label': 'More', onclick: () => scale(1) }, '+'))), ingList) : null,
        steps.length ? h('section', {}, h('h4', {}, 'Steps'), h('ol', { class: 'fam-steps' }, steps)) : null),
      r.notes ? h('div', { class: 'fam-recipe-notes' }, h('h4', {}, 'Notes'), r.notes.split('\n').map((l) => h('p', {}, l))) : null,
      r.nutrition ? h('div', {}, h('h4', {}, 'Nutrition'), h('div', { class: 'fam-nutrition' }, Object.entries(r.nutrition).map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v))))) : null,
      chips('Categories', r.categories), chips('Tags', r.tags), chips('Tools', r.tools),
      r.source === 'mealie' ? h('p', { class: 'fam-muted small' }, 'Imported from Mealie and kept up to date with it.') : null);
    const s = sheet(this.app.root, {
      title: 'Recipe', body, wide: true, cls: 'fam-recipe-sheet',
      actions: [{ label: 'Edit', left: true, value: 'edit' }, { label: 'Ingredients to groceries', value: 'groceries' }, { label: 'Add to meal plan', primary: true, value: 'plan' }],
    });
    const out = await s;
    if (out === 'edit') this.edit(this.store.get('recipes', r.id));
    if (out === 'groceries') this.meals.groceries((r.ingredients || []).filter((l) => !isSection(l)).map((l) => scaleLine(l, factor)));
    if (out === 'plan') this.meals.editMeal({ title: r.title, recipe: r.id, date: ymd(new Date()), slot: 'dinner', id: undefined }, ymd(new Date()), 'dinner');
  }

  // --- Cook mode: one step at a time, big, with timers; the screen stays on ------------------

  async cook(r, factor = 1) {
    const flat = [];
    let section = '';
    for (const line of stepList(r)) { if (isSection(line)) section = sectionTitle(line); else flat.push({ section, text: line }); }
    if (!flat.length) { toast('This recipe has no steps', { timeout: 2000 }); return; }
    let i = 0;
    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed here */ }
    const timers = h('div', { class: 'fam-cook-timers' });
    const stepEl = h('div', { class: 'fam-cook-step' });
    const counter = h('div', { class: 'fam-cook-count' });
    const prev = h('button', { class: 'fam-btn fam-cook-nav', onclick: () => go(-1) }, '‹ Back');
    const next = h('button', { class: 'fam-btn primary fam-cook-nav', onclick: () => go(1) }, 'Next ›');
    const ing = h('ul', { class: 'fam-cook-ings' }, (r.ingredients || []).map((l) => (isSection(l) ? h('li', { class: 'fam-ing-section' }, sectionTitle(l)) : h('li', {}, h('label', {}, h('input', { type: 'checkbox' }), h('span', {}, scaleLine(l, factor)))))));
    const running = new Set();
    const startTimer = (label, secs) => {
      const end = Date.now() + secs * 1000;
      const el = h('div', { class: 'fam-cook-timer' });
      const stop = () => { clearInterval(t); running.delete(stop); el.remove(); };
      const tick = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        clear(el, h('b', {}, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`), h('span', {}, label), h('button', { class: 'fam-icon-btn', 'aria-label': 'Stop timer', html: ICONS.close, onclick: stop }));
        if (!left) { clearInterval(t); el.classList.add('done'); chime(); toast(`⏰ ${label} — time’s up`, { timeout: 15000 }); }
      };
      const t = setInterval(tick, 500);
      running.add(stop);
      tick();
      timers.append(el);
    };
    const draw = () => {
      const st = flat[i];
      // Times in the step ("bake for 25 minutes") become timer buttons.
      const found = [...st.text.matchAll(/(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi)];
      clear(stepEl, st.section ? h('div', { class: 'fam-cook-section' }, st.section) : null, h('p', {}, st.text),
        found.length ? h('div', { class: 'fam-row-wrap' }, found.map((m) => {
          const n = Number((m[2] || m[1]).replace(',', '.'));
          const unit = m[3].toLowerCase();
          const secs = unit.startsWith('h') ? n * 3600 : unit.startsWith('s') ? n : n * 60;
          return h('button', { class: 'fam-btn', onclick: () => startTimer(`${r.title}: step ${i + 1}`, secs) }, `⏱ ${m[0]}`);
        })) : null);
      counter.textContent = `Step ${i + 1} of ${flat.length}`;
      prev.disabled = i === 0;
      next.textContent = i === flat.length - 1 ? 'Done ✓' : 'Next ›';
    };
    const go = (d) => { if (i + d >= flat.length) { close(); return; } i = Math.max(0, i + d); draw(); };
    const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close(); };
    const close = () => { for (const stop of [...running]) stop(); lock?.release?.().catch(() => {}); window.removeEventListener('keydown', onKey); el.remove(); };
    const el = h('div', { class: 'fam-cook' },
      h('div', { class: 'fam-cook-top' }, h('b', {}, r.title), counter, h('div', { class: 'fam-spacer' }), h('button', { class: 'fam-icon-btn', 'aria-label': 'Close cook mode', html: ICONS.close, onclick: () => close() })),
      h('div', { class: 'fam-cook-body' }, h('aside', {}, h('h4', {}, 'Ingredients'), ing), h('main', {}, stepEl, timers)),
      h('div', { class: 'fam-cook-bar' }, prev, next));
    window.addEventListener('keydown', onKey);
    // Swipe between steps on a touch screen.
    let sx = null;
    stepEl.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    stepEl.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 60) go(e.clientX < sx ? 1 : -1); sx = null; });
    this.app.root.append(el);
    draw();
  }

  // A clean page for the recipe: printed straight away, or (autoPrint false) just shown, with its
  // own Print button.
  print(r, factor = 1, autoPrint = true) {
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const lines = (arr, tag) => arr.map((l) => (isSection(l) ? `<li class="s">${esc(sectionTitle(l))}</li>` : `<li>${esc(l)}</li>`)).join('');
    const src = this.img(r);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
      body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#222}h1{margin:0 0 4px}img{max-width:100%;max-height:300px;border-radius:10px;object-fit:cover}
      .m{color:#666;margin:6px 0 14px}.c{display:grid;grid-template-columns:1fr 1.6fr;gap:28px}ul,ol{padding-left:20px}li{margin:4px 0}li.s{list-style:none;margin-left:-20px;font-weight:700;margin-top:10px}
      .bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:10px 0;margin-bottom:8px;background:#fff;border-bottom:1px solid #eee}
      .bar button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}.bar button.p{background:#4c6ef5;border-color:#4c6ef5;color:#fff}
      @media (max-width:600px){.c{grid-template-columns:1fr;gap:0}}
      @media print{body{margin:0}.bar{display:none}}</style></head><body>
      ${autoPrint ? '' : '<div class="bar"><button onclick="window.close()">Close</button><button class="p" onclick="print()">🖨 Print</button></div>'}
      ${src ? `<img src="${esc(new URL(src, location.href))}">` : ''}<h1>${esc(r.title)}</h1>
      <div class="m">${esc([fmtMins(r.prepMin) && `Prep ${fmtMins(r.prepMin)}`, fmtMins(r.cookMin) && `Cook ${fmtMins(r.cookMin)}`, fmtMins(r.minutes) && `Total ${fmtMins(r.minutes)}`, r.servings && `Serves ${fmtAmount(r.servings * factor)}`].filter(Boolean).join(' · '))}</div>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      <div class="c"><div><h3>Ingredients</h3><ul>${lines((r.ingredients || []).map((l) => scaleLine(l, factor)))}</ul></div>
      <div><h3>Steps</h3><ol>${stepList(r).map((l) => (isSection(l) ? `<li class="s">${esc(sectionTitle(l))}</li>` : `<li>${esc(l)}</li>`)).join('')}</ol></div></div>
      ${r.notes ? `<h3>Notes</h3><p>${esc(r.notes).replace(/\n/g, '<br>')}</p>` : ''}
      ${autoPrint ? '<script>window.onload=()=>setTimeout(()=>print(),300)<\/script>' : ''}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print', { timeout: 3000 }); return; }
    w.document.write(html);
    w.document.close();
  }

  // --- Adding and changing ------------------------------------------------------------------

  // Import from a recipe website: the page's recipe details become a new recipe to check and save.
  async fromWebsite() {
    const url = input({ type: 'url', placeholder: 'https://www.example.com/best-lasagna', required: true, autofocus: true });
    const err = h('div', { class: 'fam-error' });
    const draft = await sheet(this.app.root, {
      title: 'Import a recipe from a website',
      body: h('div', { class: 'fam-form' }, h('p', { class: 'fam-muted' }, 'Paste the address of a recipe page. Most recipe sites work.'), url, err),
      actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, submit: true, onClick: async (close) => {
        if (!url.value.trim()) return url.focus();
        err.textContent = 'Reading the page…';
        try { close(await this.store.importRecipeUrl(url.value.trim())); } catch (e) { err.textContent = e.message; }
      } }],
    });
    if (draft) this.edit(null, draft);
  }

  async edit(r, draft = null) {
    const d = r || draft || {};
    const fromMealie = r?.source === 'mealie';
    let image = d.image || null;
    const photo = h('div', { class: 'fam-recipe-editphoto' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try { image = await this.store.uploadRecipeImage(f); drawPhoto(); } catch (e) { toastError(e, 'Couldn’t add that picture'); }
    } });
    const drawPhoto = () => clear(photo, image ? h('img', { src: this.store.recipeImageUrl({ image }), alt: '' }) : h('span', { class: 'fam-muted small' }, 'No photo'),
      h('div', { class: 'fam-row-wrap' }, h('button', { type: 'button', class: 'fam-btn small', onclick: () => fileIn.click() }, image ? 'Change photo' : 'Add photo'),
        image ? h('button', { type: 'button', class: 'fam-btn small', onclick: () => { image = null; drawPhoto(); } }, 'Remove') : null), fileIn);
    drawPhoto();
    const emoji = emojiButton(d.emoji || '🍲');
    const title = input({ value: d.title || '', placeholder: 'Recipe name', required: true, autofocus: true, maxlength: 200 });
    const description = h('textarea', { class: 'fam-input', rows: 2, placeholder: 'A line or two about it', maxlength: 3000 }, d.description || '');
    const num = (v, max = 1440) => input({ type: 'number', min: 0, max, value: v || '', class: 'fam-input tiny' });
    const prep = num(d.prepMin);
    const cookT = num(d.cookMin);
    const total = num(d.minutes);
    const servings = num(d.servings, 200);
    const yieldText = input({ value: d.yield || '', placeholder: 'e.g. 12 muffins', maxlength: 80 });
    const categories = input({ value: (d.categories || []).join(', '), placeholder: 'Dinner, Soup' });
    const tags = input({ value: (d.tags || []).join(', '), placeholder: 'Quick, Vegetarian, Kid favourite' });
    const tools = input({ value: (d.tools || []).join(', '), placeholder: 'Slow cooker, Sheet pan' });
    const ingredients = h('textarea', { class: 'fam-input', rows: 8, placeholder: 'One per line:\n1 lb pasta\n2 cups spinach\n# For the sauce\n1 jar pesto' }, (d.ingredients || []).join('\n'));
    const steps = h('textarea', { class: 'fam-input', rows: 8, placeholder: 'One step per line. A line starting “# ” starts a section.' }, d.steps || '');
    const notes = h('textarea', { class: 'fam-input', rows: 2, placeholder: 'Tips, swaps, who loves it…' }, d.notes || '');
    const nutrition = h('textarea', { class: 'fam-input', rows: 3, placeholder: 'One per line, e.g. Calories: 450 kcal' }, Object.entries(d.nutrition || {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
    const url = input({ type: 'url', value: d.url || '', placeholder: 'https://… (optional)' });
    if (!total.value) { const sum = () => { if (!total.dataset.touched) total.placeholder = String((Number(prep.value) || 0) + (Number(cookT.value) || 0) || ''); }; prep.addEventListener('input', sum); cookT.addEventListener('input', sum); total.addEventListener('input', () => { total.dataset.touched = '1'; }); }
    const s = sheet(this.app.root, {
      title: r ? 'Edit recipe' : draft ? 'Imported recipe — check and save' : 'New recipe', wide: true,
      body: h('div', { class: 'fam-form' },
        fromMealie ? h('p', { class: 'fam-note' }, 'This recipe comes from Mealie. Changes here are replaced the next time it changes in Mealie, so it’s best changed there. Rating, favourite and “made it” stay here.') : null,
        !r && !draft ? h('button', { type: 'button', class: 'fam-btn', onclick: () => { s.close(null); this.fromWebsite(); } }, '🌐 Import from a website instead') : null,
        h('div', { class: 'fam-recipe-edittop' }, photo, h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title), description)),
        h('div', { class: 'fam-row-wrap' }, field('Prep (min)', prep), field('Cook (min)', cookT), field('Total (min)', total), field('Serves', servings), field('Makes', yieldText)),
        h('div', { class: 'fam-row-wrap' }, field('Categories', categories), field('Tags', tags), field('Tools', tools)),
        h('div', { class: 'fam-recipe-cols' }, field('Ingredients', ingredients, 'Start a line with “# ” for a section, like “# For the sauce”.'), field('Steps', steps)),
        field('Notes', notes), field('Nutrition', nutrition), field('Link to the original', url)),
      actions: [r ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
        if (!title.value.trim()) return title.focus();
        const nut = Object.fromEntries(nutrition.value.split('\n').map((l) => l.split(':')).filter((p) => p.length > 1 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
        close({
          ...(r || {}), title: title.value.trim(), emoji: emoji.value, image, description: description.value.trim(),
          prepMin: Number(prep.value) || null, cookMin: Number(cookT.value) || null, minutes: Number(total.value) || ((Number(prep.value) || 0) + (Number(cookT.value) || 0)) || null,
          servings: Number(servings.value) || null, yield: yieldText.value.trim(),
          categories: splitList(categories.value), tags: splitList(tags.value), tools: splitList(tools.value),
          ingredients: ingredients.value.split('\n').map((l) => l.trim()).filter(Boolean), steps: steps.value.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'),
          notes: notes.value.trim(), nutrition: Object.keys(nut).length ? nut : null, url: url.value.trim(),
        });
      } }],
    });
    const out = await s;
    if (!out) return;
    try {
      if (out === 'delete') {
        if (fromMealie) { toast('This recipe comes from Mealie — delete it there and it goes from here too', { timeout: 4000 }); return; }
        await this.store.del('recipes', r.id);
      } else {
        const saved = await this.store.put('recipes', out);
        if (!r) this.show(saved);
      }
    } catch (err) { toastError(err); }
  }
}

// A short chime when a cook-mode timer ends.
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.25);
    });
  } catch { /* no sound */ }
}
