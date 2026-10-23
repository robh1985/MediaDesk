// Screensavers. Each one draws into a full-screen container and returns a function that stops it.
// All artwork is drawn in code: these are homages to the Windows and macOS classics.

import { startMaze } from './saver-maze.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canvasIn(container, { transparent = false, dprCap = 1.5 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ss-canvas';
  container.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: transparent });
  const size = { w: 0, h: 0 };
  const fit = () => {
    const dpr = Math.min(devicePixelRatio || 1, dprCap);
    size.w = container.clientWidth || innerWidth;
    size.h = container.clientHeight || innerHeight;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  addEventListener('resize', fit);
  return { canvas, ctx, size, fit, dispose: () => removeEventListener('resize', fit) };
}

function loop(fn) {
  let raf, last = performance.now(), stopped = false;
  const tick = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fn(dt, now / 1000);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

const rand = (a, b) => a + Math.random() * (b - a);
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;

// ---------------------------------------------------------------------------
// Flying Toasters (After Dark, 1989), in isometric 3D
// ---------------------------------------------------------------------------

// World axes: x runs down-right on screen, y down-left and z up. The viewer looks along −(1, 1, 1),
// so only faces pointing +x, +y or +z can be seen, and a larger x + y + z is nearer.
const ISO_C = Math.cos(Math.PI / 6);
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const LIGHT = unit([0.35, 0.6, 1]);
const VIEW = [1, 1, 1];

const poly = (pts, n, color, more) => ({ pts, n, color, ...more });
const lit = (c, n, twoSided, gain = 1) => {
  let d = dot(n, LIGHT);
  if (twoSided) d = Math.abs(d);
  const k = (0.36 + 0.74 * Math.max(0, d)) * gain;
  return `rgb(${Math.min(255, c[0] * k | 0)},${Math.min(255, c[1] * k | 0)},${Math.min(255, c[2] * k | 0)})`;
};
const ellipsePts = (cx, cy, rx, ry, n = 14) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]);

// An axis-aligned box: only its three visible faces.
function box(x0, y0, z0, dx, dy, dz, color, decals = {}, more = {}) {
  const x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
  return [
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color, { decals: decals.top, ...more }),
    poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], color, { decals: decals.front, ...more }),
    poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], color, { decals: decals.side, ...more }),
  ];
}

const CHROME = [206, 212, 222], DARK = [44, 47, 54], FEATHER = [250, 250, 252];
const CRUST = [150, 88, 38], CRUMB = [238, 192, 118];

// The toaster's body never changes; only its wings move.
const TOASTER_BODY = (() => {
  const W = 0.31, L = 0.5, H = 0.36, top = H + 0.001, side = W + 0.001;
  const slot = (x) => ({ pts: [[x, -0.38, top], [x + 0.11, -0.38, top], [x + 0.11, 0.38, top], [x, 0.38, top]], color: '#1b1d22' });
  const dial = { pts: ellipsePts(0.24, -0.06, 0.085, 0.085).map(([y, z]) => [side, y, z]), color: '#2a2d33' };
  const leverSlot = { pts: [[side, -0.28, -0.22], [side, -0.23, -0.22], [side, -0.23, 0.24], [side, -0.28, 0.24]], color: '#1b1d22' };
  const shine = (n) => ({ pts: n === 'front' ? [[-0.24, L + 0.001, -0.28], [-0.16, L + 0.001, -0.28], [-0.16, L + 0.001, 0.28], [-0.24, L + 0.001, 0.28]]
    : [[side, 0.36, -0.28], [side, 0.42, -0.28], [side, 0.42, 0.28], [side, 0.36, 0.28]], color: 'rgba(255,255,255,.55)' });
  const parts = box(-W, -L, -H, W * 2, L * 2, H * 2, CHROME, { top: [slot(-0.17), slot(0.06)], side: [shine('side'), leverSlot, dial], front: [shine('front')] }, { chrome: true });
  parts.push(...box(W, -0.33, 0.1, 0.11, 0.14, 0.08, DARK));                       // lever knob
  for (const [x, y] of [[-W, -L], [W - 0.1, -L], [-W, L - 0.1], [W - 0.1, L - 0.1]]) parts.push(...box(x, y, -H - 0.06, 0.1, 0.1, 0.06, DARK));
  return parts;
})();

