// Photos: the family's pictures (uploaded here, or from a shared folder), a photo frame
// slideshow with the time, weather and what's next, and sleep mode for the night.

import { h, clear, toast, toastError } from '../../ui.js';
import { filesCall, fileUrl, filesEnabled, pickFile, joinPath, extOf } from '../../fileapi.js';
import { expand } from './dates.js';
import { sheet, ICONS, weatherIcon } from './shared.js';

const PICTURE = /^(jpe?g|png|gif|webp|avif|bmp)$/;

export class PhotosView {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.folderPhotos = null;
  }

  async loadFolder() {
    const f = this.store.settings.photoFolder;
    if (!f || !filesEnabled()) { this.folderPhotos = []; return []; }
    try {
      const r = await filesCall('list', { params: { root: f.root, path: f.path || '' } });
      this.folderPhotos = r.entries.filter((e) => !e.dir && PICTURE.test(extOf(e.name))).sort((a, b) => b.modified - a.modified)
        .map((e) => ({ id: `folder:${e.name}`, name: e.name, url: fileUrl(f.root, joinPath(f.path || '', e.name), true), folder: true }));
    } catch { this.folderPhotos = []; }
    return this.folderPhotos;
  }

  async photos() {
    const own = this.store.all('photos').sort((a, b) => (b.created || 0) - (a.created || 0)).map((p) => ({ ...p, url: this.store.photoUrl(p) }));
    const folder = this.folderPhotos || await this.loadFolder();
    return own.concat(folder);
  }

  render(el) {
    this.el = el;
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { this.upload([...fileIn.files]); fileIn.value = ''; } });
    const folder = this.store.settings.photoFolder;
    const bar = h('div', { class: 'fam-toolbar' },
      h('div', { class: 'fam-toolbar-title' }, 'Photos'),
      h('div', { class: 'fam-spacer' }),
      filesEnabled() ? h('button', { class: 'fam-btn', title: folder ? `${folder.name || folder.path || 'Shared folder'}` : '', onclick: () => this.chooseFolder() }, folder ? `Folder: ${folder.name || folder.path || 'shared folder'}` : 'Use a shared folder') : null,
      h('button', { class: 'fam-btn', onclick: () => fileIn.click() }, h('span', { html: ICONS.upload }), 'Add photos'), fileIn,
      h('button', { class: 'fam-btn primary', onclick: () => this.app.frame() }, h('span', { html: ICONS.play }), 'Photo frame'));
    const grid = h('div', { class: 'fam-photos' }, h('div', { class: 'fam-muted' }, 'Loading…'));
    clear(el, bar, grid);
    el.ondragover = (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('drop'); } };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('drop'); this.upload([...e.dataTransfer.files]); };
    this.photos().then((list) => {
      if (!grid.isConnected) return;
      clear(grid, list.length ? list.map((p) => h('figure', { class: 'fam-photo' },
        h('img', { src: p.url, alt: p.caption || p.name || '', loading: 'lazy', onclick: () => this.app.frame(list.indexOf(p)) }),
        p.folder ? null : h('button', { class: 'fam-photo-del fam-icon-btn', title: 'Remove', html: ICONS.trash, onclick: () => this.remove(p) }),
        p.caption ? h('figcaption', {}, p.caption) : null))
        : h('div', { class: 'fam-empty' }, h('div', { class: 'fam-empty-emoji' }, '🖼️'), 'Add family photos to show in the photo frame. Drag them here, or use a shared folder.', h('button', { class: 'fam-btn primary', onclick: () => fileIn.click() }, 'Add photos')));
    });
  }

  async upload(files) {
    const pics = files.filter((f) => /^image\//.test(f.type) || PICTURE.test(extOf(f.name)));
    if (!pics.length) return;
    let ok = 0;
    for (const f of pics) {
      try { await this.store.uploadPhoto(f); ok++; } catch (err) { toastError(err, `Couldn’t add ${f.name}`); }
    }
    if (ok) toast(`Added ${ok} photo${ok === 1 ? '' : 's'}`, { type: 'success', timeout: 2500 });
    this.render(this.el);
  }

  async remove(p) {
    const ok = await sheet(this.app.root, { title: 'Remove photo', body: h('p', {}, 'Remove this photo from the photo frame?'), actions: [{ label: 'Cancel' }, { label: 'Remove', danger: true, value: true }] });
    if (!ok) return;
    try { await this.store.del('photos', p.id); this.render(this.el); } catch (err) { toastError(err); }
  }

  async chooseFolder() {
    const cur = this.store.settings.photoFolder;
    if (cur) {
      const what = await sheet(this.app.root, { title: 'Photo folder', body: h('p', {}, `The photo frame also shows the pictures in “${cur.name || cur.path || 'the shared folder'}”.`), actions: [{ label: 'Stop using it', danger: true, left: true, value: 'off' }, { label: 'Cancel' }, { label: 'Choose another', primary: true, value: 'pick' }] });
      if (what === 'off') { await this.store.setSettings({ photoFolder: null }); this.folderPhotos = []; this.render(this.el); return; }
      if (what !== 'pick') return;
    }
    const f = await pickFile({ title: 'Choose any picture in the folder to use', accept: (e) => e.dir || PICTURE.test(extOf(e.name)), start: cur ? { root: cur.root, path: cur.path } : undefined });
    if (!f) return;
    const name = f.dir ? f.dir.split('/').pop() : 'Shared folder';
    await this.store.setSettings({ photoFolder: { root: f.root, path: f.dir || '', name } });
    this.folderPhotos = null;
    this.render(this.el);
  }
}

