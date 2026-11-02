// Starting MediaDesk in the browser: sign in first (when there are accounts), then load the desktop
// as that person. Each person's things kept in this browser (desktop layout, appearance, app
// preferences) are kept apart, so people sharing a computer don't see each other's.

import { signInScreen, linkScreen } from './signin.js';

const session = async () => {
  const res = await fetch('/portal/session', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// localStorage keys "mediadesk.…" become "mediadesk.u.<id>.…" for the person signed in. The first
// admin also finds what this browser kept from before there were accounts.
function keepApart(user) {
  if (!user || user.open) return;
  const proto = Storage.prototype;
  const { getItem, setItem, removeItem } = proto;
  const prefix = `mediadesk.u.${user.id}.`;
  const shared = new Set(['mediadesk.lastUser', 'mediadesk.lastUserInfo']);
  const mapKey = (store, k) => (store === localStorage && typeof k === 'string' && k.startsWith('mediadesk.') && !shared.has(k) && !k.startsWith('mediadesk.u.') ? prefix + k.slice(10) : k);
  proto.getItem = function get(k) {
    const mk = mapKey(this, k);
    const v = getItem.call(this, mk);
    if (v === null && mk !== k && user.owner) {
      const old = getItem.call(this, k);
      if (old !== null) { try { setItem.call(this, mk, old); } catch { /* full */ } }
      return old;
    }
    return v;
  };
  proto.setItem = function set(k, v) { return setItem.call(this, mapKey(this, k), v); };
  proto.removeItem = function remove(k) { return removeItem.call(this, mapKey(this, k)); };
}

async function start() {
  let s;
  try { s = await session(); } catch (err) {
    document.body.classList.add('ready');
    document.getElementById('desktop').append(Object.assign(document.createElement('div'), { className: 'boot-error', textContent: `Could not reach the MediaDesk server: ${err.message}` }));
    return;
  }
  // An invite or password reset link: choose a password first.
  const params = new URLSearchParams(location.search);
  const kind = params.has('invite') ? 'invite' : params.has('reset') ? 'reset' : null;
  let hint = s.usernameHint || '';
  if (kind) {
    document.body.classList.add('ready', 'locked');
    const r = await linkScreen(kind, params.get(kind));
    history.replaceState(null, '', location.pathname);
    if (r.signIn) hint = r.signIn;
    s = await session();
    if (s.authed) document.body.classList.remove('locked');
  }
  if (s.auth && !s.authed) {
    document.body.classList.add('ready', 'locked');
    await new Promise((resolve) => signInScreen({ user: s.lockedUser, hint, canReset: s.resetByEmail, canPasskey: s.passkeys, onDone: resolve }));
    document.body.classList.remove('locked');
    s = await session();
  }
  // Who's signed in here (their picture and name on the sign-in screen next time).
  if (s.user && !s.user.open && s.user.username) {
    try {
      localStorage.setItem('mediadesk.lastUser', s.user.username);
      localStorage.setItem('mediadesk.lastUserInfo', JSON.stringify({ id: s.user.id, username: s.user.username, name: s.user.name, color: s.user.color, avatar: s.user.avatar || null }));
    } catch { /* fine */ }
  }
  keepApart(s.user);
  window.mediadeskSession = s;
  await import('./main.js');
}

start();
