// Archive Expander: a 7-Zip File Manager for the shared folders. Browse folders, open an archive
// as if it were a folder (archives inside archives too), and Add, Extract, Test, Delete, Rename,
// check Properties, calculate checksums and run 7-Zip's benchmark. The work is done by 7-Zip on
// the MediaDesk server, so every format 7-Zip knows works here.

import { h, clear, toast, toastError, contextMenu, confirmDialog, formatBytes, spinner, isTouch } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { filesCall, filesEnabled, pickFile, joinPath } from '../fileapi.js';
import { openApp } from '../wm.js';

const ROW = 24;
const SORT_KEY = 'mediadesk.archive.sort';
const ADD_KEY = 'mediadesk.archive.add';
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

// Names the Archive Expander opens on a double-click (in Files too). Anything else 7-Zip can read
// (programs, installers, disk images, Office files) opens from the right-click menu.
const ARCHIVE_RE = /\.(7z|zipx?|rar|r00|tar|t?gz|gzip|tgz|tpz|bz2|bzip2|tbz2?|xz|txz|zst|tzst|lzma|lzma86|z|taz|cab|iso|wim|swm|esd|arj|lzh|lha|cpio|rpm|deb|udeb|ar|dmg|hfsx?|vhdx?|vmdk|vdi|qcow2?|xar|squashfs|cramfs|apfs|udf|001|chm|mslz|nsis|lz|swf|flv|b64|sha256|md5|sha1|apm|gpt|mbr|ova)$/i;
const OPENABLE_RE = /\.(exe|dll|sys|msi|msp|msu|apk|xapk|ipa|jar|xpi|epub|docx|xlsx|pptx|odt|ods|odp|appx|msix|img|bin|vhd|scap|pkg|mub|elf|macho|obj|doc|xls|ppt)$/i;
export const isArchiveName = (name) => ARCHIVE_RE.test(name) || /\.(part0*1\.rar|7z\.0*1|zip\.0*1)$/i.test(name);
export const canOpenAsArchive = (name) => isArchiveName(name) || OPENABLE_RE.test(name);

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  extract: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  test: svg('<path d="m5 12 4 4 10-10"/><path d="M3 21h18" opacity=".5"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
  hash: svg('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
  tools: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  folder: '<svg viewBox="0 0 24 24"><path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#f5b82e"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#94a3b8"/><path d="M14 2.5v4a1 1 0 0 0 1 1h4" fill="#fff" opacity=".45"/></svg>',
  arc: '<svg viewBox="0 0 24 24"><path d="M6 2.5h12a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#db2777"/><path d="M12 2.5v2.5h-1.6M12 6.6h1.6M12 8.2h-1.6M12 9.8h1.6" stroke="#fff" stroke-width="1.4"/><rect x="10" y="11.5" width="4" height="4" rx="1" fill="#fff"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="19" height="10" rx="2.5" fill="#64748b"/><circle cx="17.5" cy="12" r="1.3" fill="#86efac"/><path d="M5.5 12h7" stroke="#e2e8f0" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

// ---- Server calls ----

async function call(route, { method = 'GET', params, body } = {}) {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  const res = await fetch(`/portal/archive/${route}${qs}`, {
    method, credentials: 'same-origin',
    headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
  return data;
}

let toolStatus = null;
async function sevenZip(refresh = false) {
  if (!toolStatus || refresh) toolStatus = await call(refresh ? 'detect' : 'status', refresh ? { method: 'POST' } : {});
  return toolStatus;
}

// Runs a 7-Zip job with a progress window; resolves to the finished job (or null if cancelled).
// A missing or wrong password asks for one and tries again.
async function runJob(body, { title, host } = {}) {
  for (;;) {
    let job;
    try { job = await call('jobs', { method: 'POST', body }); } catch (err) { toastError(err, title); return null; }
    const done = await watchJob(job, title, host);
    if (done?.state === 'error' && done.code === 'password') {
      const pw = await askPassword(body.password ? 'Wrong password. Try again:' : 'This archive is encrypted. Enter the password:');
      if (pw == null) return null;
      body = { ...body, password: pw };
      continue;
    }
    return done;
  }
}

function watchJob(job, title, host = document.body) {
  return new Promise((resolve) => {
    const bar = h('div', { class: 'ax-bar' }, h('div', { class: 'ax-bar-fill' }));
    const pct = h('span', { class: 'ax-pct' }, '0%');
    const file = h('div', { class: 'ax-cur small muted' }, ' ');
    const elapsed = h('span', { class: 'small muted' }, '0:00');
    const bgBtn = h('button', { class: 'btn' }, 'Background');
    const cancelBtn = h('button', { class: 'btn btn-danger' }, 'Cancel');
    const box = h('div', { class: 'dialog ax-progress', role: 'dialog' },
      h('h3', {}, job.label || title),
      h('div', { class: 'ax-progress-row' }, bar, pct),
      file,
      h('div', { class: 'ax-progress-row small' }, h('span', { class: 'muted' }, 'Elapsed time: '), elapsed),
      h('div', { class: 'dialog-actions' }, bgBtn, cancelBtn));
    const overlay = h('div', { class: 'dialog-overlay' }, box);
    let shown = false, bg = false;
    // Short jobs finish without a flash of the progress window.
    const showTimer = setTimeout(() => { shown = true; if (!bg) host.append(overlay); }, 350);
    bgBtn.onclick = () => { bg = true; overlay.remove(); toast(job.label || title, { body: 'Working in the background — you’ll be told when it’s done.', icon: appIcon.archive, timeout: 3000 }); };
    cancelBtn.onclick = async () => { cancelBtn.disabled = true; try { await call(`jobs/${job.id}`, { method: 'DELETE' }); } catch { /* finished anyway */ } };
    const tick = async () => {
      let j;
      try { j = await call(`jobs/${job.id}`); } catch (err) { finish({ ...job, state: 'error', error: err.message }); return; }
      if (j.state === 'running') {
        bar.firstChild.style.width = `${j.percent}%`;
        bar.classList.toggle('busy', !j.percent);
        pct.textContent = `${j.percent}%`;
        if (j.file) file.textContent = j.file;
        const s = Math.round((Date.now() - j.started) / 1000);
        elapsed.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        setTimeout(tick, 400);
      } else finish(j);
    };
    const finish = (j) => {
      clearTimeout(showTimer);
      overlay.remove();
      if (bg && j.state === 'done') toast(`${j.label || title}: done`, { type: 'success', icon: appIcon.archive });
      if (bg && j.state === 'error' && j.code !== 'password') toast(j.label || title, { body: j.error, type: 'error', timeout: 9000 });
      resolve(j.state === 'cancelled' ? null : j);
    };
    void shown;
    setTimeout(tick, 150);
  });
}

// ---- Small dialogs ----

function dialog(title, body, { ok = 'OK', cancel = 'Cancel', wide = false, onOk, extraClass = '' } = {}) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'ax-error small' });
    const okBtn = ok ? h('button', { class: 'btn btn-primary', type: 'submit' }, ok) : null;
    const close = (v) => { overlay.remove(); resolve(v); };
    const form = h('form', { class: `dialog ax-dialog ${wide ? 'ax-wide' : ''} ${extraClass}`, onsubmit: async (e) => {
      e.preventDefault();
      if (!onOk) return close(true);
      try { err.textContent = ''; const v = await onOk(); if (v !== undefined && v !== false) close(v); } catch (ex) { err.textContent = ex.message; }
    } },
    h('h3', {}, title), h('div', { class: 'ax-dialog-body' }, body), err,
    h('div', { class: 'dialog-actions' }, cancel ? h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, cancel) : null, okBtn));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, form);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
    document.body.append(overlay);
    (form.querySelector('[autofocus]') || okBtn)?.focus();
  });
}

function askPassword(message) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', autofocus: true });
  const show = h('input', { type: 'checkbox', onchange: () => { input.type = show.checked ? 'text' : 'password'; } });
  return dialog('Enter password', [h('p', {}, message), h('label', { class: 'field' }, h('span', {}, 'Password'), input), h('label', { class: 'check ax-mt' }, show, 'Show password')],
    { onOk: () => input.value });
}

const field = (label, control, hint) => h('label', { class: 'field ax-field' }, h('span', {}, label), control, hint ? h('span', { class: 'ax-hint' }, hint) : null);
const select = (options, value) => {
  const s = h('select', { class: 'input' }, options.map(([v, label]) => h('option', { value: v }, label ?? v)));
  if (value !== undefined && options.some(([v]) => String(v) === String(value))) s.value = String(value);
  return s;
};
const check = (label, checked = false, title) => {
  const c = h('input', { type: 'checkbox' });
  c.checked = checked;
  return { box: c, el: h('label', { class: 'check', title }, c, label) };
};
const fmtDate = (d) => (d ? String(d).replace(/\.\d+$/, '') : '');
const fmtMs = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const sizeText = (n) => (n == null ? '' : n.toLocaleString());
const stem = (name) => name.replace(/\.(tar\.(gz|bz2|xz|zst)|part0*1\.rar|7z\.0*1|zip\.0*1)$/i, '').replace(/\.[^.]+$/, '') || name;

