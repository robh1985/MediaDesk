// PiKVM: the remote computer's screen, keyboard and mouse, its power and reset buttons, virtual
// media (ISO images) and GPIO switches — through MediaDesk, which signs in to the PiKVM for you.
// Uses PiKVM's own API (kvmd): the video comes from /streamer, keyboard and mouse go over its
// WebSocket, everything else is REST.

import { h, clear, toast, toastError, confirmDialog, contextMenu, formatBytes, spinner, badge } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { isConfigured, serviceLink, appPref } from '../api.js';
import { notConfigured } from './common.js';
import { openApp } from '../wm.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  power: svg('<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  paste: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>'),
  disc: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'),
  switch: svg('<rect x="2" y="8" width="20" height="8" rx="4"/><circle cx="16" cy="12" r="2.5" fill="currentColor"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  touchkb: svg('<rect x="3" y="11" width="18" height="9" rx="2"/><path d="M7 15h.01M11 15h.01M15 15h.01M12 3v5M9 6l3 3 3-3"/>'),
};

// Keyboard shortcuts PiKVM can send (KeyboardEvent.code names, as kvmd expects).
const SHORTCUTS = [
  ['Ctrl + Alt + Delete', 'ControlLeft,AltLeft,Delete'],
  ['Ctrl + Shift + Esc (Task Manager)', 'ControlLeft,ShiftLeft,Escape'],
  ['Windows key', 'MetaLeft'],
  ['Windows + L (lock)', 'MetaLeft,KeyL'],
  ['Windows + R (run)', 'MetaLeft,KeyR'],
  ['Alt + Tab', 'AltLeft,Tab'],
  ['Alt + F4', 'AltLeft,F4'],
  ['Print Screen', 'PrintScreen'],
  ['Ctrl + Alt + F1 (Linux console)', 'ControlLeft,AltLeft,F1'],
  ['Ctrl + Alt + F2', 'ControlLeft,AltLeft,F2'],
  ['F2 (BIOS setup)', 'F2'],
  ['Delete (BIOS setup)', 'Delete'],
  ['F11 (boot menu)', 'F11'],
  ['F12 (boot menu)', 'F12'],
];

async function kvm(path, { method = 'GET', params, body, headers = {} } = {}) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`/api/pikvm/${path}${qs}`, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', Accept: 'application/json', ...headers }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.result?.error_msg || data.result?.error || data.error || `HTTP ${res.status}`);
  return data.result ?? data;
}

export const pikvmApp = {
  id: 'pikvm', name: 'PiKVM', icon: appIcon.pikvm, size: [1180, 800], description: 'Remote screen, keyboard, power and virtual media',
  open(win) {
    if (!isConfigured('pikvm')) return clear(win.body, notConfigured('PiKVM', 'pikvm'));
    const k = new Kvm(win);
    win.on('close', () => k.destroy());
  },
};

