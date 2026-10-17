#!/usr/bin/env python3
"""
Every English sentence a member can read, pulled out of the real sources.

The language table (LANG_ROWS in user-src/original_module.js) is keyed on the
English string itself, so this is the exact list that needs translating -- and
anything NOT in the table falls back to English, which is what produced the
half-English screens.

Where the strings live, and why it takes three passes:
  1. static markup in user-src/index.html -- the sign-in screen, the bottom
     nav, the loading screen;
  2. text inside the template literals in original_module.js, which is how
     nearly every screen in this app is drawn;
  3. quoted arguments to the handful of functions that put words on screen
     without going through HTML (notify, toast, openSheet, setBtnLoading...).

What is deliberately EXCLUDED, because translating it would break something:
  * anything with a ${...} placeholder in it -- the table matches whole
    strings, and a sentence with a figure spliced into it is a different
    string every time it is rendered;
  * money, dates, class names, ids, URLs, storage keys, event names;
  * single words that are also identifiers (camelCase, snake_case).

Run:  python3 extract-ui-strings.py            # print the list
      python3 extract-ui-strings.py --prompt   # write translate-request.md
"""
import os, re, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')
HTML = os.path.join(HERE, 'user-src', 'index.html')
OUT_MD = os.path.join(HERE, 'translate-request.md')
OUT_JSON = os.path.join(HERE, 'translate-strings.json')

# Functions whose first quoted argument is shown to a member.
SPEAKERS = ['notify', 'toast', 'manualPayToast', 'openSheet', 'uiConfirm',
            'openPage', 'showChestWin', 'flashCopied']

SKIP_EXACT = {'', 'OK', 'ok', 'true', 'false', 'null', 'undefined'}
# Names that must never be translated, so they must never reach the list:
# the brand, the two mobile-money operators, and the languages' own names
# (those are printed in their own language by design and carry data-no-i18n).
BRAND_SKIP = {'chipz', 'mtn', 'airtel', 'english', 'kiswahili', 'luganda',
              'swahili', 'french', 'français', 'kinyarwanda', 'ikinyarwanda',
              'runyankole', 'runyankore', 'telegram', 'whatsapp'}


def strip_block_comments(s):
    # Line comments first: a `/*` sitting inside a `//` line otherwise blanks
    # everything to the next `*/`, hundreds of lines away. The project's own
    # tests record this trap three times over.
    s = re.sub(r'(^|[^:])//[^\n]*', r'\1', s)
    s = re.sub(r'/\*[\s\S]*?\*/', '', s)
    return s


def looks_like_ui(text):
    t = text.strip()
    if t in SKIP_EXACT or len(t) < 2 or len(t) > 160:
        return False
    if not re.search(r'[A-Za-z]{2}', t):
        return False
    # placeholders, markup, code
    if '${' in t or '<' in t or '>' in t or '{' in t or '}' in t:
        return False
    # selectors, paths, urls, keys, events
    if re.match(r'^[.#/]', t) or '://' in t or t.startswith('data:'):
        return False
    # Fragments of JavaScript that the tag-text regex picked up out of a
    # concatenated string -- the ICONS object is built as
    # '<svg ...>', name: '<svg ...>' and every gap between two SVGs reads as
    # tag text. The tell is a quote sitting next to a comma or a colon.
    if re.search(r"""['"]\s*[,:]""", t) or re.search(r"""[,:]\s*['"]""", t):
        return False
    if ' + ' in t or 'esc(' in t or '()' in t:
        return False
    # More code that reads as prose: an expression fragment, or a statement
    # that survived because its string delimiters fell outside the match.
    if re.search(r'&&|\|\||;|=>|\bif \(|\breturn\b|\bconst\b|\blet\b|\bvar\b', t):
        return False
    if t.lstrip()[:1] in '=+*|&':
        return False
    # An unresolved entity means this was never plain text.
    if '&' in t and re.search(r'&[a-z]+;?', t):
        return False
    if t[0] in '\'"' and t[-1] in '\'"':
        return False
    if t.lower().strip('.:!?') in BRAND_SKIP:
        return False
    if re.match(r'^[a-z0-9_-]+$', t) and ' ' not in t:
        return False           # class name / key / slug
    if re.match(r'^[a-z]+[A-Z]', t) and ' ' not in t:
        return False           # camelCase identifier
    if re.fullmatch(r'[\d\s.,:%+-]+', t):
        return False           # a number or a figure
    # must contain a real word, not just punctuation and one letter
    if not re.search(r'[A-Za-z]{3}', t) and t not in ('No', 'Go', 'My'):
        return False
    return True


def from_html(path):
    src = open(path, encoding='utf-8').read()
    src = re.sub(r'<!--[\s\S]*?-->', '', src)
    src = re.sub(r'<style[\s\S]*?</style>', '', src)
    src = re.sub(r'<script[\s\S]*?</script>', '', src)
    out = []
    for m in re.finditer(r'>([^<>{}]+)<', src):
        out.append(m.group(1))
    for m in re.finditer(r'(?:placeholder|aria-label|title)="([^"]+)"', src):
        out.append(m.group(1))
    return out


