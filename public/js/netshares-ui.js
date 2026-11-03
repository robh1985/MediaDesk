// Network shares (admins): connecting a Windows / NAS share, an NFS export, an SFTP folder or a
// WebDAV folder as one of Files' shared folders. Used by Settings → Files and the Files app.

import { h, clear, toast, toastError, confirmDialog } from './ui.js';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
export const listShares = () => api('/portal/netshares');

export const NET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/></svg>';

const KINDS = [
  ['smb', 'Windows / NAS share', 'SMB: Windows computers, Synology, QNAP, TrueNAS, Unraid, a router’s USB drive…'],
  ['nfs', 'NFS export', 'NAS boxes and Linux servers'],
  ['sftp', 'SFTP (SSH)', 'Any computer you can SSH into, like a Raspberry Pi'],
  ['webdav', 'WebDAV', 'Nextcloud, ownCloud, a NAS’s WebDAV folder'],
];

const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
const input = (attrs = {}) => h('input', { class: 'input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', ...attrs });

// Add (no share) or change one. Resolves with the share once it's connected, or null.
export function shareDialog(share = null, { platform = '' } = {}) {
  return new Promise((resolve) => {
    let type = share?.type || 'smb';
    const name = input({ value: share?.name || '', placeholder: 'Shown in Files (optional)' });
    const host = input({ value: share ? (share.type === 'smb' ? share.host : share.host) : '', placeholder: '' });
    const shareName = input({ value: share?.share || '' });
    const sub = input({ value: share?.path || '', placeholder: 'Optional' });
    const url = input({ value: share?.url || '', placeholder: 'https://cloud.example.com/remote.php/dav/files/me/' });
    const port = input({ value: share?.port || '', inputmode: 'numeric', placeholder: '22' });
    const user = input({ value: share?.username || '', autocomplete: 'off' });
    const domain = input({ value: share?.domain || '', placeholder: 'Optional (WORKGROUP)' });
    const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: share?.hasPassword ? 'Unchanged (saved)' : '' });
    const version = h('select', { class: 'input' });
    const ro = h('input', { type: 'checkbox', checked: Boolean(share?.readOnly) });
    const err = h('div', { class: 'notice notice-warn', hidden: true });
    const kinds = h('div', { class: 'ns-kinds' });
    const fields = h('div', {});
    const versions = { smb: [['auto', 'Automatic'], ['3.1.1', 'SMB 3.1.1'], ['3.0', 'SMB 3.0'], ['2.1', 'SMB 2.1'], ['2.0', 'SMB 2.0'], ['1.0', 'SMB 1 (old devices only)']], nfs: [['auto', 'Automatic'], ['4.2', 'NFS 4.2'], ['4.1', 'NFS 4.1'], ['4', 'NFS 4'], ['3', 'NFS 3']] };
    const draw = () => {
      clear(kinds, KINDS.map(([id, label, hint]) => h('button', { type: 'button', class: `ns-kind ${id === type ? 'on' : ''}`, disabled: Boolean(share), onclick: () => { type = id; draw(); } }, h('b', {}, label), h('small', {}, hint))));
      clear(version, (versions[type] || []).map(([v, l]) => h('option', { value: v, selected: (share?.version || 'auto') === v }, l)));
      const winNote = platform === 'win32' && type !== 'smb' ? h('div', { class: 'notice' }, 'On a Windows server, connect this kind of share in Windows itself, then add its drive as a shared folder.') : null;
      if (type === 'smb') {
        host.placeholder = 'nas, 192.168.1.20 or \\\\nas\\media';
        shareName.placeholder = 'media';
        clear(fields, winNote,
          h('div', { class: 'field-row' }, field('Server', host, 'Its name or address. You can paste \\\\server\\share\\folder here.'), field('Share', shareName)),
          field('Folder in the share', sub, 'To show just one folder of the share'),
          h('div', { class: 'field-row' }, field('User name', user, 'Blank for a guest share'), field('Password', pw)),
          h('div', { class: 'field-row' }, field('Domain', domain), field('Version', version)));
      } else if (type === 'nfs') {
        host.placeholder = 'nas or 192.168.1.20';
        shareName.placeholder = '/volume1/media';
        clear(fields, winNote,
          h('div', { class: 'field-row' }, field('Server', host), field('Export path', shareName, 'You can also type server:/path in Server')),
          field('Version', version),
          h('p', { class: 'small muted' }, 'NFS has no password: the NAS has to allow the MediaDesk server’s address (in its NFS permissions).'));
      } else if (type === 'sftp') {
        host.placeholder = 'raspberrypi.local or pi@192.168.1.30';
        shareName.placeholder = '/home/pi/media';
        clear(fields, winNote,
          h('div', { class: 'field-row' }, field('Server', host), field('Port', port)),
          field('Folder', shareName, 'Blank for the home folder'),
          h('div', { class: 'field-row' }, field('User name', user), field('Password', pw, 'Blank to use the MediaDesk server’s SSH key')));
      } else {
        clear(fields, winNote,
          field('Address', url, 'Nextcloud: Files → Settings (bottom left) → WebDAV'),
          h('div', { class: 'field-row' }, field('User name', user), field('Password', pw, 'For Nextcloud, an app password')));
      }
    };
    draw();
    const done = (v) => { overlay.remove(); resolve(v); };
    const go = h('button', { type: 'submit', class: 'btn btn-primary' }, share ? 'Save and reconnect' : 'Connect');
    const box = h('form', { class: 'dialog us-dialog wide ns-dialog', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      go.disabled = true;
      go.textContent = 'Connecting…';
      const body = { type, name: name.value.trim(), host: host.value.trim(), share: shareName.value.trim(), path: sub.value.trim(), url: url.value.trim(), port: port.value.trim(), username: user.value.trim(), domain: domain.value.trim(), version: version.value, readOnly: ro.checked, ...(pw.value ? { password: pw.value } : {}) };
      try {
        const r = await api(share ? `/portal/netshares/${share.id}` : '/portal/netshares', { method: share ? 'PUT' : 'POST', body });
        toast(share ? 'Network share saved' : `Connected “${r.share.name}”`, { type: 'success', body: share ? '' : 'It’s in Files under Shared folders.' });
        done(r.share);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        go.disabled = false;
        go.textContent = share ? 'Save and reconnect' : 'Connect';
      }
    } },
    h('h3', {}, share ? `Change “${share.name}”` : 'Connect a network share'),
    h('div', { class: 'us-body' },
      kinds, fields,
      h('div', { class: 'field-row' }, field('Name', name), h('label', { class: 'check ns-ro' }, ro, ' Read-only (Files can’t change anything in it)')),
      err),
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Cancel'), go));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, box);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);
    setTimeout(() => (type === 'webdav' ? url : host).focus(), 30);
  });
}

