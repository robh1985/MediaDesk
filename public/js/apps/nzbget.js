// NZBGet: live speed, queue control, history, adding NZBs and the message log.

import { h, clear, formatBytes, formatSpeed, formatDuration, timeAgo, toast, toastError, confirmDialog,
  spinner, emptyState, errorState, progressBar, badge, poll } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { nzbget, isConfigured } from '../api.js';
import { subscribe, live } from '../live.js';
import { notConfigured, tabs } from './common.js';
import { diskRow } from './arr.js';

const MB = 1024 * 1024;

export const nzbgetApp = {
  id: 'nzbget', name: 'NZBGet', icon: appIcon.nzbget, size: [1000, 680], description: 'Usenet downloader',
  open(win) {
    if (!isConfigured('nzbget')) return clear(win.body, notConfigured('NZBGet', 'nzbget'));

    const speed = h('div', { class: 'nzb-speed' }, '—');
    const sub = h('div', { class: 'nzb-sub muted' });
    const canvas = h('canvas', { class: 'sparkline', width: 600, height: 80 });
    const pauseBtn = h('button', { class: 'btn btn-lg' });
    const limitInput = h('input', { class: 'input', type: 'number', min: 0, step: 100, placeholder: 'Unlimited', style: { width: '110px' } });
    const content = h('div', { class: 'nzb-content' });

    pauseBtn.onclick = async () => {
      const paused = live.nzb?.DownloadPaused;
      try { await nzbget(paused ? 'resumedownload' : 'pausedownload'); toast(paused ? 'Downloads resumed' : 'Downloads paused', { icon: appIcon.nzbget }); } catch (err) { toastError(err); }
    };
    const applyLimit = async () => {
      const kb = Math.max(0, Number(limitInput.value) || 0);
      try { await nzbget('rate', kb); toast(kb ? `Speed limited to ${formatSpeed(kb * 1024)}` : 'Speed limit removed', { icon: appIcon.nzbget }); } catch (err) { toastError(err); }
    };
    limitInput.addEventListener('change', applyLimit);

    const header = h('div', { class: 'nzb-header' },
      h('div', { class: 'nzb-speed-wrap' }, h('div', { class: 'muted small' }, 'Download speed'), speed, sub),
      h('div', { class: 'nzb-graph' }, canvas),
      h('div', { class: 'nzb-controls' },
        pauseBtn,
        h('label', { class: 'small muted' }, 'Limit (KB/s) ', limitInput)));

    let limitTouched = false;
    limitInput.addEventListener('focus', () => { limitTouched = true; });
    const unsub = subscribe((l) => {
      const s = l.nzb;
      if (!s) { if (l.nzbError) speed.textContent = 'Offline'; return; }
      speed.textContent = s.DownloadPaused ? 'Paused' : formatSpeed(s.speed);
      const remaining = s.RemainingSizeMB * MB;
      sub.textContent = `${formatBytes(remaining)} remaining${s.speed && !s.DownloadPaused ? ` · ${formatDuration(remaining / s.speed)} left` : ''} · ${formatBytes(s.FreeDiskSpaceMB * MB)} free`;
      clear(pauseBtn, h('span', { html: s.DownloadPaused ? icon.play : icon.pause }), s.DownloadPaused ? 'Resume all' : 'Pause all');
      pauseBtn.classList.toggle('btn-primary', Boolean(s.DownloadPaused));
      if (!limitTouched && document.activeElement !== limitInput) limitInput.value = s.DownloadLimit ? Math.round(s.DownloadLimit / 1024) : '';
      drawSparkline(canvas, l.speedHistory);
    });
    win.on('close', unsub);

    let stop;
    const show = (id) => {
      stop?.();
      clear(content);
      stop = ({ queue: renderQueue, history: renderHistory, add: renderAdd, log: renderLog, server: renderServer }[id])(content);
    };
    win.body.append(h('div', { class: 'nzb' }, header,
      tabs([['queue', 'Queue'], ['history', 'History'], ['add', 'Add NZB'], ['log', 'Messages'], ['server', 'Server']], show),
      content));
    win.on('close', () => stop?.());
  },
};

