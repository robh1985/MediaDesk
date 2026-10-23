// Music playback engine: queue, shuffle/repeat, 10-band equalizer, balance, audio analysis for the
// visualizer, lock-screen controls (Media Session) and a remembered playlist. Lives outside the
// window so music keeps playing while the player is minimised.

import { jellyfinImage, jellyfinUserId } from '../api.js';

const STORE = 'mediadesk.music';
export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Classical: [0, 0, 0, 0, 0, 0, -7, -7, -7, -9],
  Club: [0, 0, 8, 6, 6, 6, 3, 0, 0, 0],
  Dance: [9, 7, 2, 0, 0, -5, -7, -7, 0, 0],
  'Full Bass': [-8, 9, 9, 5, 1, -4, -8, -10, -11, -11],
  'Full Bass & Treble': [7, 5, 0, -7, -4, 1, 8, 11, 12, 12],
  'Full Treble': [-9, -9, -9, -4, 2, 11, 12, 12, 12, 12],
  'Laptop Speakers': [4, 11, 5, -3, -2, 1, 4, 9, 12, 12],
  'Large Hall': [10, 10, 5, 5, 0, -4, -4, -4, 0, 0],
  Live: [-4, 0, 4, 5, 5, 5, 4, 2, 2, 2],
  Party: [7, 7, 0, 0, 0, 0, 0, 0, 7, 7],
  Pop: [-1, 4, 7, 8, 5, 0, -2, -2, -1, -1],
  Reggae: [0, 0, 0, -5, 0, 6, 6, 0, 0, 0],
  Rock: [8, 4, -5, -8, -3, 4, 8, 11, 11, 11],
  Ska: [-2, -4, -4, 0, 4, 5, 8, 9, 11, 9],
  Soft: [4, 1, 0, -2, 0, 4, 8, 9, 11, 12],
  'Soft Rock': [4, 4, 2, 0, -4, -5, -3, 0, 2, 8],
  Techno: [8, 5, 0, -5, -4, 0, 8, 9, 9, 8],
};

const MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', m4b: 'audio/mp4',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', webm: 'audio/webm', webma: 'audio/webm', wav: 'audio/wav',
};
export const AUDIO_EXT = new Set(Object.keys(MIME).concat(['wma', 'aiff', 'alac', 'ape', 'wv']));

const audio = new Audio();
audio.preload = 'auto';

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();
export const player = {
  queue: saved.queue || [],
  index: saved.index ?? -1,
  shuffle: Boolean(saved.shuffle),
  repeat: saved.repeat || 'off',          // off | all | one
  volume: saved.volume ?? 0.8,
  balance: saved.balance ?? 0,
  eq: { on: saved.eq?.on ?? true, preamp: saved.eq?.preamp ?? 0, bands: saved.eq?.bands || EQ_PRESETS.Flat.slice(), preset: saved.eq?.preset || 'Flat' },
  state: 'stopped',                        // stopped | playing | paused | loading
  error: null,
  audio,
};
let resumeAt = saved.position || 0;
let history = [];                          // indexes played, for shuffle "previous"

// ---------------------------------------------------------------------------
// Events & persistence
// ---------------------------------------------------------------------------

const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); fn(player); return () => subs.delete(fn); };
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; subs.forEach((fn) => fn(player)); });
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        queue: player.queue, index: player.index, shuffle: player.shuffle, repeat: player.repeat,
        volume: player.volume, balance: player.balance, eq: player.eq, position: audio.currentTime || resumeAt || 0,
      }));
    } catch { /* storage full or blocked */ }
  }, 400);
}

// ---------------------------------------------------------------------------
// Audio graph: source → preamp → 10 EQ bands → balance → analyser → volume → speakers
// ---------------------------------------------------------------------------

let ctx = null;
const nodes = {};
export function ensureGraph() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  nodes.source = ctx.createMediaElementSource(audio);
  nodes.preamp = ctx.createGain();
  nodes.bands = EQ_BANDS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.1;
    return b;
  });
  nodes.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  nodes.analyser = ctx.createAnalyser();
  nodes.analyser.fftSize = 2048;
  nodes.analyser.smoothingTimeConstant = 0.72;
  nodes.volume = ctx.createGain();
  let chain = nodes.source;
  for (const n of [nodes.preamp, ...nodes.bands, nodes.panner, nodes.analyser, nodes.volume].filter(Boolean)) { chain.connect(n); chain = n; }
  chain.connect(ctx.destination);
  applyEq();
  applyVolume();
  return ctx;
}

