#!/usr/bin/env python3
"""
Every English word still reaching the ADMIN PANEL's screen, found by LOOKING
at the screen rather than by grepping the source.

Owner: "also make when in admin, you can change its language too, everything
there."

Same method as find-untranslated.py, pointed at the other build, and for the
same reason: admin-src/index.html draws every tab by assigning a template
literal to innerHTML, with helper calls, ternaries and strings assembled from
halves, so a regex over the source cannot enumerate what actually lands on
screen. It is also four times the size of the member app's copy, which makes
"I think I got them all" worth nothing.

The panel is obfuscated into admin/index.html -- every string literal is
encoded -- so grepping the DEPLOYED file proves nothing either. This drives
the built panel in a real browser with the language forced, walks every tab,
sub-tab and modal it can reach, and reads back every visible text node plus
every placeholder/aria-label/title.

It is a diagnostic, not a test: it prints a report and writes
admin-untranslated-<lang>.json. test-admin-i18n-coverage.py is the assertion
built on the same walk.

Run:  python3 find-admin-untranslated.py [outdir] [lang]
"""
import asyncio, json, os, re, sys, functools, threading, http.server, socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/admin-untranslated'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'admin')
# 8901: every other harness's port is listed in CLAUDE.md's Round 157 note.
# Two harnesses on one port die with "Address already in use" in whichever
# starts second, which reads like a real failure and is not.
PORT = 8901
LANG = (sys.argv[2] if len(sys.argv) > 2 else 'sw').lower()
REPORT = os.path.join(HERE, f'admin-untranslated-{LANG}.json')


# ── the tables, read out of the two sources they really live in ───────────
def _js_array(js, name, where):
    m = re.search(r'(?:var|const) ' + name + r' = \[([\s\S]*?)\n\];', js)
    if not m:
        raise SystemExit(f'{name} not found in {where}')
    import subprocess
    out = subprocess.run(['node', '-e', 'console.log(JSON.stringify([' + m.group(1) + ']))'],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f'{name} did not parse:\n' + out.stderr)
    return json.loads(out.stdout)


APP_JS = open(os.path.join(HERE, 'user-src', 'original_module.js'), encoding='utf8').read()
ADMIN_HTML = open(os.path.join(HERE, 'admin-src', 'index.html'), encoding='utf8').read()
# The panel's table is the app's PLUS its own, concatenated in that order --
# exactly what the built bundle does. Reading only one of the two would report
# every shared word as a finding.
ROWS = _js_array(APP_JS, 'LANG_ROWS', 'original_module.js') + \
       _js_array(ADMIN_HTML, 'ADMIN_LANG_ROWS', 'admin-src/index.html')
PATTERNS = _js_array(APP_JS, 'LANG_PATTERNS', 'original_module.js') + \
           _js_array(ADMIN_HTML, 'ADMIN_LANG_PATTERNS', 'admin-src/index.html')

LANG_IDX = {'lg': 1, 'sw': 2, 'fr': 3, 'rw': 4, 'nyn': 5}[LANG]


def norm(v):
    """The same normalisation the sweep applies: any whitespace run, U+00A0
    included, becomes one plain space."""
    return re.sub(r'\s+', ' ', (v or '').replace('\u00a0', ' ')).strip()


EN_KEYS = {r[0].strip(): r for r in ROWS if r and r[0]}
DELIBERATE_SAME = {k for k, r in EN_KEYS.items()
                   if len(r) > LANG_IDX and r[LANG_IDX] == '='}
TRANSLATED = {k for k, r in EN_KEYS.items()
              if len(r) > LANG_IDX and r[LANG_IDX] and r[LANG_IDX] != '='
              and r[LANG_IDX].strip() and r[LANG_IDX].strip() != k}
# Every string the table can PRODUCE in this language, so the sweep does not
# report its own correct output as a finding.
TRANSLATED_VALUES = {norm(r[LANG_IDX]) for r in ROWS
                     if len(r) > LANG_IDX and r[LANG_IDX]}


