// Preview: opens files from the shared folders, like Preview on a Mac. Pictures (with zoom and
// flicking through the folder), video and audio in any format (converted on the server with
// ffmpeg when the browser can't play it), PDFs, and Word, Excel and PowerPoint documents.

import { h, clear, formatBytes, toast, toastError, spinner, emptyState } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { state } from '../api.js';
import { openApp } from '../wm.js';
import { filesCall, fileUrl, extOf } from '../fileapi.js';
import { fromFiles } from './music-engine.js';

const KIND = {
  image: ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'],
  imageConvert: ['tif', 'tiff', 'heic', 'heif', 'psd', 'tga', 'dds', 'jxl', 'exr', 'pcx', 'ppm', 'pgm', 'tbn', 'cr2', 'nef', 'arw', 'dng'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'm2v', 'vob', 'ogv', '3gp', '3g2', 'divx', 'xvid', 'asf', 'rm', 'rmvb', 'f4v', 'mxf', 'dv'],
  audio: ['mp3', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'weba', 'wma', 'ape', 'ac3', 'eac3', 'dts', 'mka', 'wv', 'tta', 'aiff', 'aif', 'amr', 'alac', 'mp2', 'au'],
  pdf: ['pdf'],
  word: ['docx', 'docm', 'dotx', 'doc', 'dot', 'odt', 'ott', 'rtf', 'wpd'],
  sheet: ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'ots', 'csv', 'tsv', 'numbers'],
  slides: ['pptx', 'pptm', 'ppsx', 'ppt', 'pps', 'odp', 'otp'],
};
export const previewKind = (name) => {
  const ext = extOf(name);
  if (KIND.imageConvert.includes(ext)) return 'image';
  return Object.keys(KIND).find((k) => KIND[k].includes(ext)) || 'other';
};
// Containers the browser plays itself (codecs permitting).
const NATIVE = { video: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'], audio: ['mp3', 'm4a', 'm4b', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'weba'] };
const LABEL = { image: 'Picture', video: 'Video', audio: 'Audio', pdf: 'PDF document', word: 'Word document', sheet: 'Spreadsheet', slides: 'Presentation', other: 'File' };

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  prev: svg('<path d="m15 18-6-6 6-6"/>'), next: svg('<path d="m9 18 6-6-6-6"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'), zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>'),
  rotate: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'), fit: svg('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>', pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  volume: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>'), mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
};

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const tools = () => state.config?.media || {};

export const previewApp = {
  id: 'preview', name: 'Preview', icon: appIcon.preview, size: [1040, 720], description: 'Pictures, video, PDFs and Office documents',
  open(win, opts = {}) { new Preview(win, opts); },
};

class Preview {
  constructor(win, opts) {
    this.win = win;
    this.cleanup = [];
    this.head = h('div', { class: 'pv-head' });
    this.body = h('div', { class: 'pv-body' });
    clear(win.body, h('div', { class: 'pv' }, this.head, this.body));
    win.on('close', () => this.dispose());
    win.on('reopen', (o) => { if (o?.path) this.load(o); });
    if (opts.path) this.load(opts);
    else clear(this.body, emptyState('Nothing to preview', 'Open a file from Files.'));
  }

  dispose() { this.cleanup.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }

  async load({ root, path, size, modified }) {
    this.dispose();
    this.root = Number(root);
    this.path = path;
    this.name = path.split('/').pop();
    this.dir = path.split('/').slice(0, -1).join('/');
    this.kind = previewKind(this.name);
    this.ext = extOf(this.name);
    this.meta = { size, modified };
    this.win.setTitle(this.name);
    this.renderHead();
    clear(this.body, spinner());
    if (size === undefined) {
      // Opened without details (e.g. from another app): look them up.
      filesCall('list', { params: { root: this.root, path: this.dir } }).then((r) => {
        const e = r.entries.find((x) => x.name === this.name);
        if (e) { this.meta = { size: e.size, modified: e.modified }; this.renderHead(); }
      }).catch(() => {});
    }
    try {
      if (this.kind === 'image') await this.showImage();
      else if (this.kind === 'video' || this.kind === 'audio') await this.showMedia();
      else if (this.kind === 'pdf') await this.showPdf(fileUrl(this.root, this.path, true));
      else if (this.kind === 'word' || this.kind === 'slides' || this.kind === 'sheet') await this.showOffice();
      else this.showOther();
    } catch (err) {
      console.error(err);
      clear(this.body, h('div', { class: 'empty error' }, h('div', { class: 'empty-title' }, 'Couldn’t open this file'), h('div', {}, err.message), this.downloadBtn()));
    }
  }