class Kvm {
  constructor(win) {
    this.win = win;
    this.held = new Set();
    this.mode = appPref('pikvm', 'video') === 'snapshots' ? 'snapshots' : 'stream';
    const tb = (ic, label, onclick, title) => h('button', { class: 'kvm-tb', title: title || label, onclick }, h('span', { html: ic }), h('span', { class: 'kvm-tb-label' }, label));
    this.leds = h('div', { class: 'kvm-leds' },
      h('span', { class: 'kvm-led', dataset: { led: 'power' }, title: 'Power' }, h('i'), 'Power'),
      h('span', { class: 'kvm-led', dataset: { led: 'hdd' }, title: 'Disk activity' }, h('i'), 'HDD'));
    this.capBadge = h('span', { class: 'kvm-cap' }, 'Click the screen to type');
    this.toolbar = h('div', { class: 'kvm-toolbar' },
      this.leds,
      tb(I.power, 'Power', (e) => this.powerMenu(e)),
      tb(I.keyboard, 'Keys', (e) => this.keysMenu(e), 'Send a key combination'),
      tb(I.paste, 'Paste', () => this.pasteText(), 'Type text on the remote computer'),
      tb(I.disc, 'Media', () => this.drawer('media'), 'Virtual media (ISO images)'),
      this.gpioBtn = tb(I.switch, 'Switches', () => this.drawer('gpio'), 'GPIO switches'),
      h('span', { class: 'kvm-sep' }),
      tb(I.camera, 'Screenshot', () => this.screenshot()),
      tb(I.full, 'Full screen', () => this.full()),
      tb(I.info, 'Info', () => this.drawer('info')),
      serviceLink('pikvm') ? tb(icon.globe, 'Web UI', () => window.open(serviceLink('pikvm'), '_blank', 'noopener'), 'Open PiKVM’s own web page') : null,
      h('span', { class: 'grow' }),
      this.capBadge);
    this.gpioBtn.hidden = true;

    this.img = h('img', { class: 'kvm-img', alt: 'Remote screen', draggable: 'false' });
    this.noSignal = h('div', { class: 'kvm-nosignal', hidden: true }, h('div', {}, 'No signal'), h('div', { class: 'small' }, 'The computer may be off or asleep.'));
    this.kbInput = h('input', { class: 'kvm-kbinput', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'On-screen keyboard' });
    this.screen = h('div', { class: 'kvm-screen', tabindex: '0' }, this.img, this.noSignal, h('div', { class: 'kvm-loading' }, spinner()), this.kbInput);
    this.kbBtn = h('button', { class: 'kvm-kbbtn', title: 'On-screen keyboard', html: I.touchkb, onclick: (e) => { e.stopPropagation(); this.kbInput.focus(); } });
    this.drawerEl = h('div', { class: 'kvm-drawer', hidden: true });
    this.root = h('div', { class: 'kvm' }, this.toolbar, h('div', { class: 'kvm-main' }, this.screen, this.drawerEl), this.kbBtn);
    win.body.append(this.root);

    this.setupVideo();
    this.setupInput();
    this.connect();
    this.poll();
    this.timer = setInterval(() => this.poll(), 2000);
    kvm('api/gpio').then((g) => { this.gpio = g; this.gpioBtn.hidden = !Object.keys(g?.state?.outputs || {}).length; }).catch(() => {});
  }

