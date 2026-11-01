// Trip Planner: files. Tickets, confirmations, photos and documents for the trip: dropped in,
// previewed, linked to a place, booking or cost, and put in the bin before they're gone for good.

import { h, clear, toast, toastError, confirmDialog, formatBytes } from '../../ui.js';
import { sheet, field, select, emptyState, fmtDay, tripDays } from './util.js';

const kindOf = (f) => (/^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : f.type === 'application/pdf' ? 'pdf' : 'file');
const ICON = { image: '🖼️', video: '🎬', pdf: '📄', file: '📎' };

export class FilesView {
  constructor(app) { this.app = app; this.store = app.store; this.show = 'all'; }

  render(el) {
    this.el = el;
    const all = this.store.all('files').sort((a, b) => (b.created || 0) - (a.created || 0));
    const live = all.filter((f) => !f.deleted);
    const bin = all.filter((f) => f.deleted);
    const shown = this.show === 'bin' ? bin : this.show === 'all' ? live : live.filter((f) => kindOf(f) === this.show);
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => this.upload([...fileIn.files]) });
    this.progress = h('div', { class: 'tp-upload', hidden: true });
    const page = h('div', { class: 'tp-page tp-files' },
      h('div', { class: 'tp-page-head' },
        h('div', { class: 'tp-seg' }, [['all', 'All'], ['image', 'Photos'], ['pdf', 'PDFs'], ['file', 'Other'], ['bin', `Bin (${bin.length})`]].map(([k, l]) => h('button', { class: this.show === k ? 'on' : '', onclick: () => { this.show = k; this.render(el); } }, l))),
        h('span', { class: 'tp-grow' }),
        this.show === 'bin' && bin.length ? h('button', { class: 'btn btn-danger', onclick: () => this.emptyBin(bin) }, 'Empty the bin') : null,
        h('button', { class: 'btn btn-primary', onclick: () => fileIn.click() }, '⤒ Upload'), fileIn),
      this.progress,
      shown.length ? h('div', { class: 'tp-file-grid' }, shown.map((f) => this.tile(f)))
        : emptyState(this.show === 'bin' ? '🗑️' : '📎', this.show === 'bin' ? 'The bin is empty.' : 'No files yet. Drop tickets, confirmations and photos here.'));
    page.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); page.classList.add('drop-on'); } });
    page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove('drop-on'); });
    page.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); page.classList.remove('drop-on'); this.upload([...e.dataTransfer.files]); });
    clear(el, page);
  }

  linkLabel(f) {
    if (f.placeId) return `📍 ${this.store.get('places', f.placeId)?.name || 'A place'}`;
    if (f.bookingId) return `🎫 ${this.store.get('bookings', f.bookingId)?.title || 'A booking'}`;
    if (f.expenseId) return `💶 ${this.store.get('expenses', f.expenseId)?.title || 'A cost'}`;
    if (f.day) return `🗓 ${fmtDay(f.day)}`;
    return null;
  }

  tile(f) {
    const k = kindOf(f);
    const url = this.store.fileUrl(f.id);
    return h('div', { class: 'tp-file' },
      h('button', { class: 'tp-file-thumb', onclick: () => this.preview(f), style: k === 'image' ? { backgroundImage: `url("${url}")` } : {} }, k === 'image' ? null : h('span', {}, ICON[k])),
      h('div', { class: 'tp-file-info' }, h('b', { title: f.name }, f.name), h('small', { class: 'muted' }, [formatBytes(f.size || 0), this.linkLabel(f)].filter(Boolean).join(' · '))),
      h('div', { class: 'tp-file-tools' }, f.deleted
        ? [h('button', { class: 'btn btn-sm', onclick: () => this.store.put('files', { ...f, deleted: false }, { label: 'restore' }).catch(toastError) }, 'Restore'), h('button', { class: 'btn btn-sm btn-danger', onclick: () => this.purge([f]) }, 'Delete')]
        : [h('a', { class: 'btn btn-sm', href: this.store.fileUrl(f.id, true) }, '⤓'), h('button', { class: 'btn btn-sm', onclick: () => this.link(f) }, 'Link'), h('button', { class: 'btn btn-sm', 'aria-label': 'Move to the bin', onclick: () => this.store.put('files', { ...f, deleted: true }, { label: 'move to bin' }).catch(toastError) }, '🗑')]));
  }

  async upload(files) {
    this.progress.hidden = false;
    for (const [i, f] of files.entries()) {
      this.progress.textContent = `Uploading ${f.name} (${i + 1} of ${files.length})…`;
      try { await this.store.upload(f, {}, (p) => { this.progress.textContent = `Uploading ${f.name} — ${Math.round(p * 100)}%`; }); } catch (err) { toastError(err, `${f.name} wasn’t uploaded`); }
    }
    if (this.progress.isConnected) this.progress.hidden = true;
  }

  preview(f) {
    const k = kindOf(f);
    const url = this.store.fileUrl(f.id);
    const body = k === 'image' ? h('img', { src: url, alt: f.name, class: 'tp-preview' }) : k === 'video' ? h('video', { src: url, controls: true, class: 'tp-preview' }) : k === 'pdf' ? h('iframe', { src: url, class: 'tp-preview pdf', title: f.name }) : h('p', {}, h('a', { href: this.store.fileUrl(f.id, true) }, `Download ${f.name}`));
    sheet(this.app.root, { title: f.name, body, wide: true, cls: 'tp-preview-sheet', actions: [{ label: 'Open in a new tab', onClick: () => window.open(url, '_blank', 'noopener') }, { label: 'Close', primary: true }] });
  }

  async link(f) {
    const opts = [['', 'Not linked'],
      ...this.store.all('places').map((p) => [`placeId:${p.id}`, `📍 ${p.name}`]),
      ...this.store.all('bookings').map((b) => [`bookingId:${b.id}`, `🎫 ${b.title}`]),
      ...this.store.all('expenses').map((e) => [`expenseId:${e.id}`, `💶 ${e.title}`]),
      ...tripDays(this.store.trip).map((d, i) => [`day:${d}`, `🗓 Day ${i + 1} · ${fmtDay(d)}`])];
    const cur = ['placeId', 'bookingId', 'expenseId', 'day'].find((k) => f[k]);
    const sel = select(opts, cur ? `${cur}:${f[cur]}` : '');
    const r = await sheet(this.app.root, { title: 'Link the file', body: field('To', sel), actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, value: true }] });
    if (!r) return;
    const [k, v] = sel.value.split(/:(.*)/);
    this.store.put('files', { ...f, placeId: null, bookingId: null, expenseId: null, day: null, ...(k ? { [k]: v } : {}) }, { label: 'link file' }).catch(toastError);
  }

  async purge(files) {
    if (!await confirmDialog({ title: files.length > 1 ? `Delete ${files.length} files for good?` : `Delete “${files[0].name}” for good?`, message: 'This can’t be undone.', confirm: 'Delete', danger: true })) return;
    await this.store.batch(files.map((f) => ({ op: 'delete', col: 'files', id: f.id })), { undoable: false }).catch(toastError);
    toast('Deleted', { timeout: 1500 });
  }
  emptyBin(bin) { this.purge(bin); }
}
