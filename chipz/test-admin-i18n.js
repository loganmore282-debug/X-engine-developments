/**
 * The admin panel's own language layer.
 *
 * Owner: "also make when in admin, you can change its language too,
 * everything there."
 *
 * The panel does NOT carry a second translator. build-admin.js lifts the
 * engine AND the member app's string table straight out of
 * user-src/original_module.js at build time, and the panel concatenates its
 * own rows onto them. This file guards the three ways that arrangement can
 * break silently:
 *
 *   1. THE LIFT STOPS WORKING. If a marker is renamed, moved, or nested
 *      wrongly, the build either refuses (good) or ships a panel that boots
 *      fine and simply never translates anything (bad). So the markers are
 *      checked at both ends in both files, the lift is PERFORMED here, and
 *      the result is required to hold every engine name and none of the
 *      host-specific ones.
 *   2. THE TABLE GOES QUIETLY WRONG. A short row shifts every language after
 *      the gap by one column, which reads as a working translation in the
 *      wrong language. A cell repeating its English is identical to a blank
 *      at runtime, so it is a claim nobody checked. A duplicate English key
 *      is a second answer to the same question.
 *   3. THE '=' SENTINEL. It means "the right wording here IS the English
 *      word", and it has to behave identically to a blank at runtime in BOTH
 *      tables. In LANG_ROWS that has always worked (DICT skips it). In
 *      LANG_PATTERNS it did not: tPattern() saw a truthy template and would
 *      have rendered the sentence as a bare "=". Run it.
 */
const fs = require('fs');
const HERE = __dirname;
const app = fs.readFileSync(HERE + '/user-src/original_module.js', 'utf8');
const adminSrc = fs.readFileSync(HERE + '/admin-src/index.html', 'utf8');
const buildAdmin = fs.readFileSync(HERE + '/build-admin.js', 'utf8');

let failed = 0;
const ck = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

function arraySource(text, name) {
  const m = new RegExp('(?:var|const) ' + name + ' = \\[([\\s\\S]*?)\\n\\];').exec(text);
  if (!m) throw new Error('no such array: ' + name);
  return m[1];
}
const evalArray = (text, name) => new Function('return [' + arraySource(text, name) + '];')();

// ── 1. the lift ───────────────────────────────────────────────────────────
function lift(name) {
  const b = `// ==== I18N ${name}: SHARED WITH THE ADMIN PANEL - BEGIN ====\n`;
  const e = `// ==== I18N ${name}: SHARED WITH THE ADMIN PANEL - END ====\n`;
  const i = app.indexOf(b), j = app.indexOf(e);
  ck(i >= 0, `the app marks the shared i18n ${name} with a BEGIN marker`);
  ck(j > i, `the app marks the shared i18n ${name} with an END marker after it`);
  return app.slice(i + b.length, j);
}
const table = lift('TABLE'), engine = lift('ENGINE');

for (const name of ['TABLE', 'ENGINE']) {
  const b = `// ==== SHARED I18N ${name}: REPLACED BY build-admin.js - BEGIN ====\n`;
  const e = `// ==== SHARED I18N ${name}: REPLACED BY build-admin.js - END ====\n`;
  const i = adminSrc.indexOf(b), j = adminSrc.indexOf(e);
  ck(i >= 0 && j > i, `the panel has a ${name} region for the build to fill in`);
}
// The order the three pieces run in is load-bearing and invisible: DICT and
// LANG_PATTERN_RE are built ONCE, at the moment the engine's own text runs, so
// a concatenation after the engine would never be seen.
const iTable = adminSrc.indexOf('SHARED I18N TABLE: REPLACED BY build-admin.js - END');
const iConcat = adminSrc.indexOf('LANG_ROWS = LANG_ROWS.concat(ADMIN_LANG_ROWS);');
const iEngine = adminSrc.indexOf('SHARED I18N ENGINE: REPLACED BY build-admin.js - BEGIN');
ck(iTable > 0 && iConcat > iTable && iEngine > iConcat,
   "the panel's own rows are concatenated AFTER the shared table and BEFORE the engine");
ck(adminSrc.includes('LANG_PATTERNS = LANG_PATTERNS.concat(ADMIN_LANG_PATTERNS);'),
   'and its own templates are concatenated too');

for (const need of ['var DICT', 'function langMeta', 'function t(', 'function tPattern',
                    'var LANG_PATTERN_RE', 'var _i18nText', 'var I18N_ATTRS',
                    'function i18nTextNode', 'function i18nElementAttrs',
                    'function translateTree', 'function startI18nObserver'])
  ck(engine.includes(need), `the lifted engine carries ${need.trim()}`);
