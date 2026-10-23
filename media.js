// Media helpers for the Preview app, using optional programs installed on the server:
//   ffmpeg/ffprobe - plays video and audio formats browsers can't (AVI, WMV, FLV, MPEG-TS, HEVC, …)
//                    by converting them on the fly to MP4 (H.264 + AAC) while they play.
//   LibreOffice    - converts Word, Excel, PowerPoint and OpenDocument files to PDF for viewing.
// Without them the Preview app still works for formats the browser handles itself.

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const isWin = process.platform === 'win32';
const tools = { ffmpeg: null, ffprobe: null, soffice: null, checked: false };

// Run a program and collect its output, with a time limit.
function run(cmd, args, { timeout = 20e3, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let child;
    try { child = spawn(cmd, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out, err: e.message }); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { if (out.length < maxBytes) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 64 * 1024) err += d; });
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err }); };
    child.on('error', (e) => { err += e.message; finish(-1); });
    child.on('close', finish);
  });
}

async function firstWorking(list, args) {
  for (const cmd of list.filter(Boolean)) {
    const r = await run(cmd, args, { timeout: 15e3 });
    if (r.code === 0) return cmd;
  }
  return null;
}

// Look for the programs (a configured path first, then the usual places).
async function detect(config = {}) {
  const env = process.env;
  const winLinks = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe') : null;
  tools.ffmpeg = await firstWorking([config.ffmpegPath, env.FFMPEG_PATH, 'ffmpeg', isWin && winLinks, isWin && 'C:\\ffmpeg\\bin\\ffmpeg.exe', !isWin && '/usr/local/bin/ffmpeg', !isWin && '/opt/homebrew/bin/ffmpeg'], ['-version']);
  tools.ffprobe = null;
  if (tools.ffmpeg) {
    const dir = path.dirname(tools.ffmpeg);
    const sibling = dir && dir !== '.' ? path.join(dir, isWin ? 'ffprobe.exe' : 'ffprobe') : null;
    tools.ffprobe = await firstWorking([sibling, env.FFPROBE_PATH, 'ffprobe'], ['-version']);
  }
  tools.soffice = await firstWorking([config.libreOfficePath, env.SOFFICE_PATH, 'soffice', 'libreoffice',
    isWin && 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', isWin && 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice'], ['--version']);
  tools.checked = true;
  return status();
}

const status = () => ({ ffmpeg: Boolean(tools.ffmpeg && tools.ffprobe), office: Boolean(tools.soffice), checked: tools.checked });

class MediaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// --- Probe -------------------------------------------------------------------

const probeCache = new Map();
async function probe(abs) {
  if (!tools.ffprobe) throw new MediaError(503, 'ffmpeg is not installed on the server');
  const st = await fsp.stat(abs);
  const key = `${abs}|${st.size}|${st.mtimeMs}`;
  if (probeCache.has(key)) return probeCache.get(key);
  const r = await run(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs], { timeout: 30e3 });
  if (r.code !== 0) throw new MediaError(422, `Could not read this file${r.err ? `: ${r.err.trim().split('\n').pop()}` : ''}`);
  const j = JSON.parse(r.out || '{}');
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const lang = (s) => s.tags?.language && s.tags.language !== 'und' ? s.tags.language : null;
  const info = {
    duration: Number(j.format?.duration) || Number(v?.duration) || 0,
    container: j.format?.format_name || '',
    bitrate: Number(j.format?.bit_rate) || 0,
    title: j.format?.tags?.title || null,
    video: v ? { codec: v.codec_name, profile: v.profile || '', pixFmt: v.pix_fmt || '', width: v.width, height: v.height, fps: v.avg_frame_rate } : null,
    audio: streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({ index: i, codec: s.codec_name, channels: s.channels || 2, language: lang(s), title: s.tags?.title || null, default: Boolean(s.disposition?.default) })),
    subtitles: streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => ({ index: i, codec: s.codec_name, language: lang(s), title: s.tags?.title || null })),
  };
  probeCache.set(key, info);
  if (probeCache.size > 200) probeCache.delete(probeCache.keys().next().value);
  return info;
}

// --- Live conversion -----------------------------------------------------------

const active = new Set();
const MAX_STREAMS = 4;

