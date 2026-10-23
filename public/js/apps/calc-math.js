// A small maths parser for the Calculator: turns text like "2sin(30)+√(9)^2" into a function,
// without eval. Supports implicit multiplication, factorials, percentages, |abs| bars, constants
// and the usual scientific functions, with trigonometry in degrees, radians or gradians.

const ANGLE = { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200 };

function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}
export function factorial(n) {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  return gamma(n + 1);
}
const choose = (n, k) => factorial(n) / (factorial(k) * factorial(n - k));

// name -> [arity, fn(args, angle)]; arity -1 means "one or more".
const FUNCS = {
  sin: [1, ([x], a) => cleanTrig(Math.sin(x * a))], cos: [1, ([x], a) => cleanTrig(Math.cos(x * a))],
  tan: [1, ([x], a) => { const c = Math.cos(x * a); return Math.abs(c) < 1e-15 ? NaN : cleanTrig(Math.tan(x * a)); }],
  asin: [1, ([x], a) => Math.asin(x) / a], acos: [1, ([x], a) => Math.acos(x) / a], atan: [1, ([x], a) => Math.atan(x) / a],
  sinh: [1, ([x]) => Math.sinh(x)], cosh: [1, ([x]) => Math.cosh(x)], tanh: [1, ([x]) => Math.tanh(x)],
  asinh: [1, ([x]) => Math.asinh(x)], acosh: [1, ([x]) => Math.acosh(x)], atanh: [1, ([x]) => Math.atanh(x)],
  sec: [1, ([x], a) => 1 / Math.cos(x * a)], csc: [1, ([x], a) => 1 / Math.sin(x * a)], cot: [1, ([x], a) => 1 / Math.tan(x * a)],
  ln: [1, ([x]) => Math.log(x)], log: [-1, ([x, b]) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b))],
  log2: [1, ([x]) => Math.log2(x)], exp: [1, ([x]) => Math.exp(x)],
  sqrt: [1, ([x]) => Math.sqrt(x)], cbrt: [1, ([x]) => Math.cbrt(x)], root: [2, ([x, n]) => (x < 0 && n % 2 === 1 ? -((-x) ** (1 / n)) : x ** (1 / n))],
  abs: [1, ([x]) => Math.abs(x)], sign: [1, ([x]) => Math.sign(x)],
  floor: [1, ([x]) => Math.floor(x)], ceil: [1, ([x]) => Math.ceil(x)], round: [-1, ([x, d = 0]) => Math.round(x * 10 ** d) / 10 ** d],
  min: [-1, (xs) => Math.min(...xs)], max: [-1, (xs) => Math.max(...xs)],
  ncr: [2, ([n, k]) => choose(n, k)], npr: [2, ([n, k]) => factorial(n) / factorial(n - k)],
  gamma: [1, ([x]) => gamma(x)], fact: [1, ([x]) => factorial(x)],
  mod: [2, ([a, b]) => ((a % b) + b) % b], rand: [0, () => Math.random()],
};
const ALIASES = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', 'sin⁻¹': 'asin', 'cos⁻¹': 'acos', 'tan⁻¹': 'atan', lg: 'log', sqr: 'sqrt' };
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, 'τ': Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2, 'φ': (1 + Math.sqrt(5)) / 2, inf: Infinity, '∞': Infinity };
// sin(180°) should be 0, not 1.2e-16.
const cleanTrig = (v) => (Math.abs(v) < 1e-14 ? 0 : v);

function tokenize(src) {
  const s = src.replace(/[×·∙]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: parseFloat(num[0]), pos: i }); i += num[0].length; continue; }
    const id = /^([a-zA-Z_]+[0-9]*|π|τ|φ|∞|θ)(⁻¹)?/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase(), pos: i }); i += id[0].length; continue; }
    if ('+-*/^()!%,|√∛²³'.includes(ch)) { out.push({ t: ch, pos: i }); i++; continue; }
    throw new SyntaxError(`Unexpected “${ch}”`);
  }
  return out;
}

// Splits identifiers like "xsin" or "2pix" into known names, so implicit multiplication works.
function splitIdent(word, vars) {
  const known = [...Object.keys(FUNCS), ...Object.keys(ALIASES), ...Object.keys(CONSTS), 'ans', ...vars].sort((a, b) => b.length - a.length);
  const parts = [];
  let rest = word;
  while (rest) {
    const k = known.find((n) => rest.startsWith(n));
    if (!k) return null;
    parts.push(k);
    rest = rest.slice(k.length);
  }
  return parts;
}