function drawSparkline(canvas, data) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 80;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = hgt * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  if (data.length < 2) return;
  const max = Math.max(...data, 1024 * 100);
  const step = w / Math.max(data.length - 1, 30);
  const pts = data.map((v, i) => [w - (data.length - 1 - i) * step, hgt - 4 - (v / max) * (hgt - 10)]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--nzb').trim() || '#22c55e';
  const grad = ctx.createLinearGradient(0, 0, 0, hgt);
  grad.addColorStop(0, accent + '66'); grad.addColorStop(1, accent + '00');
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(pts.at(-1)[0], hgt); ctx.lineTo(pts[0][0], hgt); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`peak ${formatSpeed(max)}`, 6, 14);
}

const STATUS_LABEL = {
  QUEUED: ['Queued', ''], PAUSED: ['Paused', 'muted'], DOWNLOADING: ['Downloading', 'info'], FETCHING: ['Fetching', 'info'],
  PP_QUEUED: ['Waiting to process', ''], LOADING_PARS: ['Loading pars', 'warn'], VERIFYING_SOURCES: ['Verifying', 'warn'],
  REPAIRING: ['Repairing', 'warn'], VERIFYING_REPAIRED: ['Verifying', 'warn'], RENAMING: ['Renaming', 'warn'],
  UNPACKING: ['Unpacking', 'warn'], MOVING: ['Moving', 'warn'], EXECUTING_SCRIPT: ['Running script', 'warn'], PP_FINISHED: ['Finished', 'ok'],
};

const edit = (cmd, ids, param = '') => nzbget('editqueue', cmd, param, ids);

function renderQueue(container) {
  const list = h('div', {}, spinner());
  container.append(list);
  const draw = async () => {
    try {
      const groups = await nzbget('listgroups', 0);
      if (!groups.length) return clear(list, emptyState('Queue is empty', 'Nothing to download. Add an NZB or let Radarr/Sonarr send one.'));
      const rate = live.nzb?.speed || 0;
      let ahead = 0;
      clear(list, h('div', { class: 'table nzb-table' },
        h('div', { class: 'tr th' }, h('div', {}, 'Name'), h('div', {}, 'Status'), h('div', {}, 'Progress'), h('div', {}, 'Size'), h('div', {}, 'ETA'), h('div', {})),
        groups.map((g) => {
          const total = g.FileSizeMB * MB, remaining = g.RemainingSizeMB * MB;
          const done = total ? ((total - remaining) / total) * 100 : 0;
          const paused = g.Status === 'PAUSED';
          if (!paused) ahead += remaining;
          const eta = !paused && rate ? formatDuration(ahead / rate) : '—';
          const [label, kind] = STATUS_LABEL[g.Status] || [g.Status, ''];
          return h('div', { class: 'tr' },
            h('div', { class: 'td-title' }, h('strong', { title: g.NZBName }, g.NZBName), h('span', { class: 'small muted' }, g.Category || 'No category', g.Health < 1000 ? ` · health ${(g.Health / 10).toFixed(1)}%` : '')),
            h('div', {}, badge(label, kind)),
            h('div', { class: 'td-progress' }, progressBar(done, paused ? 'muted' : ''), h('span', { class: 'small muted' }, `${done.toFixed(1)}%`)),
            h('div', { class: 'muted small' }, `${formatBytes(total - remaining)} / ${formatBytes(total)}`),
            h('div', { class: 'muted small' }, eta),
            h('div', { class: 'row-actions' },
              h('button', { class: 'btn btn-icon btn-sm', title: paused ? 'Resume' : 'Pause', html: paused ? icon.play : icon.pause,
                onclick: () => edit(paused ? 'GroupResume' : 'GroupPause', [g.NZBID]).then(draw).catch(toastError) }),
              h('button', { class: 'btn btn-icon btn-sm', title: 'Move to top', html: icon.arrowUp,
                onclick: () => edit('GroupMoveTop', [g.NZBID]).then(draw).catch(toastError) }),
              h('button', { class: 'btn btn-icon btn-sm', title: 'Delete', html: icon.trash,
                onclick: async () => {
                  if (!(await confirmDialog({ title: 'Delete download?', message: g.NZBName, confirm: 'Delete', danger: true }))) return;
                  edit('GroupDelete', [g.NZBID]).then(() => { toast('Download deleted', { body: g.NZBName }); draw(); }).catch(toastError);
                } })));
        })));
    } catch (err) { clear(list, errorState(err, draw)); }
  };
  return poll(container, draw, 3000);
}

