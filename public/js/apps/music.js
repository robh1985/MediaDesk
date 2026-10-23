// Music: a Winamp-style player — main panel with LCD, 10-band equalizer, playlist editor,
// a MilkDrop-style visualizer, and a library browser for Jellyfin music and shared folders.

import { h, clear, debounce, toast, toastError, contextMenu, spinner, emptyState, errorState, isTouch } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { jellyfin, jellyfinUserId, jellyfinImage, isConfigured, state, appPref } from '../api.js';
import * as eng from './music-engine.js';
import { createVisualizer, PRESETS } from './milkdrop.js';

const PREFS = 'mediadesk.music.ui';
const loadUi = () => { try { return { eq: false, pl: true, vis: true, remaining: false, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { eq: false, pl: true, vis: true, remaining: false }; } };
const saveUi = (ui) => { try { localStorage.setItem(PREFS, JSON.stringify(ui)); } catch { /* ignore */ } };

const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const trackLabel = (t) => (t.artist ? `${t.artist} - ${t.title}` : t.title);

const svg = (body) => `<svg viewBox="0 0 24 24" fill="currentColor">${body}</svg>`;
const GLYPH = {
  prev: svg('<path d="M5 5h2.5v14H5zM19 5v14L8.5 12z"/>'),
  play: svg('<path d="M7 4.5v15L19.5 12z"/>'),
  pause: svg('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'),
  stop: svg('<path d="M6 6h12v12H6z"/>'),
  next: svg('<path d="M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z"/>'),
  eject: svg('<path d="M12 5l7 8H5zM5 16h14v3H5z"/>'),
};

export const musicApp = {
  id: 'music', name: 'Music', icon: appIcon.music, size: [1040, 720], description: 'Winamp-style player with visualizer',
  open(win, opts = {}) { new MusicPlayer(win, opts); },
};

// Other apps call this to play or queue tracks: openApp('music', { tracks, play: true })
function handleIncoming(opts) {
  if (!opts?.tracks?.length) return;
  eng.enqueue(opts.tracks, { play: Boolean(opts.play), replace: Boolean(opts.replace) });
  toast(opts.play ? `Playing ${opts.tracks.length === 1 ? opts.tracks[0].title : `${opts.tracks.length} tracks`}` : `Added ${opts.tracks.length} track${opts.tracks.length === 1 ? '' : 's'} to the playlist`, { icon: appIcon.music, timeout: 2500 });
}

class MusicPlayer {
  constructor(win, opts) {
    this.win = win;
    this.ui = loadUi();
    this.selected = new Set();
    this.anchor = -1;
    this.seeking = false;
    this.build();
    this.unsub = eng.subscribe(() => this.update());
    this.startMeters();
    handleIncoming(opts);
    win.on('reopen', handleIncoming);
    // Like Winamp, closing the player stops the music (minimising keeps it playing).
    win.on('close', () => { eng.stop(); this.unsub(); this.vis?.stop(); cancelAnimationFrame(this.meterRaf); });
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  build() {
    const btn = (glyph, title, onclick, cls = '') => h('button', { class: `wa-btn ${cls}`, title, 'aria-label': title, html: glyph, onclick });
    const tog = (label, title, onclick) => h('button', { class: 'wa-toggle', title, 'aria-label': title, onclick }, h('span', { class: 'wa-led' }), label);

    this.stateGlyph = h('span', { class: 'wa-state' });
    this.time = h('button', { class: 'wa-time', title: 'Show elapsed / remaining time', onclick: () => { this.ui.remaining = !this.ui.remaining; saveUi(this.ui); this.update(); } });
    this.meter = h('canvas', { class: 'wa-meter', width: 152, height: 34 });
    this.marquee = h('div', { class: 'wa-marquee' }, h('span', {}));
    this.kbps = h('span', { class: 'wa-num' });
    this.khz = h('span', { class: 'wa-num' });
    this.mono = h('span', { class: 'wa-ind' }, 'mono');
    this.stereo = h('span', { class: 'wa-ind' }, 'stereo');
    this.volume = h('input', { type: 'range', class: 'wa-range wa-volume', min: 0, max: 100, title: 'Volume', 'aria-label': 'Volume' });
    this.balance = h('input', { type: 'range', class: 'wa-range wa-balance', min: -100, max: 100, title: 'Balance', 'aria-label': 'Balance' });
    this.seek = h('input', { type: 'range', class: 'wa-range wa-seek', min: 0, max: 1000, value: 0, title: 'Seek', 'aria-label': 'Seek' });
    this.shuffleBtn = tog('Shuffle', 'Shuffle', () => eng.setShuffle(!eng.player.shuffle));
    this.repeatBtn = tog('Repeat', 'Repeat: off / all / one', () => eng.cycleRepeat());
    this.eqBtn = tog('EQ', 'Show the equalizer', () => this.togglePanel('eq'));
    this.plBtn = tog('PL', 'Show the playlist', () => this.togglePanel('pl'));
    this.visBtn = tog('VIS', 'Show the visualizer', () => this.togglePanel('vis'));

    this.volume.addEventListener('input', () => eng.setVolume(this.volume.value / 100));
    this.balance.addEventListener('input', () => {
      const v = Math.abs(this.balance.value) < 8 ? 0 : this.balance.value;   // snap to centre
      eng.setBalance(v / 100);
    });
    this.seek.addEventListener('input', () => {
      this.seeking = true;
      const d = eng.player.audio.duration || eng.current()?.duration || 0;
      this.time.textContent = fmt((this.seek.value / 1000) * d);
    });
    this.seek.addEventListener('change', () => {
      const d = eng.player.audio.duration || eng.current()?.duration || 0;
      eng.seek((this.seek.value / 1000) * d);
      this.seeking = false;
    });

    const main = h('section', { class: 'wa-main' },
      h('div', { class: 'wa-display' },
        h('div', { class: 'wa-lcd' },
          h('div', { class: 'wa-lcd-left' }, h('div', { class: 'wa-lcd-row' }, this.stateGlyph, this.time), this.meter),
          h('div', { class: 'wa-lcd-right' }, this.marquee,
            h('div', { class: 'wa-info' }, this.kbps, h('span', { class: 'wa-unit' }, 'kbps'), this.khz, h('span', { class: 'wa-unit' }, 'khz'), h('span', { class: 'spacer' }), this.mono, this.stereo))),
        h('div', { class: 'wa-sliders' },
          h('label', { class: 'wa-slider' }, h('span', {}, 'Vol'), this.volume),
          h('label', { class: 'wa-slider' }, h('span', {}, 'Bal'), this.balance))),
      this.seek,
      h('div', { class: 'wa-controls' },
        h('div', { class: 'wa-transport' },
          btn(GLYPH.prev, 'Previous track', () => eng.prev()),
          this.playBtn = btn(GLYPH.play, 'Play', () => eng.play()),
          btn(GLYPH.pause, 'Pause', () => eng.pause()),
          btn(GLYPH.stop, 'Stop', () => eng.stop()),
          btn(GLYPH.next, 'Next track', () => eng.next()),
          btn(GLYPH.eject, 'Open library', () => this.openLibrary(), 'wa-eject')),
        h('div', { class: 'wa-toggles' }, this.shuffleBtn, this.repeatBtn, this.eqBtn, this.plBtn, this.visBtn)));

    this.eqPanel = this.buildEq();
    this.visPanel = this.buildVis();
    this.plPanel = this.buildPlaylist();
    this.body = h('div', { class: 'wa-body' }, this.visPanel, this.plPanel);
    this.root = h('div', { class: 'wa' }, main, this.eqPanel, this.body);
    this.win.body.append(this.root);
    this.applyPanels();
  }

  togglePanel(name) {
    this.ui[name] = !this.ui[name];
    saveUi(this.ui);
    this.applyPanels();
  }
  applyPanels() {
    this.eqPanel.hidden = !this.ui.eq;
    this.plPanel.hidden = !this.ui.pl;
    this.visPanel.hidden = !this.ui.vis;
    this.body.hidden = !this.ui.pl && !this.ui.vis;
    this.eqBtn.classList.toggle('on', this.ui.eq);
    this.plBtn.classList.toggle('on', this.ui.pl);
    this.visBtn.classList.toggle('on', this.ui.vis);
    this.body.classList.toggle('vis-only', this.ui.vis && !this.ui.pl);
    this.body.classList.toggle('pl-only', this.ui.pl && !this.ui.vis);
    if (this.ui.vis) this.vis?.start(); else this.vis?.stop();
  }

  // ---------------------------------------------------------------------------
  // Equalizer
  // ---------------------------------------------------------------------------

  buildEq() {
    const onBtn = h('button', { class: 'wa-toggle', title: 'Turn the equalizer on or off', onclick: () => eng.setEq({ on: !eng.player.eq.on }) }, h('span', { class: 'wa-led' }), 'On');
    const presets = h('select', { class: 'wa-select', title: 'Presets', 'aria-label': 'Equalizer presets' },
      h('option', { value: '' }, 'Presets…'), Object.keys(eng.EQ_PRESETS).map((n) => h('option', { value: n }, n)));
    presets.addEventListener('change', () => {
      if (presets.value) eng.setEq({ bands: eng.EQ_PRESETS[presets.value].slice(), preset: presets.value });
    });
    const curve = h('canvas', { class: 'wa-eq-curve', width: 220, height: 40 });
    const slider = (label, value, onInput, title) => {
      const input = h('input', { type: 'range', class: 'wa-vslider', min: -12, max: 12, step: 0.5, value, title, 'aria-label': title, orient: 'vertical' });
      input.addEventListener('input', () => onInput(Number(input.value)));
      input.addEventListener('dblclick', () => { input.value = 0; onInput(0); });
      return h('label', { class: 'wa-band' }, input, h('span', {}, label));
    };
    this.preampSlider = slider('Preamp', eng.player.eq.preamp, (v) => eng.setEq({ preamp: v }), 'Preamp (dB)');
    this.bandSliders = eng.EQ_BANDS.map((f, i) => slider(f >= 1000 ? `${f / 1000}K` : String(f), eng.player.eq.bands[i], (v) => eng.setEqBand(i, v), `${f} Hz (dB)`));
    this.eqOn = onBtn; this.eqPresets = presets; this.eqCurve = curve;
    return h('section', { class: 'wa-eq' },
      h('div', { class: 'wa-eq-head' }, h('span', { class: 'wa-label' }, 'Equalizer'), onBtn, curve, presets,
        h('button', { class: 'wa-small', onclick: () => eng.setEq({ bands: eng.EQ_PRESETS.Flat.slice(), preamp: 0, preset: 'Flat' }) }, 'Reset')),
      h('div', { class: 'wa-eq-sliders' }, this.preampSlider, h('div', { class: 'wa-eq-scale' }, h('span', {}, '+12 dB'), h('span', {}, '0'), h('span', {}, '-12 dB')), ...this.bandSliders));
  }

  drawEqCurve() {
    const c = this.eqCurve, g = c.getContext('2d');
    const { bands, on } = eng.player.eq;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(0,255,0,.25)';
    g.beginPath(); g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2); g.stroke();
    g.strokeStyle = on ? '#3df23d' : '#3a6a3a';
    g.lineWidth = 2;
    g.beginPath();
    bands.forEach((v, i) => {
      const x = (i / (bands.length - 1)) * (c.width - 8) + 4, y = c.height / 2 - (v / 12) * (c.height / 2 - 4);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  }

  // ---------------------------------------------------------------------------
  // Visualizer
  // ---------------------------------------------------------------------------

  buildVis() {
    const canvas = h('canvas', { class: 'wa-vis-canvas' });
    const label = h('div', { class: 'wa-vis-name' });
    let hideTimer;
    const lockBtn = h('button', { class: 'wa-small', title: 'Stay on this preset' }, 'Lock');
    const box = h('section', { class: 'wa-vis' }, canvas, label,
      h('div', { class: 'wa-vis-bar' },
        h('button', { class: 'wa-small', title: 'Previous preset', onclick: () => this.vis.prev() }, '◀'),
        h('button', { class: 'wa-small', title: 'Next preset', onclick: () => this.vis.next() }, '▶'),
        h('button', { class: 'wa-small', title: 'Random preset', onclick: () => this.vis.random() }, 'Random'),
        lockBtn,
        h('button', { class: 'wa-small', title: 'Choose a preset', onclick: (e) => contextMenu(e.clientX, e.clientY, PRESETS.map((p, i) => ({ label: p.name, action: () => this.vis.select(i) }))) }, 'Presets'),
        h('button', { class: 'wa-small', title: 'Full screen (double-click the picture)', onclick: () => this.fullscreen(box) }, 'Full screen')));
    let locked = false;
    lockBtn.onclick = () => { locked = !locked; this.vis.setLocked(locked); lockBtn.classList.toggle('on', locked); };
    canvas.addEventListener('dblclick', () => this.fullscreen(box));
    this.vis = createVisualizer(canvas, {
      getLevels: eng.analyse,
      quality: appPref('music', 'visQuality') || 'medium',
      autoSeconds: appPref('music', 'visAutoSeconds') ?? 20,
      onPreset: (name) => {
        label.textContent = name;
        label.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => label.classList.remove('show'), 2500);
      },
    });
    this.visBox = box;
    return box;
  }

  fullscreen(box) {
    const doc = document;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) return (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    if (box.classList.contains('wa-vis-max')) return box.classList.remove('wa-vis-max');
    const req = box.requestFullscreen || box.webkitRequestFullscreen;
    // iPhones can't put a page element in full screen; fill the window instead.
    if (req) req.call(box).catch(() => box.classList.add('wa-vis-max'));
    else box.classList.add('wa-vis-max');
  }

  // ---------------------------------------------------------------------------
  // Playlist editor
  // ---------------------------------------------------------------------------

  buildPlaylist() {
    this.list = h('div', { class: 'wa-pl-list', tabindex: 0 });
    this.totals = h('span', { class: 'wa-pl-total' });
    const menuBtn = (label, items) => h('button', { class: 'wa-small', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.top - 8 - items().length * 34, items()); } }, label);
    const sel = () => [...this.selected];
    const footer = h('div', { class: 'wa-pl-foot' },
      h('button', { class: 'wa-small', title: 'Add music from the library', onclick: () => this.openLibrary() }, '+ Add'),
      menuBtn('Rem', () => [
        { label: `Remove selected (${this.selected.size})`, disabled: !this.selected.size, action: () => { eng.removeTracks(sel()); this.selected.clear(); } },
        { label: 'Crop (keep only selected)', disabled: !this.selected.size, action: () => { eng.removeTracks(eng.player.queue.map((_, i) => i).filter((i) => !this.selected.has(i))); this.selected.clear(); } },
        '-', { label: 'Clear playlist', action: () => { eng.clearQueue(); this.selected.clear(); } },
      ]),
      menuBtn('Sel', () => [
        { label: 'Select all', action: () => this.select(eng.player.queue.map((_, i) => i)) },
        { label: 'Select none', action: () => this.select([]) },
        { label: 'Invert selection', action: () => this.select(eng.player.queue.map((_, i) => i).filter((i) => !this.selected.has(i))) },
      ]),
      menuBtn('Misc', () => [
        { label: 'Sort by title', action: () => eng.sortQueue('title') },
        { label: 'Sort by artist', action: () => eng.sortQueue('artist') },
        { label: 'Sort by album', action: () => eng.sortQueue('album') },
        '-', { label: 'Reverse', action: () => eng.sortQueue('reverse') },
        { label: 'Randomize', action: () => eng.sortQueue('random') },
      ]),
      h('span', { class: 'spacer' }), this.totals);

    this.list.addEventListener('keydown', (e) => {
      const n = eng.player.queue.length;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); eng.removeTracks([...this.selected]); this.selected.clear(); }
      else if (e.key === 'Enter' && this.selected.size) eng.playIndex(Math.min(...this.selected));
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(eng.player.queue.map((_, i) => i)); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = Math.max(0, Math.min(n - 1, this.anchor + (e.key === 'ArrowDown' ? 1 : -1)));
        this.anchor = i; this.select([i]);
        this.list.children[i]?.scrollIntoView({ block: 'nearest' });
      }
    });
    return h('section', { class: 'wa-pl' }, h('div', { class: 'wa-pl-head' }, h('span', { class: 'wa-label' }, 'Playlist')), this.list, footer);
  }

  select(indexes) {
    this.selected = new Set(indexes);
    [...this.list.children].forEach((row, i) => row.classList.toggle('sel', this.selected.has(i)));
    this.updateTotals();
  }

  renderPlaylist() {
    const q = eng.player.queue;
    const sig = q.map((t) => t.key).join('|') + `#${eng.player.index}#${q.map((t) => Math.round(t.duration || 0)).join(',')}`;
    if (sig === this.plSig) return;
    this.plSig = sig;
    this.selected = new Set([...this.selected].filter((i) => i < q.length));
    if (!q.length) {
      clear(this.list, h('div', { class: 'wa-pl-empty' }, 'Playlist is empty.', h('button', { class: 'wa-small', onclick: () => this.openLibrary() }, 'Add music')));
      return this.updateTotals();
    }
    clear(this.list, q.map((t, i) => {
      const row = h('div', { class: `wa-pl-row ${i === eng.player.index ? 'current' : ''} ${this.selected.has(i) ? 'sel' : ''}`, draggable: isTouch() ? 'false' : 'true' },
        h('span', { class: 'wa-pl-n' }, `${i + 1}.`), h('span', { class: 'wa-pl-t' }, trackLabel(t)), h('span', { class: 'wa-pl-d' }, t.duration ? fmt(t.duration) : ''));
      row.addEventListener('click', (e) => {
        if (isTouch() && !e.ctrlKey && !e.shiftKey) return eng.playIndex(i);
        if (e.shiftKey && this.anchor >= 0) {
          const [a, b] = [this.anchor, i].sort((x, y) => x - y);
          return this.select(Array.from({ length: b - a + 1 }, (_, k) => a + k));
        }
        this.anchor = i;
        if (e.ctrlKey || e.metaKey) { const s = new Set(this.selected); s.has(i) ? s.delete(i) : s.add(i); return this.select([...s]); }
        this.select([i]);
      });
      row.addEventListener('dblclick', () => eng.playIndex(i));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.selected.has(i)) this.select([i]);
        contextMenu(e.clientX, e.clientY, [
          { label: 'Play', icon: icon.play, action: () => eng.playIndex(i) },
          { label: 'Play next', icon: icon.arrowUp, disabled: eng.player.index < 0, action: () => eng.moveTrack(i, i > eng.player.index ? eng.player.index + 1 : eng.player.index) },
          '-',
          { label: 'Move up', disabled: i === 0, action: () => eng.moveTrack(i, i - 1) },
          { label: 'Move down', disabled: i === q.length - 1, action: () => eng.moveTrack(i, i + 1) },
          '-',
          { label: this.selected.size > 1 ? `Remove ${this.selected.size} tracks` : 'Remove', icon: icon.trash, action: () => { eng.removeTracks([...this.selected]); this.selected.clear(); } },
        ]);
      });
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-wa-index', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-wa-index')) { e.preventDefault(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        row.classList.remove('drop');
        const from = Number(e.dataTransfer.getData('text/x-wa-index'));
        if (Number.isFinite(from)) { e.preventDefault(); eng.moveTrack(from, i); this.select([i]); }
      });
      return row;
    }));
    this.list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    this.updateTotals();
  }

  updateTotals() {
    const q = eng.player.queue;
    const sum = (arr) => arr.reduce((a, t) => a + (t?.duration || 0), 0);
    const sel = [...this.selected].map((i) => q[i]);
    this.totals.textContent = `${sel.length ? `${fmt(sum(sel))} / ` : ''}${fmt(sum(q))} · ${q.length} track${q.length === 1 ? '' : 's'}`;
  }

  // ---------------------------------------------------------------------------
  // Display updates
  // ---------------------------------------------------------------------------

  update() {
    const p = eng.player, t = eng.current(), a = p.audio;
    const playing = p.state === 'playing' || p.state === 'loading';
    clear(this.stateGlyph, h('span', { html: playing ? GLYPH.play : p.state === 'paused' ? GLYPH.pause : GLYPH.stop }));
    this.stateGlyph.className = `wa-state ${p.state}`;
    const dur = Number.isFinite(a.duration) ? a.duration : t?.duration || 0;
    if (!this.seeking) {
      const pos = p.state === 'stopped' ? 0 : a.currentTime || 0;
      this.time.textContent = t ? (this.ui.remaining && dur ? `-${fmt(dur - pos)}` : fmt(pos)) : '';
      this.seek.value = dur ? Math.round((pos / dur) * 1000) : 0;
    }
    this.seek.disabled = !t;
    const text = p.error ? `Can't play this track: ${p.error}` : t ? `${p.index + 1}. ${trackLabel(t)} (${fmt(t.duration || dur)})` : 'MediaDesk Music — open the library to add songs';
    const span = this.marquee.firstChild;
    if (span.dataset.text !== text) {
      span.dataset.text = text;
      span.textContent = text;
      // Scroll the title when it doesn't fit, Winamp style.
      requestAnimationFrame(() => {
        const long = span.scrollWidth > this.marquee.clientWidth;
        this.marquee.classList.toggle('scroll', long);
        if (long) { span.textContent = `${text}  ***  ${text}  ***  `; span.style.animationDuration = `${Math.max(8, text.length * 0.28)}s`; }
      });
    }
    const kbps = t?.bitrate ? Math.round(t.bitrate / 1000) : t?.size && dur ? Math.round((t.size * 8) / dur / 1000) : 0;
    this.kbps.textContent = kbps ? String(kbps).padStart(3, ' ') : '--';
    this.khz.textContent = t?.sampleRate ? String(Math.round(t.sampleRate / 1000)) : '--';
    const ch = t?.channels ?? 2;
    this.mono.classList.toggle('on', Boolean(t) && ch === 1);
    this.stereo.classList.toggle('on', Boolean(t) && ch !== 1);
    if (document.activeElement !== this.volume) this.volume.value = Math.round(p.volume * 100);
    if (document.activeElement !== this.balance) this.balance.value = Math.round(p.balance * 100);
    this.volume.style.setProperty('--fill', `${p.volume * 100}%`);
    this.shuffleBtn.classList.toggle('on', p.shuffle);
    this.repeatBtn.classList.toggle('on', p.repeat !== 'off');
    this.repeatBtn.lastChild.textContent = p.repeat === 'one' ? 'Repeat 1' : 'Repeat';
    this.eqOn.classList.toggle('on', p.eq.on);
    this.preampSlider.querySelector('input').value = p.eq.preamp;
    this.bandSliders.forEach((s, i) => { const inp = s.querySelector('input'); if (document.activeElement !== inp) inp.value = p.eq.bands[i]; });
    this.eqPresets.value = eng.EQ_PRESETS[p.eq.preset] ? p.eq.preset : '';
    this.drawEqCurve();
    this.renderPlaylist();
    this.win.setTitle(t && playing ? `Music — ${t.title}` : 'Music');
  }

  // Winamp's little spectrum analyser in the display.
  startMeters() {
    const c = this.meter, g = c.getContext('2d');
    const bars = 19, peaks = new Float32Array(bars), fall = new Float32Array(bars);
    const grad = g.createLinearGradient(0, c.height, 0, 0);
    grad.addColorStop(0, '#11a311'); grad.addColorStop(0.55, '#d6d300'); grad.addColorStop(1, '#e8331b');
    const draw = () => {
      this.meterRaf = requestAnimationFrame(draw);
      if (!c.isConnected || document.hidden || c.closest('.window.minimized')) return;
      const lv = eng.analyse();
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      const bw = c.width / bars;
      for (let i = 0; i < bars; i++) {
        // Bars spread logarithmically across the spectrum like Winamp's.
        const lo = Math.floor(2 * 1.32 ** i), hi = Math.max(lo + 1, Math.floor(2 * 1.32 ** (i + 1)));
        let v = 0;
        for (let k = lo; k < hi && k < lv.freq.length; k++) v = Math.max(v, lv.freq[k]);
        v = lv.active ? v / 255 : 0;
        fall[i] = Math.max(v, fall[i] - 0.04);
        peaks[i] = Math.max(fall[i], peaks[i] - 0.012);
        const bh = Math.round(fall[i] * c.height);
        g.fillStyle = grad;
        g.fillRect(Math.round(i * bw) + 1, c.height - bh, Math.round(bw) - 2, bh);
        g.fillStyle = '#cfcfcf';
        if (peaks[i] > 0.02) g.fillRect(Math.round(i * bw) + 1, c.height - Math.round(peaks[i] * c.height) - 1, Math.round(bw) - 2, 1);
      }
    };
    draw();
  }

  // ---------------------------------------------------------------------------
  // Library
  // ---------------------------------------------------------------------------

  openLibrary() {
    this.win.body.querySelector('.wa-lib')?.remove();
    const content = h('div', { class: 'wa-lib-content' });
    const tabsEl = h('div', { class: 'tabs wa-lib-tabs' });
    const close = () => panel.remove();
    const panel = h('div', { class: 'sheet wa-lib' },
      h('div', { class: 'sheet-inner wa-lib-inner' },
        h('button', { class: 'btn btn-icon sheet-close', title: 'Close', html: icon.x, onclick: close }),
        h('div', { class: 'pane-header' }, h('h2', {}, 'Music library')),
        tabsEl, content));
    const jf = isConfigured('jellyfin');
    const files = state.config?.files?.enabled;
    const tabs = [
      jf && ['albums', 'Albums'], jf && ['artists', 'Artists'], jf && ['songs', 'Songs'], jf && ['playlists', 'Playlists'], files && ['files', 'Files'],
    ].filter(Boolean);
    if (!tabs.length) {
      clear(content, emptyState('No music sources yet', 'Connect Jellyfin, or share folders in Settings → Files, to add music.'));
    }
    const show = (id) => {
      tabsEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
      clear(content, spinner());
      ({ albums: () => this.libAlbums(content), artists: () => this.libArtists(content), songs: () => this.libSongs(content),
        playlists: () => this.libPlaylists(content), files: () => this.libFiles(content, 0, '') })[id]().catch((err) => clear(content, errorState(err)));
    };
    tabs.forEach(([id, label]) => tabsEl.append(h('button', { class: 'tab', dataset: { id }, onclick: () => show(id) }, label)));
    this.win.body.append(panel);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    if (tabs.length) show(tabs[0][0]);
  }

  async jf(path, params) {
    const uid = await jellyfinUserId();
    return jellyfin.get(path.replace('{uid}', uid), { ...params, ...(path.includes('{uid}') ? {} : { userId: uid }) });
  }

  // Track list with Play / Add; `load` returns Jellyfin items or ready-made queue tracks.
  async trackList(container, title, load, { subtitle = '', art = null } = {}) {
    clear(container, spinner());
    const raw = await load();
    const tracks = raw.length && raw[0].source ? raw : await eng.fromJellyfin(raw);
    const playAll = () => eng.enqueue(tracks, { replace: true });
    const addAll = () => { eng.enqueue(tracks); toast(`Added ${tracks.length} tracks`, { icon: appIcon.music, timeout: 2000 }); };
    clear(container,
      h('div', { class: 'wa-lib-album-head' },
        art ? h('img', { class: 'wa-lib-art', src: art, alt: '' }) : null,
        h('div', { class: 'grow' }, h('h3', {}, title), subtitle ? h('div', { class: 'muted small' }, subtitle) : null,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', disabled: !tracks.length, onclick: playAll }, h('span', { html: icon.play }), 'Play all'),
            h('button', { class: 'btn', disabled: !tracks.length, onclick: addAll }, h('span', { html: icon.plus }), 'Add to playlist')))),
      tracks.length ? h('div', { class: 'wa-lib-tracks' }, tracks.map((t, i) => h('div', { class: 'wa-lib-track' },
        h('span', { class: 'muted wa-lib-num' }, i + 1),
        h('button', { class: 'wa-lib-title', title: 'Play now', onclick: () => eng.enqueue([t], { play: true }) }, h('strong', {}, t.title), h('span', { class: 'muted small' }, [t.artist, t.album].filter(Boolean).join(' · '))),
        h('span', { class: 'muted small' }, t.duration ? fmt(t.duration) : ''),
        h('button', { class: 'btn btn-icon btn-sm', title: 'Add to playlist', html: icon.plus, onclick: () => { eng.enqueue([t]); toast(`Added ${t.title}`, { icon: appIcon.music, timeout: 1500 }); } }))))
        : emptyState('No tracks here'));
  }

  async libAlbums(container, params = {}, title = null, back = null) {
    const res = await this.jf('Users/{uid}/Items', { IncludeItemTypes: 'MusicAlbum', Recursive: true, SortBy: 'AlbumArtist,SortName', Fields: 'PrimaryImageAspectRatio', Limit: 400, ...params });
    const albums = res.Items || [];
    const grid = h('div', { class: 'wa-lib-grid' }, albums.map((a) => {
      const img = a.ImageTags?.Primary ? jellyfinImage(a.Id, { height: 240, tag: a.ImageTags.Primary }) : null;
      return h('button', { class: 'wa-lib-card', onclick: () => this.trackList(container, a.Name, () => this.albumTracks(a.Id), { subtitle: [a.AlbumArtist, a.ProductionYear].filter(Boolean).join(' · '), art: img }).catch((err) => clear(container, errorState(err))) },
        h('div', { class: 'wa-lib-cover' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', { html: appIcon.music })),
        h('strong', {}, a.Name), h('span', { class: 'muted small' }, a.AlbumArtist || ''));
    }));
    clear(container,
      title ? h('div', { class: 'wa-lib-sub' }, back ? h('button', { class: 'btn btn-sm', onclick: back }, '‹ Back') : null, h('h3', {}, title)) : null,
      albums.length ? grid : emptyState('No albums found'));
  }

  async albumTracks(albumId) {
    const res = await this.jf('Users/{uid}/Items', { ParentId: albumId, IncludeItemTypes: 'Audio', Recursive: true, SortBy: 'ParentIndexNumber,IndexNumber,SortName', Fields: 'MediaSources' });
    return (res.Items || []).sort((a, b) => ((a.ParentIndexNumber || 1) - (b.ParentIndexNumber || 1)) || ((a.IndexNumber || 0) - (b.IndexNumber || 0)));
  }

  async libArtists(container) {
    const res = await this.jf('Artists/AlbumArtists', { SortBy: 'SortName', Limit: 1000 });
    const artists = res.Items || [];
    const back = () => this.libArtists(container).catch((err) => clear(container, errorState(err)));
    clear(container, artists.length ? h('div', { class: 'wa-lib-list' }, artists.map((ar) => h('div', { class: 'wa-lib-row' },
      h('button', { class: 'wa-lib-title', onclick: () => this.libAlbums(container, { AlbumArtistIds: ar.Id }, ar.Name, back).catch((err) => clear(container, errorState(err))) }, h('strong', {}, ar.Name)),
      h('button', { class: 'btn btn-sm', title: `Play everything by ${ar.Name}`, onclick: async () => {
        const items = (await this.jf('Users/{uid}/Items', { ArtistIds: ar.Id, IncludeItemTypes: 'Audio', Recursive: true, SortBy: 'Album,ParentIndexNumber,IndexNumber', Fields: 'MediaSources' })).Items || [];
        eng.enqueue(await eng.fromJellyfin(items), { replace: true });
      } }, h('span', { html: icon.play }), 'Play all'))))
      : emptyState('No artists found'));
  }

  async libSongs(container) {
    const input = h('input', { class: 'input', type: 'search', placeholder: 'Search songs…' });
    const results = h('div', {});
    clear(container, h('div', { class: 'toolbar' }, input), results);
    const load = async () => {
      const term = input.value.trim();
      await this.trackList(results, term ? `Songs matching “${term}”` : 'Recently added songs', async () =>
        (await this.jf('Users/{uid}/Items', { IncludeItemTypes: 'Audio', Recursive: true, Fields: 'MediaSources', Limit: 150,
          ...(term ? { searchTerm: term, SortBy: 'SortName' } : { SortBy: 'DateCreated', SortOrder: 'Descending' }) })).Items || []);
    };
    input.addEventListener('input', debounce(() => load().catch((err) => clear(results, errorState(err))), 350));
    setTimeout(() => input.focus(), 50);
    await load();
  }

  async libPlaylists(container) {
    const res = await this.jf('Users/{uid}/Items', { IncludeItemTypes: 'Playlist', Recursive: true, SortBy: 'SortName' });
    const lists = (res.Items || []).filter((p) => !p.MediaType || p.MediaType === 'Audio');
    clear(container, lists.length ? h('div', { class: 'wa-lib-list' }, lists.map((pl) => h('div', { class: 'wa-lib-row' },
      h('button', { class: 'wa-lib-title', onclick: () => this.trackList(container, pl.Name, async () => (await this.jf(`Playlists/${pl.Id}/Items`, { Fields: 'MediaSources' })).Items || []).catch((err) => clear(container, errorState(err))) },
        h('strong', {}, pl.Name), h('span', { class: 'muted small' }, pl.ChildCount ? `${pl.ChildCount} tracks` : '')))))
      : emptyState('No music playlists', 'Create playlists in Jellyfin to see them here.'));
  }

  async libFiles(container, root, dir) {
    const roots = await (await fetch('/portal/files/roots', { credentials: 'same-origin' })).json();
    const res = await fetch(`/portal/files/list?${new URLSearchParams({ root, path: dir })}`, { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const folders = data.entries.filter((e) => e.dir).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const tracks = eng.fromFiles(root, dir, data.entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
    const crumbs = dir ? dir.split('/') : [];
    const go = (r, d) => () => this.libFiles(container, r, d).catch((err) => clear(container, errorState(err)));
    const head = h('div', { class: 'wa-lib-sub' },
      h('select', { class: 'input', onchange: (e) => go(Number(e.target.value), '')() }, roots.map((r) => h('option', { value: r.id, selected: r.id === root }, r.name))),
      h('div', { class: 'fm-crumbs' }, h('button', { class: 'fm-crumb', onclick: go(root, '') }, roots[root]?.name || ''),
        crumbs.map((c, i) => [h('span', { class: 'fm-crumb-sep' }, '›'), h('button', { class: 'fm-crumb', onclick: go(root, crumbs.slice(0, i + 1).join('/')) }, c)])));
    const folderList = folders.length ? h('div', { class: 'wa-lib-list' }, folders.map((f) => h('div', { class: 'wa-lib-row' },
      h('button', { class: 'wa-lib-title', onclick: go(root, dir ? `${dir}/${f.name}` : f.name) }, h('span', { class: 'wa-folder', html: icon.folder }), h('strong', {}, f.name))))) : null;
    const trackBox = h('div', {});
    clear(container, head, folderList, trackBox);
    if (tracks.length) await this.trackList(trackBox, dir ? dir.split('/').pop() : roots[root]?.name, async () => tracks);
    else if (!folders.length) clear(trackBox, emptyState('No music in this folder'));
  }
}