def _tpl_re(tpl):
    parts = re.split(r'\{(\d+)\}', norm(tpl))
    out = '^'
    for i, part in enumerate(parts):
        out += '([\\s\\S]+?)' if i % 2 else re.escape(part)
    return re.compile(out + '$')


PATTERN_EN = [(_tpl_re(r[0]), r) for r in PATTERNS if r and r[0]]
# '=' means the same in a template as in a row -- the right wording in this
# language IS the English one -- so it is not a template to match OUTPUT
# against, and a template carrying it is a deliberate match rather than a
# pattern that failed to apply (see classify()).
PATTERN_OUT = [_tpl_re(r[LANG_IDX]) for r in PATTERNS
               if len(r) > LANG_IDX and r[LANG_IDX] and r[LANG_IDX].strip()
               and r[LANG_IDX] != '=']

# ── what is NOT a translatable word ───────────────────────────────────────
DATA_PATTERNS = [
    r'^[\d\s,.:+%/×x—–-]+$',
    r'^[+\-]?(UGX|KES|TZS|RWF)\s?[\d,.]*$',
    r'^\+?\d[\d\s-]*$',
    r'^0\d{8,}$',
    r'^[A-Z0-9]{5,12}$',
    r'^Product-\d+$',
    r'^\d+%$',
    r'^[a-z]+(-[a-z0-9]+)+$',
    r'^\S+@\S+$',
    r'^https?://',
    r'^[0-9Xx\s()+-]+$',
    r'^\d{2}/\d{2}/\d{4}',
    # A rendered timestamp: "01 Aug, 10:00", "14 Sept, 08:00". The month is
    # spelled by the panel's own formatter, in one fixed form, and a date is
    # never translated copy.
    r'^\d{1,2} [A-Z][a-z]{2,4},? \d{2}:\d{2}$',
    # A hostname, a label, a base domain, a placeholder the owner types into a
    # payment-steps template. All of these are addresses and tokens.
    r'^[a-z0-9<>.-]+\.[a-z]{2,}$',
    r'^\{\{\w+\}\}$',
    # A region key with its caption, e.g. "ug · founding". Deliberately NOT a
    # bare two-letter match: "to", "is", "and", "one" are prose fragments and
    # must keep showing up as findings rather than being waved away as keys.
    r'^[a-z]{2,3} · .*$',
    # Money and plan figures the panel composes: "UGX 30,000 · 150 days",
    # "Pays UGX 900,000", "-UGX 20,000".
    r'^(Pays )?[−+-]?(UGX|KES|TZS|RWF)\s?[\d,.]+( · .*)?$',
    # An internal action key out of the audit log ("settings_update").
    r'^[a-z][a-z0-9]*(_[a-z0-9]+)+$',
]
DATA_RE = [re.compile(p) for p in DATA_PATTERNS]

# Fixture values that render as words but are data: a member's name, a
# country, an operator, a product title, an admin username. Translating any of
# these would be a bug, so they are not findings.
FIXTURE_WORDS = {
    'Chipz', 'Chipz Admin', 'CHIPZ', 'MTN', 'Airtel', 'MTN Mobile Money', 'Airtel Money',
    'English', 'Luganda', 'Kiswahili', 'Français', 'Ikinyarwanda', 'Runyankore',
    'Uganda', 'Kenya', 'UGX', 'KES', 'owner', 'staff', 'jane', 'John Doe',
    'Product-1', 'Product-2', 'Product-12', 'MarzPay', 'LipaPay', 'Render',
    'WhatsApp', 'Facebook', 'Telegram', 'Android', 'Chrome', 'iOS', 'Safari',
    'Mongo', 'MongoDB', 'Atlas', 'Firebase', 'EdgeOne', 'ug', 'ke', 'www', 'TXT',
    'Chipz MTN 1', 'CHIPZ wordmark', 'Welcome to Chipz', 'Welcome to Chipz!',
    'banner.mp4', 'm1 · · Uganda',
    # The payment SMS a MEMBER pasted, shown to the admin verbatim so a person
    # can judge it. It is somebody else's message -- the one thing on this
    # screen that must reach the admin exactly as it was sent.
    'You have received UGX 50,000 from 0742730382. Txn ID 1234567890.',
    'random text that is not a payment message',
}

