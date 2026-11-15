#!/usr/bin/env node
/**
 * Runs the real extractPdfText() on a real (generated) PDF, repeatedly: the
 * previous extractor failed at random on valid files, which left notes
 * permanently without an AI context. Also pins that an unreadable upload
 * REJECTS, since server.js's upload handler relies on that to tell the admin
 * "no text could be read" instead of claiming success.
 */
'use strict';
const { extractPdfText } = require('./pdf');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

function makePdf(pageTexts) {
  const objects = [];
  const kids = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageTexts.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += String(at).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

(async () => {
  console.log('— a real PDF, read repeatedly —');
  {
    const pdf = makePdf(['Chapter 1: Cells', 'Chapter 2: Tissues']);
    let allSame = true;
    let first = null;
    for (let i = 0; i < 12; i++) {
      const r = await extractPdfText(pdf);
      if (!first) first = r;
      if (r.text !== first.text || r.pageCount !== first.pageCount) allSame = false;
    }
    ck(first.pageCount === 2, 'the page count is read from the document');
    ck(first.text.includes('Chapter 1: Cells') && first.text.includes('Chapter 2: Tissues'), 'text from every page is extracted');
    ck(first.text === first.text.trim(), 'the extracted text is trimmed of surrounding whitespace');
    ck(allSame, 'twelve reads of the same file give the same result every time');
  }

  console.log('\n— a genuinely unreadable file is rejected, not silently emptied —');
  {
    let threw = false;
    try { await extractPdfText(Buffer.from('this is not a pdf at all, just text')); }
    catch (e) { threw = true; }
    ck(threw, 'a non-PDF buffer throws, which the upload route catches and reports as "no text could be read"');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall pdf.js checks pass');
  process.exit(bad ? 1 : 0);
})();
