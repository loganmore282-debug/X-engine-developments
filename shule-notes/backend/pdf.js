// Extracted ONCE, at upload time, and cached on the note document -- not
// re-parsed on every "Ask AI" question. A scanned/image-only PDF yields
// little or no text; that's surfaced to the admin at upload time rather than
// failing silently and leaving the AI feature quietly useless for that note.
'use strict';

// pdf.js itself, not the pdf-parse wrapper: pdf-parse bundles a 2018 build
// of pdf.js that randomly failed ("bad XRef entry") on valid PDFs.
// It ships as an ES module only, hence the dynamic import.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function extractPdfText(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0,
  }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : '');
      pages.push(text);
    }
    return { text: pages.join('\n\n').trim(), pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

module.exports = { extractPdfText };
