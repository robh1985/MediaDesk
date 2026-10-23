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
// Flying Toasters (After Dark, 1989)
// ---------------------------------------------------------------------------

function drawToaster(g, x, y, s, flap) {
  g.save();
  g.translate(x, y);
  // back wing
  drawWing(g, -0.05 * s, -0.18 * s, s, flap, -1);
  // body
  const body = g.createLinearGradient(0, -0.4 * s, 0, 0.4 * s);
  body.addColorStop(0, '#fbfbfb'); body.addColorStop(0.35, '#c9ced6'); body.addColorStop(0.6, '#8d95a1'); body.addColorStop(1, '#dfe3e8');
  g.fillStyle = body;
  g.strokeStyle = '#3c4048';
  g.lineWidth = Math.max(1, s * 0.03);
  roundRect(g, -0.5 * s, -0.36 * s, s, 0.72 * s, 0.16 * s);
  g.fill(); g.stroke();
  // shine
  g.fillStyle = 'rgba(255,255,255,.55)';
  roundRect(g, -0.4 * s, -0.3 * s, 0.18 * s, 0.5 * s, 0.08 * s);
  g.fill();
  // slots
  g.fillStyle = '#23262c';
  roundRect(g, -0.32 * s, -0.42 * s, 0.26 * s, 0.1 * s, 0.03 * s); g.fill();
  roundRect(g, 0.06 * s, -0.42 * s, 0.26 * s, 0.1 * s, 0.03 * s); g.fill();
  // dial and lever
  g.fillStyle = '#2b2e35';
  g.beginPath(); g.arc(0.22 * s, 0.1 * s, 0.07 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8e8e8';
  roundRect(g, 0.46 * s, -0.12 * s, 0.12 * s, 0.07 * s, 0.03 * s); g.fill(); g.stroke();
  // feet
  g.fillStyle = '#2b2e35';
  roundRect(g, -0.42 * s, 0.34 * s, 0.16 * s, 0.07 * s, 0.03 * s); g.fill();
  roundRect(g, 0.26 * s, 0.34 * s, 0.16 * s, 0.07 * s, 0.03 * s); g.fill();
  // front wing
  drawWing(g, 0.05 * s, -0.12 * s, s, flap, 1);
  g.restore();
}

function drawWing(g, x, y, s, flap, side) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.6 - flap * 0.9);
  g.scale(1, 0.55 + 0.45 * Math.cos(flap * 1.4));
  g.fillStyle = side > 0 ? '#ffffff' : '#d9dde3';
  g.strokeStyle = '#7a808a';
  g.lineWidth = Math.max(1, s * 0.02);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.ellipse(-0.1 * s - i * 0.13 * s, -0.08 * s + i * 0.05 * s, 0.32 * s - i * 0.05 * s, 0.09 * s, -0.25, 0, Math.PI * 2);
    g.fill(); g.stroke();
  }
  g.restore();
}

function drawToast(g, x, y, s, spin) {
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  const w = 0.62 * s, h = 0.66 * s;
  g.fillStyle = '#8a5523';
  breadPath(g, w, h); g.fill();
  const inner = g.createRadialGradient(0, 0.02 * s, 0.05 * s, 0, 0, 0.36 * s);
  inner.addColorStop(0, '#f2c77c'); inner.addColorStop(1, '#c98b3f');
  g.fillStyle = inner;
  breadPath(g, w * 0.82, h * 0.8); g.fill();
  g.restore();
}
function breadPath(g, w, h) {
  g.beginPath();
  g.moveTo(-w / 2, h / 2);
  g.lineTo(-w / 2, -h * 0.15);
  g.bezierCurveTo(-w * 0.62, -h * 0.62, w * 0.62, -h * 0.62, w / 2, -h * 0.15);
  g.lineTo(w / 2, h / 2);
  g.closePath();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function flyingToasters(container) {
  const { ctx: g, size, dispose } = canvasIn(container);
  const scale = Math.max(48, Math.min(size.w, size.h) / 9);
  const spawn = (o, initial) => {
    o.speed = rand(50, 95) * (scale / 70);
    if (initial) { o.x = rand(0, size.w * 1.3); o.y = rand(-size.h * 0.3, size.h); }
    else if (Math.random() < 0.5) { o.x = size.w + scale; o.y = rand(-scale, size.h * 0.7); }
    else { o.x = rand(size.w * 0.2, size.w + scale); o.y = -scale; }
    return o;
  };
  const items = [];
  const count = Math.round((size.w * size.h) / 70000) + 8;
  for (let i = 0; i < count; i++) items.push(spawn({ toast: i % 4 === 3, phase: rand(0, 6), spin: rand(-0.3, 0.3) }, true));
  const stop = loop((dt, t) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.w, size.h);
    items.sort((a, b) => a.y - b.y);
    for (const o of items) {
      o.x -= o.speed * dt;
      o.y += o.speed * dt * 0.55;
      if (o.x < -scale * 1.5 || o.y > size.h + scale * 1.5) spawn(o, false);
      if (o.toast) drawToast(g, o.x, o.y, scale * 0.85, o.spin);
      else drawToaster(g, o.x, o.y, scale, Math.sin(t * 7 + o.phase) * 0.5 + 0.5);
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
