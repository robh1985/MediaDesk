// 3D Maze, after the Windows 98 OpenGL screensaver: a walk through a brick maze with a textured
// floor and ceiling, OpenGL signs on the walls, rats scurrying about, spinning grey polyhedra that
// turn the world upside down when you walk through them, and a smiley face waiting at the exit.
// Rendered by raycasting at a low resolution and scaled up, like the blocky original.

const TEX = 64;
const WALL = 0.72;                                              // wall height as a share of corridor width
const abgr = (r, g, b) => (255 << 24) | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r);
const clamp = (v) => Math.max(0, Math.min(255, v | 0));
const noise = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

function makeBrick() {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) {
    const row = Math.floor(y / 16), off = row % 2 ? 16 : 0;
    for (let x = 0; x < TEX; x++) {
      const mortar = y % 16 < 2 || (x + off) % 32 < 2;
      const brick = Math.floor((x + off) / 32) + row * 3;
      const n = ((brick * 2654435761) >>> 24) / 255;
      const grain = noise(x, y);
      if (mortar) { const m = 168 + grain * 24; t[y * TEX + x] = abgr(m, m - 4, m - 10); }
      else t[y * TEX + x] = abgr(158 + n * 46 + grain * 22, 58 + n * 22 + grain * 12, 38 + n * 14 + grain * 6);
    }
  }
  return t;
}

// Grey flagstones for the floor.
function makeFloor() {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const seam = x % 32 < 2 || y % 32 < 2;
    const tile = (x >> 5) + (y >> 5) * 2, tint = ((tile * 2246822519) >>> 26) / 64;
    const g = seam ? 60 : 108 + tint * 30 + noise(x, y) * 26 - noise(x >> 2, y >> 2) * 14;
    t[y * TEX + x] = abgr(g, g - 2, g + 4);
  }
  return t;
}

// Speckled acoustic tiles for the ceiling.
function makeCeiling() {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const seam = x % 32 < 2 || y % 32 < 2;
    const speck = noise(x * 3.1, y * 1.7) > 0.86 ? -50 : 0;
    const g = seam ? 150 : 214 + noise(x, y) * 22 + speck;
    t[y * TEX + x] = abgr(g, g - 3, g - 12);
  }
  return t;
}

// Draw a texture with the 2D canvas API and read it back as pixels.
function paintTexture(draw, size = TEX) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, size);
  return new Uint32Array(g.getImageData(0, 0, size, size).data.buffer.slice(0));
}

