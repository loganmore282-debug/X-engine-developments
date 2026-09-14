#!/usr/bin/env python3
"""Generate the stock Chipz app icon.

Both icon-192.png and icon-512.png were still SNOW'S SNOWFLAKE -- and they are
not decoration: server.js serves chipz/user/icon-*.png as the stock app icon
for BOTH manifests (bundledBrandAsset -> /public/app-icon-192.png), so until
the owner uploads one of his own, anyone installing either the member app or
the admin panel got a snowflake on their home screen.

This draws the app's OWN mark instead, the same one chipzMarkHtml() falls back
to in the member app: the brand gradient, the angular triangle motif from the
auth hero, and the skewed CHIPZ wordmark with its last letter in the dark ink.

Regenerate with:  python3 make-app-icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SERIF = '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'

WORD = 'CHIPZ'
GRAD_A = (226, 27, 42)     # --snow-wine   #e21b2a
GRAD_B = (255, 138, 31)    # --chipz-orange #ff8a1f
INK = (20, 16, 13)         # #14100d, the wordmark's dark last letter
SHEAR = 0.12               # ~ transform: skewX(-7deg)
SS = 4                     # supersample, then downscale for clean edges


def gradient(size):
    """135deg linear gradient: top-left GRAD_A to bottom-right GRAD_B."""
    im = Image.new('RGB', (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(GRAD_A, GRAD_B))
    return im


def skew(layer, shear):
    """Shear a layer horizontally about its own centre (PIL has no skew)."""
    w, h = layer.size
    return layer.transform(
        (w, h), Image.AFFINE, (1, shear, -shear * h / 2, 0, 1, 0),
        resample=Image.BICUBIC)


def wordmark(size):
    """CHIPZ, skewed, last letter in ink -- as a transparent overlay."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # Scale the type so the word spans a fixed share of the icon at EVERY
    # size, rather than tuning a number per file. Measured once at a probe
    # size and scaled -- glyph advance is linear in point size, so one
    # measurement is exact. (A grow-only search was wrong here: the first
    # guess already overshot, so it broke immediately and rendered a wordmark
    # wider than the tile, with the C sheared off the left edge.)
    #
    # The share allows for the shear, which pushes the top of the glyphs
    # SHEAR * cap-height further right than the advance width says.
    probe_fs = max(8, size // 4)
    probe_w = d.textlength(WORD, font=ImageFont.truetype(SERIF, probe_fs))
    fs = max(8, int(probe_fs * (size * 0.70) / probe_w))
    font = ImageFont.truetype(SERIF, fs)
    total = d.textlength(WORD, font=font)
    x = (size - total) / 2
    box = d.textbbox((0, 0), WORD, font=font)
    y = (size - (box[3] - box[1])) / 2 - box[1]
    # Letter by letter, because only the LAST one is ink -- the member app
    # paints the wordmark the same way (__paintBrandMarks wraps the final
    # character in a <b>).
    for i, ch in enumerate(WORD):
        d.text((x, y), ch, font=font,
               fill=INK + (255,) if i == len(WORD) - 1 else (255, 255, 255, 255))
        x += d.textlength(ch, font=font)
    return skew(layer, SHEAR)


def triangles(size):
    """The auth hero's two angular corner motifs, at icon scale."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = size / 100.0
    d.polygon([(-14 * u, -30 * u), (34 * u, -6 * u), (-14 * u, 26 * u)],
              fill=(0, 0, 0, 46))
    d.polygon([(114 * u, 74 * u), (66 * u, 104 * u), (114 * u, 128 * u)],
              fill=(255, 255, 255, 40))
    return layer


def build(size):
    big = size * SS
    im = gradient(big).convert('RGBA')
    im.alpha_composite(triangles(big))
    im.alpha_composite(wordmark(big))
    return im.resize((size, size), Image.LANCZOS).convert('RGB')


if __name__ == '__main__':
    for size in (192, 512):
        icon = build(size)
        for d in ('user', 'admin'):
            p = os.path.join(HERE, d, f'icon-{size}.png')
            icon.save(p, 'PNG', optimize=True)
            print(f'{p}  {size}x{size}  {os.path.getsize(p)} bytes')