// Four overlapping feathers, hinged along the top edge of one side and flapping about the y axis.
function wing(sgn, angle) {
  const base = [sgn * 0.3, 0.02, 0.2];
  const out = [sgn * Math.cos(angle), 0, Math.sin(angle)];
  const n = [out[2] * sgn, 0, -out[0] * sgn];
  const at = (u, v) => [base[0] + v * out[0], base[1] + u, base[2] + v * out[2]];
  const depth = dot(at(0, 0.4), VIEW);
  const dir = unit([-0.42, 1]), perp = [dir[1], -dir[0]];
  const feathers = [];
  for (let i = 3; i >= 0; i--) {
    const uc = 0.3 - i * 0.15, len = 0.95 - i * 0.16, w = 0.12;
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, along = 0.5 * len * (1 - Math.cos(a)), across = w * Math.sin(a) * (1 - 0.35 * (1 - Math.cos(a)) / 2);
      pts.push(at(uc + dir[0] * along + perp[0] * across, dir[1] * along + perp[1] * across));
    }
    feathers.push(poly(pts, n, FEATHER, { twoSided: true, depth: depth + (3 - i) * 1e-3, stroke: 'rgba(90,96,108,.9)' }));
  }
  return feathers;
}

// A slice of toast seen edge-on, tumbling about the x axis.
const TOAST_PROFILE = (() => {
  const pts = [[0.3, -0.34], [0.3, 0.1]];
  for (let i = 0; i <= 16; i++) { const a = -0.15 + (i / 16) * (Math.PI + 0.3); pts.push([0.36 * Math.cos(a), 0.15 + 0.22 * Math.sin(a)]); }
  pts.push([-0.3, 0.1], [-0.3, -0.34]);
  return pts;
})();
function toast(spin) {
  const c = Math.cos(spin), s = Math.sin(spin), T = 0.055;
  const rot = ([y, z]) => [y * c - z * s, y * s + z * c];
  const prof = TOAST_PROFILE.map(rot);
  const inner = TOAST_PROFILE.map(([y, z]) => rot([y * 0.8, (z + 0.03) * 0.8 - 0.03]));
  const polys = [poly(prof.map(([y, z]) => [T, y, z]), [1, 0, 0], CRUST, { decals: [{ pts: inner.map(([y, z]) => [T + 0.001, y, z]), color: CRUMB, lit: true }] })];
  for (let i = 0; i < prof.length; i++) {
    const [y1, z1] = prof[i], [y2, z2] = prof[(i + 1) % prof.length];
    let n = unit([0, z2 - z1, -(y2 - y1)]);
    if (dot(n, [0, (y1 + y2) / 2, (z1 + z2) / 2]) < 0) n = n.map((v) => -v);
    if (dot(n, VIEW) <= 0) continue;
    polys.push(poly([[-T, y1, z1], [-T, y2, z2], [T, y2, z2], [T, y1, z1]], n, CRUST, { gain: 0.85 }));
  }
  return polys;
}