// The photo frame: photos fading one into the next, with the clock, weather and coming events.
export function photoFrame(app, list, startAt = 0) {
  const s = app.store.settings;
  const secs = Math.max(4, Number(s.frameSeconds) || 12);
  const order = list.map((_, i) => i);
  if (s.frameShuffle !== false && startAt === 0) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let pos = Math.max(0, order.indexOf(startAt));
  const a = h('div', { class: 'fam-frame-img on' });
  const b = h('div', { class: 'fam-frame-img' });
  const clock = h('div', { class: 'fam-frame-clock' });
  const info = h('div', { class: 'fam-frame-info' });
  const frame = h('div', { class: `fam-frame ${s.frameFit === 'fit' ? 'fit' : ''}`, tabindex: '0' }, a, b, h('div', { class: 'fam-frame-shade' }), h('div', { class: 'fam-frame-hud' }, clock, info));
  let front = a;
  const show = (i) => {
    const p = list[order[(i + order.length) % order.length]];
    if (!p) return;
    const back = front === a ? b : a;
    const img = new Image();
    img.onload = () => {
      back.style.backgroundImage = `url("${p.url.replace(/"/g, '%22')}")`;
      back.style.setProperty('--blur', `url("${p.url.replace(/"/g, '%22')}")`);
      back.classList.remove('kb0', 'kb1', 'kb2', 'kb3');
      void back.offsetWidth;
      back.classList.add('on', `kb${Math.floor(Math.random() * 4)}`);
      front.classList.remove('on');
      front = back;
    };
    img.src = p.url;
  };
  const tickHud = () => {
    const now = new Date();
    clear(clock, h('b', {}, now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })), h('span', {}, now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
    const w = app.weather?.current;
    const end = new Date(now); end.setHours(23, 59, 59);
    const next = app.store.events().flatMap((e) => expand(e, now, end)).filter((o) => !o.allDay && o.start > now).sort((x, y) => x.start - y.start).slice(0, 3);
    clear(info, w ? h('div', { class: 'fam-frame-wx' }, `${weatherIcon(w.code, w.day)[0]} ${Math.round(w.temp)}°`) : null,
      next.map((o) => h('div', { class: 'fam-frame-ev' }, h('i', { style: { background: app.calendar.colorOf(o.ev) } }), `${o.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ${o.ev.title}`)));
  };
  show(pos);
  tickHud();
  const timer = setInterval(() => show(++pos), secs * 1000);
  const hud = setInterval(tickHud, 15000);
  const close = () => {
    clearInterval(timer); clearInterval(hud);
    frame.remove();
    if (document.fullscreenElement === frame) document.exitFullscreen().catch(() => {});
    app.frameOpen = null;
  };
  frame.addEventListener('click', close);
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(++pos); e.preventDefault(); } else if (e.key === 'ArrowLeft') { show(--pos); e.preventDefault(); } else close();
  });
  app.root.append(frame);
  frame.focus();
  app.frameOpen = close;
  return close;
}

// Sleep mode: a dark screen with a dim clock; a tap wakes it for a while.
export function sleepScreen(app, { manual = false } = {}) {
  const clock = h('div', { class: 'fam-sleep-clock' });
  const el = h('div', { class: 'fam-sleep', tabindex: '0' }, clock, h('div', { class: 'fam-sleep-hint' }, manual ? 'Tap to wake' : 'Sleeping · tap to wake'));
  const tick = () => { clock.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  tick();
  const t = setInterval(tick, 10000);
  const close = () => { clearInterval(t); el.remove(); app.sleepOpen = null; };
  el.addEventListener('click', () => { close(); app.wokeAt = Date.now(); });
  el.addEventListener('keydown', () => { close(); app.wokeAt = Date.now(); });
  app.root.append(el);
  el.focus();
  app.sleepOpen = close;
  return close;
}
