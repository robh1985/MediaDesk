// Groceries: the store's aisles (the family can rename, reorder and add them) and a database of
// foods, each in an aisle: a built-in list of everyday foods plus the family's own foods. Every
// grocery item is sorted into an aisle from the food it matches. Moving an item to another aisle
// teaches the food database, so it goes there next time too.

export const DEFAULT_AISLES = [
  ['a-produce', 'Produce', '🥬'], ['a-bakery', 'Bakery', '🍞'], ['a-deli', 'Deli', '🥪'], ['a-meat', 'Meat & seafood', '🥩'],
  ['a-dairy', 'Dairy & eggs', '🥛'], ['a-frozen', 'Frozen', '🧊'], ['a-breakfast', 'Breakfast & cereal', '🥣'], ['a-pantry', 'Pantry', '🥫'],
  ['a-baking', 'Baking & spices', '🧂'], ['a-condiments', 'Condiments & sauces', '🍯'], ['a-snacks', 'Snacks', '🍿'], ['a-drinks', 'Drinks', '🧃'],
  ['a-household', 'Household', '🧻'], ['a-personal', 'Personal care', '🧴'], ['a-baby', 'Baby', '🍼'], ['a-pets', 'Pets', '🐾'], ['a-other', 'Other', '🛍️'],
].map(([id, name, emoji], order) => ({ id, name, emoji, order }));
export const OTHER = 'a-other';