// ---- Compression options (as in 7-Zip's "Add to Archive" window) ----

const LEVELS = [[0, 'Store'], [1, 'Fastest'], [3, 'Fast'], [5, 'Normal'], [7, 'Maximum'], [9, 'Ultra']];
const METHODS = {
  '7z': ['LZMA2', 'LZMA', 'PPMd', 'BZip2', 'Deflate', 'Deflate64'],
  zip: ['Deflate', 'Deflate64', 'BZip2', 'LZMA', 'PPMd'],
  gzip: ['Deflate'], bzip2: ['BZip2'], xz: ['LZMA2'], tar: [], wim: [],
};
const EXT = { '7z': '7z', zip: 'zip', tar: 'tar', wim: 'wim', gzip: 'gz', bzip2: 'bz2', xz: 'xz' };
const SINGLE_FILE = new Set(['gzip', 'bzip2', 'xz']);
const sizes = (list) => list.map((s) => [s, s.replace(/([kmg])$/, (u) => ` ${u.toUpperCase()}B`).replace(/b$/, ' bytes')]);
const DICTS = {
  LZMA: sizes(['64k', '256k', '1m', '2m', '3m', '4m', '6m', '8m', '12m', '16m', '24m', '32m', '48m', '64m', '96m', '128m', '192m', '256m', '384m', '512m', '768m', '1024m', '1536m']),
  PPMd: sizes(['1m', '2m', '3m', '4m', '6m', '8m', '12m', '16m', '24m', '32m', '48m', '64m', '96m', '128m', '192m', '256m', '384m', '512m', '768m', '1024m']),
  BZip2: sizes(['100k', '200k', '300k', '400k', '500k', '600k', '700k', '800k', '900k']),
};
DICTS.LZMA2 = DICTS.LZMA;
const WORDS = {
  LZMA: [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 273], PPMd: [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32],
  Deflate: [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 258], Deflate64: [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 257],
};
WORDS.LZMA2 = WORDS.LZMA;
const SOLID = [['off', 'Non-solid'], ...sizes(['1m', '2m', '4m', '8m', '16m', '32m', '64m', '128m', '256m', '512m', '1g', '2g', '4g', '8g', '16g', '32g', '64g']), ['on', 'Solid']];
const VOLUMES = [['10m', '10M'], ['100m', '100M'], ['650m', '650M - CD'], ['700m', '700M - CD'], ['4092m', '4092M - FAT'], ['4480m', '4480M - DVD'], ['8128m', '8128M - DVD DL'], ['23040m', '23040M - BD']];
const UPDATES = [['add', 'Add and replace files'], ['update', 'Update and add files'], ['freshen', 'Freshen existing files'], ['sync', 'Synchronize files']];

// The Add to Archive window. `sources`: { root, dir, items: [names] }. `target`: an archive to
// add to (from inside it), else a new one is named after the first item.
async function addDialog({ sources, target }) {
  let status;
  try { status = await sevenZip(); } catch (err) { toastError(err, 'Add to archive'); return null; }
  const saved = readJson(ADD_KEY, {});
  const creatable = status.formats.filter((f) => f.create && f.available && METHODS[f.name]).map((f) => f.name);
  const formats = ['7z', 'zip', 'tar', 'wim', 'gzip', 'bzip2', 'xz'].filter((f) => creatable.includes(f));
  let dest = target ? { root: target.root, path: target.path } : null;
  const one = sources.items.length === 1 ? sources.items[0] : null;
  const roots = (await filesCall('roots').catch(() => [])) || [];
  const rootName = roots.find((x) => x.id === sources.root)?.name;
  const baseName = one ? (one.includes('.') && !sources.isDir?.[one] ? stem(one) : one) : (sources.dir.split('/').pop() || rootName || 'Archive');
  const fmtSel = select(formats.map((f) => [f]), target ? formatFromName(target.path, formats) : saved.format || '7z');
  const name = h('input', { class: 'input', spellcheck: 'false', value: target ? target.path.split('/').pop() : `${baseName}.${EXT[fmtSel.value]}`, autofocus: true });
  const where = h('div', { class: 'small muted ax-where' });
  const setWhere = () => {
    const r = roots.find((x) => x.id === (dest?.root ?? sources.root));
    const dir = dest ? dest.path.split('/').slice(0, -1).join('/') : sources.dir;
    where.textContent = `In ${r?.name || 'shared folder'}${dir ? ` / ${dir.split('/').join(' / ')}` : ''}`;
  };
  setWhere();
  const browse = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const pick = await pickFile({ mode: 'save', title: 'Archive name', name: name.value, start: { root: dest?.root ?? sources.root, path: dest ? dest.path.split('/').slice(0, -1).join('/') : sources.dir } });
    if (pick) { dest = { root: pick.root, path: pick.path }; name.value = pick.name; setWhere(); }
  } }, '…');
  if (target) { name.disabled = true; browse.disabled = true; fmtSel.disabled = true; }
  const level = select(LEVELS, saved.level ?? 5);
  const method = h('select', { class: 'input' });
  const dict = h('select', { class: 'input' });
  const word = h('select', { class: 'input' });
  const solid = select(SOLID, saved.solid || 'on');
  const cpus = Math.max(1, status.cpus || navigator.hardwareConcurrency || 4);
  const threads = select([['', `Auto (${cpus})`], ...Array.from({ length: cpus * 2 }, (_, i) => [String(i + 1), `${i + 1} / ${cpus}`])], saved.threads || '');
  const volumes = h('input', { class: 'input', list: 'ax-vol', placeholder: 'Bytes, e.g. 700m', spellcheck: 'false' });
  const volList = h('datalist', { id: 'ax-vol' }, VOLUMES.map(([v, l]) => h('option', { value: v }, l)));
  const params = h('input', { class: 'input', spellcheck: 'false', placeholder: 'e.g. -mf=off -mqs=on', value: saved.parameters || '' });
  const update = select(UPDATES, target ? 'add' : 'add');
  const sfx = check('Create SFX archive', false, status.sfx?.length ? 'A self-extracting program (Windows)' : 'This 7-Zip doesn’t include the SFX module');
  const shared = check('Compress shared files', false, 'Open files that other programs are writing to (Windows)');
  const delAfter = check('Delete files after compression');
  const pw1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: 'false' });
  const pw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: 'false' });
  const showPw = check('Show password');
  showPw.box.onchange = () => { pw1.type = pw2.type = showPw.box.checked ? 'text' : 'password'; pw2.closest('label').hidden = showPw.box.checked; };
  const encMethod = h('select', { class: 'input' });
  const encNames = check('Encrypt file names', Boolean(saved.encryptNames));
  const memo = h('div', { class: 'ax-hint ax-memo' });

  const refresh = () => {
    const f = fmtSel.value;
    const methods = METHODS[f] || [];
    // Keep the method across a format change only if the new format has it and it was chosen.
    const keepMethod = f === method.dataset.format ? method.value : saved.format === f ? saved.method : '';
    method.dataset.format = f;
    clear(method, methods.map((m) => h('option', { value: m }, m)));
    if (methods.includes(keepMethod)) method.value = keepMethod;
    const store = Number(level.value) === 0 || !methods.length;
    level.disabled = !methods.length;
    method.disabled = store;
    refreshMethod();
    solid.disabled = f !== '7z' || store;
    sfx.box.disabled = f !== '7z' || !status.sfx?.length;
    if (sfx.box.disabled) sfx.box.checked = false;
    const enc = f === '7z' ? [['AES-256']] : f === 'zip' ? [['ZipCrypto'], ['AES-256']] : [];
    clear(encMethod, enc.map(([v]) => h('option', { value: v }, v)));
    if (f === 'zip') encMethod.value = saved.zipEncryption === 'ZipCrypto' ? 'ZipCrypto' : 'AES-256';
    for (const el of [pw1, pw2, encMethod, showPw.box]) el.disabled = !enc.length;
    encNames.box.disabled = f !== '7z';
    memo.textContent = SINGLE_FILE.has(f) ? `${f} holds one file. To pack several, make a tar first (or choose 7z or zip).` : f === 'tar' || f === 'wim' ? `${f} keeps files as they are (no compression).` : '';
    if (!target && !name.dataset.touched) {
      const base = name.value.replace(/\.(7z|zip|tar|wim|gz|bz2|xz|exe)$/i, '');
      name.value = `${base}.${sfx.box.checked ? 'exe' : EXT[f]}`;
    }
  };
  const refreshMethod = () => {
    const m = method.value;
    const store = Number(level.value) === 0 || method.disabled;
    const dl = DICTS[m] || [];
    clear(dict, h('option', { value: '' }, dl.length ? 'Default' : '—'), dl.map(([v, l]) => h('option', { value: v }, l)));
    const wl = WORDS[m] || [];
    clear(word, h('option', { value: '' }, wl.length ? 'Default' : '—'), wl.map((v) => h('option', { value: String(v) }, String(v))));
    dict.disabled = store || !dl.length;
    word.disabled = store || !wl.length;
    dict.closest('label')?.querySelector('span')?.replaceChildren(m === 'PPMd' ? 'Memory (dictionary) size' : 'Dictionary size');
    word.closest('label')?.querySelector('span')?.replaceChildren(m === 'PPMd' ? 'Model order (word size)' : 'Word size');
  };
  name.addEventListener('input', () => { name.dataset.touched = '1'; });
  fmtSel.onchange = refresh;
  level.onchange = refresh;
  method.onchange = refreshMethod;
  sfx.box.onchange = () => { name.dataset.touched = ''; refresh(); };

  const body = h('div', { class: 'ax-add' },
    h('div', { class: 'ax-add-name' }, field('Archive', h('div', { class: 'ax-line' }, name, browse)), where),
    h('div', { class: 'ax-cols' },
      h('div', { class: 'ax-col' },
        field('Archive format', fmtSel),
        field('Compression level', level),
        field('Compression method', method),
        field('Dictionary size', dict),
        field('Word size', word),
        field('Solid block size', solid),
        field('Number of CPU threads', threads),
        field('Split to volumes, bytes', h('div', {}, volumes, volList)),
        field('Parameters', params, '7-Zip method settings (-m…)')),
      h('div', { class: 'ax-col' },
        field('Update mode', update),
        h('fieldset', { class: 'ax-group' }, h('legend', {}, 'Options'), sfx.el, shared.el, delAfter.el),
        h('fieldset', { class: 'ax-group' }, h('legend', {}, 'Encryption'),
          field('Enter password', pw1), field('Reenter password', pw2), showPw.el,
          field('Encryption method', encMethod), encNames.el),
        memo)));

  refresh();
  if (saved.method && [...method.options].some((o) => o.value === saved.method)) { method.value = saved.method; refreshMethod(); }
  for (const [el, v] of [[dict, saved.dictionary], [word, saved.wordSize]]) if (v && [...el.options].some((o) => o.value === v)) el.value = v;

  return dialog(target ? `Add to ${target.path.split('/').pop()}` : 'Add to Archive', body, {
    ok: 'OK', wide: true,
    onOk: () => {
      const f = fmtSel.value;
      const n = name.value.trim();
      if (!n || /[\\/]/.test(n)) throw new Error('Give the archive a file name (no / or \\)');
      if (pw1.value && !showPw.box.checked && pw1.value !== pw2.value) throw new Error('The passwords don’t match');
      if (SINGLE_FILE.has(f) && (sources.items.length > 1 || sources.isDir?.[sources.items[0]])) throw new Error(`${f} can only hold one file. Choose 7z, zip or tar instead.`);
      const vol = volumes.value.trim().toLowerCase().replace(/\s.*$/, '');
      if (vol && !/^\d+[bkmg]?$/.test(vol)) throw new Error('Volume size: a number of bytes, optionally with k, m or g (like 700m)');
      const archivePath = dest ? dest.path.split('/').slice(0, -1).concat(n).join('/') : joinPath(sources.dir, n);
      const store = Number(level.value) === 0;
      const opts = {
        op: 'add', root: sources.root, dir: sources.dir, items: sources.items,
        destRoot: dest?.root ?? sources.root, archive: target ? target.path : archivePath,
        format: f, level: METHODS[f]?.length ? Number(level.value) : undefined,
        method: store ? '' : method.value, dictionary: dict.disabled ? '' : dict.value, wordSize: word.disabled ? '' : word.value,
        solid: solid.disabled ? '' : solid.value, threads: threads.value, volumes: vol, update: update.value,
        sfx: sfx.box.checked ? status.sfx[0] : '', sharedFiles: shared.box.checked, deleteAfter: delAfter.box.checked,
        password: pw1.value, encryptNames: encNames.box.checked && Boolean(pw1.value), zipEncryption: encMethod.value === 'ZipCrypto' ? 'ZipCrypto' : 'AES256',
        parameters: params.value.trim(),
      };
      if (!target) writeJson(ADD_KEY, { format: f, level: Number(level.value), method: method.value, dictionary: dict.value, wordSize: word.value, solid: solid.value, threads: threads.value, encryptNames: encNames.box.checked, zipEncryption: opts.zipEncryption, parameters: opts.parameters });
      return opts;
    },
  });
}