  destroy() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.snapTimer);
    this.ws?.close();
    this.img.removeAttribute('src');
  }

  // ---- Video ----

  setupVideo() {
    this.img.addEventListener('load', () => { this.root.classList.add('live'); if (this.mode === 'snapshots') this.nextSnap(); });
    this.img.addEventListener('error', () => {
      // Some proxies don't pass a never-ending stream; fall back to pictures.
      if (this.mode === 'stream') { this.mode = 'snapshots'; this.snap(); }
      else this.snapTimer = setTimeout(() => this.snap(), 1500);
    });
    if (this.mode === 'stream') this.img.src = `/api/pikvm/streamer/stream?t=${Date.now()}`;
    else this.snap();
  }
  snap() { if (!this.closed) this.img.src = `/api/pikvm/streamer/snapshot?t=${Date.now()}`; }
  nextSnap() { clearTimeout(this.snapTimer); this.snapTimer = setTimeout(() => this.snap(), document.hidden ? 3000 : 350); }

  async poll() {
    if (this.closed || document.hidden) return;
    try {
      const atx = await kvm('api/atx');
      this.atx = atx;
      for (const led of ['power', 'hdd']) this.leds.querySelector(`[data-led="${led}"]`).classList.toggle('on', Boolean(atx?.leds?.[led]));
    } catch { /* shown by the video area */ }
    try {
      const s = await kvm('api/streamer');
      const online = s?.streamer?.source?.online !== false;
      this.noSignal.hidden = online;
    } catch { /* older PiKVM */ }
  }

  // ---- Keyboard & mouse (WebSocket) ----

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/pikvm/api/ws?stream=0`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.root.classList.add('ws'); };
    ws.onclose = () => {
      this.root.classList.remove('ws');
      if (!this.closed) setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** (this.retry = (this.retry || 0) + 1)));
    };
    ws.onerror = () => {};
  }
  send(event_type, event) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ event_type, event }));
  }

  key(code, state) {
    if (!code) return;
    if (state) this.held.add(code); else this.held.delete(code);
    this.send('key', { key: code, state });
  }
  releaseAll() { for (const c of [...this.held]) this.key(c, false); }

  // Where on the remote screen (-32768..32767) a point on the picture is.
  toRemote(clientX, clientY) {
    const r = this.img.getBoundingClientRect();
    const nw = this.img.naturalWidth || 16, nh = this.img.naturalHeight || 9;
    const scale = Math.min(r.width / nw, r.height / nh);
    const w = nw * scale, hgt = nh * scale;
    const x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - hgt) / 2;
    const fx = Math.max(0, Math.min(1, (clientX - x0) / w)), fy = Math.max(0, Math.min(1, (clientY - y0) / hgt));
    return { x: Math.round(fx * 65535 - 32768), y: Math.round(fy * 65535 - 32768) };
  }

  setupInput() {
    const sc = this.screen;
    const setCap = (on) => {
      this.captured = on;
      this.root.classList.toggle('captured', on);
      this.capBadge.textContent = on ? 'Typing goes to the remote computer — click outside to stop' : 'Click the screen to type';
      if (!on) this.releaseAll();
    };
    sc.addEventListener('focus', () => setCap(true));
    sc.addEventListener('blur', () => setCap(false));
    sc.addEventListener('keydown', (e) => {
      if (e.repeat && this.held.has(e.code)) return;
      e.preventDefault();
      this.key(e.code, true);
    });
    sc.addEventListener('keyup', (e) => { e.preventDefault(); this.key(e.code, false); });

    let last = 0, pending = null;
    const move = (e) => {
      pending = this.toRemote(e.clientX, e.clientY);
      const now = performance.now();
      if (now - last > 30) { last = now; this.send('mouse_move', { to: pending }); pending = null; }
    };
    const BTN = ['left', 'middle', 'right', 'up', 'down'];
    sc.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') move(e); });
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      sc.focus({ preventScroll: true });
      move(e);
      this.send('mouse_button', { button: BTN[e.button] || 'left', state: true });
    });
    sc.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') this.send('mouse_button', { button: BTN[e.button] || 'left', state: false }); });
    sc.addEventListener('contextmenu', (e) => e.preventDefault());
    sc.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.send('mouse_wheel', { delta: { x: Math.sign(e.deltaX) * -1, y: Math.sign(e.deltaY) * -1 } });
    }, { passive: false });

    // Touch: tap to click, press and hold for a right-click, drag with two fingers to scroll.
    let touch = null;
    sc.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { touch = { scroll: e.touches[0].clientY }; return; }
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, at: Date.now(), long: setTimeout(() => { const p = this.toRemote(touch.x, touch.y); this.send('mouse_move', { to: p }); this.click('right'); touch.done = true; }, 550) };
    }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (!touch) return;
      if (touch.scroll != null && e.touches.length === 2) {
        const dy = e.touches[0].clientY - touch.scroll;
        if (Math.abs(dy) > 18) { this.send('mouse_wheel', { delta: { x: 0, y: dy > 0 ? 1 : -1 } }); touch.scroll = e.touches[0].clientY; }
        e.preventDefault();
        return;
      }
      const t = e.touches[0];
      if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10) { clearTimeout(touch.long); touch.moved = true; }
    }, { passive: false });
    sc.addEventListener('touchend', (e) => {
      if (!touch) return;
      clearTimeout(touch.long);
      if (touch.scroll == null && !touch.done && !touch.moved) {
        e.preventDefault();
        this.send('mouse_move', { to: this.toRemote(touch.x, touch.y) });
        this.click('left');
      }
      touch = null;
    });

    // On-screen keyboard (phones): letters go as typed text, Backspace / Enter as keys.
    this.kbInput.addEventListener('keydown', (e) => {
      if (['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const code = e.key === 'Escape' ? 'Escape' : e.key;
        this.key(code, true); this.key(code, false);
      }
    });
    this.kbInput.addEventListener('input', () => {
      const text = this.kbInput.value;
      this.kbInput.value = '';
      if (text) kvm('api/hid/print', { method: 'POST', params: { limit: 0 }, body: text, headers: { 'Content-Type': 'text/plain' } }).catch(toastError);
    });
  }

  click(button) {
    this.send('mouse_button', { button, state: true });
    setTimeout(() => this.send('mouse_button', { button, state: false }), 60);
  }

  // ---- Power ----

  powerMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const on = this.atx?.leds?.power;
    const act = (label, msg, fn, danger = false) => ({
      label, danger,
      action: async () => {
        if (appPref('pikvm', 'confirmPower') !== false && msg && !(await confirmDialog({ title: `${label}?`, message: msg, confirm: label, danger }))) return;
        try { await fn(); toast(label, { icon: appIcon.pikvm, timeout: 2500 }); setTimeout(() => this.poll(), 800); } catch (err) { toastError(err, `${label} failed`); }
      },
    });
    contextMenu(r.left, r.bottom + 4, [
      { label: `The computer is ${on ? 'on' : 'off'}`, disabled: true, icon: I.power },
      '-',
      act('Power on', null, () => kvm('api/atx/power', { method: 'POST', params: { action: 'on' } })),
      act('Shut down', 'Presses the power button so the computer shuts down normally.', () => kvm('api/atx/power', { method: 'POST', params: { action: 'off' } })),
      act('Force off', 'Holds the power button down, cutting power without shutting down. Unsaved work on that computer is lost.', () => kvm('api/atx/power', { method: 'POST', params: { action: 'off_hard' } }), true),
      act('Reset', 'Presses the reset button. Unsaved work on that computer is lost.', () => kvm('api/atx/power', { method: 'POST', params: { action: 'reset_hard' } }), true),
      '-',
      act('Press power button', null, () => kvm('api/atx/click', { method: 'POST', params: { button: 'power' } })),
      act('Hold power button (5 s)', 'Holds the power button for 5 seconds.', () => kvm('api/atx/click', { method: 'POST', params: { button: 'power_long' } }), true),
      act('Press reset button', 'Presses the reset button.', () => kvm('api/atx/click', { method: 'POST', params: { button: 'reset' } }), true),
    ].map((x) => (x.danger ? { ...x, icon: icon.alert } : x)));
  }

  keysMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, SHORTCUTS.map(([label, keys]) => ({
      label, icon: I.keyboard,
      action: () => kvm('api/hid/events/send_shortcut', { method: 'POST', params: { keys } }).then(() => toast(`Sent ${label}`, { icon: appIcon.pikvm, timeout: 1500 })).catch(toastError),
    })));
  }

  pasteText() {
    const area = h('textarea', { class: 'input', rows: 6, placeholder: 'Text to type on the remote computer (for example a long password)', spellcheck: 'false' });
    const close = () => overlay.remove();
    const send = async () => {
      if (!area.value) return close();
      try {
        await kvm('api/hid/print', { method: 'POST', params: { limit: 0 }, body: area.value, headers: { 'Content-Type': 'text/plain' } });
        toast('Typing it on the remote computer', { icon: appIcon.pikvm, timeout: 2000 });
        close();
      } catch (err) { toastError(err); }
    };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
      h('div', { class: 'dialog' }, h('h3', {}, 'Paste as typing'),
        h('p', { class: 'small muted' }, 'PiKVM types this as keystrokes, so it works anywhere — even in a BIOS or a sign-in screen. It uses a US keyboard layout.'),
        area,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn btn-primary', onclick: send }, 'Type it'))));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(overlay);
    area.focus();
  }

  async screenshot() {
    try {
      const res = await fetch(`/api/pikvm/streamer/snapshot?t=${Date.now()}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: `pikvm-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${blob.type.includes('svg') ? 'svg' : 'jpg'}` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { toastError(err, 'Could not take a screenshot'); }
  }

  full() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.root.requestFullscreen?.().catch(() => {});
  }

  // ---- Side panel: media, switches, info ----

  drawer(kind) {
    if (!this.drawerEl.hidden && this.drawerKind === kind) { this.drawerEl.hidden = true; return; }
    this.drawerKind = kind;
    this.drawerEl.hidden = false;
    clear(this.drawerEl, spinner());
    ({ media: () => this.media(), gpio: () => this.gpioPanel(), info: () => this.info() })[kind]().catch((err) => clear(this.drawerEl, h('div', { class: 'small muted' }, err.message)));
  }

  head(title) {
    return h('div', { class: 'kvm-drawer-head' }, h('strong', {}, title), h('button', { class: 'btn btn-icon btn-sm', html: icon.x, title: 'Close', onclick: () => { this.drawerEl.hidden = true; } }));
  }

  async media() {
    const msd = await kvm('api/msd');
    const drive = msd.drive || {};
    const raw = msd.storage?.images || {};
    const images = Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? { name: x } : x)) : Object.entries(raw).map(([name, v]) => ({ name, ...v }));
    const current = drive.image?.name || null;
    const parts = msd.storage?.parts?.[''] || msd.storage || {};
    const redraw = () => this.media().catch(toastError);
    const run = async (p, params) => { try { await kvm(p, { method: 'POST', params }); } catch (err) { toastError(err); } redraw(); };
    const upload = h('input', { type: 'file', style: { display: 'none' } });
    const progress = h('div', { class: 'kvm-upload', hidden: true }, h('div', { class: 'progress' }, h('div', { class: 'progress-fill' })), h('span', { class: 'small muted' }));
    upload.addEventListener('change', () => {
      const f = upload.files[0];
      if (!f) return;
      progress.hidden = false;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/pikvm/api/msd/write?${new URLSearchParams({ image: f.name })}`);
      xhr.setRequestHeader('X-MediaDesk', '1');
      xhr.upload.onprogress = (e) => {
        const pct = e.lengthComputable ? (e.loaded / e.total) * 100 : 0;
        progress.querySelector('.progress-fill').style.width = `${pct}%`;
        progress.querySelector('span').textContent = `Uploading ${f.name}: ${formatBytes(e.loaded)} of ${formatBytes(f.size)}`;
      };
      xhr.onload = () => { if (xhr.status >= 300) toastError(new Error(`HTTP ${xhr.status}`), 'Upload failed'); else toast('Image uploaded', { body: f.name, icon: appIcon.pikvm }); redraw(); };
      xhr.onerror = () => { toastError(new Error('Network error'), 'Upload failed'); redraw(); };
      xhr.send(f);
    });
    const remoteUrl = h('input', { class: 'input', placeholder: 'https://… link to an .iso', spellcheck: 'false' });
    clear(this.drawerEl, this.head('Virtual media'),
      h('p', { class: 'small muted' }, 'Attach a disk image as a virtual CD-ROM or USB stick on the remote computer — for installing an OS or booting a rescue disk.'),
      h('div', { class: 'kvm-drive' },
        h('div', {}, h('strong', {}, current || 'No image chosen'), h('div', { class: 'small muted' }, drive.connected ? `Connected as ${drive.cdrom ? 'a CD-ROM' : 'a USB flash drive'}` : 'Not connected')),
        drive.connected ? badge('Connected', 'ok') : null),
      h('div', { class: 'btn-row' },
        h('button', { class: `btn btn-sm ${drive.connected ? '' : 'btn-primary'}`, disabled: !current, onclick: () => run('api/msd/set_connected', { connected: drive.connected ? 0 : 1 }) }, drive.connected ? 'Disconnect' : 'Connect'),
        h('button', { class: 'btn btn-sm', disabled: drive.connected, onclick: () => run('api/msd/set_params', { cdrom: drive.cdrom ? 0 : 1 }) }, drive.cdrom ? 'Use as USB flash drive' : 'Use as CD-ROM')),
      h('div', { class: 'kvm-images' }, images.length ? images.map((im) => h('div', { class: `kvm-image ${im.name === current ? 'on' : ''}` },
        h('button', { class: 'kvm-image-pick', disabled: drive.connected, onclick: () => run('api/msd/set_params', { image: im.name }) },
          h('span', { html: I.disc }), h('span', { class: 'grow' }, h('span', { class: 'kvm-image-name' }, im.name), h('span', { class: 'small muted' }, im.size ? formatBytes(im.size) : '', im.complete === false ? ' · incomplete' : ''))),
        h('button', { class: 'btn btn-icon btn-sm', title: 'Delete image', html: icon.trash, disabled: drive.connected && im.name === current, onclick: async () => {
          if (await confirmDialog({ title: `Delete ${im.name}?`, message: 'It’s removed from the PiKVM’s storage.', confirm: 'Delete', danger: true })) run('api/msd/remove', { image: im.name });
        } })))
        : h('div', { class: 'small muted' }, 'No images yet.')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', onclick: () => upload.click() }, h('span', { html: icon.arrowUp }), 'Upload an image'), upload),
      progress,
      h('div', { class: 'kvm-remote' }, remoteUrl, h('button', { class: 'btn btn-sm', onclick: async () => {
        const u = remoteUrl.value.trim();
        if (!/^https?:\/\//.test(u)) return toast('Enter a web address (https://…)', { type: 'error' });
        toast('Downloading on the PiKVM…', { body: 'It appears in the list when it’s done.', icon: appIcon.pikvm });
        kvm('api/msd/write_remote', { method: 'POST', params: { url: u } }).then(redraw).catch(toastError);
      } }, 'Download from a link')),
      parts.size ? h('div', { class: 'small muted' }, `${formatBytes(parts.free || 0)} free of ${formatBytes(parts.size)}`) : null);
  }

  async gpioPanel() {
    const g = await kvm('api/gpio');
    const outs = g.state?.outputs || {};
    const scheme = g.model?.scheme?.outputs || {};
    clear(this.drawerEl, this.head(g.model?.view?.header?.title || 'Switches'),
      Object.keys(outs).length ? Object.entries(outs).map(([ch, o]) => h('div', { class: 'kvm-gpio' },
        h('span', { class: 'grow' }, ch),
        scheme[ch]?.switch !== false ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: o.state, disabled: !o.online || o.busy, onchange: (e) => kvm('api/gpio/switch', { method: 'POST', params: { channel: ch, state: e.target.checked ? 1 : 0 } }).catch(toastError) }), o.state ? 'On' : 'Off') : null,
        scheme[ch]?.pulse ? h('button', { class: 'btn btn-sm', disabled: !o.online, onclick: () => kvm('api/gpio/pulse', { method: 'POST', params: { channel: ch } }).then(() => toast(`Pulsed ${ch}`, { timeout: 1500 })).catch(toastError) }, 'Pulse') : null))
        : h('div', { class: 'small muted' }, 'This PiKVM has no switches set up.'));
  }

  async info() {
    const [i, s] = await Promise.all([kvm('api/info'), kvm('api/streamer').catch(() => ({}))]);
    const res = s?.streamer?.source?.resolution;
    const temp = i.hw?.health?.temp?.cpu;
    const under = i.hw?.health?.throttling?.parsed_flags?.undervoltage;
    const rows = [
      ['Host', i.meta?.server?.host],
      ['Hardware', [i.hw?.platform?.base, i.hw?.platform?.model].filter(Boolean).join(' · ')],
      ['PiKVM (kvmd)', i.system?.kvmd?.version],
      ['Video', [i.system?.streamer?.app, i.system?.streamer?.version].filter(Boolean).join(' ')],
      ['Remote screen', res ? `${res.width} × ${res.height}` : 'No signal'],
      ['Video mode', this.mode === 'stream' ? 'Live stream (MJPEG)' : 'Pictures (snapshots)'],
      ['Keyboard & mouse', this.ws?.readyState === 1 ? 'Connected' : 'Connecting…'],
      ['CPU temperature', temp != null ? `${Math.round(temp)} °C` : null],
      ['Power supply', under ? (under.now ? 'Under-voltage now!' : under.past ? 'Had under-voltage since boot' : 'OK') : null],
      ['System', [i.system?.kernel?.system, i.system?.kernel?.release].filter(Boolean).join(' ')],
    ].filter(([, v]) => v);
    clear(this.drawerEl, this.head('PiKVM'), h('dl', { class: 'facts kvm-facts' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', onclick: () => openApp('settings', { tab: 'pikvm' }) }, h('span', { html: icon.sliders }), 'Settings')));
  }
}
