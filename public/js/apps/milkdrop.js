// A MilkDrop-style visualizer in WebGL. Like MilkDrop, every frame starts from the previous frame,
// warped (zoom, rotation, waves, ripples), faded and colour-shifted, and then new waveforms and
// shapes are drawn on top, all driven by the music's bass, mids, treble and beats. A final pass
// adds symmetry (mirrors, kaleidoscope) and "video echo". Presets blend smoothly into each other.

const VERT = `
attribute vec2 pos;
varying vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;

const WARP = `
precision mediump float;
varying vec2 uv;
uniform sampler2D prev;
uniform vec2 texel;
uniform float time, aspect, zoom, rot, warp, warpSpeed, warpScale, decay, ripple, rippleFreq, hue, blur;
uniform vec2 center, shift;
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec2 p = uv - center;
  p.x *= aspect;
  float r = length(p);
  p /= zoom;
  float s = sin(rot), c = cos(rot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p += warp * 0.012 * vec2(sin(p.y * warpScale + time * warpSpeed), cos(p.x * warpScale * 1.13 + time * warpSpeed * 0.87));
  p *= 1.0 + ripple * 0.01 * sin(r * rippleFreq - time * 4.0);
  p.x /= aspect;
  vec2 q = p + center + shift;
  q = abs(mod(q + 1.0, 2.0) - 1.0);            // mirrored wrap at the edges
  vec3 col = texture2D(prev, q).rgb;
  if (blur > 0.0) {
    vec3 n = texture2D(prev, q + vec2(texel.x, 0.0)).rgb + texture2D(prev, q - vec2(texel.x, 0.0)).rgb
           + texture2D(prev, q + vec2(0.0, texel.y)).rgb + texture2D(prev, q - vec2(0.0, texel.y)).rgb;
    col = mix(col, n * 0.25, blur);
  }
  col = hueShift(col, hue);
  // Multiply-then-subtract so 8-bit colours really reach black instead of leaving faint trails.
  gl_FragColor = vec4(max(col * decay - 0.0045, 0.0), 1.0);
}`;

const COMP = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform float sym, segments, aspect, echo, echoZoom, gamma, brightness, time;
void main() {
  vec2 m = uv;
  if (sym > 0.5 && sym < 1.5) m.x = 0.5 + abs(m.x - 0.5);
  else if (sym > 1.5 && sym < 2.5) m = 0.5 + abs(m - 0.5);
  else if (sym > 2.5) {
    vec2 p = m - 0.5;
    p.x *= aspect;
    float seg = 6.2831853 / segments;
    float ang = mod(atan(p.y, p.x) + time * 0.05, seg);
    ang = abs(ang - seg * 0.5);
    p = vec2(cos(ang), sin(ang)) * length(p);
    p.x /= aspect;
    m = p + 0.5;
  }
  vec3 c = texture2D(tex, m).rgb;
  if (echo > 0.0) c = max(c, texture2D(tex, (m - 0.5) / echoZoom + 0.5).rgb * echo);
  c = pow(c, vec3(1.0 / gamma)) * brightness;
  float v = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(aspect, 1.0)));
  gl_FragColor = vec4(c * mix(0.75, 1.0, v), 1.0);
}`;

const LINE_VERT = `
attribute vec2 pos;
attribute vec4 color;
varying vec4 vColor;
void main() { vColor = color; gl_Position = vec4(pos, 0.0, 1.0); }`;
const LINE_FRAG = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

