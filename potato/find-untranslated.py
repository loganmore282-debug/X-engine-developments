#!/usr/bin/env python3
"""
Every English word still reaching a member's screen, found by LOOKING at the
screen rather than by grepping the sources.

Owner: "make sure every language is fixed on anything ... words such as
failed, paid, l need all words sentences in the language, all words on login,
register, dashboard, deposit, wallet, download app ... whether words in my
products all terms there should change ... price, total, coming soon, all
everything."

WHY THIS EXISTS AND extract-ui-strings.py DOES NOT ANSWER IT.
extract-ui-strings.py reads the sources with regexes and found 213 strings.
That is not the same question. A regex has to understand how a string is
built, and this app builds nearly every screen out of template literals,
helper calls, ternaries, `?:` chains inside attributes, and strings assembled
from two halves -- so anything the patterns did not model simply was not in
the list, silently, and fell back to English on the phone. Which is exactly
what the owner is looking at.

This drives the BUILT, obfuscated app in a real browser with the language set
to one whose column is complete, walks every screen, sheet, dialog and sub-tab
it can reach, and reads back every VISIBLE text node. Anything that comes back
still reading as English is, by definition, a string the translator never saw
-- no modelling of the source required, and it cannot miss a string because of
how that string happens to be written.

It is a diagnostic, not a test: it prints a report and writes
untranslated-report.json. test-i18n-coverage.py is the assertion built on the
same walk.

Run:  python3 find-untranslated.py [outdir]
"""
import asyncio, json, os, re, sys, functools, threading, http.server, socketserver
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from playwright.async_api import async_playwright
from urllib.parse import urlsplit
from chipz_test_api import API

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/untranslated'
os.makedirs(OUT, exist_ok=True)
ROOT = os.path.join(HERE, 'user')
# 8899: every other harness's port is listed in CLAUDE.md's Round 157 note.
# Two on one port die with "Address already in use" in whichever starts
# second, which reads like a real failure and is not.
PORT = 8899
REPORT_FOR = lambda lang: os.path.join(HERE, f'untranslated-report-{lang}.json')

# The language this sweep renders in. `python3 find-untranslated.py out xx`.
# Swahili is the default because its column was the most complete, and a sweep
# run in a half-filled language reports its own blanks as findings and buries
# the real ones -- but EVERY column has to come back clean, which is the whole
# of "not missing English and any language", so run it per language.
LANG_CODES_ARGV = ('en', 'lg', 'sw', 'fr', 'rw', 'nyn')
# THE LANGUAGE IS argv[2]; argv[1] IS THE OUTPUT DIRECTORY.
#
# `find-untranslated.py fr` silently set the OUTPUT PATH to "fr" and swept
# SWAHILI, then wrote the Swahili report -- so four "clean in fr/lg/rw/nyn"
# runs were one language measured four times, and the mismatched filename in
# the output was waved away as a display quirk. Refusing the ambiguous form
# is the whole fix: a harness that quietly measures something other than what
# it was asked to is worse than one that stops.
if len(sys.argv) > 1 and sys.argv[1].lower() in LANG_CODES_ARGV:
    sys.exit(f'usage: {sys.argv[0]} <out-dir> <lang>   '
             f'(you passed "{sys.argv[1]}" as the OUTPUT DIRECTORY; '
             f'did you mean: {sys.argv[0]} /tmp/out {sys.argv[1]})')
LANG = (sys.argv[2] if len(sys.argv) > 2 else 'sw').lower()