const makeOpenGL = () => paintTexture((g, s) => {
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#7a7a7a'; g.lineWidth = 2; g.strokeRect(3, 14, s - 6, s - 28);
  g.fillStyle = '#5a7fbf'; g.fillRect(5, 16, 14, s - 32);                   // the blue swoosh panel
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(12, s / 2, 4, 11, 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0d2a6e'; g.font = 'italic bold 15px Arial, sans-serif'; g.textBaseline = 'middle';
  g.fillText('Open', 21, s / 2 - 7);
  g.fillStyle = '#c4161c'; g.font = 'bold 17px Arial, sans-serif';
  g.fillText('GL', 25, s / 2 + 9);
});

const makeSmiley = () => paintTexture((g, s) => {
  g.fillStyle = '#ffd700'; g.strokeStyle = '#000'; g.lineWidth = 3;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#000';
  g.beginPath(); g.ellipse(s * 0.36, s * 0.38, 4, 6, 0, 0, Math.PI * 2); g.ellipse(s * 0.64, s * 0.38, 4, 6, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.beginPath(); g.arc(s / 2, s / 2, s * 0.26, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
});

// A grey rat seen from the side, nose to the left.
const makeRat = () => paintTexture((g, s) => {
  g.strokeStyle = '#8c7a78'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(44, 48); g.bezierCurveTo(56, 50, 60, 40, 63, 30); g.stroke();      // tail
  g.fillStyle = '#7d7f86';
  g.beginPath(); g.ellipse(32, 48, 15, 9, 0, 0, Math.PI * 2); g.fill();                        // body
  g.beginPath(); g.moveTo(20, 42); g.quadraticCurveTo(10, 44, 6, 50); g.quadraticCurveTo(12, 54, 22, 53); g.fill(); // head
  g.fillStyle = '#d9a3a3'; g.beginPath(); g.arc(19, 41, 4, 0, Math.PI * 2); g.fill();          // ear
  g.fillStyle = '#000'; g.fillRect(12, 46, 2, 2); g.fillRect(5, 49, 2, 2);                     // eye, nose
  g.fillStyle = '#5c5e64'; g.fillRect(24, 55, 3, 3); g.fillRect(38, 55, 3, 3);                 // feet
});

// The spinning grey icosahedron, redrawn each frame into a small texture.
const ICO = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]];
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
function polyhedronPainter() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d', { willReadFrequently: true });
  return (angle) => {
    g.clearRect(0, 0, TEX, TEX);
    const ca = Math.cos(angle), sa = Math.sin(angle), cb = Math.cos(angle * 0.7), sb = Math.sin(angle * 0.7);
    const pts = ICO.v.map(([x, y, z]) => {
      const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      return [x1, y1, z2];
    });
    const faces = ICO.f.map((f) => {
      const [a, b, d] = f.map((i) => pts[i]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const len = Math.hypot(...n);
      return { pts: [a, b, d], nz: n[2] / len, light: (n[0] * -0.4 + n[1] * -0.5 + n[2] * 0.75) / len, z: a[2] + b[2] + d[2] };
    }).filter((f) => f.nz > 0).sort((x, y) => x.z - y.z);
    const S = TEX / 4.2;
    for (const f of faces) {
      const k = 70 + Math.max(0, f.light) * 170;
      g.fillStyle = `rgb(${k},${k},${k + 6})`;
      g.strokeStyle = g.fillStyle;
      g.beginPath();
      f.pts.forEach(([x, y], i) => (i ? g.lineTo(TEX / 2 + x * S, TEX / 2 + y * S) : g.moveTo(TEX / 2 + x * S, TEX / 2 + y * S)));
      g.closePath(); g.fill(); g.stroke();
    }
    return new Uint32Array(g.getImageData(0, 0, TEX, TEX).data.buffer);
  };
}

function generate(n) {
  const G = n * 2 + 1;
  const map = Array.from({ length: G }, () => new Uint8Array(G).fill(1));
  const stack = [[1, 1]];
  map[1][1] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx > 0 && ny > 0 && nx < G - 1 && ny < G - 1 && map[ny][nx] === 1;
    });
    if (!dirs.length) { stack.pop(); continue; }
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
    map[y + dy / 2][x + dx / 2] = 0;
    map[y + dy][x + dx] = 0;
    stack.push([x + dx, y + dy]);
  }
  return { map, G, exit: [G - 2, G - 2] };
}

