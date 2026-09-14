#!/usr/bin/env python3
"""
Merge translated batches back into LANG_ROWS.

Usage:  python3 apply-translations.py batch1.json batch2.json ...
        python3 apply-translations.py --check batch1.json   (report, write nothing)

Input is whatever the translator sent back: a JSON array of
{"en": ..., "lg": ..., "sw": ..., "fr": ..., "rw": ..., "nyn": ...}.
Markdown code fences and any prose around the array are ignored, because a
chat answer usually arrives wrapped in them.

The merge rules, and each one exists to stop a bad batch doing damage:

  * an EMPTY cell in the answer never overwrites a filled cell already in the
    table. "I did not translate this" and "this should become blank" look
    identical in the input, and the safe reading is the first;
  * a cell equal to its own English is treated as empty. It is what a
    translator returns when there is nothing to change, and the table's own
    test refuses such a row as noise pretending to be a translation;
  * an `en` value that is not already a string the app uses is REPORTED and
    skipped, not added. A near-miss ("Log in" for "Log In") would otherwise
    sit in the table matching nothing, looking translated and doing nothing.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')
KNOWN = os.path.join(HERE, 'translate-strings.json')
CODES = ['lg', 'sw', 'fr', 'rw', 'nyn']


def js_str(s):
    """A single-quoted JS literal, ASCII-only -- the file already writes its
    accented characters as \\uXXXX, and keeping to that avoids any question
    about how the build pipeline reads the file."""
    out = ["'"]
    for ch in s:
        if ch == "'":
            out.append("\\'")
        elif ch == '\\':
            out.append('\\\\')
        elif ch == '\n':
            out.append('\\n')
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append('\\u%04x' % ord(ch))
    out.append("'")
    return ''.join(out)


def read_rows(src):
    """The current table, as {english: {code: text}} plus the original order."""
    m = re.search(r'var LANG_ROWS = \[', src)
    if not m:
        raise SystemExit('LANG_ROWS not found in ' + JS)
    start = m.end() - 1
    depth = 0
    for k in range(start, len(src)):
        if src[k] == '[':
            depth += 1
        elif src[k] == ']':
            depth -= 1
            if depth == 0:
                end = k + 1
                break
    else:
        raise SystemExit('LANG_ROWS is not closed')
    literal = src[start:end]
    # Evaluated by node, not parsed here. A hand-rolled JS-literal reader has
    # to get escapes, \uXXXX, apostrophes inside strings and comments all
    # exactly right, and the first attempt got \u wrong in a way that only
    # showed up as a JSON syntax error thirty rows later. node already has a
    # correct one.
    rows = json.loads(subprocess.run(
        ['node', '-e', 'process.stdout.write(JSON.stringify(' + literal + '))'],
        capture_output=True, text=True, check=True).stdout)
    table, order = {}, []
    for row in rows:
        en = row[0]
        table[en] = {CODES[i]: (row[i + 1] if i + 1 < len(row) else '') for i in range(len(CODES))}
        order.append(en)
    return table, order, start, end


def load_batch(path):
    raw = open(path, encoding='utf-8').read()
    raw = re.sub(r'```[a-zA-Z]*', '', raw).replace('```', '')
    first, last = raw.find('['), raw.rfind(']')
    if first == -1 or last == -1:
        raise SystemExit(f'{path}: no JSON array found in that file')
    return json.loads(raw[first:last + 1])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    if not args:
        raise SystemExit(__doc__)
    src = open(JS, encoding='utf-8').read()
    table, order, start, end = read_rows(src)
    known = set(json.load(open(KNOWN, encoding='utf-8'))) if os.path.exists(KNOWN) else set()
    known |= set(order)

    added, filled, skipped, ignored = 0, 0, [], 0
    for path in args:
        for item in load_batch(path):
            en = item.get('en')
            if not isinstance(en, str) or not en:
                continue
            if en not in known:
                skipped.append(en)
                continue
            if en not in table:
                table[en] = {c: '' for c in CODES}
                order.append(en)
                added += 1
            for c in CODES:
                v = str(item.get(c) or '').strip()
                if not v or v == en:
                    ignored += 1
                    continue
                if table[en][c] and table[en][c] == v:
                    continue
                table[en][c] = v
                filled += 1

    total_cells = len(order) * len(CODES)
    have = sum(1 for en in order for c in CODES if table[en][c])
    print(f'{len(order)} strings in the table, {added} of them new')
    print(f'{filled} cells written this run, {ignored} left empty by the answer')
    print(f'coverage: {have}/{total_cells} cells ({have * 100 // max(1, total_cells)}%)')
    for c in CODES:
        n = sum(1 for en in order if table[en][c])
        print(f'  {c:>4}: {n}/{len(order)}')
    if skipped:
        print(f'\n{len(skipped)} entries were NOT in the app and were skipped '
              f'(a changed English string translates nothing):')
        for s in skipped[:12]:
            print('  ' + json.dumps(s, ensure_ascii=False))
        if len(skipped) > 12:
            print(f'  ... and {len(skipped) - 12} more')
    if check:
        print('\n--check: nothing written')
        return

    body = ['var LANG_ROWS = [']
    body.append('  // [english, lg, sw, fr, rw, nyn] -- an EMPTY cell means'
                ' "not translated yet" and')
    body.append('  // falls back to English at runtime. Regenerated by'
                ' apply-translations.py;')
    body.append('  // hand edits are kept, since a blank in an answer never'
                ' overwrites a filled cell.')
    for en in order:
        cells = [js_str(en)] + [js_str(table[en][c]) for c in CODES]
        body.append('  [' + ', '.join(cells) + '],')
    body.append(']')
    open(JS, 'w', encoding='utf-8').write(src[:start - len('var LANG_ROWS = ')] +
                                          '\n'.join(body) + src[end:])
    print(f'\nwritten to {JS} -- now run: node build-core.js && node test-languages.js')


main()
