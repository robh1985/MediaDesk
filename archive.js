// Archive Expander: 7-Zip on the MediaDesk server, for the shared folders (Settings → Files).
// Everything 7-Zip can open or create works here, because it *is* 7-Zip: MediaDesk finds an
// installed copy (7zz / 7z, or 7-Zip in Program Files on Windows), runs it without a shell, and
// keeps every path inside the shared folders. Long jobs (extract, add, test, hash, benchmark)
// run in the background with progress, and can be cancelled.

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const isWin = process.platform === 'win32';

// 7-Zip's formats: name (as `7z i` prints it), extensions, and whether 7-Zip can create it.
const FORMATS = [
  ['7z', '7z', true], ['zip', 'zip zipx jar xpi odt ods docx xlsx epub ipa apk appx', true], ['tar', 'tar ova', true], ['wim', 'wim swm esd ppkg', true],
  ['gzip', 'gz gzip tgz tpz', true], ['bzip2', 'bz2 bzip2 tbz2 tbz', true], ['xz', 'xz txz', true],
  ['APFS', 'apfs img'], ['APM', 'apm'], ['Ar', 'ar a deb udeb lib'], ['Arj', 'arj'], ['Base64', 'b64'], ['COFF', 'obj'], ['Cab', 'cab'], ['Chm', 'chm chi chq chw'],
  ['Compound', 'msi msp doc xls ppt'], ['Cpio', 'cpio'], ['CramFS', 'cramfs'], ['Dmg', 'dmg'], ['ELF', 'elf'], ['Ext', 'ext ext2 ext3 ext4 img'], ['FAT', 'fat img'],
  ['FLV', 'flv'], ['GPT', 'gpt mbr'], ['HFS', 'hfs hfsx'], ['Hxs', 'hxs hxi hxr hxq hxw lit'], ['IHex', 'ihex'], ['Iso', 'iso img'], ['LP', 'lpimg img'], ['Lzh', 'lzh lha'],
  ['lzma', 'lzma'], ['lzma86', 'lzma86'], ['MBR', 'mbr'], ['MachO', 'macho'], ['MsLZ', 'mslz'], ['Mub', 'mub'], ['NTFS', 'ntfs img'], ['Nsis', 'nsis'], ['PE', 'exe dll sys'],
  ['Ppmd', 'pmd'], ['QCOW', 'qcow qcow2 qcow2c'], ['Rar', 'rar r00'], ['Rar5', 'rar r00'], ['Rpm', 'rpm'], ['SWF', 'swf'], ['SWFc', 'swf'], ['Sparse', 'simg img'], ['Split', '001'],
  ['SquashFS', 'squashfs'], ['TE', 'te'], ['UEFIc', 'scap'], ['UEFIf', 'uefif'], ['Udf', 'udf iso img'], ['VDI', 'vdi'], ['VHD', 'vhd'], ['VHDX', 'vhdx avhdx'], ['VMDK', 'vmdk'],
  ['Xar', 'xar pkg xip'], ['Z', 'z taz'], ['zstd', 'zst tzst'], ['Hash', 'sha256 sha512 sha224 sha384 sha1 sha md5 crc32 crc64 asc cksum'],
].map(([name, ext, create]) => ({ name, ext: ext.split(' '), create: Boolean(create) }));

const HASHES = ['CRC32', 'CRC64', 'XXH64', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'SHA3-256', 'MD5', 'BLAKE2sp'];

class ArchiveError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