// Anything in here that the member app owns and the panel does not would break
// the panel at build time.
for (const no of ['function applyLanguage', 'function setLang', 'function resolveLang',
                  'function applyRegionLanguages', 'function paintLangButton',
                  'STATE.', 'REGION.'])
  ck(!engine.includes(no), `the lifted engine does not reach for ${no.trim()}`);
for (const need of ['var LANG_ROWS = [', 'var LANG_PATTERNS = ['])
  ck(table.includes(need), `the lifted table carries ${need.trim()}`);

// The build has to REFUSE rather than ship a silent half-translation.
ck(/process\.exit\(1\)/.test(buildAdmin) && /Cannot lift the i18n/.test(buildAdmin),
   'build-admin.js refuses to build when the app-side markers are missing');
ck(/Cannot inject the i18n/.test(buildAdmin),
   'and refuses when the panel-side markers are missing');
ck(/i18n injection produced a script with no/.test(buildAdmin),
   'and refuses when the injected result has no translator in it');

// ── 2. the panel's own table ──────────────────────────────────────────────
const appRows = evalArray(app, 'LANG_ROWS');
const appPats = evalArray(app, 'LANG_PATTERNS');
const adminRows = evalArray(adminSrc, 'ADMIN_LANG_ROWS');
const adminPats = evalArray(adminSrc, 'ADMIN_LANG_PATTERNS');
const langs = new Function('return ' + /const ADMIN_LANGS = (\[[\s\S]*?\n\]);/.exec(adminSrc)[1])();

ck(adminRows.length > 200, `the panel has its own table (${adminRows.length} rows)`);
ck(adminPats.length > 5, `and its own templates (${adminPats.length})`);

const width = langs.length;
ck(width === 6, `six languages, so six cells per row (${width})`);
// The panel's own cap, read from its source -- the loop below needs it before
// the assertions further down compute it again for their messages.
const CAP_FOR_ROWS = Number((/var I18N_MAX_LEN_OVERRIDE = (\d+);/.exec(adminSrc) || [])[1]) || 160;
let badWidth = 0, blank = 0, repeats = 0, tooLong = 0;
for (const r of adminRows.concat(adminPats)) {
  if (r.length !== width) badWidth++;
  for (let i = 0; i < r.length; i++) {
    if (typeof r[i] !== 'string' || !r[i].trim()) blank++;
    if (i && r[i].trim() === r[0].trim() && r[i] !== '=') repeats++;
  }
  if (r[0].length > CAP_FOR_ROWS) tooLong++;
}
ck(badWidth === 0, 'every row has exactly one cell per language');
ck(blank === 0, 'no cell is blank in any language');
ck(repeats === 0, "no cell merely repeats its English -- '=' says that on purpose");
// The engine skips any text node longer than this, so a row over it could
// never apply however carefully it were written. Read out of the SOURCES
// rather than restated -- a constant copied into a test is a second source of
// truth nobody updates.
//
// THE PANEL RAISES IT. The cap defends the member app against being dragged
// through a wall of member-written content; the panel has none on screen, and
// its long strings are the operator documentation the owner asked to have
// translated. So the number this file enforces is the panel's own override,
// and the engine's default is asserted separately as the floor it cannot
// silently fall below.
const capDefault = Number((/I18N_MAX_LEN_OVERRIDE : (\d+);/.exec(engine) || [])[1]);
const capPanel = Number((/var I18N_MAX_LEN_OVERRIDE = (\d+);/.exec(adminSrc) || [])[1]);
ck(capDefault === 160, `the engine's own default cap is 160 (${capDefault})`);
ck(Number.isFinite(capPanel) && capPanel >= capDefault,
   `the panel raises it rather than lowering it (${capPanel})`);
const cap = capPanel;
ck(tooLong === 0, `no English key is over the panel's ${cap}-character cap`);

const appKeys = new Set(appRows.map(r => r[0].trim()));
const dupShared = adminRows.filter(r => appKeys.has(r[0].trim())).map(r => r[0]);
ck(dupShared.length === 0,
   'no panel row duplicates one the app already provides' +
   (dupShared.length ? ': ' + dupShared.slice(0, 3).join(' / ') : ''));
const seen = new Set(), dupSelf = [];
for (const r of adminRows) { const k = r[0].trim(); if (seen.has(k)) dupSelf.push(k); seen.add(k); }
ck(dupSelf.length === 0, 'and no panel row duplicates another panel row' +
   (dupSelf.length ? ': ' + dupSelf.slice(0, 3).join(' / ') : ''));

