// The Family Organizer on its own page (/family): sign in, create an account with an invite code
// (or, signed in to MediaDesk, the first parent's account), then the organizer itself.

import { h, clear } from './ui.js';
import { familyApp } from './apps/family/family.js';
import { familyAuth } from './apps/family/store.js';

const root = document.getElementById('family');
const params = new URLSearchParams(location.search);

// Follow the device's light or dark setting.
const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => { document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light'; };
theme();
dark.addEventListener?.('change', theme);

window.addEventListener('family:signedout', () => location.replace('/family'));

const LOGO = '<svg viewBox="0 0 64 64"><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffa8a8"/><stop offset="1" stop-color="#e03131"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#fg)"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="15" width="40" height="36" rx="5"/><path d="M12 25h40M22 11v8M42 11v8"/></g><path d="M32 46s-8-4.6-8-10a4.3 4.3 0 0 1 8-2.2 4.3 4.3 0 0 1 8 2.2c0 5.4-8 10-8 10z" fill="#fff"/></svg>';

async function boot() {
  let session;
  try { session = await familyAuth.session(); } catch (err) {
    clear(root, card(h('h1', {}, 'Family Organizer'), h('p', { class: 'fam-error' }, `The organizer can’t be reached right now (${err.message}).`), h('button', { class: 'fam-btn primary', onclick: () => location.reload() }, 'Try again')));
    return;
  }
  if (session.user) return mount();
  const invite = params.get('invite');
  if (session.setup && session.portal) return showSignup(session, { first: true });
  if (invite || session.setup) return showSignup(session, { code: invite || '' });
  return showSignin(session);
}

function mount() {
  if (location.search) history.replaceState(null, '', '/family');
  const body = h('div', { class: 'fam-page-body' });
  clear(root, body);
  const handlers = {};
  const win = {
    body, el: body, minimized: false,
    setTitle: (t) => { document.title = t; },
    on: (evt, fn) => { (handlers[evt] ||= []).push(fn); },
  };
  familyApp.open(win, { standalone: true });
}

const card = (...children) => h('div', { class: 'fam-auth' }, h('div', { class: 'fam-auth-card' }, h('div', { class: 'fam-auth-logo', html: LOGO }), ...children));
const fieldEl = (label, control, hint) => h('label', { class: 'fam-field' }, h('span', { class: 'fam-label' }, label), control, hint ? h('span', { class: 'fam-hint' }, hint) : null);
const inputEl = (attrs) => h('input', { class: 'fam-input', ...attrs });

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
}

function showSignin(session) {
  const user = inputEl({ autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, autofocus: true });
  const pass = inputEl({ type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'fam-error', role: 'alert' });
  const go = h('button', { class: 'fam-btn primary fam-auth-go', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'fam-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(go, true, 'Signing in…');
    try { await familyAuth.login(user.value.trim(), pass.value); location.replace('/family'); } catch (e2) { err.textContent = e2.message; busy(go, false, 'Sign in'); pass.select(); }
  } },
  fieldEl('Username or email', user), fieldEl('Password', pass), err, go);
  clear(root, card(h('h1', {}, 'Family Organizer'), h('p', { class: 'fam-muted' }, 'Sign in to see the family’s calendar, chores, meals and lists.'), form,
    h('div', { class: 'fam-auth-alt' }, 'Have an invite code? ', h('button', { class: 'fam-link', type: 'button', onclick: () => showSignup(session, { code: '' }) }, 'Create your account'))));
  user.focus();
}

// Creating an account. `first`: no accounts yet and signed in to MediaDesk, so no code is needed.
function showSignup(session, { code = '', first = false } = {}) {
  const codeIn = inputEl({ value: code, autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-EFGH', required: !first, class: 'fam-input fam-mono' });
  const codeNote = h('span', { class: 'fam-hint' });
  const firstName = inputEl({ autocomplete: 'given-name', required: true, maxlength: 60 });
  const lastName = inputEl({ autocomplete: 'family-name', required: true, maxlength: 60 });
  const email = inputEl({ type: 'email', autocomplete: 'email', required: true, maxlength: 200 });
  const user = inputEl({ autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 32, pattern: '[A-Za-z0-9][A-Za-z0-9._\\-]{2,31}' });
  const pass = inputEl({ type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const pass2 = inputEl({ type: 'password', autocomplete: 'new-password', required: true });
  const err = h('div', { class: 'fam-error', role: 'alert' });
  const go = h('button', { class: 'fam-btn primary fam-auth-go', type: 'submit' }, 'Create account');
  const checkCode = async () => {
    const c = codeIn.value.trim();
    if (!c) { codeNote.textContent = ''; return; }
    try {
      const i = await familyAuth.invite(c);
      codeNote.textContent = `✓ You’re invited as ${i.role === 'parent' ? 'a parent' : 'a family member'}.`;
      codeNote.className = 'fam-hint fam-ok';
    } catch (e) { codeNote.textContent = e.message; codeNote.className = 'fam-hint fam-error'; }
  };
  codeIn.addEventListener('change', checkCode);
  const form = h('form', { class: 'fam-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pass.value !== pass2.value) { err.textContent = 'The passwords don’t match'; pass2.focus(); return; }
    busy(go, true, 'Creating your account…');
    try {
      await familyAuth.signup({ code: codeIn.value.trim(), first: firstName.value, last: lastName.value, email: email.value, username: user.value.trim(), password: pass.value });
      location.replace('/family');
    } catch (e2) { err.textContent = e2.message; busy(go, false, 'Create account'); }
  } },
  first ? null : fieldEl('Invite code', codeIn, codeNote),
  h('div', { class: 'fam-row-wrap' }, fieldEl('First name', firstName), fieldEl('Last name', lastName)),
  fieldEl('Email', email),
  fieldEl('Username', user, '3 to 32 letters or numbers (dots, dashes and underscores too).'),
  h('div', { class: 'fam-row-wrap fam-row-top' }, fieldEl('Password', pass), fieldEl('Password again', pass2)),
  h('span', { class: 'fam-hint' }, 'At least 8 characters.'),
  err, go);
  const intro = first
    ? [h('h1', {}, 'Set up the Family Organizer'), h('p', { class: 'fam-muted' }, 'Create the first parent account. Parents can invite the rest of the family from Settings → Users.')]
    : session.setup
      ? [h('h1', {}, 'Create your account'), h('p', { class: 'fam-muted' }, 'There are no accounts yet. The first parent account needs an invite code made in MediaDesk: Family Organizer → Settings → Users.')]
      : [h('h1', {}, 'Create your account'), h('p', { class: 'fam-muted' }, 'Enter the invite code a parent gave you.')];
  clear(root, card(...intro, form,
    session.setup ? null : h('div', { class: 'fam-auth-alt' }, 'Already have an account? ', h('button', { class: 'fam-link', type: 'button', onclick: () => showSignin(session) }, 'Sign in'))));
  (first || code ? firstName : codeIn).focus();
  if (code) checkCode();
}

boot();
