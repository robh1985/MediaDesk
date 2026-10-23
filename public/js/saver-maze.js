// 3D Maze, after the Windows 98 screensaver: a first-person walk through a brick maze, rendered by
// raycasting at a low resolution and scaled up, with a smiley face waiting at the exit.

const TEX = 64;

function makeBrick() {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) {
    const row = Math.floor(y / 16), off = row % 2 ? 16 : 0;
    for (let x = 0; x < TEX; x++) {
      const mortar = y % 16 < 2 || (x + off) % 32 < 2;
      const brick = Math.floor((x + off) / 32) + row * 3;
      const n = ((brick * 2654435761) >>> 24) / 255;          // per-brick tint
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      let r, g, b;
      if (mortar) { r = g = b = 150 + grain * 20; }
      else { r = 150 + n * 50 + grain * 18; g = 52 + n * 20 + grain * 10; b = 36 + n * 12; }
      t[y * TEX + x] = (255 << 24) | (Math.max(0, Math.min(255, b)) << 16) | (Math.max(0, Math.min(255, g)) << 8) | Math.max(0, Math.min(255, r));
    }
  }
  return t;
}

function makeSmiley() {
  const t = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const dx = x - 31.5, dy = y - 31.5, d = Math.hypot(dx, dy);
    let c = 0;                                                   // transparent
    if (d < 28) c = 0xff00d7ff;                                  // yellow face (ABGR)
    if (d >= 26 && d < 29) c = 0xff000000;
    if (Math.hypot(dx + 10, dy + 8) < 4 || Math.hypot(dx - 10, dy + 8) < 4) c = 0xff000000;
    if (d > 13 && d < 17 && dy > 3) c = 0xff000000;              // smile
    t[y * TEX + x] = c;
  }
  return t;
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
  const H = 200;
  let W = 320, img, buf, zbuf;
  const brick = makeBrick(), smiley = makeSmiley();
  const fit = () => {
    W = Math.max(200, Math.round(H * (container.clientWidth || innerWidth) / (container.clientHeight || innerHeight)));
    canvas.width = W; canvas.height = H;
    img = out.createImageData(W, H);
    buf = new Uint32Array(img.data.buffer);
    zbuf = new Float32Array(W);
  };
  fit();
  addEventListener('resize', fit);

  // Floor and ceiling colours per row (ABGR).
  const rgb = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;

  let maze, cell, dir, angle, pos, phase, t0, solvedAt;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];               // E S W N
  function newMaze() {
    maze = generate(9);
    cell = [1, 1];
    dir = maze.map[1][2] === 0 ? 0 : 1;
    angle = dir * Math.PI / 2;
    pos = [1.5, 1.5];
    phase = { kind: 'idle' };
    solvedAt = 0;
  }
  newMaze();
  const open = (x, y) => maze.map[y]?.[x] === 0;

  // Left-hand wall following, one cell at a time, with smooth moves and turns.
  function plan() {
    const [x, y] = cell;
    if (x === maze.exit[0] && y === maze.exit[1]) { solvedAt = performance.now(); return; }
    const left = (dir + 3) % 4, right = (dir + 1) % 4, back = (dir + 2) % 4;
    for (const d of [left, dir, right, back]) {
      if (open(x + DIRS[d][0], y + DIRS[d][1])) {
        if (d !== dir) {
          const delta = d === left ? -1 : d === right ? 1 : 2;
          phase = { kind: 'turn', from: angle, to: angle + delta * Math.PI / 2, t: 0, dur: 0.38 * Math.abs(delta), next: d };
        } else {
          phase = { kind: 'move', from: [...pos], to: [x + DIRS[d][0] + 0.5, y + DIRS[d][1] + 0.5], t: 0, dur: 0.42, cell: [x + DIRS[d][0], y + DIRS[d][1]] };
        }
        return;
      }
    }
  }

  function step(dt) {
    if (solvedAt) { if (performance.now() - solvedAt > 1600) newMaze(); return; }
    if (phase.kind === 'idle') plan();
    if (phase.kind === 'idle') return;
    phase.t += dt;
    const k = Math.min(1, phase.t / phase.dur), e = k * k * (3 - 2 * k);
    if (phase.kind === 'turn') {
      angle = phase.from + (phase.to - phase.from) * e;
      if (k >= 1) { dir = phase.next; angle = dir * Math.PI / 2; phase = { kind: 'idle' }; }
    } else {
      pos = [phase.from[0] + (phase.to[0] - phase.from[0]) * e, phase.from[1] + (phase.to[1] - phase.from[1]) * e];
      if (k >= 1) { cell = phase.cell; phase = { kind: 'idle' }; }
    }
  }

  function render() {
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const planeX = -dirY * 0.7, planeY = dirX * 0.7;
    for (let y = 0; y < H; y++) {
      const c = y < H / 2 ? rgb(20 + y * 0.35 | 0, 32 + y * 0.5 | 0, 90 + y * 0.6 | 0) : rgb(70 + (y - H / 2) * 0.6 | 0, 70 + (y - H / 2) * 0.6 | 0, 74 + (y - H / 2) * 0.6 | 0);
      buf.fill(c, y * W, (y + 1) * W);
    }
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
      const lineH = Math.floor(H / Math.max(dist, 0.01));
      const top = Math.max(0, (H - lineH) >> 1), bottom = Math.min(H - 1, (H + lineH) >> 1);
      let wx = side === 0 ? pos[1] + dist * ry : pos[0] + dist * rx;
      wx -= Math.floor(wx);
      let tx = Math.floor(wx * TEX);
      if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) tx = TEX - tx - 1;
      const shade = Math.max(0.25, Math.min(1, 1.4 / (dist * 0.45 + 1))) * (side ? 0.78 : 1);
      const step = TEX / lineH;
      let tp = (top - H / 2 + lineH / 2) * step;
      for (let y = top; y <= bottom; y++) {
        const c = brick[((tp | 0) & (TEX - 1)) * TEX + tx];
        tp += step;
        buf[y * W + x] = (255 << 24) | ((((c >> 16) & 255) * shade) << 16) | ((((c >> 8) & 255) * shade) << 8) | ((c & 255) * shade);
      }
    }
    // The smiley at the exit, drawn as a billboard sprite behind nearer walls.
    const sx = maze.exit[0] + 0.5 - pos[0], sy = maze.exit[1] + 0.5 - pos[1];
    const inv = 1 / (planeX * dirY - dirX * planeY);
    const tX = inv * (dirY * sx - dirX * sy), tY = inv * (-planeY * sx + planeX * sy);
    if (tY > 0.2) {
      const screenX = Math.floor((W / 2) * (1 + tX / tY));
      const sh = Math.abs(Math.floor(H / tY)) * 0.6;
      const x0 = Math.floor(screenX - sh / 2), y0 = Math.floor(H / 2 - sh / 2 + sh * 0.15);
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + sh); x++) {
        if (tY >= zbuf[x]) continue;
        const u = Math.floor(((x - x0) / sh) * TEX);
        for (let y = Math.max(0, y0); y < Math.min(H, y0 + sh); y++) {
          const c = smiley[Math.floor(((y - y0) / sh) * TEX) * TEX + u];
          if (c) buf[y * W + x] = c;
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