function drawModel(g, polys, sx, sy, S) {
  const proj = ([x, y, z]) => [sx + (x - y) * ISO_C * S, sy + ((x + y) / 2 - z) * S];
  const visible = polys.filter((p) => p.twoSided || dot(p.n, VIEW) > 0);
  for (const p of visible) p.d = p.depth ?? p.pts.reduce((a, q) => a + q[0] + q[1] + q[2], 0) / p.pts.length;
  visible.sort((a, b) => a.d - b.d);
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, S * 0.012);
  for (const p of visible) {
    const pts = p.pts.map(proj);
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    path();
    if (p.chrome) {
      // A brushed-metal sweep across each face.
      const [a, , c] = pts, grad = g.createLinearGradient(a[0], a[1], c[0], c[1]);
      grad.addColorStop(0, lit(p.color, p.n, false, 1.12)); grad.addColorStop(0.45, lit(p.color, p.n, false, 0.82));
      grad.addColorStop(0.7, lit(p.color, p.n, false, 1.05)); grad.addColorStop(1, lit(p.color, p.n, false, 0.9));
      g.fillStyle = grad;
    } else g.fillStyle = lit(p.color, p.n, p.twoSided, p.gain);
    g.fill();
    g.strokeStyle = p.stroke || 'rgba(20,22,28,.75)';
    g.stroke();
    for (const d of p.decals || []) {
      const dp = d.pts.map(proj);
      g.beginPath(); dp.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.fillStyle = d.lit ? lit(d.color, p.n) : d.color;
      g.fill();
    }
  }
}

function flyingToasters(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const S = Math.max(56, Math.min(size.w, size.h) / 7.5);
  // Everything flies along +y while sinking a little, which reads as down and to the left.
  const VX = -ISO_C, VY = 0.5 + 0.25;
  const place = (o, X, Y) => {
    // Pick a world position that lands on screen point (X, Y) at a random depth.
    const D = rand(-6, 6), a = (Y / S + D) / 1.5, diff = X / (S * ISO_C);
    o.x = (a + diff) / 2; o.y = (a - diff) / 2; o.z = D - a;
  };
  const spawn = (o, initial) => {
    o.speed = rand(0.75, 1.35);
    o.size = rand(0.85, 1.1);
    if (initial) place(o, rand(0, size.w * 1.2), rand(-size.h * 0.2, size.h));
    else if (Math.random() < (size.h * ISO_C) / (size.h * ISO_C + size.w * VY)) place(o, size.w + S, rand(-S, size.h * 0.8));
    else place(o, rand(size.w * 0.1, size.w + S), -S);
    return o;
  };
  const items = [];
  const count = Math.round((size.w * size.h) / 100000) + 6;
  for (let i = 0; i < count; i++) items.push(spawn({ toast: i % 4 === 3, phase: rand(0, 6), spin: rand(0, 6), spinRate: rand(-1.4, 1.4) }, true));
  const stop = loop((dt) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.w, size.h);
    for (const o of items) {
      o.y += o.speed * dt;
      o.z -= o.speed * dt * 0.25;
      o.phase += dt * 6.5;
      o.spin += o.spinRate * dt;
      o.sx = (o.x - o.y) * ISO_C * S; o.sy = ((o.x + o.y) / 2 - o.z) * S;
      if (o.sx < -S * 1.5 || o.sy > size.h + S * 1.5) spawn(o, false);
    }
    items.sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z));
    for (const o of items) {
      const s = S * o.size;
      if (o.toast) drawModel(g, toast(o.spin), o.sx, o.sy, s * 1.05);
      else {
        const flap = -0.45 + 1.6 * (0.5 + 0.5 * Math.sin(o.phase));
        drawModel(g, [...TOASTER_BODY, ...wing(1, flap), ...wing(-1, flap)], o.sx, o.sy, s);
      }
    }
  });
  return () => { stop(); dispose(); };
}

// ---------------------------------------------------------------------------
// Starfield (Windows "Starfield Simulation")
// ---------------------------------------------------------------------------