export function compile(src, { vars = [] } = {}) {
  let toks = tokenize(src);
  // Expand compound identifiers.
  toks = toks.flatMap((tk) => {
    if (tk.t !== 'id' || FUNCS[tk.v] || ALIASES[tk.v] || tk.v in CONSTS || tk.v === 'ans' || tk.v === 'mod' || vars.includes(tk.v)) return [tk];
    const parts = splitIdent(tk.v, vars);
    if (!parts) throw new SyntaxError(`Unknown name “${tk.v}”`);
    return parts.map((v) => ({ t: 'id', v, pos: tk.pos }));
  });
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t) => { if (peek()?.t !== t) throw new SyntaxError(`Expected “${t}”`); return next(); };
  const startsPrimary = (tk) => tk && (tk.t === 'num' || (tk.t === 'id' && tk.v !== 'mod') || tk.t === '(' || tk.t === '√' || tk.t === '∛' || (tk.t === '|' && !inAbs));
  let inAbs = 0;

  function expr() {
    let left = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t;
      const right = term();
      const l = left;
      // "200 + 10%" means 200 plus 10% of 200, as on a desk calculator.
      if (right.percent) left = op === '+' ? (e) => l(e) * (1 + right(e)) : (e) => l(e) * (1 - right(e));
      else left = op === '+' ? (e) => l(e) + right(e) : (e) => l(e) - right(e);
    }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      const tk = peek();
      if (tk && (tk.t === '*' || tk.t === '/')) {
        next();
        const r = unary(), l = left;
        left = tk.t === '*' ? (e) => l(e) * r(e) : (e) => l(e) / r(e);
      } else if (tk && tk.t === 'id' && tk.v === 'mod') {
        next();
        const r = unary(), l = left;
        left = (e) => { const b = r(e); return ((l(e) % b) + b) % b; };
      } else if (startsPrimary(tk)) {
        const r = power(), l = left;                 // implicit multiplication: 2x, 3(4), 2π
        left = (e) => l(e) * r(e);
      } else return left;
    }
  }
  function unary() {
    const tk = peek();
    if (tk && tk.t === '-') { next(); const u = unary(); return (e) => -u(e); }
    if (tk && tk.t === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek()?.t === '^') {
      next();
      const ex = unary();
      return (e) => base(e) ** ex(e);
    }
    return base;
  }
  function postfix() {
    let v = primary();
    for (;;) {
      const tk = peek();
      if (tk?.t === '!') { next(); const a = v; v = (e) => factorial(a(e)); }
      else if (tk?.t === '²') { next(); const a = v; v = (e) => a(e) ** 2; }
      else if (tk?.t === '³') { next(); const a = v; v = (e) => a(e) ** 3; }
      else if (tk?.t === '%') { next(); const a = v; v = (e) => a(e) / 100; v.percent = true; }
      else return v;
    }
  }
  function args() {
    expect('(');
    const list = [];
    if (peek()?.t !== ')') { list.push(expr()); while (peek()?.t === ',') { next(); list.push(expr()); } }
    expect(')');
    return list;
  }
  function primary() {
    const tk = next();
    if (!tk) throw new SyntaxError('Incomplete expression');
    if (tk.t === 'num') { const v = tk.v; return () => v; }
    if (tk.t === '(') { const v = expr(); if (peek()?.t === ')') next(); else if (peek()) throw new SyntaxError('Expected “)”'); return v; }
    if (tk.t === '|') { inAbs++; const v = expr(); inAbs--; expect('|'); return (e) => Math.abs(v(e)); }
    if (tk.t === '√' || tk.t === '∛') { const v = peek()?.t === '(' ? primary() : postfix(); return tk.t === '√' ? (e) => Math.sqrt(v(e)) : (e) => Math.cbrt(v(e)); }
    if (tk.t === 'id') {
      const name = ALIASES[tk.v] || tk.v;
      if (FUNCS[name]) {
        const [arity, fn] = FUNCS[name];
        let list;
        if (peek()?.t === '(') list = args();
        else if (arity === 0) list = [];
        else list = [power()];                       // "sin 30", "ln x"
        if (arity >= 0 && list.length !== arity) throw new SyntaxError(`${name} needs ${arity} value${arity === 1 ? '' : 's'}`);
        if (arity < 0 && !list.length) throw new SyntaxError(`${name} needs a value`);
        return (e) => fn(list.map((a) => a(e)), e.angle ?? 1);
      }
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      if (name === 'ans') return (e) => e.ans ?? 0;
      if (vars.includes(name)) return (e) => e[name];
      throw new SyntaxError(`Unknown name “${tk.v}”`);
    }
    if (tk.t === ')') throw new SyntaxError('Unexpected “)”');
    throw new SyntaxError(`Unexpected “${tk.t}”`);
  }

  if (!toks.length) throw new SyntaxError('Empty');
  const fn = expr();
  if (p < toks.length) throw new SyntaxError(`Unexpected “${toks[p].t === 'num' || toks[p].t === 'id' ? toks[p].v : toks[p].t}”`);
  return fn;
}

export function evaluate(src, { angle = 'deg', ans = 0 } = {}) {
  return compile(src)({ angle: ANGLE[angle] ?? 1, ans });
}

// Close unbalanced brackets so a half-typed "sin(30" still previews.
export function autoClose(src) {
  let depth = 0;
  for (const ch of src) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); }
  return src + ')'.repeat(depth);
}

export function format(v, digits = 12) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'Error';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, ex] = v.toExponential(digits - 3).split('e');
    return `${String(parseFloat(m))}E${Number(ex)}`;
  }
  const s = String(parseFloat(v.toPrecision(digits)));
  return s.includes('e') ? String(parseFloat(v.toFixed(10))) : s;
}

// Thousands separators for the big display.
export function pretty(text) {
  return text.replace(/(\d+)(\.\d*)?/g, (m, int, frac = '') => (int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int) + frac).replace(/-/g, '−');
}

export const ANGLE_FACTORS = ANGLE;