// The list, with Connect, Change, Reconnect and Remove (for Settings → Files).
export function sharesSection(onChange) {
  const box = h('div', { class: 'ns-list' }, h('div', { class: 'small muted' }, 'Loading…'));
  let platform = '';
  const draw = async () => {
    let data;
    try { data = await listShares(); } catch (err) { clear(box, h('div', { class: 'notice' }, err.message)); return; }
    platform = data.platform;
    clear(box,
      data.shares.length ? data.shares.map((s) => h('div', { class: `ns-row ${s.status}` },
        h('span', { class: 'ns-icon', html: NET_ICON }),
        h('div', { class: 'grow' },
          h('b', {}, s.name), h('span', { class: `ns-status ${s.status}` }, s.status === 'connected' ? 'Connected' : s.status === 'connecting' ? 'Connecting…' : 'Not connected'),
          h('div', { class: 'small muted' }, `${s.typeName} · ${s.label}${s.username ? ` · as ${s.username}` : ''}${s.readOnly ? ' · read-only' : ''}`),
          s.status !== 'connected' && s.error ? h('div', { class: 'small ns-err' }, s.error) : null),
        h('div', { class: 'btn-row' },
          s.status !== 'connected' ? h('button', { class: 'btn btn-sm', onclick: async (e) => { e.target.disabled = true; try { await api(`/portal/netshares/${s.id}/reconnect`, { method: 'POST' }); toast(`“${s.name}” connected`, { type: 'success', timeout: 2000 }); } catch (err) { toastError(err, 'Not connected'); } draw(); onChange?.(); } }, 'Reconnect') : null,
          h('button', { class: 'btn btn-sm', onclick: async () => { if (await shareDialog(s, { platform })) { draw(); onChange?.(); } } }, 'Change'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
            if (!await confirmDialog({ title: `Disconnect “${s.name}”?`, message: 'It goes from Files’ shared folders. Nothing on the share is deleted.', confirm: 'Disconnect', danger: true })) return;
            try { await api(`/portal/netshares/${s.id}`, { method: 'DELETE' }); toast(`“${s.name}” disconnected`, { timeout: 2000 }); } catch (err) { toastError(err); }
            draw(); onChange?.();
          } }, 'Remove')))) : h('div', { class: 'small muted' }, 'No network shares yet.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: async () => { if (await shareDialog(null, { platform })) { draw(); onChange?.(); } } }, h('span', { html: NET_ICON, class: 'ns-btnicon' }), 'Connect a network share…')));
  };
  draw();
  return box;
}