function starfield(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const stars = Array.from({ length: 700 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), pz: 0 }));
  const stop = loop((dt) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.w, size.h);
    const cx = size.w / 2, cy = size.h / 2, f = Math.max(size.w, size.h) * 0.5;
    for (const s of stars) {
      s.pz = s.z;
      s.z -= dt * 0.35;
      if (s.z <= 0.02) { s.x = rand(-1, 1); s.y = rand(-1, 1); s.z = 1; s.pz = 1; }
      const x = cx + (s.x / s.z) * f, y = cy + (s.y / s.z) * f;
      const px = cx + (s.x / s.pz) * f, py = cy + (s.y / s.pz) * f;
      const b = Math.min(1, (1 - s.z) * 1.4);
      g.strokeStyle = `rgba(255,255,255,${b})`;
      g.lineWidth = Math.max(0.6, (1 - s.z) * 3);
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
    }
  });
  return () => { stop(); dispose(); };
}

// ---------------------------------------------------------------------------
// Mystify (Windows "Mystify Your Mind")
// ---------------------------------------------------------------------------

function mystify(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const shapes = [0, 1].map((k) => ({
    hue: k * 180,
    pts: Array.from({ length: 4 }, () => ({ x: rand(0, size.w), y: rand(0, size.h), vx: rand(120, 260) * (Math.random() < 0.5 ? -1 : 1), vy: rand(120, 260) * (Math.random() < 0.5 ? -1 : 1) })),
    trail: [],
  }));
  let acc = 0;
  const stop = loop((dt) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.w, size.h);
    acc += dt;
    for (const sh of shapes) {
      for (const p of sh.pts) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > size.w) { p.vx *= -1; p.x = Math.max(0, Math.min(size.w, p.x)); }
        if (p.y < 0 || p.y > size.h) { p.vy *= -1; p.y = Math.max(0, Math.min(size.h, p.y)); }
      }
      sh.hue += dt * 25;
      if (acc > 0.045) { sh.trail.unshift(sh.pts.map((p) => [p.x, p.y])); sh.trail.length = Math.min(sh.trail.length, 14); }
      sh.trail.forEach((poly, i) => {
        g.strokeStyle = hsl(sh.hue, 100, 60, 1 - i / sh.trail.length);
        g.lineWidth = 1.6;
        g.beginPath();
        poly.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.stroke();
      });
    }
    if (acc > 0.045) acc = 0;
  });
  return () => { stop(); dispose(); };
}

// ---------------------------------------------------------------------------
// 3D Pipes (Windows)
// ---------------------------------------------------------------------------

function pipes(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const N = 12, R = 0.16;
  const COLORS = ['#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa', '#00acc1', '#fb8c00', '#c0c0c0'];
  let used, pipe, segments, fading = 0;
  const yaw = 0.55, pitch = 0.42;
  const project = (x, y, z) => {
    // centre the grid, rotate, then perspective
    x -= N / 2; y -= N / 2; z -= N / 2;
    const cx = Math.cos(yaw) * x - Math.sin(yaw) * z, cz = Math.sin(yaw) * x + Math.cos(yaw) * z;
    const cy = Math.cos(pitch) * y - Math.sin(pitch) * cz, cz2 = Math.sin(pitch) * y + Math.cos(pitch) * cz + N * 1.7;
    const f = Math.min(size.w, size.h) * 1.25 / cz2;
    return [size.w / 2 + cx * f, size.h / 2 - cy * f, f];
  };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const key = (p) => p.join(',');
  const free = (p) => p.every((v) => v >= 0 && v < N) && !used.has(key(p));
  function reset() {
    used = new Set(); segments = 0; pipe = null;
    g.fillStyle = '#000'; g.fillRect(0, 0, size.w, size.h);
  }
  function newPipe() {
    for (let tries = 0; tries < 50; tries++) {
      const p = [0, 0, 0].map(() => Math.floor(rand(0, N)));
      if (free(p)) { used.add(key(p)); pipe = { p, dir: null, color: COLORS[Math.floor(rand(0, COLORS.length))] }; joint(p, pipe.color); return; }
    }
    fading = 1;
  }
  function joint(p, color) {
    const [x, y, f] = project(...p);
    const r = R * 1.35 * f;
    const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.25, color); grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function tube(a, b, color) {
    const [x1, y1, f1] = project(...a), [x2, y2, f2] = project(...b);
    const r = R * (f1 + f2) / 2;
    g.lineCap = 'round';
    for (const [w, c, off] of [[2.1, '#000', 0], [1.9, shade(color, -0.45), 0], [1.35, color, -0.12], [0.55, shade(color, 0.55), -0.45], [0.18, '#fff', -0.6]]) {
      g.strokeStyle = c; g.lineWidth = r * w;
      g.beginPath(); g.moveTo(x1 + off * r, y1 + off * r); g.lineTo(x2 + off * r, y2 + off * r); g.stroke();
    }
  }
  reset();
  let acc = 0;
  const stop = loop((dt) => {
    if (fading > 0) {
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, size.w, size.h);
      fading -= dt * 0.6;
      if (fading <= 0) { fading = 0; reset(); }
      return;
    }
    acc += dt;
    while (acc > 0.05) {
      acc -= 0.05;
      if (!pipe) { newPipe(); continue; }
      const options = DIRS.filter((d) => free(pipe.p.map((v, i) => v + d[i])));
      if (!options.length) { pipe = null; continue; }
      const straight = pipe.dir && options.find((d) => d === pipe.dir);
      const d = straight && Math.random() < 0.75 ? straight : options[Math.floor(rand(0, options.length))];
      const next = pipe.p.map((v, i) => v + d[i]);
      if (pipe.dir && d !== pipe.dir) joint(pipe.p, pipe.color);
      tube(pipe.p, next, pipe.color);
      used.add(key(next));
      pipe.p = next; pipe.dir = d;
      if (++segments > 900) fading = 1;
    }
  });
  return () => { stop(); dispose(); };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)));
  return `rgb(${ch.join(',')})`;
}