# ── the table, read out of the app's own source ───────────────────────────
def lang_rows():
    js = open(os.path.join(HERE, 'user-src', 'original_module.js'), encoding='utf8').read()
    m = re.search(r'var LANG_ROWS = \[([\s\S]*?)\n\];', js)
    if not m:
        raise SystemExit('LANG_ROWS not found in original_module.js')
    import subprocess
    # Through a FILE, not `node -e`. The table outgrew the argv limit --
    # OSError: [Errno 7] Argument list too long -- the moment the panel's
    # own instruction paragraphs went in, and an exec limit is not
    # something to discover again later.
    _tmp = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8')
    _tmp.write('console.log(JSON.stringify([' + m.group(1) + ']))')
    _tmp.close()
    out = subprocess.run(['node', _tmp.name],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit('LANG_ROWS did not parse:\n' + out.stderr)
    return json.loads(out.stdout)


def lang_patterns():
    js = open(os.path.join(HERE, 'user-src', 'original_module.js'), encoding='utf8').read()
    m = re.search(r'var LANG_PATTERNS = \[([\s\S]*?)\n\];', js)
    if not m:
        return []
    import subprocess
    # Through a FILE, not `node -e`. The table outgrew the argv limit --
    # OSError: [Errno 7] Argument list too long -- the moment the panel's
    # own instruction paragraphs went in, and an exec limit is not
    # something to discover again later.
    _tmp = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8')
    _tmp.write('console.log(JSON.stringify([' + m.group(1) + ']))')
    _tmp.close()
    out = subprocess.run(['node', _tmp.name],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit('LANG_PATTERNS did not parse:\n' + out.stderr)
    return json.loads(out.stdout)


def norm(v):
    """The same normalisation SWEEP applies: any whitespace run, U+00A0
    included, becomes one plain space. Comparing an un-normalised template
    against normalised screen text is how five correct French translations
    got reported as findings."""
    return re.sub(r'\s+', ' ', (v or '').replace('\u00a0', ' ')).strip()


ROWS = lang_rows()
PATTERNS = lang_patterns()
LANG_IDX = {'lg': 1, 'sw': 2, 'fr': 3, 'rw': 4, 'nyn': 5}[LANG]
EN_KEYS = {r[0].strip(): r for r in ROWS if r and r[0]}
# '=' is a DELIBERATE match -- the right word in this language is the English
# word (French for "Messages" is "Messages"). It stores no dictionary entry, so
# the English is what reaches the screen and that is correct; counting it as a
# gap is what made four French words permanent findings.
DELIBERATE_SAME = {k for k, r in EN_KEYS.items()
                   if len(r) > LANG_IDX and r[LANG_IDX] == '='}
TRANSLATED = {k for k, r in EN_KEYS.items()
              if len(r) > LANG_IDX and r[LANG_IDX] and r[LANG_IDX] != '='
              and r[LANG_IDX].strip() and r[LANG_IDX].strip() != k}
# Every string the table can PRODUCE in this language. Without this the sweep
# reports its own correct output as a finding: "Pochi", "Timu", "Wanachama 2"
# are the translations working, and the first version of this file listed 108
# of them as untranslated because its only test for "is this English" was
# "does it contain a latin letter" -- which Swahili does too. A finding has to
# be a string the table cannot account for, not a string that looks foreign.
TRANSLATED_VALUES = {norm(r[LANG_IDX])
                     for r in ROWS if len(r) > LANG_IDX and r[LANG_IDX]}


def _tpl_re(tpl):
    """A {0}-template as an anchored regex, the same shape tPattern() builds."""
    parts = re.split(r'\{(\d+)\}', norm(tpl))
    out = '^'
    for i, part in enumerate(parts):
        out += '([\\s\\S]+?)' if i % 2 else re.escape(part)
    return re.compile(out + '$')


# Both directions: an English template still on screen is a MISSING pattern
# cell; a translated template on screen is the pattern working.
PATTERN_EN = [(_tpl_re(r[0]), r) for r in PATTERNS if r and r[0]]
# '=' in a template means the same as in a row: the right wording in this
# language IS the English one. So it is never something to match OUTPUT
# against, and a template carrying it is a DELIBERATE match rather than a
# template this language has not been given yet.
PATTERN_OUT = [_tpl_re(r[LANG_IDX]) for r in PATTERNS
               if len(r) > LANG_IDX and r[LANG_IDX] and r[LANG_IDX].strip()
               and r[LANG_IDX] != '=']
PATTERN_SAME = [_tpl_re(r[0]) for r in PATTERNS
                if len(r) > LANG_IDX and r[LANG_IDX] == '=']

# ── what is NOT a translatable word ───────────────────────────────────────
# Data, not copy. A member's own phone number, a figure, a product name, an
# account id: translating any of these would be a bug, so they must not be
# reported as findings or the report is unusable.
DATA_PATTERNS = [
    r'^[\d\s,.:+%/×x—–-]+$',                       # numbers, money without a label, dates, times
    r'^[+\-]?(UGX|KES|TZS|RWF)\s?[\d,.]*$',         # an amount, with or without a sign
    r'^\+?\d[\d\s-]*$',                            # phone numbers
    r'^0\d{8,}$',
    r'^[A-Z0-9]{5,10}$',                           # referral codes, account ids
    r'^Product-\d+$',
    r'^\d+%$',
    r'^[a-z]+(-[a-z0-9]+)+$',                      # slugs / keys
    r'^\S+@\S+$',
    r'^https?://',
    r'^[0-9Xx\s()+-]+$',                           # a phone-number FORMAT MASK
                                                   # ("07XX XXX XXX") -- every
                                                   # language shows a number
                                                   # the same way, so this is
                                                   # never a translatable word.
]
DATA_RE = [re.compile(p) for p in DATA_PATTERNS]

# Fixture values that render as words but are data.
FIXTURE_WORDS = {
    'Chipz', 'CHIPZ', 'CHIP', 'Z', 'MTN Mobile Money', 'Airtel Money', 'MTN', 'Airtel',
    'Kiswahili', 'English', 'Luganda', 'Français', 'Ikinyarwanda', 'Runyankole',
    'Uganda', 'UGX', 'Product-1', 'Product-2', 'Product-12', 'Starter Chip',
    'Golden Chip', 'John Doe', 'User', 'Welcome Bonus', 'Chipz Team',
}


# Content the OWNER types in the admin panel. Nothing in this repo can
# translate a sentence he writes at runtime, so these are not findings -- they
# are data. Listed explicitly rather than guessed at, so a real string can
# never be waved away as "probably admin copy". These are the fixture's own
# message titles/bodies and announcement text.
ADMIN_AUTHORED = {
    'Welcome', 'Welcome to the app.', 'Payout update', 'Payouts run daily.',
    'Thanks for joining.',
}


def is_data(s):
    if s in ADMIN_AUTHORED:
        return True
    if s in FIXTURE_WORDS:
        return True
    if not re.search(r'[A-Za-z]{2}', s):
        return True
    for r in DATA_RE:
        if r.match(s):
            return True
    return False


# Does this read as English? The sweep renders in Swahili, so a node that is
# not in the table at all is only interesting if it looks like English words.
# Kept deliberately loose -- a false positive costs one glance, a false
# negative is a word the owner finds on his phone.
def looks_english(s):
    return bool(re.search(r'[A-Za-z]', s))


# ── fixtures rich enough that every screen actually paints ────────────────
def region(langs=None, default='en'):
    # Every language this sweep might be run in must be OFFERED by the
    # country, or resolveLang() correctly falls back to the default and the
    # sweep measures English while believing it measured Luganda.
    langs = langs or ('en', 'lg', 'sw', 'fr', 'rw', 'nyn')
    return {"key": "ug", "name": "Uganda", "currency": "UGX", "dialCode": "256",
            "localLength": 9, "prefixes": ["7"], "utcOffsetMin": 180, "isDefault": True,
            "usesBareLocal": True, "languages": list(langs), "defaultLang": default}


ACCOUNT = {"phone": "0742730382", "walletBalance": 128500, "totalDeposited": 200000,
           "totalEarned": 31000, "totalWithdrawn": 20000, "totalInvested": 120000,
           "checkinStreak": 3, "lastCheckinAt": None, "referralCode": "UG7Q4X",
           "publicId": "00042", "registrationDone": True, "spins": 2,
           "team": {"l1": 2, "l2": 1, "l3": 0, "commission": 4200}}

SETTINGS = {"minDeposit": 30000, "minWithdraw": 20000, "withdrawFeePct": 15,
            "withdrawMultiple": 5000, "commL1": 27, "commL2": 2, "commL3": 1,
            "annEnabled": True, "annTitle": "Welcome", "annBody": "Welcome to the app.",
            "depositPayAEnabled": True, "depositPayBEnabled": True,
            "openingCountdownEnabled": False, "maintenanceMode": False,
            "dailyCheckin": 500, "turntableEnabled": True, "brandName": "Chipz",
            "turntableDailyMin": 200, "turntableDailyMax": 1000,
            "requireInvestToWithdraw": False, "withdrawWindowEnabled": True,
            "withdrawOpenFrom": "06:00", "withdrawOpenTo": "17:00",
            "returnMultiple": 30, "cycleDays": 150, "maxWithdrawalsPerDay": 1}

PRODUCTS = [
    {"key": "product-1", "name": "Product-1", "price": 30000, "cycle": 150,
     "expectedReturn": 900000, "dailyPayout": 6000, "image": "", "active": True,
     "spinCount": 2, "spinMin": 200, "spinMax": 1000, "open": True},
    {"key": "product-2", "name": "Product-2", "price": 90000, "cycle": 150,
     "expectedReturn": 2700000, "dailyPayout": 18000, "image": "", "active": True,
     "comingSoon": True, "open": False, "openMode": "soon"},
    {"key": "product-3", "name": "Product-3", "price": 270000, "cycle": 150,
     "expectedReturn": 8100000, "dailyPayout": 54000, "image": "", "active": True,
     "open": False, "openMode": "until", "opensAt": 4102444800000},
]

INVESTMENTS = [
    {"id": "i1", "tierKey": "product-1", "tierName": "Product-1", "amount": 30000,
     "expectedReturn": 900000, "payoutsMade": 4, "payoutsTotal": 150, "paidOut": 24000,
     "status": "running", "createdAt": "2026-09-10T18:13:00Z"},
    {"id": "i2", "tierKey": "product-2", "tierName": "Product-2", "amount": 90000,
     "expectedReturn": 2700000, "payoutsMade": 150, "payoutsTotal": 150,
     "paidOut": 2700000, "status": "matured", "createdAt": "2026-03-01T09:00:00Z"},
]

TRANSACTIONS = [
    {"id": "t1", "type": "deposit", "amount": 50000, "status": "completed",
     "desc": "Online deposit", "date": "12/09/2026", "time": "14:02"},
    {"id": "t2", "type": "withdraw", "amount": -20000, "status": "pending",
     "description": "Withdrawal: Processing", "date": "13/09/2026", "time": "09:41"},
    {"id": "t3", "type": "withdraw", "amount": -20000, "status": "failed",
     "description": "Withdrawal: Rejected \u2014 refunded to wallet",
     "date": "13/09/2026", "time": "10:02"},
    {"id": "t3b", "type": "withdraw", "amount": -25000, "status": "processed",
     "description": "Withdrawal: Paid", "date": "13/09/2026", "time": "11:30"},
    {"id": "t3c", "type": "deposit", "amount": 40000, "status": "processed",
     "description": "Deposit: Paid", "date": "13/09/2026", "time": "12:00"},
    {"id": "t4", "type": "turntable", "amount": 700, "status": "completed",
     "desc": "Turntable win", "date": "14/09/2026", "time": "07:15"},
    {"id": "t5", "type": "welcome_bonus", "amount": 7000, "status": "completed",
     "desc": "Welcome Bonus", "date": "01/09/2026", "time": "08:00"},
    {"id": "t6", "type": "l1_commission", "amount": 8100, "status": "completed",
     "desc": "L1 commission", "date": "02/09/2026", "time": "11:20"},
    {"id": "t7", "type": "daily_cashback", "amount": 6000, "status": "completed",
     "desc": "Daily cashback", "date": "14/09/2026", "time": "00:05"},
]

MESSAGES = [{"id": "m1", "title": "Welcome", "body": "Thanks for joining.",
             "createdAt": "2026-09-01T08:00:00Z", "read": False},
            {"id": "m2", "title": "Payout update", "body": "Payouts run daily.",
             "createdAt": "2026-09-05T08:00:00Z", "read": True}]

MEMBERS = [{"phone": "0756110296", "invested": 90000, "createdAt": "2026-09-01T10:00:00Z"},
           {"phone": "0771220399", "invested": 0, "createdAt": "2026-09-13T08:30:00Z"}]

WALLET = [{"id": "w1", "provider": "MTN Mobile Money", "accountNumber": "0742730382",
           "accountName": "John Doe", "isDefault": True}]


REFERRAL_REQUIRED = True


def routes(reg):
    return {
        # referralRequired sits INSIDE settings -- referralIsRequired() reads
        # STATE.settings.referralRequired, and STATE.settings IS this object.
        "/public/settings": {"status": "success", "region": reg, "regionCount": 2,
                             "settings": dict(SETTINGS, referralRequired=REFERRAL_REQUIRED)},
        "/public/products": {"status": "success", "products": PRODUCTS},
        # The Home activity ticker. It was an EMPTY feed, so the ticker never
        # rendered and its two verbs ("topped up" / "cashed out") had never
        # been on screen while anything was measuring -- they were missing
        # from the table for as long as the table has existed. A fixture that
        # renders nothing cannot test what renders.
        "/public/activity-feed": {"status": "success", "feed": [
            {"kind": "deposit", "phone": "256****4417", "amount": 30000},
            {"kind": "withdraw", "phone": "256****9022", "amount": 25000},
            {"kind": "deposit", "phone": "256****1180", "amount": 90000},
        ]},
        "/public/banner": {"status": "success", "image": None},
        "/public/announcement-image": {"status": "success", "image": None},
        "/public/manual-pay-images": {"status": "success", "selector": None, "hero": None},
        "/public/chipz-images": {"status": "success", "referral": None, "logo": None,
                                 "spin": None, "profilegif": None, "downloadbg": None},
        "/public/share-host": {"status": "success", "host": "", "hosts": [], "count": 0},
        "/public/entry": {"status": "success", "rotate": False, "mode": "off", "host": ""},
        "/account": {"status": "success", "account": ACCOUNT, "region": reg},
        "/investments": {"status": "success", "investments": INVESTMENTS},
        "/transactions": {"status": "success", "transactions": TRANSACTIONS, "truncated": False},
        "/messages": {"status": "success", "messages": MESSAGES},
        "/bank/list": {"status": "success", "accounts": WALLET},
        "/team/members": {"status": "success", "members": MEMBERS},
        "/team/stats": {"status": "success", "referralCode": "UG7Q4X",
                        "commRates": {"l1": 27, "l2": 2, "l3": 1},
                        "team": {"l1": 2, "l2": 1, "l3": 0}, "totalTeam": 3,
                        "teamCommission": 4200, "teamDeposits": 120000, "milestones": []},
        "/turntable/status": {"status": "success", "enabled": True, "spins": 2,
                              "canDaily": True, "min": 200, "max": 1000},
        "/checkin/status": {"status": "success", "claimedToday": False, "streak": 3, "bonus": 500},
        # Real numbers, not an empty list. With none configured the manual
        # flow answers "busy" and the code screen -- a whole screen of copy --
        # can never render, which is exactly how it went unmeasured.
        "/manual-pay/numbers": {"status": "success", "numbers": [
            {"id": "n1", "number": "0770000001", "holderName": "Jane Doe",
             "network": "MTN Mobile Money", "active": True}]},
    }


FB_APP = "export const initializeApp=()=>({});export const getApps=()=>[];"
FB_AUTH = """const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};
 export const getAuth=()=>({currentUser:user});
 export const createUserWithEmailAndPassword=async()=>({user});
 export const signInWithEmailAndPassword=async()=>({user});
 export const signOut=async()=>{};export const updatePassword=async()=>{};
 export const reauthenticateWithCredential=async()=>{};
 export const EmailAuthProvider={credential:()=>({})};
 export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),0);};
"""
FB_AUTH_OUT = FB_AUTH.replace("const user={uid:'u1',email:'742730382@chipz-platform.com',getIdToken:async()=>'tok'};",
                              "const user=null;")


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


# Every visible text node on screen, with the selector path that produced it
# so a finding can be located. Attribute copy (placeholder / aria-label /
# title) is collected too -- the sweep translates those and they are just as
# visible to a member as a text node.
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
  // A sentence that inline markup broke up is now translated AS ONE BLOCK by
  // the engine, so what the sweep must report is the WHOLE sentence -- the key
  // a row actually needs -- not its three pieces. The rule for "is this one
  // block?" is the ENGINE'S OWN, reached through window.__i18nBlockOk: a copy
  // of it here would be a second source of truth, and the row it told you to
  // write would be keyed on a sentence the engine never forms.
  // Its own list rather than borrowing the one the fragment detector uses:
  // that one does not exist in every copy of this sweep, and a helper that
  // depends on a declaration somewhere above it fails at runtime in the file
  // that lacks it -- which is exactly what happened here first.
  const INLINE_OWN = { B:1, I:1, EM:1, STRONG:1, CODE:1, A:1, SPAN:1, U:1, SMALL:1, MARK:1 };
  const blockOwner = el => {
    let n = el;
    while (n && n.parentElement && INLINE_OWN[n.tagName]) n = n.parentElement;
    return n;
  };
  const okBlock = window.__i18nBlockOk || null;
  const maxLen = window.__i18nMaxLen ? window.__i18nMaxLen() : 160;
  const push = (txt, el, kind, blockKey) => {
    const t = String(txt || '').replace(/\\s+/g, ' ').trim();
    if (!t) return;
    const key = kind + '\\u0000' + t;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, at: where(el), kind, blockKey: blockKey || '' });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p) continue;
    const tag = p.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') continue;
    if (p.closest('[data-no-i18n]')) continue;
    if (!vis(p)) continue;
    // The PIECE is still what gets classified: a sentence whose pieces are
    // all translated already is working, and reporting it again just because
    // the engine could now also do it whole would be noise. What the block key
    // buys is that when a piece IS missing, the report names the whole
    // sentence -- which is the key a row actually needs.
    let blockKey = '';
    const owner = blockOwner(p);
    if (okBlock && owner && okBlock(owner)) {
      const whole = String(owner.textContent || '').replace(/\s+/g, ' ').trim();
      // Over the cap the engine will not look at it either, so asking for a
      // row that could never apply would be worse than saying nothing.
      if (whole && whole.length <= maxLen && whole !== String(n.nodeValue || '').trim()) blockKey = whole;
    }
    push(n.nodeValue, p, 'text', blockKey);
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
    except Exception as e:                      # a screen that failed to open
        found.setdefault('_errors', []).append(f'{label}: {e}')
        return
    for r in rows:
        found.setdefault(r['text'], {'at': r['at'], 'kind': r['kind'],
                                     'blockKey': r.get('blockKey', ''), 'screens': set()})
        found[r['text']]['screens'].add(label)


