#!/usr/bin/env python3
"""Merge the admin-rows-*.py batches into ADMIN_LANG_ROWS / ADMIN_LANG_PATTERNS
in admin-src/index.html.

The rows are kept as Python data in admin-rows-*.py so they can be read and
corrected as a TABLE rather than as JavaScript string literals -- the member
app's own table has the same arrangement (apply-translations.py). This is the
one thing that writes them into the source.

Rules it enforces, each of them a real hazard rather than tidiness:
  * exactly six cells per row -- a short row silently shifts every language
    after the gap by one column, which reads as a working translation in the
    wrong language;
  * no cell may merely repeat its English. That is byte-identical to a blank
    at runtime, and a filled cell is a claim somebody chose the word. Use '='
    to say "the right word here IS the English word" on purpose;
  * no blank cells, in any column. "Uniformly, not missing English and any
    language" was the owner's own phrasing;
  * nothing longer than the engine's own 160-character cap, since a row over
    it can never apply;
  * no duplicate English keys ACROSS the batches, and none that the member
    app's table already carries -- a duplicate is a second answer to the same
    question, and which one wins is then a matter of table order.

Run:  python3 build-admin-rows.py
"""
import importlib.util, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ADMIN = os.path.join(HERE, 'admin-src', 'index.html')
APP = os.path.join(HERE, 'user-src', 'original_module.js')
CAP = 160          # i18nTextNode()'s own limit; read back and checked below


def load(name):
    spec = importlib.util.spec_from_file_location(name[:-3].replace('-', '_'),
                                                  os.path.join(HERE, name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, 'ROWS', []), getattr(mod, 'PATTERNS', [])


def app_keys():
    js = open(APP, encoding='utf8').read()
    m = re.search(r'var LANG_ROWS = \[([\s\S]*?)\n\];', js)
    out = subprocess.run(['node', '-e', 'console.log(JSON.stringify([' + m.group(1) + ']))'],
                         capture_output=True, text=True)
    if out.returncode:
        raise SystemExit('the app table did not parse:\n' + out.stderr)
    import json
    return {r[0].strip() for r in json.loads(out.stdout) if r and r[0]}


def check(rows, what, seen, shared):
    for r in rows:
        if len(r) != 6:
            raise SystemExit(f'ABORT: {what} row has {len(r)} cells, not 6: {r[0]!r}')
        en = r[0].strip()
        if not en:
            raise SystemExit(f'ABORT: {what} row with no English: {r!r}')
        if en in seen:
            raise SystemExit(f'ABORT: {what} row is a duplicate: {en!r}')
        if en in shared:
            raise SystemExit(f'ABORT: {what} row {en!r} is already in the app\'s own table -- '
                             'the panel inherits that one, so this is a second answer to the '
                             'same question.')
        seen.add(en)
        for i, cell in enumerate(r):
            if not isinstance(cell, str) or not cell.strip():
                raise SystemExit(f'ABORT: {what} {en!r} has a blank cell in column {i}')
            # The cap applies to the ENGLISH only. i18nTextNode() measures the
            # text node it found -- the key -- and a translation is free to run
            # longer, which most of them do.
            if i == 0 and len(cell) > CAP:
                raise SystemExit(f'ABORT: {what} {en!r} is {len(cell)} chars, over the '
                                 f'engine\'s {CAP}-character cap on the text it matches -- '
                                 'no row for it could ever apply')
            if i and cell.strip() == en and cell != '=':
                raise SystemExit(f'ABORT: {what} {en!r} column {i} just repeats the English. '
                                 "Leave it as '=' if that is deliberate.")


def js_rows(rows, indent='  '):
    out = []
    for r in rows:
        cells = ', '.join(
            "'" + c.replace('\\', '\\\\').replace("'", "\\'") + "'" for c in r)
        out.append(f'{indent}[{cells}],')
    return '\n'.join(out)


def splice(src, name, body):
    m = re.search(r'(const ' + name + r' = \[)[\s\S]*?(\n\];)', src)
    if not m:
        raise SystemExit(f'ABORT: {name} not found in admin-src/index.html')
    return src[:m.start()] + m.group(1) + '\n' + body + m.group(2) + src[m.end():]


def main():
    shared = app_keys()
    rows, pats, seen, pseen = [], [], set(), set()
    for name in sorted(f for f in os.listdir(HERE)
                       if re.fullmatch(r'admin-rows-\d+\.py', f)):
        r, p = load(name)
        check(r, name, seen, shared)
        check(p, name + ' pattern', pseen, set())
        rows += r
        pats += p

    # Every placeholder the English template uses must survive into every
    # translation. A template that drops its {0} drops a FIGURE off an admin
    # screen, and that is invisible from a screenshot -- it renders as the
    # translation, just missing a number.
    for p in pats:
        want = set(re.findall(r'\{(\d+)\}', p[0]))
        for i, cell in enumerate(p[1:], 1):
            if cell == '=':          # deliberately the English wording
                continue
            got = set(re.findall(r'\{(\d+)\}', cell))
            if got != want:
                raise SystemExit(f'ABORT: pattern {p[0]!r} column {i} has placeholders '
                                 f'{sorted(got)}, the English has {sorted(want)}')

    src = open(ADMIN, encoding='utf8').read()
    # The cap is read back out of the engine rather than trusted, so this file
    # cannot go on enforcing 160 after the engine's own limit has moved.
    app = open(APP, encoding='utf8').read()
    m = re.search(r'key\.length > (\d+)', app)
    if not m or int(m.group(1)) != CAP:
        raise SystemExit(f'ABORT: the engine\'s text-node cap is {m and m.group(1)}, '
                         f'this script enforces {CAP}. Update both together.')

    src = splice(src, 'ADMIN_LANG_ROWS', js_rows(rows))
    src = splice(src, 'ADMIN_LANG_PATTERNS', js_rows(pats))
    open(ADMIN, 'w', encoding='utf8').write(src)
    print(f'ADMIN_LANG_ROWS: {len(rows)} rows, ADMIN_LANG_PATTERNS: {len(pats)} templates '
          f'-> admin-src/index.html')
    return 0


if __name__ == '__main__':
    sys.exit(main())