// Wave modes: 0 circle, 1 line, 2 mirrored lines, 3 spiral, 4 x/y scope, 5 spectrum ring, 6 starburst
export const PRESETS = [
  { name: 'Nebula Tunnel', zoom: 1.035, zoomBass: 0.05, rot: 0.004, rotWave: 0.01, warp: 0.6, warpSpeed: 0.8, warpScale: 5, decay: 0.975, ripple: 0, rippleFreq: 20, hueSpeed: 0.004, drift: 0.02, blur: 0.35, wave: 0, waveAmp: 0.32, waveThick: 2.5, hue: 0.62, hueSpread: 0.25, shape: null, particles: true, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.6 },
  { name: 'Liquid Mirror', zoom: 1.01, zoomBass: 0.03, rot: 0, rotWave: 0.02, warp: 2.2, warpSpeed: 1.2, warpScale: 7, decay: 0.965, ripple: 0, rippleFreq: 12, hueSpeed: 0.006, drift: 0.04, blur: 0.25, wave: 2, waveAmp: 0.5, waveThick: 3, hue: 0.5, hueSpread: 0.4, shape: null, particles: false, sym: 1, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.7 },
  { name: 'Solar Flare', zoom: 0.985, zoomBass: -0.04, rot: -0.01, rotWave: 0.01, warp: 0.8, warpSpeed: 0.6, warpScale: 4, decay: 0.97, ripple: 1.2, rippleFreq: 18, hueSpeed: 0.002, drift: 0.01, blur: 0.4, wave: 6, waveAmp: 0.6, waveThick: 2, hue: 0.06, hueSpread: 0.12, shape: { sides: 8, radius: 0.12, alpha: 0.35 }, particles: true, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.8 },
  { name: 'Kaleidoscope Garden', zoom: 1.02, zoomBass: 0.04, rot: 0.012, rotWave: 0.02, warp: 1.2, warpSpeed: 0.9, warpScale: 6, decay: 0.96, ripple: 0, rippleFreq: 10, hueSpeed: 0.008, drift: 0.06, blur: 0.2, wave: 3, waveAmp: 0.35, waveThick: 2.5, hue: 0.33, hueSpread: 0.6, shape: { sides: 6, radius: 0.18, alpha: 0.25 }, particles: false, sym: 3, segments: 8, echo: 0, echoZoom: 1.0, gamma: 1.6 },
  { name: 'Plasma Spiral', zoom: 1.045, zoomBass: 0.06, rot: 0.03, rotWave: 0.02, warp: 0.4, warpSpeed: 1.5, warpScale: 3, decay: 0.955, ripple: 0, rippleFreq: 10, hueSpeed: 0.01, drift: 0, blur: 0.3, wave: 3, waveAmp: 0.4, waveThick: 3, hue: 0.8, hueSpread: 0.5, shape: null, particles: false, sym: 0, segments: 6, echo: 0.6, echoZoom: 1.6, gamma: 1.5 },
  { name: 'Bass Quake', zoom: 1.0, zoomBass: 0.12, rot: 0, rotWave: 0.03, warp: 0.3, warpSpeed: 0.5, warpScale: 4, decay: 0.95, ripple: 2.0, rippleFreq: 26, hueSpeed: 0.003, drift: 0.02, blur: 0.5, wave: 5, waveAmp: 0.35, waveThick: 3, hue: 0.95, hueSpread: 0.2, shape: { sides: 4, radius: 0.2, alpha: 0.3 }, particles: true, sym: 2, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.7 },
  { name: 'Ink in Water', zoom: 1.006, zoomBass: 0.01, rot: 0.002, rotWave: 0.004, warp: 3.2, warpSpeed: 0.35, warpScale: 9, decay: 0.988, ripple: 0, rippleFreq: 10, hueSpeed: 0.0015, drift: 0.05, blur: 0.15, wave: 4, waveAmp: 0.55, waveThick: 1.8, hue: 0.55, hueSpread: 0.3, shape: null, particles: false, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.9 },
  { name: 'Aurora Ribbons', zoom: 1.0, zoomBass: 0.0, rot: 0, rotWave: 0, warp: 1.6, warpSpeed: 0.7, warpScale: 5, decay: 0.98, ripple: 0, rippleFreq: 10, hueSpeed: 0.003, drift: 0, blur: 0.3, wave: 2, waveAmp: 0.35, waveThick: 4, hue: 0.4, hueSpread: 0.45, shape: null, particles: false, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.7, shiftY: -0.006 },
  { name: 'Hyperspace', zoom: 1.08, zoomBass: 0.08, rot: 0, rotWave: 0.005, warp: 0.1, warpSpeed: 1, warpScale: 2, decay: 0.94, ripple: 0, rippleFreq: 10, hueSpeed: 0.002, drift: 0.015, blur: 0.1, wave: 6, waveAmp: 0.4, waveThick: 1.5, hue: 0.6, hueSpread: 0.15, shape: null, particles: true, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.5 },
  { name: 'Glass Ripples', zoom: 1.012, zoomBass: 0.02, rot: 0.003, rotWave: 0.01, warp: 0.5, warpSpeed: 0.8, warpScale: 4, decay: 0.972, ripple: 3.5, rippleFreq: 34, hueSpeed: 0.005, drift: 0.03, blur: 0.2, wave: 0, waveAmp: 0.25, waveThick: 2, hue: 0.5, hueSpread: 0.3, shape: { sides: 12, radius: 0.08, alpha: 0.2 }, particles: false, sym: 2, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.7 },
  { name: 'Fire Vortex', zoom: 1.03, zoomBass: 0.05, rot: -0.04, rotWave: 0.02, warp: 0.9, warpSpeed: 1.1, warpScale: 5, decay: 0.958, ripple: 0, rippleFreq: 10, hueSpeed: 0.0, drift: 0.01, blur: 0.4, wave: 0, waveAmp: 0.4, waveThick: 3.5, hue: 0.03, hueSpread: 0.1, shape: null, particles: true, sym: 0, segments: 6, echo: 0.4, echoZoom: 2.0, gamma: 1.8 },
  { name: 'Neon Spirograph', zoom: 0.995, zoomBass: 0.02, rot: 0.02, rotWave: 0.04, warp: 0.2, warpSpeed: 0.6, warpScale: 3, decay: 0.982, ripple: 0, rippleFreq: 10, hueSpeed: 0.012, drift: 0, blur: 0, wave: 4, waveAmp: 0.7, waveThick: 1.6, hue: 0.85, hueSpread: 0.9, shape: null, particles: false, sym: 3, segments: 5, echo: 0, echoZoom: 1.0, gamma: 1.6 },
  { name: 'Deep Sea Bloom', zoom: 1.015, zoomBass: 0.03, rot: 0.006, rotWave: 0.01, warp: 1.8, warpSpeed: 0.45, warpScale: 6, decay: 0.978, ripple: 0.8, rippleFreq: 14, hueSpeed: 0.002, drift: 0.04, blur: 0.45, wave: 5, waveAmp: 0.3, waveThick: 2.5, hue: 0.5, hueSpread: 0.2, shape: { sides: 5, radius: 0.15, alpha: 0.2 }, particles: true, sym: 0, segments: 6, echo: 0, echoZoom: 1.0, gamma: 1.8 },
  { name: 'Event Horizon', zoom: 0.97, zoomBass: -0.05, rot: 0.025, rotWave: 0.01, warp: 0.7, warpSpeed: 0.9, warpScale: 5, decay: 0.965, ripple: 0, rippleFreq: 10, hueSpeed: 0.004, drift: 0, blur: 0.3, wave: 0, waveAmp: 0.22, waveThick: 4, hue: 0.72, hueSpread: 0.35, shape: { sides: 32, radius: 0.1, alpha: 0.5 }, particles: false, sym: 0, segments: 6, echo: 0.5, echoZoom: 0.7, gamma: 1.6 },
];
const NUMERIC = ['zoom', 'zoomBass', 'rot', 'rotWave', 'warp', 'warpSpeed', 'warpScale', 'decay', 'ripple', 'rippleFreq', 'hueSpeed', 'drift', 'blur', 'waveAmp', 'waveThick', 'hue', 'hueSpread', 'echo', 'echoZoom', 'gamma', 'segments'];
const QUALITY = { low: 0.45, medium: 0.7, high: 1 };