  url(inline = true) { return fileUrl(this.root, this.path, inline); }
  downloadBtn() { return h('a', { class: 'btn', href: this.url(false), download: this.name }, h('span', { html: icon.download }), 'Download'); }

  renderHead() {
    const m = this.meta || {};
    const extra = [];
    if (this.kind === 'audio') extra.push(h('button', { class: 'btn btn-sm', onclick: () => openApp('music', { tracks: fromFiles(this.root, this.dir, [{ name: this.name, size: this.meta?.size }]), play: true }) }, h('span', { html: icon.play }), 'Play in Music'));
    if (this.kind === 'other' || this.kind === 'sheet' && ['csv', 'tsv'].includes(this.ext)) extra.push(h('button', { class: 'btn btn-sm', onclick: () => openApp('notes', { root: this.root, path: this.path }) }, h('span', { html: appIcon.notes }), 'Open in Notes'));
    clear(this.head,
      h('div', { class: 'pv-title' },
        h('strong', {}, this.name),
        h('span', { class: 'small muted' }, [LABEL[this.kind], m.size != null ? formatBytes(m.size) : null, m.modified ? new Date(m.modified).toLocaleString() : null].filter(Boolean).join(' · '))),
      h('div', { class: 'pv-actions' }, ...extra,
        h('button', { class: 'btn btn-sm btn-icon', title: 'Show in Files', 'aria-label': 'Show in Files', html: I.folder, onclick: () => openApp('files', { root: this.root, path: this.dir }) }),
        h('a', { class: 'btn btn-sm btn-icon', title: 'Download', 'aria-label': 'Download', href: this.url(false), download: this.name, html: icon.download })));
  }

  // ---- Pictures ----

