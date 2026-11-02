// Passkeys in the browser: asking the device (Face ID, Touch ID, a fingerprint, Windows Hello, a
// security key) to make a passkey or sign in with one, and turning its answer into JSON.

const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

// Passkeys need a secure page: https://, or http://localhost.
export const passkeysWork = () => Boolean(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

// What the person sees when the device says no.
function friendly(err) {
  if (err?.name === 'NotAllowedError') return Object.assign(new Error('Cancelled, or the passkey wasn’t chosen in time'), { cancelled: true });
  if (err?.name === 'InvalidStateError') return new Error('This device already has a passkey for your account');
  if (err?.name === 'SecurityError') return new Error('Passkeys don’t work at this address. Use MediaDesk’s https:// address (or localhost).');
  if (err?.name === 'NotSupportedError') return new Error('This device can’t make that kind of passkey');
  return err;
}

export async function createPasskey(o) {
  const publicKey = {
    ...o,
    challenge: fromB64u(o.challenge),
    user: { ...o.user, id: fromB64u(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) })),
  };
  let cred;
  try { cred = await navigator.credentials.create({ publicKey }); } catch (err) { throw friendly(err); }
  return {
    id: cred.id,
    response: {
      clientDataJSON: toB64u(cred.response.clientDataJSON),
      attestationObject: toB64u(cred.response.attestationObject),
      transports: cred.response.getTransports?.() || [],
    },
  };
}

export async function getPasskey(o, { signal } = {}) {
  const publicKey = { ...o, challenge: fromB64u(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: fromB64u(c.id) })) };
  let cred;
  try { cred = await navigator.credentials.get({ publicKey, signal }); } catch (err) { throw friendly(err); }
  return {
    id: cred.id,
    response: {
      clientDataJSON: toB64u(cred.response.clientDataJSON),
      authenticatorData: toB64u(cred.response.authenticatorData),
      signature: toB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? toB64u(cred.response.userHandle) : null,
    },
  };
}

// A name for a new passkey, from this device ("iPhone", "Windows", "Mac"…).
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'This device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${os} (${browser})` : os;
}