const BUILTIN = {
  'a-produce': 'Apples, Bananas, Oranges, Clementines, Lemons, Limes, Grapefruit, Grapes, Strawberries, Blueberries, Raspberries, Blackberries, Cherries, Peaches, Nectarines, Plums, Pears, Mangoes, Pineapple, Watermelon, Cantaloupe, Honeydew, Kiwi, Avocados, Tomatoes, Cherry tomatoes, Potatoes, Sweet potatoes, Onions, Red onions, Green onions, Shallots, Garlic, Ginger, Carrots, Baby carrots, Celery, Lettuce, Romaine, Iceberg lettuce, Spring mix, Spinach, Baby spinach, Kale, Arugula, Cabbage, Red cabbage, Broccoli, Cauliflower, Brussels sprouts, Bell peppers, Red peppers, Green peppers, Jalapeños, Cucumbers, Zucchini, Yellow squash, Butternut squash, Spaghetti squash, Pumpkin, Mushrooms, Corn on the cob, Green beans, Snap peas, Snow peas, Asparagus, Eggplant, Beets, Radishes, Leeks, Bok choy, Cilantro, Parsley, Basil, Mint, Dill, Rosemary, Thyme, Fresh herbs, Bean sprouts, Salad kit, Coleslaw mix, Fruit salad',
  'a-bakery': 'Bread, Sandwich bread, Whole wheat bread, Sourdough, Baguette, Rolls, Dinner rolls, Hamburger buns, Hot dog buns, Bagels, English muffins, Croissants, Muffins, Donuts, Tortillas, Flour tortillas, Corn tortillas, Pita, Naan, Wraps, Cake, Cupcakes, Pie, Cookies from the bakery',
  'a-deli': 'Deli turkey, Deli ham, Roast beef, Salami, Pepperoni, Prosciutto, Sliced cheese, Rotisserie chicken, Hummus, Potato salad, Pasta salad, Olives, Sushi, Pizza dough',
  'a-meat': 'Chicken breasts, Chicken thighs, Chicken wings, Chicken drumsticks, Whole chicken, Ground chicken, Ground beef, Ground turkey, Ground pork, Steak, Ribeye, Sirloin, Stew meat, Roast, Pork chops, Pork tenderloin, Pork shoulder, Ribs, Bacon, Sausage, Italian sausage, Breakfast sausage, Hot dogs, Ham, Lamb, Meatballs, Salmon, Tilapia, Cod, Tuna steaks, Shrimp, Scallops, Crab, Fish fillets, Turkey breast',
  'a-dairy': 'Milk, Whole milk, 2% milk, Skim milk, Almond milk, Oat milk, Soy milk, Lactose-free milk, Half and half, Heavy cream, Whipping cream, Coffee creamer, Butter, Margarine, Eggs, Egg whites, Yogurt, Greek yogurt, Yogurt cups, Sour cream, Cream cheese, Cottage cheese, Cheddar, Mozzarella, Shredded cheese, String cheese, Parmesan, Feta, Swiss cheese, Provolone, Monterey jack, Ricotta, Goat cheese, Brie, Cheese sticks, Kefir, Whipped cream, Biscuit dough, Pie crust, Tofu',
  'a-frozen': 'Frozen vegetables, Frozen peas, Frozen corn, Frozen broccoli, Frozen spinach, Frozen fruit, Frozen berries, Frozen pizza, Frozen meals, Frozen burritos, Chicken nuggets, Fish sticks, French fries, Tater tots, Hash browns, Frozen waffles, Frozen pancakes, Ice cream, Popsicles, Frozen yogurt, Ice, Frozen shrimp, Frozen dumplings, Pot pies, Garlic bread',
  'a-breakfast': 'Cereal, Oatmeal, Rolled oats, Instant oatmeal, Granola, Granola bars, Pancake mix, Maple syrup, Pancake syrup, Pop-Tarts, Breakfast bars, Cream of wheat',
  'a-pantry': 'Pasta, Spaghetti, Penne, Macaroni, Egg noodles, Lasagna noodles, Ramen, Mac and cheese, Rice, Brown rice, Jasmine rice, Basmati rice, Quinoa, Couscous, Canned tomatoes, Diced tomatoes, Crushed tomatoes, Tomato paste, Tomato sauce, Pasta sauce, Marinara, Black beans, Kidney beans, Pinto beans, Chickpeas, Refried beans, Baked beans, Lentils, Canned corn, Canned green beans, Canned tuna, Canned salmon, Canned chicken, Chicken broth, Beef broth, Vegetable broth, Soup, Chicken noodle soup, Tomato soup, Coconut milk, Evaporated milk, Breadcrumbs, Panko, Stuffing, Instant potatoes, Taco shells, Taco kit, Peanut butter, Almond butter, Jam, Jelly, Nutella, Honey, Dried fruit, Raisins, Applesauce, Canned fruit',
  'a-baking': 'Flour, All-purpose flour, Whole wheat flour, Sugar, Brown sugar, Powdered sugar, Baking soda, Baking powder, Yeast, Vanilla extract, Chocolate chips, Cocoa powder, Cornstarch, Cake mix, Brownie mix, Frosting, Sprinkles, Shortening, Food coloring, Salt, Kosher salt, Sea salt, Black pepper, Peppercorns, Garlic powder, Onion powder, Paprika, Smoked paprika, Chili powder, Cumin, Oregano, Italian seasoning, Cinnamon, Nutmeg, Cayenne, Red pepper flakes, Curry powder, Turmeric, Bay leaves, Taco seasoning, Ranch seasoning, Everything bagel seasoning, Vegetable oil, Canola oil, Olive oil, Extra virgin olive oil, Coconut oil, Cooking spray, Sesame oil',
  'a-condiments': 'Ketchup, Mustard, Dijon mustard, Mayonnaise, Relish, Pickles, BBQ sauce, Hot sauce, Sriracha, Soy sauce, Teriyaki sauce, Worcestershire sauce, Salsa, Ranch dressing, Italian dressing, Salad dressing, Balsamic vinegar, White vinegar, Apple cider vinegar, Red wine vinegar, Rice vinegar, Pesto, Alfredo sauce, Enchilada sauce, Buffalo sauce, Fish sauce, Hoisin sauce, Gravy, Syrup',
  'a-snacks': 'Chips, Potato chips, Tortilla chips, Pretzels, Popcorn, Crackers, Goldfish, Cheese crackers, Graham crackers, Rice cakes, Cookies, Oreos, Fruit snacks, Trail mix, Nuts, Almonds, Cashews, Peanuts, Walnuts, Pecans, Sunflower seeds, Beef jerky, Candy, Chocolate, Gum, Pudding cups, Jello, Snack bars, Protein bars, Veggie straws',
  'a-drinks': 'Water, Bottled water, Sparkling water, Seltzer, Soda, Cola, Diet soda, Ginger ale, Orange juice, Apple juice, Grape juice, Cranberry juice, Lemonade, Juice boxes, Sports drinks, Gatorade, Iced tea, Tea, Green tea, Coffee, Ground coffee, Coffee beans, Coffee pods, K-cups, Hot chocolate, Energy drinks, Kombucha, Beer, Wine, Red wine, White wine, Hard seltzer, Drink mix',
  'a-household': 'Paper towels, Toilet paper, Tissues, Napkins, Paper plates, Plastic cups, Plastic forks, Dish soap, Dishwasher detergent, Dishwasher pods, Laundry detergent, Fabric softener, Dryer sheets, Bleach, All-purpose cleaner, Glass cleaner, Disinfecting wipes, Sponges, Trash bags, Recycling bags, Aluminum foil, Plastic wrap, Parchment paper, Ziploc bags, Sandwich bags, Freezer bags, Food storage containers, Light bulbs, Batteries, Air freshener, Matches, Candles, Hand soap, Rubber gloves',
  'a-personal': 'Shampoo, Conditioner, Body wash, Bar soap, Toothpaste, Toothbrushes, Floss, Mouthwash, Deodorant, Razors, Shaving cream, Lotion, Sunscreen, Lip balm, Cotton balls, Cotton swabs, Band-aids, Pain reliever, Ibuprofen, Acetaminophen, Allergy medicine, Cold medicine, Vitamins, Feminine products, Hair ties, Contact solution',
  'a-baby': 'Diapers, Wipes, Baby wipes, Baby food, Formula, Baby shampoo, Diaper cream, Pull-ups',
  'a-pets': 'Dog food, Cat food, Dog treats, Cat treats, Cat litter, Poop bags, Pet toys, Bird seed, Fish food',
};