# Each entry: a label, and the JavaScript that puts that screen on screen.
# `showPage('home')` first for anything that is a sheet over Home, because
# showPage() tears open sheets down.
SIGNED_IN_STEPS = [
    ('home',            "showPage('home')"),
    ('products',        "showPage('plans')"),
    ('my-products',     "showPage('products')"),
    ('referral',        "showPage('referral')"),
    ('team',            "showPage('team')"),
    ('account',         "showPage('account')"),
    ('deposit',         "openDepositSheet()"),
    ('withdraw',        "openWithdrawSheet()"),
    ('wallet',          "openWalletSheet()"),
    ('balance-record',  "openBalanceRecordSheet()"),
    ('messages',        "openMessagesSheet()"),
    ('message-detail',  "openMessagesSheet(); await new Promise(r=>setTimeout(r,500));"
                        "const row=document.querySelector('.msg-row'); if(row) row.click();"),
    ('login-password',  "openChangeLoginPasswordSheet()"),
    ('trade-password',  "openChangeTradePasswordSheet()"),
    ('download-app',    "openDownloadSheet()"),
    ('about',           "openAboutSheet()"),
    ('help',            "typeof openHelpSheet==='function'?openHelpSheet():openAboutSheet()"),
    ('chest',           "openChestSheet()"),
    ('checkin',         "typeof openCheckinSheet==='function'?openCheckinSheet():0"),
    ('turntable',       "openTurntableSheet()"),
    ('lang-picker',     "openLangPicker()"),
    ('buy-confirm',     "showPage('plans'); await new Promise(r=>setTimeout(r,600));"
                        "const b=[...document.querySelectorAll('button')]"
                        ".find(x=>/buy|nunua/i.test(x.textContent)); if(b) b.click();"),
    ('chest-win',       "showChestWin(5000, 133500, 'chest')"),
    ('spin-win',        "showChestWin(700, 129200, 'spin')"),
    ('pay-redirect',    "showDepRedirect(true)"),
    ('announcement',    "showPage('home'); await new Promise(r=>setTimeout(r,300));"
                        "typeof showAnnouncementNow==='function'?showAnnouncementNow():0"),
    ('notify',          "notify('Network error. Try again.')"),
    # openSimpleConfirm, not uiConfirm -- this app's confirm dialog is the
    # former; uiConfirm is Voltra's name for it and does not exist here.
    # openSimpleConfirm, not uiConfirm -- uiConfirm is Voltra's name for this
    # and does not exist here. Note the function currently has NO call sites in
    # the app (the saved-withdrawal-account deletion it was written for is gone
    # in Chipz, which binds one wallet), so what this step exercises is the
    # dialog's own chrome -- Confirm / Cancel / Working... -- not its arguments.
    # They are passed as table strings on purpose: a literal of my own invention
    # would be reported as untranslated app copy, which it is not.
    ('confirm',         "openSimpleConfirm('Confirm', 'Enter a valid amount.', ()=>{})"),
    # THE MANUAL PAYMENT FLOW -- a whole screen of copy that had never been
    # measured once. The old 'deposit/pay-b' step only clicks the PAY B radio
    # on the deposit form; it never reaches the operator selector, and never
    # the code screen behind it. Owner: "the manual payment page everything
    # should be the changed language".
    ('manual-pay/selector', "openManualPayFlow(30000)"),
    ('manual-pay/selected',  "openManualPayFlow(30000); await new Promise(r=>setTimeout(r,300));"
                             "const m=document.querySelector('.mp-method'); if(m) m.click();"),
    # The code screen is driven directly rather than through a real confirm:
    # its arguments are what the server would have sent, so the screen renders
    # exactly as a member meets it, including the reminder and the timer.
    ('manual-pay/code',      "openManualPayFlow(30000); await new Promise(r=>setTimeout(r,300));"
                             "presentManualPayCodeScreen({depositId:'d1', network:'MTN Mobile Money',"
                             "amount:30000, assignedNumber:'0770000001', holderName:'Jane Doe',"
                             "senderPhone:'0772000019', expiresAt: Date.now()+15*60000});"),
]

