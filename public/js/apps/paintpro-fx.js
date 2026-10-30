// Paint Pro's Adjustments and Effects (the ones Pinta has). Each is { id, name, group, params,
// run(src, dst, p) } where src and dst are ImageData of the same size; run writes dst.
// params: [{ key, label, type: 'num' | 'select' | 'check', min, max, step, value, options }].

import { rgbToHsl, hslToRgb } from './paint-common.js';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const num = (key, label, min, max, value, step = 1) => ({ key, label, type: 'num', min, max, value, step });
const sel = (key, label, options, value) => ({ key, label, type: 'select', options, value });
const chk = (key, label, value) => ({ key, label, type: 'check', value });

// Per-pixel colour mapping.
function mapPixels(src, dst, fn) {
  const s = src.data, d = dst.data;
  for (let i = 0; i < s.length; i += 4) {
    const o = fn(s[i], s[i + 1], s[i + 2], s[i + 3], i);
    d[i] = clamp(o[0]); d[i + 1] = clamp(o[1]); d[i + 2] = clamp(o[2]); d[i + 3] = o[3] === undefined ? s[i + 3] : clamp(o[3]);
  }
}

// Fast Gaussian blur: three box blurs, horizontal then vertical, alpha-weighted.
export function blur(src, dst, radius) {
  const { width: w, height: h } = src;
  const r = Math.max(0, radius);
  if (r < 0.5) { dst.data.set(src.data); return; }
  const sizes = boxes(r, 3);
  // Premultiply so transparent pixels don't darken edges.
  let a = new Float32Array(src.data.length);
  for (let i = 0; i < a.length; i += 4) { const al = src.data[i + 3] / 255; a[i] = src.data[i] * al; a[i + 1] = src.data[i + 1] * al; a[i + 2] = src.data[i + 2] * al; a[i + 3] = src.data[i + 3]; }
  let b = new Float32Array(a.length);
  for (const s of sizes) { boxH(a, b, w, h, (s - 1) / 2); boxV(b, a, w, h, (s - 1) / 2); }
  for (let i = 0; i < a.length; i += 4) { const al = a[i + 3] / 255 || 1; dst.data[i] = clamp(a[i] / al); dst.data[i + 1] = clamp(a[i + 1] / al); dst.data[i + 2] = clamp(a[i + 2] / al); dst.data[i + 3] = clamp(a[i + 3]); }
}
function boxes(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}
function boxH(s, d, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) {
    let ti = y * w, li = ti, ri = ti + r;
    const fv = s[ti * 4 + c], lv = s[(ti + w - 1) * 4 + c];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += s[(ti + Math.min(j, w - 1)) * 4 + c];
    for (let j = 0; j <= r; j++) { val += (ri < y * w + w ? s[ri * 4 + c] : lv) - fv; d[ti * 4 + c] = val * iarr; ri++; ti++; }
    for (let j = r + 1; j < w - r; j++) { val += s[ri * 4 + c] - s[li * 4 + c]; d[ti * 4 + c] = val * iarr; ri++; li++; ti++; }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - s[li * 4 + c]; d[ti * 4 + c] = val * iarr; li++; ti++; }
  }
}
function boxV(s, d, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let ti = x, li = ti, ri = ti + r * w;
    const fv = s[ti * 4 + c], lv = s[(ti + w * (h - 1)) * 4 + c];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += s[(ti + Math.min(j, h - 1) * w) * 4 + c];
    for (let j = 0; j <= r; j++) { val += (ri < w * h ? s[ri * 4 + c] : lv) - fv; d[ti * 4 + c] = val * iarr; ri += w; ti += w; }
    for (let j = r + 1; j < h - r; j++) { val += s[ri * 4 + c] - s[li * 4 + c]; d[ti * 4 + c] = val * iarr; li += w; ri += w; ti += w; }
    for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - s[li * 4 + c]; d[ti * 4 + c] = val * iarr; li += w; ti += w; }
  }
}