export function startMaze(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ss-canvas ss-pixelated';
  container.append(canvas);
  const out = canvas.getContext('2d');
  const H = 240;
  let W = 384, img, buf, zbuf;
  const tex = { brick: makeBrick(), floor: makeFloor(), ceil: makeCeiling(), gl: makeOpenGL() };
  const smiley = makeSmiley(), rat = makeRat(), paintPoly = polyhedronPainter();
  const fit = () => {
    W = Math.max(240, Math.round(H * (container.clientWidth || innerWidth) / (container.clientHeight || innerHeight)));
    canvas.width = W; canvas.height = H;
    img = out.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    zbuf = new Float32Array(W);
  };
  fit();
  addEventListener('resize', fit);

  let maze, cell, dir, angle, walker, phase, solvedAt, signs, rats, polys, flipped;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];               // E S W N
  const open = (x, y) => maze.map[y]?.[x] === 0;
  const openCells = () => {
    const cells = [];
    for (let y = 1; y < maze.G - 1; y += 2) for (let x = 1; x < maze.G - 1; x += 2) cells.push([x, y]);
    return cells.filter(([x, y]) => !(x === 1 && y === 1) && !(x === maze.exit[0] && y === maze.exit[1])).sort(() => Math.random() - 0.5);
  };
  function newMaze() {
    maze = generate(8);
    cell = [1, 1];
    dir = open(2, 1) ? 0 : 1;
    angle = dir * Math.PI / 2;
    walker = [1.5, 1.5];
    phase = { kind: 'idle' };
    solvedAt = 0;
    flipped = false;
    canvas.style.transform = '';
    // A few wall blocks carry the OpenGL sign (keyed by "x,y").
    signs = new Set();
    for (let tries = 0; signs.size < 4 && tries < 400; tries++) {
      const x = 1 + Math.floor(Math.random() * (maze.G - 2)), y = 1 + Math.floor(Math.random() * (maze.G - 2));
      if (!open(x, y) && (open(x + 1, y) || open(x - 1, y) || open(x, y + 1) || open(x, y - 1))) signs.add(`${x},${y}`);
    }
    const cells = openCells();
    polys = cells.slice(0, 3).map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, cell: [x, y], spin: Math.random() * 6 }));
    rats = cells.slice(3, 5).map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, cell: [x, y], prev: null, from: [x + 0.5, y + 0.5], to: null, t: 0 }));
  }
  newMaze();

  // Left-hand wall following, one cell at a time, with smooth moves and turns.
  function plan() {
    const [x, y] = cell;
    if (x === maze.exit[0] && y === maze.exit[1]) { solvedAt = performance.now(); return; }
    const left = (dir + 3) % 4, right = (dir + 1) % 4, back = (dir + 2) % 4;
    for (const d of [left, dir, right, back]) {
      if (open(x + DIRS[d][0], y + DIRS[d][1])) {
        if (d !== dir) {
          const delta = d === left ? -1 : d === right ? 1 : 2;
          phase = { kind: 'turn', from: angle, to: angle + delta * Math.PI / 2, t: 0, dur: 0.45 * Math.abs(delta), next: d };
        } else {
          phase = { kind: 'move', from: [...walker], to: [x + DIRS[d][0] + 0.5, y + DIRS[d][1] + 0.5], t: 0, dur: 0.5, cell: [x + DIRS[d][0], y + DIRS[d][1]] };
        }
        return;
      }
    }
  }

  function moveRat(r, dt) {
    if (!r.to) {
      const [x, y] = r.cell;
      let options = DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => open(nx, ny));
      if (options.length > 1 && r.prev) options = options.filter(([nx, ny]) => nx !== r.prev[0] || ny !== r.prev[1]);
      const next = options[Math.floor(Math.random() * options.length)];
      r.prev = r.cell; r.cell = next; r.from = [r.x, r.y]; r.to = [next[0] + 0.5, next[1] + 0.5]; r.t = 0;
    }
    r.t = Math.min(1, r.t + dt * 2.2);
    r.x = r.from[0] + (r.to[0] - r.from[0]) * r.t;
    r.y = r.from[1] + (r.to[1] - r.from[1]) * r.t;
    if (r.t >= 1) r.to = null;
  }

  function step(dt) {
    for (const r of rats) moveRat(r, dt);
    for (const p of polys) p.spin += dt * 1.6;
    if (solvedAt) { if (performance.now() - solvedAt > 1800) newMaze(); return; }
    if (phase.kind === 'idle') plan();
    if (phase.kind === 'idle') return;
    phase.t += dt;
    const k = Math.min(1, phase.t / phase.dur), e = phase.kind === 'turn' ? k * k * (3 - 2 * k) : k;
    if (phase.kind === 'turn') {
      angle = phase.from + (phase.to - phase.from) * e;
      if (k >= 1) { dir = phase.next; angle = dir * Math.PI / 2; phase = { kind: 'idle' }; }
    } else {
      walker = [phase.from[0] + (phase.to[0] - phase.from[0]) * e, phase.from[1] + (phase.to[1] - phase.from[1]) * e];
      if (k >= 1) { cell = phase.cell; phase = { kind: 'idle' }; }
      // Walking through a polyhedron flips the world over, as in the original.
      const hit = polys.findIndex((p) => Math.hypot(p.x - walker[0], p.y - walker[1]) < 0.35);
      if (hit >= 0) {
        polys.splice(hit, 1);
        flipped = !flipped;
        // Zoom in while rolling over so the corners never show.
        const [a, b] = flipped ? [0, 180] : [180, 360];
        canvas.animate([{ transform: `rotate(${a}deg)` }, { transform: `rotate(${(a + b) / 2}deg) scale(1.8)` }, { transform: `rotate(${b}deg)` }], { duration: 1200, easing: 'ease-in-out' });
        canvas.style.transform = flipped ? 'rotate(180deg)' : '';
      }
    }
  }

  const shadeTo = (c, k) => (255 << 24) | ((((c >> 16) & 255) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);
  const fog = (d) => Math.max(0.22, Math.min(1, 1.5 / (d * 0.42 + 1)));

  function render() {
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const planeX = -dirY * 0.8, planeY = dirX * 0.8;
    const half = H / 2;
    // The eye sits a little behind the walker, so turns in tight corners don't fill the view with wall.
    const pos = [walker[0] - dirX * 0.3, walker[1] - dirY * 0.3];

    // Floor and ceiling, one row at a time.
    const rx0 = dirX - planeX, ry0 = dirY - planeY, rx1 = dirX + planeX, ry1 = dirY + planeY;
    for (let y = half + 1; y < H; y++) {
      const rowDist = (half * WALL) / (y - half);
      const stepX = rowDist * (rx1 - rx0) / W, stepY = rowDist * (ry1 - ry0) / W;
      let fx = pos[0] + rowDist * rx0, fy = pos[1] + rowDist * ry0;
      const k = fog(rowDist), floorRow = y * W, ceilRow = (H - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        const tx = ((fx * TEX * 2) | 0) & (TEX - 1), ty = ((fy * TEX * 2) | 0) & (TEX - 1);
        buf[floorRow + x] = shadeTo(tex.floor[ty * TEX + tx], k * 0.9);
        buf[ceilRow + x] = shadeTo(tex.ceil[ty * TEX + tx], k * 0.85);
        fx += stepX; fy += stepY;
      }
    }
    buf.fill(shadeTo(tex.ceil[0], 0.2), half * W, (half + 1) * W);

    // Walls.
    for (let x = 0; x < W; x++) {
      const camX = 2 * x / W - 1;
      const rx = dirX + planeX * camX, ry = dirY + planeY * camX;
      let mx = Math.floor(pos[0]), my = Math.floor(pos[1]);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      const sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
      let sdx = rx < 0 ? (pos[0] - mx) * ddx : (mx + 1 - pos[0]) * ddx;
      let sdy = ry < 0 ? (pos[1] - my) * ddy : (my + 1 - pos[1]) * ddy;
      let side = 0;
      for (let i = 0; i < 64; i++) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
        if (maze.map[my]?.[mx] !== 0) break;
      }
      const dist = side === 0 ? sdx - ddx : sdy - ddy;
      zbuf[x] = dist;
      const lineH = Math.floor((H * WALL) / Math.max(dist, 0.01));
      const top = Math.max(0, (H - lineH) >> 1), bottom = Math.min(H - 1, (H + lineH) >> 1);
      let wx = side === 0 ? pos[1] + dist * ry : pos[0] + dist * rx;
      wx -= Math.floor(wx);
      let tx = Math.floor(wx * TEX);
      if ((side === 0 && rx < 0) || (side === 1 && ry > 0)) tx = TEX - tx - 1;
      const texture = signs.has(`${mx},${my}`) ? tex.gl : tex.brick;
      const k = fog(dist) * (side ? 0.8 : 1);
      const stepT = TEX / lineH;
      let tp = (top - H / 2 + lineH / 2) * stepT;
      for (let y = top; y <= bottom; y++) {
        buf[y * W + x] = shadeTo(texture[((tp | 0) & (TEX - 1)) * TEX + tx], k);
        tp += stepT;
      }
    }

    // Sprites, far to near: the smiley, the polyhedra and the rats.
    const sprites = [
      { x: maze.exit[0] + 0.5, y: maze.exit[1] + 0.5, tex: smiley, size: 0.6, lift: 0 },
      ...polys.map((p) => ({ x: p.x, y: p.y, tex: paintPoly(p.spin), size: 0.5, lift: 0.08 * Math.sin(p.spin * 2) })),
      ...rats.map((r) => ({ x: r.x, y: r.y, tex: rat, size: 0.3, lift: -0.35 })),
    ];
    const inv = 1 / (planeX * dirY - dirX * planeY);
    for (const s of sprites) {
      const dx = s.x - pos[0], dy = s.y - pos[1];
      s.tX = inv * (dirY * dx - dirX * dy);
      s.tY = inv * (-planeY * dx + planeX * dy);
    }
    sprites.sort((a, b) => b.tY - a.tY);
    for (const s of sprites) {
      if (s.tY <= 0.15) continue;
      const screenX = Math.floor((W / 2) * (1 + s.tX / s.tY));
      const sh = Math.abs(Math.floor((H * WALL) / s.tY)) * s.size;
      const x0 = Math.floor(screenX - sh / 2), y0 = Math.floor(H / 2 - sh / 2 - (s.lift * H * WALL) / s.tY);
      const k = fog(s.tY);
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + sh); x++) {
        if (s.tY >= zbuf[x]) continue;
        const u = Math.floor(((x - x0) / sh) * TEX);
        for (let y = Math.max(0, y0); y < Math.min(H, y0 + sh); y++) {
          const c = s.tex[Math.floor(((y - y0) / sh) * TEX) * TEX + u];
          if (c >>> 24 > 128) buf[y * W + x] = shadeTo(c, k);
        }
      }
    }
    out.putImageData(img, 0, 0);
  }

  let raf, last = performance.now(), stopped = false;
  const tick = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    render();
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); removeEventListener('resize', fit); };
}