function formatFromName(p, formats) {
  const ext = p.split('.').pop().toLowerCase();
  const f = Object.entries(EXT).find(([, e]) => e === ext)?.[0] || (ext === 'tgz' ? 'gzip' : ext === 'jar' || ext === 'docx' ? 'zip' : '7z');
  return formats.includes(f) ? f : '7z';
}

// Extract window. `archives`: [{ root, path }] (one, or several picked in a folder).
async function extractDialog({ archives, inner, entries, hasSelection, encrypted, password, outerPassword }) {
  const first = archives[0];
  const parent = first.path.split('/').slice(0, -1).join('/');
  const several = archives.length > 1;
  const roots = (await filesCall('roots').catch(() => [])) || [];
  const rootSel = select(roots.map((r) => [String(r.id), r.name]), String(first.root));
  const destPath = h('input', { class: 'input', spellcheck: 'false', value: several ? parent : joinPath(parent, stem(inner ? inner.split('/').pop() : first.path.split('/').pop())), autofocus: true });
  const browse = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const pick = await pickFile({ mode: 'save', title: 'Extract to folder', name: destPath.value.split('/').pop() || 'Extracted', start: { root: Number(rootSel.value), path: destPath.value.split('/').slice(0, -1).join('/') } });
    if (pick) { rootSel.value = String(pick.root); destPath.value = pick.path; }
  } }, '…');
  const each = check('Into a folder named after each archive', true);
  const pathMode = select([['full', 'Full pathnames'], ['none', 'No pathnames']]);
  const overwrite = select([['overwrite', 'Overwrite without prompt'], ['skip', 'Skip existing files'], ['rename', 'Auto rename extracting file'], ['renameExisting', 'Auto rename existing file']], 'rename');
  const elim = check('Eliminate duplication of root folder');
  const which = select([['selected', 'Selected files'], ['all', 'All files']], hasSelection ? 'selected' : 'all');
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', value: password || '' });
  const showPw = check('Show password');
  showPw.box.onchange = () => { pw.type = showPw.box.checked ? 'text' : 'password'; };
  const body = h('div', { class: 'ax-extract' },
    field('Extract to', h('div', { class: 'ax-line' }, rootSel, destPath, browse), several ? 'Folder (inside the shared folder on the left)' : null),
    several ? each.el : null,
    h('div', { class: 'ax-cols' },
      h('div', { class: 'ax-col' }, field('Path mode', pathMode), field('Overwrite mode', overwrite), elim.el),
      h('div', { class: 'ax-col' },
        hasSelection ? field('Files', which) : null,
        field('Password', pw, encrypted ? 'This archive is encrypted' : 'Only needed for encrypted archives'), showPw.el)));
  const res = await dialog('Extract', body, { ok: 'OK', wide: true, onOk: () => ({ destRoot: Number(rootSel.value), dest: destPath.value.trim().replace(/^\/+|\/+$/g, '') }) });
  if (!res) return null;
  return archives.map((a) => ({
    op: 'extract', root: a.root, path: a.path, inner, outerPassword,
    destRoot: res.destRoot, dest: several && each.box.checked ? joinPath(res.dest, stem(a.path.split('/').pop())) : res.dest,
    paths: pathMode.value, overwrite: overwrite.value, eliminateRoot: elim.box.checked,
    entries: hasSelection && which.value === 'selected' ? entries : undefined, password: pw.value,
  }));
}

// ---- The app ----

export const archiveApp = {
  id: 'archive', name: 'Archive Expander', icon: appIcon.archive, size: [1000, 640], description: 'Open, extract and create archives (7-Zip)',
  open(win, opts = {}) {
    const ax = new ArchiveExpander(win);
    ax.start(opts);
    win.on('reopen', (o) => ax.start(o || {}));
  },
};

// Used by Files: "Add to archive…" and the quick "Extract here" / "Add to name.7z" commands.
export async function addToArchive(root, dir, items, isDir = {}) {
  const opts = await addDialog({ sources: { root, dir, items, isDir } });
  if (!opts) return false;
  const job = await runJob(opts, { title: 'Add to archive' });
  return reportJob(job, 'Archive created');
}
export async function quickAdd(root, dir, items, format) {
  const name = items.length === 1 ? (items[0].includes('.') ? stem(items[0]) : items[0]) : (dir.split('/').pop() || 'Archive');
  const job = await runJob({ op: 'add', root, dir, items, archive: joinPath(dir, `${name}.${EXT[format]}`), format, level: 5 }, { title: 'Add to archive' });
  return reportJob(job, 'Archive created');
}
export async function quickExtract(root, p, intoFolder) {
  const dir = p.split('/').slice(0, -1).join('/');
  const job = await runJob({ op: 'extract', root, path: p, dest: intoFolder ? joinPath(dir, stem(p.split('/').pop())) : dir, overwrite: 'rename' }, { title: 'Extract' });
  return reportJob(job, 'Extracted', { root, path: intoFolder ? joinPath(dir, stem(p.split('/').pop())) : dir });
}

function reportJob(job, success, openFolder) {
  if (!job) return false;
  if (job.state === 'error') { showLog(job, 'Error'); return false; }
  toast(success, {
    body: job.warnings ? 'Finished with warnings — some files were skipped.' : job.label || '', type: job.warnings ? 'info' : 'success', icon: appIcon.archive,
    action: openFolder ? { label: 'Show', onClick: () => openApp('files', openFolder) } : null,
  });
  return true;
}

