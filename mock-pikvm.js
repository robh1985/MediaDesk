// Demo-mode PiKVM: a pretend server whose "screen" (a snapshot picture) shows a sign-in page
// with whatever you type, power that turns on and off, virtual media you can attach, a couple
// of GPIO switches, and a WebSocket that takes keyboard and mouse events like the real one.

'use strict';

const crypto = require('node:crypto');

function createMockPikvm() {
  const st = {
    power: true, hdd: false, typed: '', mouse: null, events: [],
    images: { 'ubuntu-24.04-live-server-amd64.iso': 2754981888, 'Win11_24H2_English_x64.iso': 5819484160 },
    drive: { image: null, connected: false, cdrom: true, rw: false },
    gpio: { relay1: false, relay2: false },
    booting: 0,
  };
  const ok = (result = {}) => ({ ok: true, result });

  const KEYS = { Space: ' ', Minus: '-', Equal: '=', Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']', Backslash: '\\' };
  function key(code, down) {
    if (!down) return;
    if (code === 'Backspace') st.typed = st.typed.slice(0, -1);
    else if (code === 'Enter') st.typed = '';
    else if (/^Key[A-Z]$/.test(code)) st.typed += code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(code)) st.typed += code.slice(5);
    else if (KEYS[code]) st.typed += KEYS[code];
    st.typed = st.typed.slice(-40);
  }
  const record = (e) => { st.events.push(e); if (st.events.length > 200) st.events.shift(); if (e.event_type === 'key') key(e.event.key, e.event.state); if (e.event_type === 'mouse_move') st.mouse = e.event.to; };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function screen() {
    const now = new Date();
    if (!st.power) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#000"/><text x="640" y="370" fill="#333" font-family="monospace" font-size="22" text-anchor="middle">NO SIGNAL</text></svg>';
    if (Date.now() < st.booting) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#000"/><text x="40" y="60" fill="#ccc" font-family="monospace" font-size="20">American Megatrends BIOS v2.21  (C) 2025</text><text x="40" y="100" fill="#ccc" font-family="monospace" font-size="20">CPU: Intel(R) Xeon(R) E-2388G @ 3.20GHz   Memory test: 65536 MB OK</text><text x="40" y="140" fill="#ccc" font-family="monospace" font-size="20">${st.drive.connected && st.drive.image ? `Booting from virtual ${st.drive.cdrom ? 'CD-ROM' : 'USB'}: ${esc(st.drive.image)}` : 'Booting from NVMe...'}</text><text x="40" y="680" fill="#888" font-family="monospace" font-size="18">Press DEL to enter setup, F11 for boot menu</text></svg>`;
    }
    const pw = '•'.repeat(st.typed.length);
    const cursor = st.mouse ? `<path d="M${640 + (st.mouse.x / 32767) * 640} ${360 + (st.mouse.y / 32767) * 360}l0 22 6-6 5 11 4-2-5-11 8 0z" fill="#fff" stroke="#000" stroke-width="1.2"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b3b8c"/><stop offset="1" stop-color="#1572d3"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#b)"/>
<text x="640" y="200" fill="#fff" font-family="Segoe UI, sans-serif" font-size="88" font-weight="300" text-anchor="middle">${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</text>
<text x="640" y="250" fill="#fff" font-family="Segoe UI, sans-serif" font-size="26" text-anchor="middle">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</text>
<circle cx="640" cy="360" r="56" fill="#dfe7f2"/><circle cx="640" cy="345" r="22" fill="#9fb3cc"/><path d="M600 398a40 30 0 0 1 80 0z" fill="#9fb3cc"/>
<text x="640" y="455" fill="#fff" font-family="Segoe UI, sans-serif" font-size="28" text-anchor="middle">Administrator</text>
<rect x="490" y="480" width="300" height="40" rx="3" fill="#fff" opacity=".92"/>
<text x="502" y="507" fill="#222" font-family="Segoe UI, sans-serif" font-size="20">${pw || '<tspan fill="#888">Password</tspan>'}</text>
<text x="640" y="560" fill="#cfe0ff" font-family="Segoe UI, sans-serif" font-size="16" text-anchor="middle">${esc(st.typed ? `Typed: ${st.typed}` : 'Type on this screen with your keyboard')}</text>
<text x="1240" y="690" fill="#fff" font-family="Segoe UI, sans-serif" font-size="16" text-anchor="end">SRV-HYPERV01 · demo PiKVM</text>${cursor}</svg>`;
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
  }

  async function handle(req, res, rest, url, { sendJson }) {
    const q = url.searchParams;
    const p = `/${rest}`;
    const m = req.method;
    if (p === '/streamer/snapshot') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(screen());
    }
    if (p === '/streamer/stream') return sendJson(res, 404, { error: 'The demo PiKVM sends snapshots instead of a video stream' });
    if (p === '/api/info') return sendJson(res, 200, ok({ hw: { platform: { type: 'rpi', base: 'Raspberry Pi 4 Model B', model: 'v4plus', serial: 'DEMO0001' }, health: { temp: { cpu: 51.6 }, throttling: { parsed_flags: { undervoltage: { now: false, past: false } } } } }, system: { kvmd: { version: '4.36' }, streamer: { app: 'ustreamer', version: '6.18' }, kernel: { system: 'Linux', release: '6.6.45-1-rpi' } }, meta: { server: { host: 'pikvm.local' }, kvm: {} }, extras: {} }));
    if (p === '/api/streamer') return sendJson(res, 200, ok({ streamer: st.power ? { source: { online: true, resolution: { width: 1920, height: 1080 } }, stream: { clients: 1, queued_fps: 30 } } : { source: { online: false } } }));
    if (p === '/api/atx') return sendJson(res, 200, ok({ enabled: true, busy: false, leds: { power: st.power, hdd: st.power && Date.now() < st.booting } }));
    if (p === '/api/atx/power' && m === 'POST') {
      const a = q.get('action');
      if (a === 'on' && !st.power) { st.power = true; st.booting = Date.now() + 4000; }
      else if (a === 'off' || a === 'off_hard') st.power = false;
      else if (a === 'reset_hard') st.booting = Date.now() + 4000;
      return sendJson(res, 200, ok());
    }
    if (p === '/api/atx/click' && m === 'POST') {
      const b = q.get('button');
      if (b === 'power') { st.power = !st.power; if (st.power) st.booting = Date.now() + 4000; }
      if (b === 'power_long') st.power = false;
      if (b === 'reset' && st.power) st.booting = Date.now() + 4000;
      return sendJson(res, 200, ok());
    }
    if (p === '/api/msd') {
      const total = 64e9, used = Object.values(st.images).reduce((a, b) => a + b, 0);
      return sendJson(res, 200, ok({ enabled: true, online: true, busy: false, storage: { size: total, free: total - used, images: Object.fromEntries(Object.entries(st.images).map(([n, size]) => [n, { size, complete: true, mod_ts: 1767225600 }])) }, drive: { ...st.drive, image: st.drive.image ? { name: st.drive.image, size: st.images[st.drive.image] } : null } }));
    }
    if (p === '/api/msd/set_params' && m === 'POST') {
      if (st.drive.connected) return sendJson(res, 400, { ok: false, result: { error: 'MsdConnectedError', error_msg: 'Disconnect the drive first' } });
      if (q.has('image')) { if (q.get('image') && !st.images[q.get('image')]) return sendJson(res, 400, { ok: false, result: { error_msg: 'Unknown image' } }); st.drive.image = q.get('image') || null; }
      if (q.has('cdrom')) st.drive.cdrom = q.get('cdrom') === '1';
      if (q.has('rw')) st.drive.rw = q.get('rw') === '1';
      return sendJson(res, 200, ok());
    }
    if (p === '/api/msd/set_connected' && m === 'POST') {
      if (q.get('connected') === '1' && !st.drive.image) return sendJson(res, 400, { ok: false, result: { error_msg: 'Choose an image first' } });
      st.drive.connected = q.get('connected') === '1';
      return sendJson(res, 200, ok());
    }
    if (p === '/api/msd/write' && m === 'POST') {
      const body = await readBody(req);
      st.images[q.get('image') || `upload-${Date.now()}.iso`] = body.length;
      return sendJson(res, 200, ok({ image: { name: q.get('image'), size: body.length, written: body.length } }));
    }
    if (p === '/api/msd/remove' && m === 'POST') {
      if (st.drive.image === q.get('image') && st.drive.connected) return sendJson(res, 400, { ok: false, result: { error_msg: 'That image is connected' } });
      delete st.images[q.get('image')];
      if (st.drive.image === q.get('image')) st.drive.image = null;
      return sendJson(res, 200, ok());
    }
    if (p === '/api/hid/print' && m === 'POST') {
      const text = (await readBody(req)).toString('utf8');
      st.typed = (st.typed + text.replace(/\n/g, '')).slice(-40);
      st.events.push({ event_type: 'print', text });
      return sendJson(res, 200, ok());
    }
    if (p === '/api/hid/events/send_shortcut' && m === 'POST') { st.events.push({ event_type: 'shortcut', keys: q.get('keys') }); if (/Delete/.test(q.get('keys') || '')) st.typed = ''; return sendJson(res, 200, ok()); }
    if (p === '/api/gpio') return sendJson(res, 200, ok({ model: { scheme: { outputs: { relay1: { switch: true, pulse: { delay: 0.1 } }, relay2: { switch: true, pulse: { delay: 0.1 } } } }, view: { header: { title: 'Switches' } } }, state: { outputs: Object.fromEntries(Object.entries(st.gpio).map(([k, v]) => [k, { online: true, state: v, busy: false }])) } }));
    if (p === '/api/gpio/switch' && m === 'POST') { st.gpio[q.get('channel')] = q.get('state') === '1'; return sendJson(res, 200, ok()); }
    if (p === '/api/gpio/pulse' && m === 'POST') return sendJson(res, 200, ok());
    if (p === '/__events') return sendJson(res, 200, { events: st.events, typed: st.typed, power: st.power, drive: st.drive });
    return sendJson(res, 404, { error: `Mock: no route for pikvm/${rest}` });
  }

  // A tiny WebSocket server: enough to take PiKVM's JSON keyboard/mouse events.
  function socket(req, sock) {
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (obj) => { const b = Buffer.from(JSON.stringify(obj)); sock.write(Buffer.concat([Buffer.from([0x81, b.length < 126 ? b.length : 126, ...(b.length < 126 ? [] : [b.length >> 8, b.length & 255])]), b])); };
    send({ event_type: 'loop', event: {} });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 128;
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        off += masked ? 4 : 0;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(off + len);
        if (op === 8) { sock.end(); return; }
        if (op === 9) { sock.write(Buffer.from([0x8a, 0])); continue; }
        if (op === 1) { try { record(JSON.parse(payload.toString('utf8'))); } catch { /* not JSON */ } }
      }
    });
    sock.on('error', () => {});
  }

  return { handle, socket };
}

module.exports = { createMockPikvm };
