'use strict';
// Keeps MediaDesk running, and applies updates safely. The Windows service runs this file;
// it runs server.js, restarts it if it stops, and handles updates asked for in Settings → About:
//
//   1. The server writes update-state.json ({ status: 'pending', from, to }) and exits with 75.
//   2. Here: check nothing was edited by hand, move the code forward (git merge --ff-only), and
//      check every file still parses.
//   3. Start the new server on trial. It must say it's ready (listening) within two minutes and
//      then keep running for 30 seconds.
//   4. If it doesn't, put the old code back (git reset --hard <from>), start that again, and record
//      why in update-state.json so Settings → About can show it.
//
// Usage: node supervisor.js [--log <file>] [--stdin-stop] [other server.js options]
//   --log         write the server's and this file's messages to a log file
//   --stdin-stop  stop when standard input closes (how the Windows service asks it to stop)

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { git, readState, writeState, localChanges, RESTART_CODE } = require('./updater');

const ROOT = __dirname;
const SERVER = path.join(ROOT, 'server.js');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, 'config', 'config.json');
const STATE_FILE = path.join(path.dirname(CONFIG_PATH), 'update-state.json');
const READY_MS = Number(process.env.MEDIADESK_READY_MS) || 120e3;   // time to start listening
const STABLE_MS = Number(process.env.MEDIADESK_STABLE_MS) || 30e3;  // then keep running this long
const RELOAD_SELF_CODE = 3;   // exit code that asks the service to start this file again

const argv = process.argv.slice(2);
const logArg = argv.indexOf('--log');
const logFile = logArg !== -1 && argv[logArg + 1] ? path.resolve(argv[logArg + 1]) : null;
const stdinStop = argv.includes('--stdin-stop');
const serverArgs = argv.filter((a, i) => a !== '--stdin-stop' && i !== logArg && i !== logArg + 1);

// The log starts with a UTF-8 byte-order mark so Windows tools show ’ and — properly (see logfile.js).
if (logFile) { try { require('./logfile').prepareLog(logFile); } catch { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } }
function log(...parts) {
  const line = `[${new Date().toISOString()}] Supervisor: ${parts.join(' ')}`;
  if (logFile) { try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* log unavailable */ } } else console.log(line);
}

let child = null;
let stopping = false;
let trial = null;          // the update being tried: { job, readyTimer, stableTimer }
let crashes = [];          // times the server stopped by itself
let restartTimer = null;

function startServer() {
  restartTimer = null;
  if (stopping) return;
  const args = [SERVER, ...serverArgs, ...(logFile ? ['--log', logFile] : [])];
  child = spawn(process.execPath, args, {
    cwd: ROOT, windowsHide: true,
    stdio: logFile ? ['ignore', 'ignore', 'ignore', 'ipc'] : ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, MEDIADESK_SUPERVISED: '1' },
  });
  const me = child;
  me.startedAt = Date.now();
  me.on('message', (m) => { if (m && m.type === 'ready' && me === child) onReady(); });
  me.on('error', (err) => log(`could not start the server: ${err.message}`));
  me.on('exit', (code, signal) => { if (me === child) onExit(code, signal); });
  if (trial) {
    trial.readyTimer = setTimeout(() => failTrial(`the new version didn’t start within ${Math.round(READY_MS / 1000)} seconds`), READY_MS);
  }
}

function onReady() {
  if (!trial) return;
  clearTimeout(trial.readyTimer);
  log(`the new version is running; checking it stays up for ${Math.round(STABLE_MS / 1000)} seconds`);
  trial.stableTimer = setTimeout(passTrial, STABLE_MS);
}

function onExit(code, signal) {
  child = null;
  if (stopping) return;
  if (trial) return failTrial(`the new version stopped (exit code ${code ?? signal})`);
  if (code === RESTART_CODE) {
    const job = readState(STATE_FILE);
    if (job && job.status === 'pending') return applyUpdate(job);
    log('restart requested');
    return startServer();
  }
  // Stopped by itself: start again, waiting longer each time it keeps stopping.
  const now = Date.now();
  crashes = crashes.filter((t) => now - t < 10 * 60e3).concat(now);
  const delay = [1, 2, 5, 10, 30, 60][Math.min(crashes.length - 1, 5)] * 1000;
  log(`the server stopped (exit code ${code ?? signal}); starting it again in ${delay / 1000} s`);
  restartTimer = setTimeout(startServer, delay);
}

const short = (sha) => String(sha || '').slice(0, 7);
function saveJob(job, fields) {
  Object.assign(job, fields);
  try { writeState(STATE_FILE, job); } catch (err) { log(`could not save the update state: ${err.message}`); }
}

// Every .js file MediaDesk runs must at least parse before the new version is started.
function syntaxCheck() {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, f));
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', windowsHide: true, timeout: 30e3 }); } catch (err) {
      const lines = String(err.stderr || err.message).trim().split('\n');
      throw new Error(`${path.basename(f)} has an error: ${lines.find((l) => /Error/.test(l)) || lines[0]}`);
    }
  }
}

