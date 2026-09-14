/**
 * Languages: a per-country allowed list, a button on the sign-in screen, and
 * a translation layer over the rendered DOM.
 *
 * Owner: "add when can select languages of a country, so on login page of
 * every subdomain of any country, at top right there is a button of language,
 * it can change that very word depending on selected language, so you put all
 * language code base of Luganda, so app or site can read luganda, English,
 * swahili, French ... make when l can select allowed languages of any
 * specific country."
 *
 * Everything below RUNS the real functions lifted out of server.js and
 * user-src/original_module.js against a stub DOM. Three things here cannot be
 * checked any other way:
 *
 *   1. THE THREE CODE LISTS AGREE. server.js decides which languages a
 *      country may be given, admin-src offers them as tickboxes, and the app
 *      holds the dictionary column that makes one of them mean anything. A
 *      code in two of the three is an option that does nothing when tapped,
 *      and nothing at runtime would say so.
 *   2. THE TRANSLATOR NEVER EATS A MEMBER'S OWN DATA. It replaces a whole
 *      trimmed text node that exactly matches a table row, never a substring,
 *      so an amount, a name or a product title has to be left alone even when
 *      it contains a translatable word.
 *   3. SWITCHING LANGUAGES TWICE STILL READS RIGHT. The translation is
 *      applied to the rendered DOM, so a second switch has to resolve from
 *      the stored English rather than from the Luganda already on screen --
 *      otherwise Luganda -> French leaves Luganda standing and
 *      Luganda -> English never comes back.
 */
const fs = require('fs');
const HERE = __dirname;
const src = fs.readFileSync(HERE + '/server.js', 'utf8');
const client = fs.readFileSync(HERE + '/user-src/original_module.js', 'utf8');
const clientHtml = fs.readFileSync(HERE + '/user-src/index.html', 'utf8');
const adminSrc = fs.readFileSync(HERE + '/admin-src/index.html', 'utf8');

let failed = 0;
const ck = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

function fnSource(text, name) {
  let start = text.indexOf(`async function ${name}(`);
  if (start === -1) start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let depth = 0;
  for (let k = text.indexOf('{', start); k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
// A `const NAME = ...;` declaration, brackets balanced, so an array or object
// literal spanning many lines comes back whole.
function constSource(text, name) {
  const start = text.search(new RegExp(`(?:const|var|let) ${name} = `));
  if (start === -1) throw new Error(`no such declaration: ${name}`);
  let depth = 0, seen = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (c === '[' || c === '{' || c === '(') { depth++; seen = true; }
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0 && seen) return text.slice(start, k + 1);
  }
  throw new Error(`unterminated declaration: ${name}`);
}

// ── 1. the three lists ────────────────────────────────────────────────────
console.log('\n— the same six languages in all three files —');
const serverCodes = new Function(constSource(src, 'LANGUAGE_CODES') + ' return LANGUAGE_CODES;')();
const appLangs = new Function(constSource(client, 'LANGS') + ' return LANGS;')();
const adminLangs = new Function(constSource(adminSrc, 'ADMIN_LANGS') + ' return ADMIN_LANGS;')();
const appCodes = appLangs.map(l => l.code);
const adminCodes = adminLangs.map(l => l.code);

ck(serverCodes.length >= 6, `the server offers ${serverCodes.length} languages`);
ck(JSON.stringify(serverCodes) === JSON.stringify(appCodes),
  'server LANGUAGE_CODES and the app\'s LANGS hold the same codes in the same order');
ck(JSON.stringify(serverCodes) === JSON.stringify(adminCodes),
  'and the admin panel\'s tickboxes offer exactly those');
ck(serverCodes[0] === 'en', 'English is first, so it is what an unconfigured country falls back to');
for (const want of ['lg', 'sw', 'fr']) ck(serverCodes.includes(want), `the owner asked for "${want}" and it is there`);
ck(appLangs.every(l => l.native && l.name), 'every language has both an English name and its own');
ck(adminLangs.every((l, i) => l.native === appLangs[i].native),
  'the panel prints each language the same way the app does');

