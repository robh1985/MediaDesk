# Third-party libraries

These are loaded only when needed (by Preview, Plex Viewer and the eBook Reader). Each folder holds the library's licence.

| Folder | Library | Version | Licence | Used for |
|---|---|---|---|---|
| `pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`, legacy build for wider browser support) | 6.4.299 | Apache-2.0 | Showing PDFs (and Office files converted to PDF), and PDF books in the eBook Reader |
| `mammoth/` | [Mammoth](https://github.com/mwilliamson/mammoth.js) | 1.13.0 | BSD-2-Clause | Word (.docx) documents |
| `sheetjs/` | [SheetJS Community Edition](https://sheetjs.com/) (`xlsx`) | 0.18.5 | Apache-2.0 | Spreadsheets (.xlsx, .xls, .ods, .csv) |
| `hlsjs/` | [hls.js](https://github.com/video-dev/hls.js) (light build) | 1.7.3 | Apache-2.0 | Playing Plex video streams in Plex Viewer (browsers other than Safari) |
| `jszip/` | [JSZip](https://stuk.github.io/jszip/) | 3.10.2 | MIT (dual MIT/GPLv3) | PowerPoint (.pptx) slides; reading EPUB and CBZ books in the eBook Reader |
| `leaflet/` | [Leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause | Maps in the Trip Planner |
| `leaflet.markercluster/` | [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | 1.5.3 | MIT | Grouping nearby places on the Trip Planner's map |
| `world-atlas/` | [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, 1:50m countries), with ISO country codes from [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries) | 2.0.2 | ISC (map data: public domain); MIT (codes) | The Trip Planner's Atlas |
| `airports/` | [mwgg/Airports](https://github.com/mwgg/Airports) (IATA airports only, trimmed to code, name, city, country, position and time zone), with each airport's size from [OurAirports](https://ourairports.com/data/) | 2024 | MIT; sizes public domain | Finding airports for flights in the Trip Planner, and the nearest big one to a place |
| `qrcode/` | [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator) (`qrcode-generator`) | 1.4.4 | MIT | The QR code for setting up two-step sign-in |

For Office files, Mammoth, SheetJS and JSZip run inside a dedicated Web Worker (`public/js/apps/office-worker.js`)
with a time limit, so a malformed or hostile file cannot affect the MediaDesk page. Their output is shown
in a sandboxed frame with scripts disabled.

The eBook Reader uses JSZip on the page itself to read EPUB and CBZ files. An EPUB's chapters are never
shown as they are: each one is rebuilt from an allow-list of plain tags and attributes (no scripts,
styles, frames, forms or event handlers; pictures only from inside the book, as `blob:` addresses).
