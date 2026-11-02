// Passkeys (WebAuthn): signing in with Face ID, Touch ID, a fingerprint, Windows Hello or a
// security key instead of a password. This file checks what the browser sends back. It has no
// dependencies: a small CBOR reader, COSE public keys turned into keys Node can use, and the
// checks the WebAuthn spec asks for (challenge, origin, site, user present and verified,
// signature, counter).

const crypto = require('node:crypto');

class PasskeyError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

// --- CBOR (RFC 8949): just what attestation objects and COSE keys use ---------------------------
function cborDecode(buf, start = 0) {
  let i = start;
  const need = (n) => { if (i + n > buf.length) throw new PasskeyError('That passkey answer is cut short'); };
  function length(info) {
    if (info < 24) return info;
    const n = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!n) throw new PasskeyError('That passkey answer can’t be read');
    need(n);
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + buf[i + k];
    i += n;
    return v;
  }
  function item(depth = 0) {
    if (depth > 16) throw new PasskeyError('That passkey answer can’t be read');
    need(1);
    const byte = buf[i++];
    const major = byte >> 5;
    const info = byte & 31;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
      if (info === 25) { need(2); const v = buf.readUInt16BE(i); i += 2; const s = v >> 15 ? -1 : 1; const e = (v >> 10) & 31; const f = v & 1023; return s * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15)); }
      if (info === 26) { need(4); const v = buf.readFloatBE(i); i += 4; return v; }
      if (info === 27) { need(8); const v = buf.readDoubleBE(i); i += 8; return v; }
      throw new PasskeyError('That passkey answer can’t be read');
    }
    const len = length(info);
    if (major === 0) return len;
    if (major === 1) return -1 - len;
    if (major === 2) { need(len); const v = buf.subarray(i, i + len); i += len; return Buffer.from(v); }
    if (major === 3) { need(len); const v = buf.toString('utf8', i, i + len); i += len; return v; }
    if (major === 4) { const a = []; for (let k = 0; k < len; k++) a.push(item(depth + 1)); return a; }
    if (major === 5) { const m = new Map(); for (let k = 0; k < len; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
    if (major === 6) return item(depth + 1); // a tag: the value inside
    throw new PasskeyError('That passkey answer can’t be read');
  }
  const value = item();
  return { value, end: i };
}

// --- COSE keys (RFC 9053) → JWK -----------------------------------------------------------------
const ALGS = { [-7]: 'ES256', [-257]: 'RS256', [-8]: 'EdDSA' };
function coseToJwk(m) {
  const kty = m.get(1);
  const alg = m.get(3);
  if (kty === 2 && alg === -7 && m.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } };
  if (kty === 1 && alg === -8 && m.get(-1) === 6) return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(m.get(-2)) } };
  throw new PasskeyError('That kind of passkey isn’t supported');
}

// --- Authenticator data -------------------------------------------------------------------------
function parseAuthData(buf) {
  if (buf.length < 37) throw new PasskeyError('That passkey answer is cut short');
  const out = { rpIdHash: buf.subarray(0, 32), flags: buf[32], counter: buf.readUInt32BE(33) };
  out.up = Boolean(out.flags & 0x01);
  out.uv = Boolean(out.flags & 0x04);
  if (out.flags & 0x40) {
    if (buf.length < 55) throw new PasskeyError('That passkey answer is cut short');
    const idLen = buf.readUInt16BE(53);
    out.credentialId = Buffer.from(buf.subarray(55, 55 + idLen));
    const { value } = cborDecode(buf, 55 + idLen);
    out.publicKey = value;
  }
  return out;
}

function checkClientData(clientDataJSON, { type, challenge, rpId }) {
  let cd;
  try { cd = JSON.parse(unb64u(clientDataJSON).toString('utf8')); } catch { throw new PasskeyError('That passkey answer can’t be read'); }
  if (cd.type !== type) throw new PasskeyError('That passkey answer is for something else');
  if (!challenge || cd.challenge !== challenge) throw new PasskeyError('That took too long — try again');
  let host;
  try { host = new URL(cd.origin).hostname; } catch { throw new PasskeyError('That passkey answer came from somewhere else'); }
  // The page has to be on this site (MediaDesk's address, or an address under it).
  if (host !== rpId && !host.endsWith(`.${rpId}`)) throw new PasskeyError('That passkey answer came from somewhere else');
  if (cd.crossOrigin) throw new PasskeyError('That passkey answer came from somewhere else');
  return cd;
}

// Options for navigator.credentials.create (made into ArrayBuffers by the page).
function registrationOptions({ rpId, user, challenge, exclude = [] }) {
  return {
    challenge,
    rp: { id: rpId, name: 'MediaDesk' },
    user: { id: b64u(Buffer.from(user.id)), name: user.username, displayName: user.name || user.username },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
    timeout: 120000,
    attestation: 'none',
    excludeCredentials: exclude.map((id) => ({ type: 'public-key', id })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
  };
}

// A new passkey: check it and return what to keep.
function verifyRegistration({ response, challenge, rpId }) {
  checkClientData(response.clientDataJSON, { type: 'webauthn.create', challenge, rpId });
  const { value: att } = cborDecode(unb64u(response.attestationObject));
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new PasskeyError('That passkey answer can’t be read');
  const auth = parseAuthData(att.get('authData'));
  if (!auth.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new PasskeyError('That passkey is for a different site');
  if (!auth.up || !auth.uv) throw new PasskeyError('The passkey has to check it’s you (face, fingerprint or PIN)');
  if (!auth.credentialId || !(auth.publicKey instanceof Map)) throw new PasskeyError('That passkey answer has no key in it');
  const { alg, jwk } = coseToJwk(auth.publicKey);
  crypto.createPublicKey({ key: jwk, format: 'jwk' }); // throws if the key is broken
  return { id: b64u(auth.credentialId), alg, jwk, counter: auth.counter, rpId };
}

// Signing in: check the signature with the kept key. Returns the new counter.
function verifyAssertion({ response, challenge, cred }) {
  checkClientData(response.clientDataJSON, { type: 'webauthn.get', challenge, rpId: cred.rpId });
  const authData = unb64u(response.authenticatorData);
  const auth = parseAuthData(authData);
  if (!auth.rpIdHash.equals(sha256(Buffer.from(cred.rpId)))) throw new PasskeyError('That passkey is for a different site');
  if (!auth.up || !auth.uv) throw new PasskeyError('The passkey has to check it’s you (face, fingerprint or PIN)');
  const data = Buffer.concat([authData, sha256(unb64u(response.clientDataJSON))]);
  const key = crypto.createPublicKey({ key: cred.jwk, format: 'jwk' });
  const sig = unb64u(response.signature);
  const ok = cred.alg === -8 ? crypto.verify(null, data, key, sig) : crypto.verify('sha256', data, cred.alg === -7 ? { key, dsaEncoding: 'der' } : key, sig);
  if (!ok) throw new PasskeyError('That passkey didn’t work');
  // A counter that goes backwards means a copied passkey (most passkeys that sync keep it at 0).
  if ((auth.counter || cred.counter) && auth.counter <= cred.counter) throw new PasskeyError('That passkey didn’t work (its counter went backwards)');
  return auth.counter;
}

module.exports = { PasskeyError, cborDecode, coseToJwk, parseAuthData, registrationOptions, verifyRegistration, verifyAssertion, ALGS, b64u };
