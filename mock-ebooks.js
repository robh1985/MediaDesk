// Demo mode's bookshelf: a few small books MediaDesk makes itself (an EPUB story with chapters,
// a contents page, a cover and a picture; a PDF guide; a comic book) so the eBook Reader has
// something to open.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');

// --- A zip writer (deflated entries; the EPUB's mimetype stored first, as EPUB requires) -----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content, store] of files) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const data = store ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt32LE(crc32(raw), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, end]);
}

// --- The story -----------------------------------------------------------------------------
const CHAPTERS = [
  ['The Keeper', [
    'On the far edge of the Sallow Coast, where the road gave up and the gulls took over, there stood a lighthouse painted in faded stripes of red and white. Its keeper was a woman named Ada Thorne, who had kept the light burning for thirty-one winters and could tell the weather by the way the kettle sang.',
    'Every evening at dusk she climbed the one hundred and twelve steps to the lamp room, counting them aloud the way her father had taught her. At the top she trimmed the wick, polished the great lens until it shone like a second moon, and wrote a single line in the logbook: the date, the wind, and one thing she had noticed that day.',
    'The logbook was the only company she kept, apart from a one-eyed cat called Pilot who had arrived in a fishing crate and never left. Pilot did not care for the sea, which Ada thought was a sensible position for a cat who lived on a rock in the middle of it.',
    'Ships passed rarely now. The big freighters had their satellites and their screens, and the little boats from the village kept close to the harbour. Still, Ada lit the lamp each night, because a light that is only lit when someone is watching is not really a light at all.',
  ]],
  ['A Letter from the Mainland', [
    'The letter came on a Tuesday, carried out by Tom Brannock in his blue dinghy along with the bread, the paraffin and the newspaper that was always three days old. It was a long envelope with a window in it, the kind that never brings good news.',
    '“They’re automating you,” Tom said, before she had even opened it. “The whole coast. Little machines that switch themselves on. No keepers needed.” He said it kindly, the way you might tell someone their favourite chair had woodworm.',
    'Ada read the letter twice, folded it into a careful square and put it under the teapot. The machines would arrive in the spring, it said. She would be offered a cottage in the village and a small pension and the gratitude of the Maritime Authority.',
    'That night, when she climbed the steps, she lost count somewhere around seventy and had to stand on the landing for a long minute with her hand on the cold iron rail, listening to the wind try every window in the tower.',
  ]],
  ['The Storm', [
    'The storm arrived in the second week of February, three days earlier than the forecast said it would and twice as angry. It came in from the west with a noise like a train that never finished passing, and by midnight the spray was reaching the lamp room windows, one hundred and twelve steps above the rocks.',
    'Ada kept the light turning. She wound the clockwork by hand when the motor stuttered, she wiped the salt from the glass with an old shirt, and she talked to Pilot, who had retreated into the coal scuttle and was not taking visitors.',
    'At two in the morning she saw it: a small light, low on the water, flickering in and out of the troughs like a candle somebody was trying to carry through a crowd. A boat, far too small for this weather, and far too close to the Shrike Rocks.',
    'There was no radio worth the name, only the old lamp and the old woman who knew how to work it. So Ada did the only thing she could think of. She began to flash the light in the long, slow pattern her father had used for the fishing fleet, the one that meant: here is the channel, follow me home.',
  ]],
  ['Follow Me Home', [
    'For an hour the little light wandered, lost and then found and lost again. Ada’s arms ached from turning the shutter. Her fingers had gone white and then red and then stopped telling her anything at all. Twice she thought the boat had gone under, and twice it reappeared, a spark against the black.',
    'Then, slowly, impossibly, it began to follow. It turned when the light turned. It slowed when the light slowed. It crept along the narrow channel between the Shrike Rocks and the Gannet Shoal, a passage so tight that the old fishermen said you could shake hands with both of them on the way through.',
    'At dawn the storm blew itself out, the way storms do, suddenly and with nothing to show for itself but wet stones and a sky the colour of a bruise. In the harbour, tied up next to Tom Brannock’s blue dinghy, sat a battered yellow sailing boat with a torn sail and two very tired teenagers aboard.',
    'They had borrowed it, they admitted later, without exactly asking. They had seen a light, they said, and decided it was the only thing in the world that knew where it was going.',
  ]],
  ['Spring', [
    'The machines arrived in April, as the letter had promised. They were small and grey and very polite, with green lights that blinked to say everything was fine. The engineers who fitted them were polite too, and admired the lens, and took photographs of the logbook.',
    'Ada moved into the cottage in the village. It had a garden and a view of the harbour and a stove that did not need to be lit with a twist of newspaper. Pilot inspected every room and decided, after some consideration, that he approved of solid ground.',
    'But in the evenings, at dusk, people in the village began to notice something. The old woman from the lighthouse would walk to the end of the harbour wall with a lantern, and stand there for a while, and then walk home.',
    'Nobody asked her why. The two teenagers, who now had jobs mending nets, sometimes walked out with her. After a while, other people did too. By midsummer there were a dozen lanterns on the harbour wall each night, small and steady, all of them pointing out to sea.',
  ]],
  ['The Logbook', [
    'The Maritime Authority, it turned out, had been wrong about one thing. The little grey machines did not like salt, and the salt did not like them. In the first autumn gale the light on the Sallow Coast went dark for six hours, and nobody noticed until a trawler skipper complained.',
    'They asked Ada, very politely, whether she might keep an eye on things. Just occasionally. Just when the weather turned.',
    'She took the logbook back down from the shelf, opened it to a clean page, and wrote: the date, the wind, and one thing she had noticed that day. Then, underneath, in smaller letters, she added a second line, which she had never needed before.',
    '“Lights are kept by people,” she wrote. “The machine only turns it on.”',
  ]],
];

