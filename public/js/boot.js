// Starting MediaDesk in the browser: sign in first (when there are accounts), then load the desktop
// as that person. Each person's things kept in this browser (desktop layout, appearance, app
// preferences) are kept apart, so people sharing a computer don't see each other's.

import { signInScreen } from './signin.js';

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
  const shared = new Set(['mediadesk.lastUser']);
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
  if (s.auth && !s.authed) {
    document.body.classList.add('ready', 'locked');
    await new Promise((resolve) => signInScreen({ user: s.lockedUser, hint: s.usernameHint || '', onDone: resolve }));
    document.body.classList.remove('locked');
    s = await session();
  }
  keepApart(s.user);
  window.mediadeskSession = s;
  await import('./main.js');
}

start();
