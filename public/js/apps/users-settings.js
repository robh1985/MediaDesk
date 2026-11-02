// Settings → My account (everyone: name, colour, password, two-step sign-in) and Settings → Users
// (admins: making accounts, roles, which apps and folders each person has, Family Organizer links).

import { h, clear, toast, toastError, confirmDialog, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { state } from '../api.js';

const COLORS = ['#3b82f6', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#d6336c', '#4263eb', '#495057'];
const ROLE_TEXT = {
  admin: ['Admin', 'Everything, including MediaDesk’s settings and the people who use it.'],
  standard: ['Standard', 'Every app (except admin-only ones such as PiKVM and the Log Viewer, unless you tick them), their own settings and personal libraries.'],
  custom: ['Custom', 'Only the apps you tick.'],
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const section = (title, ...children) => h('section', { class: 'settings-section' }, h('h3', { class: 'section-title' }, title), ...children);
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);
const input = (attrs = {}) => h('input', { class: 'input', spellcheck: 'false', autocomplete: 'off', ...attrs });
const personDot = (u, size = 28) => h('span', { class: 'us-avatar', style: { '--c': u.color || '#3b82f6', width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` } }, (u.name || u.username || '?').slice(0, 1).toUpperCase());

// A dialog over the page; resolves to a button's value (null when closed).
function dialog(title, body, buttons, { wide = false } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); resolve(v); };
    const box = h('form', { class: `dialog us-dialog ${wide ? 'wide' : ''}`, onsubmit: (e) => { e.preventDefault(); const b = buttons.find((x) => x.submit); if (b) b.onClick ? b.onClick(done) : done(b.value); } },
      h('h3', {}, title), body,
      h('div', { class: 'dialog-actions' }, buttons.map((b) => h('button', { type: b.submit ? 'submit' : 'button', class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`, onclick: b.submit ? null : () => (b.onClick ? b.onClick(done) : done(b.value ?? null)) }, b.label))));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, box);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);
    setTimeout(() => box.querySelector('input:not([type=checkbox]), select')?.focus(), 30);
  });
}

// A QR code (for the authenticator app), drawn from public/vendor/qrcode.
let qrLib = null;
function loadQr() {
  qrLib ||= new Promise((resolve, reject) => { if (window.qrcode) return resolve(window.qrcode); const s = document.createElement('script'); s.src = '/vendor/qrcode/qrcode.js'; s.onload = () => resolve(window.qrcode); s.onerror = reject; document.head.append(s); });
  return qrLib;
}
async function qrSvg(text) {
  const qrcode = await loadQr();
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
}

// Recovery codes, shown once.
function showRecovery(codes) {
  const text = codes.join('\n');
  return dialog('Your recovery codes', h('div', { class: 'us-body' },
    h('p', { class: 'small' }, 'If you lose your phone, each of these signs you in once instead of a code. Keep them somewhere safe (print them, or save them in a password manager). They won’t be shown again.'),
    h('pre', { class: 'us-codes' }, text),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => { navigator.clipboard?.writeText(text); toast('Copied', { timeout: 1200 }); } }, 'Copy'),
      h('a', { class: 'btn', href: URL.createObjectURL(new Blob([`MediaDesk recovery codes for ${state.me?.username || ''}\n\n${text}\n`], { type: 'text/plain' })), download: 'mediadesk-recovery-codes.txt' }, 'Download'))),
  [{ label: 'I’ve saved them', primary: true, submit: true, value: true }]);
}

// --- My account ------------------------------------------------------------------------------