// ---------------------------------------------------------------------------
// Bubbles (Windows Vista / 7): soap bubbles floating over the desktop
// ---------------------------------------------------------------------------

function bubbles(container) {
  container.classList.add('ss-transparent');
  const { ctx: g, size, dispose } = canvasIn(container, { transparent: true });
  const list = Array.from({ length: Math.round(Math.max(6, (size.w * size.h) / 120000)) }, () => {
    const r = rand(35, 95);
    return { x: rand(r, size.w - r), y: rand(r, size.h - r), r, vx: rand(-60, 60), vy: rand(-60, 60), hue: rand(0, 360) };
  });
  const stop = loop((dt, t) => {
    g.clearRect(0, 0, size.w, size.h);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.x < a.r || a.x > size.w - a.r) { a.vx *= -1; a.x = Math.max(a.r, Math.min(size.w - a.r, a.x)); }
      if (a.y < a.r || a.y > size.h - a.r) { a.vy *= -1; a.y = Math.max(a.r, Math.min(size.h - a.r, a.y)); }
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d > 0 && d < min) {
          const nx = dx / d, ny = dy / d, p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (p > 0) { a.vx -= p * nx; a.vy -= p * ny; b.vx += p * nx; b.vy += p * ny; }
          const push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
    }
    for (const b of list) {
      const body = g.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r);
      body.addColorStop(0, 'rgba(255,255,255,0.02)'); body.addColorStop(0.85, 'rgba(255,255,255,0.08)'); body.addColorStop(1, 'rgba(255,255,255,0.25)');
      g.fillStyle = body;
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
      // iridescent rim
      const rim = g.createConicGradient ? g.createConicGradient(t * 0.6 + b.hue / 57, b.x, b.y) : null;
      if (rim) [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((s, k) => rim.addColorStop(s, hsl(b.hue + k * 60, 90, 65, 0.55)));
      g.strokeStyle = rim || hsl(b.hue + t * 30, 90, 70, 0.5);
      g.lineWidth = Math.max(2, b.r * 0.06);
      g.beginPath(); g.arc(b.x, b.y, b.r * 0.97, 0, Math.PI * 2); g.stroke();
      // highlights
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.ellipse(b.x - b.r * 0.38, b.y - b.r * 0.42, b.r * 0.22, b.r * 0.12, -0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(b.x + b.r * 0.45, b.y + b.r * 0.5, b.r * 0.1, b.r * 0.05, -0.7, 0, Math.PI * 2); g.fill();
    }
  });
  return () => { stop(); dispose(); };
}

