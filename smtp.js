'use strict';

// Sending an email with an attachment through an email server (SMTP), without any packages:
// implicit TLS (port 465) or STARTTLS (587), signing in with AUTH PLAIN or LOGIN. Used by the
// eBook Reader's "Send to Kindle".

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const os = require('node:os');

class SmtpError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// A connection that reads whole replies ("250-…" lines up to "250 …").
function conversation(socket, timeout) {
  let buf = '';
  let waiting = null;
  let failed = null;
  const lines = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: lines.splice(0).map((l) => l.slice(4)) };
        const w = waiting;
        waiting = null;
        w?.resolve(reply);
      }
    }
  };
  const onError = (err) => { failed = err; waiting?.reject(err); waiting = null; };
  const onClose = () => onError(new SmtpError('The email server closed the connection'));
  const attach = (s) => {
    s.on('data', onData);
    s.on('error', onError);
    s.on('close', onClose);
    s.setTimeout(timeout, () => { onError(new SmtpError('The email server stopped answering')); s.destroy(); });
  };
  const detach = (s) => { s.off('data', onData); s.off('error', onError); s.off('close', onClose); s.setTimeout(0); };
  attach(socket);
  const self = {
    socket,
    read() {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
    async send(cmd, expect, what = cmd.split(' ')[0]) {
      const reply = self.read();
      self.socket.write(`${cmd}\r\n`);
      const r = await reply;
      if (expect && !expect.includes(r.code)) throw new SmtpError(`The email server refused ${what}: ${r.code} ${r.lines.join(' ')}`.trim(), r.code);
      return r;
    },
    // Switch to an encrypted connection on the same socket.
    async upgrade(servername, opts) {
      detach(self.socket);
      const secure = tls.connect({ socket: self.socket, servername, ...opts });
      await new Promise((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject); });
      self.socket = secure;
      attach(secure);
    },
  };
  return self;
}

// "Name <a@b>" or "a@b" → the bare address.
const addressOf = (s) => (/<([^>]+)>/.exec(String(s)) || [null, String(s)])[1].trim();
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const base64Lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

function buildMessage({ from, to, subject, text, attachments = [] }) {
  const boundary = `----mediadesk-${crypto.randomBytes(12).toString('hex')}`;
  const host = addressOf(from).split('@')[1] || os.hostname();
  const head = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encodeWord(subject)}`, `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${host}>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(Buffer.from(text || '', 'utf8'))}`];
  for (const a of attachments) {
    const ascii = a.filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'book';
    const star = /^[\x20-\x7e]*$/.test(a.filename) ? '' : `; filename*=UTF-8''${encodeURIComponent(a.filename)}`;
    parts.push(`--${boundary}\r\nContent-Type: ${a.type || 'application/octet-stream'}; name="${ascii}"\r\nContent-Disposition: attachment; filename="${ascii}"${star}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(a.content)}`);
  }
  return `${head.join('\r\n')}\r\n\r\n${parts.join('')}--${boundary}--\r\n`;
}

// server: { host, port, security: 'tls' | 'starttls' | 'none', user, pass }
async function sendMail(server, message, { timeout = 60e3, tlsOptions = {} } = {}) {
  const host = String(server.host || '').trim();
  if (!host) throw new SmtpError('No email server is set');
  const security = server.security || (Number(server.port) === 465 ? 'tls' : 'starttls');
  const port = Number(server.port) || (security === 'tls' ? 465 : 587);
  const socket = await new Promise((resolve, reject) => {
    const s = security === 'tls' ? tls.connect({ host, port, servername: host, ...tlsOptions }) : net.connect({ host, port });
    s.once(security === 'tls' ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', (err) => reject(new SmtpError(`Couldn’t reach the email server ${host}:${port} (${err.code || err.message})`)));
    s.setTimeout(timeout, () => { s.destroy(); reject(new SmtpError(`The email server ${host}:${port} didn’t answer`)); });
  });
  const c = conversation(socket, timeout);
  try {
    const hello = await c.read();
    if (hello.code !== 220) throw new SmtpError(`The email server said: ${hello.code} ${hello.lines.join(' ')}`);
    const me = os.hostname().replace(/[^\w.-]/g, '') || 'mediadesk';
    let ehlo = await c.send(`EHLO ${me}`, [250]);
    if (security === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS/i.test(l))) throw new SmtpError('The email server doesn’t offer STARTTLS. Choose SSL/TLS (port 465) or no encryption.');
      await c.send('STARTTLS', [220]);
      await c.upgrade(host, tlsOptions);
      ehlo = await c.send(`EHLO ${me}`, [250]);
    }
    if (server.user) {
      const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l)) || '';
      if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
        await c.send(`AUTH PLAIN ${Buffer.from(`\0${server.user}\0${server.pass || ''}`, 'utf8').toString('base64')}`, [235], 'the user name or password');
      } else {
        await c.send('AUTH LOGIN', [334]);
        await c.send(Buffer.from(server.user, 'utf8').toString('base64'), [334], 'the user name');
        await c.send(Buffer.from(server.pass || '', 'utf8').toString('base64'), [235], 'the user name or password');
      }
    }
    await c.send(`MAIL FROM:<${addressOf(message.from)}>`, [250], 'the From address');
    for (const to of [].concat(message.to)) await c.send(`RCPT TO:<${addressOf(to)}>`, [250, 251], `the address ${addressOf(to)}`);
    await c.send('DATA', [354]);
    const data = buildMessage({ ...message, to: [].concat(message.to).join(', ') }).replace(/(^|\r\n)\./g, '$1..');
    const done = c.read();
    c.socket.write(`${data}\r\n.\r\n`);
    const r = await done;
    if (r.code !== 250) throw new SmtpError(`The email server didn’t take the message: ${r.code} ${r.lines.join(' ')}`, r.code);
    c.send('QUIT').catch(() => {});
    return { accepted: true, reply: r.lines.join(' ') };
  } finally {
    setTimeout(() => c.socket.destroy(), 1000).unref?.();
  }
}

module.exports = { sendMail, buildMessage, SmtpError };