export async function renderAccount(container) {
  clear(container, h('div', { class: 'pane-header' }, h('h2', {}, 'My account')));
  let me;
  try { me = (await api('/portal/me')).user; } catch (err) { container.append(h('p', { class: 'notice' }, err.message)); return; }
  if (me.open) {
    container.append(h('div', { class: 'notice' }, 'MediaDesk has no accounts yet, so anyone who can reach it can use it. Make yours (an admin account) in Settings → Users.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: () => import('../wm.js').then((wm) => wm.openApp('settings', { tab: 'users' })) }, 'Go to Users')));
    return;
  }
  // Name and colour.
  const name = input({ value: me.name });
  let color = me.color;
  const sw = h('div', { class: 'us-swatches' });
  const drawSw = () => clear(sw, COLORS.map((c) => h('button', { type: 'button', class: c === color ? 'on' : '', style: { background: c }, 'aria-label': c, onclick: () => { color = c; drawSw(); } })));
  drawSw();
  container.append(section('You',
    h('div', { class: 'us-me' }, personDot(me, 52), h('div', {}, h('b', {}, me.name), h('div', { class: 'small muted' }, `${me.username} · ${ROLE_TEXT[me.role][0]}${me.lastLogin ? ` · signed in ${timeAgo(me.lastLogin)}` : ''}`))),
    field('Name', name), field('Colour', sw),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: async () => {
      try { await api('/portal/me', { method: 'POST', body: { name: name.value, color } }); toast('Saved', { type: 'success', timeout: 1500 }); renderAccount(container); } catch (err) { toastError(err); }
    } }, 'Save'))));
  // Password.
  const cur = input({ type: 'password', autocomplete: 'current-password' });
  const next = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const again = input({ type: 'password', autocomplete: 'new-password' });
  container.append(section('Password',
    h('div', { class: 'field-row' }, field('Current password', cur), field('New password', next), field('New password again', again)),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => {
      if (next.value !== again.value) { toast('The new passwords don’t match', { type: 'error' }); return; }
      try { await api('/portal/me/password', { method: 'POST', body: { current: cur.value, next: next.value } }); cur.value = next.value = again.value = ''; toast('Password changed', { type: 'success', body: 'You’ve been signed out everywhere else.' }); } catch (err) { toastError(err, 'The password wasn’t changed'); }
    } }, 'Change password'))));
  // Two-step sign-in.
  const tfa = h('div', {});
  const drawTfa = () => clear(tfa, me.twoFactor
    ? [h('div', { class: 'us-on' }, h('span', { html: icon.check }), h('span', {}, h('b', {}, 'Two-step sign-in is on.'), ` After your password, MediaDesk asks for the code from your authenticator app. ${me.recoveryLeft} recovery code${me.recoveryLeft === 1 ? '' : 's'} left.`)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => { const pw = await askPassword('New recovery codes'); if (!pw) return; try { const r = await api('/portal/me/2fa/recovery', { method: 'POST', body: { password: pw } }); await showRecovery(r.recovery); renderAccount(container); } catch (err) { toastError(err); } } }, 'New recovery codes'),
        h('button', { class: 'btn btn-danger', onclick: async () => { const pw = await askPassword('Turn off two-step sign-in'); if (!pw) return; try { await api('/portal/me/2fa/disable', { method: 'POST', body: { password: pw } }); toast('Two-step sign-in is off'); renderAccount(container); } catch (err) { toastError(err); } } }, 'Turn off'))]
    : [h('p', { class: 'small muted' }, 'Ask for a code from your phone as well as your password when you sign in, so a stolen password isn’t enough. Use Google Authenticator, Microsoft Authenticator, Authy, 1Password or any authenticator app.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: () => setUp2fa(() => renderAccount(container)) }, 'Turn on two-step sign-in'))]);
  drawTfa();
  container.append(section('Two-step sign-in', tfa));
  container.append(section('Signed in elsewhere',
    h('p', { class: 'small muted' }, 'Sign out of MediaDesk on every other browser and device (this one stays signed in).'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => { try { await api('/portal/me/signout-others', { method: 'POST' }); toast('Signed out everywhere else', { type: 'success' }); } catch (err) { toastError(err); } } }, 'Sign out everywhere else'))));
}

async function askPassword(title) {
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const ok = await dialog(title, h('div', { class: 'us-body' }, field('Your password', pw)), [{ label: 'Cancel' }, { label: 'OK', primary: true, submit: true, value: true }]);
  return ok ? pw.value : null;
}

