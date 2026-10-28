// PiKVM: passes MediaDesk's PiKVM app through to the PiKVM's own API (kvmd), adding the login on
// the server so the browser never has it. That covers the REST API (/api/...), the video
// stream (/streamer/...) and the keyboard/mouse WebSocket (/api/ws).
//
// PiKVM serves HTTPS with a self-signed certificate out of the box, so certificate checks are
// off unless "Verify the certificate" is turned on in Settings. Node's fetch can't do that per
// request, so this uses the http / https modules directly.

'use strict';

const http = require('node:http');
const https = require('node:https');

function createPikvm({ getConfig }) {
  const agents = new Map();
  const agentFor = (u, verify) => {
    const key = `${u.protocol}${verify}`;
    if (!agents.has(key)) agents.set(key, u.protocol === 'https:' ? new https.Agent({ keepAlive: true, rejectUnauthorized: verify }) : new http.Agent({ keepAlive: true }));
    return agents.get(key);
  };
  const authHeaders = (c) => ({ 'X-KVMD-User': c.username || 'admin', 'X-KVMD-Passwd': c.password || '' });

  function target(rest, search = '') {
    const c = getConfig();
    const base = new URL(String(c.url).replace(/\/+$/, '') + '/');
    const u = new URL(rest.replace(/^\/+/, '') + (search || ''), base);
    return { c, u, verify: Boolean(c.verifyTls) };
  }

  function request(method, rest, { search = '', headers = {}, timeout = 15000 } = {}) {
    const { c, u, verify } = target(rest, search);
    const lib = u.protocol === 'https:' ? https : http;
    return lib.request(u, { method, agent: agentFor(u, verify), headers: { ...headers, ...authHeaders(c), Host: u.host }, timeout });
  }

  // GET a JSON endpoint (used by the connection test).
  function getJson(rest) {
    return new Promise((resolve, reject) => {
      const r = request('GET', rest, { headers: { Accept: 'application/json' }, timeout: 8000 });
      r.on('response', (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) return reject(Object.assign(new Error('PiKVM rejected the user name or password'), { status: res.statusCode }));
          if (res.statusCode >= 400) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
          try { resolve(JSON.parse(body)); } catch { reject(new Error('PiKVM sent something that isn’t JSON — is the address right?')); }
        });
      });
      r.on('timeout', () => r.destroy(new Error('timed out')));
      r.on('error', reject);
      r.end();
    });
  }

  async function test() {
    try {
      const info = await getJson('api/info');
      const r = info.result || {};
      return { ok: true, version: r.system?.kvmd?.version || '?', host: r.meta?.server?.host || '', platform: r.hw?.platform?.base || r.hw?.platform?.model || '' };
    } catch (err) {
      const code = err.code || err.cause?.code;
      if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code || '')) return { ok: false, error: 'PiKVM’s certificate isn’t trusted. Turn off “Verify the certificate” (PiKVM uses its own by default).' };
      return { ok: false, error: code || err.message };
    }
  }

  // REST and video: stream the answer straight back (the video stream never ends).
  function proxy(req, res, rest, search, sendJson) {
    const headers = {};
    for (const k of ['accept', 'content-type', 'content-length', 'range']) if (req.headers[k]) headers[k] = req.headers[k];
    let up;
    try { up = request(req.method, rest, { search, headers, timeout: 0 }); } catch (err) { return sendJson(res, 400, { error: `Check the PiKVM address: ${err.message}` }); }
    // Give up if PiKVM doesn't start answering in 20 s (uploads to it can take longer to send).
    const wait = setTimeout(() => up.destroy(new Error('timed out')), req.method === 'POST' && rest.includes('msd/write') ? 3600e3 : 20e3);
    up.on('response', (r) => {
      clearTimeout(wait);
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!['connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'www-authenticate'].includes(k)) out[k] = v;
      if (r.statusCode === 401) {
        r.resume();
        return sendJson(res, 502, { error: 'PiKVM rejected MediaDesk’s user name or password. Check them in Settings → PiKVM.' });
      }
      res.writeHead(r.statusCode, out);
      r.pipe(res);
    });
    up.on('error', (err) => {
      clearTimeout(wait);
      const code = err.code || err.message;
      if (!res.headersSent) sendJson(res, 502, { error: /CERT|SELF_SIGNED/.test(code) ? 'PiKVM’s certificate isn’t trusted (turn off “Verify the certificate” in Settings → PiKVM)' : `Could not reach PiKVM: ${code}` });
      else res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  // The keyboard/mouse WebSocket: connect to PiKVM with the login, then pass bytes both ways.
  function upgrade(req, socket, head, rest, search) {
    let up;
    try {
      up = request('GET', rest, {
        search,
        headers: {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Key': req.headers['sec-websocket-key'], 'Sec-WebSocket-Version': req.headers['sec-websocket-version'] || '13',
          ...(req.headers['sec-websocket-protocol'] ? { 'Sec-WebSocket-Protocol': req.headers['sec-websocket-protocol'] } : {}),
        },
        timeout: 0,
      });
    } catch { socket.destroy(); return; }
    up.on('upgrade', (r, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 ${r.statusMessage || 'Switching Protocols'}`];
      for (const [k, v] of Object.entries(r.headers)) for (const val of [].concat(v)) lines.push(`${k}: ${val}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upHead?.length) socket.write(upHead);
      if (head?.length) upSocket.write(head);
      upSocket.pipe(socket).pipe(upSocket);
      const end = () => { socket.destroy(); upSocket.destroy(); };
      socket.on('error', end); upSocket.on('error', end); socket.on('close', end); upSocket.on('close', end);
    });
    up.on('response', (r) => { socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`); r.resume(); });
    up.on('error', () => socket.destroy());
    up.end();
  }

  return { proxy, upgrade, test };
}

module.exports = { createPikvm };