// A template that drops its {0} drops a FIGURE off an admin screen, and that
// is invisible from a screenshot -- it renders as the translation, just with a
// number missing.
let lostSlot = 0;
for (const p of adminPats.concat(appPats)) {
  const want = (p[0].match(/\{\d+\}/g) || []).sort().join(',');
  for (let i = 1; i < p.length; i++) {
    if (p[i] === '=' || !p[i]) continue;
    if ((p[i].match(/\{\d+\}/g) || []).sort().join(',') !== want) lostSlot++;
  }
}
ck(lostSlot === 0, 'every template translation keeps every placeholder the English uses');

// ── 3. '=' behaves like a blank, in BOTH tables ───────────────────────────
function engineSandbox(rows, pats, lang) {
  return new Function('LANG', 'LANG_ROWS', 'LANG_PATTERNS', 'LANGS', 'LANG_CODES', `
    ${engine}
    return { t, tPattern, DICT };
  `)(lang, rows, pats, langs, langs.map(l => l.code));
}
{
  const rows = [['Messages', 'Obubaka', 'Jumbe', '=', 'Ubutumwa', 'Obutumwa']];
  const pats = [['Users ({0})', 'Abakozesa ({0})', 'Watumiaji ({0})', '=',
                 'Abakoresha ({0})', 'Abakozesa ({0})']];
  const fr = engineSandbox(rows, pats, 'fr');
  ck(fr.t('Messages') === 'Messages', "'=' in a row leaves the English standing");
  ck(fr.DICT.fr && fr.DICT.fr.Messages === undefined,
     "and stores no dictionary entry, exactly as a blank does");
  ck(fr.t('Users (2)') === 'Users (2)',
     "'=' in a TEMPLATE leaves the English standing -- not a bare '='");
  const sw = engineSandbox(rows, pats, 'sw');
  ck(sw.t('Messages') === 'Jumbe' && sw.t('Users (2)') === 'Watumiaji (2)',
     'while a filled cell in the same row/template still translates');
  ck(sw.t('Users (17,500)') === 'Watumiaji (17,500)',
     'and a template copies the figure across untouched');
}

// ── 4. the pickers and the stored choice ──────────────────────────────────
ck(/id="langSwitch"/.test(adminSrc), 'the topbar has a language picker');
ck(/id="langLogin"/.test(adminSrc),
   'and so does the sign-in card -- the one screen an operator meets before the shell');
for (const id of ['langSwitch', 'langLogin']) {
  const tag = new RegExp('<select id="' + id + '"[^>]*>').exec(adminSrc);
  ck(tag && /data-no-i18n/.test(tag[0]),
     `${id}'s own options are data-no-i18n -- "Kiswahili" reads the same in every language`);
}
ck(/const ADMIN_LANG_KEY = 'chipz_admin_lang'/.test(adminSrc),
   'the choice is remembered on the device under its own key');
ck(!/localStorage\.getItem\(ADMIN_LANG_KEY\)[\s\S]{0,40}chipz_lang/.test(adminSrc) &&
   !adminSrc.includes("'chipz_lang'"),
   "and NOT under the member app's key -- they are different products on different origins");
ck(/startAdminI18n\(\);\s*\n\s*if\(SESSION_TOKEN\)/.test(adminSrc),
   'the language is applied at boot, before the shell opens');
ck(/function startAdminI18n\(\)[\s\S]*?startI18nObserver\(\)/.test(adminSrc),
   'and the observer is started, so a tab rendered later is translated as it lands');

// ── 5. not fighting the browser's own translator ──────────────────────────
// Chrome's translator cannot do this job -- an installed panel has no browser
// menu to reach it from, Runyankole is not in Google Translate at all, and it
// would rewrite a member's pasted payment SMS. But it IS a reasonable
// fallback in a browser tab for the long help paragraphs that stay English by
// construction, so the two must not work against each other.
ck(/function markAdminPageLanguage\(\)[\s\S]*?setAttribute\('lang', LANG\)/.test(adminSrc),
   "<html lang> is set to the language the panel is actually rendering in");
for (const caller of ['setAdminLang', 'startAdminI18n'])
  ck(new RegExp('function ' + caller + '\\([\\s\\S]*?markAdminPageLanguage\\(\\)').test(adminSrc),
     `and ${caller}() sets it, so it is right at boot and after every switch`);
const pre = /<pre translate="no"[^>]*>\$\{esc\(d\.pastedSms\)\}<\/pre>/.test(adminSrc);
ck(pre, "the member's pasted payment SMS is translate=\"no\" -- a machine " +
        'translation of the message an admin verifies a real payment against ' +
        'is worse than no translation at all');

console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);
