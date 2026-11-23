#!/usr/bin/env node
/**
 * The Gemini side of the AI helper, with a pretend Google: the exact request it sends, how turns are tidied for Gemini,
 * every kind of reply and error, the choice between Claude and Gemini, the automatic backup, and that the key is
 * accepted in the admin settings but never shown again.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-gem-' + Date.now();
process.env.ADMIN_KEY = 'test-admin-key-123456';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const gemini = require('./gemini');
const ai = require('./ai');
const settingsLib = require('./settings');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const KEY = 'AIzaSyD-FAKE_gemini_key_for_tests_1234567';
const reply = (json, status = 200) => async () => ({ ok: status < 300, status, json: async () => json });
const good = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 10 } });

(async () => {
  console.log('— the request —');
  let seen;
  const spy = async (url, opts) => { seen = { url, opts, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => good('Kampala.') }; };
  const r = await gemini.askAboutDocument({ documentText: 'The capital is Kampala.', noteTitle: 'Geography', question: 'Capital?', history: [{ role: 'assistant', content: 'stray first' }, { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }, { role: 'assistant', content: 'Ask me' }], apiKey: KEY, model: 'gemini-2.5-flash', fetchImpl: spy });
  ck(r.answer === 'Kampala.' && r.model === 'gemini-2.5-flash', 'an answer comes back');
  ck(seen.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', 'it calls Google\'s generateContent for the chosen model');
  ck(seen.opts.headers['x-goog-api-key'] === KEY && !seen.url.includes(KEY), 'the key goes in a header, never in the web address');
  ck(/ONLY the document text/.test(seen.body.systemInstruction.parts[0].text) && /Kampala/.test(seen.body.systemInstruction.parts[0].text), 'the document and the rules go in as the system instruction');
  const roles = seen.body.contents.map((c) => c.role);
  ck(roles[0] === 'user' && roles.every((x, i) => i === 0 || x !== roles[i - 1]), 'turns start with the student and alternate (a stray assistant turn is dropped, same-side turns merged)');
  ck(seen.body.generationConfig.thinkingConfig.thinkingBudget === 0, 'Flash "thinking" is switched off (faster, cheaper)');
  await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-2.5-pro', fetchImpl: spy });
  ck(!seen.body.generationConfig.thinkingConfig, 'but not for the Pro model, which cannot switch it off');
  await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'not a model!', fetchImpl: spy });
  ck(/models\/gemini-2\.5-flash:/.test(seen.url), 'a silly model name falls back to the default');
  let thinkTries = 0;
  const picky = async (url, opts) => { thinkTries++; return JSON.parse(opts.body).generationConfig.thinkingConfig ? { ok: false, status: 400, json: async () => ({ error: { message: 'Unknown field thinkingConfig' } }) } : { ok: true, status: 200, json: async () => good('ok') }; };
  ck((await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-2.5-flash', fetchImpl: picky })).answer === 'ok' && thinkTries === 2, 'if a model rejects the thinking setting, it asks again without it');

  console.log('— replies and errors —');
  const fails = async (f) => { try { await f(); return null; } catch (e) { return gemini.classifyGeminiError(e); } };
  const ask = (impl, key = KEY) => () => gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: key, fetchImpl: impl });
  ck((await fails(ask(spy, ''))).status === 503, 'no key: "not set up yet" (503)');
  ck((await fails(ask(reply({ promptFeedback: { blockReason: 'SAFETY' } })))).status === 422, 'a blocked question is a polite "cannot answer" (422)');
  ck((await fails(ask(reply({ candidates: [{ finishReason: 'SAFETY' }] })))).status === 422, 'an answer cut by the safety filter is the same');
  ck((await fails(ask(reply({ candidates: [] })))).status === 502, 'an empty reply is a gentle "try a shorter question"');
  ck((await fails(ask(reply({ error: { message: 'quota' } }, 429)))).status === 503, 'Google being busy (429) says "try again in a moment"');
  ck((await fails(ask(reply({ error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400)))).status === 500, 'a rejected key says "not configured correctly" and does not leak details');
  ck((await fails(ask(reply({ error: { message: 'boom' } }, 503)))).status === 502, 'a Google outage is a 502 with a friendly message');
  ck((await fails(ask(async () => { throw new Error('ECONNRESET'); }))).status === 503, 'no connection is reported as such');
  ck(!/AIza|key/i.test((await fails(ask(reply({ error: { message: 'API key not valid' } }, 400)))).message), 'no error message shown to students mentions the key');

  console.log('— a model that is overloaded, retired or slow —');
  const listing = (ids) => ({ ok: true, status: 200, json: async () => ({ models: ids.map((id) => ({ name: 'models/' + id, displayName: id, supportedGenerationMethods: ['generateContent'] })) }) });
  const router = (ids, behave) => { const log = []; const f = async (url, opts) => { const u = String(url); if (u.includes('/models?')) { log.push('list'); return listing(ids); } const m = u.match(/models\/([^:]+):/)[1]; log.push(m); return behave(m, opts); }; f.log = log; return f; };
  const over = { ok: false, status: 503, json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }) };
  const gone = { ok: false, status: 404, json: async () => ({ error: { message: 'models/x is not found' } }) };
  const fine = (t) => ({ ok: true, status: 200, json: async () => good(t) });
  const IDS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-pro', 'embedding-001'];

  gemini._reset();
  const f1 = router(IDS, (m) => (m === 'gemini-3.8-flash' ? over : fine('answered by ' + m)));
  const r1 = await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: f1 });
  ck(r1.model === 'gemini-2.5-flash' && /answered by gemini-2.5-flash/.test(r1.answer), 'an overloaded model (503): the next best Flash answers and the student never notices');
  const f2 = router(IDS, (m) => fine('answered by ' + m));
  const r2 = await gemini.askAboutDocument({ documentText: 'x', question: 'q2', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: f2 });
  ck(r2.model === 'gemini-2.5-flash' && f2.log.length === 1, 'the overloaded one is set aside for a few minutes: the next question goes straight to the working model, no waiting');

  gemini._reset();
  const f3 = router(IDS, (m) => (m === 'gemini-2.5-flash-lite' ? gone : fine('answered by ' + m)));
  const r3 = await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-2.5-flash-lite', fetchImpl: f3 });
  ck(r3.model !== 'gemini-2.5-flash-lite' && /^gemini-/.test(r3.model), 'a retired model (404) is replaced by a working one');
  gemini._reset();
  const slow = router(IDS, (m) => (m === 'gemini-3.8-flash' ? Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })) : fine('answered by ' + m)));
  ck((await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: slow })).model === 'gemini-2.5-flash', 'a model that takes too long is replaced the same way');

  gemini._reset();
  const allDown = router(IDS, () => over);
  const e4 = await fails(() => gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: allDown }));
  ck(e4.status === 502 && allDown.log.filter((x) => x !== 'list').length <= 3, 'if every model is down it gives up after three tries with a friendly message');
  gemini._reset();
  const lonely = router(['gemini-3.8-flash'], () => over);
  ck((await fails(() => gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: lonely }))).status === 502, 'with only one model known there is nothing to switch to, and it says so politely');
  gemini._reset();
  const declinedF = router(IDS, () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }));
  ck((await fails(() => gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-2.5-flash', fetchImpl: declinedF }))).status === 422 && declinedF.log.length === 1, 'a declined question is not retried on other models');
  gemini._reset();
  await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: spy });
  ck(seen.body.generationConfig.thinkingConfig.thinkingLevel === 'low' && seen.body.generationConfig.maxOutputTokens >= 4096, 'a Gemini 3 model is told to think a little (low) and has room for the answer');
  const pickyLevel = async (url, opts) => JSON.parse(opts.body).generationConfig.thinkingConfig ? { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid thinking_level for this model' } }) } : { ok: true, status: 200, json: async () => good('fine') };
  ck((await gemini.askAboutDocument({ documentText: 'x', question: 'q', apiKey: KEY, model: 'gemini-3.8-flash', fetchImpl: pickyLevel })).answer === 'fine', 'if that setting is refused, it asks again without it');
  gemini._reset();
  const downOnce = router(IDS, () => over);
  const rec = await ai.ask({ aiProvider: 'gemini', geminiKey: KEY, aiFallback: false }, { question: 'q', documentText: 'x', fetchImpl: downOnce }).catch(() => null);
  ck(rec === null && ai.recent.lastError && ai.recent.lastError.provider === 'gemini' && ai.recent.lastError.status === 503 && /high demand/.test(ai.recent.lastError.reason), 'the admin can see the last AI problem and its real reason');
  ck(!JSON.stringify(ai.recent).includes(KEY), 'and the key is never in it');

  console.log('— the model list —');
  ck(gemini.pickDefault(['gemini-2.0-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3-flash-lite', 'gemini-2.5-pro']) === 'gemini-3-flash', 'the newest plain Flash is suggested (not a preview, not Pro)');
  ck(gemini.pickDefault(['gemini-2.5-flash-lite', 'gemini-2.5-pro']) === 'gemini-2.5-flash-lite' && gemini.pickDefault([]) === '', 'with no Flash it falls back sensibly (and to nothing when there is nothing)');
  const lm = await gemini.listModels({ apiKey: KEY, fetchImpl: router(IDS, () => fine('x')) });
  ck(lm.length === 4 && lm.every((m) => m.id.startsWith('gemini-')), 'the model list keeps only Gemini models that can answer');
  ck((await fails(() => gemini.listModels({ apiKey: KEY, fetchImpl: reply({ error: { message: 'API key not valid' } }, 400) }))).status === 500, 'a bad key shows up when listing models');

  console.log('— which AI answers —');
  const both = { aiProvider: 'gemini', anthropicKey: 'sk-ant-api03-' + 'a'.repeat(30), geminiKey: KEY, aiFallback: true };
  ck(JSON.stringify(ai.order(both)) === '["gemini","claude"]', 'Gemini chosen, Claude set up as the backup');
  ck(JSON.stringify(ai.order({ ...both, aiFallback: false })) === '["gemini"]', 'backup switched off: only the chosen one');
  ck(JSON.stringify(ai.order({ ...both, anthropicKey: '' })) === '["gemini"]', 'a backup with no key is not tried');
  ck(JSON.stringify(ai.order({ aiProvider: 'claude', anthropicKey: both.anthropicKey })) === '["claude"]', 'the default is Claude');
  const calls = [];
  const runners = {
    gemini: async () => { calls.push('gemini'); throw new gemini.GeminiHttpError(503, 'down'); },
    claude: async () => { calls.push('claude'); return { answer: 'from claude' }; },
  };
  const res = await ai.ask(both, { question: 'q' }, runners);
  ck(res.provider === 'claude' && res.answer === 'from claude' && calls.join() === 'gemini,claude', 'when Gemini fails the student still gets an answer, from Claude');
  const declined = { gemini: async () => { throw new gemini.GeminiNoAnswerError('declined'); }, claude: async () => { calls.push('should-not-run'); return { answer: 'x' }; } };
  calls.length = 0;
  let threw; try { await ai.ask(both, { question: 'q' }, declined); } catch (e) { threw = e; }
  ck(threw && ai.classifyAiError(threw).status === 422 && !calls.length, 'a declined question is NOT passed to the other AI');
  let both500; try { await ai.ask(both, { question: 'q' }, { gemini: async () => { throw new gemini.GeminiHttpError(503, 'a'); }, claude: async () => { throw new gemini.GeminiHttpError(429, 'b'); } }); } catch (e) { both500 = e; }
  ck(both500 && both500.provider === 'claude', 'when both fail, the last error is reported');

  console.log('— the admin settings —');
  ck(!(await settingsLib.saveSettings({ geminiKey: 'sk-ant-api03-' + 'a'.repeat(30) })).ok && !(await settingsLib.saveSettings({ geminiKey: 'AIza short' })).ok && !(await settingsLib.saveSettings({ geminiKey: 'too-short' })).ok, 'a Claude key, a key with a space and a too-short key are refused');
  ck((await settingsLib.saveSettings({ geminiKey: 'AQ.Ab8RN6' + 'x'.repeat(40) })).ok, 'a newer-style Gemini key (not starting with AIza) is accepted');
  ck((await settingsLib.saveSettings({ geminiKey: KEY, aiProvider: 'gemini', geminiModel: 'gemini-2.5-flash-lite', aiFallback: true })).ok, 'a real-looking key, provider and model are saved');
  ck(!(await settingsLib.saveSettings({ aiProvider: 'openai' })).ok && !(await settingsLib.saveSettings({ geminiModel: 'gpt-4' })).ok, 'an unknown provider or a non-Gemini model name is refused');
  const view = settingsLib.adminView(await settingsLib.getSettings());
  ck(view.geminiKeySet === true && view.geminiKeyHint === '…4567' && !('geminiKey' in view) && !JSON.stringify(view).includes(KEY), 'the panel sees only "saved" and the last 4 characters, never the key');
  ck(!JSON.stringify(settingsLib.publicConfig(await settingsLib.getSettings())).includes('AIza'), 'the app is never sent the key');
  await settingsLib.saveSettings({ clearGeminiKey: true });
  ck(settingsLib.adminView(await settingsLib.getSettings()).geminiKeySet === false, 'the key can be removed');

  console.log('— the real route —');
  const { app } = require('./server');
  const { hashPassword, createSession } = require('./auth');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const uid = String((await db.collection('users').insertOne({ name: 'A', phone: '0772000001', passwordHash: await hashPassword('x1y2z3'), classLevel: 'Senior 2', createdAt: new Date() })).insertedId);
  const tok = (await createSession(uid)).token;
  const noteId = String((await db.collection('notes').insertOne({ title: 'Geo', fileName: 'a.pdf', active: true, textStatus: 'ready', extractedText: 'The capital is Kampala.', pageCount: 1, uploadedAt: new Date() })).insertedId);
  await settingsLib.saveSettings({ aiProvider: 'gemini', geminiKey: KEY, geminiModel: 'gemini-2.5-flash' });
  const realFetch = global.fetch; let sentToGoogle = null;
  global.fetch = async (url, opts) => { if (String(url).includes('generativelanguage')) { sentToGoogle = { url: String(url), body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => good('Kampala is the capital.') }; } return realFetch(url, opts); };
  const ans = await (await fetch(base + '/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ noteId, question: 'What is the capital?' }) })).json();
  ck(ans.status === 'success' && ans.answer === 'Kampala is the capital.' && /gemini-2\.5-flash/.test(sentToGoogle.url), 'a student question goes to Gemini and the answer comes back');
  const t = await (await fetch(base + '/admin/ai/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_KEY }, body: '{}' })).json();
  ck(t.status === 'success' && t.provider === 'gemini' && typeof t.ms === 'number', 'the admin "Test the AI" button reports which AI answered and how fast');
  global.fetch = async (url, opts) => (String(url).includes('generativelanguage') ? { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] }] }) } : realFetch(url, opts));
  const gm = await (await fetch(base + '/admin/ai/gemini-models', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_KEY }, body: '{}' })).json();
  ck(gm.status === 'success' && gm.models[0].id === 'gemini-3-flash' && gm.suggested === 'gemini-3-flash', 'the admin button loads the real model list from Google and suggests one');
  global.fetch = realFetch; server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall Gemini checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
