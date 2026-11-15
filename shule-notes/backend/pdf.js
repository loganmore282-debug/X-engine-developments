// Extracted ONCE, at upload time, and cached on the note document -- not
// re-parsed on every "Ask AI" question. A scanned/image-only PDF yields
// little or no text; that's surfaced to the admin at upload time rather than
// failing silently and leaving the AI feature quietly useless for that note.
'use strict';
const pdfParse = require('pdf-parse');

async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return { text: (data.text || '').trim(), pageCount: data.numpages || 0 };
}

module.exports = { extractPdfText };
