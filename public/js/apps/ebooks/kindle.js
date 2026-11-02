// eBook Reader and Kindle: backing up the books on a device (a Kindle Fire, say) to the library,
// and getting library books into the Kindle app: as a Kindle-format download onto this device, or
// by Amazon's Send to Kindle email (to every device with the Kindle app).

import { h, clear, toast, toastError, formatBytes } from '../../ui.js';
import { openApp } from '../../wm.js';
import { formatOf } from './sources.js';

const FIRE = /\bSilk\b|\bKF[A-Z]{2,5}\b|Kindle/i.test(navigator.userAgent);
const ANDROID = /Android/i.test(navigator.userAgent);
const KINDLE_APP = new Set(['mobi', 'azw3', 'pdf', 'txt']);
const SEND_TO_KINDLE = new Set(['epub', 'pdf', 'docx', 'rtf', 'txt']);
const COMIC = new Set(['cbz', 'cbr', 'cb7', 'cbt']);

async function call(path, opts = {}) {
  const res = await fetch(`/portal/ebooks/${path}`, { credentials: 'same-origin', ...opts, headers: { 'X-MediaDesk': '1', ...(opts.headers || {}) } });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// A dialog in the middle of the screen; resolves when closed.
function dialog(title, body, { wide = false } = {}) {
  let done;
  const closed = new Promise((r) => { done = r; });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); done(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const box = h('div', { class: `dialog ebk-kdlg ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title },
    h('div', { class: 'ebk-kdlg-head' }, h('h3', {}, title), h('button', { class: 'btn btn-icon btn-ghost', 'aria-label': 'Close', onclick: close }, '✕')), body);
  const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, box);
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { close, closed, box };
}

// --- Sending a library book to the Kindle app ---------------------------------------------------

export function kindleDialog(app, b) {
  const lib = app.lib || {};
  const calibre = Boolean(lib.tools?.calibre);
  if (b.drm) { toast('This book has DRM', { type: 'error', body: 'It was bought from Amazon, so only the Kindle app it came from can open it.' }); return; }
  // Download: as it is, or made into AZW3 by Calibre on the server.
  const asIs = KINDLE_APP.has(b.format);
  const canDownload = asIs || calibre;
  const fileType = asIs ? (b.format === 'azw3' ? 'AZW3' : b.format === 'mobi' ? 'MOBI' : b.format.toUpperCase()) : 'AZW3';
  // Email: Amazon takes EPUB, PDF, Word, RTF and text; others are converted.
  const emailAsIs = SEND_TO_KINDLE.has(b.format);
  const canEmail = Boolean(lib.sendToKindle) && (emailAsIs || calibre);
  const status = h('div', { class: 'ebk-kstatus', role: 'status' });
  const steps = h('div', { class: 'ebk-ksteps', hidden: true },
    h('b', {}, FIRE ? 'On your Kindle Fire:' : 'On a Kindle Fire or Android tablet:'),
    h('ol', {},
      h('li', {}, 'The book is saved in the ', h('b', {}, 'Download'), ' folder. Open the ', h('b', {}, 'Kindle'), ' app and look in ', h('b', {}, 'Library'), ' (choose “Downloaded”). It usually shows there straight away.'),
      h('li', {}, 'If it doesn’t: open the ', h('b', {}, 'Files'), ' app, go to ', h('b', {}, 'Download'), ', press and hold the book, choose ', h('b', {}, 'Move to'), ' → ', h('b', {}, 'Internal storage'), ' → ', h('b', {}, b.format === 'pdf' ? 'Documents' : 'Books'), '. It then appears in the Kindle app’s library', b.format === 'pdf' ? ' (PDFs under Docs).' : '.'),
      h('li', {}, 'Books copied this way stay on this device only. To have a book on all your Kindle apps, with your place kept in step, use Send to Kindle by email.')));
  const download = h('button', { class: 'btn btn-primary', disabled: !canDownload, onclick: async () => {
    download.disabled = true;
    status.textContent = asIs ? 'Starting the download…' : 'Making a Kindle copy (AZW3) on the server… this can take a minute.';
    try {
      const r = await call(`file/${b.id}/kindle`, { method: 'POST' });
      const a = h('a', { href: `/portal/ebooks/file/${b.id}/kindle`, download: r.name });
      document.body.append(a);
      a.click();
      a.remove();
      status.textContent = `Downloading ${r.name} (${formatBytes(r.size)}).`;
      steps.hidden = false;
    } catch (err) { status.textContent = ''; toastError(err, 'The Kindle copy couldn’t be made'); }
    download.disabled = false;
  } }, '⤓ Download for the Kindle app');
  const send = h('button', { class: 'btn btn-primary', disabled: !canEmail, onclick: async () => {
    send.disabled = true;
    status.textContent = emailAsIs ? `Sending to ${lib.sendToKindle}…` : `Making an ${COMIC.has(b.format) ? 'PDF' : 'EPUB'} copy and sending it to ${lib.sendToKindle}…`;
    try {
      const r = await call(`file/${b.id}/send-to-kindle`, { method: 'POST' });
      status.textContent = '';
      toast(r.demo ? 'Demo: not really sent' : `Sent to ${r.to}`, { type: 'success', timeout: 9000, body: r.demo ? 'In the demo nothing is emailed.' : 'It appears in your Kindle library on every device with the Kindle app in a few minutes. If it doesn’t, check that the sending address is on your Approved Personal Document E-mail List at Amazon.' });
      d.close();
    } catch (err) { status.textContent = ''; toastError(err, 'The book couldn’t be sent'); send.disabled = false; }
  } }, '✉ Send to Kindle');
  const d = dialog(`Send “${b.title}” to Kindle`, h('div', { class: 'ebk-kbody' },
    h('section', { class: 'ebk-kopt' },
      h('h4', {}, '📲 Download for the Kindle app'),
      h('p', { class: 'muted small' }, asIs ? `Saves the ${fileType} file on this device, for the Kindle app to open.` : `Makes a Kindle copy (AZW3) of this ${b.format.toUpperCase()} book and saves it on this device, for the Kindle app to open.`),
      canDownload ? null : h('p', { class: 'ebk-kwarn small' }, `A ${b.format.toUpperCase()} book needs Calibre on the MediaDesk server to become a Kindle book. See Settings → eBook Reader.`),
      h('div', { class: 'btn-row' }, download)),
    h('section', { class: 'ebk-kopt' },
      h('h4', {}, '✉ Send to Kindle by email'),
      h('p', { class: 'muted small' }, lib.sendToKindle ? `Emails it to ${lib.sendToKindle}. Amazon adds it to your Kindle library on every device with the Kindle app, and keeps your place in step.${emailAsIs ? '' : ` (Sent as ${COMIC.has(b.format) ? 'a PDF' : 'an EPUB'}, made by Calibre.)`}` : 'Emails the book to your Send-to-Kindle address, so it appears in your Kindle library on every device. Set it up first.'),
      lib.sendToKindle && !canEmail ? h('p', { class: 'ebk-kwarn small' }, `A ${b.format.toUpperCase()} book needs Calibre on the MediaDesk server before it can be emailed.`) : null,
      h('div', { class: 'btn-row' }, lib.sendToKindle ? send : h('button', { class: 'btn', onclick: () => { d.close(); openApp('settings', { tab: 'ebooks' }); } }, 'Set up Send to Kindle'))),
    status, steps));
  return d;
}

// --- Backing up the books on this device ---------------------------------------------------------

export function backupDialog(app) {
  const lib = app.lib || {};
  if (!lib.configured) { toast('Choose a books folder first', { body: 'In Settings → eBook Reader', type: 'error' }); return; }
  if (!lib.writable) { toast('MediaDesk can’t write to the books folder', { type: 'error' }); return; }
  const folders = lib.folders || [];
  const suggested = FIRE ? 'Kindle Fire' : 'From my device';
  const sel = h('select', { class: 'input' }, h('option', { value: '__new' }, 'A new folder…'), h('option', { value: '' }, 'The books folder itself'), folders.map((f) => h('option', { value: f }, f)));
  sel.value = folders.includes(suggested) ? suggested : '__new';
  const newName = h('input', { class: 'input', value: suggested, 'aria-label': 'New folder name' });
  const showNew = () => { newName.hidden = sel.value !== '__new'; };
  sel.addEventListener('change', showNew);
  showNew();
  const list = h('div', { class: 'ebk-klist' });
  const summary = h('div', { class: 'ebk-kstatus', role: 'status' });
  // Android's file picker greys out files it has no type for (.azw3, .mobi…), so there it shows
  // every file and the books are picked out here.
  const pick = (dir) => {
    const input = h('input', { type: 'file', multiple: true, ...(ANDROID ? {} : { accept: Object.keys(FORMAT_NAMES).map((x) => `.${x}`).join(',') }) });
    if (dir) input.webkitdirectory = true;
    input.onchange = () => run([...input.files]);
    input.click();
  };
  const choose = h('button', { class: 'btn btn-primary', onclick: () => pick(false) }, '📂 Choose books…');
  const chooseDir = 'webkitdirectory' in document.createElement('input') && !ANDROID ? h('button', { class: 'btn', onclick: () => pick(true) }, '🗂 Choose a whole folder…') : null;
  let running = false;
  async function run(files) {
    if (running || !files.length) return;
    running = true;
    choose.disabled = true;
    if (chooseDir) chooseDir.disabled = true;
    const dest = sel.value === '__new' ? newName.value.trim().replace(/[\\/]+/g, ' ') || suggested : sel.value;
    const have = new Map(app.lib.books.map((x) => [`${x.path.split('/').pop().toLowerCase()}|${x.size}`, x]));
    const rows = files.map((f) => {
      const format = formatOf(f.name);
      const status = h('span', { class: 'ebk-kst' });
      const row = h('div', { class: 'ebk-krow' }, h('span', { class: 'ebk-kname' }, f.webkitRelativePath || f.name), h('small', { class: 'muted' }, formatBytes(f.size)), status);
      return { f, format, row, status };
    });
    clear(list, rows.filter((r) => r.format).map((r) => r.row));
    const skipped = rows.filter((r) => !r.format);
    const counts = { added: 0, already: 0, failed: 0, drm: 0 };
    for (const r of rows.filter((x) => x.format)) {
      r.row.scrollIntoView({ block: 'nearest' });
      if (have.has(`${r.f.name.toLowerCase()}|${r.f.size}`)) { r.status.textContent = '✓ Already in the library'; r.row.classList.add('same'); counts.already++; continue; }
      r.status.textContent = 'Uploading…';
      r.row.classList.add('busy');
      try {
        const res = await upload(`/portal/ebooks/upload?${new URLSearchParams({ name: r.f.name, folder: dest })}`, r.f, (p) => { r.status.textContent = `${Math.round(p * 100)}%`; });
        r.row.classList.remove('busy');
        if (res.existed) { r.status.textContent = '✓ Already in the library'; r.row.classList.add('same'); counts.already++; } else { r.status.textContent = res.book?.drm ? '✓ Backed up (has DRM)' : '✓ Backed up'; r.row.classList.add('done'); counts.added++; if (res.book?.drm) counts.drm++; }
      } catch (err) { r.row.classList.remove('busy'); r.row.classList.add('bad'); r.status.textContent = `✕ ${err.message}`; counts.failed++; }
    }
    summary.textContent = [`${counts.added} backed up`, counts.already ? `${counts.already} already in the library` : null, counts.failed ? `${counts.failed} failed` : null, skipped.length ? `${skipped.length} other file${skipped.length === 1 ? '' : 's'} skipped (not books)` : null].filter(Boolean).join(' · ');
    if (counts.drm) summary.append(h('p', { class: 'ebk-kwarn small' }, `${counts.drm} of them ${counts.drm === 1 ? 'has' : 'have'} DRM (bought from Amazon): kept safe on the server, but only the Kindle app can open ${counts.drm === 1 ? 'it' : 'them'}.`));
    app.lib = await call('library?refresh=1').catch(() => app.lib);
    running = false;
    choose.disabled = false;
    if (chooseDir) chooseDir.disabled = false;
    if (counts.added && !app.book) app.showLibrary();
  }
  dialog(FIRE ? 'Back up this Kindle Fire’s books' : 'Back up books from this device', h('div', { class: 'ebk-kbody' },
    h('p', { class: 'small' }, 'Choose books on this device to copy to the MediaDesk server. They’re added to your library, so you can read them in the eBook Reader on any device.'),
    FIRE || ANDROID ? h('div', { class: 'ebk-ksteps' }, h('b', {}, 'Where the books are:'), h('ul', {},
      h('li', {}, 'Books you’ve downloaded or copied onto the tablet are usually in ', h('b', {}, 'Internal storage'), ' → ', h('b', {}, 'Books'), ', ', h('b', {}, 'Documents'), ' or ', h('b', {}, 'Download'), '. Tap ☰ in the picker to find them; you can tick several.'),
      h('li', {}, 'Books bought from Amazon are kept inside the Kindle app, where no other app can reach them, and they’re protected (DRM), so they can’t be backed up this way. They’re already kept by Amazon in your Kindle library.'))) : null,
    h('div', { class: 'ebk-krowfields' }, h('label', { class: 'field' }, h('span', {}, 'Put them in'), sel), newName),
    h('div', { class: 'btn-row' }, choose, chooseDir),
    list, summary), { wide: true });
}

const FORMAT_NAMES = { epub: 1, pdf: 1, mobi: 1, azw: 1, azw3: 1, prc: 1, fb2: 1, txt: 1, rtf: 1, docx: 1, odt: 1, lit: 1, cbz: 1, cbr: 1, cb7: 1, cbt: 1 };

function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.withCredentials = true;
    x.setRequestHeader('X-MediaDesk', '1');
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.responseType = 'json';
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status < 300 ? resolve(x.response) : reject(new Error(x.response?.error || `HTTP ${x.status}`)));
    x.onerror = () => reject(new Error('The upload didn’t get through'));
    x.send(file);
  });
}