function createArchive({ getConfig, resolveInShared, filesEnabled }) {
  const tool = { path: null, version: '', formats: [], kind: '', checked: false, sfx: [] };

  const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

  function run(cmd, args, { timeout = 20e3, cwd } = {}) {
    return new Promise((resolve) => {
      let out = '', done = false, child;
      try { child = spawn(cmd, args, { windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
      child.stdout.on('data', (d) => { if (out.length < 32 * 1024 * 1024) out += d; });
      child.stderr.on('data', (d) => { if (out.length < 32 * 1024 * 1024) out += d; });
      const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out }); };
      child.on('error', (e) => { out += e.message; finish(-1); });
      child.on('close', finish);
    });
  }

  // Find 7-Zip: a configured path first, then the usual places.
  async function detect() {
    const cfg = getConfig();
    const names = isWin ? ['7z.exe', '7zz.exe'] : ['7zz', '7z', '7zzs', '7za'];
    const expand = (p) => {
      if (!p) return [];
      const clean = String(p).trim().replace(/^"(.*)"$/, '$1');
      try { if (fs.statSync(clean).isDirectory()) return names.map((n) => path.join(clean, n)); } catch { /* a file, or nothing */ }
      return [clean];
    };
    const places = isWin
      ? [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean).map((b) => path.join(b, '7-Zip', '7z.exe'))
      : ['/usr/local/bin/7zz', '/opt/homebrew/bin/7zz', '/usr/bin/7zz', '/usr/bin/7z', '/usr/local/bin/7z', '/opt/homebrew/bin/7z', '/usr/bin/7za'];
    const list = [...new Set([...expand(cfg.sevenZipPath), ...expand(process.env.SEVENZIP_PATH), ...names, ...places])];
    Object.assign(tool, { path: null, version: '', formats: [], kind: '', sfx: [] });
    for (const cmd of list) {
      if (path.isAbsolute(cmd) && !exists(cmd)) continue;
      const r = await run(cmd, ['i'], { timeout: 15e3 });
      const ver = /7-Zip(?: \(a\))?\s+([\d.]+)/.exec(r.out);
      if (!ver) continue;
      tool.path = cmd;
      tool.version = ver[1];
      tool.kind = /7-Zip \(a\)/.test(r.out) || /7za/.test(path.basename(cmd)) ? '7za' : '7z';
      const fmtText = (r.out.split(/^Formats:/m)[1] || '').split(/^Codecs:/m)[0];
      tool.formats = FORMATS.filter((f) => new RegExp(`\\s${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(fmtText)).map((f) => f.name);
      const dir = path.dirname(path.isAbsolute(cmd) ? cmd : '');
      if (dir && dir !== '.') tool.sfx = ['7z.sfx', '7zCon.sfx'].filter((n) => exists(path.join(dir, n)));
      break;
    }
    tool.checked = true;
    return status();
  }

  const status = () => ({
    available: Boolean(tool.path), path: tool.path, version: tool.version, kind: tool.kind, checked: tool.checked,
    sfx: tool.sfx, cpus: os.cpus().length, formats: FORMATS.map((f) => ({ ...f, available: tool.formats.includes(f.name) })), hashes: HASHES,
  });

  function need() {
    if (!filesEnabled()) throw new ArchiveError(403, 'Share some folders in Settings → Files first (it also needs a portal password).');
    if (!tool.path) throw new ArchiveError(503, '7-Zip isn’t installed on the MediaDesk server. See Settings → Files for how to add it.', 'no7z');
  }

  const resolve = (root, rel) => resolveInShared(getConfig(), root, rel || '');

  // An archive inside an archive (7-Zip opens those too): it's extracted to a temporary file
  // the first time, and kept for an hour. These can be browsed, extracted and tested, not changed.
  const cacheDir = path.join(os.tmpdir(), `mediadesk-7z-cache-${process.getuid?.() ?? 'u'}`);
  const pendingInner = new Map();
  async function openArchive(root, rel, inner, outerPassword) {
    const abs = await resolve(root, rel);
    if (!inner) return abs;
    const st = await fsp.stat(abs);
    const key = crypto.createHash('sha1').update(`${abs}\0${st.size}\0${st.mtimeMs}\0${inner}`).digest('hex').slice(0, 20);
    const dir = path.join(cacheDir, key);
    const file = path.join(dir, path.basename(String(inner)) || 'inner');
    try { const now = new Date(); await fsp.utimes(dir, now, now); if ((await fsp.stat(file)).isFile()) return file; } catch { /* not extracted yet */ }
    if (!pendingInner.has(key)) {
      pendingInner.set(key, (async () => {
        await fsp.mkdir(cacheDir, { recursive: true, mode: 0o700 });
        for (const d of await fsp.readdir(cacheDir).catch(() => [])) {
          const full = path.join(cacheDir, d);
          const t = await fsp.stat(full).catch(() => null);
          if (t && Date.now() - t.mtimeMs > 3600e3) await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
        }
        await fsp.mkdir(dir, { recursive: true });
        const r = await run(tool.path, ['e', '-spd', ...common(outerPassword), `-o${dir}`, abs, String(inner)], { timeout: 3600e3 });
        if (r.code !== 0 || !exists(file)) {
          await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
          throw errorFrom(r.out, 'Couldn’t open the archive inside this one');
        }
        return file;
      })().finally(() => pendingInner.delete(key)));
    }
    return pendingInner.get(key);
  }
  const notInner = (body) => { if (body.inner) throw new ArchiveError(400, 'Archives inside other archives can’t be changed. Extract it first, then open the extracted copy.'); };
  // Every command: no prompts, UTF-8 everywhere, and a password (empty means none).
  const common = (password) => ['-y', '-sccUTF-8', '-scsUTF-8', `-p${password || ''}`];
  // Commands that write an archive would ask for a new password after a bare -p, so leave it out.
  const writing = (password) => ['-y', '-sccUTF-8', '-scsUTF-8', ...(password ? [`-p${password}`] : [])];

  // ---- Listing ----

  function parseList(out) {
    const lines = out.split(/\r?\n/);
    const info = {};
    const entries = [];
    let mode = 'pre', cur = null, sawHeader = false;
    for (const line of lines) {
      if (line === '--') { mode = 'archive'; continue; }
      if (line === '----------') { mode = 'items'; continue; }
      if (mode === 'pre') continue;
      const m = /^([^=]+?) = (.*)$/.exec(line);
      if (mode === 'archive') {
        if (m) { if (m[1] === 'Path' && sawHeader) continue; sawHeader = true; info[m[1]] = m[2]; }
        continue;
      }
      if (!line.trim()) { if (cur) { entries.push(cur); cur = null; } continue; }
      if (!m) continue;
      if (m[1] === 'Path') { if (cur) entries.push(cur); cur = {}; }
      if (cur) cur[m[1]] = m[2];
    }
    if (cur) entries.push(cur);
    const num = (v) => (v === undefined || v === '' ? null : Number(v));
    return {
      info: {
        type: info.Type || '', physicalSize: num(info['Physical Size']), method: info.Method || '', solid: info.Solid === '+', blocks: num(info.Blocks),
        headersSize: num(info['Headers Size']), encrypted: info.Encrypted === '+', comment: info.Comment || '', volumes: num(info.Volumes), multivolume: info.Multivolume === '+',
        characteristics: info.Characteristics || '', offset: num(info.Offset), tailSize: num(info['Tail Size']),
      },
      entries: entries.filter((e) => e.Path != null).map((e) => ({
        path: e.Path.replace(/\\/g, '/'), folder: e.Folder === '+' || /^D/.test(e.Attributes || ''), size: num(e.Size) ?? 0, packed: num(e['Packed Size']),
        modified: e.Modified || '', crc: e.CRC || '', encrypted: e.Encrypted === '+', method: e.Method || '', attributes: e.Attributes || '', comment: e.Comment || '',
      })),
    };
  }

  function errorFrom(out, fallback) {
    if (/Wrong password|Cannot open encrypted archive|encrypted archive/i.test(out)) return new ArchiveError(423, 'This archive needs a password (or the password is wrong).', 'password');
    if (/Can not open the file as archive|Cannot open the file as archive|is not archive/i.test(out)) return new ArchiveError(415, 'This isn’t an archive 7-Zip can open.', 'notarchive');
    if (/Unexpected end of archive|Data Error|CRC Failed|Headers Error/i.test(out)) {
      const what = (/(Unexpected end of archive|Data Error[^\n]*|CRC Failed[^\n]*|Headers Error[^\n]*)/i.exec(out) || [])[1];
      return new ArchiveError(422, `The archive is damaged: ${what}`, 'damaged');
    }
    const err = /ERROR: (.+)/.exec(out)?.[1] || /^E_[A-Z]+.*$/m.exec(out)?.[0];
    return new ArchiveError(500, err ? err.trim() : fallback);
  }

  async function list(root, rel, password, inner, outerPassword) {
    need();
    const abs = await openArchive(root, rel, inner, outerPassword);
    const r = await run(tool.path, ['l', '-slt', ...common(password), '--', abs], { timeout: 120e3 });
    const parsed = parseList(r.out);
    // A listing can partly work with a wrong password (names visible, data encrypted).
    if (r.code !== 0 && !parsed.entries.length) throw errorFrom(r.out, `7-Zip couldn’t open it (code ${r.code})`);
    const warnings = /Warnings?:|WARNING/.test(r.out) ? (r.out.match(/WARNING[^\n]*|There are some data after the end[^\n]*/g) || []).slice(0, 5) : [];
    return { ...parsed, warnings };
  }

  // One file out of an archive, straight to the browser.
  async function stream(req, res, { root, rel, entry, password, inline, inner, outerPassword }) {
    need();
    const abs = await openArchive(root, rel, inner, outerPassword);
    const child = spawn(tool.path, ['e', '-so', '-spd', ...common(password), '--', abs, entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const name = entry.split('/').pop();
    const ext = path.extname(name).toLowerCase();
    const TYPES = { '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8', '.xml': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.ini': 'text/plain; charset=utf-8', '.nfo': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
    const type = (inline && TYPES[ext]) || 'application/octet-stream';
    let started = false;
    child.stdout.once('data', () => {
      started = true;
      res.writeHead(200, {
        'Content-Type': type, 'Content-Disposition': `${inline && TYPES[ext] ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
      });
    });
    child.stdout.on('data', (d) => { if (!res.write(d)) { child.stdout.pause(); res.once('drain', () => child.stdout.resume()); } });
    child.on('close', (code) => {
      if (!started) {
        const e = code === 0 ? new ArchiveError(404, 'That file is empty or isn’t in the archive') : errorFrom(err, `7-Zip couldn’t extract it (code ${code})`);
        res.writeHead(e.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message, code: e.code }));
      }
      res.end();
    });
    res.on('close', () => { if (child.exitCode === null) child.kill(); });
  }

  // ---- Background jobs ----

  const jobs = new Map();
  let seq = 0;

  async function listFile(names) {
    const f = path.join(os.tmpdir(), `mediadesk-7z-${process.pid}-${crypto.randomBytes(6).toString('hex')}.txt`);
    await fsp.writeFile(f, names.join('\n'), 'utf8');
    return f;
  }

  function startJob(op, args, { cwd, cleanup = [], parse, label, meta = {} } = {}) {
    const id = String(++seq);
    const job = { id, op, label, state: 'running', percent: 0, file: '', out: '', started: Date.now(), result: null, error: null, ...meta };
    jobs.set(id, job);
    // Forget finished jobs after an hour.
    for (const [k, j] of jobs) if (j.state !== 'running' && Date.now() - (j.finished || 0) > 3600e3) jobs.delete(k);
    const child = spawn(tool.path, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    job.child = child;
    let stdout = '';
    const take = (d, isOut) => {
      const s = d.toString('utf8');
      job.out = (job.out + s).slice(-200000);
      if (isOut && stdout.length < 8 * 1024 * 1024) stdout += s;
      // Progress is written in place with backspaces: "  42% 7 - folder/file.ext".
      const parts = s.split(/[\b\r\n]+/).map((x) => x.trim()).filter(Boolean);
      for (const p of parts) {
        const m = /^(\d{1,3})%(?:\s+\d+)?(?:\s+[+\-=UTR.]\s+(.*))?$/.exec(p);
        if (m) { job.percent = Math.min(100, Number(m[1])); if (m[2]) job.file = m[2]; }
      }
    };
    child.stdout.on('data', (d) => take(d, true));
    child.stderr.on('data', (d) => take(d, false));
    child.on('error', (e) => { job.state = 'error'; job.error = e.message; job.finished = Date.now(); });
    child.on('close', async (code, signal) => {
      for (const f of cleanup) await fsp.rm(f, { force: true }).catch(() => {});
      job.finished = Date.now();
      delete job.child;
      if (job.state === 'cancelled') return;
      const clean = unspin(job.out);
      job.log = clean.split('\n').filter((l) => l.trim() && !/^\s*\d{1,3}%/.test(l)).slice(-60).join('\n');
      // 7-Zip: 0 = fine, 1 = warnings (some files couldn't be opened, for example), 2+ = errors.
      if (code === 0 || code === 1) {
        job.state = 'done';
        job.percent = 100;
        job.warnings = code === 1;
        try { job.result = parse ? parse(unspin(stdout)) : null; } catch (e) { job.result = null; }
      } else {
        job.state = 'error';
        const e = errorFrom(job.out, signal ? `7-Zip stopped (${signal})` : `7-Zip reported an error (code ${code})`);
        job.error = e.message;
        job.code = e.code;
      }
    });
    return job;
  }

  // Progress is drawn in place with backspaces; keep what's left on each line once it's done.
  const unspin = (text) => text.split(/\r?\n/).map((l) => l.split('\x08').pop().replace(/^.*\r(?!$)/, '')).join('\n').replace(/\n{3,}/g, '\n\n');

  const publicJob = (j) => { const { child, out, ...rest } = j; return rest; };

  const OVERWRITE = { overwrite: '-aoa', skip: '-aos', rename: '-aou', renameExisting: '-aot' };
  const UPDATE = { add: null, update: '-up1q1r2x1y2z1w2', freshen: '-up1q1r0x1y2z1w2', sync: '-up1q0r2x1y2z1w2' };
  const TYPES = { '7z': '7z', zip: 'zip', tar: 'tar', wim: 'wim', gzip: 'gzip', bzip2: 'bzip2', xz: 'xz', zstd: 'zstd' };

  async function job(body) {
    need();
    const op = body.op;
    const pw = typeof body.password === 'string' ? body.password : '';
    if (op === 'extract') {
      const archive = await openArchive(body.root, body.path, body.inner, body.outerPassword);
      const dest = await resolve(body.destRoot ?? body.root, body.dest);
      await fsp.mkdir(dest, { recursive: true });
      const args = [body.paths === 'none' ? 'e' : 'x', '-bsp1', '-bso1', '-bse1', OVERWRITE[body.overwrite] || '-aou', ...common(pw), `-o${dest}`];
      if (body.eliminateRoot) args.push('-spe');
      const cleanup = [];
      if (Array.isArray(body.entries) && body.entries.length) {
        const lf = await listFile(body.entries.map(String));
        cleanup.push(lf);
        // Folders bring their contents.
        // (Archive paths are absolute, so needn't follow `--`; 7-Zip ignores @lists after it.)
        args.push('-spd', archive, `@${lf}`);
        const withKids = await listFile(body.entries.map((e) => `${String(e).replace(/\/+$/, '')}/*`));
        cleanup.push(withKids);
        args.push(`@${withKids}`);
      } else args.push('--', archive);
      return startJob('extract', args, { cleanup, label: `Extracting ${path.basename(archive)}`, meta: { dest: { root: body.destRoot ?? body.root, path: body.dest } } });
    }
    if (op === 'add') {
      const dir = await resolve(body.root, body.dir || '');
      const names = (body.items || []).map(String).filter((n) => n && !/[\\/]/.test(n) && n !== '.' && n !== '..');
      if (!names.length) throw new ArchiveError(400, 'Choose files or folders to add');
      for (const n of names) await resolve(body.root, body.dir ? `${body.dir}/${n}` : n); // each must be inside the share
      const archive = await resolve(body.destRoot ?? body.root, body.archive);
      if (!body.archive || /\/$/.test(body.archive)) throw new ArchiveError(400, 'Give the archive a name');
      const type = TYPES[body.format] || '7z';
      const args = [body.update && body.update !== 'add' ? 'u' : 'a', '-bsp1', '-bso1', '-bse1', `-t${type}`, ...writing(pw)];
      if (UPDATE[body.update]) args.push(UPDATE[body.update]);
      const lvl = Number(body.level);
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 9) args.push(`-mx=${lvl}`);
      // Method, dictionary and word size, the way 7-Zip spells them for each method: PPMd calls
      // them memory and model order; Deflate has no dictionary to set.
      const method = /^(LZMA2?|PPMd|BZip2|Deflate(64)?|Copy|XZ)$/.test(body.method) ? body.method : '';
      const m = method || { '7z': 'LZMA2', zip: 'Deflate', gzip: 'Deflate', bzip2: 'BZip2', xz: 'LZMA2' }[type] || '';
      const dict = /^\d+[bkmg]?$/i.test(String(body.dictionary || '')) ? String(body.dictionary).toLowerCase() : '';
      const word = /^\d{1,3}$/.test(String(body.wordSize || '')) ? String(body.wordSize) : '';
      const props = [];
      if (dict && m !== 'Deflate' && m !== 'Deflate64' && m !== 'Copy') props.push(m === 'PPMd' ? `mem=${dict}` : `d=${dict}`);
      if (word && m !== 'BZip2' && m !== 'Copy') props.push(m === 'PPMd' ? `o=${word}` : `fb=${word}`);
      if (type === '7z' && (method || props.length)) args.push(`-m0=${m}${props.map((x) => `:${x}`).join('')}`);
      else if (type !== '7z') {
        if (type === 'zip' && method) args.push(`-mm=${method}`);
        for (const x of props) args.push(`-m${x}`);
      }
      if (type === '7z' && /^(on|off|e|\d+[bkmg]?|\d+f)$/i.test(String(body.solid || ''))) args.push(`-ms=${body.solid}`);
      if (/^(on|off|\d{1,3})$/.test(String(body.threads || ''))) args.push(`-mmt=${body.threads}`);
      if (pw && type === '7z' && body.encryptNames) args.push('-mhe=on');
      if (pw && type === 'zip') args.push(`-mem=${body.zipEncryption === 'ZipCrypto' ? 'ZipCrypto' : 'AES256'}`);
      if (/^\d+[bkmg]?$/i.test(String(body.volumes || ''))) args.push(`-v${body.volumes}`);
      if (body.sharedFiles) args.push('-ssw');
      if (body.deleteAfter) args.push('-sdel');
      if (body.sfx && type === '7z' && tool.sfx.includes(body.sfx)) args.push(`-sfx${body.sfx}`);
      // Extra 7-Zip method parameters, as typed in 7-Zip's "Parameters" box (only -m switches).
      for (const p of String(body.parameters || '').split(/\s+/).filter(Boolean)) {
        if (/^-?m[\w=.:+-]*$/i.test(p)) args.push(p.startsWith('-') ? p : `-${p}`);
        else throw new ArchiveError(400, `“${p}” isn’t allowed in Parameters (only -m… settings, like -m0=LZMA2 or -mf=off)`);
      }
      const lf = await listFile(names);
      args.push('-spd', archive, `@${lf}`);
      return startJob('add', args, { cwd: dir, cleanup: [lf], label: `Compressing to ${path.basename(archive)}`, meta: { archive: { root: body.destRoot ?? body.root, path: body.archive } } });
    }
    if (op === 'test') {
      const archive = await openArchive(body.root, body.path, body.inner, body.outerPassword);
      const args = ['t', '-bsp1', '-bso1', '-bse1', ...common(pw)];
      if (Array.isArray(body.entries) && body.entries.length) {
        const lf = await listFile(body.entries.map(String));
        return startJob('test', [...args, '-spd', archive, `@${lf}`], { cleanup: [lf], label: `Testing ${path.basename(archive)}`, parse: parseTest });
      }
      return startJob('test', [...args, '--', archive], { label: `Testing ${path.basename(archive)}`, parse: parseTest });
    }
    if (op === 'delete') {
      notInner(body);
      const archive = await resolve(body.root, body.path);
      if (!Array.isArray(body.entries) || !body.entries.length) throw new ArchiveError(400, 'Choose what to delete');
      const lf = await listFile(body.entries.map(String));
      const kids = await listFile(body.entries.map((e) => `${String(e).replace(/\/+$/, '')}/*`));
      return startJob('delete', ['d', '-bsp1', '-bso1', '-bse1', '-spd', ...writing(pw), archive, `@${lf}`, `@${kids}`], { cleanup: [lf, kids], label: `Deleting from ${path.basename(archive)}` });
    }
    if (op === 'rename') {
      notInner(body);
      const archive = await resolve(body.root, body.path);
      if (!body.from || !body.to || /[\\]/.test(body.to)) throw new ArchiveError(400, 'Give the old and new names');
      return startJob('rename', ['rn', '-bsp1', '-bso1', '-bse1', ...writing(pw), '--', archive, String(body.from), String(body.to)], { label: `Renaming in ${path.basename(archive)}` });
    }
    if (op === 'hash') {
      const dir = await resolve(body.root, body.dir || '');
      const names = (body.items || []).map(String).filter((n) => n && !/[\\/]/.test(n));
      for (const n of names) await resolve(body.root, body.dir ? `${body.dir}/${n}` : n);
      const algs = (Array.isArray(body.algorithms) ? body.algorithms : ['CRC32', 'SHA256']).filter((a) => HASHES.includes(a));
      if (!algs.length || !names.length) throw new ArchiveError(400, 'Choose files and at least one checksum');
      const lf = await listFile(names);
      return startJob('hash', ['h', '-bsp2', '-bso1', '-bse2', '-sccUTF-8', '-scsUTF-8', ...algs.map((a) => `-scrc${a}`), '-spd', `@${lf}`], { cwd: dir, cleanup: [lf], label: 'Calculating checksums', parse: parseHash });
    }
    if (op === 'benchmark') {
      const args = ['b', '-sccUTF-8'];
      if (/^\d{1,3}$/.test(String(body.threads || ''))) args.push(`-mmt${body.threads}`);
      if (/^\d{2}$/.test(String(body.dictionary || ''))) args.push(`-md${body.dictionary}`);
      if (/^\d{1,2}$/.test(String(body.passes || ''))) args.push(String(body.passes));
      return startJob('benchmark', args, { label: '7-Zip benchmark', parse: parseBench });
    }
    throw new ArchiveError(400, 'Unknown operation');
  }

  function parseTest(out) {
    const num = (re) => Number((re.exec(out) || [])[1]) || 0;
    return { ok: /Everything is Ok/i.test(out), files: num(/^Files: (\d+)/m), folders: num(/^Folders: (\d+)/m), size: num(/^Size:\s+(\d+)/m), compressed: num(/^Compressed: (\d+)/m) };
  }

  // "CRC32    SHA256   Size  Name" table (columns as wide as the dashes under them; folders have
  // blank sums), then the "for data" totals.
  function parseHash(out) {
    const lines = out.split(/\r?\n/);
    const hi = lines.findIndex((l, k) => /\sSize\s+Name\s*$/.test(l) && /^-+( +-+)+\s*$/.test(lines[k + 1] || ''));
    if (hi < 0) return { algorithms: [], files: [], totals: {} };
    const spans = [];
    const re = /-+/g;
    let m;
    while ((m = re.exec(lines[hi + 1]))) spans.push([m.index, m.index + m[0].length]);
    const cols = lines[hi].trim().split(/\s+/).slice(0, -2);
    const files = [];
    for (let i = hi + 2; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^-+( +-+)+\s*$/.test(l)) break;
      const cell = (k) => l.slice(spans[k][0], spans[k][1]).trim();
      const hashes = Object.fromEntries(cols.map((c, k) => [c, cell(k)]));
      const size = cell(cols.length);
      const name = l.slice(spans[cols.length + 1]?.[0] ?? spans[cols.length][1] + 2).trim();
      files.push({ name, folder: !size && cols.every((c) => !hashes[c]), size: /^\d+$/.test(size) ? Number(size) : null, hashes });
    }
    const totals = {};
    for (const c of cols) {
      const esc = c.replace(/[-]/g, '\\-');
      const a = new RegExp(`^${esc}\\s+for data:\\s+(\\S+)`, 'm').exec(out);
      const b = new RegExp(`^${esc}\\s+for data and names:\\s+(\\S+)`, 'm').exec(out);
      if (a) totals[c] = { data: a[1], dataAndNames: b?.[1] || '' };
    }
    return { algorithms: cols, files, totals, folders: Number(/^Folders: (\d+)/m.exec(out)?.[1]) || 0, size: Number(/^Size: (\d+)/m.exec(out)?.[1]) || 0 };
  }

  function parseBench(out) {
    const tot = /^Tot:\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(out);
    const avr = out.match(/^Avr:.*$/gm) || [];
    return { table: out.replace(/^[\s\S]*?(?=\n\s*Compressing|\nRAM size)/, '').trim(), total: tot ? { usage: Number(tot[1]), ruPerUsage: Number(tot[2]), rating: Number(tot[3]) } : null, averages: avr };
  }

  function cancel(id) {
    const j = jobs.get(id);
    if (!j) throw new ArchiveError(404, 'No such job');
    if (j.child) { j.state = 'cancelled'; j.child.kill(); }
    return publicJob(j);
  }

  // ---- HTTP ----

  async function handle(req, res, url, { sendJson, readJson }) {
    const p = url.pathname.replace(/^\/portal\/archive/, '');
    const q = url.searchParams;
    try {
      if (p === '/status') { if (!tool.checked) await detect(); return sendJson(res, 200, status()); }
      if (p === '/detect' && req.method === 'POST') return sendJson(res, 200, await detect());
      if (p === '/list') return sendJson(res, 200, await list(Number(q.get('root')), q.get('path'), q.get('password') || '', q.get('inner') || '', q.get('outerPassword') || ''));
      if (p === '/entry') return await stream(req, res, { root: Number(q.get('root')), rel: q.get('path'), entry: q.get('entry'), password: q.get('password') || '', inline: q.get('inline') === '1', inner: q.get('inner') || '', outerPassword: q.get('outerPassword') || '' });
      if (p === '/jobs' && req.method === 'POST') return sendJson(res, 200, publicJob(await job(await readJson(req))));
      const m = /^\/jobs\/(\d+)$/.exec(p);
      if (m && req.method === 'GET') { const j = jobs.get(m[1]); return j ? sendJson(res, 200, publicJob(j)) : sendJson(res, 404, { error: 'No such job' }); }
      if (m && req.method === 'DELETE') return sendJson(res, 200, cancel(m[1]));
      return sendJson(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      if (res.headersSent) return res.end();
      return sendJson(res, err.status || (err.code === 'ENOENT' ? 404 : 500), { error: err.message, code: err.code });
    }
  }

  return { handle, detect, status };
}

module.exports = { createArchive, FORMATS };
