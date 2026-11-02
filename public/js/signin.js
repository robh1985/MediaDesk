// Signing in to MediaDesk: user name and password, then (with two-step sign-in) the code from an
// authenticator app such as Google Authenticator, or a recovery code. Also the lock screen: the
// same screen with the person already chosen (and a way to sign in as someone else).

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const GO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LOGO = '<svg viewBox="0 0 64 64"><defs><linearGradient id="si-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="14" fill="url(#si-g)"/><path d="M18 42V22l14 12 14-12v20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LAST_USER = 'mediadesk.lastUser';

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}

function avatar(user) {
  if (!user) return el('div', { class: 'lock-avatar', html: LOGO });
  return el('div', { class: 'lock-avatar si-person', style: `--c:${user.color || '#3b82f6'}` }, (user.name || user.username || '?').slice(0, 1).toUpperCase());
}

// user: the person (lock screen), or null (anyone). hint: a user name to start with.
// onDone(user) runs once signed in; switching person on the lock screen reloads the page.
export function signInScreen({ user = null, hint = '', onDone }) {
  document.querySelector('.lock')?.remove();
  const time = el('div', { class: 'lock-time' });
  const date = el('div', { class: 'lock-date' });
  const tick = () => { const d = new Date(); time.textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); };
  tick();
  const timer = setInterval(tick, 10e3);
  let lastUser = '';
  try { lastUser = localStorage.getItem(LAST_USER) || ''; } catch { /* none */ }
  const name = el('input', { class: 'lock-input', type: 'text', placeholder: 'User name', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: user?.username || hint || lastUser });
  const pw = el('input', { class: 'lock-input', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const code = el('input', { class: 'lock-input si-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', maxlength: '20' });
  const err = el('div', { class: 'lock-error', role: 'alert' });
  const go = () => el('button', { class: 'lock-go', type: 'submit', 'aria-label': 'Sign in', html: GO });
  const title = el('div', { class: 'lock-name' }, user ? user.name : 'MediaDesk');
  const sub = el('div', { class: 'si-sub' }, user ? '' : 'Sign in');
  const nameField = el('div', { class: 'lock-field si-name', hidden: user ? true : null }, name);
  const pwField = el('div', { class: 'lock-field' }, pw, go());
  const codeField = el('div', { class: 'lock-field', hidden: true }, code, go());
  const other = user ? el('button', { class: 'si-link', type: 'button', onclick: async () => {
    // Someone else: sign out of this session first (the page reloads for their desktop).
    await post('/portal/logout', {}).catch(() => {});
    location.reload();
  } }, 'Sign in as someone else') : null;
  const back = el('button', { class: 'si-link', type: 'button', hidden: true, onclick: () => step('password') }, 'Back');
  const form = el('form', { class: 'lock-form', novalidate: true }, avatar(user), title, sub, nameField, pwField, codeField, err, back, other);
  const screen = el('div', { class: 'lock' }, el('div', { class: 'lock-clock' }, time, date), form);
  let ticket = null;
  function step(s) {
    const isCode = s === 'code';
    nameField.hidden = isCode || Boolean(user);
    pwField.hidden = isCode;
    codeField.hidden = !isCode;
    back.hidden = !isCode;
    if (other) other.hidden = isCode;
    sub.textContent = isCode ? 'Enter the code from your authenticator app (or a recovery code)' : user ? '' : 'Sign in';
    err.textContent = '';
    setTimeout(() => (isCode ? code : !user && !name.value ? name : pw).focus(), 30);
    if (!isCode) ticket = null;
  }
  const shake = () => { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); };
  async function done(r) {
    try { localStorage.setItem(LAST_USER, r.user?.username || name.value.trim()); } catch { /* fine */ }
    clearInterval(timer);
    // Someone other than the locked-in person: their own desktop.
    if (user && r.user && r.user.id !== user.id) { location.reload(); return; }
    screen.classList.add('leaving');
    setTimeout(() => { screen.remove(); onDone?.(r.user); }, 350);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    form.classList.add('busy');
    try {
      if (ticket) {
        const r = await post('/portal/login/code', { ticket, code: code.value });
        if (r.recoveryUsed) sessionStorage.setItem('mediadesk.recoveryNotice', String(r.recoveryLeft));
        await done(r);
      } else {
        const r = await post('/portal/login', { username: (user?.username || name.value).trim(), password: pw.value });
        if (r.twoFactor) { ticket = r.ticket; code.value = ''; step('code'); } else await done(r);
      }
    } catch (ex) {
      err.textContent = ex.message;
      if (ex.data?.restart) step('password');
      shake();
      (ticket ? code : pw).select();
    } finally { form.classList.remove('busy'); }
  });
  document.body.append(screen);
  step('password');
  return screen;
}

// The first account, when there are none: made from Settings → Users (see settings.js).
export async function createFirstAdmin(body) { return post('/portal/users/setup', body); }
