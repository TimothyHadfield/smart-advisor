// Text from a PDF (the Wolverine Track audit's "Save as PDF"), read in the browser with pdf.js.
// pdf.js is loaded from cdnjs only when a PDF is chosen; the file never leaves the device.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let loading = null;

function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  loading ??= new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => { loading = null; bad(new Error('pdf.js did not load')); };
    document.head.appendChild(s);
  });
  return loading;
}

// One text line per printed line: pieces are grouped by their baseline and joined left to right.
export async function pdfToText(data) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      let r = rows.find((q) => Math.abs(q.y - y) < 2.5);
      if (!r) rows.push((r = { y, items: [] }));
      r.items.push({ x, s: it.str, w: it.width });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      for (const it of r.items) {
        if (end !== null && it.x - end > 1 && !line.endsWith(' ') && !it.s.startsWith(' ')) line += ' ';
        line += it.s;
        end = it.x + it.w;
      }
      out.push(line);
    }
    out.push('');
  }
  return out.join('\n');
}
