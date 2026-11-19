// Network shares (admins): connecting a Windows / NAS share, an NFS export, an SFTP folder, a
// WebDAV folder or cloud storage (Google Drive, OneDrive, iCloud Drive, Dropbox…, through rclone on
// the server) as one of Files' shared folders. Used by Settings → Files and the Files app.

import { h, clear, toast, toastError, confirmDialog } from './ui.js';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
export const listShares = () => api('/portal/netshares');

export const NET_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/></svg>';

export const CLOUD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/></svg>';

// Cloud services (cloudstorage.js on the server) and how each one signs in.
const CLOUDS = [
  ['gdrive', 'Google Drive', 'Sign in with your Google account', 'oauth'],
  ['onedrive', 'OneDrive', 'Personal or work / school (Microsoft 365)', 'oauth'],
  ['icloud', 'iCloud Drive', 'Apple ID, password and a code from your iPhone', 'apple'],
  ['dropbox', 'Dropbox', 'Sign in with your Dropbox account', 'oauth'],
  ['box', 'Box', 'Sign in with your Box account', 'oauth'],
  ['pcloud', 'pCloud', 'Sign in with your pCloud account', 'oauth'],
  ['mega', 'MEGA', 'Email and password', 'password'],
  ['s3', 'S3-compatible', 'Amazon S3, Backblaze B2, Cloudflare R2, Wasabi, MinIO…', 'keys'],
];
const CLOUD = Object.fromEntries(CLOUDS.map(([id, name, hint, auth]) => [id, { name, hint, auth }]));
export const isCloudType = (t) => Boolean(CLOUD[t]);

// How to add rclone (and FUSE) to the server, for the platform it runs on.
function rcloneHelp(platform) {
  const code = (t) => h('code', {}, t);
  if (platform === 'win32') return h('span', {}, 'Cloud storage needs two free programs on the MediaDesk computer. In PowerShell run ', code('winget install Rclone.Rclone'), ' and ', code('winget install WinFsp.WinFsp'), ', then restart MediaDesk (restart-windows.cmd).');
  if (platform === 'darwin') return h('span', {}, 'Cloud storage needs rclone and macFUSE on the MediaDesk Mac: ', code('brew install rclone'), ' and ', code('brew install --cask macfuse'), ', then restart MediaDesk.');
  return h('span', {}, 'Cloud storage needs rclone and FUSE on the MediaDesk server: ', code('sudo apt install fuse3'), ' and ', code('sudo -v ; curl https://rclone.org/install.sh | sudo bash'), ' (the packaged rclone is often too old for iCloud). The Docker image includes both; give the container /dev/fuse (see docker-compose.yml). Then restart MediaDesk.');
}

const KINDS = [
  ['smb', 'Windows / NAS share', 'SMB: Windows computers, Synology, QNAP, TrueNAS, Unraid, a router’s USB drive…'],
  ['nfs', 'NFS export', 'NAS boxes and Linux servers'],
  ['sftp', 'SFTP (SSH)', 'Any computer you can SSH into, like a Raspberry Pi'],
  ['webdav', 'WebDAV', 'Nextcloud, ownCloud, a NAS’s WebDAV folder'],
];

const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
const input = (attrs = {}) => h('input', { class: 'input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', ...attrs });