// Scan the QR code, type the code it shows, then save the recovery codes.
async function setUp2fa(after) {
  let start;
  try { start = await api('/portal/me/2fa/start', { method: 'POST' }); } catch (err) { toastError(err); return; }
  const qr = h('div', { class: 'us-qr' }, 'Making the QR code…');
  qrSvg(start.uri).then((svg) => { qr.innerHTML = svg; }).catch(() => { qr.textContent = 'The QR code couldn’t be drawn: type the key below instead.'; });
  const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', maxlength: 8, class: 'input us-code' });
  const key = start.secret.replace(/(.{4})/g, '$1 ').trim();
  const r = await dialog('Turn on two-step sign-in', h('div', { class: 'us-body us-2fa' },
    h('ol', { class: 'small' },
      h('li', {}, 'Open ', h('b', {}, 'Google Authenticator'), ' (or another authenticator app) on your phone and tap ', h('b', {}, '+'), ' → ', h('b', {}, 'Scan a QR code'), '.'),
      h('li', {}, 'Scan this code. (Can’t scan? Choose “Enter a setup key” and type the key under it, time-based.)'),
      h('li', {}, 'Type the 6-digit code the app shows for MediaDesk.')),
    qr, h('div', { class: 'us-key' }, h('small', { class: 'muted' }, 'Setup key'), h('code', {}, key)),
    field('Code from the app', code)),
  [{ label: 'Cancel' }, { label: 'Turn on', primary: true, submit: true, onClick: async (done) => {
    try { const res = await api('/portal/me/2fa/confirm', { method: 'POST', body: { code: code.value } }); done(res); } catch (err) { toastError(err, 'Not turned on yet'); code.select(); }
  } }], { wide: true });
  if (!r) return;
  toast('Two-step sign-in is on', { type: 'success' });
  await showRecovery(r.recovery);
  after?.();
}

// --- Users (admins) ----------------------------------------------------------------------------