function showLog(job, title) {
  return dialog(title, [h('p', { class: 'ax-err-msg' }, job.error || (job.warnings ? 'Finished with warnings.' : 'Done.')), job.log ? h('pre', { class: 'ax-log' }, job.log) : null], { cancel: null, wide: true });
}

class ArchiveExpander {
  constructor(win) {
    this.win = win;
    this.loc = { kind: 'roots' };
    this.items = [];
    this.view = [];
    this.sel = new Set();
    this.cur = -1;
    this.anchor = -1;
    this.sort = readJson(SORT_KEY, { key: 'name', dir: 1 });
    this.build();
  }

  build() {
    const tb = (ic, label, onclick, title) => h('button', { class: 'ax-tb', title: title || label, onclick }, h('span', { class: 'ax-tb-icon', html: ic }), h('span', { class: 'ax-tb-label' }, label));
    this.btn = {
      add: tb(I.add, 'Add', () => this.add(), 'Add files to an archive (Alt+A)'),
      extract: tb(I.extract, 'Extract', () => this.extract(), 'Extract (Alt+E)'),
      test: tb(I.test, 'Test', () => this.test(), 'Test the archive for errors (Alt+T)'),
      del: tb(I.del, 'Delete', () => this.remove(), 'Delete (Del)'),
      info: tb(I.info, 'Info', () => this.properties(), 'Properties (Alt+Enter)'),
      hash: tb(I.hash, 'CRC SHA', (e) => this.hashMenu(e), 'Checksums of the selected files'),
      tools: tb(I.tools, 'Tools', (e) => this.toolsMenu(e), 'Benchmark and supported formats'),
    };
    this.upBtn = h('button', { class: 'btn btn-icon btn-sm', title: 'Up one level (Backspace)', 'aria-label': 'Up one level', html: I.up, onclick: () => this.up() });
    this.address = h('input', { class: 'input ax-address', spellcheck: 'false', 'aria-label': 'Location', readonly: true });
    this.head = h('div', { class: 'ax-head ax-grid' });
    this.sizer = h('div', { class: 'ax-sizer' });
    this.rows = h('div', { class: 'ax-rows' });
    this.body = h('div', { class: 'ax-body', tabindex: '0' }, this.sizer, this.rows);
    this.status = h('div', { class: 'ax-status' });
    this.notice = h('div', { class: 'ax-notice', hidden: true });
    clear(this.win.body, h('div', { class: 'ax' },
      h('div', { class: 'ax-toolbar' }, ...Object.values(this.btn)),
      h('div', { class: 'ax-addressbar' }, this.upBtn, this.address),
      this.notice,
      h('div', { class: 'ax-list' }, this.head, this.body),
      this.status));
    this.body.addEventListener('scroll', () => this.draw());
    // A click on empty space clears the selection.
    this.body.addEventListener('mousedown', (e) => {
      if ((e.target === this.body || e.target === this.rows || e.target === this.sizer) && !e.ctrlKey && !e.metaKey && !e.shiftKey) { this.sel.clear(); this.cur = -1; this.paintSel(); this.updateUi(); }
    });
    new ResizeObserver(() => this.draw()).observe(this.body);
    this.body.addEventListener('keydown', (e) => this.onKey(e));
    this.body.addEventListener('contextmenu', (e) => { if (e.target === this.body || e.target === this.rows) { e.preventDefault(); this.bgMenu(e); } });
    this.win.body.addEventListener('keydown', (e) => {
      if (!e.altKey || e.target.closest('.dialog')) return;
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); this.add(); } else if (k === 'e') { e.preventDefault(); this.extract(); } else if (k === 't') { e.preventDefault(); this.test(); } else if (e.key === 'Enter') { e.preventDefault(); this.properties(); }
    });
    // Drop files from this computer onto an open archive to add them (via a temporary upload).
    this.body.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); this.body.classList.add('drop'); } });
    this.body.addEventListener('dragleave', () => this.body.classList.remove('drop'));
    this.body.addEventListener('drop', (e) => { e.preventDefault(); this.body.classList.remove('drop'); this.dropFiles([...e.dataTransfer.files]); });
  }

  async start(opts) {
    if (!filesEnabled()) return this.showNotice('Share some folders in Settings → Files first. The Archive Expander works on the shared folders.', { label: 'Open Settings', action: () => openApp('settings', { tab: 'files' }) });
    let st;
    try { st = await sevenZip(); } catch (err) { return this.showNotice(err.message); }
    if (!st.available) {
      return this.showNotice('7-Zip isn’t installed on the MediaDesk server. Install it (Linux: the “7zip” package; Windows: 7-zip.org; the Docker image includes it), or give its location in Settings → Files.',
        { label: 'Check again', action: async () => { toolStatus = null; await sevenZip(true); this.start(opts); } });
    }
    this.notice.hidden = true;
    if (opts.add) {
      await this.goFs(opts.add.root, opts.add.dir || '');
      const ok = await addToArchive(opts.add.root, opts.add.dir || '', opts.add.items, opts.add.isDir || {});
      if (ok) this.reload();
      return;
    }
    if (opts.root != null && opts.path) return this.openArchive(Number(opts.root), opts.path);
    if (opts.root != null) return this.goFs(Number(opts.root), opts.dir || '');
    if (this.loc.kind === 'roots') this.goRoots();
  }

  showNotice(text, btn) {
    clear(this.notice, h('span', { html: icon.alert }), h('span', {}, text), btn ? h('button', { class: 'btn btn-sm', onclick: btn.action }, btn.label) : null);
    this.notice.hidden = false;
    this.items = [];
    this.render();
  }

  // ---- Locations ----

  async goRoots() {
    this.loc = { kind: 'roots' };
    this.loading();
    try {
      const roots = await filesCall('roots');
      this.items = roots.map((r) => ({ name: r.name, folder: true, root: r.id, size: r.free != null ? r.total : null, free: r.free, path: r.path }));
    } catch (err) { this.items = []; toastError(err, 'Couldn’t list the shared folders'); }
    this.render();
  }

  async goFs(root, dir, selectName) {
    this.loc = { kind: 'fs', root, dir };
    this.loading();
    try {
      const r = await filesCall('list', { params: { root, path: dir } });
      if (!this.roots) this.roots = await filesCall('roots').catch(() => []);
      this.items = r.entries.map((e) => ({ name: e.name, folder: e.dir, size: e.size, modified: e.modified, isArchive: !e.dir && canOpenAsArchive(e.name) }));
    } catch (err) { this.items = []; toastError(err, 'Couldn’t open the folder'); }
    this.render(selectName);
  }

  async openArchive(root, path, { inner = '', outerPassword = '', password = '', dir = '', parentLoc = null } = {}) {
    this.loading(`Opening ${(inner || path).split('/').pop()}…`);
    for (;;) {
      try {
        const data = await call('list', { params: { root, path, password, inner, outerPassword } });
        if (!this.roots) this.roots = await filesCall('roots').catch(() => []);
        this.loc = { kind: 'arc', root, path, inner, outerPassword, password, dir: '', data, tree: buildTree(data.entries), parentLoc };
        if (data.warnings?.length) toast('7-Zip warning', { body: data.warnings.join('\n'), type: 'info', timeout: 8000 });
        this.goArcDir(dir);
        return true;
      } catch (err) {
        if (err.code === 'password') {
          const pw = await askPassword(password ? 'Wrong password. Try again:' : `“${(inner || path).split('/').pop()}” is encrypted. Enter the password:`);
          if (pw == null) { this.render(); return false; }
          password = pw;
          continue;
        }
        toastError(err, `Couldn’t open ${(inner || path).split('/').pop()}`);
        this.render();
        return false;
      }
    }
  }

  goArcDir(dir, selectName) {
    const node = this.loc.tree.get(dir) || this.loc.tree.get('');
    this.loc.dir = node.path;
    this.items = [...node.children.values()];
    this.render(selectName);
  }

  async reload() {
    const l = this.loc;
    if (l.kind === 'roots') return this.goRoots();
    if (l.kind === 'fs') return this.goFs(l.root, l.dir);
    const dir = l.dir;
    return this.openArchive(l.root, l.path, { inner: l.inner, outerPassword: l.outerPassword, password: l.password, dir, parentLoc: l.parentLoc });
  }

  up() {
    const l = this.loc;
    if (l.kind === 'fs') {
      if (!l.dir) return this.goRoots();
      const parts = l.dir.split('/');
      const name = parts.pop();
      return this.goFs(l.root, parts.join('/'), name);
    }
    if (l.kind === 'arc') {
      if (l.dir) {
        const parts = l.dir.split('/');
        const name = parts.pop();
        return this.goArcDir(parts.join('/'), name);
      }
      // Out of an archive inside an archive: back into the outer one.
      if (l.parentLoc) {
        const p = l.parentLoc;
        this.loc = p;
        return this.goArcDir(p.dir, l.inner.split('/').pop());
      }
      const parts = l.path.split('/');
      const name = parts.pop();
      return this.goFs(l.root, parts.join('/'), name);
    }
  }

  open(item) {
    const l = this.loc;
    if (l.kind === 'roots') return this.goFs(item.root, '');
    if (l.kind === 'fs') {
      if (item.folder) return this.goFs(l.root, joinPath(l.dir, item.name));
      if (item.isArchive) return this.openArchive(l.root, joinPath(l.dir, item.name));
      return openApp('files', { root: l.root, path: l.dir });
    }
    if (item.folder) return this.goArcDir(item.path);
    if (l.inner && canOpenAsArchive(item.name)) return toast('One level at a time', { body: 'Extract this archive first to look inside it.', icon: appIcon.archive });
    if (isArchiveName(item.name) && !l.inner) return this.openArchive(l.root, l.path, { inner: item.path, outerPassword: l.password, parentLoc: l });
    return this.viewEntry(item);
  }

  // A file inside an archive: show text and pictures here, otherwise download it.
  async viewEntry(item) {
    const l = this.loc;
    const params = new URLSearchParams(Object.entries({ root: l.root, path: l.path, entry: item.path, password: l.password, inner: l.inner, outerPassword: l.outerPassword, inline: 1 }).filter(([, v]) => v !== '' && v != null));
    let res;
    try {
      res = await fetch(`/portal/archive/entry?${params}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (err) { return toastError(err, `Couldn’t open ${item.name}`); }
    const type = res.headers.get('Content-Type') || '';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (type.startsWith('text/') && blob.size < 4 * 1024 * 1024) {
      const text = await blob.text();
      URL.revokeObjectURL(url);
      return dialog(item.name, h('pre', { class: 'ax-view-text' }, text), { cancel: null, wide: true, ok: 'Close' });
    }
    if (type.startsWith('image/')) {
      await dialog(item.name, h('div', { class: 'ax-view-img' }, h('img', { src: url, alt: item.name })), { cancel: null, wide: true, ok: 'Close' });
      return URL.revokeObjectURL(url);
    }
    const a = h('a', { href: url, download: item.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
  }

  // ---- List ----

  loading(text = 'Loading…') {
    clear(this.rows, h('div', { class: 'ax-loading' }, spinner(text)));
    this.sizer.style.height = '0';
  }

  columns() {
    const k = this.loc.kind;
    if (k === 'roots') return [['name', 'Name', '1fr'], ['path', 'Location', '1.4fr'], ['size', 'Total Size', '120px'], ['free', 'Free Space', '120px']];
    if (k === 'fs') return [['name', 'Name', 'minmax(200px, 1fr)'], ['size', 'Size', '110px'], ['modified', 'Modified', '160px'], ['type', 'Type', '110px']];
    return [['name', 'Name', 'minmax(200px, 1fr)'], ['size', 'Size', '100px'], ['packed', 'Packed Size', '100px'], ['modified', 'Modified', '150px'], ['attributes', 'Attributes', '90px'], ['encrypted', 'Encrypted', '80px'], ['crc', 'CRC', '84px'], ['method', 'Method', '110px']];
  }

  render(selectName) {
    const cols = this.columns();
    this.win.el.style.setProperty('--ax-cols', cols.map((c) => c[2]).join(' '));
    clear(this.head, cols.map(([key, label]) => h('div', {
      class: `ax-hcell ${this.sort.key === key ? (this.sort.dir > 0 ? 'asc' : 'desc') : ''} ${['size', 'packed', 'free'].includes(key) ? 'num' : ''}`,
      onclick: () => { this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : 1 }; writeJson(SORT_KEY, this.sort); this.render(); },
    }, label)));
    const k = this.sort.key, d = this.sort.dir;
    const val = (it) => (k === 'type' ? typeOf(it) : k === 'encrypted' ? (it.encrypted ? 1 : 0) : it[k]);
    this.view = this.items.slice().sort((a, b) => {
      if (a.folder !== b.folder && this.loc.kind !== 'roots') return a.folder ? -1 : 1;
      const x = val(a), y = val(b);
      if (typeof x === 'number' || typeof y === 'number') return ((x ?? -1) - (y ?? -1)) * d || a.name.localeCompare(b.name);
      return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * d;
    });
    this.sel = new Set();
    this.cur = selectName ? this.view.findIndex((it) => it.name === selectName) : -1;
    if (this.cur >= 0) { this.sel.add(this.cur); this.anchor = this.cur; }
    this.sizer.style.height = `${this.view.length * ROW}px`;
    this.address.value = this.locationText();
    this.win.setTitle?.(this.loc.kind === 'arc' ? `${(this.loc.inner || this.loc.path).split('/').pop()} — Archive Expander` : 'Archive Expander');
    this.upBtn.disabled = this.loc.kind === 'roots';
    if (this.cur >= 0) this.scrollTo(this.cur); else this.body.scrollTop = 0;
    this.rows.replaceChildren();
    this.drawn = null;
    this.draw();
    this.updateUi();
    if (!this.view.length && this.notice.hidden) this.rows.append(h('div', { class: 'ax-empty muted' }, this.loc.kind === 'arc' ? 'This folder is empty' : 'Nothing here'));
  }

  locationText() {
    const l = this.loc;
    const rootName = (id) => (this.roots || []).find((r) => r.id === id)?.name || 'Shared folder';
    if (l.kind === 'roots') return 'Shared folders';
    if (l.kind === 'fs') return [rootName(l.root), ...(l.dir ? l.dir.split('/') : [])].join(' / ') + ' /';
    return [rootName(l.root), ...l.path.split('/'), ...(l.inner ? l.inner.split('/') : []), ...(l.dir ? l.dir.split('/') : [])].join(' / ') + ' /';
  }

  draw() {
    const top = this.body.scrollTop, hgt = this.body.clientHeight;
    const from = Math.max(0, Math.floor(top / ROW) - 5), to = Math.min(this.view.length, Math.ceil((top + hgt) / ROW) + 5);
    const key = `${from}:${to}`;
    if (this.drawn === key) return this.paintSel();
    this.drawn = key;
    const cols = this.columns().map((c) => c[0]);
    const frag = [];
    for (let i = from; i < to; i++) {
      const it = this.view[i];
      const ic = this.loc.kind === 'roots' ? I.drive : it.folder ? I.folder : (it.isArchive || (this.loc.kind === 'arc' && isArchiveName(it.name))) ? I.arc : I.file;
      const cells = cols.map((c) => {
        if (c === 'name') return h('span', { class: 'ax-name' }, h('span', { class: 'ax-ic', html: ic }), h('span', { class: 'ax-n' }, it.name));
        if (c === 'size') return h('span', { class: 'num' }, this.loc.kind === 'roots' ? (it.size != null ? formatBytes(it.size) : '') : it.folder && this.loc.kind === 'fs' ? '' : sizeText(it.size));
        if (c === 'packed') return h('span', { class: 'num' }, it.packed == null ? '' : sizeText(it.packed));
        if (c === 'free') return h('span', { class: 'num' }, it.free != null ? formatBytes(it.free) : '');
        if (c === 'modified') return h('span', {}, this.loc.kind === 'fs' ? fmtMs(it.modified) : fmtDate(it.modified));
        if (c === 'type') return h('span', {}, typeOf(it));
        if (c === 'encrypted') return h('span', {}, it.encrypted ? '+' : '-');
        return h('span', {}, it[c] ?? '');
      });
      const row = h('div', {
        class: `ax-row ax-grid ${this.sel.has(i) ? 'sel' : ''} ${this.cur === i ? 'cur' : ''}`, style: { top: `${i * ROW}px` }, dataset: { i: String(i) },
        onmousedown: (e) => { if (e.button === 0 || !this.sel.has(i)) this.clickRow(e, i); },
        ondblclick: () => this.open(it),
        // Phones and tablets: a tap opens (long-press for the menu), as in Files.
        onclick: (e) => { if (isTouch() && !e.ctrlKey && !e.shiftKey) this.open(it); },
        oncontextmenu: (e) => { e.preventDefault(); if (!this.sel.has(i)) this.clickRow(e, i); this.rowMenu(e, it); },
      }, cells);
      frag.push(row);
    }
    this.rows.replaceChildren(...frag);
  }

  // Selection changes restyle the rows in place (rebuilding them would swallow double-clicks).
  paintSel() {
    for (const r of this.rows.children) {
      const i = Number(r.dataset.i);
      r.classList.toggle('sel', this.sel.has(i));
      r.classList.toggle('cur', this.cur === i);
    }
  }

  clickRow(e, i) {
    this.body.focus({ preventScroll: true });
    if (e.shiftKey && this.anchor >= 0) {
      if (!(e.ctrlKey || e.metaKey)) this.sel.clear();
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      for (let k = a; k <= b; k++) this.sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      if (this.sel.has(i)) this.sel.delete(i); else this.sel.add(i);
      this.anchor = i;
    } else { this.sel = new Set([i]); this.anchor = i; }
    this.cur = i;
    this.draw();
    this.updateUi();
  }

  scrollTo(i) {
    const t = i * ROW, b = this.body;
    if (t < b.scrollTop) b.scrollTop = t;
    else if (t + ROW > b.scrollTop + b.clientHeight) b.scrollTop = t + ROW - b.clientHeight;
  }

  onKey(e) {
    if (e.target !== this.body) return;
    const n = this.view.length;
    const move = (to) => {
      e.preventDefault();
      if (!n) return;
      to = Math.max(0, Math.min(n - 1, to));
      if (e.shiftKey && this.anchor >= 0) { this.sel.clear(); for (let k = Math.min(this.anchor, to); k <= Math.max(this.anchor, to); k++) this.sel.add(k); } else { this.sel = new Set([to]); this.anchor = to; }
      this.cur = to;
      this.scrollTo(to);
      this.draw();
      this.updateUi();
    };
    const page = Math.max(1, Math.floor(this.body.clientHeight / ROW) - 1);
    if (e.key === 'ArrowDown') move(this.cur + 1);
    else if (e.key === 'ArrowUp') move(this.cur < 0 ? 0 : this.cur - 1);
    else if (e.key === 'PageDown') move(this.cur + page);
    else if (e.key === 'PageUp') move(this.cur - page);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(n - 1);
    else if (e.key === 'Enter' && !e.altKey && this.cur >= 0) { e.preventDefault(); this.open(this.view[this.cur]); } else if (e.key === 'Backspace') { e.preventDefault(); this.up(); } else if (e.key === 'Delete') { e.preventDefault(); this.remove(); } else if (e.key === 'F2') { e.preventDefault(); this.rename(); } else if (e.key === 'F5') { e.preventDefault(); this.reload(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.sel = new Set(this.view.map((_, i) => i));

      this.draw();
      this.updateUi();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type to jump to a name.
      this.typed = (Date.now() - (this.typedAt || 0) < 900 ? this.typed : '') + e.key.toLowerCase();
      this.typedAt = Date.now();
      const i = this.view.findIndex((it) => it.name.toLowerCase().startsWith(this.typed));
      if (i >= 0) move(i);
    }
  }

  selected() { return [...this.sel].sort((a, b) => a - b).map((i) => this.view[i]); }

  updateUi() {
    const l = this.loc, s = this.selected();
    const inArc = l.kind === 'arc';
    const fsArchives = l.kind === 'fs' && s.length && s.every((it) => it.isArchive);
    const set = (b, on, title) => { b.disabled = !on; if (title) b.title = title; };
    set(this.btn.add, (l.kind === 'fs' && s.length > 0) || (inArc && !l.inner));
    set(this.btn.extract, inArc || fsArchives);
    set(this.btn.test, inArc || fsArchives);
    set(this.btn.del, (inArc && !l.inner && s.length > 0) || (l.kind === 'fs' && s.length > 0));
    set(this.btn.info, inArc || (l.kind === 'fs' && s.length === 1));
    set(this.btn.hash, l.kind === 'fs' && s.length > 0);
    // Status bar, like 7-Zip's.
    const total = (list) => list.reduce((a, it) => a + (it.size || 0), 0);
    const parts = [];
    if (s.length) parts.push(`${s.length} object(s) selected`, formatBytes(total(s)));
    else parts.push(`${this.view.length} object(s)`);
    if (inArc) {
      const info = l.data.info, ent = l.data.entries;
      const files = ent.filter((e) => !e.folder);
      parts.push(`${info.type}${info.method ? ` · ${info.method}` : ''}`, `${files.length} files, ${l.tree.size - 1} folders`, `${formatBytes(total(files))} → ${formatBytes(info.physicalSize || 0)}`);
      if (info.encrypted || ent.some((e) => e.encrypted)) parts.push('🔒 encrypted');
      if (l.inner) parts.push('read-only (inside another archive)');
    }
    clear(this.status, parts.map((p) => h('span', {}, p)));
  }

  // ---- Menus ----

  rowMenu(e, it) {
    const l = this.loc, many = this.sel.size > 1;
    if (l.kind === 'roots') return contextMenu(e.clientX, e.clientY, [{ label: 'Open', icon: icon.folder, action: () => this.open(it) }]);
    if (l.kind === 'fs') {
      const s = this.selected();
      const arcs = s.every((x) => x.isArchive);
      const base = s.length === 1 ? (it.folder ? it.name : stem(it.name)) : (l.dir.split('/').pop() || 'Archive');
      return contextMenu(e.clientX, e.clientY, [
        { label: it.isArchive ? 'Open archive' : 'Open', icon: icon.folder, disabled: many, action: () => this.open(it) },
        arcs ? '-' : null,
        arcs ? { label: 'Extract files…', icon: I.extract, action: () => this.extract() } : null,
        arcs ? { label: 'Extract Here', icon: I.extract, action: () => this.quickExtractSel(false) } : null,
        arcs ? { label: many ? 'Extract to "*/"' : `Extract to "${stem(it.name)}/"`, icon: I.extract, action: () => this.quickExtractSel(true) } : null,
        arcs ? { label: 'Test archive', icon: I.test, action: () => this.test() } : null,
        '-',
        { label: 'Add to archive…', icon: I.add, action: () => this.add() },
        { label: `Add to "${base}.7z"`, icon: I.add, action: () => this.quick('7z') },
        { label: `Add to "${base}.zip"`, icon: I.add, action: () => this.quick('zip') },
        '-',
        { label: 'CRC SHA…', icon: I.hash, action: () => this.hashChoose() },
        { label: 'Properties', icon: I.info, disabled: many, action: () => this.properties() },
        '-',
        { label: 'Rename', disabled: many, action: () => this.rename() },
        { label: 'Delete', icon: icon.trash, action: () => this.remove() },
      ].filter(Boolean));
    }
    contextMenu(e.clientX, e.clientY, [
      { label: 'Open', icon: icon.folder, disabled: many, action: () => this.open(it) },
      { label: 'Extract…', icon: I.extract, action: () => this.extract() },
      { label: 'Test', icon: I.test, action: () => this.test(true) },
      '-',
      { label: 'Rename', disabled: many || Boolean(l.inner), action: () => this.rename() },
      { label: 'Delete', icon: icon.trash, disabled: Boolean(l.inner), action: () => this.remove() },
      '-',
      { label: 'Properties', icon: I.info, action: () => this.properties() },
    ]);
  }

  bgMenu(e) {
    const l = this.loc;
    const items = [{ label: 'Refresh', icon: icon.refresh, action: () => this.reload() }];
    if (l.kind === 'fs') items.push({ label: 'New folder', icon: icon.folder, action: () => this.newFolder() });
    if (l.kind === 'arc') items.push({ label: 'Archive properties', icon: I.info, action: () => this.properties(true) }, { label: 'Test archive', icon: I.test, action: () => this.test() });
    contextMenu(e.clientX, e.clientY, items);
  }

  hashMenu(e) {
    const r = (e.currentTarget || e.target)?.getBoundingClientRect?.();
    const x = r ? r.left : e.clientX, y = r ? r.bottom : e.clientY;
    contextMenu(x, y, [
      ...['CRC32', 'CRC64', 'XXH64', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'SHA3-256', 'MD5', 'BLAKE2sp'].map((a) => ({ label: a.replace('SHA', 'SHA-').replace('SHA-3', 'SHA3').replace('CRC', 'CRC-'), action: () => this.hash([a]) })),
      '-',
      { label: '* (all of them)', action: () => this.hash(['CRC32', 'CRC64', 'XXH64', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'SHA3-256', 'MD5', 'BLAKE2sp']) },
      { label: 'Choose…', action: () => this.hashChoose() },
    ]);
  }

  toolsMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom, [
      { label: 'Benchmark', icon: icon.bolt, action: () => this.benchmark() },
      { label: 'Supported formats', icon: icon.list, action: () => this.formats() },
      '-',
      { label: 'Refresh', icon: icon.refresh, action: () => this.reload() },
      { label: '7-Zip settings…', icon: icon.sliders, action: () => openApp('settings', { tab: 'files' }) },
    ]);
  }

  // ---- Commands ----

  async add() {
    const l = this.loc;
    if (l.kind === 'fs') {
      const s = this.selected();
      if (!s.length) return;
      const isDir = Object.fromEntries(s.map((it) => [it.name, it.folder]));
      if (await addToArchive(l.root, l.dir, s.map((it) => it.name), isDir)) this.goFs(l.root, l.dir);
      return;
    }
    if (l.kind === 'arc' && !l.inner) {
      // Choose a file from the shared folders to put into this archive.
      const pick = await pickFile({ title: `Add a file to ${l.path.split('/').pop()}`, start: { root: l.root, path: l.path.split('/').slice(0, -1).join('/') } });
      if (!pick) return;
      const dir = pick.path.split('/').slice(0, -1).join('/');
      const opts = await addDialog({ sources: { root: pick.root, dir, items: [pick.name] }, target: { root: l.root, path: l.path } });
      if (!opts) return;
      const job = await runJob({ ...opts, password: opts.password || l.password }, { title: 'Add', host: document.body });
      if (reportJob(job, 'Added')) this.reload();
    }
  }

  async dropFiles(files) {
    const l = this.loc;
    if (!files.length) return;
    if (l.kind === 'fs') {
      toast('Upload with Files', { body: 'Drop files into the Files app to copy them to the server, then add them to an archive here.', icon: appIcon.archive });
      return openApp('files', { root: l.root, path: l.dir });
    }
    toast('Add from the shared folders', { body: 'Use Add to put a file from the shared folders into this archive.', icon: appIcon.archive });
  }

  async quick(format) {
    const l = this.loc, s = this.selected();
    if (await quickAdd(l.root, l.dir, s.map((it) => it.name), format)) this.goFs(l.root, l.dir);
  }

  async quickExtractSel(intoFolder) {
    const l = this.loc;
    for (const it of this.selected()) await quickExtract(l.root, joinPath(l.dir, it.name), intoFolder);
    this.goFs(l.root, l.dir);
  }

  async extract() {
    const l = this.loc;
    let jobs;
    if (l.kind === 'fs') {
      const s = this.selected().filter((it) => it.isArchive);
      if (!s.length) return;
      jobs = await extractDialog({ archives: s.map((it) => ({ root: l.root, path: joinPath(l.dir, it.name) })) });
    } else if (l.kind === 'arc') {
      const s = this.selected();
      const encrypted = l.data.info.encrypted || l.data.entries.some((e) => e.encrypted);
      jobs = await extractDialog({ archives: [{ root: l.root, path: l.path }], inner: l.inner, outerPassword: l.outerPassword, entries: s.map((it) => it.path), hasSelection: s.length > 0, encrypted, password: l.password });
    }
    if (!jobs) return;
    let last = null;
    for (const body of jobs) {
      const job = await runJob(body, { title: 'Extract' });
      if (!job) return;
      if (job.state === 'error') { showLog(job, `Couldn’t extract ${body.path.split('/').pop()}`); return; }
      last = job;
    }
    if (last) {
      const dest = jobs[jobs.length - 1];
      toast('Extracted', {
        body: last.warnings ? 'Finished with warnings — some files were skipped.' : `To ${dest.dest || 'the shared folder'}`, type: last.warnings ? 'info' : 'success', icon: appIcon.archive,
        action: { label: 'Show', onClick: () => (jobs.length > 1 ? openApp('files', { root: dest.destRoot, path: dest.dest.split('/').slice(0, -1).join('/') }) : openApp('files', { root: dest.destRoot, path: dest.dest })) },
      });
      if (l.kind === 'fs') this.goFs(l.root, l.dir);
    }
  }

  async test(selectedOnly = false) {
    const l = this.loc;
    const targets = l.kind === 'fs'
      ? this.selected().filter((it) => it.isArchive).map((it) => ({ op: 'test', root: l.root, path: joinPath(l.dir, it.name) }))
      : l.kind === 'arc' ? [{ op: 'test', root: l.root, path: l.path, inner: l.inner, outerPassword: l.outerPassword, password: l.password, entries: selectedOnly && this.sel.size ? this.selected().map((it) => it.path) : undefined }] : [];
    const results = [];
    for (const body of targets) {
      const job = await runJob(body, { title: 'Testing' });
      if (!job) return;
      results.push({ name: (body.inner || body.path).split('/').pop(), job });
    }
    if (!results.length) return;
    const ok = results.every((r) => r.job.state === 'done' && !r.job.warnings);
    const sum = (k) => results.reduce((a, r) => a + (r.job.result?.[k] || 0), 0);
    await dialog(ok ? 'Testing: there are no errors' : 'Testing found problems', h('div', { class: 'ax-test' },
      ok ? h('p', { class: 'ax-ok' }, h('span', { html: icon.check }), 'There are no errors') : null,
      h('table', { class: 'ax-props' }, h('tbody', {},
        results.length > 1 ? row('Archives', results.length) : null,
        row('Folders', sum('folders')), row('Files', sum('files')), row('Size', `${formatBytes(sum('size'))} (${sum('size').toLocaleString()} bytes)`), row('Packed size', `${formatBytes(sum('compressed'))} (${sum('compressed').toLocaleString()} bytes)`))),
      results.filter((r) => r.job.state === 'error' || r.job.warnings).map((r) => h('div', {}, h('p', { class: 'ax-err-msg' }, `${r.name}: ${r.job.error || 'warnings'}`), r.job.log ? h('pre', { class: 'ax-log' }, r.job.log) : null))),
    { cancel: null, wide: !ok, ok: 'Close' });
  }

  async remove() {
    const l = this.loc, s = this.selected();
    if (!s.length) return;
    const what = s.length === 1 ? `“${s[0].name}”` : `these ${s.length} items`;
    if (l.kind === 'fs') {
      if (!(await confirmDialog({ title: 'Delete', message: `Delete ${what} from the shared folder? This can’t be undone.`, confirm: 'Delete', danger: true }))) return;
      try { await filesCall('delete', { method: 'POST', body: { root: l.root, paths: s.map((it) => joinPath(l.dir, it.name)) } }); } catch (err) { toastError(err, 'Couldn’t delete'); }
      return this.goFs(l.root, l.dir);
    }
    if (l.kind !== 'arc' || l.inner) return;
    if (!(await confirmDialog({ title: 'Delete from archive', message: `Delete ${what} from ${l.path.split('/').pop()}?`, confirm: 'Delete', danger: true }))) return;
    const job = await runJob({ op: 'delete', root: l.root, path: l.path, password: l.password, entries: s.map((it) => it.path) }, { title: 'Deleting' });
    if (job?.state === 'error') return showLog(job, 'Couldn’t delete');
    if (job) this.reload();
  }

  async rename() {
    const l = this.loc, s = this.selected();
    if (s.length !== 1 || l.kind === 'roots') return;
    const it = s[0];
    const input = h('input', { class: 'input', value: it.name, spellcheck: 'false', autofocus: true });
    setTimeout(() => { const dot = it.name.lastIndexOf('.'); input.setSelectionRange(0, !it.folder && dot > 0 ? dot : it.name.length); });
    const name = await dialog('Rename', field('New name', input), { onOk: () => { const v = input.value.trim(); if (!v || /[\\/]/.test(v)) throw new Error('Enter a name without / or \\'); return v; } });
    if (!name || name === it.name) return;
    if (l.kind === 'fs') {
      try { await filesCall('rename', { method: 'POST', body: { root: l.root, path: joinPath(l.dir, it.name), name } }); } catch (err) { toastError(err, 'Couldn’t rename'); }
      return this.goFs(l.root, l.dir, name);
    }
    if (l.inner) return;
    const job = await runJob({ op: 'rename', root: l.root, path: l.path, password: l.password, from: it.path, to: joinPath(l.dir, name) }, { title: 'Renaming' });
    if (job?.state === 'error') return showLog(job, 'Couldn’t rename');
    if (job) this.openArchive(l.root, l.path, { inner: l.inner, password: l.password, dir: l.dir, parentLoc: l.parentLoc }).then(() => this.goArcDir(l.dir, name));
  }

  async newFolder() {
    const l = this.loc;
    const input = h('input', { class: 'input', value: 'New folder', spellcheck: 'false', autofocus: true });
    setTimeout(() => input.select());
    const name = await dialog('Create Folder', field('Folder name', input), { onOk: () => input.value.trim() || false });
    if (!name) return;
    try { await filesCall('mkdir', { method: 'POST', body: { root: l.root, path: l.dir, name } }); } catch (err) { toastError(err, 'Couldn’t create the folder'); }
    this.goFs(l.root, l.dir, name);
  }

  async properties(archiveOnly = false) {
    const l = this.loc, s = this.selected();
    if (l.kind === 'fs') {
      const it = s[0];
      if (!it) return;
      if (it.isArchive) {
        // Like 7-Zip: the archive's own properties.
        try {
          const data = await call('list', { params: { root: l.root, path: joinPath(l.dir, it.name) } });
          return this.archiveProps(it.name, data, it);
        } catch (err) { if (err.code !== 'password') return toastError(err, 'Properties'); }
      }
      return dialog('Properties', h('table', { class: 'ax-props' }, h('tbody', {},
        row('Name', it.name), row('Type', typeOf(it)), it.folder ? null : row('Size', `${formatBytes(it.size || 0)} (${sizeText(it.size)} bytes)`), row('Modified', fmtMs(it.modified)))), { cancel: null });
    }
    if (l.kind !== 'arc') return;
    if (archiveOnly || !s.length) return this.archiveProps((l.inner || l.path).split('/').pop(), l.data);
    if (s.length > 1) {
      const files = s.flatMap((it) => (it.folder ? descendants(it) : [it]));
      return dialog('Properties', h('table', { class: 'ax-props' }, h('tbody', {},
        row('Selected', `${s.length} items`), row('Files', files.length), row('Size', `${formatBytes(files.reduce((a, x) => a + (x.size || 0), 0))}`),
        row('Packed size', formatBytes(files.reduce((a, x) => a + (x.packed || 0), 0))))), { cancel: null });
    }
    const it = s[0];
    const files = it.folder ? descendants(it) : null;
    return dialog('Properties', h('table', { class: 'ax-props' }, h('tbody', {},
      row('Path', it.path), row('Folder', it.folder ? '+' : '-'),
      row('Size', `${formatBytes(it.size || 0)} (${sizeText(it.size || 0)} bytes)`), row('Packed Size', it.packed == null ? '' : sizeText(it.packed)),
      files ? row('Files', files.length) : null, row('Modified', fmtDate(it.modified)), row('Attributes', it.attributes), row('Encrypted', it.encrypted ? '+' : '-'),
      row('CRC', it.crc), row('Method', it.method), it.comment ? row('Comment', it.comment) : null,
      it.size && it.packed != null ? row('Ratio', `${Math.round((it.packed / it.size) * 100)}%`) : null)), { cancel: null });
  }

  archiveProps(name, data) {
    const i = data.info, e = data.entries;
    const files = e.filter((x) => !x.folder);
    const size = files.reduce((a, x) => a + (x.size || 0), 0);
    const folders = buildTree(e).size - 1;
    const yes = (v) => (v ? '+' : '-');
    return dialog(`${name} — Properties`, h('table', { class: 'ax-props' }, h('tbody', {},
      row('Name', name), row('Type', i.type), row('Physical Size', `${formatBytes(i.physicalSize || 0)} (${sizeText(i.physicalSize || 0)} bytes)`),
      i.headersSize != null ? row('Headers Size', sizeText(i.headersSize)) : null, i.method ? row('Method', i.method) : null,
      i.type === '7z' ? row('Solid', yes(i.solid)) : null, i.blocks != null ? row('Blocks', i.blocks) : null,
      row('Files', files.length), row('Folders', folders), row('Size', `${formatBytes(size)} (${sizeText(size)} bytes)`),
      size ? row('Compression ratio', `${Math.round(((i.physicalSize || 0) / size) * 100)}%`) : null,
      row('Encrypted', yes(i.encrypted || e.some((x) => x.encrypted))), i.multivolume ? row('Volumes', i.volumes) : null,
      i.offset ? row('Offset', i.offset) : null, i.characteristics ? row('Characteristics', i.characteristics) : null,
      i.comment ? row('Comment', i.comment) : null)), { cancel: null, ok: 'Close' });
  }

  async hashChoose() {
    const all = ['CRC32', 'CRC64', 'XXH64', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'SHA3-256', 'MD5', 'BLAKE2sp'];
    const boxes = all.map((a) => check(a, a === 'CRC32' || a === 'SHA256'));
    const algs = await dialog('Checksums', h('div', { class: 'ax-hash-pick' }, boxes.map((b) => b.el)), {
      ok: 'Calculate', onOk: () => { const v = all.filter((_, i) => boxes[i].box.checked); if (!v.length) throw new Error('Choose at least one'); return v; },
    });
    if (algs) this.hash(algs);
  }

  async hash(algorithms) {
    const l = this.loc, s = this.selected();
    if (l.kind !== 'fs' || !s.length) return toast('Checksums', { body: 'Select files or folders in a shared folder first.', icon: appIcon.archive });
    const job = await runJob({ op: 'hash', root: l.root, dir: l.dir, items: s.map((it) => it.name), algorithms }, { title: 'Checksum calculating' });
    if (!job) return;
    if (job.state === 'error') return showLog(job, 'Couldn’t calculate the checksums');
    const r = job.result || { files: [], algorithms };
    const files = r.files.filter((f) => !f.folder);
    const copyAll = () => {
      const text = files.map((f) => `${r.algorithms.map((a) => f.hashes[a]).join('  ')}  ${f.name}`).join('\n');
      navigator.clipboard?.writeText(text).then(() => toast('Copied', { timeout: 1500 }), () => {});
    };
    await dialog('Checksum information', h('div', { class: 'ax-hash' },
      h('table', { class: 'ax-props' }, h('tbody', {},
        row('Name', s.length === 1 ? s[0].name : `${s.length} items`), row('Files', files.length), r.folders ? row('Folders', r.folders) : null, row('Size', `${formatBytes(r.size || 0)} (${(r.size || 0).toLocaleString()} bytes)`),
        r.algorithms.flatMap((a) => (r.totals?.[a] ? [row(`${a} for data`, h('code', {}, r.totals[a].data)), files.length > 1 || r.folders ? row(`${a} for data and names`, h('code', {}, r.totals[a].dataAndNames)) : null] : [])))),
      files.length > 1 || s[0]?.folder ? h('div', { class: 'ax-hash-files' }, h('table', { class: 'ax-hash-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Size'), r.algorithms.map((a) => h('th', {}, a)))),
        h('tbody', {}, files.map((f) => h('tr', {}, h('td', {}, f.name), h('td', { class: 'num' }, sizeText(f.size)), r.algorithms.map((a) => h('td', {}, h('code', {}, f.hashes[a])))))))) : null,
      h('button', { class: 'btn btn-sm ax-mt', type: 'button', onclick: copyAll }, 'Copy')), { cancel: null, ok: 'Close', wide: true });
  }

  async benchmark() {
    const st = await sevenZip().catch(() => ({ cpus: 4 }));
    const dict = select([22, 23, 24, 25, 26, 27, 28, 29, 30].map((d) => [String(d), `${formatBytes(2 ** d, 0)}`]), '25');
    const threads = select([['', `Auto (${st.cpus || 4})`], ...Array.from({ length: (st.cpus || 4) * 2 }, (_, i) => [String(i + 1), String(i + 1)])]);
    const passes = select([1, 2, 3, 5, 10].map((p) => [String(p), String(p)]), '1');
    const out = h('pre', { class: 'ax-log ax-bench-out' }, 'Press Start to measure how fast 7-Zip compresses and decompresses on the MediaDesk server.');
    const rating = h('div', { class: 'ax-bench-total' });
    const start = h('button', { class: 'btn btn-primary', type: 'button' }, 'Start');
    start.onclick = async () => {
      start.disabled = true;
      out.textContent = 'Running… (this takes a little while)';
      rating.textContent = '';
      const job = await runJob({ op: 'benchmark', dictionary: dict.value, threads: threads.value, passes: passes.value }, { title: 'Benchmark' });
      start.disabled = false;
      if (!job) { out.textContent = 'Stopped.'; return; }
      if (job.state === 'error') { out.textContent = job.error; return; }
      out.textContent = job.result?.table || job.log;
      if (job.result?.total) rating.textContent = `Total rating: ${job.result.total.rating.toLocaleString()} MIPS · CPU usage ${job.result.total.usage}%`;
    };
    await dialog('Benchmark', h('div', { class: 'ax-bench' },
      h('div', { class: 'ax-line ax-bench-opts' }, field('Dictionary size', dict), field('CPU threads', threads), field('Passes', passes), start),
      out, rating), { cancel: null, ok: 'Close', wide: true });
  }

  async formats() {
    let st;
    try { st = await sevenZip(); } catch (err) { return toastError(err, 'Formats'); }
    await dialog('Supported formats', h('div', { class: 'ax-formats' },
      h('p', { class: 'small muted' }, `7-Zip ${st.version || ''} on the MediaDesk server${st.path ? ` (${st.path})` : ''}. It opens all of these; the ones marked “Create” can be made with Add.`),
      h('table', { class: 'ax-hash-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Format'), h('th', {}, 'Extensions'), h('th', {}, 'Create'), h('th', {}, 'Available'))),
        h('tbody', {}, st.formats.map((f) => h('tr', { class: f.available ? '' : 'muted' }, h('td', {}, f.name), h('td', {}, f.ext.join(' ')), h('td', {}, f.create ? '✓' : ''), h('td', {}, f.available ? '✓' : '—')))))),
    { cancel: null, ok: 'Close', wide: true });
  }
}

const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v ?? ''));

function typeOf(it) {
  if (it.folder) return 'Folder';
  const m = /\.([^.]+)$/.exec(it.name);
  return m ? `${m[1].toUpperCase()} ${it.isArchive ? 'archive' : 'file'}` : 'File';
}

// Folders from the paths in a listing (archives needn't list folders), each with the total size.
function buildTree(entries) {
  const tree = new Map([['', { name: '', path: '', folder: true, children: new Map(), size: 0, packed: 0 }]]);
  const folder = (p) => {
    if (tree.has(p)) return tree.get(p);
    const parts = p.split('/');
    const name = parts.pop();
    const parent = folder(parts.join('/'));
    const node = { name, path: p, folder: true, children: new Map(), size: 0, packed: null, modified: '' };
    parent.children.set(name, node);
    tree.set(p, node);
    return node;
  };
  for (const e of entries) {
    const p = e.path.replace(/\/+$/, '');
    if (!p) continue;
    if (e.folder) { Object.assign(folder(p), { modified: e.modified, attributes: e.attributes, comment: e.comment }); continue; }
    const parts = p.split('/');
    const name = parts.pop();
    const parent = folder(parts.join('/'));
    parent.children.set(name, { ...e, name, path: p });
    // Sizes add up into every folder above.
    let dir = parts.join('/');
    for (;;) {
      const n = tree.get(dir);
      n.size += e.size || 0;
      if (e.packed != null) n.packed = (n.packed || 0) + e.packed;
      if (!dir) break;
      dir = dir.split('/').slice(0, -1).join('/');
    }
  }
  return tree;
}

function descendants(node) {
  const out = [];
  const walk = (n) => { for (const c of n.children?.values() || []) { if (c.folder) walk(c); else out.push(c); } };
  walk(node);
  return out;
}