// ── 2. what a country stores ──────────────────────────────────────────────
console.log('\n— a country\'s allowed languages —');
const regionApi = new Function('normalizeAllowedHost', `
  const DEFAULT_REGION_KEY = 'ug';
  ${constSource(src, 'DEFAULT_REGION')}
  ${constSource(src, 'LANGUAGE_CODES')}
  ${fnSource(src, 'normalizeRegion')}
  return { normalizeRegion, DEFAULT_REGION };
`)(h => {
  const s = String(h || '').trim().toLowerCase();
  return s.includes('.') ? { host: s } : { skip: true };
});
const { normalizeRegion } = regionApi;

let r = normalizeRegion({ key: 'ke', name: 'Kenya', languages: ['en', 'sw'] }, 'ke');
ck(JSON.stringify(r.languages) === '["en","sw"]', 'a country keeps the languages it was given, in order');
ck(r.defaultLang === 'en', 'and opens in the first of them when no default was named');

r = normalizeRegion({ key: 'ke', languages: ['sw', 'en'], defaultLang: 'sw' }, 'ke');
ck(r.defaultLang === 'sw', 'a named default is honoured');

r = normalizeRegion({ key: 'ke', languages: ['sw'], defaultLang: 'fr' }, 'ke');
ck(r.defaultLang === 'sw',
  'a default the country does not allow is pulled back into the list -- otherwise a new arrival lands in a language the picker cannot switch away from, because it only lists allowed ones');

r = normalizeRegion({ key: 'ke', languages: ['sw', 'de', 'xx'] }, 'ke');
ck(JSON.stringify(r.languages) === '["sw"]', 'a code the app has no dictionary for is dropped, not stored');

r = normalizeRegion({ key: 'ke', languages: [] }, 'ke');
ck(JSON.stringify(r.languages) === '["en"]' && r.defaultLang === 'en',
  'a country with nothing ticked offers English alone -- which is exactly what every region stored before this feature reads as, so nothing needs migrating');

r = normalizeRegion({ key: 'ke' }, 'ke');
ck(JSON.stringify(r.languages) === '["en"]', 'and so does one written before the field existed');

r = normalizeRegion({ key: 'ke', languages: 'sw, fr , sw' }, 'ke');
ck(JSON.stringify(r.languages) === '["sw","fr"]',
  'a typed-in list splits on commas and de-duplicates');

// The founding region must survive its own normalisation -- it is the
// fallback for every unknown host and every unstamped account.
r = normalizeRegion(regionApi.DEFAULT_REGION, 'ug');
ck(r.languages.length >= 1 && r.languages.includes(r.defaultLang),
  'the founding country normalises to a usable pair');

