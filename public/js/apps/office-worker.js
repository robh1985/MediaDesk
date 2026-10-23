// Runs the Office file libraries away from the page: a broken or hostile document can at worst
// break this worker, which the Preview app throws away after each file (and after a time limit).
/* global importScripts, mammoth, XLSX, JSZip */

const LIB = '/vendor/';
const MAX_ROWS = 3000;
const MAX_COLS = 120;

self.onmessage = async (e) => {
  const { kind, buffer } = e.data;
  try {
    if (kind === 'docx') {
      importScripts(`${LIB}mammoth/mammoth.browser.min.js`);
      const r = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
        styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => p.doc-subtitle:fresh", "p[style-name='Quote'] => blockquote:fresh"],
      });
      self.postMessage({ html: r.value, warnings: r.messages.filter((m) => m.type === 'warning').length });
    } else if (kind === 'sheet') {
      importScripts(`${LIB}sheetjs/xlsx.full.min.js`);
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', sheetRows: MAX_ROWS + 1, cellDates: true, dense: true });
      const sheets = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        let truncated = false;
        if (ws['!ref']) {
          const range = XLSX.utils.decode_range(ws['!ref']);
          if (range.e.c - range.s.c >= MAX_COLS) { range.e.c = range.s.c + MAX_COLS - 1; ws['!ref'] = XLSX.utils.encode_range(range); truncated = true; }
          if (range.e.r - range.s.r >= MAX_ROWS) truncated = true;
        }
        return { name, html: ws['!ref'] ? XLSX.utils.sheet_to_html(ws, { header: '', footer: '' }) : '', truncated };
      });
      self.postMessage({ sheets });
    } else if (kind === 'zip') {
      // PowerPoint: hand back the slide XML and pictures; the page lays them out.
      importScripts(`${LIB}jszip/jszip.min.js`);
      const zip = await JSZip.loadAsync(buffer);
      const xml = {}, media = {};
      let mediaBytes = 0;
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (/^ppt\/(presentation\.xml|_rels\/|slides\/|slideLayouts\/|slideMasters\/|theme\/)/.test(name) && /\.(xml|rels)$/.test(name)) {
          xml[name] = await entry.async('string');
        } else if (/^ppt\/media\/.+\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(name) && mediaBytes < 80 * 1024 * 1024) {
          const b64 = await entry.async('base64');
          mediaBytes += b64.length;
          media[name] = b64;
        }
      }
      self.postMessage({ xml, media });
    } else throw new Error(`Unknown kind ${kind}`);
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