function renderHistory(container) {
  const list = h('div', {}, spinner());
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Filter history…' });
  container.append(h('div', { class: 'toolbar' }, filter), list);
  let items = [];
  const draw = () => {
    const q = filter.value.toLowerCase();
    const shown = items.filter((i) => !q || i.Name.toLowerCase().includes(q)).slice(0, 200);
    if (!shown.length) return clear(list, emptyState('No history'));
    clear(list, h('div', { class: 'table nzb-history' },
      h('div', { class: 'tr th' }, h('div', {}, 'Name'), h('div', {}, 'Result'), h('div', {}, 'Size'), h('div', {}, 'Finished'), h('div', {})),
      shown.map((i) => {
        const ok = String(i.Status).startsWith('SUCCESS');
        const status = String(i.Status).split('/');
        return h('div', { class: 'tr' },
          h('div', { class: 'td-title' }, h('strong', { title: i.Name }, i.Name), h('span', { class: 'small muted' }, i.Category || 'No category')),
          h('div', {}, badge(ok ? 'Success' : status[1] ? `${status[0][0]}${status[0].slice(1).toLowerCase()}: ${status[1].toLowerCase()}` : status[0], ok ? 'ok' : status[0] === 'DELETED' ? '' : 'bad')),
          h('div', { class: 'muted small' }, formatBytes(i.FileSizeMB * MB)),
          h('div', { class: 'muted small' }, timeAgo(i.HistoryTime * 1000)),
          h('div', { class: 'row-actions' },
            !ok ? h('button', { class: 'btn btn-icon btn-sm', title: 'Download again', html: icon.refresh,
              onclick: () => edit('HistoryRedownload', [i.NZBID]).then(() => { toast('Re-queued', { body: i.Name }); load(); }).catch(toastError) }) : null,
            h('button', { class: 'btn btn-icon btn-sm', title: 'Remove from history', html: icon.trash,
              onclick: () => edit('HistoryDelete', [i.NZBID]).then(load).catch(toastError) })));
      })));
  };
  const load = async () => {
    try { items = await nzbget('history', false); draw(); } catch (err) { clear(list, errorState(err, load)); }
  };
  filter.addEventListener('input', draw);
  return poll(container, load, 15000);
}