// ---------------------------------------------------------------------------
// Ribbons (Windows 7)
// ---------------------------------------------------------------------------

function ribbons(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const list = Array.from({ length: 5 }, (_, i) => ({
    hue: i * 72 + rand(0, 40), pts: [],
    f: [rand(0.13, 0.27), rand(0.11, 0.23), rand(0.31, 0.5), rand(0.07, 0.17)], ph: [rand(0, 6), rand(0, 6), rand(0, 6), rand(0, 6)],
  }));
  const stop = loop((dt, t) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.w, size.h);
    g.globalCompositeOperation = 'lighter';
    for (const r of list) {
      const x = size.w * (0.5 + 0.42 * Math.sin(t * r.f[0] * 2 + r.ph[0]) * Math.cos(t * r.f[3] + r.ph[3]));
      const y = size.h * (0.5 + 0.4 * Math.sin(t * r.f[1] * 2 + r.ph[1]));
      r.pts.unshift({ x, y, twist: t * r.f[2] * 6 + r.ph[2] });
      if (r.pts.length > 140) r.pts.pop();
      r.hue += dt * 8;
      const width = Math.min(size.w, size.h) * 0.045;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const tw = Math.cos(a.twist - i * 0.06);
        const w = width * (0.15 + 0.85 * Math.abs(tw)) * (1 - i / r.pts.length);
        const nx = (-dy / len) * w, ny = (dx / len) * w;
        const fade = 1 - i / r.pts.length;
        g.fillStyle = hsl(r.hue + i * 0.6, 90, tw > 0 ? 55 : 35, 0.55 * fade);
        g.beginPath();
        g.moveTo(a.x + nx, a.y + ny); g.lineTo(b.x + nx, b.y + ny); g.lineTo(b.x - nx, b.y - ny); g.lineTo(a.x - nx, a.y - ny);
        g.closePath(); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  });
  return () => { stop(); dispose(); };
}

// ---------------------------------------------------------------------------
// Flurry (macOS)
// ---------------------------------------------------------------------------

function flurry(container) {
  const { ctx: g, size, dispose } = canvasIn(container, { dprCap: 1.25 });
  const streams = Array.from({ length: 5 }, (_, i) => ({ hue: i * 70, a: rand(0, 6), spin: rand(0.6, 1.4) * (i % 2 ? 1 : -1) }));
  const parts = [];
  g.fillStyle = '#000'; g.fillRect(0, 0, size.w, size.h);
  const stop = loop((dt, t) => {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, size.w, size.h);
    const cx = size.w / 2 + Math.sin(t * 0.3) * size.w * 0.08, cy = size.h / 2 + Math.cos(t * 0.23) * size.h * 0.08;
    for (const s of streams) {
      s.a += s.spin * dt * 1.4;
      s.hue += dt * 20;
      for (let k = 0; k < 6; k++) {
        const ang = s.a + Math.sin(t * 2 + k) * 0.25;
        const sp = rand(140, 260);
        parts.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, hue: s.hue + rand(-15, 15), curl: s.spin * 1.6 });
      }
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      // curve the motion so streams sweep like Flurry's
      const c = Math.cos(p.curl * dt), sn = Math.sin(p.curl * dt);
      [p.vx, p.vy] = [p.vx * c - p.vy * sn, p.vx * sn + p.vy * c];
      p.vx *= 0.985; p.vy *= 0.985;
      const x0 = p.x, y0 = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt * 0.55;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      g.strokeStyle = hsl(p.hue, 100, 60, p.life * 0.45);
      g.lineWidth = 2 + p.life * 3;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(p.x, p.y); g.stroke();
    }
    if (parts.length > 2500) parts.splice(0, parts.length - 2500);
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, 40);
    core.addColorStop(0, 'rgba(255,255,255,0.5)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.fill();
  });
  return () => { stop(); dispose(); g.globalCompositeOperation = 'source-over'; };
}