# Content the OWNER types into this panel -- message bodies, the announcement,
# About blocks, a brand name. Nothing in this repo can translate a sentence
# written at runtime, so these are data. The fixture's own values are listed
# explicitly rather than guessed at, so a real string can never be waved away
# as "probably admin copy".
ADMIN_AUTHORED = {
    'Welcome', 'Welcome to the app.', 'Payout update', 'Payouts run daily.',
    'About us', 'We pay daily.', 'Launch bonus', 'Grand opening',
    # The DEFAULT values the panel ships in its own text boxes: a tagline, a
    # maintenance notice, the USSD steps for a payment reminder, the allowed-
    # domains example. They are starting points for the owner to overwrite in
    # his own words -- translating the example he is about to replace would
    # only make it harder to tell what is his and what is ours.
    "Uganda's boldest way to grow your money.",
    "We're topping up our stock, back shortly.",
    'chipz-platform.com www.chipz-platform.com',
    '1: Dial *165# 2: Select 1 Send Money 3: Select 1 Mobile User 4: Enter number '
    '{{number}} 5: Enter Amount {{amount}} 6: Enter Reason 7: Enter your PIN code',
}


def is_data(s):
    if s in ADMIN_AUTHORED or s in FIXTURE_WORDS:
        return True
    if not re.search(r'[A-Za-z]{2}', s):
        return True
    return any(r.match(s) for r in DATA_RE)


def classify(s):
    """CLEAN, DELIBERATE, DATA or a finding. A finding is a string the table
    cannot ACCOUNT FOR -- not a string that looks foreign, which is the test
    that reported 108 correct Swahili strings as gaps in the app's own sweep."""
    n = norm(s)
    if not n:
        return 'clean'
    if n in TRANSLATED_VALUES:
        return 'clean'
    if n in DELIBERATE_SAME:
        return 'deliberate'
    if n in TRANSLATED:
        return 'english-row-not-applied'
    if is_data(n):
        return 'data'
    for r in PATTERN_OUT:
        if r.match(n):
            return 'clean'
    for r, row in PATTERN_EN:
        if r.match(n):
            cell = row[LANG_IDX] if len(row) > LANG_IDX else ''
            if cell == '=':
                return 'deliberate'
            if cell and cell.strip():
                return 'english-pattern-not-applied'
            return 'missing-pattern'
    if len(n) > 160:
        # The engine skips anything longer than its own cap, so a row for this
        # could never apply. Reported separately rather than as a missing row.
        return 'too-long'
    return 'missing'


from find_admin_fixtures import R, API   # every tab's data, shared with test-admin-i18n.py


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