// ── 3. the app is told about them ─────────────────────────────────────────
console.log('\n— published to the app, and read by it —');
// regionUsesBareLocal is stubbed rather than lifted: it reaches for the
// founding region's dialling code, which has its own coverage in
// test-regions.js, and none of the assertions here depend on its answer.
const pubView = new Function('reg', `
  const currentRegion = () => reg;
  const regionUsesBareLocal = () => true;
  ${fnSource(src, 'publicRegionView')}
  return publicRegionView(reg);
`);
const view = pubView({ key: 'ke', name: 'Kenya', currency: 'KES', dialCode: '254', localLength: 9, prefixes: ['7'], utcOffsetMin: 180, languages: ['en', 'sw'], defaultLang: 'sw' });
ck(JSON.stringify(view.languages) === '["en","sw"]', '/public/settings carries the country\'s language list');
ck(view.defaultLang === 'sw', 'and which one it opens in');
const bareView = pubView({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256', prefixes: [] });
ck(JSON.stringify(bareView.languages) === '["en"]',
  'a region with no list published still yields English rather than nothing, so the app never gets an empty picker');

// applyRegion copies a WHITELIST. This file already records what that costs:
// usesBareLocal was left out of it once and the login address silently went
// to the wrong Firebase namespace. The same shape of bug here would leave
// every country on English with the button hidden.
const whitelist = (client.match(/for \(const k of \[([^\]]*)\]\) \{\s*\n\s*if \(r\[k\]/) || [])[1] || '';
ck(/'languages'/.test(whitelist), 'applyRegion\'s whitelist copies languages');
ck(/'defaultLang'/.test(whitelist), 'and defaultLang');

// ── 4. the translator ─────────────────────────────────────────────────────
console.log('\n— the translator —');
// A DOM small enough to reason about and real enough to drive a TreeWalker:
// node types, parentElement, closest(), querySelectorAll() and attributes are
// what translateTree() actually uses.
function makeDom() {
  const doc = { nodeType: 9 };
  function textNode(v, parent) { return { nodeType: 3, nodeValue: v, parentElement: parent }; }
  function el(tag, opts) {
    const e = {
      nodeType: 1, tagName: tag.toUpperCase(), children: [], attrs: (opts && opts.attrs) || {},
      parentElement: null, _noI18n: !!(opts && opts.noI18n),
      hasAttribute(a) { return a in this.attrs; },
      getAttribute(a) { return this.attrs[a]; },
      setAttribute(a, v) { this.attrs[a] = v; },
      matches(sel) { return sel.split(',').some(s => s.trim().replace(/[\[\]]/g, '') in this.attrs); },
      closest(sel) {
        if (sel !== '[data-no-i18n]') return null;
        let n = this;
        while (n) { if (n._noI18n) return n; n = n.parentElement; }
        return null;
      },
      querySelectorAll() {
        const out = [];
        (function walk(n) {
          for (const c of n.children) {
            if (c.nodeType === 1) {
              if (Object.keys(c.attrs).some(a => ['placeholder', 'aria-label', 'title'].includes(a))) out.push(c);
              walk(c);
            }
          }
        })(this);
        return out;
      },
      add(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; },
      text(v) { return this.add(textNode(v, this)); },
    };
    return e;
  }
  return { el, doc };
}
// document.createTreeWalker over the stub, SHOW_TEXT only.
function treeWalkerFor(root, filter) {
  const nodes = [];
  (function walk(n) {
    for (const c of (n.children || [])) {
      if (c.nodeType === 3) { if (filter.acceptNode(c) === 1) nodes.push(c); }
      else walk(c);
    }
  })(root);
  let i = -1;
  return { nextNode() { i++; return i < nodes.length ? nodes[i] : null; } };
}

function buildI18n(startLang) {
  const { el } = makeDom();
  const sandbox = new Function('el', 'treeWalkerFor', 'startLang', `
    const NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
    let _body = null;
    const document = {
      createTreeWalker: (root, what, filter) => treeWalkerFor(root, filter),
      get body(){ return _body; },
      documentElement: { setAttribute(){} },
    };
    const localStorage = { _v: {}, getItem(k){ return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v){ this._v[k] = String(v); } };
    const $ = () => null;
    const esc = s => String(s == null ? '' : s);
    const requestAnimationFrame = fn => fn();
    let REGION = { languages: ['en'], defaultLang: 'en' };
    ${constSource(client, 'LANGS')}
    ${constSource(client, 'LANG_CODES')}
    var LANG = 'en';
    var LANG_ALLOWED = ['en'];
    ${constSource(client, 'LANG_STORE_KEY')}
    ${constSource(client, 'LANG_ROWS')}
    ${constSource(client, 'DICT')}
    ${constSource(client, 'I18N_ATTRS')}
    var _i18nText = new WeakMap();
    var _i18nAttr = new WeakMap();
    ${fnSource(client, 'langMeta')}
    ${fnSource(client, 't')}
    ${fnSource(client, 'i18nTextNode')}
    ${fnSource(client, 'i18nElementAttrs')}
    ${fnSource(client, 'translateTree')}
    ${fnSource(client, 'resolveLang')}
    function paintLangButton(){}
    function closeLangPicker(){}
    function applyLanguage(){ translateTree(_body); }
    ${fnSource(client, 'setLang')}
    ${fnSource(client, 'applyRegionLanguages')}
    return {
      setBody: b => { _body = b; },
      setRegion: r => { REGION = r; },
      store: localStorage,
      t: s => t(s),
      lang: () => LANG,
      allowed: () => LANG_ALLOWED,
      setLang, translateTree, applyRegionLanguages, resolveLang,
      dict: DICT, rows: LANG_ROWS, langs: LANGS,
    };
  `)(el, treeWalkerFor, startLang);
  return { el, i18n: sandbox };
}

let { el, i18n } = buildI18n();
ck(i18n.t('Withdraw') === 'Withdraw', 'in English every string is itself -- no lookup, no cost');
i18n.setLang('sw');
ck(i18n.t('Withdraw') === 'Toa Pesa', 'in Swahili a translated string comes back translated');
ck(i18n.t('Some sentence nobody has translated yet') === 'Some sentence nobody has translated yet',
  'and an untranslated one comes back as its own English -- a member can never be shown a missing-key placeholder');

// Every cell that IS filled has to differ from the English, or it is noise in
// the table pretending to be a translation.
let same = [];
for (const row of i18n.rows) for (let i = 1; i < row.length; i++) if (row[i] && row[i] === row[0]) same.push(row[0]);
ck(same.length === 0, `no row repeats the English as its own translation${same.length ? ' (' + same.join(', ') + ')' : ''}`);
ck(i18n.rows.every(row => row.length === i18n.langs.length),
  'every row has exactly one cell per language, so no column is silently shifted');
const keys = i18n.rows.map(r => r[0]);
ck(new Set(keys).size === keys.length, 'no English string appears twice in the table');
// A language ticked in the panel with an empty column would be a language
// that changes nothing at all when chosen.
for (const l of i18n.langs.slice(1)) {
  ck(Object.keys(i18n.dict[l.code] || {}).length >= 15,
    `${l.name} has a real dictionary, not an empty column`);
}

console.log('\n— what it will and will not rewrite —');
({ el, i18n } = buildI18n());
const body = el('div');
const head = el('h2').text('Team');
const amount = el('div').text('UGX 45,000.00');
const name = el('div').text('Home Cell Battery');
const mixed = el('p').text('Tap Withdraw to cash out');
const field = el('input', { attrs: { placeholder: 'Enter phone number', 'aria-label': 'Enter phone number' } });
const guarded = el('span', { noI18n: true }).text('Team');
const script = el('script').text('Team');
body.add(head, amount, name, mixed, field, guarded, script);
i18n.setBody(body);
i18n.setLang('sw');
i18n.translateTree(body);

ck(head.children[0].nodeValue === 'Timu', 'a heading that matches a row is translated');
ck(amount.children[0].nodeValue === 'UGX 45,000.00', 'an amount is left exactly alone');
ck(name.children[0].nodeValue === 'Home Cell Battery',
  'a product name is left alone even though it starts with a word that IS in the table -- only a whole node match is replaced, never a substring');
ck(mixed.children[0].nodeValue === 'Tap Withdraw to cash out',
  'and a sentence merely containing a translated word is left alone for the same reason');
ck(field.attrs.placeholder === 'Weka namba ya simu', 'a placeholder is translated');
ck(field.attrs['aria-label'] === 'Weka namba ya simu', 'and so is an aria-label, so a screen reader agrees with the screen');
ck(guarded.children[0].nodeValue === 'Team', 'anything inside [data-no-i18n] is left alone');
ck(script.children[0].nodeValue === 'Team', 'and the contents of a <script> are never touched');

console.log('\n— switching, twice, and back —');
i18n.setLang('fr');
i18n.translateTree(body);
ck(head.children[0].nodeValue === 'Équipe',
  'Swahili -> French reads the stored English, not the Swahili already on screen');
ck(field.attrs.placeholder === 'Entrez le numéro de téléphone', 'the attribute follows it');
i18n.setLang('en');
i18n.translateTree(body);
ck(head.children[0].nodeValue === 'Team', 'and going back to English restores the original word for word');
ck(field.attrs.placeholder === 'Enter phone number', 'attributes included');

// Whitespace around a node's text is part of the rendered markup's layout,
// not part of the string -- losing it would jam words together where a
// template put a newline between two inline elements.
({ el, i18n } = buildI18n());
const padded = el('div');
const padText = el('span');
padText.add({ nodeType: 3, nodeValue: '\n      Deposit\n    ', parentElement: padText });
padded.add(padText);
i18n.setBody(padded);
i18n.setLang('sw');
i18n.translateTree(padded);
ck(padText.children[0].nodeValue === '\n      Weka Pesa\n    ',
  'the surrounding whitespace of a text node survives translation');

console.log('\n— which language a device opens in —');
({ el, i18n } = buildI18n());
i18n.setBody(el('div'));
i18n.setRegion({ languages: ['en', 'sw'], defaultLang: 'sw' });
i18n.applyRegionLanguages();
ck(i18n.lang() === 'sw', 'with nothing stored, a device opens in the country\'s own default');
ck(JSON.stringify(i18n.allowed()) === '["en","sw"]', 'and the picker offers what the country allows');

i18n.store.setItem('chipz_lang', 'fr');
i18n.setRegion({ languages: ['en', 'sw'], defaultLang: 'sw' });
i18n.applyRegionLanguages();
ck(i18n.lang() === 'sw',
  'a stored language the country no longer allows falls back to its default -- a member must never be stranded in a language the picker does not list, because then nothing on screen can change it');

i18n.store.setItem('chipz_lang', 'en');
i18n.setRegion({ languages: ['en', 'sw'], defaultLang: 'sw' });
i18n.applyRegionLanguages();
ck(i18n.lang() === 'en', 'a stored language the country does allow wins over the default');

({ el, i18n } = buildI18n());
i18n.setBody(el('div'));
i18n.setRegion({});
i18n.applyRegionLanguages();
ck(i18n.lang() === 'en' && JSON.stringify(i18n.allowed()) === '["en"]',
  'a region that published nothing leaves the app in English with one option');

({ el, i18n } = buildI18n());
i18n.setBody(el('div'));
i18n.setRegion({ languages: ['sw', 'zz', 'fr'] });
i18n.applyRegionLanguages();
ck(JSON.stringify(i18n.allowed()) === '["sw","fr"]',
  'a code the app cannot render is dropped from the picker even if the server sent it');

({ el, i18n } = buildI18n());
i18n.setBody(el('div'));
i18n.setLang('sw');
ck(i18n.store.getItem('chipz_lang') === 'sw', 'a chosen language is remembered on the device');

// ── 5. the wiring nothing else would catch ───────────────────────────────
console.log('\n— the button and the picker —');
ck(/id="langBtn"/.test(clientHtml), 'the sign-in screen carries a language button');
const heroBlock = clientHtml.slice(clientHtml.indexOf('<div class="auth-hero"'), clientHtml.indexOf('<div class="auth-card">'));
ck(heroBlock.includes('id="langBtn"'), 'and it is inside the hero, which is the top of the sign-in screen');
const btnCss = (clientHtml.match(/\.lang-btn\{[^}]*\}/) || [''])[0];
ck(/position:absolute/.test(btnCss) && /top:/.test(btnCss) && /right:/.test(btnCss),
  'pinned to the TOP RIGHT, which is where the owner asked for it');
ck(/data-no-i18n/.test(heroBlock),
  'the button is marked data-no-i18n -- its label is already in its own language and must never go back through the table');
ck(/style="display:none;"[^>]*onclick="openLangPicker\(\)"|id="langBtn"[^>]*style="display:none;"/.test(clientHtml),
  'it ships hidden, so a one-language country never shows it even for a frame');
const paintBtn = fnSource(client, 'paintLangButton');
ck(/LANG_ALLOWED\.length > 1/.test(paintBtn),
  'and it is shown only where the country offers more than one language');
ck(/langRow/.test(paintBtn),
  'the Account row follows the same rule, so the two can never disagree');
ck(/id="langRow"/.test(client),
  'a signed-in member can change language from Account, having not seen the sign-in screen since the day they joined');
const sheetCss = (clientHtml.match(/\.lang-sheet-bg\{[^}]*\}/) || [''])[0];
ck(/inset:0/.test(sheetCss) && !/bottom:var\(--nav-h\)/.test(sheetCss),
  'the picker covers the bottom bar (inset:0) -- this file\'s own rule is that the overlays a nav tap can reach are exactly the ones that do not, and each of those has needed teardown code to stop it being left floating');

console.log('\n— the panel —');
ck(/id="rgLangs"/.test(adminSrc), 'the country editor has a languages control');
ck(/id="rgDefLang"/.test(adminSrc), 'and one for which language it opens in');
ck(/languages: Array\.from\(document\.querySelectorAll\('\.rg-lang'\)\)/.test(adminSrc),
  'saving a country sends the ticked languages');
ck(/defaultLang: \$\('rgDefLang'\)\.value/.test(adminSrc), 'and the default');
// The REFUSAL IS RUN, not matched. A text match on the message is exactly
// the trap this project keeps hitting: stubbing the guard out
// (`const badLang = null;`) leaves the sentence sitting in an `if` that can
// never fire, and every string check still passes. That mutation went
// UNDETECTED against the first version of these two lines, which is why they
// now execute the real block out of the route.
const langGuard = (function(){
  const route = src.slice(src.indexOf("app.post('/admin/regions/save'"));
  const from = route.indexOf('  const typedLangs =');
  const to = route.indexOf('\n', route.indexOf("languages this country allows"));
  if (from === -1 || to === -1) throw new Error('the language guard is no longer where this test slices it');
  return route.slice(from, to);
})();
function runLangGuard(raw, normalised) {
  const said = [];
  const res = { status(){ return this; }, json(b){ said.push(b.message || ''); return this; } };
  new Function('raw', 'r', 'res', 'LANGUAGE_CODES', 'return ' + `(function(){ ${langGuard} return null; })()`)
    (raw, normalised, res, serverCodes);
  return said.join(' | ');
}
ck(/is not a language this app can display/.test(runLangGuard({ languages: ['sw', 'de'] }, { languages: ['sw'] })),
  'the save route REFUSES an unknown language code by name rather than quietly dropping it -- an admin shown a list without the language he ticked has been given a country he did not configure');
ck(/"de"/.test(runLangGuard({ languages: ['sw', 'de'] }, { languages: ['sw'] })),
  'and names the offending one, so the admin knows which tickbox to change');
ck(runLangGuard({ languages: ['sw', 'fr'] }, { languages: ['sw', 'fr'] }) === '',
  'a list of codes the app can render is accepted without complaint');
ck(/The default language has to be one of the languages this country allows/.test(
  runLangGuard({ languages: ['sw'], defaultLang: 'fr' }, { languages: ['sw'] })),
  'and a default outside the allowed list is refused');
ck(runLangGuard({ languages: ['sw'], defaultLang: 'sw' }, { languages: ['sw'] }) === '',
  'a default inside it is accepted');

console.log(failed ? `\nlanguages: ${failed} case(s) failed` : '\nlanguages: all cases pass');
process.exit(failed ? 1 : 0);