function applyEq() {
  if (!ctx) return;
  const on = player.eq.on;
  nodes.preamp.gain.value = on ? 10 ** (player.eq.preamp / 20) : 1;
  nodes.bands.forEach((b, i) => { b.gain.value = on ? player.eq.bands[i] : 0; });
}
function applyVolume() {
  // With the Web Audio graph running, volume is applied there; otherwise on the element.
  if (ctx) { nodes.volume.gain.value = player.volume ** 2; audio.volume = 1; } else audio.volume = player.volume ** 2;
  if (nodes.panner) nodes.panner.pan.value = player.balance;
}

// Frequency/wave data and smoothed bass/mid/treble levels for the visualizers.
const freqData = new Uint8Array(1024);
const waveData = new Uint8Array(2048);
const levels = { bass: 0, mid: 0, treb: 0, bassAtt: 0, midAtt: 0, trebAtt: 0, beat: 0, freq: freqData, wave: waveData, active: false };
let avgBass = 0.1, lastBeat = 0, lastAnalyse = 0;
export function analyse() {
  // Several views read the levels each frame; analyse once per frame so beats aren't double-counted.
  const stamp = performance.now();
  if (stamp - lastAnalyse < 8) return levels;
  lastAnalyse = stamp;
  const playing = player.state === 'playing' && nodes.analyser;
  if (playing) {
    nodes.analyser.getByteFrequencyData(freqData);
    nodes.analyser.getByteTimeDomainData(waveData);
  } else {
    freqData.fill(0);
    waveData.fill(128);
  }
  const band = (from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += freqData[i];
    return s / ((to - from) * 255);
  };
  // FFT bins are ~ (sampleRate / 2048) Hz wide: bass < 250 Hz, mid < 4 kHz, treble above.
  const binHz = (ctx?.sampleRate || 44100) / 2048;
  const b = band(1, Math.max(2, Math.round(250 / binHz)));
  const m = band(Math.round(250 / binHz), Math.round(4000 / binHz));
  const t = band(Math.round(4000 / binHz), Math.round(14000 / binHz));
  levels.bass = b; levels.mid = m; levels.treb = t;
  levels.bassAtt = levels.bassAtt * 0.85 + b * 0.15;
  levels.midAtt = levels.midAtt * 0.85 + m * 0.15;
  levels.trebAtt = levels.trebAtt * 0.85 + t * 0.15;
  avgBass = avgBass * 0.97 + b * 0.03;
  const now = performance.now();
  levels.beat = b > avgBass * 1.35 && b > 0.25 && now - lastBeat > 280 ? 1 : levels.beat * 0.9;
  if (levels.beat === 1) lastBeat = now;
  levels.active = Boolean(playing);
  return levels;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function streamUrl(track) {
  if (track.source === 'file') return `/portal/files/download?${new URLSearchParams({ root: track.root, path: track.path, inline: 1 })}`;
  const container = String(track.container || '').toLowerCase().split(',')[0];
  // Play the original file when this browser can; otherwise ask Jellyfin to convert it to MP3.
  if (MIME[container] && audio.canPlayType(MIME[container])) return `/api/jellyfin/Audio/${track.id}/stream?static=true`;
  const q = new URLSearchParams({ UserId: track.userId || '', DeviceId: 'mediadesk', MaxStreamingBitrate: '320000', Container: 'mp3',
    TranscodingContainer: 'mp3', TranscodingProtocol: 'http', AudioCodec: 'mp3' });
  return `/api/jellyfin/Audio/${track.id}/universal?${q}`;
}

export function artUrl(track, size = 300) {
  if (track?.source === 'jellyfin' && track.artId) return jellyfinImage(track.artId, { height: size, tag: track.artTag });
  return null;
}

// Jellyfin "Audio" items → queue entries.
export async function fromJellyfin(items) {
  const userId = await jellyfinUserId().catch(() => '');
  return items.filter((i) => i.Type === 'Audio').map((i) => {
    const ms = i.MediaSources?.[0];
    const stream = ms?.MediaStreams?.find((s) => s.Type === 'Audio');
    return {
      key: `jf:${i.Id}`, source: 'jellyfin', id: i.Id, userId,
      title: i.Name, artist: i.AlbumArtist || i.Artists?.[0] || '', album: i.Album || '',
      duration: i.RunTimeTicks ? i.RunTimeTicks / 1e7 : 0, container: i.Container || ms?.Container || '',
      bitrate: ms?.Bitrate || stream?.BitRate || 0, sampleRate: stream?.SampleRate || 0, channels: stream?.Channels || 2,
      artId: i.AlbumId && i.AlbumPrimaryImageTag ? i.AlbumId : (i.ImageTags?.Primary ? i.Id : null),
      artTag: i.AlbumId && i.AlbumPrimaryImageTag ? i.AlbumPrimaryImageTag : i.ImageTags?.Primary,
    };
  });
}

// Files app entries → queue entries. Title/artist are guessed from "Artist - Album/01 Title.ext".
export function fromFiles(root, dir, entries) {
  const folder = dir.split('/').pop() || '';
  const [fArtist, fAlbum] = folder.includes(' - ') ? folder.split(' - ') : ['', folder];
  return entries.filter((e) => !e.dir && AUDIO_EXT.has(e.name.split('.').pop().toLowerCase())).map((e) => {
    const base = e.name.replace(/\.[^.]+$/, '');
    const m = base.match(/^(\d+)[\s._-]+(.*)$/);
    const named = (m ? m[2] : base);
    const [a, t] = named.includes(' - ') ? named.split(' - ', 2) : [fArtist, named];
    const path = dir ? `${dir}/${e.name}` : e.name;
    return { key: `file:${root}:${path}`, source: 'file', root, path, title: t.trim(), artist: (a || '').trim(), album: fAlbum || '', duration: 0, size: e.size || 0 };
  });
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export const current = () => player.queue[player.index] || null;

function loadIndex(i, { autoplay = true, at = 0 } = {}) {
  const t = player.queue[i];
  if (!t) return stop();
  player.index = i;
  player.error = null;
  player.state = autoplay ? 'loading' : 'paused';
  audio.src = streamUrl(t);
  if (at) {
    const seekWhenReady = () => { audio.currentTime = at; audio.removeEventListener('loadedmetadata', seekWhenReady); };
    audio.addEventListener('loadedmetadata', seekWhenReady);
  }
  if (autoplay) {
    ensureGraph();
    ctx?.resume?.();
    audio.play().catch((err) => { if (err.name !== 'AbortError') failed(err); });
  }
  updateMediaSession();
  emit(); save();
}

export function playIndex(i) {
  if (player.index >= 0 && player.index !== i) history.push(player.index);
  history = history.slice(-200);
  loadIndex(i);
}

export function play() {
  if (!player.queue.length) return;
  ensureGraph();
  ctx?.resume?.();
  if (player.index < 0 || !audio.src) return loadIndex(Math.max(0, player.index), { at: resumeAt });
  if (player.state === 'stopped') audio.currentTime = 0;
  audio.play().catch((err) => { if (err.name !== 'AbortError') failed(err); });
}
export function pause() { audio.pause(); }
export function toggle() { player.state === 'playing' || player.state === 'loading' ? pause() : play(); }
export function stop() {
  audio.pause();
  if (audio.src) audio.currentTime = 0;
  resumeAt = 0;
  player.state = 'stopped';
  emit(); save();
}
export function seek(seconds) {
  if (!audio.src) return;
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  emit();
}

function nextIndex(step) {
  const n = player.queue.length;
  if (!n) return -1;
  if (player.shuffle && step > 0) {
    if (n === 1) return 0;
    let i;
    do { i = Math.floor(Math.random() * n); } while (i === player.index);
    return i;
  }
  if (player.shuffle && step < 0 && history.length) return history.pop();
  const i = player.index + step;
  if (i >= n) return player.repeat === 'all' ? 0 : -1;
  if (i < 0) return player.repeat === 'all' ? n - 1 : 0;
  return i;
}
export function next() { const i = nextIndex(1); if (i >= 0) playIndex(i); else stop(); }
export function prev() {
  if (audio.currentTime > 3) return seek(0);
  const i = nextIndex(-1);
  if (i >= 0) loadIndex(i);
}

export function setVolume(v) { player.volume = Math.max(0, Math.min(1, v)); applyVolume(); emit(); save(); }
export function setBalance(v) { player.balance = Math.max(-1, Math.min(1, v)); applyVolume(); emit(); save(); }
export function setShuffle(on) { player.shuffle = on; emit(); save(); }
export function cycleRepeat() { player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat]; emit(); save(); }
export function setEq(patch) {
  Object.assign(player.eq, patch);
  if (patch.bands) player.eq.bands = patch.bands.map((v) => Math.max(-12, Math.min(12, v)));
  applyEq(); emit(); save();
}
export function setEqBand(i, db) {
  player.eq.bands[i] = Math.max(-12, Math.min(12, db));
  player.eq.preset = '';
  applyEq(); emit(); save();
}

// ---------------------------------------------------------------------------
// Queue editing
// ---------------------------------------------------------------------------

export function enqueue(tracks, { play: andPlay = false, replace = false } = {}) {
  if (!tracks.length) return;
  if (replace) { player.queue = []; player.index = -1; history = []; }
  const start = player.queue.length;
  player.queue.push(...tracks);
  if (andPlay || (replace && tracks.length)) playIndex(start);
  else { emit(); save(); }
}

export function removeTracks(indexes) {
  const drop = new Set(indexes);
  const cur = current();
  player.queue = player.queue.filter((_, i) => !drop.has(i));
  history = [];
  if (cur && drop.has(player.index)) {
    // The playing track was removed: keep going with whatever now sits in its place.
    const i = Math.min(player.index - [...drop].filter((d) => d < player.index).length, player.queue.length - 1);
    if (i >= 0 && player.state === 'playing') loadIndex(i); else { stop(); player.index = i; audio.removeAttribute('src'); }
  } else if (cur) player.index = player.queue.indexOf(cur);
  emit(); save();
}

export function moveTrack(from, to) {
  if (from === to || from < 0 || to < 0 || from >= player.queue.length || to >= player.queue.length) return;
  const cur = current();
  const [t] = player.queue.splice(from, 1);
  player.queue.splice(to, 0, t);
  player.index = cur ? player.queue.indexOf(cur) : -1;
  emit(); save();
}

export function sortQueue(by) {
  const cur = current();
  if (by === 'random') {
    for (let i = player.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]]; }
  } else if (by === 'reverse') player.queue.reverse();
  else player.queue.sort((a, b) => String(a[by] || '').localeCompare(String(b[by] || ''), undefined, { numeric: true }));
  player.index = cur ? player.queue.indexOf(cur) : -1;
  emit(); save();
}