// Add (no share) or change one. Resolves with the share once it's connected, or null.
// `kind` picks the first choice: 'cloud' (or a cloud service's id) opens on cloud storage.
export function shareDialog(share = null, { platform = '', cloud = null, kind = '' } = {}) {
  return new Promise((resolve) => {
    let type = share?.type || (CLOUD[kind] ? kind : kind === 'cloud' ? 'gdrive' : 'smb');
    let group = isCloudType(type) ? 'cloud' : 'network';
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
    const groups = h('div', { class: 'ns-groups', role: 'tablist' });
    const kinds = h('div', { class: 'ns-kinds' });
    const fields = h('div', {});
    // Cloud storage
    const folder = input({ value: share?.path || '', placeholder: 'Optional: just one folder, like Photos/2024' });
    const cpw = input({ type: 'password', autocomplete: 'new-password', placeholder: share?.cloud ? 'Unchanged (saved)' : '' });
    const account = input({ value: share?.cloud ? share.username : '', autocomplete: 'off', placeholder: '' });
    const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, placeholder: '123456', class: 'input ns-code' });
    const bucket = input({ value: share?.bucket || '', placeholder: 'my-bucket' });
    const endpoint = input({ value: share?.endpoint || '', placeholder: 'Blank for Amazon S3, or https://s3.eu-central-003.backblazeb2.com' });
    const region = input({ value: share?.region || '', placeholder: 'Optional (us-east-1)' });
    const accessKey = input({ placeholder: share?.cloud ? 'Unchanged (saved)' : '' });
    const secretKey = input({ type: 'password', autocomplete: 'new-password', placeholder: share?.cloud ? 'Unchanged (saved)' : '' });
    const clientId = input({ placeholder: 'Optional' });
    const clientSecret = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Optional' });
    const signIn = h('div', { class: 'ns-signin' });
    let auth = null; // { id, url, status }
    let pendingCode = null; // iCloud: waiting for the two-factor code
    let pollTimer = null;
    const versions = { smb: [['auto', 'Automatic'], ['3.1.1', 'SMB 3.1.1'], ['3.0', 'SMB 3.0'], ['2.1', 'SMB 2.1'], ['2.0', 'SMB 2.0'], ['1.0', 'SMB 1 (old devices only)']], nfs: [['auto', 'Automatic'], ['4.2', 'NFS 4.2'], ['4.1', 'NFS 4.1'], ['4', 'NFS 4'], ['3', 'NFS 3']] };
    const stopPoll = () => { clearInterval(pollTimer); pollTimer = null; };
    const cancelAuth = () => { stopPoll(); if (auth && auth.status !== 'done') api(`/portal/netshares/cloud/auth/${auth.id}`, { method: 'DELETE' }).catch(() => {}); auth = null; };

    // The sign-in steps for a service that signs in in the browser.
    const drawSignIn = () => {
      const svc = CLOUD[type];
      if (auth?.status === 'done') {
        clear(signIn, h('div', { class: 'ns-signed' }, '✓ Signed in to ', svc.name, '. Press Connect to finish.'));
        go.disabled = false;
        return;
      }
      if (!auth) {
        clear(signIn,
          h('button', { type: 'button', class: 'btn btn-primary', onclick: startSignIn }, share ? `Sign in to ${svc.name} again` : `Sign in to ${svc.name}…`),
          share ? h('div', { class: 'small muted' }, 'Only needed if it says it wants you to sign in again. Otherwise just save.') : null);
        go.disabled = !share;
        return;
      }
      const pasted = input({ placeholder: 'http://127.0.0.1:53682/?state=…&code=…' });
      const send = h('button', { type: 'button', class: 'btn' }, 'Continue');
      send.onclick = async () => {
        send.disabled = true;
        err.hidden = true;
        try { auth = { ...auth, ...(await api(`/portal/netshares/cloud/auth/${auth.id}`, { method: 'POST', body: { url: pasted.value } })) }; stopPoll(); drawSignIn(); } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
      };
      clear(signIn,
        h('ol', { class: 'ns-steps small' },
          h('li', {}, 'In the tab that opened, sign in to ', svc.name, ' and allow rclone access. ', h('a', { href: auth.url, target: '_blank', rel: 'noopener' }, 'Open it again')),
          h('li', {}, 'You’re sent to an address starting with ', h('code', {}, 'http://127.0.0.1:53682'), '. If you’re on the MediaDesk computer itself, that finishes it and this dialog moves on by itself. Otherwise the page won’t load: that’s expected. Copy its address from the address bar and paste it here:')),
        h('div', { class: 'ns-paste' }, pasted, send),
        h('div', { class: 'small muted ns-wait' }, h('span', { class: 'spinner sm' }), ' Waiting for the sign-in…'));
      go.disabled = true;
    };
    async function startSignIn(e) {
      const btn = e?.currentTarget;
      if (btn) btn.disabled = true;
      err.hidden = true;
      const tab = window.open('about:blank', '_blank'); // opened now, while the click still counts
      try {
        const r = await api('/portal/netshares/cloud/auth', { method: 'POST', body: { provider: type, clientId: clientId.value.trim(), clientSecret: clientSecret.value.trim() } });
        auth = { ...r, status: 'waiting' };
        if (tab) { tab.opener = null; tab.location.href = r.url; } else window.open(r.url, '_blank', 'noopener');
        stopPoll();
        pollTimer = setInterval(async () => {
          if (!auth || !overlay.isConnected) return stopPoll();
          try {
            const st = await api(`/portal/netshares/cloud/auth/${auth.id}`);
            if (st.status === 'done') { auth.status = 'done'; stopPoll(); drawSignIn(); }
            else if (st.status !== 'waiting') { stopPoll(); auth = null; drawSignIn(); err.textContent = st.error || 'The sign-in ended. Try again.'; err.hidden = false; }
          } catch { /* try again next time */ }
        }, 2000);
        drawSignIn();
      } catch (ex) {
        tab?.close();
        err.textContent = ex.message;
        err.hidden = false;
        if (btn) btn.disabled = false;
      }
    }

    const draw = () => {
      clear(groups,
        h('button', { type: 'button', role: 'tab', class: `ns-group ${group === 'cloud' ? 'on' : ''}`, disabled: Boolean(share) && group !== 'cloud', onclick: () => { if (group !== 'cloud') { group = 'cloud'; type = 'gdrive'; cancelAuth(); pendingCode = null; draw(); } } }, h('span', { html: CLOUD_ICON }), 'Cloud storage'),
        h('button', { type: 'button', role: 'tab', class: `ns-group ${group === 'network' ? 'on' : ''}`, disabled: Boolean(share) && group !== 'network', onclick: () => { if (group !== 'network') { group = 'network'; type = 'smb'; cancelAuth(); pendingCode = null; draw(); } } }, h('span', { html: NET_ICON }), 'Network share'));
      const list = group === 'cloud' ? CLOUDS.map(([id, label, hint]) => [id, label, hint]) : KINDS;
      clear(kinds, list.map(([id, label, hint]) => h('button', { type: 'button', class: `ns-kind ${id === type ? 'on' : ''}`, disabled: Boolean(share), onclick: () => { if (type !== id) { cancelAuth(); pendingCode = null; } type = id; draw(); } }, h('b', {}, label), h('small', {}, hint))));
      clear(version, (versions[type] || []).map(([v, l]) => h('option', { value: v, selected: (share?.version || 'auto') === v }, l)));
      go.disabled = false;
      if (group === 'cloud') {
        const svc = CLOUD[type];
        const missing = cloud && !cloud.available ? h('div', { class: 'notice notice-warn' }, rcloneHelp(platform)) : null;
        const folderField = field('Folder', folder, `To show just one folder of your ${svc.name}`);
        if (svc.auth === 'oauth') {
          drawSignIn();
          clear(fields, missing, signIn, folderField,
            type === 'gdrive'
              ? h('details', { class: 'ns-adv', open: true }, h('summary', { class: 'small' }, 'Use your own Google client ID (recommended)'),
                h('p', { class: 'small muted' }, 'rclone’s shared Google app is being retired during 2026, so make your own (free, about 5 minutes) and enter it here before signing in. It’s kept on the MediaDesk server only.'),
                h('ol', { class: 'ns-steps small' },
                  h('li', {}, 'Go to ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'console.cloud.google.com'), ' and create a project (any name, like MediaDesk).'),
                  h('li', {}, 'APIs & Services → Library: find ', h('b', {}, 'Google Drive API'), ' and press Enable.'),
                  h('li', {}, 'Google Auth Platform (OAuth consent screen): Get started, app name MediaDesk, your email, Audience ', h('b', {}, 'External'), '. Then under Audience press ', h('b', {}, 'Publish app'), ' (in Testing, Google signs you out every 7 days). You don’t need Google to verify it.'),
                  h('li', {}, 'Clients → Create client: type ', h('b', {}, 'Desktop app'), '. Copy the client ID and secret into these boxes, then press Sign in above. Google warns the app isn’t verified: choose Advanced → Go to MediaDesk.')),
                h('div', { class: 'field-row' }, field('Client ID', clientId), field('Client secret', clientSecret)))
              : h('details', { class: 'ns-adv' }, h('summary', { class: 'small' }, 'Use your own app registration (optional)'),
                h('p', { class: 'small muted' }, `MediaDesk signs in with rclone’s shared ${svc.name} app, which needs no set-up. If ${svc.name} limits it, register your own app and enter its client ID and secret before signing in (rclone.org/${{ onedrive: 'onedrive', dropbox: 'dropbox', box: 'box', pcloud: 'pcloud' }[type]}/ shows how). They’re kept on the server only.`),
                h('div', { class: 'field-row' }, field('Client ID', clientId), field('Client secret', clientSecret))));
        } else if (svc.auth === 'apple') {
          account.placeholder = 'you@icloud.com';
          clear(fields, missing,
            pendingCode
              ? h('div', {}, field('Code', code, 'The 6-digit code Apple just sent to your iPhone, iPad or Mac'))
              : h('div', {},
                h('div', { class: 'field-row' }, field('Apple ID', account), field('Password', cpw, share ? 'Only to sign in again' : 'Your Apple ID password')),
                h('div', { class: 'notice small ns-note' },
                  h('b', {}, 'Before you connect: '),
                  'Apple has no official way for other apps to use iCloud Drive, so MediaDesk (through rclone) signs in the way icloud.com does. On your iPhone, open Settings → your name → iCloud, turn ', h('b', {}, 'Advanced Data Protection'), ' off and ', h('b', {}, 'Access iCloud Data on the Web'), ' on. Apple asks for a new code about once a month: Files then says to sign in again.')),
            folderField);
          if (pendingCode) setTimeout(() => code.focus(), 30);
        } else if (svc.auth === 'password') {
          account.placeholder = 'you@example.com';
          clear(fields, missing, h('div', { class: 'field-row' }, field('Email', account), field('Password', cpw)), folderField,
            h('p', { class: 'small muted' }, 'If your MEGA account has two-step sign-in, turn it off or use another account: rclone can’t enter MEGA codes.'));
        } else {
          clear(fields, missing,
            h('div', { class: 'field-row' }, field('Endpoint', endpoint, 'The provider’s S3 address'), field('Region', region)),
            h('div', { class: 'field-row' }, field('Access key', accessKey), field('Secret key', secretKey)),
            h('div', { class: 'field-row' }, field('Bucket', bucket), field('Folder', folder, 'Optional')));
        }
        name.placeholder = svc.name;
        go.textContent = pendingCode ? 'Verify and connect' : share ? 'Save and reconnect' : 'Connect';
        return;
      }
      name.placeholder = 'Shown in Files (optional)';
      go.textContent = share ? 'Save and reconnect' : 'Connect';
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
    const done = (v) => { cancelAuth(); overlay.remove(); resolve(v); };
    const go = h('button', { type: 'submit', class: 'btn btn-primary' }, share ? 'Save and reconnect' : 'Connect');
    const box = h('form', { class: 'dialog us-dialog wide ns-dialog', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      const label = go.textContent;
      go.disabled = true;
      go.textContent = 'Connecting…';
      let body;
      if (group === 'cloud') {
        body = { type, name: name.value.trim(), readOnly: ro.checked, path: folder.value.trim() };
        if (pendingCode) Object.assign(body, { pending: pendingCode, code: code.value.trim() });
        else if (CLOUD[type].auth === 'oauth') { if (auth?.status === 'done') body.authId = auth.id; }
        else if (CLOUD[type].auth === 'keys') Object.assign(body, { bucket: bucket.value.trim(), endpoint: endpoint.value.trim(), region: region.value.trim(), accessKey: accessKey.value.trim(), secretKey: secretKey.value });
        else Object.assign(body, { username: account.value.trim(), appleId: account.value.trim(), ...(cpw.value ? { password: cpw.value } : {}) });
      } else {
        body = { type, name: name.value.trim(), host: host.value.trim(), share: shareName.value.trim(), path: sub.value.trim(), url: url.value.trim(), port: port.value.trim(), username: user.value.trim(), domain: domain.value.trim(), version: version.value, readOnly: ro.checked, ...(pw.value ? { password: pw.value } : {}) };
      }
      try {
        const r = await api(share ? `/portal/netshares/${share.id}` : '/portal/netshares', { method: share ? 'PUT' : 'POST', body });
        if (r.needCode) { pendingCode = r.pending; cpw.value = ''; draw(); return; }
        if (auth) auth = null; // used up by the server
        toast(share ? (group === 'cloud' ? 'Cloud storage saved' : 'Network share saved') : `Connected “${r.share.name}”`, { type: 'success', body: share ? '' : 'It’s in Files under Shared folders.' });
        done(r.share);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        go.disabled = false;
        go.textContent = label;
        if (/saved: press Reconnect/.test(ex.message)) { auth = null; go.textContent = 'Close'; go.onclick = (ev) => { ev.preventDefault(); done({ id: null }); }; }
      }
    } },
    h('h3', {}, share ? `Change “${share.name}”` : 'Connect a network share or cloud storage'),
    h('div', { class: 'us-body' },
      groups, kinds, fields,
      h('div', { class: 'field-row' }, field('Name', name), h('label', { class: 'check ns-ro' }, ro, ' Read-only (Files can’t change anything in it)')),
      err),
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Cancel'), go));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, box);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    draw();
    document.body.append(overlay);
    setTimeout(() => (group === 'cloud' ? null : type === 'webdav' ? url : host)?.focus(), 30);
  });
}