SWEEP = """() => {
  const out = [];
  const seen = new Set();
  const vis = el => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      if (n.hasAttribute && n.hasAttribute('hidden')) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const where = el => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement)
      bits.unshift(n.id ? '#' + n.id : (n.className && typeof n.className === 'string'
        ? '.' + n.className.trim().split(/\\s+/)[0] : n.tagName.toLowerCase()));
    return bits.join(' ');
  };
  // Is this text node one PIECE of a sentence that was broken up by inline
  // markup? The panel's help paragraphs read
  //     <p class="muted">Set it under <b>Settings</b>, then add the <code>*</code> record.</p>
  // which is four text nodes, none of them a sentence. The translator matches
  // WHOLE text nodes, so no row can ever apply to one of these -- and a row
  // for ", then add the" translated out of context would be nonsense anyway.
  // Detected by finding the text's block owner (walking up past inline tags)
  // and asking whether that block holds more than the one node.
  const INLINE = { B:1, I:1, EM:1, STRONG:1, CODE:1, A:1, SPAN:1, U:1, SMALL:1, MARK:1 };
  const mixed = el => {
    let n = el;
    while (n && n.parentElement && INLINE[n.tagName]) n = n.parentElement;
    return !!(n && n.childNodes && n.childNodes.length > 1);
  };
  const push = (txt, el, kind) => {
    const t = String(txt || '').replace(/\\s+/g, ' ').trim();
    if (!t) return;
    const key = kind + '\\u0000' + t;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, at: where(el), kind, mixed: kind === 'text' && mixed(el) });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p) continue;
    const tag = p.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') continue;
    if (p.closest('[data-no-i18n]')) continue;
    if (!vis(p)) continue;
    push(n.nodeValue, p, 'text');
  }
  for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    if (el.closest('[data-no-i18n]')) continue;
    if (!vis(el)) continue;
    for (const a of ['placeholder', 'aria-label', 'title'])
      if (el.hasAttribute(a)) push(el.getAttribute(a), el, a);
  }
  return out;
}"""


async def collect(page, label, found):
    try:
        rows = await page.evaluate(SWEEP)
    except Exception as e:
        found.setdefault('_errors', []).append(f'{label}: {e}')
        return
    # A SCREEN THAT PAINTED NOTHING MEASURES NOTHING, and it does not announce
    # itself: switchTab() runs each renderer as Promise.resolve(fn()).catch(()
    # => {}), so a renderer that throws on a badly-shaped fixture leaves
    # #content empty, raises no page error, and this sweep cheerfully reports
    # zero findings for that tab. That is exactly how the Deposits and
    # Withdrawals tabs went unmeasured for a whole round here (their
    # processedByDay fixture was an object where the renderer spreads an
    # array). Recorded as an error, not a note.
    if label not in ('sign-in',) and not any(r['kind'] == 'text' for r in rows):
        found.setdefault('_errors', []).append(
            f'{label}: the screen rendered NO text -- nothing was measured here')
    for r in rows:
        found.setdefault(r['text'], {'at': r['at'], 'kind': r['kind'],
                                     'mixed': r.get('mixed', False), 'screens': set()})
        # A string that renders whole ANYWHERE is translatable, even if some
        # other screen splices it into a sentence -- so one clean rendering
        # clears the fragment flag rather than the other way round.
        if not r.get('mixed', False):
            found[r['text']]['mixed'] = False
        found[r['text']]['screens'].add(label)


# Every tab, plus the sub-tabs and modals inside them. A tab that will not open
# is a step whose strings were never measured, so every failure is recorded --
# "no findings" from a screen that never rendered is the most dangerous kind of
# green.
TABS = ['dashboard', 'analytics', 'users', 'deposits', 'withdrawals', 'transactions',
        'referrals', 'products', 'promocodes', 'messages', 'settings', 'regions',
        'admins', 'auditlog']