function renderAdd(container) {
  const url = h('input', { class: 'input input-lg', type: 'url', placeholder: 'https://indexer.example/getnzb/…' });
  const file = h('input', { type: 'file', accept: '.nzb,application/x-nzb', class: 'input' });
  const cat = h('select', { class: 'input' }, h('option', { value: '' }, 'No category'));
  const prio = h('select', { class: 'input' }, [['0', 'Normal'], ['50', 'High'], ['100', 'Very high'], ['900', 'Force'], ['-50', 'Low'], ['-100', 'Very low']].map(([v, l]) => h('option', { value: v }, l)));
  const top = h('input', { type: 'checkbox' });
  const paused = h('input', { type: 'checkbox' });
  const submit = h('button', { class: 'btn btn-primary btn-lg' }, h('span', { html: icon.plus }), 'Add to queue');

  nzbget('config').then((cfg) => {
    const names = cfg.filter((o) => /^Category\d+\.Name$/.test(o.Name) && o.Value).map((o) => o.Value);
    cat.append(...names.map((n) => h('option', { value: n }, n)));
  }).catch(() => {});

  submit.onclick = async () => {
    let name = '', content = '';
    if (file.files[0]) {
      const f = file.files[0];
      name = f.name;
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      content = btoa(bin);
    } else if (url.value.trim()) {
      content = url.value.trim();
    } else return toast('Paste a URL or choose an .nzb file', { type: 'error' });
    submit.disabled = true;
    try {
      const id = await nzbget('append', name, content, cat.value, Number(prio.value), top.checked, paused.checked, '', 0, 'SCORE', []);
      if (id <= 0) throw new Error('NZBGet could not add this NZB');
      toast('Added to queue', { body: name || content, type: 'success', icon: appIcon.nzbget });
      url.value = ''; file.value = '';
    } catch (err) { toastError(err, 'Add failed'); }
    submit.disabled = false;
  };

  container.append(h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, 'NZB URL'), url),
    h('div', { class: 'or' }, 'or'),
    h('label', { class: 'field' }, h('span', {}, 'Upload .nzb file'), file),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Category'), cat),
      h('label', { class: 'field' }, h('span', {}, 'Priority'), prio)),
    h('div', { class: 'field-row' },
      h('label', { class: 'check' }, top, ' Add to top of queue'),
      h('label', { class: 'check' }, paused, ' Add paused')),
    submit));
}

function renderLog(container) {
  const list = h('div', { class: 'log' }, spinner());
  container.append(list);
  const draw = async () => {
    try {
      const entries = await nzbget('log', 0, 150);
      if (!entries.length) return clear(list, emptyState('No messages'));
      clear(list, [...entries].reverse().map((e) => h('div', { class: `log-line log-${String(e.Kind).toLowerCase()}` },
        h('span', { class: 'log-time' }, new Date(e.Time * 1000).toLocaleTimeString()),
        h('span', { class: 'log-kind' }, e.Kind),
        h('span', { class: 'log-text' }, e.Text))));
    } catch (err) { clear(list, errorState(err, draw)); }
  };
  return poll(container, draw, 10000);
}

function renderServer(container) {
  const body = h('div', {}, spinner());
  container.append(body);
  Promise.all([nzbget('version'), nzbget('status')]).then(([version, s]) => {
    clear(body,
      h('div', { class: 'cards' },
        stat('Version', version),
        stat('Uptime', formatDuration(s.UpTimeSec)),
        stat('Downloaded (total)', formatBytes(s.DownloadedSizeMB * MB)),
        stat('Average speed', formatSpeed(s.AverageDownloadRate ?? 0)),
        stat('Threads', s.ThreadCount),
        stat('Post-processing jobs', s.PostJobCount)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => nzbget('scan').then(() => toast('Scanning incoming NZB folder')).catch(toastError) }, h('span', { html: icon.folder }), 'Scan NZB folder'),
        h('button', { class: 'btn', onclick: () => nzbget(s.PostPaused ? 'resumepost' : 'pausepost').then(() => toast(s.PostPaused ? 'Post-processing resumed' : 'Post-processing paused')).catch(toastError) },
          h('span', { html: s.PostPaused ? icon.play : icon.pause }), s.PostPaused ? 'Resume post-processing' : 'Pause post-processing')),
      h('h3', { class: 'section-title' }, 'Disk'),
      h('div', { class: 'disks' }, diskRow('Destination', (s.TotalDiskSpaceMB || s.FreeDiskSpaceMB) * MB, s.FreeDiskSpaceMB * MB)));
  }).catch((err) => clear(body, errorState(err)));
}

const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
