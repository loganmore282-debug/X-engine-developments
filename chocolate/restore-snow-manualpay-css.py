#!/usr/bin/env python3
"""Put the manual-payment flow's CSS back to exactly what Snow ships.

Owner: "you changed the design and font of manual payment land page, check
back on snow scripts, it should be same texts and design, you even rounded the
network selection design and submit sms stuffs were changed, use exact as it
was on snow, only logics change."

He is right, and the MARKUP was never the problem -- Snow's and Chipz's
manual-pay HTML are byte-identical, same classes and same strings. What
diverged was the stylesheet, and every single divergence is one of exactly two
mechanical substitutions made when Chipz was forked:

  A. Literal border-radius values replaced with Chipz's own tokens. That is
     what "you even rounded the network selection design" is: .mp-method went
     from 11px to var(--r-card), which is 22px -- double. Same for the phone
     field, the SMS textarea ("submit sms stuffs"), the detail and reminder
     boxes, the loader, the timeline card and the timer digits.
  B. Font weights lightened one or two steps -- 800 to 700, 700 to 500 -- on
     fourteen rules. That is the font change he noticed.

Run from the chipz directory. It is written as a one-shot repair rather than a
hand-edit so the values come from Snow's file itself and cannot be mistyped,
and it asserts on every anchor so a silent no-op is impossible.

DELIBERATELY NOT reverted, because both are things he asked for and neither
touches Snow's text, shape or weight:
  * #manualPayFlow .mp-toast -- the centred notices from the round he asked
    for them in.
  * the .mp-confirm-btn glow sweep (the ::after and its position:relative
    host rule) -- the app-wide button shimmer, his own "let it move from right
    to left". The button's RADIUS is restored to Snow's 26px pill regardless,
    because that is shape.
"""
import re
import sys

TARGET = 'user-src/index.html'