export async function renderUsers(container) {
  clear(container, h('div', { class: 'pane-header' }, h('span', { html: icon.users, class: 'us-headicon' }), h('h2', {}, 'Users')));
  let data;
  try { data = await api('/portal/users'); } catch (err) { container.append(h('p', { class: 'notice' }, err.message)); return; }
  if (data.mock) container.append(h('div', { class: 'notice' }, 'Demo mode: accounts are kept until the demo restarts.'));
  // No accounts yet: make the first admin (this browser signs in as it).
  if (!data.signIn) {
    const username = input({ placeholder: 'e.g. rob', autocapitalize: 'none' });
    const name = input({ placeholder: 'Your name' });
    const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    const pw2 = input({ type: 'password', autocomplete: 'new-password' });
    container.append(section('Turn on sign-in',
      h('p', { class: 'small' }, 'MediaDesk has no accounts, so anyone who can reach it can use it. Make your own account first: an admin, who can then add the people who use MediaDesk and choose what each of them can use.'),
      h('div', { class: 'field-row' }, field('User name', username), field('Name', name)),
      h('div', { class: 'field-row' }, field('Password', pw), field('Password again', pw2)),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: async () => {
        if (pw.value !== pw2.value) { toast('The passwords don’t match', { type: 'error' }); return; }
        try { await api('/portal/users/setup', { method: 'POST', body: { username: username.value, name: name.value, password: pw.value } }); toast('Sign-in is on', { type: 'success', body: 'MediaDesk will now restart as you.' }); setTimeout(() => location.reload(), 900); } catch (err) { toastError(err, 'The account wasn’t made'); }
      } }, 'Make my admin account'))));
    return;
  }
  const list = h('div', { class: 'us-list' }, data.users.map((u) => h('div', { class: `us-row ${u.disabled ? 'off' : ''}` },
    personDot(u, 36),
    h('div', { class: 'us-who' }, h('b', {}, u.name, u.id === state.me?.id ? h('span', { class: 'muted' }, ' (you)') : null), h('small', { class: 'muted' }, [u.username, u.lastLogin ? `signed in ${timeAgo(u.lastLogin)}` : 'never signed in'].join(' · '))),
    h('span', { class: `us-role ${u.role}` }, ROLE_TEXT[u.role][0]),
    u.twoFactor ? h('span', { class: 'us-tag ok', title: 'Two-step sign-in is on' }, '🔐 2-step') : h('span', { class: 'us-tag', title: 'Two-step sign-in is off' }, 'Password only'),
    u.disabled ? h('span', { class: 'us-tag bad' }, 'Turned off') : null,
    h('button', { class: 'btn btn-sm', onclick: () => editUser(u, data, () => renderUsers(container)) }, 'Edit'))));
  container.append(section('People', list,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onclick: () => editUser(null, data, () => renderUsers(container)) }, h('span', { html: icon.plus }), 'Add a person'))));
  // Personal folders.
  const folder = input({ value: state.config?.usersFolder || '', placeholder: 'Default: the users folder next to MediaDesk’s settings' });
  container.append(section('Personal libraries',
    h('p', { class: 'small muted' }, 'Everyone has a personal library in the eBook Reader and the Game Console, and “My files” in Files, alongside the shared ones. Each person’s are kept in a folder of their own here (Books, Games and Files inside it).'),
    field('Personal folders', folder),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', disabled: data.mock, onclick: async () => { try { state.config = await api('/portal/config', { method: 'POST', body: { usersFolder: folder.value.trim() } }); toast('Saved', { type: 'success', timeout: 1500 }); } catch (err) { toastError(err); } } }, 'Save'))));
}

async function editUser(u, data, after) {
  const isNew = !u;
  u = u ? { ...u } : { role: 'standard', apps: [], color: COLORS[data.users.length % COLORS.length], folders: null, family: null };
  const username = input({ value: u.username || '', autocapitalize: 'none', placeholder: 'e.g. sam' });
  const name = input({ value: u.name || '', placeholder: 'Sam Smith' });
  const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: isNew ? 'At least 8 characters' : 'Leave blank to keep it' });
  let role = u.role;
  const apps = new Set(u.role === 'custom' ? u.apps : u.apps || []);
  const roleBox = h('div', { class: 'us-roles' });
  const appsBox = h('div', { class: 'us-apps' });
  const drawRoles = () => clear(roleBox, Object.entries(ROLE_TEXT).map(([k, [l, d]]) => h('label', { class: `us-roleopt ${role === k ? 'on' : ''}` },
    h('input', { type: 'radio', name: 'role', checked: role === k, onchange: () => { role = k; drawRoles(); drawApps(); } }), h('span', {}, h('b', {}, l), h('small', { class: 'muted' }, d)))));
  const drawApps = () => {
    appsBox.hidden = role === 'admin';
    const list = role === 'custom' ? Object.entries(data.apps) : Object.entries(data.apps).filter(([k]) => data.adminOnly.includes(k));
    clear(appsBox, h('div', { class: 'small muted' }, role === 'custom' ? 'Apps they can use (Settings, Search and Preview are always there):' : 'Admin-only apps they can use as well:'),
      h('div', { class: 'us-appgrid' }, list.map(([k, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: apps.has(k), onchange: (e) => (e.target.checked ? apps.add(k) : apps.delete(k)) }), l))),
      role === 'custom' ? h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { Object.keys(data.apps).forEach((k) => apps.add(k)); drawApps(); } }, 'All'), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { apps.clear(); drawApps(); } }, 'None')) : null);
  };
  drawRoles();
  drawApps();
  // Shared folders (Files): all, or some.
  const roots = state.config?.files?.folders || [];
  let folders = Array.isArray(u.folders) ? new Set(u.folders) : null;
  const folderBox = h('div', {});
  const drawFolders = () => clear(folderBox, roots.length ? [
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !folders, onchange: (e) => { folders = e.target.checked ? null : new Set(roots.map((r) => r.path)); drawFolders(); } }), 'All shared folders (and any added later)'),
    folders ? h('div', { class: 'us-appgrid' }, roots.map((r) => h('label', { class: 'check', title: r.path }, h('input', { type: 'checkbox', checked: folders.has(r.path), onchange: (e) => (e.target.checked ? folders.add(r.path) : folders.delete(r.path)) }), r.alias || r.folderName))) : null,
  ] : h('small', { class: 'muted' }, 'No shared folders yet (Settings → Files).'));
  drawFolders();
  // Family Organizer: parent or kid, and which family profile is theirs.
  const famRole = h('select', { class: 'input' }, [['parent', 'A parent'], ['kid', 'A kid'], ['none', 'Not in the family']].map(([v, l]) => h('option', { value: v, selected: (u.family?.role || 'parent') === v }, l)));
  const famProfile = h('select', { class: 'input' }, h('option', { value: '' }, 'No profile'));
  fetch('/portal/family/data', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    const members = Object.values(d?.collections?.members || d?.members || {}).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const m of members) famProfile.append(h('option', { value: m.id, selected: u.family?.profile === m.id }, `${m.emoji || ''} ${m.name}`.trim()));
  }).catch(() => {});
  let color = u.color;
  const sw = h('div', { class: 'us-swatches' });
  const drawSw = () => clear(sw, COLORS.map((c) => h('button', { type: 'button', class: c === color ? 'on' : '', style: { background: c }, 'aria-label': c, onclick: () => { color = c; drawSw(); } })));
  drawSw();
  const disabled = h('input', { type: 'checkbox', checked: Boolean(u.disabled) });
  const body = h('div', { class: 'us-body' },
    h('div', { class: 'field-row' }, field('User name', username, 'For signing in: lower-case letters, digits, dots, dashes'), field('Name', name)),
    h('div', { class: 'field-row' }, field(isNew ? 'Password' : 'New password', pw, isNew ? 'They can change it in Settings → My account' : null), field('Colour', sw)),
    h('h4', {}, 'Role'), roleBox, appsBox,
    h('h4', {}, 'Shared folders in Files'), folderBox,
    h('h4', {}, 'Family Organizer'),
    h('div', { class: 'field-row' }, field('In the family as', famRole), field('Their profile', famProfile, 'Chores, stars and “my” lists are theirs')),
    !isNew ? h('h4', {}, 'Account') : null,
    !isNew ? h('label', { class: 'check' }, disabled, 'Turned off (they can’t sign in)') : null,
    !isNew ? h('div', { class: 'btn-row' },
      u.twoFactor ? h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { if (!await confirmDialog({ title: `Turn off two-step sign-in for ${u.name}?`, message: 'For when they’ve lost their phone. They can turn it on again in My account.', confirm: 'Turn it off' })) return; try { await api(`/portal/users/${u.id}/2fa-reset`, { method: 'POST' }); toast('Two-step sign-in turned off', { timeout: 2000 }); } catch (err) { toastError(err); } } }, 'Reset two-step sign-in') : null,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { try { await api(`/portal/users/${u.id}/signout`, { method: 'POST' }); toast(`${u.name} is signed out everywhere`, { timeout: 2000 }); } catch (err) { toastError(err); } } }, 'Sign them out everywhere')) : null);
  const r = await dialog(isNew ? 'Add a person' : `Edit ${u.name}`, body, [
    !isNew && u.id !== state.me?.id ? { label: 'Delete', danger: true, value: 'delete' } : null,
    { label: 'Cancel' }, { label: isNew ? 'Add' : 'Save', primary: true, submit: true, value: 'save' }].filter(Boolean), { wide: true });
  if (r === 'delete') {
    if (!await confirmDialog({ title: `Delete ${u.name}’s account?`, message: 'They can’t sign in any more. Their personal libraries stay in their folder on the server.', confirm: 'Delete', danger: true })) return;
    try { await api(`/portal/users/${u.id}`, { method: 'DELETE' }); toast('Deleted', { timeout: 1500 }); after(); } catch (err) { toastError(err); }
    return;
  }
  if (r !== 'save') return;
  const payload = {
    username: username.value, name: name.value, role, color, apps: [...apps], folders: folders ? [...folders] : null,
    family: { role: famRole.value, profile: famRole.value === 'none' ? null : famProfile.value || null },
    ...(pw.value ? { password: pw.value } : {}), ...(!isNew ? { disabled: disabled.checked } : {}),
  };
  try {
    await api(isNew ? '/portal/users' : `/portal/users/${u.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
    toast(isNew ? `Added ${payload.name || payload.username}` : 'Saved', { type: 'success', timeout: 2000 });
    after();
  } catch (err) { toastError(err, isNew ? 'The account wasn’t made' : 'Not saved'); editUser(isNew ? null : u, data, after); }
}