// ---------------------------------------------------------------------------
// 3D Text (Windows)
// ---------------------------------------------------------------------------

function text3d(container, opts = {}) {
  const text = (opts.text || 'MediaDesk').slice(0, 40);
  const stage = document.createElement('div');
  stage.className = 'ss-3dtext';
  const obj = document.createElement('div');
  obj.className = 'ss-3dtext-obj';
  const LAYERS = 22;
  for (let i = LAYERS; i >= 0; i--) {
    const s = document.createElement('span');
    s.textContent = text;
    s.className = i === 0 ? 'face' : 'side';
    s.style.transform = `translateZ(${-i * 2.2}px)`;
    if (i) s.style.color = `hsl(220, 15%, ${18 + (1 - i / LAYERS) * 30}%)`;
    obj.append(s);
  }
  stage.append(obj);
  container.append(stage);
  let x = 0.5, y = 0.5, vx = 0.06, vy = 0.045;
  const stop = loop((dt, t) => {
    x += vx * dt; y += vy * dt;
    if (x < 0.25 || x > 0.75) vx *= -1;
    if (y < 0.3 || y > 0.7) vy *= -1;
    obj.style.left = `${x * 100}%`;
    obj.style.top = `${y * 100}%`;
    obj.style.transform = `translate(-50%, -50%) rotateY(${Math.sin(t * 0.6) * 55}deg) rotateX(${Math.sin(t * 0.43) * 25}deg) rotateZ(${Math.sin(t * 0.31) * 8}deg)`;
  });
  return () => { stop(); stage.remove(); };
}

// ---------------------------------------------------------------------------
// Hello (macOS)
// ---------------------------------------------------------------------------

function hello(container) {
  const WORDS = ['hello', 'bonjour', 'hola', 'ciao', 'hallo', 'olá', 'hej', 'привет', 'こんにちは', '你好', 'merhaba', 'namaste'];
  const ns = 'http://www.w3.org/2000/svg';
  const bg = document.createElement('div');
  bg.className = 'ss-hello';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 400');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  bg.append(svg);
  container.append(bg);
  let i = 0, timer;
  const show = () => {
    svg.replaceChildren();
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '500'); t.setAttribute('y', '250'); t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'ss-hello-word');
    t.textContent = WORDS[i % WORDS.length];
    svg.append(t);
    bg.style.setProperty('--hue', String((i * 47) % 360));
    i++;
    timer = setTimeout(show, 5200);
  };
  show();
  return () => { clearTimeout(timer); bg.remove(); };
}

// ---------------------------------------------------------------------------

export const SCREENSAVERS = [
  { id: 'toasters', name: 'Flying Toasters', origin: 'After Dark (Mac & Windows)', start: flyingToasters },
  { id: 'maze', name: '3D Maze', origin: 'Windows 98', start: startMaze },
  { id: 'pipes', name: '3D Pipes', origin: 'Windows 95–XP', start: pipes },
  { id: 'starfield', name: 'Starfield', origin: 'Windows 3.1–XP', start: starfield },
  { id: 'mystify', name: 'Mystify', origin: 'Windows 3.1–7', start: mystify },
  { id: 'text3d', name: '3D Text', origin: 'Windows 98–7', start: text3d },
  { id: 'bubbles', name: 'Bubbles', origin: 'Windows Vista & 7', start: bubbles },
  { id: 'ribbons', name: 'Ribbons', origin: 'Windows Vista & 7', start: ribbons },
  { id: 'flurry', name: 'Flurry', origin: 'macOS', start: flurry },
  { id: 'hello', name: 'Hello', origin: 'macOS', start: hello },
];
