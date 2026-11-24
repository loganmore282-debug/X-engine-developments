# Traces the owner's logo (web/public/logo-full.png) into separate vector parts so the launch animation can BUILD it:
# notebook (body, spiral rings, page corner), monogram (S, N, page lines), graduation cap (board, stripe, tassel), brand name (10 letters).
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import potrace

SRC = '/home/user/X-engine-developments/shule-notes/web/public/logo-full.png'
im = Image.open(SRC).convert('RGBA'); a = np.array(im).astype(int)
R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
op = A > 128
white = op & (R > 170) & (G > 170) & (B > 170)
teal = op & (G > 150) & (B > 120) & (R < 140) & ~white
dark = op & ~white & ~teal

def comps(mask, minsize=200):
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    objs = ndi.find_objects(lab)
    out = []
    for i in range(n):
        if sizes[i] >= minsize:
            sl = objs[i]
            out.append(dict(id=i + 1, size=int(sizes[i]), x0=sl[1].start, y0=sl[0].start, x1=sl[1].stop, y1=sl[0].stop, mask=(lab == i + 1)))
    return out
D, W, T = comps(dark), comps(white), comps(teal)
by = lambda lst, x0, y0: next(c for c in lst if abs(c['x0'] - x0) < 8 and abs(c['y0'] - y0) < 8)

cap_board = by(D, 315, 19)['mask']
body_src = by(D, 277, 155)['mask']
rings = [by(D, 242, 298)['mask'], by(D, 242, 392)['mask'], by(D, 242, 486)['mask']]
curl_green = by(D, 562, 525)['mask']
S = by(W, 338, 225)['mask']
line1 = by(W, 540, 300)['mask']; line2 = by(W, 540, 338)['mask']
curl_white = by(W, 559, 527)['mask']
N = by(T, 351, 376)['mask']
tassel_all = by(T, 560, 88)['mask']
yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
tassel = tassel_all & (xx > 690) & (yy > 135)
stripe = tassel_all & ~tassel
letters_dark = sorted([c for c in D if c['y0'] > 700], key=lambda c: c['x0'])   # S h u l e
letters_teal = sorted([c for c in T if c['y0'] > 700], key=lambda c: c['x0'])   # N o t e s
letters = [c['mask'] for c in letters_dark] + [c['mask'] for c in letters_teal]
letter_cols = ['dark'] * len(letters_dark) + ['teal'] * len(letters_teal)

# The notebook body as ONE solid shape (the monogram and lines sit on top of it, so they leave no holes while it builds)
body = ndi.binary_fill_holes(ndi.binary_closing(body_src | S | line1 | line2 | N | curl_green | curl_white, iterations=3))
board = ndi.binary_fill_holes(ndi.binary_closing(cap_board | stripe, iterations=2))

def med(mask):
    px = a[mask][:, :3]
    return '#%02x%02x%02x' % tuple(int(v) for v in np.median(px, axis=0))

def trace(mask, scale=3):
    big = Image.fromarray((mask * 255).astype('uint8')).resize((mask.shape[1] * scale, mask.shape[0] * scale), Image.LANCZOS).filter(__import__('PIL.ImageFilter', fromlist=['x']).GaussianBlur(scale * 0.6))
    arr = np.array(big) > 127
    bm = potrace.Bitmap(~arr)
    plist = bm.trace(turdsize=12 * scale, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.1, opticurve=True, opttolerance=0.35)
    f = lambda p: f"{p.x / scale:.1f} {p.y / scale:.1f}"
    d = []
    for curve in plist:
        d.append('M' + f(curve.start_point))
        for s in curve.segments:
            if s.is_corner: d.append('L' + f(s.c) + 'L' + f(s.end_point))
            else: d.append('C' + f(s.c1) + ' ' + f(s.c2) + ' ' + f(s.end_point))
        d.append('Z')
    ys, xs = np.where(mask)
    return dict(d=''.join(d), bbox=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])

def gradient(mask, axis=(1, 0), stops=4):
    ys, xs = np.where(mask)
    proj = xs * axis[0] + ys * axis[1]
    lo, hi = proj.min(), proj.max()
    out = []
    for i in range(stops):
        sel = (proj >= lo + (hi - lo) * i / stops) & (proj <= lo + (hi - lo) * (i + 1) / stops)
        px = a[ys[sel], xs[sel]][:, :3]
        out.append(['%.2f' % ((i + 0.5) / stops), '#%02x%02x%02x' % tuple(int(v) for v in np.median(px, axis=0))])
    return out

parts = {
    'body': dict(**trace(body), fill=med(body_src), grad=gradient(body_src, (0, 1), 4)),
    'ring0': dict(**trace(rings[0]), fill=med(rings[0])), 'ring1': dict(**trace(rings[1]), fill=med(rings[1])), 'ring2': dict(**trace(rings[2]), fill=med(rings[2])),
    'curlGreen': dict(**trace(curl_green), fill=med(curl_green)), 'curlWhite': dict(**trace(curl_white), fill=med(curl_white)),
    'S': dict(**trace(S), fill=med(S)), 'line1': dict(**trace(line1), fill=med(line1)), 'line2': dict(**trace(line2), fill=med(line2)),
    'N': dict(**trace(N), fill=med(N), grad=gradient(N, (1, -1), 4)),
    'board': dict(**trace(board), fill=med(cap_board)), 'stripe': dict(**trace(stripe), fill=med(stripe)), 'tassel': dict(**trace(tassel), fill=med(tassel)),
}
for i, m in enumerate(letters):
    parts[f'L{i}'] = dict(**trace(m), fill=med(m), tone=letter_cols[i])
json.dump(dict(size=[a.shape[1], a.shape[0]], parts=parts), open('/tmp/logo/parts.json', 'w'))
print({k: (v['bbox'], v['fill'], len(v['d'])) for k, v in parts.items()})
