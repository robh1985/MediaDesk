# Third-party libraries

These are loaded by the Preview app only when needed. Each folder holds the library's licence.

| Folder | Library | Version | Licence | Used for |
|---|---|---|---|---|
| `pdfjs/` | [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`, legacy build for wider browser support) | 6.4.299 | Apache-2.0 | Showing PDFs (and Office files converted to PDF) |
| `mammoth/` | [Mammoth](https://github.com/mwilliamson/mammoth.js) | 1.13.0 | BSD-2-Clause | Word (.docx) documents |
| `sheetjs/` | [SheetJS Community Edition](https://sheetjs.com/) (`xlsx`) | 0.18.5 | Apache-2.0 | Spreadsheets (.xlsx, .xls, .ods, .csv) |
| `jszip/` | [JSZip](https://stuk.github.io/jszip/) | 3.10.2 | MIT (dual MIT/GPLv3) | PowerPoint (.pptx) slides |

Mammoth, SheetJS and JSZip only ever run inside a dedicated Web Worker (`public/js/apps/office-worker.js`)
with a time limit, so a malformed or hostile file cannot affect the MediaDesk page. Their output is shown
in a sandboxed frame with scripts disabled.