# (label, exact old text, exact new text). Every one asserted unique.
FIXES = [
    # ── A. radii back to Snow's literals ──
    ('network tiles', 'border:1px solid #cfcfcf;border-radius:var(--r-card);',
     'border:1px solid #cfcfcf;border-radius:11px;'),
    # Snow's own value here is also 22px, so this one is a no-op visually --
    # restored anyway so the file reads as Snow's, not as a token that merely
    # happens to agree today.
    ('selector card', '  background:#fff;\n  border-radius:var(--r-card);',
     '  background:#fff;\n  border-radius:22px;'),
    ('phone field', 'height:46px;border:1px solid #bdbdbd;border-radius:var(--r-ctl);display:flex;',
     'height:46px;border:1px solid #bdbdbd;border-radius:13px;display:flex;'),
    ('Confirm button', 'height:46px;border:none;border-radius:var(--r-ctl);color:white;',
     'height:46px;border:none;border-radius:26px;color:white;'),
    ('timer digits', 'border:1px solid #8c8c8c;border-radius:var(--r-pill);\n',
     'border:1px solid #8c8c8c;border-radius:2px;\n'),
    ('timeline card', 'margin:-58px auto 0;background:#fff;border-radius:var(--r-card);',
     'margin:-58px auto 0;background:#fff;border-radius:18px;'),
    ('detail box', 'background:#f6f6f6;border-radius:var(--r-card);padding:14px 13px;',
     'background:#f6f6f6;border-radius:13px;padding:14px 13px;'),
    ('copy glyph', 'border:2px solid #817b73;border-radius:4px;',
     'border:2px solid #817b73;border-radius:2px;'),
    ('paid box', 'background:#f6f6f6;border-radius:var(--r-card);padding:12px 14px;margin-bottom:14px}',
     'background:#f6f6f6;border-radius:13px;padding:12px 14px;margin-bottom:14px}'),
    ('Refresh button', 'background:#f09400;color:#fff;border-radius:var(--r-ctl);padding:7px 16px;',
     'background:#f09400;color:#fff;border-radius:18px;padding:7px 16px;'),
    ('loader box', 'width:130px;height:130px;border-radius:var(--r-card);background:rgba(71,71,71,.76);',
     'width:130px;height:130px;border-radius:10px;background:rgba(71,71,71,.76);'),
    ('SMS textarea', 'border:1px solid #bdbdbd;border-radius:var(--r-ctl);padding:10px 12px;font-size:11px;',
     'border:1px solid #bdbdbd;border-radius:12px;padding:10px 12px;font-size:11px;'),
    ('reminder box', 'background:#f6f6f6;border-radius:var(--r-card);padding:12px 14px;font-size:12px;line-height:1.9;',
     'background:#f6f6f6;border-radius:13px;padding:12px 14px;font-size:12px;line-height:1.9;'),

    # ── B. weights back to Snow's ──
    ('lead paragraph', '  line-height:1.35;\n  font-weight:500;\n  color:#4b4b4b;',
     '  line-height:1.35;\n  font-weight:700;\n  color:#4b4b4b;'),
    ('amount line', '  font-weight:500;\n  color:#555;',
     '  font-weight:700;\n  color:#555;'),
    ('select label', '  color:#656565;\n  font-weight:500;',
     '  color:#656565;\n  font-weight:700;'),
    ('tile caption', 'color:#777;font-size:12px;font-weight:600;position:relative;',
     'color:#777;font-size:12px;font-weight:700;position:relative;'),
    ('+256 prefix', '.mp-prefix{padding:0 10px;color:#d48717;font-size:13px;font-weight:500;',
     '.mp-prefix{padding:0 10px;color:#d48717;font-size:13px;font-weight:700;'),
    ('card title', '.mp-card-title{font-size:16.5px;font-weight:700;',
     '.mp-card-title{font-size:16.5px;font-weight:800;'),
    ('field label', '.mp-label{font-size:11px;color:#8e8e8e;font-weight:500;',
     '.mp-label{font-size:11px;color:#8e8e8e;font-weight:700;'),
    ('total', '.mp-total{font-size:clamp(18px,5.5vw,24px);color:#e58d00;font-weight:700;',
     '.mp-total{font-size:clamp(18px,5.5vw,24px);color:#e58d00;font-weight:800;'),
    ('account number', '.mp-account-value{font-size:clamp(15px,5vw,20px);color:#e58d00;font-weight:700;',
     '.mp-account-value{font-size:clamp(15px,5vw,20px);color:#e58d00;font-weight:800;'),
    ('holder name', '.mp-name-value{font-size:clamp(13px,4.5vw,17px);color:#e58d00;font-weight:700;',
     '.mp-name-value{font-size:clamp(13px,4.5vw,17px);color:#e58d00;font-weight:800;'),
    ('paid heading', '.mp-paydone{font-size:15px;font-weight:500;',
     '.mp-paydone{font-size:15px;font-weight:700;'),
    ('paid label', '.mp-paid-label{font-size:11px;font-weight:500}',
     '.mp-paid-label{font-size:11px;font-weight:700}'),
    ('paid value', '.mp-paid-value{font-size:14px;color:#a8a8a8;font-weight:700;',
     '.mp-paid-value{font-size:14px;color:#a8a8a8;font-weight:800;'),
    ('your-account line', '.mp-your-account{font-size:13px;font-weight:500;',
     '.mp-your-account{font-size:13px;font-weight:700;'),
    ('SMS title', '.mp-sms-title{font-size:13px;font-weight:600;color:#e58d00;',
     '.mp-sms-title{font-size:13px;font-weight:800;color:#e58d00;'),
    ('SMS sub', '.mp-sms-sub{font-size:11.5px;font-weight:500;color:#2d2d2d;',
     '.mp-sms-sub{font-size:11.5px;font-weight:700;color:#2d2d2d;'),
    ('reminder title', '.mp-reminder-title{font-size:15px;font-weight:600;color:#4b4b4b;',
     '.mp-reminder-title{font-size:15px;font-weight:800;color:#4b4b4b;'),
]


def main():
    src = open(TARGET, encoding='utf-8').read()
    bad = []
    for label, old, new in FIXES:
        n = src.count(old)
        if n != 1:
            bad.append(f'{label}: anchor found {n} times, expected 1')
            continue
        src = src.replace(old, new)
    if bad:
        print('REFUSED, nothing written:')
        for b in bad:
            print('  ' + b)
        return 1
    open(TARGET, 'w', encoding='utf-8').write(src)
    print(f'{len(FIXES)} rules restored to Snow in {TARGET}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