export function clearQueue() { stop(); player.queue = []; player.index = -1; history = []; audio.removeAttribute('src'); emit(); save(); }

// ---------------------------------------------------------------------------
// Element events
// ---------------------------------------------------------------------------

function failed(err) {
  player.error = err?.message || 'This track could not be played';
  player.state = 'stopped';
  emit();
  // Like Winamp: skip a broken track and carry on.
  const at = player.index;
  setTimeout(() => { if (player.index === at && player.error && player.queue.length > 1) next(); }, 1500);
}

audio.addEventListener('playing', () => { player.state = 'playing'; player.error = null; emit(); updatePosition(); });
audio.addEventListener('pause', () => { if (player.state !== 'stopped') player.state = 'paused'; emit(); save(); });
audio.addEventListener('waiting', () => { if (player.state === 'playing') { player.state = 'loading'; emit(); } });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) failed(audio.error); });
audio.addEventListener('loadedmetadata', () => {
  const t = current();
  if (t && !t.duration && Number.isFinite(audio.duration)) { t.duration = audio.duration; save(); }
  emit(); updatePosition();
});
let lastTick = 0;
audio.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastTick > 250) { lastTick = now; emit(); }
  if (Math.floor(audio.currentTime) % 5 === 0) save();
});
audio.addEventListener('ended', () => {
  if (player.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  next();
});

// ---------------------------------------------------------------------------
// Lock screen, headphone buttons and media keys
// ---------------------------------------------------------------------------

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = current();
  if (!t) { navigator.mediaSession.metadata = null; return; }
  const art = artUrl(t, 512);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist, album: t.album,
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: '512x512' }] : [],
  });
}
function updatePosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(audio.duration) || !audio.duration) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch { /* ignore */ }
}
if ('mediaSession' in navigator) {
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  set('play', play);
  set('pause', pause);
  set('stop', stop);
  set('previoustrack', prev);
  set('nexttrack', next);
  set('seekto', (d) => seek(d.seekTime));
  set('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  set('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
}