function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

export function createVisualizer(canvas, { getLevels, onPreset = () => {}, quality = 'medium', autoSeconds = 20 } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return createFallback(canvas, { getLevels, onPreset });

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return { p, u, pos: gl.getAttribLocation(p, 'pos'), color: gl.getAttribLocation(p, 'color') };
  };
  const warpP = program(VERT, WARP);
  const compP = program(VERT, COMP);
  const lineP = program(LINE_VERT, LINE_FRAG);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const lineBuf = gl.createBuffer();

  // Two textures we ping-pong between: last frame → warped into → this frame.
  let targets = [];
  let w = 0, h = 0, scale = QUALITY[quality] || QUALITY.medium;
  function makeTarget() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb };
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr)), ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const tw = Math.max(64, Math.min(1600, Math.round(cw * scale))), th = Math.max(64, Math.round(tw * ch / cw));
    if (tw === w && th === h) return;
    w = tw; h = th;
    targets.forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); });
    targets = [makeTarget(), makeTarget()];
  }

  // ---- Presets & blending ----
  let order = PRESETS.map((_, i) => i);
  let presetIndex = Math.floor(Math.random() * PRESETS.length);
  let from = { ...PRESETS[presetIndex] }, to = from, blendStart = 0;
  const BLEND_MS = 2500;
  let lastSwitch = performance.now();
  let locked = false;
  let auto = autoSeconds;
  const params = { ...from };
  function choose(i) {
    presetIndex = (i + PRESETS.length) % PRESETS.length;
    from = { ...params };
    to = PRESETS[presetIndex];
    blendStart = performance.now();
    lastSwitch = blendStart;
    onPreset(to.name);
  }
  function blend(now) {
    const t = Math.min(1, (now - blendStart) / BLEND_MS);
    const e = t * t * (3 - 2 * t);
    for (const k of NUMERIC) params[k] = from[k] + (to[k] - from[k]) * e;
    for (const k of ['wave', 'shape', 'particles', 'sym', 'name', 'shiftY']) params[k] = e < 0.5 ? from[k] : to[k];
    return e;
  }

  // ---- Particles (bursts on beats) ----
  const particles = [];

  // ---- Geometry helpers: thick lines as triangle strips ----
  const verts = [];
  function pushStrip(points, rgba, thick, closed) {
    const n = points.length / 2;
    if (n < 2) return;
    const aspect = canvas.width / canvas.height;
    const wpx = (thick * (canvas.height / 540)) / canvas.height;   // thickness scales with size
    const strip = [];
    for (let i = 0; i < n; i++) {
      const i0 = closed ? (i - 1 + n) % n : Math.max(0, i - 1), i1 = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const tx = (points[i1 * 2] - points[i0 * 2]) * aspect, ty = points[i1 * 2 + 1] - points[i0 * 2 + 1];
      const len = Math.hypot(tx, ty) || 1;
      const nx = (-ty / len) * wpx / aspect, ny = (tx / len) * wpx;
      const x = points[i * 2], y = points[i * 2 + 1];
      strip.push(x + nx, y + ny, ...rgba, x - nx, y - ny, ...rgba);
    }
    if (closed) strip.push(...strip.slice(0, 12));
    // All strips share one draw call: repeat the last vertex of the previous strip and the first
    // of this one, so the triangles joining them have no area and don't show.
    if (verts.length) verts.push(...verts.slice(verts.length - 6), ...strip.slice(0, 6));
    verts.push(...strip);
  }

  function waveformPoints(mode, lv, amp, t) {
    const wave = lv.wave, freq = lv.freq;
    const N = 192, pts = [];
    const aspect = canvas.width / canvas.height;
    const sample = (i) => (wave[Math.floor(i * (wave.length - 1) / N)] - 128) / 128;
    if (mode === 0 || mode === 5) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + t * 0.2;
        const v = mode === 0 ? sample(i) : (freq[Math.floor((i < N / 2 ? i : N - i) * 220 / (N / 2))] / 255);
        const r = (mode === 0 ? 0.42 + v * amp : 0.3 + v * amp * 0.9) * (0.9 + lv.bass * 0.25);
        pts.push(Math.cos(a) * r / aspect, Math.sin(a) * r);
      }
      return [pts, true];
    }
    if (mode === 1 || mode === 2) {
      for (let i = 0; i < N; i++) pts.push(-1 + (2 * i) / (N - 1), sample(i) * amp + (mode === 2 ? 0.35 : 0));
      return [pts, false];
    }
    if (mode === 3) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 6 + t * 0.6;
        const r = 0.05 + (i / N) * 0.75 + sample(i) * amp * 0.25;
        pts.push(Math.cos(a) * r / aspect, Math.sin(a) * r);
      }
      return [pts, false];
    }
    if (mode === 4) {
      const off = Math.floor(N / 4);
      for (let i = 0; i < N; i++) pts.push((sample(i) * amp * 1.4) / aspect, sample((i + off) % N) * amp * 1.4);
      return [pts, false];
    }
    // 6: starburst — spokes from the centre, lengths from the spectrum
    const spokes = 48;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + t * 0.15;
      const v = freq[Math.floor((i < spokes / 2 ? i : spokes - i) * 300 / (spokes / 2))] / 255;
      const r = 0.06 + v * amp * 1.2;
      pts.push(0, 0, Math.cos(a) * r / aspect, Math.sin(a) * r, 0, 0);
    }
    return [pts, false];
  }

  // ---- Render loop ----
  let running = false, raf = 0, frame = 0, t0 = performance.now(), cur = 0;
  function render(now) {
    raf = requestAnimationFrame(render);
    if (!canvas.isConnected || document.hidden || canvas.closest('.window.minimized') || !canvas.clientWidth) return;
    resize();
    const time = (now - t0) / 1000;
    const lv = getLevels();
    if (!lv.active) idle(lv, time);
    if (!locked && auto && now - lastSwitch > auto * 1000) choose(presetIndex + 1);
    const e = blend(now);
    const p = params;
    frame++;

    // 1. Warp last frame into the other buffer.
    const src = targets[cur], dst = targets[1 - cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(warpP.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(warpP.pos);
    gl.vertexAttribPointer(warpP.pos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    const u = warpP.u;
    gl.uniform1i(u.prev, 0);
    gl.uniform2f(u.texel, 1 / w, 1 / h);
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.aspect, w / h);
    gl.uniform1f(u.zoom, p.zoom + p.zoomBass * (lv.bass - lv.bassAtt) * 2 + lv.beat * p.zoomBass * 0.6);
    gl.uniform1f(u.rot, p.rot + Math.sin(time * 0.37) * p.rotWave + (lv.mid - lv.midAtt) * 0.05);
    gl.uniform1f(u.warp, p.warp * (0.6 + lv.treb * 1.5));
    gl.uniform1f(u.warpSpeed, p.warpSpeed);
    gl.uniform1f(u.warpScale, p.warpScale);
    gl.uniform1f(u.decay, p.decay);
    gl.uniform1f(u.ripple, p.ripple * (0.5 + lv.bass * 1.5));
    gl.uniform1f(u.rippleFreq, p.rippleFreq);
    gl.uniform1f(u.hue, p.hueSpeed + lv.beat * 0.02);
    gl.uniform1f(u.blur, p.blur);
    gl.uniform2f(u.center, 0.5 + Math.sin(time * 0.31) * p.drift, 0.5 + Math.cos(time * 0.23) * p.drift);
    gl.uniform2f(u.shift, 0, p.shiftY || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. Draw this frame's waves, shapes and particles on top (additive).
    verts.length = 0;
    const baseHue = p.hue + time * 0.02;
    const waveColor = (k, a) => [...hsv(baseHue + Math.sin(time * 0.5 + k) * p.hueSpread * 0.5, 0.75, 1), a];
    const drawWave = (mode, alpha) => {
      if (alpha <= 0.01) return;
      const [pts, closed] = waveformPoints(mode, lv, p.waveAmp, time);
      if (mode === 6) { for (let i = 0; i < pts.length; i += 6) pushStrip(pts.slice(i, i + 4), waveColor(i, 0.55 * alpha), p.waveThick, false); return; }
      pushStrip(pts, waveColor(0, (0.55 + lv.mid * 0.6) * alpha), p.waveThick, closed);
      if (mode === 2) pushStrip(pts.map((v, i) => (i % 2 ? -v : v)), waveColor(2, (0.55 + lv.mid * 0.6) * alpha), p.waveThick, false);
    };
    // While blending, both presets' waves cross-fade.
    if (from.wave !== to.wave && e < 1) { drawWave(from.wave, 1 - e); drawWave(to.wave, e); } else drawWave(p.wave, 1);

    const shape = e < 0.5 ? from.shape : to.shape;
    if (shape) {
      const pts = [];
      const aspect = canvas.width / canvas.height;
      const r = shape.radius * (1 + lv.bass * 0.9 + lv.beat * 0.4);
      for (let i = 0; i < shape.sides; i++) {
        const a = (i / shape.sides) * Math.PI * 2 + time * 0.6;
        pts.push(Math.cos(a) * r / aspect, Math.sin(a) * r);
      }
      pushStrip(pts, [...hsv(baseHue + 0.5, 0.6, 1), shape.alpha + lv.beat * 0.4], 2.2, true);
    }

    if ((e < 0.5 ? from.particles : to.particles) && lv.beat > 0.99) {
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.006 + Math.random() * 0.02 * (0.5 + lv.bass);
        particles.push({ x: 0, y: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: baseHue + Math.random() * 0.2 });
      }
    }
    const aspect = canvas.width / canvas.height;
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.life -= 0.018;
      if (q.life <= 0 || Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2) { particles.splice(i, 1); continue; }
      pushStrip([q.x / aspect, q.y, (q.x - q.vx * 3) / aspect, q.y - q.vy * 3], [...hsv(q.hue, 0.5, 1), q.life * 0.8], 2.5, false);
    }
    if (particles.length > 600) particles.splice(0, particles.length - 600);

    if (verts.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(lineP.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(lineP.pos);
      gl.vertexAttribPointer(lineP.pos, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(lineP.color);
      gl.vertexAttribPointer(lineP.color, 4, gl.FLOAT, false, 24, 8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts.length / 6);
      gl.disableVertexAttribArray(lineP.color);
      gl.disable(gl.BLEND);
    }

    // 3. Composite to the screen with symmetry, echo and gamma.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(compP.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(compP.pos);
    gl.vertexAttribPointer(compP.pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    const c = compP.u;
    gl.uniform1i(c.tex, 0);
    gl.uniform1f(c.sym, p.sym);
    gl.uniform1f(c.segments, Math.round(p.segments));
    gl.uniform1f(c.aspect, canvas.width / canvas.height);
    gl.uniform1f(c.echo, p.echo);
    gl.uniform1f(c.echoZoom, p.echoZoom);
    gl.uniform1f(c.gamma, p.gamma);
    gl.uniform1f(c.brightness, 1.0);
    gl.uniform1f(c.time, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    cur = 1 - cur;
  }

  // With nothing playing, a gentle synthetic signal keeps the picture alive.
  function idle(lv, t) {
    for (let i = 0; i < lv.wave.length; i++) lv.wave[i] = 128 + Math.sin(i * 0.02 + t * 2) * 30 * (0.6 + 0.4 * Math.sin(t * 0.7));
    for (let i = 0; i < lv.freq.length; i++) lv.freq[i] = Math.max(0, 90 - i * 0.25 + Math.sin(i * 0.15 + t * 3) * 25);
    lv.bass = 0.3 + Math.sin(t * 1.3) * 0.08;
    lv.bassAtt = 0.3;
    lv.mid = 0.25; lv.midAtt = 0.25; lv.treb = 0.15; lv.trebAtt = 0.15;
    lv.beat = 0;
  }

  return {
    start() { if (!running) { running = true; raf = requestAnimationFrame(render); onPreset(PRESETS[presetIndex].name); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    next() { choose(presetIndex + 1); },
    prev() { choose(presetIndex - 1); },
    random() { let i; do { i = Math.floor(Math.random() * PRESETS.length); } while (i === presetIndex && PRESETS.length > 1); choose(i); },
    select(i) { choose(i); },
    setLocked(v) { locked = v; },
    setAuto(sec) { auto = sec; lastSwitch = performance.now(); },
    setQuality(q) { scale = QUALITY[q] || QUALITY.medium; w = 0; },
    get preset() { return PRESETS[presetIndex].name; },
    get frames() { return frame; },
    webgl: true,
  };
}

// Without WebGL: a classic spectrum + oscilloscope on a 2D canvas.
function createFallback(canvas, { getLevels, onPreset }) {
  const g = canvas.getContext('2d');
  let raf = 0, frames = 0;
  const peaks = new Float32Array(48);
  function render() {
    raf = requestAnimationFrame(render);
    if (!canvas.isConnected || document.hidden || !canvas.clientWidth) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const lv = getLevels();
    frames++;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, H);
    const bars = 48, bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = lv.freq[Math.floor(i ** 1.6)] / 255;
      peaks[i] = Math.max(v, peaks[i] - 0.01);
      const bh = v * H * 0.8;
      g.fillStyle = `hsl(${120 - v * 120}, 90%, 50%)`;
      g.fillRect(i * bw + 1, H - bh, bw - 2, bh);
      g.fillRect(i * bw + 1, H - peaks[i] * H * 0.8 - 3, bw - 2, 2);
    }
    g.strokeStyle = '#7CFF7C';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W, y = H / 2 + ((lv.wave[i * 8] - 128) / 128) * H * 0.3;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  return {
    start() { raf = requestAnimationFrame(render); onPreset('Spectrum (basic mode — WebGL unavailable)'); },
    stop() { cancelAnimationFrame(raf); },
    next() {}, prev() {}, random() {}, select() {}, setLocked() {}, setAuto() {}, setQuality() {},
    get preset() { return 'Spectrum'; },
    get frames() { return frames; },
    webgl: false,
  };
}
