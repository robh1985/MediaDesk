'use strict';
// Updates from GitHub, started from Settings → About by an admin or a parent.
//
// The server only checks and asks: it fetches `origin/main`, works out what is new, writes
// `update-state.json` next to the config ({ status: 'pending', from, to }), and exits with
// RESTART_CODE. The supervisor (supervisor.js, which the Windows service runs) does the rest:
// it moves the code forward, starts the new server, and puts the old code back if the new one
// doesn't start. So an update can only be applied when MediaDesk runs under the supervisor.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const RESTART_CODE = 75;
const BRANCH = 'main';
const isWin = process.platform === 'win32';

// Git for the service account too: SYSTEM doesn't always have Git on its PATH, so also look
// where Git for Windows installs (for all users, or for one user).
let gitPath;
function findGit() {
  if (gitPath !== undefined) return gitPath;
  const names = isWin ? ['git.exe', 'git.cmd'] : ['git'];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (isWin) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) dirs.push(path.join(base, 'Git', 'cmd'));
    }
    try {
      const usersDir = path.join(process.env.SystemDrive || 'C:', '\\Users');
      for (const u of fs.readdirSync(usersDir)) dirs.push(path.join(usersDir, u, 'AppData', 'Local', 'Programs', 'Git', 'cmd'));
    } catch { /* no users folder */ }
  } else dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin');
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try { if (fs.statSync(p).isFile()) return (gitPath = p); } catch { /* not here */ }
  }
  return (gitPath = null);
}

// Run git in `root`. The service runs as another account than the one that cloned the folder,
// which git refuses ("dubious ownership") unless the folder is named as safe; that setting is
// given here for this one command only. Git never asks for a password or opens a sign-in window.
function git(root, args, { timeout = 60e3 } = {}) {
  const bin = findGit();
  if (!bin) return Promise.reject(new Error('Git is not installed on the server'));
  const safe = root.replace(/\\/g, '/');
  return new Promise((resolve, reject) => {
    execFile(bin, ['-c', `safe.directory=${safe}`, '-c', 'credential.helper=', '-c', 'core.askPass=', ...args], {
      cwd: root, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
      shell: isWin && bin.endsWith('.cmd'),
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ') || err.message;
        return reject(Object.assign(new Error(msg), { code: err.code }));
      }
      resolve(stdout.trim());
    });
  });
}

const isGitCheckout = (root) => fs.existsSync(path.join(root, '.git'));

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

// Files git would change that someone edited by hand. Settings, logs and data are ignored by git.
async function localChanges(root) {
  const out = await git(root, ['status', '--porcelain', '--untracked-files=no']);
  return out ? out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean) : [];
}

const LOG_FORMAT = '%H%x1f%s%x1f%cI';
const parseLog = (out) => (out ? out.split('\n').map((l) => { const [sha, subject, date] = l.split('\x1f'); return { sha, subject, date }; }) : []);