def from_js(path):
    src = strip_block_comments(open(path, encoding='utf-8').read())
    out = []
    # 1. text between tags inside template literals (how screens are drawn)
    for m in re.finditer(r'>([^<>`$]+)<', src):
        out.append(m.group(1))
    # 2. attributes written inside those literals
    for m in re.finditer(r'(?:placeholder|aria-label|title)="([^"$]+)"', src):
        out.append(m.group(1))
    # 3. what the speaking functions are handed
    for fn in SPEAKERS:
        for m in re.finditer(fn + r"\(\s*'((?:[^'\\]|\\.)*)'", src):
            out.append(m.group(1).replace("\\'", "'"))
        for m in re.finditer(fn + r'\(\s*"((?:[^"\\]|\\.)*)"', src):
            out.append(m.group(1).replace('\\"', '"'))
    # 4. the busy label every loading button carries
    for m in re.finditer(r"setBtnLoading\([^)]*?,\s*'([^']+)'\s*\)", src):
        out.append(m.group(1))
    return out


def clean(raw):
    seen, out = set(), []
    for t in raw:
        t = re.sub(r'\s+', ' ', t).strip()
        # HTML entities the templates use
        t = (t.replace('&amp;', '&').replace('&mdash;', '—')
              .replace('&hellip;', '…').replace('&nbsp;', ' ')
              .replace('&rarr;', '→').replace('&lt;', '<').replace('&gt;', '>'))
        if not looks_like_ui(t) or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return sorted(out, key=lambda s: (len(s.split()), s.lower()))


PROMPT_HEAD = """# Translation request — Chipz mobile-money app (Uganda / East Africa)

You are translating the interface of a **mobile-money investment app**. Members
deposit and withdraw real money on a phone, buy investment products, and earn
referral commission. Most of them are on a small Android screen, and many are
not confident readers, so the wording has to be **short, plain and unambiguous**.

Translate every English string below into these **five** languages:

| column | language | notes |
|---|---|---|
| `lg` | **Luganda** | central Uganda |
| `sw` | **Swahili** | Kenya / Tanzania / Uganda — standard Kiswahili, not sheng |
| `fr` | **French** | for francophone markets (Rwanda, DRC) |
| `rw` | **Kinyarwanda** | Rwanda |
| `nyn` | **Runyankole-Rukiga** | western Uganda |

## Rules — please follow these exactly

1. **Keep it short.** These are buttons, labels and headings on a phone. If the
   natural translation is much longer than the English, shorten it. A button
   label should stay a button label.
2. **Match the case.** `LOGIN` is a heading in capitals — translate it in
   capitals. `Log In` is a button — translate it in title case.
3. **Never translate:** currency codes (UGX, KES), amounts, digits, dialling
   codes, the app's own name, or the words **MTN** and **Airtel**.
4. **Be consistent.** The same English word must get the same translation
   everywhere it appears — "Withdraw" as a button and "Withdraw" as a heading
   must match.
5. **Money words matter most.** Deposit, Withdraw, Balance, Amount, Fee,
   Pending, Confirm — a member acts on these. If a language has no everyday
   word for one, use the phrase people actually say when sending mobile money,
   not a literal dictionary translation.
6. **If you are not sure of a word, leave that cell EMPTY.** An empty cell
   falls back to English, which is safe. A confident wrong word on a withdrawal
   screen is not. Do not guess, and do not fill a cell with the English.
7. Keep `…` (the single ellipsis character) where the English has it, and keep
   any trailing punctuation.

## Output format — important

Return **only** a JSON array, no commentary before or after. One object per
string, using the English exactly as given as the `en` value:

```json
[
  {"en": "Log In", "lg": "Yingira", "sw": "Ingia", "fr": "Connexion", "rw": "Injira", "nyn": "Taaha"},
  {"en": "Withdraw", "lg": "", "sw": "Toa Pesa", "fr": "Retrait", "rw": "Kubikuza", "nyn": ""}
]
```

Every string I give you must appear exactly once in your answer, with the `en`
value copied character for character. If you cannot do them all in one reply,
do them in order and tell me the last one you reached, and I will ask for the
rest.

---

## The strings

"""


def main():
    raw = from_html(HTML) + from_js(JS)
    strings = clean(raw)
    if '--prompt' not in sys.argv:
        for s in strings:
            print(s)
        print(f'\n{len(strings)} strings', file=sys.stderr)
        return
    json.dump(strings, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # Chunked, because one reply cannot hold several hundred strings x five
    # languages. Each chunk is a self-contained request carrying the rules
    # again, so they can be pasted one at a time in any order.
    CHUNK = 60
    parts = [strings[i:i + CHUNK] for i in range(0, len(strings), CHUNK)]
    with open(OUT_MD, 'w', encoding='utf-8') as f:
        f.write(f'*{len(strings)} strings, in {len(parts)} batches. '
                f'Paste one batch at a time — each is a complete request on its own.*\n\n')
        for n, part in enumerate(parts, 1):
            f.write(f'\n\n{"=" * 70}\n# BATCH {n} of {len(parts)}\n{"=" * 70}\n\n')
            f.write(PROMPT_HEAD)
            for s in part:
                f.write(json.dumps(s, ensure_ascii=False) + '\n')
    print(f'{len(strings)} strings -> {OUT_MD} ({len(parts)} batches)')
    print(f'and the raw list -> {OUT_JSON}')


main()
