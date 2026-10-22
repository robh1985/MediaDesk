import { h } from '../ui.js';
import { appIcon } from '../icons.js';

export function notConfigured(name, svc) {
  return h('div', { class: 'empty not-configured' },
    h('div', { class: 'big-icon', html: appIcon[svc] }),
    h('div', { class: 'empty-title' }, `${name} isn’t connected yet`),
    h('div', {}, `Add its URL${svc === 'nzbget' ? ' and login' : ' and API key'} in Settings to manage it from here.`),
    h('button', { class: 'btn btn-primary', onclick: () => import('../wm.js').then((wm) => wm.openApp('settings')) }, 'Open Settings'));
}

export function tabs(items, onSelect, initial) {
  const bar = h('div', { class: 'tabs' });
  const set = (id) => {
    bar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
    onSelect(id);
  };
  for (const [id, label] of items) bar.append(h('button', { class: 'tab', dataset: { id }, onclick: () => set(id) }, label));
  queueMicrotask(() => set(initial || items[0][0]));
  bar.select = set;
  return bar;
}
