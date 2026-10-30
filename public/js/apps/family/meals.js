// Meal planning: the week's breakfasts, lunches, dinners and snacks, a recipe box, meal ideas
// from the recipe box, and ingredients sent to the grocery list.

import { h, clear, toast, toastError } from '../../ui.js';
import { ymd, parseYmd, addDays, startOfDay, sameDay, startOfWeek, fmtDate, DAY_SHORT, DAY_NAMES } from './dates.js';
import { sheet, field, input, select, emojiButton, ICONS } from './shared.js';
import { addToGroceries } from './lists.js';

export const SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🥣' },
  { id: 'lunch', label: 'Lunch', emoji: '🥪' },
  { id: 'dinner', label: 'Dinner', emoji: '🍽️' },
  { id: 'snack', label: 'Snack', emoji: '🍎' },
];

export class MealsView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.date = startOfDay(new Date());
    this.tab = 'plan'; // plan | recipes
    this.search = '';
  }

  slots() {
    const on = this.store.settings.mealSlots || ['breakfast', 'lunch', 'dinner'];
    return SLOTS.filter((s) => on.includes(s.id));
  }

  render(el) {
    this.el = el;
    const weekStart = startOfWeek(this.date, Number(this.store.settings.weekStart) || 0);
    const bar = h('div', { class: 'fam-toolbar' },
      h('div', { class: 'fam-seg' },
        h('button', { class: this.tab === 'plan' ? 'on' : '', onclick: () => { this.tab = 'plan'; this.render(el); } }, 'Meal plan'),
        h('button', { class: this.tab === 'recipes' ? 'on' : '', onclick: () => { this.tab = 'recipes'; this.render(el); } }, 'Recipe box')),
      this.tab === 'plan' ? h('div', { class: 'fam-nav' },
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Previous week', html: ICONS.left, onclick: () => { this.date = addDays(this.date, -7); this.render(el); } }),
        h('button', { class: 'fam-btn', onclick: () => { this.date = startOfDay(new Date()); this.render(el); } }, `Week of ${fmtDate(weekStart, { month: 'short', day: 'numeric' })}`),
        h('button', { class: 'fam-icon-btn', 'aria-label': 'Next week', html: ICONS.right, onclick: () => { this.date = addDays(this.date, 7); this.render(el); } })) : null,
      h('div', { class: 'fam-spacer' }),
      this.tab === 'plan' ? h('button', { class: 'fam-btn', onclick: () => this.weekGroceries(weekStart) }, h('span', { html: ICONS.cart }), 'Groceries for the week') : null,
      this.tab === 'plan' ? h('button', { class: 'fam-btn', onclick: () => this.fillWeek(weekStart) }, h('span', { html: ICONS.dice }), 'Plan dinners for me') : null,
      this.tab === 'recipes' ? h('button', { class: 'fam-btn primary', onclick: () => this.editRecipe(null) }, h('span', { html: ICONS.plus }), 'Recipe') : null);
    const body = h('div', { class: 'fam-meals-body' });
    clear(el, bar, body);
    if (this.tab === 'plan') this.drawPlan(body, weekStart); else this.drawRecipes(body);
  }

  drawPlan(body, weekStart) {
    const slots = this.slots();
    const meals = this.store.all('meals');
    const grid = h('div', { class: 'fam-meal-grid', style: { '--slots': slots.length } },
      h('div', {}), slots.map((s) => h('div', { class: 'fam-meal-slot-head' }, s.emoji, ' ', s.label)));
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const key = ymd(day);
      grid.append(h('div', { class: `fam-meal-day ${sameDay(day, new Date()) ? 'today' : ''}` }, h('b', {}, DAY_SHORT[day.getDay()]), h('span', {}, day.getDate())));
      for (const s of slots) {
        const here = meals.filter((m) => m.date === key && m.slot === s.id);
        grid.append(h('div', { class: 'fam-meal-cell', dataset: { label: `${DAY_NAMES[day.getDay()]} ${s.label}` }, onclick: (e) => { if (e.target === e.currentTarget) this.editMeal(null, key, s.id); } },
          here.map((m) => {
            const r = m.recipe ? this.store.get('recipes', m.recipe) : null;
            return h('button', { class: 'fam-meal', onclick: () => this.editMeal(m, key, s.id) }, h('span', {}, r?.emoji || m.emoji || s.emoji), h('span', {}, m.title || r?.title || 'Meal'));
          }),
          h('button', { class: 'fam-meal-add', 'aria-label': `Add ${s.label.toLowerCase()}`, onclick: () => this.editMeal(null, key, s.id) }, '+')));
      }
    }
    clear(body, grid);
  }

  drawRecipes(body) {
    const q = input({ type: 'search', placeholder: 'Search recipes and ingredients', value: this.search, class: 'fam-input fam-recipe-search' });
    const grid = h('div', { class: 'fam-recipes' });
    const draw = () => {
      const term = this.search.toLowerCase();
      const recipes = this.store.all('recipes').filter((r) => !term || [r.title, ...(r.ingredients || []), ...(r.tags || [])].join(' ').toLowerCase().includes(term)).sort((a, b) => a.title.localeCompare(b.title));
      clear(grid, recipes.length ? recipes.map((r) => h('button', { class: 'fam-recipe', onclick: () => this.showRecipe(r) },
        h('div', { class: 'fam-recipe-emoji' }, r.emoji || '🍲'),
        h('b', {}, r.title),
        h('small', {}, [r.minutes ? `${r.minutes} min` : null, r.servings ? `Serves ${r.servings}` : null].filter(Boolean).join(' · ')),
        (r.tags || []).length ? h('div', { class: 'fam-tags' }, r.tags.map((t) => h('span', {}, t))) : null))
        : h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '📖'), term ? 'No recipes match.' : 'Keep the family’s favourite recipes here, then add them to the meal plan.'));
    };
    q.addEventListener('input', () => { this.search = q.value; draw(); });
    draw();
    clear(body, q, grid);
  }

  // Recipes that suit a meal, least recently eaten first.
  suggestions(slot, date) {
    const label = SLOTS.find((s) => s.id === slot)?.label.toLowerCase();
    const lastEaten = new Map();
    for (const m of this.store.all('meals')) if (m.recipe && (!lastEaten.has(m.recipe) || m.date > lastEaten.get(m.recipe))) lastEaten.set(m.recipe, m.date);
    const all = this.store.all('recipes');
    const fit = all.filter((r) => !(r.tags || []).some((t) => SLOTS.some((s) => s.label.toLowerCase() === t.toLowerCase())) || (r.tags || []).some((t) => t.toLowerCase() === label));
    const pool = (fit.length ? fit : all).map((r) => ({ r, last: lastEaten.get(r.id) || '0000', rnd: Math.random() }));
    return pool.filter((x) => x.last < ymd(addDays(parseYmd(date), -10)) || x.last > date).sort((a, b) => a.last.localeCompare(b.last) || a.rnd - b.rnd).map((x) => x.r)
      .concat(pool.map((x) => x.r)).filter((r, i, arr) => arr.indexOf(r) === i);
  }

  async editMeal(m, date, slot) {
    const recipes = this.store.all('recipes').sort((a, b) => a.title.localeCompare(b.title));
    const title = input({ value: m?.title || '', placeholder: 'What’s cooking? Or pick a recipe below', autofocus: true, maxlength: 120 });
    let recipe = m?.recipe || null;
    const daySel = input({ type: 'date', value: m?.date || date });
    const slotSel = select(SLOTS.map((s) => [s.id, `${s.emoji} ${s.label}`]), m?.slot || slot);
    const notes = input({ value: m?.notes || '', placeholder: 'Notes (who’s cooking, sides…)', maxlength: 300 });
    const picks = h('div', { class: 'fam-recipe-picks' });
    const drawPicks = (list) => clear(picks, list.slice(0, 12).map((r) => h('button', { type: 'button', class: `fam-chip ${recipe === r.id ? 'on' : ''}`, onclick: () => { recipe = recipe === r.id ? null : r.id; if (recipe) title.value = r.title; drawPicks(list); } }, `${r.emoji || '🍲'} ${r.title}`)));
    drawPicks(recipes);
    title.addEventListener('input', () => {
      const t = title.value.toLowerCase();
      if (recipe && this.store.get('recipes', recipe)?.title !== title.value) recipe = null;
      drawPicks(t ? recipes.filter((r) => r.title.toLowerCase().includes(t)) : recipes);
    });
    const idea = h('button', { type: 'button', class: 'fam-btn small', onclick: () => {
      const s = this.suggestions(slotSel.value, daySel.value);
      if (!s.length) { toast('Add some recipes to the recipe box first', { timeout: 3000 }); return; }
      const pick = s[Math.floor(Math.random() * Math.min(3, s.length))];
      recipe = pick.id; title.value = pick.title; drawPicks([pick, ...recipes.filter((r) => r !== pick)]);
    } }, h('span', { html: ICONS.sparkle }), 'Suggest something');
    const out = await sheet(this.app.root, {
      title: m ? 'Meal' : 'Add a meal',
      body: h('div', { class: 'fam-form' }, title, recipes.length ? h('div', {}, h('div', { class: 'fam-row-wrap' }, h('span', { class: 'fam-label' }, 'From the recipe box'), idea), picks) : null,
        h('div', { class: 'fam-row-wrap' }, field('Day', daySel), field('Meal', slotSel)), notes),
      actions: [m ? { label: 'Remove', danger: true, left: true, value: 'delete' } : null,
        { label: 'Ingredients to groceries', onClick: async (close) => { const r = this.store.get('recipes', recipe); if (!r?.ingredients?.length) { toast('Pick a recipe with ingredients first', { timeout: 3000 }); return; } await this.groceries(r.ingredients); } },
        { label: 'Save', primary: true, submit: true, onClick: (close) => { if (!title.value.trim() && !recipe) return title.focus(); close({ ...(m || {}), title: title.value.trim() || this.store.get('recipes', recipe)?.title, recipe, date: daySel.value || date, slot: slotSel.value, notes: notes.value.trim() }); } }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.store.del('meals', m.id); else await this.store.put('meals', out); } catch (err) { toastError(err); }
  }

  async groceries(lines) {
    try {
      const { list, added } = await addToGroceries(this.store, lines);
      toast(added ? `Added ${added} item${added === 1 ? '' : 's'} to ${list.title}` : `Everything’s already on ${list.title}`, { type: 'success', timeout: 3000, action: { label: 'Open', onClick: () => this.app.go('lists', list.id) } });
    } catch (err) { toastError(err); }
  }

  async weekGroceries(weekStart) {
    const keys = new Set(Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))));
    const lines = this.store.all('meals').filter((m) => keys.has(m.date) && m.recipe).flatMap((m) => this.store.get('recipes', m.recipe)?.ingredients || []);
    if (!lines.length) { toast('No recipes with ingredients are planned this week', { timeout: 3000 }); return; }
    await this.groceries(lines);
  }

  async fillWeek(weekStart) {
    const meals = this.store.all('meals');
    const empty = Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))).filter((d) => d >= ymd(new Date()) && !meals.some((m) => m.date === d && m.slot === 'dinner'));
    if (!this.store.all('recipes').length) { toast('Add some recipes to the recipe box first', { timeout: 3000 }); return; }
    if (!empty.length) { toast('Every dinner this week is already planned', { timeout: 3000 }); return; }
    const used = new Set();
    const ops = [];
    for (const d of empty) {
      const pick = this.suggestions('dinner', d).find((r) => !used.has(r.id)) || this.suggestions('dinner', d)[0];
      if (!pick) break;
      used.add(pick.id);
      ops.push({ op: 'put', col: 'meals', item: { date: d, slot: 'dinner', recipe: pick.id, title: pick.title } });
    }
    try { await this.store.batch(ops); toast(`Planned ${ops.length} dinner${ops.length === 1 ? '' : 's'} from the recipe box`, { type: 'success', timeout: 3000 }); } catch (err) { toastError(err); }
  }

  async showRecipe(r) {
    const body = h('div', { class: 'fam-recipe-view' },
      h('div', { class: 'fam-recipe-hero' }, h('span', {}, r.emoji || '🍲'), h('div', {}, h('h2', {}, r.title), h('div', { class: 'fam-muted' }, [r.minutes ? `${r.minutes} minutes` : null, r.servings ? `Serves ${r.servings}` : null].filter(Boolean).join(' · ')),
        r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Original recipe') : null)),
      (r.ingredients || []).length ? h('div', {}, h('h4', {}, 'Ingredients'), h('ul', { class: 'fam-ingredients' }, r.ingredients.map((i) => h('li', {}, h('label', {}, h('input', { type: 'checkbox' }), ' ', i))))) : null,
      r.steps ? h('div', {}, h('h4', {}, 'Steps'), h('ol', { class: 'fam-steps' }, r.steps.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => h('li', {}, s)))) : null);
    const out = await sheet(this.app.root, {
      title: 'Recipe', body, wide: true,
      actions: [{ label: 'Edit', left: true, value: 'edit' }, { label: 'Ingredients to groceries', value: 'groceries' }, { label: 'Add to meal plan', primary: true, value: 'plan' }],
    });
    if (out === 'edit') this.editRecipe(r);
    if (out === 'groceries') this.groceries(r.ingredients || []);
    if (out === 'plan') this.editMeal({ title: r.title, recipe: r.id, date: ymd(new Date()), slot: 'dinner', id: undefined }, ymd(new Date()), 'dinner');
  }

  async editRecipe(r) {
    const emoji = emojiButton(r?.emoji || '🍲');
    const title = input({ value: r?.title || '', placeholder: 'Recipe name', required: true, autofocus: true, maxlength: 120 });
    const minutes = input({ type: 'number', min: 0, max: 1440, value: r?.minutes || '', class: 'fam-input tiny' });
    const servings = input({ type: 'number', min: 0, max: 100, value: r?.servings || '', class: 'fam-input tiny' });
    const url = input({ type: 'url', value: r?.url || '', placeholder: 'https://… (optional)' });
    const tags = input({ value: (r?.tags || []).join(', '), placeholder: 'Dinner, Quick, Vegetarian' });
    const ingredients = h('textarea', { class: 'fam-input', rows: 6, placeholder: 'One per line:\n1 lb pasta\n2 cups spinach' }, (r?.ingredients || []).join('\n'));
    const steps = h('textarea', { class: 'fam-input', rows: 6, placeholder: 'One step per line' }, r?.steps || '');
    const out = await sheet(this.app.root, {
      title: r ? 'Edit recipe' : 'New recipe', wide: true,
      body: h('div', { class: 'fam-form' }, h('div', { class: 'fam-title-row' }, emoji, title),
        h('div', { class: 'fam-row-wrap' }, field('Minutes', minutes), field('Serves', servings), field('Tags', tags)),
        field('Ingredients', ingredients), field('Steps', steps), field('Link', url)),
      actions: [r ? { label: 'Delete', danger: true, left: true, value: 'delete' } : null, { label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: (close) => {
        if (!title.value.trim()) return title.focus();
        close({ ...(r || {}), title: title.value.trim(), emoji: emoji.value, minutes: Number(minutes.value) || null, servings: Number(servings.value) || null, url: url.value.trim(),
          tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean), ingredients: ingredients.value.split('\n').map((l) => l.trim()).filter(Boolean), steps: steps.value.trim() });
      } }],
    });
    if (!out) return;
    try { if (out === 'delete') await this.store.del('recipes', r.id); else await this.store.put('recipes', out); } catch (err) { toastError(err); }
  }
}