  async showImage() {
    const convert = KIND.imageConvert.includes(this.ext);
    if (convert && !tools().ffmpeg) {
      clear(this.body, h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Browsers can’t show this kind of picture'),
        h('div', {}, 'Install ffmpeg on the MediaDesk server to preview it (see Settings → Files).'), this.downloadBtn()));
      return;
    }
    const src = convert ? `/portal/files/image?${new URLSearchParams({ root: this.root, path: this.path })}` : this.url();
    const img = h('img', { class: 'pv-img', src, alt: this.name, draggable: 'false' });
    const stage = h('div', { class: 'pv-stage', tabindex: '0' }, img);
    const zoomLabel = h('span', { class: 'pv-zoom small' });
    let scale = 1, fitScale = 1, x = 0, y = 0, rot = 0, fitted = true;
    const apply = () => {
      img.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      stage.classList.toggle('zoomed', scale > fitScale + 0.001);
    };
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const sideways = rot % 180 !== 0;
      const w = sideways ? img.naturalHeight : img.naturalWidth, hh = sideways ? img.naturalWidth : img.naturalHeight;
      if (!w || !r.width) return;
      fitScale = Math.min(1, (r.width - 24) / w, (r.height - 24) / hh);
      scale = fitScale; x = 0; y = 0; fitted = true;
      apply();
    };
    const zoomAt = (factor, cx = 0, cy = 0) => {
      const next = Math.max(fitScale * 0.5, Math.min(16, scale * factor));
      x = cx - (cx - x) * (next / scale); y = cy - (cy - y) * (next / scale);
      scale = next; fitted = false;
      apply();
    };
    img.style.width = 'auto';
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(convert ? 'The server couldn’t convert this picture' : 'The picture couldn’t be loaded')); clear(this.body, h('div', { class: 'pv-image' }, stage)); });
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;

    // Other pictures in the same folder, for ← and →.
    let siblings = [];
    filesCall('list', { params: { root: this.root, path: this.dir } }).then((r) => {
      siblings = r.entries.filter((e) => !e.dir && previewKind(e.name) === 'image').map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      count.textContent = siblings.length > 1 ? `${siblings.indexOf(this.name) + 1} of ${siblings.length}` : '';
      prevBtn.disabled = nextBtn.disabled = siblings.length < 2;
    }).catch(() => {});
    const step = (d) => {
      if (siblings.length < 2) return;
      const i = (siblings.indexOf(this.name) + d + siblings.length) % siblings.length;
      this.load({ root: this.root, path: this.dir ? `${this.dir}/${siblings[i]}` : siblings[i] });
    };
    const tool = (glyph, title, fn) => h('button', { class: 'btn btn-sm btn-icon btn-ghost', title, 'aria-label': title, html: glyph, onclick: fn });
    const prevBtn = tool(I.prev, 'Previous picture (←)', () => step(-1));
    const nextBtn = tool(I.next, 'Next picture (→)', () => step(1));
    prevBtn.disabled = nextBtn.disabled = true;
    const count = h('span', { class: 'small muted' });
    const bar = h('div', { class: 'pv-toolbar' }, prevBtn, count, nextBtn, h('span', { class: 'pv-sep' }),
      tool(I.zoomOut, 'Zoom out', () => zoomAt(1 / 1.25)), zoomLabel, tool(I.zoomIn, 'Zoom in', () => zoomAt(1.25)),
      tool(I.fit, 'Fit to window', fit), tool(I.rotate, 'Rotate', () => { rot = (rot + 90) % 360; fit(); }),
      this.kind === 'image' && !convert && this.ext !== 'ico' ? h('button', { class: 'btn btn-sm', onclick: async () => {
        try { const { setWallpaperFromFile } = await import('../desktop.js'); await setWallpaperFromFile(this.root, this.path); toast('Wallpaper changed', { type: 'success', timeout: 2000 }); }
        catch (err) { toastError(err, 'Could not set the wallpaper'); }
      } }, 'Set as wallpaper') : null);
    this.body.querySelector('.pv-image').append(bar);
    fit();

    // Wheel / pinch zoom, drag to pan, double-click to toggle 100%.
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    }, { passive: false });
    const pts = new Map();
    let pinch = 0;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; });
    stage.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = stage.getBoundingClientRect();
        if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left - r.width / 2, (a[1] + b[1]) / 2 - r.top - r.height / 2);
        pinch = d;
        return;
      }
      if (scale <= fitScale + 0.001) return;
      x += e.clientX - prev[0]; y += e.clientY - prev[1];
      apply();
    });
    let swipeStart = null;
    stage.addEventListener('pointerdown', (e) => { swipeStart = [e.clientX, e.clientY, Date.now()]; });
    const up = (e) => {
      pts.delete(e.pointerId);
      // A quick sideways swipe when not zoomed moves to the next picture.
      if (swipeStart && fitted && e.pointerType === 'touch') {
        const dx = e.clientX - swipeStart[0], dy = e.clientY - swipeStart[1];
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipeStart[2] < 600) step(dx < 0 ? 1 : -1);
      }
      swipeStart = null;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', (e) => {
      if (scale > fitScale + 0.001) fit();
      else { const r = stage.getBoundingClientRect(); zoomAt(Math.max(1, fitScale * 2.5) / scale, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2); }
    });
    stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-') zoomAt(0.8);
      else if (e.key === '0') fit();
    });
    const ro = new ResizeObserver(() => { if (fitted) fit(); });
    ro.observe(stage);
    this.cleanup.push(() => ro.disconnect());
    stage.focus({ preventScroll: true });
  }

  // ---- Video & audio ----

  async showMedia() {
    const isVideo = this.kind === 'video';
    const canConvert = tools().ffmpeg;
    let info = null;
    if (canConvert) { try { info = await filesCall('probe', { params: { root: this.root, path: this.path } }); } catch { info = null; } }
    const nativeContainer = NATIVE[this.kind].includes(this.ext);
    const reason = info ? unsupported(info, isVideo) : null;
    if (nativeContainer && !reason) return this.nativePlayer(isVideo, info);
    if (!canConvert) {
      if (nativeContainer) return this.nativePlayer(isVideo, null);
      clear(this.body, h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, `Browsers can’t play .${this.ext} files`),
        h('div', {}, 'Install ffmpeg on the MediaDesk server and Preview will convert it while it plays (see Settings → Files). You can also play it in Jellyfin.'),
        this.downloadBtn()));
      return;
    }
    return this.convertedPlayer(isVideo, info, reason);
  }

  nativePlayer(isVideo, info) {
    const el = h(isVideo ? 'video' : 'audio', { class: 'pv-native', src: this.url(), controls: true, autoplay: true, preload: 'metadata', playsinline: true });
    const wrap = h('div', { class: `pv-media ${isVideo ? 'video' : 'audio'}` }, isVideo ? el : h('div', { class: 'pv-audio-art', html: appIcon.music }), isVideo ? null : el);
    clear(this.body, wrap);
    this.cleanup.push(() => { el.pause(); el.removeAttribute('src'); el.load(); });
    // If the browser turns out not to manage it, switch to converting on the server.
    const fallback = (why) => {
      if (!tools().ffmpeg || wrap.dataset.fell) return;
      wrap.dataset.fell = '1';
      el.pause();
      this.convertedPlayer(isVideo, info, why);
    };
    el.addEventListener('error', () => {
      if (tools().ffmpeg) fallback('the browser couldn’t play it');
      else wrap.append(h('p', { class: 'small muted pv-msg' }, 'Your browser can’t play this file. Install ffmpeg on the server to convert it, or download it.'));
    });
    if (isVideo) el.addEventListener('loadeddata', () => { if (!el.videoWidth && (!info || info.video)) fallback('the browser couldn’t decode its picture'); });
    if (info?.audio?.length > 1) wrap.append(this.trackPicker(info, 0, (i) => { wrap.dataset.fell = '1'; el.pause(); this.convertedPlayer(isVideo, info, null, { audio: i, start: el.currentTime }); }));
  }

  trackPicker(info, current, onPick) {
    const sel = h('select', { class: 'input pv-track', title: 'Audio track' }, info.audio.map((a) =>
      h('option', { value: a.index, selected: a.index === current }, [a.title, a.language?.toUpperCase(), a.codec?.toUpperCase(), a.channels > 2 ? `${a.channels}ch` : null].filter(Boolean).join(' · ') || `Track ${a.index + 1}`)));
    sel.addEventListener('change', () => onPick(Number(sel.value)));
    return h('label', { class: 'pv-track-row small' }, h('span', { class: 'muted' }, 'Audio'), sel);
  }

  // Plays a stream converted by the server. The stream has no length or seeking of its own, so this
  // player keeps its own clock and restarts the stream from the new position when you seek.
  convertedPlayer(isVideo, info, reason, { audio = 0, start = 0 } = {}) {
    const duration = info?.duration || 0;
    const el = h(isVideo ? 'video' : 'audio', { class: 'pv-native', autoplay: true, playsinline: true });
    let offset = 0, seeking = false, track = audio;
    const playBtn = h('button', { class: 'pv-ctl', title: 'Play/pause', 'aria-label': 'Play or pause', html: I.pause });
    const time = h('span', { class: 'pv-time' }, '0:00');
    const total = h('span', { class: 'pv-time muted' }, fmtTime(duration));
    const seek = h('input', { type: 'range', class: 'pv-seek', min: 0, max: Math.max(1, duration), step: 0.1, value: 0, 'aria-label': 'Position' });
    const vol = h('input', { type: 'range', class: 'pv-vol', min: 0, max: 1, step: 0.02, value: 1, 'aria-label': 'Volume' });
    const muteBtn = h('button', { class: 'pv-ctl', title: 'Mute', 'aria-label': 'Mute', html: I.volume });
    const fullBtn = isVideo ? h('button', { class: 'pv-ctl', title: 'Full screen', 'aria-label': 'Full screen', html: I.full }) : null;
    const busy = h('div', { class: 'pv-busy', hidden: true }, h('div', { class: 'spinner' }));
    const note = h('div', { class: 'pv-note small' }, `Converting on the server${reason ? ` because ${reason}` : ''}.`);
    const controls = h('div', { class: 'pv-controls' }, playBtn, time, seek, total, muteBtn, vol,
      info?.audio?.length > 1 ? this.trackPicker(info, track, (i) => { track = i; load(position()); }) : null, fullBtn);
    const screen = h('div', { class: 'pv-screen' }, isVideo ? el : h('div', { class: 'pv-audio-art', html: appIcon.music }), busy);
    const wrap = h('div', { class: `pv-media converted ${isVideo ? 'video' : 'audio'}` }, screen, controls, isVideo ? null : el, note);
    clear(this.body, wrap);

    const position = () => offset + (el.currentTime || 0);
    const load = (t) => {
      offset = Math.max(0, Math.min(t, Math.max(0, duration - 1)));
      busy.hidden = false;
      el.src = `/portal/files/stream?${new URLSearchParams({ root: this.root, path: this.path, start: offset.toFixed(2), audio: track, format: STREAM_FORMAT, ...(isVideo ? {} : { audioOnly: 1 }) })}`;
      el.play().catch(() => {});
    };
    el.addEventListener('waiting', () => { busy.hidden = false; });
    el.addEventListener('playing', () => { busy.hidden = true; playBtn.innerHTML = I.pause; });
    el.addEventListener('pause', () => { playBtn.innerHTML = I.play; });
    el.addEventListener('timeupdate', () => {
      if (seeking) return;
      const p = position();
      time.textContent = fmtTime(p);
      seek.value = String(p);
      seek.style.setProperty('--pct', `${duration ? (p / duration) * 100 : 0}%`);
    });
    el.addEventListener('error', async () => {
      busy.hidden = true;
      let msg = 'The server couldn’t convert this file.';
      try { const r = await fetch(el.src); const j = await r.json(); if (j.error) msg = j.error; } catch { /* keep generic */ }
      note.textContent = msg;
      note.classList.add('error');
    });
    playBtn.onclick = () => (el.paused ? el.play() : el.pause());
    seek.addEventListener('input', () => { seeking = true; time.textContent = fmtTime(Number(seek.value)); seek.style.setProperty('--pct', `${duration ? (seek.value / duration) * 100 : 0}%`); });
    seek.addEventListener('change', () => { seeking = false; load(Number(seek.value)); });
    vol.addEventListener('input', () => { el.volume = Number(vol.value); el.muted = false; muteBtn.innerHTML = el.volume ? I.volume : I.mute; });
    muteBtn.onclick = () => { el.muted = !el.muted; muteBtn.innerHTML = el.muted ? I.mute : I.volume; };
    if (fullBtn) fullBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen?.());
    if (isVideo) el.addEventListener('click', () => (el.paused ? el.play() : el.pause()));
    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); playBtn.click(); }
      else if (e.key === 'ArrowRight') load(position() + 10);
      else if (e.key === 'ArrowLeft') load(position() - 10);
      else if (e.key === 'f' && fullBtn) fullBtn.click();
    });
    this.cleanup.push(() => { el.pause(); el.removeAttribute('src'); el.load(); });
    load(start);
    wrap.focus({ preventScroll: true });
  }

  // ---- PDF ----

  async showPdf(source) {
    const holder = h('div', { class: 'pv-pdf' });
    clear(this.body, holder);
    const { showPdf } = await import('./pdfview.js');
    const viewer = await showPdf(holder, source);
    this.cleanup.push(() => viewer.destroy());
  }

  // ---- Office ----

  async showOffice() {
    const legacy = ['doc', 'dot', 'rtf', 'wpd', 'ppt', 'pps', 'odp', 'otp', 'odt', 'ott', 'numbers'].includes(this.ext);
    // Spreadsheets read best as tables, so they always open here. Documents and slides look most
    // faithful converted to PDF by LibreOffice, when the server has it.
    const useServer = tools().office && (this.kind !== 'sheet' || this.ext === 'numbers');
    if (useServer) {
      const note = h('div', { class: 'pv-converting' }, h('div', { class: 'spinner' }), h('div', {}, 'Converting with LibreOffice…'), h('div', { class: 'small muted' }, 'Large documents can take a little while the first time.'));
      clear(this.body, note);
      return this.showPdf(`/portal/files/convert?${new URLSearchParams({ root: this.root, path: this.path, v: this.meta?.modified || '' })}`);
    }
    if (legacy) {
      clear(this.body, h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, `.${this.ext} files need LibreOffice to preview`),
        h('div', {}, 'Install LibreOffice on the MediaDesk server (see Settings → Files), or download the file.'), this.downloadBtn()));
      return;
    }
    const res = await fetch(this.url(false), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length')) > 60 * 1024 * 1024) throw new Error('This file is too large to preview in the browser');
    const buf = await res.arrayBuffer();
    const holder = h('div', { class: 'pv-office' });
    clear(this.body, holder);
    const office = await import('./office.js');
    if (this.kind === 'word') await office.showDocx(holder, buf);
    else if (this.kind === 'sheet') await office.showSheet(holder, buf);
    else await office.showPptx(holder, buf);
    if (this.kind !== 'sheet') {
      holder.prepend(h('div', { class: 'pv-hint small' }, 'Simplified preview. ', tools().office ? '' : 'Install LibreOffice on the server for an exact one (Settings → Files).'));
    }
  }

  showOther() {
    clear(this.body, h('div', { class: 'empty' },
      h('div', { class: 'pv-file-icon', html: icon.file || appIcon.preview }),
      h('div', { class: 'empty-title' }, 'No preview for this kind of file'),
      h('div', { class: 'btn-row' }, this.downloadBtn(), h('button', { class: 'btn', onclick: () => openApp('notes', { root: this.root, path: this.path }) }, 'Open as text in Notes'))));
  }
}