// 3×3 convolution.
function convolve(src, dst, k, { bias = 0, gray = false } = {}) {
  const { width: w, height: h } = src, s = src.data, d = dst.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      const yy = Math.min(h - 1, Math.max(0, y + ky)), xx = Math.min(w - 1, Math.max(0, x + kx));
      const i = (yy * w + xx) * 4, kv = k[(ky + 1) * 3 + kx + 1];
      r += s[i] * kv; g += s[i + 1] * kv; b += s[i + 2] * kv;
    }
    const o = (y * w + x) * 4;
    if (gray) { const v = clamp(lum(r, g, b) + bias); d[o] = d[o + 1] = d[o + 2] = v; } else { d[o] = clamp(r + bias); d[o + 1] = clamp(g + bias); d[o + 2] = clamp(b + bias); }
    d[o + 3] = s[o + 3];
  }
}

// Bilinear sample (clamped) into out[0..3].
function sample(src, x, y, out) {
  const { width: w, height: h, data: s } = src;
  x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  for (let c = 0; c < 4; c++) out[c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
  return out;
}
// Map each output pixel back to a source position.
function warp(src, dst, fn) {
  const { width: w, height: h } = src, d = dst.data, px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = fn(x, y);
    const o = (y * w + x) * 4;
    if (!p) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
    sample(src, p[0], p[1], px);
    d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
  }
}
// Average of samples along a set of offsets per pixel (for motion/radial/zoom blurs).
function multiSample(src, dst, offsets) {
  const { width: w, height: h } = src, d = dst.data, px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (const [ox, oy] of offsets(x, y)) {
      sample(src, x + ox, y + oy, px);
      const al = px[3] / 255;
      r += px[0] * al; g += px[1] * al; b += px[2] * al; a += px[3]; n++;
    }
    const o = (y * w + x) * 4, al = a / n / 255 || 1;
    d[o] = r / n / al; d[o + 1] = g / n / al; d[o + 2] = b / n / al; d[o + 3] = a / n;
  }
}
// Median (or other rank) of a square neighbourhood, per channel.
function rank(src, dst, radius, pct) {
  const { width: w, height: h } = src, s = src.data, d = dst.data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let y = 0; y < h; y++) {
    hist.forEach((hh) => hh.fill(0));
    let count = 0;
    const add = (x, sign) => {
      if (x < 0 || x >= w) return;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
        const i = (yy * w + x) * 4;
        hist[0][s[i]] += sign; hist[1][s[i + 1]] += sign; hist[2][s[i + 2]] += sign; count += sign;
      }
    };
    for (let x = -radius; x <= radius; x++) add(x, 1);
    for (let x = 0; x < w; x++) {
      const target = count * pct / 100, o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { let acc = 0, v = 0; for (; v < 255; v++) { acc += hist[c][v]; if (acc > target) break; } d[o + c] = v; }
      d[o + 3] = s[o + 3];
      add(x - radius, -1); add(x + radius + 1, 1);
    }
  }
}
const seeded = (seed) => { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };

// Smooth value noise for Clouds.
function noise2(seed) {
  const rnd = seeded(seed), perm = Array.from({ length: 512 }, () => rnd());
  const at = (x, y) => perm[((x & 255) + (((y & 255) * 57) & 255)) & 511];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = sm(x - x0), fy = sm(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export const ADJUSTMENTS = [
  { id: 'autolevel', name: 'Auto Level', instant: true, run(src, dst) {
    const s = src.data, lo = [255, 255, 255], hi = [0, 0, 0];
    for (let i = 0; i < s.length; i += 4) { if (!s[i + 3]) continue; for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], s[i + c]); hi[c] = Math.max(hi[c], s[i + c]); } }
    mapPixels(src, dst, (r, g, b) => [r, g, b].map((v, c) => (hi[c] > lo[c] ? ((v - lo[c]) * 255) / (hi[c] - lo[c]) : v)));
  } },
  { id: 'bw', name: 'Black and White', instant: true, run: (src, dst) => mapPixels(src, dst, (r, g, b) => { const v = lum(r, g, b); return [v, v, v]; }) },
  { id: 'brightness', name: 'Brightness / Contrast', params: [num('brightness', 'Brightness', -100, 100, 0), num('contrast', 'Contrast', -100, 100, 0)], run(src, dst, p) {
    const c = (p.contrast + 100) / 100, k = c * c;
    mapPixels(src, dst, (r, g, b) => [r, g, b].map((v) => (v + p.brightness * 2.55 - 128) * k + 128));
  } },
  { id: 'curves', name: 'Curves', params: [{ key: 'points', type: 'curve', value: [[0, 0], [255, 255]] }, sel('channel', 'Applies to', [['rgb', 'Luminosity / RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], 'rgb')], run(src, dst, p) {
    const lut = curveLut(p.points);
    mapPixels(src, dst, (r, g, b) => (p.channel === 'r' ? [lut[r], g, b] : p.channel === 'g' ? [r, lut[g], b] : p.channel === 'b' ? [r, g, lut[b]] : [lut[r], lut[g], lut[b]]));
  } },
  { id: 'huesat', name: 'Hue / Saturation', params: [num('hue', 'Hue', -180, 180, 0), num('saturation', 'Saturation', 0, 200, 100), num('lightness', 'Lightness', -100, 100, 0)], run(src, dst, p) {
    mapPixels(src, dst, (r, g, b) => {
      let [hh, s, l] = rgbToHsl(r, g, b);
      hh = (hh + p.hue + 360) % 360; s = Math.min(1, s * p.saturation / 100);
      l = p.lightness > 0 ? l + (1 - l) * p.lightness / 100 : l * (1 + p.lightness / 100);
      return hslToRgb(hh, s, l);
    });
  } },
  { id: 'invert', name: 'Invert Colors', instant: true, run: (src, dst) => mapPixels(src, dst, (r, g, b) => [255 - r, 255 - g, 255 - b]) },
  { id: 'levels', name: 'Levels', params: [num('inLow', 'Input black', 0, 254, 0), num('inHigh', 'Input white', 1, 255, 255), num('gamma', 'Gamma', 0.1, 10, 1, 0.05), num('outLow', 'Output black', 0, 255, 0), num('outHigh', 'Output white', 0, 255, 255)], run(src, dst, p) {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const t = Math.max(0, Math.min(1, (v - p.inLow) / Math.max(1, p.inHigh - p.inLow)));
      lut[v] = p.outLow + (p.outHigh - p.outLow) * t ** (1 / p.gamma);
    }
    mapPixels(src, dst, (r, g, b) => [lut[r], lut[g], lut[b]]);
  } },
  { id: 'posterize', name: 'Posterize', params: [num('levels', 'Levels', 2, 64, 6)], run(src, dst, p) {
    const n = p.levels - 1;
    mapPixels(src, dst, (r, g, b) => [r, g, b].map((v) => Math.round((v / 255) * n) * (255 / n)));
  } },
  { id: 'sepia', name: 'Sepia', instant: true, run: (src, dst) => mapPixels(src, dst, (r, g, b) => [r * 0.393 + g * 0.769 + b * 0.189, r * 0.349 + g * 0.686 + b * 0.168, r * 0.272 + g * 0.534 + b * 0.131]) },
];

export function curveLut(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const lut = new Uint8ClampedArray(256);
  // Monotone cubic (Fritsch–Carlson) through the points.
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1; dy[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  m[0] = dy[0] ?? 0;
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
  m[n - 1] = dy[n - 2] ?? 0;
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]) { lut[v] = ys[0]; continue; }
    if (v >= xs[n - 1]) { lut[v] = ys[n - 1]; continue; }
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]) i++;
    const t = (v - xs[i]) / dx[i], t2 = t * t, t3 = t2 * t;
    lut[v] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * dx[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * dx[i] * m[i + 1];
  }
  return lut;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export const EFFECTS = [
  // Artistic
  { id: 'inksketch', group: 'Artistic', name: 'Ink Sketch', params: [num('ink', 'Ink outline', 0, 99, 50), num('color', 'Coloring', 0, 100, 50)], run(src, dst, p) {
    const edges = new ImageData(src.width, src.height);
    convolve(src, edges, [-1, -1, -1, -1, 8, -1, -1, -1, -1], { gray: true });
    const soft = new ImageData(src.width, src.height);
    blur(src, soft, 1.5);
    mapPixels(soft, dst, (r, g, b, a, i) => {
      const e = edges.data[i] * (p.ink / 25), k = p.color / 100, gy = lum(r, g, b);
      const base = [gy + (r - gy) * k, gy + (g - gy) * k, gy + (b - gy) * k];
      const bright = 1.15;
      return base.map((v) => Math.min(255, v * bright) - e);
    });
  } },
  { id: 'oilpaint', group: 'Artistic', name: 'Oil Painting', params: [num('size', 'Brush size', 1, 8, 3), num('coarseness', 'Coarseness', 3, 255, 50)], run(src, dst, p) {
    const { width: w, height: h, data: s } = src, d = dst.data, r = p.size, levels = p.coarseness;
    const cnt = new Uint32Array(levels), sr = new Float64Array(levels), sg = new Float64Array(levels), sb = new Float64Array(levels);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const i = (yy * w + xx) * 4, k = Math.min(levels - 1, ((lum(s[i], s[i + 1], s[i + 2]) * levels) / 256) | 0);
        cnt[k]++; sr[k] += s[i]; sg[k] += s[i + 1]; sb[k] += s[i + 2];
      }
      let best = 0;
      for (let k = 1; k < levels; k++) if (cnt[k] > cnt[best]) best = k;
      const o = (y * w + x) * 4;
      d[o] = sr[best] / cnt[best]; d[o + 1] = sg[best] / cnt[best]; d[o + 2] = sb[best] / cnt[best]; d[o + 3] = s[o + 3];
    }
  } },
  { id: 'pencilsketch', group: 'Artistic', name: 'Pencil Sketch', params: [num('tip', 'Pencil tip size', 1, 20, 2), num('range', 'Color range', -20, 20, 0)], run(src, dst, p) {
    const gray = new ImageData(src.width, src.height);
    mapPixels(src, gray, (r, g, b) => { const v = lum(r, g, b); return [v, v, v]; });
    const inv = new ImageData(src.width, src.height);
    mapPixels(gray, inv, (r) => [255 - r, 255 - r, 255 - r]);
    const bl = new ImageData(src.width, src.height);
    blur(inv, bl, p.tip);
    mapPixels(gray, dst, (r, g, b, a, i) => { const v = Math.min(255, (r * 256) / Math.max(1, 255 - bl.data[i])) + p.range * 4; return [v, v, v]; });
  } },
  // Blurs
  { id: 'fragment', group: 'Blurs', name: 'Fragment', params: [num('fragments', 'Fragments', 2, 50, 4), num('distance', 'Distance', 0, 100, 8), num('rotation', 'Rotation', 0, 360, 0)], run(src, dst, p) {
    const offs = Array.from({ length: p.fragments }, (_, i) => { const a = ((p.rotation + (360 * i) / p.fragments) * Math.PI) / 180; return [Math.cos(a) * p.distance, Math.sin(a) * p.distance]; });
    multiSample(src, dst, () => offs);
  } },
  { id: 'gaussian', group: 'Blurs', name: 'Gaussian Blur', params: [num('radius', 'Radius', 0, 200, 2)], run: (src, dst, p) => blur(src, dst, p.radius / 2) },
  { id: 'motion', group: 'Blurs', name: 'Motion Blur', params: [num('angle', 'Angle', -180, 180, 25), num('distance', 'Distance', 1, 200, 10), chk('centered', 'Centered', true)], run(src, dst, p) {
    const a = (p.angle * Math.PI) / 180, n = Math.max(2, Math.min(64, Math.round(p.distance)));
    const offs = Array.from({ length: n }, (_, i) => { const t = p.centered ? i / (n - 1) - 0.5 : -i / (n - 1); return [Math.cos(a) * p.distance * t, Math.sin(a) * p.distance * t]; });
    multiSample(src, dst, () => offs);
  } },
  { id: 'radial', group: 'Blurs', name: 'Radial Blur', params: [num('angle', 'Angle', 0, 360, 2), num('cx', 'Center X (%)', 0, 100, 50), num('cy', 'Center Y (%)', 0, 100, 50)], run(src, dst, p) {
    const cx = (src.width * p.cx) / 100, cy = (src.height * p.cy) / 100, a = (p.angle * Math.PI) / 180, n = 12;
    multiSample(src, dst, (x, y) => Array.from({ length: n }, (_, i) => { const t = (i / (n - 1) - 0.5) * a, dx = x - cx, dy = y - cy; return [dx * Math.cos(t) - dy * Math.sin(t) + cx - x, dx * Math.sin(t) + dy * Math.cos(t) + cy - y]; }));
  } },
  { id: 'unfocus', group: 'Blurs', name: 'Unfocus', params: [num('radius', 'Radius', 1, 100, 4)], run(src, dst, p) {
    const offs = [];
    for (let i = 0; i < 24; i++) { const a = i * 2.39996, r = p.radius * Math.sqrt((i + 0.5) / 24); offs.push([Math.cos(a) * r, Math.sin(a) * r]); }
    multiSample(src, dst, () => offs);
  } },
  { id: 'zoomblur', group: 'Blurs', name: 'Zoom Blur', params: [num('amount', 'Amount', 0, 100, 10), num('cx', 'Center X (%)', 0, 100, 50), num('cy', 'Center Y (%)', 0, 100, 50)], run(src, dst, p) {
    const cx = (src.width * p.cx) / 100, cy = (src.height * p.cy) / 100, n = 12;
    multiSample(src, dst, (x, y) => Array.from({ length: n }, (_, i) => { const t = (i / (n - 1)) * p.amount / 100; return [(cx - x) * t, (cy - y) * t]; }));
  } },
  // Distort
  { id: 'bulge', group: 'Distort', name: 'Bulge', params: [num('amount', 'Amount', -200, 100, 45), num('cx', 'Center X (%)', 0, 100, 50), num('cy', 'Center Y (%)', 0, 100, 50)], run(src, dst, p) {
    const cx = (src.width * p.cx) / 100, cy = (src.height * p.cy) / 100, R = Math.min(src.width, src.height) / 2, k = p.amount / 100;
    warp(src, dst, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R; if (r >= 1) return [x, y]; const f = 1 - k * (1 - r) * (1 - r); return [cx + dx * f, cy + dy * f]; });
  } },
  { id: 'frosted', group: 'Distort', name: 'Frosted Glass', params: [num('amount', 'Scatter', 1, 20, 4), num('seed', 'Random seed', 0, 9999, 7)], run(src, dst, p) {
    const rnd = seeded(p.seed);
    warp(src, dst, (x, y) => [x + (rnd() - 0.5) * 2 * p.amount, y + (rnd() - 0.5) * 2 * p.amount]);
  } },
  { id: 'pixelate', group: 'Distort', name: 'Pixelate', params: [num('size', 'Cell size', 2, 100, 8)], run(src, dst, p) {
    const { width: w, height: h, data: s } = src, d = dst.data, n = p.size;
    for (let by = 0; by < h; by += n) for (let bx = 0; bx < w; bx += n) {
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let y = by; y < Math.min(h, by + n); y++) for (let x = bx; x < Math.min(w, bx + n); x++) { const i = (y * w + x) * 4; r += s[i]; g += s[i + 1]; b += s[i + 2]; a += s[i + 3]; c++; }
      for (let y = by; y < Math.min(h, by + n); y++) for (let x = bx; x < Math.min(w, bx + n); x++) { const i = (y * w + x) * 4; d[i] = r / c; d[i + 1] = g / c; d[i + 2] = b / c; d[i + 3] = a / c; }
    }
  } },
  { id: 'polar', group: 'Distort', name: 'Polar Inversion', params: [num('amount', 'Amount', 1, 4, 2, 0.1)], run(src, dst, p) {
    const cx = src.width / 2, cy = src.height / 2, R = Math.min(cx, cy);
    warp(src, dst, (x, y) => { const dx = (x - cx) / R, dy = (y - cy) / R, r2 = dx * dx + dy * dy || 1e-6; const f = p.amount / r2; return [cx + ((dx * f) % 2) * R * 0.5, cy + ((dy * f) % 2) * R * 0.5]; });
  } },
  { id: 'tile', group: 'Distort', name: 'Tile Reflection', params: [num('size', 'Tile size', 2, 200, 40), num('curvature', 'Curvature', -100, 100, 8), num('angle', 'Angle', -45, 45, 30)], run(src, dst, p) {
    const a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), s = p.size, k = p.curvature / 100;
    warp(src, dst, (x, y) => {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const fu = ((u % s) + s) % s / s - 0.5, fv = ((v % s) + s) % s / s - 0.5;
      const du = Math.sin(fu * Math.PI) * k * s, dv = Math.sin(fv * Math.PI) * k * s;
      return [x + du * ca - dv * sa, y + du * sa + dv * ca];
    });
  } },
  { id: 'twist', group: 'Distort', name: 'Twist', params: [num('amount', 'Amount', -100, 100, 30), num('size', 'Size (%)', 1, 100, 100)], run(src, dst, p) {
    const cx = src.width / 2, cy = src.height / 2, R = (Math.min(cx, cy) * p.size) / 100, k = (p.amount / 100) * Math.PI * 2;
    warp(src, dst, (x, y) => { const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R) return [x, y]; const t = k * (1 - r / R) ** 2; return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)]; });
  } },
  { id: 'dents', group: 'Distort', name: 'Dents', params: [num('scale', 'Scale', 1, 200, 25), num('refraction', 'Refraction', 0, 50, 8), num('seed', 'Random seed', 0, 9999, 3)], run(src, dst, p) {
    const n1 = noise2(p.seed), n2 = noise2(p.seed + 99);
    warp(src, dst, (x, y) => [x + (n1(x / p.scale, y / p.scale) - 0.5) * 2 * p.refraction, y + (n2(x / p.scale, y / p.scale) - 0.5) * 2 * p.refraction]);
  } },
  // Noise
  { id: 'addnoise', group: 'Noise', name: 'Add Noise', params: [num('intensity', 'Intensity', 0, 100, 64), num('color', 'Color saturation', 0, 400, 100), num('coverage', 'Coverage', 0, 100, 100), num('seed', 'Random seed', 0, 9999, 1)], run(src, dst, p) {
    const rnd = seeded(p.seed), amt = p.intensity * 1.2, sat = p.color / 100;
    mapPixels(src, dst, (r, g, b) => {
      if (rnd() * 100 > p.coverage) return [r, g, b];
      const n = (rnd() - 0.5) * amt, nr = (rnd() - 0.5) * amt * sat, ng = (rnd() - 0.5) * amt * sat, nb = (rnd() - 0.5) * amt * sat;
      return [r + n + nr, g + n + ng, b + n + nb];
    });
  } },
  { id: 'median', group: 'Noise', name: 'Median', params: [num('radius', 'Radius', 1, 20, 2), num('percentile', 'Percentile', 0, 100, 50)], run: (src, dst, p) => rank(src, dst, p.radius, p.percentile) },
  { id: 'reducenoise', group: 'Noise', name: 'Reduce Noise', params: [num('radius', 'Radius', 1, 20, 3), num('strength', 'Strength', 0, 100, 40)], run(src, dst, p) {
    const med = new ImageData(src.width, src.height);
    rank(src, med, p.radius, 50);
    const k = p.strength / 100;
    mapPixels(src, dst, (r, g, b, a, i) => [r + (med.data[i] - r) * k, g + (med.data[i + 1] - g) * k, b + (med.data[i + 2] - b) * k]);
  } },
  // Photo
  { id: 'glow', group: 'Photo', name: 'Glow', params: [num('radius', 'Radius', 1, 20, 6), num('brightness', 'Brightness', -100, 100, 10), num('contrast', 'Contrast', -100, 100, 10)], run(src, dst, p) {
    const bl = new ImageData(src.width, src.height);
    blur(src, bl, p.radius);
    const c = (p.contrast + 100) / 100;
    mapPixels(src, dst, (r, g, b, a, i) => [r, g, b].map((v, k) => { const s = ((bl.data[i + k] + p.brightness * 2 - 128) * c + 128); return 255 - ((255 - v) * (255 - Math.max(0, Math.min(255, s)))) / 255; }));
  } },
  { id: 'redeye', group: 'Photo', name: 'Red Eye Removal', params: [num('tolerance', 'Tolerance', 0, 100, 70), num('saturation', 'Saturation percentage', 0, 100, 90)], run(src, dst, p) {
    const t = 1 + (100 - p.tolerance) / 50;
    mapPixels(src, dst, (r, g, b) => (r > (g + b) / 2 * t && r > 60 ? [Math.min(r, (g + b) / 2) * (1 - p.saturation / 100) + r * (p.saturation / 100) * 0.35, g, b] : [r, g, b]));
  } },
  { id: 'sharpen', group: 'Photo', name: 'Sharpen', params: [num('amount', 'Amount', 1, 20, 10)], run(src, dst, p) {
    const k = p.amount / 10;
    convolve(src, dst, [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]);
  } },
  { id: 'softportrait', group: 'Photo', name: 'Soft Portrait', params: [num('softness', 'Softness', 0, 10, 5), num('lighting', 'Lighting', -20, 20, 0), num('warmth', 'Warmth', 0, 20, 10)], run(src, dst, p) {
    const bl = new ImageData(src.width, src.height);
    blur(src, bl, p.softness);
    mapPixels(bl, dst, (r, g, b, a, i) => {
      const s = src.data, k = 0.5;
      const rr = s[i] * k + r * (1 - k), gg = s[i + 1] * k + g * (1 - k), bb = s[i + 2] * k + b * (1 - k);
      const l = p.lighting * 2;
      return [rr + l + p.warmth, gg + l + p.warmth * 0.4, bb + l - p.warmth * 0.6];
    });
  } },
  { id: 'vignette', group: 'Photo', name: 'Vignette', params: [num('radius', 'Radius (%)', 10, 200, 70), num('strength', 'Strength', 0, 100, 60), num('cx', 'Center X (%)', 0, 100, 50), num('cy', 'Center Y (%)', 0, 100, 50)], run(src, dst, p) {
    const { width: w, height: h } = src, cx = (w * p.cx) / 100, cy = (h * p.cy) / 100, R = (Math.hypot(w, h) / 2) * (p.radius / 100);
    mapPixels(src, dst, (r, g, b, a, i) => { const x = (i / 4) % w, y = Math.floor(i / 4 / w); const d = Math.hypot(x - cx, y - cy) / R; const f = 1 - Math.min(1, Math.max(0, (d - 0.4) / 0.8)) ** 2 * (p.strength / 100); return [r * f, g * f, b * f]; });
  } },
  // Render
  { id: 'clouds', group: 'Render', name: 'Clouds', params: [num('scale', 'Scale', 2, 1000, 250), num('power', 'Power', 0, 100, 50), num('seed', 'Random seed', 0, 9999, 1), sel('blend', 'Blend mode', [['normal', 'Normal'], ['multiply', 'Multiply'], ['overlay', 'Overlay']], 'normal')], colors: true, run(src, dst, p, ctx) {
    const nz = noise2(p.seed), [c1, c2] = [ctx.primary, ctx.secondary], pw = p.power / 100;
    mapPixels(src, dst, (r, g, b, a, i) => {
      const x = (i / 4) % src.width, y = Math.floor(i / 4 / src.width);
      let v = 0, amp = 1, f = 1 / p.scale, tot = 0;
      for (let o = 0; o < 8; o++) { v += nz(x * f, y * f) * amp; tot += amp; amp *= pw; f *= 2; }
      v /= tot;
      const cr = c1[0] + (c2[0] - c1[0]) * v, cg = c1[1] + (c2[1] - c1[1]) * v, cb = c1[2] + (c2[2] - c1[2]) * v;
      if (p.blend === 'multiply') return [(r * cr) / 255, (g * cg) / 255, (b * cb) / 255];
      if (p.blend === 'overlay') return [[r, cr], [g, cg], [b, cb]].map(([s, c]) => (s < 128 ? (2 * s * c) / 255 : 255 - (2 * (255 - s) * (255 - c)) / 255));
      return [cr, cg, cb, 255];
    });
  } },
  { id: 'julia', group: 'Render', name: 'Julia Fractal', params: [num('factor', 'Factor', 1, 10, 4), num('quality', 'Quality', 1, 5, 2), num('zoom', 'Zoom', 0, 50, 1), num('angle', 'Angle', -180, 180, 0)], run(src, dst, p) {
    const { width: w, height: h } = src, z = 1 + p.zoom, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), max = 32 * p.quality;
    mapPixels(src, dst, (r, g, b, al, i) => {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      let x = ((px - w / 2) / (Math.min(w, h) / 2.6)) / z, y = ((py - h / 2) / (Math.min(w, h) / 2.6)) / z;
      [x, y] = [x * ca - y * sa, x * sa + y * ca];
      let n = 0;
      while (n < max && x * x + y * y < 4) { const t = x * x - y * y - 0.75; y = 2 * x * y + 0.1; x = t; n++; }
      const v = n / max;
      return [255 * Math.min(1, v * p.factor * 0.6), 255 * Math.min(1, v * p.factor * 0.35), 255 * Math.min(1, v * 1.5), 255];
    });
  } },
  { id: 'mandelbrot', group: 'Render', name: 'Mandelbrot Fractal', params: [num('factor', 'Factor', 1, 10, 1), num('quality', 'Quality', 1, 5, 2), num('zoom', 'Zoom', 0, 50, 0), chk('invert', 'Invert colors', false)], run(src, dst, p) {
    const { width: w, height: h } = src, z = 1 + p.zoom, max = 48 * p.quality;
    mapPixels(src, dst, (r, g, b, al, i) => {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const cx = ((px - w * 0.62) / (Math.min(w, h) / 2.4)) / z, cy = ((py - h / 2) / (Math.min(w, h) / 2.4)) / z;
      let x = 0, y = 0, n = 0;
      while (n < max && x * x + y * y < 4) { const t = x * x - y * y + cx; y = 2 * x * y + cy; x = t; n++; }
      let v = n === max ? 0 : (n / max) ** 0.5;
      if (p.invert) v = 1 - v;
      return [255 * Math.min(1, v * 1.4 * p.factor), 255 * v ** 1.5, 255 * Math.min(1, v * 2.2), 255];
    });
  } },
  // Stylize
  { id: 'edge', group: 'Stylize', name: 'Edge Detect', params: [num('angle', 'Angle', -180, 180, 45)], run(src, dst, p) {
    const a = (p.angle * Math.PI) / 180, cx = Math.cos(a), cy = Math.sin(a);
    const k = [-cx - cy, -cy * 2, cx - cy, -cx * 2, 0, cx * 2, -cx + cy, cy * 2, cx + cy].map((v) => v / 2);
    convolve(src, dst, k, { bias: 128 });
  } },
  { id: 'emboss', group: 'Stylize', name: 'Emboss', params: [num('angle', 'Angle', 0, 360, 0)], run(src, dst, p) {
    const a = (p.angle * Math.PI) / 180, dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a));
    const k = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    k[(1 - dy) * 3 + (1 - dx)] = -1; k[(1 + dy) * 3 + (1 + dx)] = 1; if (!dx && !dy) k[5] = 1;
    convolve(src, dst, k.map((v) => v * 2), { bias: 128, gray: true });
  } },
  { id: 'outline', group: 'Stylize', name: 'Outline', params: [num('thickness', 'Thickness', 1, 50, 3), num('intensity', 'Intensity', 0, 100, 50)], run(src, dst, p) {
    const lo = new ImageData(src.width, src.height), hi = new ImageData(src.width, src.height);
    rank(src, lo, p.thickness, 10); rank(src, hi, p.thickness, 90);
    const k = p.intensity / 100;
    mapPixels(src, dst, (r, g, b, a, i) => [0, 1, 2].map((c) => 255 - (hi.data[i + c] - lo.data[i + c]) * (0.5 + k * 1.5)));
  } },
  { id: 'relief', group: 'Stylize', name: 'Relief', params: [num('angle', 'Angle', 0, 360, 45)], run(src, dst, p) {
    const a = (p.angle * Math.PI) / 180, cx = Math.cos(a), cy = Math.sin(a);
    convolve(src, dst, [-cx - cy, -cy, cx - cy, -cx, 1, cx, -cx + cy, cy, cx + cy]);
  } },
  { id: 'dither', group: 'Stylize', name: 'Dithering', params: [sel('palette', 'Palette', [['bw', 'Black and white'], ['web', 'Web-safe (216)'], ['8', '8 colours']], 'bw')], run(src, dst, p) {
    const { width: w, height: h } = src, buf = new Float32Array(src.data);
    const q = (v) => (p.palette === 'bw' ? null : p.palette === 'web' ? Math.round(v / 51) * 51 : v < 128 ? 0 : 255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let out;
      if (p.palette === 'bw') { const l = lum(buf[i], buf[i + 1], buf[i + 2]); const v = l < 128 ? 0 : 255; out = [v, v, v]; } else out = [q(buf[i]), q(buf[i + 1]), q(buf[i + 2])];
      for (let c = 0; c < 3; c++) {
        const err = buf[i + c] - out[c];
        if (x + 1 < w) buf[i + 4 + c] += (err * 7) / 16;
        if (y + 1 < h) { if (x > 0) buf[i + w * 4 - 4 + c] += (err * 3) / 16; buf[i + w * 4 + c] += (err * 5) / 16; if (x + 1 < w) buf[i + w * 4 + 4 + c] += err / 16; }
        dst.data[i + c] = out[c];
      }
      dst.data[i + 3] = src.data[i + 3];
    }
  } },
];