async function applyUpdate(job) {
  log(`updating from ${short(job.from)} to ${short(job.to)}`);
  saveJob(job, { status: 'applying', startedAt: Date.now() });
  try {
    const head = await git(ROOT, ['rev-parse', 'HEAD']);
    if (head !== job.from) throw new Error(`the code changed since the update was asked for (now ${short(head)})`);
    const dirty = await localChanges(ROOT);
    if (dirty.length) throw new Error(`files were changed by hand: ${dirty.slice(0, 3).join(', ')}`);
    await git(ROOT, ['cat-file', '-e', `${job.to}^{commit}`]);
    await git(ROOT, ['merge', '--ff-only', '--quiet', job.to], { timeout: 180e3 });
  } catch (err) {
    log(`update not applied: ${err.message}`);
    await putBack(job);
    saveJob(job, { status: 'failed', error: `The update couldn’t be applied: ${err.message}. Nothing was changed.`, finishedAt: Date.now() });
    return startServer();
  }
  try { syntaxCheck(); } catch (err) {
    log(`update rolled back before starting: ${err.message}`);
    await putBack(job);
    saveJob(job, { status: 'rolled-back', error: `The new version has a problem (${err.message}), so the previous version was kept.`, finishedAt: Date.now() });
    return startServer();
  }
  beginTrial(job);
}

function beginTrial(job) {
  saveJob(job, { status: 'trial' });
  trial = { job };
  startServer();
}

async function passTrial() {
  const { job } = trial;
  trial = null;
  crashes = [];
  saveJob(job, { status: 'done', finishedAt: Date.now() });
  log(`update to ${short(job.to)} finished`);
  // If this file (or the service itself) changed, the service starts the new copy of it.
  let changed = [];
  try { changed = (await git(ROOT, ['diff', '--name-only', job.from, job.to])).split('\n'); } catch { /* keep running */ }
  if (stdinStop && changed.some((f) => f === 'supervisor.js' || f === 'updater.js')) {
    log('the supervisor itself was updated; restarting it');
    stopServer(() => process.exit(RELOAD_SELF_CODE));
  }
}

async function failTrial(reason) {
  if (!trial) return;
  const { job } = trial;
  clearTimeout(trial.readyTimer); clearTimeout(trial.stableTimer);
  trial = null;
  log(`update to ${short(job.to)} failed: ${reason}; going back to ${short(job.from)}`);
  const wasRunning = child;
  const rollBack = async () => {
    const ok = await putBack(job);
    saveJob(job, {
      status: ok ? 'rolled-back' : 'failed',
      error: ok ? `The new version didn’t start properly (${reason}), so the previous version was put back.` : `The new version didn’t start properly (${reason}) and the previous version couldn’t be put back automatically. Run update-windows.cmd on the server.`,
      finishedAt: Date.now(),
    });
    startServer();
  };
  if (wasRunning) stopServer(rollBack); else rollBack();
}

// Back to the version before the update. Only MediaDesk's own files are touched: settings, data
// and logs are ignored by git.
async function putBack(job) {
  try {
    const head = await git(ROOT, ['rev-parse', 'HEAD']);
    if (head !== job.from) await git(ROOT, ['reset', '--hard', '--quiet', job.from], { timeout: 180e3 });
    return true;
  } catch (err) {
    log(`could not go back to ${short(job.from)}: ${err.message}`);
    return false;
  }
}

// Ask the server to stop (so it can unmount cloud drives and finish writing), then make sure.
function stopServer(done = () => {}) {
  const c = child;
  if (!c) return done();
  child = null;
  let finished = false;
  const finish = () => { if (!finished) { finished = true; clearTimeout(force); done(); } };
  c.once('exit', finish);
  try { c.send({ type: 'shutdown' }); } catch { /* channel closed */ }
  const force = setTimeout(() => { try { c.kill(); } catch { /* gone */ } setTimeout(finish, 2000); }, 10e3);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  if (trial) { clearTimeout(trial.readyTimer); clearTimeout(trial.stableTimer); }
  log('stopping');
  stopServer(() => process.exit(code));
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
if (stdinStop) {
  process.stdin.on('end', () => stopAll(0));
  process.stdin.on('close', () => stopAll(0));
  process.stdin.resume();
}

// Started again in the middle of an update (power cut, or the supervisor was updated):
// carry on checking the new version, or go back if the code never moved.
(async () => {
  log(`starting MediaDesk (${ROOT})`);
  const job = readState(STATE_FILE);
  if (job && ['pending', 'applying', 'trial'].includes(job.status)) {
    let head = null;
    try { head = await git(ROOT, ['rev-parse', 'HEAD']); } catch { /* no git */ }
    if (job.status === 'pending' && head === job.from) return applyUpdate(job);
    if (head && head === job.to) { log(`resuming the check of the update to ${short(job.to)}`); return beginTrial(job); }
    if (head && head !== job.from) await putBack(job);
    saveJob(job, { status: 'failed', error: 'The update was interrupted, so the previous version was kept.', finishedAt: Date.now() });
  }
  startServer();
})();