// The list, with Connect, Change, Reconnect and Remove (for Settings → Files).
export function sharesSection(onChange) {
  const box = h('div', { class: 'ns-list' }, h('div', { class: 'small muted' }, 'Loading…'));
  let platform = '', cloud = null;
  const draw = async () => {
    let data;
    try { data = await listShares(); } catch (err) { clear(box, h('div', { class: 'notice' }, err.message)); return; }
    platform = data.platform;
    cloud = data.cloud || null;
    clear(box,
      data.shares.length ? data.shares.map((s) => h('div', { class: `ns-row ${s.status}` },
        h('span', { class: 'ns-icon', html: s.cloud ? CLOUD_ICON : NET_ICON }),
        h('div', { class: 'grow' },
          h('b', {}, s.name), h('span', { class: `ns-status ${s.status}` }, s.status === 'connected' ? 'Connected' : s.status === 'connecting' ? 'Connecting…' : 'Not connected'),
          h('div', { class: 'small muted' }, s.cloud ? `${s.label}${s.readOnly ? ' · read-only' : ''}` : `${s.typeName} · ${s.label}${s.username ? ` · as ${s.username}` : ''}${s.readOnly ? ' · read-only' : ''}`),
          s.status !== 'connected' && s.error ? h('div', { class: 'small ns-err' }, s.error) : null,
          s.warning ? h('div', { class: 'small ns-warn' }, s.warning) : null,
          s.cloud && s.offline?.mode !== 'off' ? h('div', { class: `small ${s.offline.ok === false ? 'ns-err' : 'muted'}` }, offlineStatus(s.offline), s.offline.ok === false && s.offline.error ? `: ${s.offline.error}` : '') : null),
        h('div', { class: 'btn-row' },
          s.status !== 'connected' ? h('button', { class: 'btn btn-sm', onclick: async (e) => { e.target.disabled = true; try { await api(`/portal/netshares/${s.id}/reconnect`, { method: 'POST' }); toast(`“${s.name}” connected`, { type: 'success', timeout: 2000 }); } catch (err) { toastError(err, 'Not connected'); } draw(); onChange?.(); } }, 'Reconnect') : null,
          s.cloud && s.offline?.mode !== 'off' ? h('button', { class: 'btn btn-sm', disabled: s.offline.running, onclick: async (e) => { e.target.disabled = true; try { await syncNow(s.id, s.offline.tooMany); toast(s.offline.tooMany ? 'Syncing anyway' : 'Syncing', { timeout: 2000 }); } catch (err) { toastError(err, 'Couldn’t sync'); } setTimeout(draw, 1500); } }, s.offline.tooMany ? 'Sync anyway' : 'Sync now') : null,
          s.cloud ? h('button', { class: 'btn btn-sm', onclick: async () => { if (await offlineDialog(s)) { draw(); onChange?.(); } } }, 'Offline copy…') : null,
          h('button', { class: 'btn btn-sm', onclick: async () => { if (await shareDialog(s, { platform, cloud })) { draw(); onChange?.(); } } }, 'Change'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
            if (!await confirmDialog({ title: `Disconnect “${s.name}”?`, message: s.cloud ? `It goes from Files’ shared folders and MediaDesk forgets the sign-in. Nothing in your ${s.typeName} is deleted${s.offline?.mode !== 'off' ? `, and the offline copy’s files stay in ${s.offline.dest}` : ''}.` : 'It goes from Files’ shared folders. Nothing on the share is deleted.', confirm: 'Disconnect', danger: true })) return;
            try { await api(`/portal/netshares/${s.id}`, { method: 'DELETE' }); toast(`“${s.name}” disconnected`, { timeout: 2000 }); } catch (err) { toastError(err); }
            draw(); onChange?.();
          } }, 'Remove')))) : h('div', { class: 'small muted' }, 'No network shares or cloud storage yet.'),
      cloud && !cloud.available ? h('div', { class: 'notice notice-warn small' }, rcloneHelp(platform)) : null,
      cloud && (cloud.available || data.shares.some((s) => s.cloud)) ? cacheSettings(cloud, () => { draw(); onChange?.(); }) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: async () => { if (await shareDialog(null, { platform, cloud, kind: 'cloud' })) { draw(); onChange?.(); } } }, h('span', { html: CLOUD_ICON, class: 'ns-btnicon' }), 'Connect cloud storage…'),
        h('button', { class: 'btn', onclick: async () => { if (await shareDialog(null, { platform, cloud })) { draw(); onChange?.(); } } }, h('span', { html: NET_ICON, class: 'ns-btnicon' }), 'Connect a network share…')));
  };
  draw();
  return box;
}