// Streams `abs` from `start` seconds as fragmented MP4 (H.264 + AAC), or as WebM (VP8 + Opus) for
// browsers without H.264 support.
async function stream(req, res, abs, { start = 0, audio = 0, audioOnly = false, format = 'mp4' } = {}) {
  const webm = format === 'webm';
  if (!tools.ffmpeg) throw new MediaError(503, 'ffmpeg is not installed on the server');
  const info = await probe(abs);
  const v = audioOnly ? null : info.video;
  const a = info.audio[audio] || info.audio[0];
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', abs);
  if (v) {
    args.push('-map', '0:v:0');
    const scale = ['-vf', `scale='min(${webm ? 1280 : 1920},iw)':-2`, '-pix_fmt', 'yuv420p'];
    // H.264 in 8-bit 4:2:0 (or VP8/VP9 for WebM) can be passed straight through; everything else is re-encoded.
    const copyable = webm ? ['vp8', 'vp9'].includes(v.codec) && /^yuv420p$/.test(v.pixFmt)
      : v.codec === 'h264' && /^yuvj?420p$/.test(v.pixFmt) && !/10|4:2:2|4:4:4/.test(v.profile);
    if (copyable) args.push('-c:v', 'copy');
    else if (webm) args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-qmin', '4', '-qmax', '48', '-g', '120', ...scale);
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '10M', '-bufsize', '20M', '-g', '96', ...scale);
  }
  if (a) {
    args.push('-map', `0:a:${a.index}`);
    if (webm) args.push('-c:a', 'libopus', '-ac', '2', '-b:a', '128k');
    else if (a.codec === 'aac' && a.channels <= 2) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
  }
  if (!v && !a) throw new MediaError(422, 'This file has no playable video or audio');
  args.push('-sn', '-dn', '-map_metadata', '-1');
  if (webm) args.push('-f', 'webm', '-cluster_time_limit', '2000', 'pipe:1');
  else args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');

  // Too many at once (e.g. lots of seeking): stop the oldest.
  while (active.size >= MAX_STREAMS) { const oldest = active.values().next().value; oldest.kill('SIGKILL'); active.delete(oldest); }
  const child = spawn(tools.ffmpeg, args, { windowsHide: true });
  active.add(child);
  let started = false, errText = '';
  const stop = () => { if (!child.killed) child.kill('SIGKILL'); active.delete(child); };
  res.on('close', stop);
  child.stderr.on('data', (d) => { if (errText.length < 8192) errText += d; });
  child.stdout.on('data', (chunk) => {
    if (!started) {
      started = true;
      res.writeHead(200, { 'Content-Type': `${v ? 'video' : 'audio'}/${webm ? 'webm' : 'mp4'}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    }
    if (!res.write(chunk)) { child.stdout.pause(); res.once('drain', () => child.stdout.resume()); }
  });
  await new Promise((resolve) => {
    child.on('error', (e) => { errText += e.message; });
    child.on('close', (code) => {
      active.delete(child);
      if (!started && !res.headersSent) {
        const msg = (errText.trim().split('\n').pop() || `ffmpeg exited with code ${code}`).slice(0, 300);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Could not convert this file: ${msg}` }));
      } else res.end();
      resolve();
    });
  });
}

// --- Pictures browsers can't show (TIFF, HEIC, PSD, TGA, …) → JPEG ---------------------

async function toJpeg(req, res, abs) {
  if (!tools.ffmpeg) throw new MediaError(503, 'ffmpeg is not installed on the server');
  const r = await new Promise((resolve) => {
    const child = spawn(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', abs, '-frames:v', '1',
      '-vf', "scale='min(4096,iw)':-2", '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2', 'pipe:1'], { windowsHide: true });
    const chunks = [];
    let size = 0, err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60e3);
    child.stdout.on('data', (d) => { size += d.length; if (size < 64 * 1024 * 1024) chunks.push(d); });
    child.stderr.on('data', (d) => { if (err.length < 4096) err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, buf: Buffer.concat(chunks), err }); });
    res.on('close', () => child.kill('SIGKILL'));
  });
  if (r.code !== 0 || !r.buf.length) throw new MediaError(422, `Could not read this picture${r.err ? `: ${r.err.trim().split('\n').pop()}` : ''}`);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': r.buf.length, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
  res.end(r.buf);
}

// --- Office documents → PDF ------------------------------------------------------

const OFFICE = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'wpd', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'ots',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odp', 'otp', 'odg', 'vsd', 'vsdx', 'pub']);
const cacheDir = path.join(os.tmpdir(), 'mediadesk-office-cache');
let queue = Promise.resolve();

async function pruneCache() {
  try {
    const now = Date.now();
    for (const f of await fsp.readdir(cacheDir)) {
      const p = path.join(cacheDir, f);
      const st = await fsp.stat(p).catch(() => null);
      if (st && now - st.mtimeMs > 3 * 864e5) await fsp.rm(p, { recursive: true, force: true });
    }
  } catch { /* nothing cached yet */ }
}

async function convertToPdf(abs) {
  if (!tools.soffice) throw new MediaError(503, 'LibreOffice is not installed on the server');
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (!OFFICE.has(ext)) throw new MediaError(415, 'Not an Office document');
  const st = await fsp.stat(abs);
  if (st.size > 200 * 1024 * 1024) throw new MediaError(413, 'File is too large to convert');
  const key = crypto.createHash('sha1').update(`${abs}|${st.size}|${st.mtimeMs}`).digest('hex');
  const out = path.join(cacheDir, `${key}.pdf`);
  if (fs.existsSync(out)) return out;
  // One conversion at a time: LibreOffice is heavy, and this keeps memory use predictable.
  const job = queue.then(async () => {
    if (fs.existsSync(out)) return out;
    await fsp.mkdir(cacheDir, { recursive: true });
    const work = await fsp.mkdtemp(path.join(cacheDir, 'job-'));
    try {
      const input = path.join(work, `document.${ext}`);
      await fsp.copyFile(abs, input);
      const profile = pathToFileURL(path.join(work, 'profile')).href;
      const r = await run(tools.soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck', '--nodefault',
        '--convert-to', 'pdf', '--outdir', work, input], { timeout: 180e3 });
      const produced = path.join(work, 'document.pdf');
      if (!fs.existsSync(produced)) throw new MediaError(422, `LibreOffice could not convert this file${r.err ? `: ${r.err.trim().split('\n').pop()}` : ''}`);
      await fsp.rename(produced, out);
      return out;
    } finally {
      fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      pruneCache();
    }
  });
  queue = job.catch(() => {});
  return job;
}

async function sendPdf(req, res, file) {
  const st = await fsp.stat(file);
  res.writeHead(200, {
    'Content-Type': 'application/pdf', 'Content-Length': st.size, 'Cache-Control': 'private, no-cache',
    'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

module.exports = { detect, status, probe, stream, toJpeg, convertToPdf, sendPdf, MediaError, OFFICE };