// Why the browser can't play a file as it is (null when it can).
const probeEl = document.createElement('video');
// What the server converts to: MP4 (H.264 + AAC) where supported, otherwise WebM (VP8 + Opus).
const STREAM_FORMAT = probeEl.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"') ? 'mp4' : 'webm';
const VCODEC = { h264: 'avc1.640028', hevc: 'hvc1.1.6.L120.90', vp8: 'vp8', vp9: 'vp09.00.10.08', av1: 'av01.0.08M.08', theora: 'theora' };
const ACODEC = { aac: ['audio/mp4', 'mp4a.40.2'], mp3: ['audio/mpeg', ''], opus: ['audio/webm', 'opus'], vorbis: ['audio/webm', 'vorbis'], flac: ['audio/flac', ''], pcm_s16le: ['audio/wav', ''], pcm_s24le: ['audio/wav', ''], alac: ['audio/mp4', 'alac'], ac3: ['audio/mp4', 'ac-3'], eac3: ['audio/mp4', 'ec-3'] };
function unsupported(info, isVideo) {
  if (isVideo && info.video) {
    const c = VCODEC[info.video.codec];
    const type = info.video.codec === 'vp8' || info.video.codec === 'vp9' ? `video/webm; codecs="${c}"` : `video/mp4; codecs="${c}"`;
    if (!c || !probeEl.canPlayType(type)) return `its video (${info.video.codec?.toUpperCase()}) isn’t supported by this browser`;
    if (/10/.test(info.video.pixFmt || '') && info.video.codec === 'h264') return 'it uses 10-bit H.264';
  }
  const a = info.audio[0];
  if (a) {
    const [mime, codec] = ACODEC[a.codec] || [];
    if (!mime || !probeEl.canPlayType(codec ? `${mime}; codecs="${codec}"` : mime)) return `its audio (${a.codec?.toUpperCase()}) isn’t supported by this browser`;
  }
  return null;
}