# Sub-tabs and states that only appear once you are already on a screen.
SIGNED_IN_SUBSTEPS = [
    ('balance-record/deposit',  "openBalanceRecordSheet(); await new Promise(r=>setTimeout(r,500));"
                                "const t=[...document.querySelectorAll('.rec-tab,.hist-tab')][1]; if(t) t.click();"),
    ('balance-record/withdraw', "openBalanceRecordSheet(); await new Promise(r=>setTimeout(r,500));"
                                "const t=[...document.querySelectorAll('.rec-tab,.hist-tab')][2]; if(t) t.click();"),
    ('balance-record/turntable', "openBalanceRecordSheet(); await new Promise(r=>setTimeout(r,500));"
                                 "const t=[...document.querySelectorAll('.rec-tab,.hist-tab')][3]; if(t) t.click();"),
    ('my-products/matured',     "showPage('products'); await new Promise(r=>setTimeout(r,600));"
                                "const t=[...document.querySelectorAll('.mp-f button,.mp-f .chip')][1]; if(t) t.click();"),
    ('my-products/all',         "showPage('products'); await new Promise(r=>setTimeout(r,600));"
                                "const t=[...document.querySelectorAll('.mp-f button,.mp-f .chip')][2]; if(t) t.click();"),
    ('team/level-2',            "showPage('team'); await new Promise(r=>setTimeout(r,700));"
                                "if(typeof switchTeamLevel==='function') switchTeamLevel(2);"),
    ('wallet/edit',             "openWalletSheet(); await new Promise(r=>setTimeout(r,500));"
                                "const b=[...document.querySelectorAll('button')]"
                                ".find(x=>/edit|hariri/i.test(x.textContent)); if(b) b.click();"),
    ('deposit/pay-b',           "openDepositSheet(); await new Promise(r=>setTimeout(r,500));"
                                "const r2=[...document.querySelectorAll('.pm-row,.pm-choice')][1]; if(r2) r2.click();"),
    ('transaction-detail',      "openBalanceRecordSheet(); await new Promise(r=>setTimeout(r,600));"
                                "const r3=document.querySelector('.rec-row'); if(r3) r3.click();"),
]


