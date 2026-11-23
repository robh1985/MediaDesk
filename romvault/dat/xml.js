// A small, dependency-free XML reader for DAT files: elements, attributes, text, CDATA, comments and
// entity references. DTDs and processing instructions are skipped. It builds a tree with the few
// XmlDocument-style helpers that RomVault's DAT readers use (selectSingleNode, selectNodes, attr, innerText).
'use strict';

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENT[e] ?? m;
  });
}

class XmlNode {
  constructor(name, attrs, parent) { this.name = name; this.attrs = attrs; this.parent = parent; this.children = []; this.text = ''; }
  attr(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  selectNodes(n) { return this.children.filter((c) => c.name === n); }
  selectSingleNode(n) { return this.children.find((c) => c.name === n) || null; }
  get innerText() {
    if (!this.children.length) return this.text;
    return this.text + this.children.map((c) => c.innerText).join('');
  }
}

function parseXml(src) {
  const doc = new XmlNode('#document', {}, null);
  let cur = doc;
  let i = 0;
  const n = src.length;
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { if (cur !== doc) cur.text += decode(src.slice(i)); break; }
    if (lt > i && cur !== doc) cur.text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9); cur.text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue;
    }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [ ].
      let j = lt + 2; let depth = 0;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt + 2);
      const name = src.slice(lt + 2, e).trim();
      // Close up to the matching element (tolerates small nesting errors).
      let p = cur;
      while (p && p !== doc && p.name !== name) p = p.parent;
      if (p && p !== doc) cur = p.parent;
      i = e < 0 ? n : e + 1; continue;
    }
    // Start tag
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j++;
    const name = src.slice(lt + 1, j);
    const attrs = {};
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (j >= n) break;
      if (src[j] === '>' || (src[j] === '/' && src[j + 1] === '>')) break;
      let k = j;
      while (k < n && !/[\s=/>]/.test(src[k])) k++;
      const an = src.slice(j, k);
      j = k;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '=') {
        j++;
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          attrs[an] = decode(src.slice(j + 1, e < 0 ? n : e));
          j = e < 0 ? n : e + 1;
        } else {
          let e = j;
          while (e < n && !/[\s>]/.test(src[e])) e++;
          attrs[an] = decode(src.slice(j, e));
          j = e;
        }
      } else if (an) {
        attrs[an] = an;
      } else {
        j++;
      }
    }
    const node = new XmlNode(name, attrs, cur);
    cur.children.push(node);
    if (src[j] === '/') { i = j + 2; } else { cur = node; i = j + 1; }
  }
  doc.documentElement = doc.children[0] || null;
  return doc;
}

module.exports = { parseXml, XmlNode };