// ---- Offline copies and the cloud cache ----

const EVERY = [[15, 'Every 15 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Once a day'], [0, 'Only when I press Sync now']];
const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleString(); };
export function offlineStatus(o) {
  if (!o || o.mode === 'off') return '';
  const what = o.mode === 'all' ? 'everything' : `${o.paths.length} item${o.paths.length === 1 ? '' : 's'}`;
  const st = o.running ? 'syncing now…' : o.ok === false ? `last sync failed${o.lastAt ? ` ${ago(o.lastAt)}` : ''}` : o.lastAt ? `in sync ${ago(o.lastAt)}` : 'not synced yet';
  return `Offline copy of ${what} · ${st}`;
}

// Keep an offline copy (both ways) of all of a cloud folder, or of chosen files and folders in it.
export function offlineDialog(share) {
  return new Promise((resolve) => {
    const o = share.offline || { mode: 'off', paths: [], every: 60, dest: '', defaultDest: '' };
    let mode = o.mode || 'off';
    let paths = [...(o.paths || [])];
    const dest = input({ value: o.dest || o.defaultDest, placeholder: o.defaultDest });
    const every = h('select', { class: 'input' }, EVERY.map(([v, l]) => h('option', { value: v, selected: Number(o.every ?? 60) === v }, l)));
    const add = input({ placeholder: 'Photos/2024/   or   Documents/Taxes.pdf' });
    const err = h('div', { class: 'notice notice-warn', hidden: true });
    const modes = h('div', { class: 'ns-kinds' });
    const body = h('div', {});
    const list = h('div', { class: 'ns-paths' });
    const drawList = () => clear(list, paths.length ? paths.map((p) => h('div', { class: 'ns-path' },
      h('span', { class: 'ns-path-kind' }, p.endsWith('/') ? 'Folder' : 'File'), h('span', { class: 'grow' }, p.replace(/\/$/, '')),
      h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': `Remove ${p}`, onclick: () => { paths = paths.filter((x) => x !== p); drawList(); } }, '×')))
      : h('div', { class: 'small muted' }, 'Nothing chosen yet. Right-click files or folders in Files and choose “Keep offline”, or type a path below (end a folder with /).'));
    const draw = () => {
      clear(modes, [['off', 'Off', 'Only in the cloud'], ['all', 'Everything', `All of “${share.name}”`], ['some', 'Chosen files and folders', 'Just what you pick']].map(([id, label, hint]) =>
        h('button', { type: 'button', class: `ns-kind ${mode === id ? 'on' : ''}`, onclick: () => { mode = id; draw(); } }, h('b', {}, label), h('small', {}, hint))));
      drawList();
      clear(body, mode === 'off' ? h('p', { class: 'small muted' }, o.mode !== 'off' ? 'Turning it off stops syncing. The files already copied stay in their folder.' : 'Files in the cloud are only downloaded when you open them.') : [
        mode === 'some' ? h('div', {}, list, h('div', { class: 'ns-paste' }, add, h('button', { type: 'button', class: 'btn', onclick: () => { const v = add.value.trim().replace(/^[\\/]+/, ''); if (v && !paths.includes(v)) { paths.push(v); add.value = ''; drawList(); } } }, 'Add'))) : null,
        h('div', { class: 'field-row' }, field('Folder for the copy', dest, 'A full path on the MediaDesk server. A new or empty folder.'), field('Sync', every)),
        h('p', { class: 'small muted' }, 'Changes go both ways: edit the copy in Files (it’s its own shared folder, “', share.name, ' (offline)”) and the cloud gets them at the next sync; changes in the cloud come down. If a file changed in both places, both are kept and the older one gets a number in its name.'),
      ]);
    };
    const go = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
    const done = (v) => { overlay.remove(); resolve(v); };
    const box = h('form', { class: 'dialog us-dialog wide ns-dialog', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      go.disabled = true;
      try {
        const r = await api(`/portal/netshares/${share.id}/offline`, { method: 'PUT', body: { mode, paths, dest: dest.value.trim(), every: Number(every.value) } });
        toast(mode === 'off' ? 'Offline copy turned off' : 'Offline copy saved', { type: 'success', body: mode === 'off' ? '' : 'The first sync has started.' });
        done(r.share);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; go.disabled = false; }
    } },
    h('h3', {}, `Offline copy of “${share.name}”`),
    h('div', { class: 'us-body' }, modes, body, err),
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Cancel'), go));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, box);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    draw();
    document.body.append(overlay);
  });
}

// Add or remove files and folders (paths in the cloud folder; folders end in /) from its offline copy.
export async function keepOffline(shareId, { add = [], remove = [] }) {
  const { shares } = await listShares();
  const s = shares.find((x) => x.id === shareId);
  if (!s) throw new Error('That cloud storage isn’t there any more');
  const body = { add, remove, mode: 'auto' };
  return (await api(`/portal/netshares/${shareId}/offline`, { method: 'PUT', body })).share;
}

export const syncNow = (id, force = false) => api(`/portal/netshares/${id}/offline/sync`, { method: 'POST', body: { force } });

// Where files wait to upload, and how big that may get.
function cacheSettings(cloud, onSaved) {
  const dir = input({ value: cloud.cacheDir || '', placeholder: cloud.defaultCacheDir });
  const max = input({ value: cloud.cacheMaxGB || '', inputmode: 'decimal', placeholder: 'No limit' });
  const save = h('button', { type: 'button', class: 'btn' }, 'Save cache settings');
  save.onclick = async () => {
    save.disabled = true;
    try { await api('/portal/netshares/cloud/settings', { method: 'PUT', body: { cacheDir: dir.value.trim(), cacheMaxGB: max.value.trim() } }); toast('Cache settings saved', { type: 'success', body: 'Connected cloud storage was reconnected to use them.' }); onSaved?.(); } catch (ex) { toastError(ex); }
    save.disabled = false;
  };
  return h('details', { class: 'ns-cache', open: Boolean(cloud.cacheDir || cloud.cacheMaxGB) },
    h('summary', { class: 'small' }, `Cloud cache: ${cloud.cacheDir || cloud.defaultCacheDir}${cloud.cacheMaxGB ? `, up to ${cloud.cacheMaxGB} GB each` : ', no size limit'}`),
    h('p', { class: 'small muted' }, 'Files you save or upload to cloud storage wait here until they’ve uploaded, and recently written files stay about an hour. Opening files streams them without saving them here.'),
    h('div', { class: 'field-row' }, field('Cache folder', dir, 'A full path on the MediaDesk server. Blank for the default.'), field('Size limit (GB)', max, 'Per cloud connection. Blank for no limit.')),
    h('div', { class: 'btn-row' }, save));
}