const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1d3a"/><stop offset=".65" stop-color="#27507a"/><stop offset="1" stop-color="#f4a261"/></linearGradient></defs>
<rect width="600" height="900" fill="url(#sky)"/>
<g fill="#fff" opacity=".8"><circle cx="80" cy="90" r="2"/><circle cx="190" cy="150" r="1.5"/><circle cx="500" cy="80" r="2.2"/><circle cx="420" cy="200" r="1.4"/><circle cx="300" cy="60" r="1.8"/></g>
<path d="M300 300 L 600 250 L 600 350 Z" fill="#fff6c9" opacity=".35"/><path d="M300 300 L 0 260 L 0 340 Z" fill="#fff6c9" opacity=".25"/>
<path d="M270 330 L330 330 L345 720 L255 720 Z" fill="#f2f2f2"/><path d="M262 450 L338 450 L341 520 L259 520 Z M257 600 L343 600 L345 660 L255 660 Z" fill="#c0392b"/>
<rect x="268" y="290" width="64" height="44" rx="6" fill="#ffe08a"/><path d="M262 290 L338 290 L300 255 Z" fill="#2d3436"/>
<path d="M0 720 Q150 690 300 720 T600 720 V900 H0 Z" fill="#14324f"/><path d="M0 760 Q150 735 300 760 T600 760 V900 H0 Z" fill="#0d2238"/>
<text x="300" y="160" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="#fff">The Lighthouse</text>
<text x="300" y="225" text-anchor="middle" font-family="Georgia, serif" font-size="58" fill="#fff">Keeper</text>
<text x="300" y="840" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#f6d7b0" letter-spacing="4">MARGARET HALE</text></svg>`;

const PICTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480"><rect width="800" height="480" fill="#1b2a41"/>
<path d="M0 330 Q200 270 400 330 T800 330 V480 H0 Z" fill="#324a5f"/><path d="M0 370 Q200 330 400 370 T800 370 V480 H0 Z" fill="#0c1821"/>
<path d="M560 300 l40 -10 l30 30 h-80z" fill="#f4d35e"/><path d="M590 230 v60" stroke="#ccc" stroke-width="4"/><path d="M592 235 l35 45 h-35z" fill="#eee"/>
<path d="M120 120 L 800 60 L 800 180 Z" fill="#fff6c9" opacity=".3"/><rect x="95" y="110" width="40" height="190" fill="#eee"/><rect x="92" y="95" width="46" height="24" fill="#ffe08a"/></svg>`;

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;

function storyEpub() {
  const files = [['mimetype', 'application/epub+zip', true],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/style.css', 'body { font-family: serif; } h1 { text-align: center; } .drop:first-letter { font-size: 3em; float: left; }'],
    ['OEBPS/images/cover.svg', COVER_SVG],
    ['OEBPS/images/harbour.svg', PICTURE_SVG],
    ['OEBPS/title.xhtml', xhtml('Title', '<section epub:type="titlepage" style="text-align:center"><h1>The Lighthouse Keeper</h1><p><em>A short story</em></p><p>Margaret Hale</p><p>&#160;</p><p><small>A demo book made by MediaDesk.</small></p></section>')]];
  CHAPTERS.forEach(([title, paras], i) => {
    const body = `<h1 id="c${i + 1}">Chapter ${i + 1}<br/>${title}</h1>${paras.map((p, n) => `<p${n === 0 ? ' class="drop"' : ''}>${p}</p>`).join('')}${i === 3 ? '<figure><img src="images/harbour.svg" alt="A small boat in the harbour beneath the lighthouse"/><figcaption>The yellow boat, safe in the harbour.</figcaption></figure>' : ''}`;
    files.push([`OEBPS/ch${i + 1}.xhtml`, xhtml(title, body)]);
  });
  files.push(['OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${CHAPTERS.map(([t], i) => `<li><a href="ch${i + 1}.xhtml#c${i + 1}">${i + 1}. ${t}</a></li>`).join('')}</ol></nav>`)]);
  files.push(['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:mediadesk:demo:lighthouse</dc:identifier><dc:title>The Lighthouse Keeper</dc:title><dc:creator>Margaret Hale</dc:creator><dc:language>en</dc:language><meta name="cover" content="cover"/></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="cover" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/><item id="harbour" href="images/harbour.svg" media-type="image/svg+xml"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${CHAPTERS.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine><itemref idref="title"/>${CHAPTERS.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('')}</spine></package>`]);
  return zip(files);
}

// --- A PDF: a short illustrated garden guide -------------------------------------------------
function gardenPdf() {
  const W = 420, H = 595;
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const wrap = (text, max) => { const out = []; let line = ''; for (const w of text.split(' ')) { if ((`${line} ${w}`).trim().length > max) { out.push(line.trim()); line = w; } else line += ` ${w}`; } if (line.trim()) out.push(line.trim()); return out; };
  const PAGES = [
    { title: 'The Kitchen Garden', color: '0.18 0.55 0.34', text: 'A small guide to growing your own vegetables, herbs and flowers through the year. Made by MediaDesk as a demo book.' },
    { title: 'Spring: Sowing', color: '0.36 0.68 0.33', text: 'Start peas, broad beans and lettuce outdoors as soon as the soil can be worked. Sow tomatoes and peppers indoors on a sunny windowsill, six to eight weeks before the last frost. Water little and often, and keep slugs away with a ring of grit.' },
    { title: 'Summer: Growing', color: '0.95 0.65 0.18', text: 'Water deeply in the early morning. Pinch out the side shoots of tomatoes, tie in climbing beans and pick courgettes while they are small and sweet. Sow a fresh row of salad every two weeks so there is always something to eat.' },
    { title: 'Autumn: Harvest', color: '0.85 0.38 0.16', text: 'Lift potatoes on a dry day and let them dry before storing them somewhere dark. Pick apples when they come away with a gentle twist. Plant garlic and spring bulbs, and spread compost over empty beds.' },
    { title: 'Winter: Planning', color: '0.27 0.4 0.62', text: 'Clean and sharpen your tools, order seeds and draw a plan of next year. Rotate crops so that each family of plants grows in a new bed: beans, then brassicas, then roots, then potatoes.' },
    { title: 'Herbs', color: '0.45 0.6 0.3', text: 'Mint spreads, so grow it in a pot. Basil loves warmth. Rosemary, thyme and sage like poor, dry soil and full sun. Parsley and chives are happy almost anywhere and come back year after year.' },
    { title: 'Notes', color: '0.5 0.5 0.5', text: 'Keep a garden diary: what you sowed, when it came up, what the weather did. Next year you will be glad you did.' },
  ];
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const parentId = 3 + PAGES.length * 2; // placeholder, fixed below
  const contents = PAGES.map((pg, i) => {
    const lines = wrap(pg.text, 52);
    let s = `${pg.color} rg 0 ${H - 170} ${W} 170 re f 1 1 1 rg BT /F2 ${i === 0 ? 30 : 24} Tf 32 ${H - 100} Td (${esc(pg.title)}) Tj ET `;
    s += `${pg.color} rg ${W / 2} 150 m ${W / 2 - 60} 90 l ${W / 2 + 60} 90 l f 0.3 0.25 0.2 rg ${W / 2 - 6} 60 12 30 re f `;
    s += `0.15 0.15 0.15 rg BT /F1 13 Tf 32 ${H - 215} Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET `;
    s += `0.5 0.5 0.5 rg BT /F1 10 Tf ${W - 50} 30 Td (${i + 1}) Tj ET`;
    return s;
  });
  const contentIds = contents.map((c) => add(`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}\nendstream`));
  const pagesIdx = objs.length + PAGES.length + 1;
  PAGES.forEach((_, i) => pageIds.push(add(`<< /Type /Page /Parent ${pagesIdx} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`)));
  const pages = add(`<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  const info = add('<< /Title (The Kitchen Garden) /Author (MediaDesk) >>');
  void parentId;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// --- A comic: pictures in a zip ---------------------------------------------------------------
function comicCbz() {
  const panel = (i, bg, caption, art) => `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="1000" viewBox="0 0 660 1000"><rect width="660" height="1000" fill="#fffdf5"/>
<rect x="30" y="30" width="600" height="${i === 0 ? 940 : 600}" rx="10" fill="${bg}" stroke="#222" stroke-width="6"/>${art}
${i === 0 ? '' : `<rect x="30" y="660" width="600" height="310" rx="10" fill="#fff" stroke="#222" stroke-width="6"/><text x="60" y="740" font-family="Comic Sans MS, Chalkboard, sans-serif" font-size="34" fill="#222">${caption}</text><text x="600" y="950" text-anchor="end" font-family="sans-serif" font-size="22" fill="#888">${i}</text>`}</svg>`;
  const cat = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="60" rx="70" ry="55" fill="#f08c00" stroke="#222" stroke-width="5"/><circle cx="0" cy="-10" r="55" fill="#f08c00" stroke="#222" stroke-width="5"/><path d="M-45 -40 L-40 -85 L-10 -55 Z M45 -40 L40 -85 L10 -55 Z" fill="#f08c00" stroke="#222" stroke-width="5"/><circle cx="-20" cy="-15" r="8" fill="#222"/><circle cx="20" cy="-15" r="8" fill="#222"/><path d="M-8 8 Q0 15 8 8" stroke="#222" stroke-width="4" fill="none"/><circle cx="0" cy="-10" r="72" fill="#cfe8ff" opacity=".35" stroke="#fff" stroke-width="4"/></g>`;
  const pages = [
    panel(0, '#1d1b4b', '', `<g fill="#fff">${Array.from({ length: 40 }, (_, k) => `<circle cx="${(k * 97) % 600 + 30}" cy="${(k * 151) % 900 + 40}" r="${(k % 3) + 1}"/>`).join('')}</g>${cat(330, 520, 1.6)}<text x="330" y="170" text-anchor="middle" font-family="Impact, sans-serif" font-size="96" fill="#ffd43b" stroke="#222" stroke-width="4">SPACE CAT</text><text x="330" y="880" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#fff">A MediaDesk demo comic</text>`),
    panel(1, '#cfe8ff', 'Biscuit was bored of the windowsill.', `${cat(330, 330, 1.3)}<rect x="60" y="480" width="540" height="40" fill="#8d6e63"/>`),
    panel(2, '#ffe3e3', 'So she built a rocket out of boxes.', `<path d="M330 120 L410 330 L410 520 L250 520 L250 330 Z" fill="#c9a26b" stroke="#222" stroke-width="5"/><circle cx="330" cy="300" r="40" fill="#cfe8ff" stroke="#222" stroke-width="5"/>${cat(140, 470, .6)}`),
    panel(3, '#1d1b4b', '3... 2... 1... LIFT OFF!', `<path d="M330 80 L400 260 L400 420 L260 420 Z" fill="#c9a26b" stroke="#222" stroke-width="5"/><path d="M270 420 L330 590 L390 420 Z" fill="#ff922b"/><path d="M295 420 L330 520 L365 420 Z" fill="#ffd43b"/>`),
    panel(4, '#2b2d42', 'The moon was made of... cheese?!', `<circle cx="330" cy="420" r="230" fill="#ffe066" stroke="#222" stroke-width="5"/><circle cx="260" cy="360" r="30" fill="#fcc419"/><circle cx="400" cy="470" r="45" fill="#fcc419"/>${cat(330, 160, .7)}`),
    panel(5, '#cfe8ff', 'Best. Trip. Ever. The End.', `${cat(330, 330, 1.3)}<path d="M200 520 h260 v30 h-260z" fill="#ffe066" stroke="#222" stroke-width="4"/>`),
  ];
  return zip(pages.map((svg, i) => [`Space Cat/page${String(i + 1).padStart(2, '0')}.svg`, svg]));
}

function createSample() {
  const dir = path.join(os.tmpdir(), 'mediadesk-demo-books');
  fs.mkdirSync(path.join(dir, 'Comics'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'The Lighthouse Keeper.epub'), storyEpub());
  fs.writeFileSync(path.join(dir, 'The Kitchen Garden - MediaDesk.pdf'), gardenPdf());
  fs.writeFileSync(path.join(dir, 'Comics', 'Space Cat.cbz'), comicCbz());
  return { dir };
}

module.exports = { createSample, zip, storyEpub, gardenPdf, comicCbz };