// "Tomatoes" → "tomato", "Berries" → "berry"; for matching only.
const singular = (w) => (w.length < 4 || /ss$|us$|is$/.test(w) ? w : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /(ch|sh|x|o)es$/.test(w) ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w);
export const foodKey = (name) => String(name || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim().split(' ').filter(Boolean).map(singular).join(' ');

// Older lists keep aisle names; matching words for foods neither database knows.
const GUESS = [
  ['a-produce', /\b(apple|banana|berr|grape|orange|lemon|lime|melon|peach|pear|plum|cherr|mango|pineapple|kiwi|avocado|tomato|potato|onion|garlic|carrot|celery|lettuce|spinach|kale|arugula|cabbage|broccoli|cauliflower|pepper|cucumber|zucchini|squash|mushroom|corn|herb|cilantro|parsley|basil|mint|ginger|scallion|leek|beet|radish|asparagus|fruit|veg|salad)/i],
  ['a-meat', /\b(chicken|beef|pork|steak|ground|turkey|bacon|sausage|ham|lamb|fish|salmon|tuna|shrimp|cod|tilapia|meat|thigh|breast|wing|rib|mince|chorizo)/i],
  ['a-dairy', /\b(milk|cheese|cheddar|mozzarella|parmesan|feta|yog(h)?urt|butter|cream|egg|cottage|kefir)/i],
  ['a-bakery', /\b(bread|bagel|bun|roll|tortilla|pita|croissant|muffin|baguette|naan|cake|donut|wrap)/i],
  ['a-frozen', /\b(frozen|ice cream|popsicle|waffle)/i],
  ['a-breakfast', /\b(cereal|oat|granola|pancake)/i],
  ['a-baking', /\b(flour|sugar|salt|spice|seasoning|cinnamon|vanilla|baking|yeast|oil)\b/i],
  ['a-condiments', /\b(sauce|ketchup|mustard|mayo|dressing|vinegar|salsa|pickle)/i],
  ['a-pantry', /\b(pasta|spaghetti|noodle|rice|bean|lentil|chickpea|soup|broth|stock|can|jar|peanut butter|jam|jelly|honey)/i],
  ['a-snacks', /\b(cracker|chip|pretzel|popcorn|nut|almond|cookie|snack|candy|chocolate)/i],
  ['a-drinks', /\b(juice|soda|water|sparkling|beer|wine|kombucha|lemonade|drink|coffee|tea)\b/i],
  ['a-household', /\b(paper towel|toilet|tissue|napkin|detergent|dish|sponge|trash|foil|bag|bleach|cleaner|wipe|battery|bulb)/i],
  ['a-personal', /\b(shampoo|soap|toothpaste|deodorant|lotion|razor|floss|medicine|vitamin)/i],
  ['a-baby', /\b(diaper|formula|baby)/i],
  ['a-pets', /\b(dog|cat|pet|litter|kibble)/i],
];
export const guessAisle = (text) => GUESS.find(([, re]) => re.test(text))?.[0] || OTHER;

// The family's aisles in store order (the defaults until the family changes them).
export function aisles(store) {
  const own = store.all('aisles');
  const list = own.length ? own : DEFAULT_AISLES;
  const out = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  if (!out.some((a) => a.id === OTHER)) out.push(DEFAULT_AISLES.find((a) => a.id === OTHER));
  return out;
}
// Before the first change to the aisles, the defaults are saved as the family's own.
export const seedAisles = (store) => (store.all('aisles').length ? [] : DEFAULT_AISLES.map((a) => ({ op: 'put', col: 'aisles', item: { ...a } })));
// An aisle by id, or by name (older items saved the aisle's name).
export function findAisle(store, ref) {
  if (!ref) return null;
  const list = aisles(store);
  const low = String(ref).toLowerCase();
  return list.find((a) => a.id === ref) || list.find((a) => a.name.toLowerCase() === low) || null;
}

// The food database: built-in foods, with the family's foods (new ones, and built-in foods they
// moved to another aisle or removed) on top. Cached until the family's foods change.
let cache = { sig: null, foods: [], byKey: new Map() };
export function foods(store) {
  const own = store.all('foods');
  const sig = `${own.length}:${own.reduce((m, f) => Math.max(m, f.updated || 0), 0)}`;
  if (cache.sig === sig) return cache.foods;
  const byKey = new Map();
  for (const [aisle, names] of Object.entries(BUILTIN)) {
    for (const name of names.split(',').map((s) => s.trim()).filter(Boolean)) byKey.set(foodKey(name), { name, aisle, builtin: true, key: foodKey(name) });
  }
  for (const f of own) {
    const key = foodKey(f.name);
    if (f.hidden) { byKey.delete(key); continue; }
    byKey.set(key, { ...f, key, builtin: false });
  }
  const list = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache = { sig, foods: list, byKey };
  return list;
}
// The family's record for a food (to change or remove), if they have one.
export const ownFood = (store, name) => store.all('foods').find((f) => foodKey(f.name) === foodKey(name)) || null;

// The food an item is: the same name, or else the longest food named inside it ("boneless
// chicken thighs" → Chicken thighs).
export function matchFood(store, text) {
  foods(store);
  const key = foodKey(text);
  if (!key) return null;
  if (cache.byKey.has(key)) return cache.byKey.get(key);
  const padded = ` ${key} `;
  let best = null;
  for (const f of cache.foods) if (f.key.length > (best?.key.length || 2) && padded.includes(` ${f.key} `)) best = f;
  return best;
}

// Suggestions while typing: names starting with it first, then names containing it.
export function searchFoods(store, q, limit = 8) {
  const key = foodKey(q);
  if (!key) return [];
  const all = foods(store);
  const starts = all.filter((f) => f.key.startsWith(key) || f.name.toLowerCase().startsWith(q.toLowerCase().trim()));
  const has = all.filter((f) => !starts.includes(f) && f.key.includes(key));
  return [...starts, ...has].slice(0, limit);
}

// Which aisle an item belongs in: the one chosen for it, else its food's, else a guess.
export function aisleFor(store, item) {
  return findAisle(store, item.section) || findAisle(store, matchFood(store, item.text)?.aisle) || findAisle(store, guessAisle(item.text)) || findAisle(store, OTHER);
}