async def main():
    srv = serve()
    found, errs, notes = {}, [], []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        ctx = await b.new_context(viewport={"width": 1100, "height": 1400},
                                  service_workers="block")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))

        async def api(r):
            path = "/" + r.request.url.split("://", 1)[-1].split("/", 1)[-1].split("?")[0]
            body = next((v for k, v in R.items() if path.endswith(k)), {"status": "success"})
            await r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        await page.route(f"{API}/**", api)
        await page.add_init_script(
            "try{localStorage.setItem('chipz_admin_lang',%r);}catch(e){}" % LANG)

        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        await page.wait_for_timeout(600)
        await collect(page, 'sign-in', found)

        await page.fill('#keyInput', 'x')
        await page.click('#loginBtn')
        await page.wait_for_timeout(1500)

        for tab in TABS:
            try:
                await page.click(f'button[data-tab="{tab}"]')
                await page.wait_for_timeout(1300)
            except Exception as e:
                notes.append(f'tab {tab} would not open: {e}')
                continue
            await collect(page, tab, found)
            # Sub-tabs inside this tab (Deposits' pending/review/..., the
            # transactions filters, the settings cards) -- each paints copy of
            # its own that the tab's first view never shows.
            subs = await page.eval_on_selector_all(
                '#content [data-sub], #content .subtab, #content [data-filter]',
                "els => els.map((e,i) => i).slice(0, 8)")
            for i in subs:
                try:
                    await page.eval_on_selector_all(
                        '#content [data-sub], #content .subtab, #content [data-filter]',
                        "(els, i) => els[i] && els[i].click()", i)
                    await page.wait_for_timeout(700)
                    await collect(page, f'{tab}:sub{i}', found)
                except Exception as e:
                    notes.append(f'{tab} sub {i}: {e}')

        # The one modal every tab can raise, and the user detail sheet.
        try:
            await page.click('button[data-tab="users"]')
            await page.wait_for_timeout(1200)
            await page.eval_on_selector_all('#userRows tr', "els => els[0] && els[0].click()")
            await page.wait_for_timeout(1200)
            await collect(page, 'user-detail', found)
        except Exception as e:
            notes.append(f'user detail: {e}')

        await b.close()
    srv.shutdown()

    # A screen that would not open, or opened and painted nothing. These are
    # failures, not notes: an unmeasured screen reported as clean is the most
    # dangerous kind of green this harness can produce.
    notes += found.pop('_errors', [])
    blind = [n for n in notes if 'rendered NO text' in n or 'would not open' in n]

    buckets = {}
    for text, info in found.items():
        why = classify(text)
        # A piece of a sentence that inline markup broke up. Reported, not a
        # finding, for the reason given beside `mixed` in SWEEP above.
        if why == 'missing' and info.get('mixed'):
            why = 'fragment'
        buckets.setdefault(why, []).append(
            {'text': text, 'at': info['at'], 'kind': info['kind'],
             'screens': sorted(info['screens'])})

    # 'too-long' is reported but is NOT a finding, and the distinction is a
    # real one rather than a convenience: the engine skips any text node over
    # 160 characters, so a row for one could never apply however carefully it
    # were written. Long-form operator documentation in this panel therefore
    # stays English by construction, and saying so out loud is better than a
    # table full of rows that do nothing.
    findings = []
    for k in ('missing', 'missing-pattern', 'english-row-not-applied',
              'english-pattern-not-applied'):
        findings += [dict(r, why=k) for r in buckets.get(k, [])]
    findings.sort(key=lambda r: (r['why'], r['text'].lower()))

    json.dump({'lang': LANG, 'findings': findings, 'blind': blind,
               'counts': {k: len(v) for k, v in buckets.items()},
               'pageErrors': errs, 'notes': notes},
              open(REPORT, 'w', encoding='utf8'), indent=1, ensure_ascii=False)

    print(f'\n=== admin panel, rendered in {LANG} ===')
    for k, v in sorted(buckets.items()):
        print(f'  {k:32} {len(v)}')
    print(f'  page errors                      {len(errs)}')
    for n in notes:
        print('  NOTE ' + n)
    for e in errs[:5]:
        print('  ERROR ' + e)
    print(f'\n{len(findings)} finding(s) -> {REPORT}')
    for f in findings[:80]:
        print(f'  [{f["why"]}] {f["kind"]}: {f["text"][:110]}   ({f["screens"][0]})')
    if len(findings) > 80:
        print(f'  ... and {len(findings) - 80} more')
    for n in blind:
        print('  BLIND ' + n)
    return 1 if (findings or errs or blind) else 0


sys.exit(asyncio.run(main()))
