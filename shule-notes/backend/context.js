// What the AI is shown. A long document does not need to be sent whole for every question: the pages most about the
// question are far faster and cheaper to read than 100 pages. A summary-type question gets pages from across the whole document.
'use strict';

const STOP = new Set('the and for are was were with that this from have has had you your what which when where who how why can could would should will not but about into out our their them they there here its its his her him she him let get got any all some more most other than then also only just very much many such each does did doing done been being than over under between after before during while these those'.split(' '));
const SUMMARY = /\b(summar|overview|outline|whole|entire|all about|main points|key points|revision|revise|explain this document|what is this document|what is this about)/i;

const words = (text) => (String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));

// pages: array of strings (index 0 = page 1). Returns the text to show the AI and how it was chosen.
function buildContext({ pages, fullText, question, history, budget = 45000 }) {
  const list = Array.isArray(pages) && pages.length ? pages.map((p) => String(p || '')) : null;
  const whole = String(fullText || (list ? list.join('\n\n') : ''));
  if (!list || whole.length <= budget) return { text: whole.slice(0, Math.max(budget, 0) || whole.length), mode: 'whole', pages: list ? list.length : 0 };

  const label = (i) => `[Page ${i + 1}]\n${list[i]}`;
  const chosen = new Set();
  let used = 0;
  const take = (i) => {
    if (chosen.has(i) || i < 0 || i >= list.length) return false;
    const cost = label(i).length + 2;
    if (used + cost > budget && chosen.size) return false;
    chosen.add(i); used += cost; return true;
  };

  const q = [question, ...(Array.isArray(history) ? history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content) : [])].join(' ');
  const wanted = SUMMARY.test(String(question || ''));
  if (wanted) {
    // spread across the whole document: every n-th page, always the first
    const step = Math.max(1, Math.ceil(list.length / Math.max(1, Math.floor(budget / Math.max(1, whole.length / list.length)))));
    for (let i = 0; i < list.length; i += step) take(i);
    return { text: [...chosen].sort((a, b) => a - b).map(label).join('\n\n'), mode: 'spread', pages: chosen.size };
  }

  // relevance: words from the question, rarer words count for more
  const qWords = [...new Set(words(q))];
  const pageWords = list.map((p) => words(p));
  const docFreq = {};
  for (const w of qWords) docFreq[w] = pageWords.filter((pw) => pw.includes(w)).length;
  const scores = pageWords.map((pw) => {
    const counts = {};
    for (const w of pw) counts[w] = (counts[w] || 0) + 1;
    return qWords.reduce((s, w) => s + (counts[w] ? (1 + Math.log(1 + counts[w])) * Math.log(1 + list.length / (1 + docFreq[w])) : 0), 0);
  });
  const ranked = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  take(0); // the first page says what the document is
  // only the pages that are really about the question: at least half the best score, at most 10, and the page after the best few (an answer often continues)
  const best = ranked.length ? ranked[0][0] : 0;
  let picked = 0;
  for (const [score, i] of ranked) {
    if (score <= 0 || score < best * 0.5 || picked >= 10) break;
    if (take(i)) { picked += 1; if (picked <= 3) take(i + 1); }
  }
  // nothing matched (a vague question): the opening pages
  if (picked === 0) for (let i = 1; used < budget * 0.5 && i < list.length; i++) take(i);
  return { text: [...chosen].sort((a, b) => a - b).map(label).join('\n\n'), mode: 'relevant', pages: chosen.size };
}

module.exports = { buildContext, words };