async def run_steps(page, steps, found, prefix=''):
    for label, js in steps:
        try:
            await page.evaluate(f"async ()=>{{ {js} }}")
            await page.wait_for_timeout(650)
            await collect(page, prefix + label, found)
            # Leave the screen as we found it so the next step starts clean.
            await page.evaluate("()=>{ try{ if(typeof closeSheet==='function') closeSheet();"
                                "if(typeof closeAnnounce==='function') closeAnnounce();"
                                "if(typeof closeLangPicker==='function') closeLangPicker();"
                                "document.querySelectorAll('.chest-modal-bg,.notify-bg,.confirm-bg')"
                                ".forEach(e=>e.classList.remove('show')); }catch(e){} }")
            await page.wait_for_timeout(150)
        except Exception as e:
            found.setdefault('_errors', []).append(f'{prefix}{label}: {type(e).__name__} {e}')


async def main():
    srv = serve()
    found, errors = {}, []
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
            ctx = await br.new_context(viewport={'width': 390, 'height': 844},
                                       service_workers='block')
            reg = region()

            async def wire(page, signed_in):
                await page.route('https://www.gstatic.com/firebasejs/**/firebase-app.js',
                                 lambda r: asyncio.ensure_future(r.fulfill(
                                     status=200, content_type='application/javascript', body=FB_APP)))
                await page.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js',
                                 lambda r: asyncio.ensure_future(r.fulfill(
                                     status=200, content_type='application/javascript',
                                     body=FB_AUTH if signed_in else FB_AUTH_OUT)))
                table = routes(reg)

                async def api(route):
                    # urlsplit, not a split on the host's own domain name: that
                    # form returned the WHOLE url once the backend moved, so every
                    # table lookup missed and each screen rendered empty.
                    path = urlsplit(route.request.url).path
                    body = table.get(path, {"status": "success"})
                    await route.fulfill(status=200, content_type='application/json',
                                        body=json.dumps(body))
                # Catch-all FIRST -- Playwright gives precedence to the route
                # registered LAST, so a specific route added before it never
                # fires. This has bitten this suite twice.
                await page.route(f"{API}/**",
                                 lambda r: asyncio.ensure_future(api(r)))

            # ── signed out: login + register ──
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append(f'signed-out: {e}'))
            await wire(page, False)
            await page.add_init_script(f"try{{localStorage.setItem('chipz_lang','{LANG}')}}catch(e){{}}")
            await page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='commit')
            await page.wait_for_timeout(3500)
            await collect(page, 'login', found)
            await run_steps(page, [('register', "showAuthTab('register')")], found)
            await page.close()

            # Sign Up again with the referral code OPTIONAL. Same screen, but
            # updateReferralFieldHint() writes different English into the
            # placeholder and the hint, and it does so AFTER the sweep has
            # already run over that field -- which is the exact shape of bug
            # that left the referral field in English in every language.
            global REFERRAL_REQUIRED
            REFERRAL_REQUIRED = False
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append(f'signed-out-optional: {e}'))
            await wire(page, False)
            await page.add_init_script(f"try{{localStorage.setItem('chipz_lang','{LANG}')}}catch(e){{}}")
            await page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='commit')
            await page.wait_for_timeout(3500)
            await run_steps(page, [('register-optional-code', "showAuthTab('register')")], found)
            await page.close()
            REFERRAL_REQUIRED = True

            # ── signed in: everything else ──
            page = await ctx.new_page()
            page.on('pageerror', lambda e: errors.append(f'signed-in: {e}'))
            await wire(page, True)
            await page.add_init_script(f"try{{localStorage.setItem('chipz_lang','{LANG}')}}catch(e){{}}")
            await page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='commit')
            await page.wait_for_timeout(4500)
            await page.evaluate("()=>{ try{ if(typeof closeAnnounce==='function') closeAnnounce(); }catch(e){} }")
            await run_steps(page, SIGNED_IN_STEPS, found)
            await run_steps(page, SIGNED_IN_SUBSTEPS, found)
            await br.close()
    finally:
        srv.shutdown()

    step_errors = found.pop('_errors', [])

    missing_rows, missing_cells, not_swept, data = [], [], [], []
    for text, info in sorted(found.items()):
        entry = {'text': text, 'at': info['at'], 'kind': info['kind'],
                 'blockKey': info.get('blockKey', ''),
                 'screens': sorted(info['screens'])}
        if is_data(text):
            data.append(entry)
        elif text in TRANSLATED_VALUES or any(r.match(text) for r in PATTERN_OUT):
            data.append(entry)              # the table's own output
        elif text in DELIBERATE_SAME or any(r.match(text) for r in PATTERN_SAME):
            data.append(entry)              # chosen to read the same
        elif text in TRANSLATED:
            # In the table, translated for this language, and STILL on screen
            # in English -- the sweep never reached this node.
            not_swept.append(entry)
        elif text in EN_KEYS:
            missing_cells.append(entry)
        else:
            hit = next((r for rx, r in PATTERN_EN if rx.match(text)), None)
            if hit is not None:
                # A template matches it, so the shape is known -- what is
                # missing is this language's cell for that template.
                entry['pattern'] = hit[0]
                missing_cells.append(entry)
            elif looks_english(text):
                # A piece of a sentence that inline markup broke up: report
                # the WHOLE sentence, because that is the key the engine now
                # forms and therefore the key a row has to be written against.
                # A row for ", then add the" would be nonsense in isolation.
                bk = entry.get('blockKey') or ''
                if bk and bk not in EN_KEYS and looks_english(bk):
                    entry = dict(entry, text=bk, piece=text)
                missing_rows.append(entry)
            else:
                data.append(entry)

    # One row per sentence: several failing pieces of the same sentence all
    # resolve to the same whole-sentence key.
    seen_rows = set()
    missing_rows = [e for e in missing_rows
                    if not (e['text'] in seen_rows or seen_rows.add(e['text']))]

    report = {'language': LANG, 'rows_in_table': len(ROWS),
              'translated_for_language': len(TRANSLATED),
              'screens_walked': sorted({s for i in found.values() for s in i['screens']}),
              'missing_rows': missing_rows, 'missing_cells': missing_cells,
              'not_swept': not_swept, 'ignored_as_data': data,
              'page_errors': errors, 'step_errors': step_errors}
    with open(REPORT_FOR(LANG), 'w', encoding='utf8') as f:
        json.dump(report, f, indent=1, ensure_ascii=False)

    print(f'language {LANG} — table has {len(ROWS)} rows, {len(TRANSLATED)} usable for it')
    print(f'screens walked: {len(report["screens_walked"])}')
    print(f'\nNOT IN THE TABLE AT ALL ({len(missing_rows)}) — these render English:')
    for e in missing_rows:
        print(f'  {e["text"]!r}   [{e["kind"]}] {e["screens"][0]}')
    print(f'\nIN THE TABLE, NO {LANG.upper()} CELL ({len(missing_cells)}):')
    for e in missing_cells:
        print(f'  {e["text"]!r}   {e["screens"][0]}')
    print(f'\nTRANSLATED BUT STILL ENGLISH ON SCREEN ({len(not_swept)}) — a sweep bug:')
    for e in not_swept:
        print(f'  {e["text"]!r}   [{e["kind"]}] {e["at"]}')
    if step_errors:
        print(f'\nscreens that would not open ({len(step_errors)}):')
        for e in step_errors:
            print('  ' + e)
    if errors:
        print(f'\nPAGE ERRORS ({len(errors)}):')
        for e in errors[:10]:
            print('  ' + e)
    print(f'\nfull report: {REPORT_FOR(LANG)}')
    # Non-zero when anything is left, so test-i18n-coverage.py can simply run
    # this per language rather than owning a second copy of the walk. Page
    # errors and a screen that would not open count too: a step that silently
    # failed to open measured nothing, and "no findings" from a screen that
    # never rendered is the most dangerous kind of green.
    left = len(missing_rows) + len(missing_cells) + len(not_swept)
    return 1 if (left or errors or step_errors) else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
