#!/usr/bin/env node
/** What the AI is shown from a long document: the pages about the question, or pages spread across a summary. */
'use strict';
const { buildContext } = require('./context');
let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const filler = (n) => ('Plants and animals live in many places around the world and scientists study them. ').repeat(n);
const pages = Array.from({ length: 120 }, (_, i) => `Topic ${i}. ${filler(8)}`);
pages[0] = 'Science for Primary 7. ' + filler(8);
pages[57] = 'Photosynthesis is how green plants make food using sunlight, water and carbon dioxide in the chloroplasts. ' + filler(6);
pages[58] = 'The oxygen released by photosynthesis. ' + filler(6);
pages[90] = 'The digestive system breaks food down in the stomach and the small intestine. ' + filler(6);
const total = pages.join('\n\n').length;

const small = buildContext({ pages: ['one', 'two'], question: 'anything' });
ck(small.mode === 'whole' && small.text.includes('one') && small.text.includes('two'), 'a short document is sent whole');
const q = buildContext({ pages, question: 'How do plants make food by photosynthesis?', history: [] });
ck(q.mode === 'relevant' && q.text.includes('[Page 58]') && q.text.includes('[Page 59]') && !q.text.includes('[Page 91]'), 'a question about photosynthesis gets the photosynthesis page and the one after it, not the digestive system');
ck(q.text.includes('[Page 1]'), 'and always the first page (what the document is)');
ck(q.text.length <= 45000 + 2000 && q.text.length < total / 2, `and stays small (${q.text.length} characters instead of ${total})`);
const d = buildContext({ pages, question: 'Where does food get broken down?', history: [] });
ck(d.text.includes('[Page 91]') && !d.text.includes('[Page 58]'), 'a different question picks different pages');
const follow = buildContext({ pages, question: 'and what does it release?', history: [{ role: 'user', content: 'Explain photosynthesis' }, { role: 'assistant', content: 'It is how plants make food.' }] });
ck(follow.text.includes('[Page 58]') || follow.text.includes('[Page 59]'), 'a follow-up question still finds the right page through the earlier question');
const s = buildContext({ pages, question: 'Summarise this document', history: [] });
ck(s.mode === 'spread' && /\[Page 1\]/.test(s.text) && /\[Page 6\d\]/.test(s.text) && s.text.length <= 47000, 'a summary question gets pages from across the whole document');
const vague = buildContext({ pages, question: 'hello', history: [] });
ck(vague.text.includes('[Page 1]') && vague.text.length > 5000, 'a vague question still gets the opening pages');
const noPages = buildContext({ pages: null, fullText: 'x'.repeat(100), question: 'q' });
ck(noPages.mode === 'whole', 'a document with only its full text (no pages) works too');
console.log(bad ? `\n${bad} FAILED` : '\nall context checks passed');
process.exit(bad ? 1 : 0);