function createUpdater({ root, dataDir, mock = false, onRestart = () => process.exit(RESTART_CODE), log = console }) {
  const stateFile = path.join(dataDir, 'update-state.json');
  const supervised = process.env.MEDIADESK_SUPERVISED === '1';
  let checked = null;      // the last check: { at, latest, changes, error }
  let checking = null;     // a check in progress
  let applying = false;

  // ---- Demo: two pretend updates, applied after a few seconds ----
  const demo = mock ? {
    current: { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', subject: 'Settings: search, a pinned menu and clearer saving', date: new Date(Date.now() - 3 * 864e5).toISOString() },
    changes: [
      { sha: 'f00dfeedbeefcafe0123456789abcdef01234567', subject: 'Family Organizer: a bigger Shopping mode on phones', date: new Date(Date.now() - 864e5).toISOString() },
      { sha: 'c0ffee00112233445566778899aabbccddeeff00', subject: 'Files: faster thumbnails for big folders', date: new Date(Date.now() - 2 * 36e5).toISOString() },
    ],
    last: null,
  } : null;

  async function check() {
    if (mock) return (checked = { at: Date.now(), latest: demo.changes[0]?.sha || demo.current.sha, changes: demo.changes, error: null });
    if (checking) return checking;
    checking = (async () => {
      try {
        if (!isGitCheckout(root)) throw new Error('not-git');
        await git(root, ['fetch', '--quiet', 'origin', BRANCH], { timeout: 120e3 });
        const latest = await git(root, ['rev-parse', `origin/${BRANCH}`]);
        const changes = parseLog(await git(root, ['log', `--format=${LOG_FORMAT}`, '-n', '50', `HEAD..origin/${BRANCH}`]));
        checked = { at: Date.now(), latest, changes, error: null };
      } catch (err) {
        checked = { at: Date.now(), latest: null, changes: [], error: err.message === 'not-git' ? 'not-git' : err.message };
      } finally { checking = null; }
      return checked;
    })();
    return checking;
  }

  // Why an update can't be applied now (or null when it can).
  async function blocker(cur) {
    if (!cur.git) return isWin
      ? 'MediaDesk wasn’t installed with Git, so it can’t update itself. Run install-windows.cmd on the server once: it sets this folder up for updates and keeps your settings.'
      : 'This copy wasn’t installed with Git (Docker images aren’t), so it can’t update itself. Update the image instead: git pull, then docker compose up -d --build.';
    if (!findGit()) return 'Git isn’t installed on the server. Install it (winget install Git.Git), then restart MediaDesk.';
    if (!supervised) return isWin
      ? 'MediaDesk isn’t running as a service, so it can’t restart itself. Run install-windows.cmd to install the service, or run update-windows.cmd.'
      : 'MediaDesk isn’t running under its supervisor, so it can’t restart itself. Start it with node supervisor.js (for example from systemd), or update with git pull and a restart.';
    if (cur.branch !== BRANCH) return `This copy is on the “${cur.branch || 'detached'}” branch. Run update-windows.cmd once to move it to ${BRANCH}.`;
    if (cur.dirty.length) return `Some of MediaDesk’s own files were changed on the server (${cur.dirty.slice(0, 3).join(', ')}${cur.dirty.length > 3 ? '…' : ''}), so an update could overwrite them. Undo those changes first.`;
    if (cur.ahead) return `This copy has ${cur.ahead} change${cur.ahead === 1 ? '' : 's'} that aren’t on GitHub, so it can’t move forward to the published version.`;
    return null;
  }

  async function current() {
    if (mock) return { git: true, branch: BRANCH, head: demo.current, dirty: [], ahead: 0, remote: 'https://github.com/robh1985/MediaDesk.git' };
    if (!isGitCheckout(root) || !findGit()) return { git: isGitCheckout(root), branch: null, head: null, dirty: [], ahead: 0, remote: null };
    const [branch, headLine, dirty, remote] = await Promise.all([
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
      git(root, ['log', '-1', `--format=${LOG_FORMAT}`]).catch(() => ''),
      localChanges(root).catch(() => []),
      git(root, ['remote', 'get-url', 'origin']).catch(() => null),
    ]);
    const ahead = checked?.latest ? Number(await git(root, ['rev-list', '--count', `origin/${BRANCH}..HEAD`]).catch(() => 0)) : 0;
    return { git: true, branch, head: parseLog(headLine)[0] || null, dirty, ahead, remote: remote ? remote.replace(/\/\/[^@/]+@/, '//') : null };
  }

  async function status() {
    if (!checked) await check();
    const cur = await current();
    const last = mock ? demo.last : readState(stateFile);
    const busy = applying || (last && ['pending', 'applying', 'trial'].includes(last.status));
    const changes = cur.head && checked.latest === cur.head.sha ? [] : checked.changes;
    const why = (changes.length || !cur.git) && !mock ? await blocker(cur) : null;
    return {
      git: cur.git, gitFound: mock || Boolean(findGit()), supervised: mock || supervised, branch: cur.branch, remote: cur.remote,
      current: cur.head, latest: checked.latest, behind: changes.length, changes,
      checkedAt: checked.at, error: checked.error === 'not-git' ? null : checked.error,
      canApply: Boolean(changes.length && !why && !busy), why, busy: Boolean(busy), last,
    };
  }

  async function apply(by) {
    if (applying) throw Object.assign(new Error('An update is already being applied'), { status: 409 });
    await check();
    const st = await status();
    if (!st.behind) throw Object.assign(new Error('MediaDesk is already up to date'), { status: 400 });
    if (!st.canApply) throw Object.assign(new Error(st.why || 'An update is already being applied'), { status: 409 });
    applying = true;
    const job = { id: Date.now().toString(36), status: 'pending', from: st.current.sha, to: st.latest, count: st.behind, subject: st.changes[0]?.subject || '', by: by || '', at: Date.now() };
    if (mock) {
      demo.last = job;
      setTimeout(() => { demo.last = { ...job, status: 'applying' }; }, 1000);
      setTimeout(() => {
        demo.current = demo.changes[0]; demo.changes = [];
        demo.last = { ...job, status: 'done', finishedAt: Date.now() };
        checked = null; applying = false;
      }, 4000);
      return job;
    }
    writeState(stateFile, job);
    log.log(`Update: ${by || 'someone'} asked to update from ${job.from.slice(0, 7)} to ${job.to.slice(0, 7)} (${job.count} change${job.count === 1 ? '' : 's'}); restarting`);
    // Let the reply reach the browser first.
    setTimeout(() => onRestart(RESTART_CODE), 500);
    return job;
  }

  // Look for updates now and then (the first time a few minutes after starting).
  function startSchedule(hours = 6) {
    if (mock) return;
    const run = () => check().then((c) => { if (c.changes.length) log.log(`Update available: ${c.changes.length} new change${c.changes.length === 1 ? '' : 's'} on GitHub (Settings → About)`); }).catch(() => {});
    setTimeout(run, 3 * 60e3).unref();
    setInterval(run, hours * 36e5).unref();
  }

  // GET /portal/update, POST /portal/update/check, POST /portal/update/apply
  async function handle(req, res, p, { sendJson, user }) {
    try {
      if (p === '/portal/update' && req.method === 'GET') return sendJson(res, 200, await status());
      if (p === '/portal/update/check' && req.method === 'POST') { checked = null; await check(); return sendJson(res, 200, await status()); }
      if (p === '/portal/update/apply' && req.method === 'POST') return sendJson(res, 202, { ok: true, job: await apply(user?.username || user?.name || '') });
      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      if (!err.status) applying = false;
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  return { handle, status, check, startSchedule, stateFile };
}

module.exports = { createUpdater, findGit, git, readState, writeState, localChanges, isGitCheckout, RESTART_CODE, BRANCH };
