#!/usr/bin/env python3
"""Generate Chocolate's stock app icon (user/icon-*.png and admin/icon-*.png).

Brown gradient square, a gold ring (the same ring as the login logo) and a cream serif C.
The owner replaces it from the admin panel (App icon); this is only what shows until then.
Regenerate with:  python3 make-app-icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = ['/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf']
SS = 4

def make(size):
    n = size * SS
    img = Image.new('RGB', (n, n))
    px = img.load()
    a, b = (94, 58, 27), (67, 40, 18)
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * n)
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    d = ImageDraw.Draw(img)
    c = n / 2
    r = n * 0.36
    d.ellipse([c - r, c - r, c + r, c + r], outline=(216, 164, 46), width=round(n * 0.045))
    font = next((ImageFont.truetype(f, round(n * 0.40)) for f in FONTS if os.path.exists(f)), None)
    w = d.textbbox((0, 0), 'C', font=font)
    d.text((c - (w[0] + w[2]) / 2, c - (w[1] + w[3]) / 2), 'C', font=font, fill=(249, 245, 236))
    return img.resize((size, size), Image.LANCZOS)

for folder in ('user', 'admin'):
    for s in (192, 512):
        make(s).save(os.path.join(HERE, folder, 'icon-%d.png' % s), optimize=True)
print('icons written')
