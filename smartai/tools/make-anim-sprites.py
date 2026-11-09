#!/usr/bin/env python3
"""Cuts the owner's two animations (two GIFs, 800 x 600, 100 frames each) into the sprite sheets the app plays.

  python3 tools/make-anim-sprites.py <start-up-animation.gif> <payment-animation.gif> [out-dir]

Needs: Pillow, numpy, opencv-python (only for this one-off job, never at run time).

Writes, into out-dir (default user/anim):
  loader-sphere.webp   the glass sphere of the START-UP loader: 100 frames of 192 x 192 px in a 10 x 10 sheet (frame n is row n // 10, column n % 10).
                       Only the inside of the sphere (radius 95.5 px around its centre) is kept; the dither noise of the GIF is removed.
  pay-orb.webp         the glowing orb of the PAYMENT page: 100 frames of 224 x 224 px (the 312 x 312 px around the orb, scaled), same 10 x 10 layout.
  loader-poster.txt    a tiny first frame of the sphere as a data: address (shown for the instant before the sheet has arrived).
  orb-free.webp        the same orb as pay-orb.webp but on its own, with NO background: 100 frames of 192 x 192 px with transparency (the glass ball only, cut at its
                       edge; the dark field and glow around it are gone), same 10 x 10 layout. This is the app's page loader (ring loaders everywhere are replaced by it).
  orb-poster.txt       a tiny first frame of that free orb (64 px, transparent) as a data: address, shown until orb-free.webp has arrived.
  plate.json           the static background of the start-up animation as radial colour stops (radius in GIF pixels -> r, g, b),
                       which the loader paints with a CSS radial gradient. Printed as a JavaScript array as well, ready to paste.

Everything else of the start-up animation (the turning teal wedge, the ring of 36 dots, the dust, the burst of sparkles) is drawn by code in
user-src/index.html from numbers measured on the GIF; see smartai/CLAUDE.md "Start-up animation".
"""
import base64, io, json, os, sys
import cv2
import numpy as np
from PIL import Image

LOADER_CX, LOADER_CY = 399.5, 299.5       # centre of the sphere, its dark ring and the wedge in the 800 x 600 GIF (pixel-index coordinates = the picture's own centre)
# (the ring of 36 dots is centred 1.37 px right and 1.11 px lower, at (400.87, 300.61): the loader draws it with that offset)
LOADER_FRAME = 192                         # sprite frame size (px); the sphere (radius 92.5 px) sits exactly in its middle
LOADER_MASK_R = 95.5                       # real GIF pixels are kept out to here; the app fades them out between 94.2 and 95.4
ORB_CX, ORB_CY = 399.5, 299.5
ORB_SRC, ORB_OUT = 312, 224
# The free orb (no background): the glass ball is a disc of radius ORB_R around the same centre (measured: the shell's edge is its 50 % point, a step from
# colour 16,26,105 to 7,15,77 about 1.5 px wide); everything outside it is the GIF's own dark field and glow and is thrown away.
FREE_R, FREE_SRC, FREE_OUT, FREE_POSTER = 140.4, 288, 192, 64


def frames_of(path):
    im = Image.open(path)
    out = []
    for i in range(im.n_frames):
        im.seek(i)
        out.append(np.asarray(im.convert('RGB')).copy())
    return out


def denoise(rgb, h):
    bgr = rgb[..., ::-1].copy()
    d = cv2.fastNlMeansDenoisingColored(bgr, None, h, h, 5, 15)
    return d[..., ::-1]


def sheet(frames, size, cols=10):
    rows = (len(frames) + cols - 1) // cols
    sh = np.zeros((rows * size, cols * size, 3), np.uint8)
    for k, f in enumerate(frames):
        sh[(k // cols) * size:(k // cols + 1) * size, (k % cols) * size:(k % cols + 1) * size] = f
    return Image.fromarray(sh)


def free_orb(frames):
    """Cuts the glass ball out of the payment GIF with a transparent surround. Returns (sheet RGBA image, poster RGBA image)."""
    x0, y0 = int(round(ORB_CX + 0.5 - FREE_SRC / 2)), int(round(ORB_CY + 0.5 - FREE_SRC / 2))
    yy, xx = np.mgrid[0:FREE_SRC, 0:FREE_SRC].astype(np.float32)
    dx, dy = xx - (ORB_CX - x0), yy - (ORB_CY - y0)
    rr = np.hypot(dx, dy)
    # Past the rim the colour is copied from just inside it along the same radius, so the soft edge never carries the dark field's colour (no dark fringe).
    r_in = FREE_R - 3.9
    k = np.where(rr > r_in, r_in / np.maximum(rr, 1e-6), 1.0)
    mapx, mapy = ((ORB_CX - x0) + dx * k).astype(np.float32), ((ORB_CY - y0) + dy * k).astype(np.float32)
    alpha = np.clip(0.5 - (rr - FREE_R) / 1.5, 0, 1).astype(np.float32)
    tiles, poster = [], None
    for n, f in enumerate(frames):
        c = denoise(f[y0:y0 + FREE_SRC, x0:x0 + FREE_SRC], 5)
        c = cv2.remap(np.ascontiguousarray(c), mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
        def down(size):
            pm = cv2.resize(c * alpha[..., None], (size, size), interpolation=cv2.INTER_AREA)   # premultiplied, so the rim blends cleanly
            a = cv2.resize(alpha, (size, size), interpolation=cv2.INTER_AREA)
            col = np.where(a[..., None] > 1e-4, pm / np.maximum(a[..., None], 1e-4), 0)
            return np.dstack([np.clip(col, 0, 255), np.clip(a, 0, 1) * 255]).round().astype(np.uint8)
        tiles.append(down(FREE_OUT))
        if n == 0: poster = down(FREE_POSTER)
    cols = 10
    rows = (len(tiles) + cols - 1) // cols
    sh = np.zeros((rows * FREE_OUT, cols * FREE_OUT, 4), np.uint8)
    for k_, t in enumerate(tiles):
        sh[(k_ // cols) * FREE_OUT:(k_ // cols + 1) * FREE_OUT, (k_ % cols) * FREE_OUT:(k_ % cols + 1) * FREE_OUT] = t
    return Image.fromarray(sh, 'RGBA'), Image.fromarray(poster, 'RGBA')


def plate_stops(frames):
    """Median of all frames = the static scene. Radial average around the sphere, smoothed, sampled at fixed radii."""
    med = np.median(np.stack(frames[::2]).astype(np.float32), axis=0)
    h, w = med.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx - LOADER_CX, yy - LOADER_CY)
    prof = []
    for r in range(0, 560):
        m = (rr >= r) & (rr < r + 1)
        prof.append(med[m].mean(axis=0) if m.any() else prof[-1])
    prof = np.array(prof)
    # no smoothing next to the sphere (the dark band ends in a sharp step at 108 px), wide smoothing further out
    sm = np.array([prof[max(0, i - (0 if i < 132 else 5)):i + (0 if i < 132 else 5) + 1].mean(axis=0) for i in range(len(prof))])
    sm[:94] = sm[94]                      # inside the sphere nothing shows through: keep the first visible colour
    radii = [0, 94, 95, 96, 98, 100, 102, 104, 106, 107, 108, 109, 110, 111, 112, 114, 116, 118, 120, 122, 126, 131, 135, 140, 150, 160, 175, 190, 205,
             220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 520]
    return [[r] + [int(round(v)) for v in sm[min(r, len(sm) - 1)]] for r in radii]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    loader_gif, orb_gif = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'user', 'anim')
    os.makedirs(out, exist_ok=True)

    # ---- start-up sphere ----
    fr = frames_of(loader_gif)
    assert len(fr) == 100, len(fr)
    stops = plate_stops(fr)
    fill = np.array(stops[1][1:], np.float32)
    s = LOADER_FRAME
    x0, y0 = int(round(LOADER_CX + 0.5 - s / 2)), int(round(LOADER_CY + 0.5 - s / 2))
    yy, xx = np.mgrid[0:s, 0:s]
    rr = np.hypot(xx - (LOADER_CX - x0), yy - (LOADER_CY - y0))
    cut = []
    for f in fr:
        c = denoise(f[y0:y0 + s, x0:x0 + s], 7).astype(np.float32)
        c[rr > LOADER_MASK_R] = fill
        cut.append(c.astype(np.uint8))
    sheet(cut, s).save(os.path.join(out, 'loader-sphere.webp'), 'WEBP', quality=72, method=6)
    poster = Image.fromarray(cut[0]).resize((96, 96), Image.LANCZOS)
    b = io.BytesIO(); poster.save(b, 'WEBP', quality=55, method=6)
    open(os.path.join(out, 'loader-poster.txt'), 'w').write('data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode())
    json.dump(stops, open(os.path.join(out, 'plate.json'), 'w'))
    print('plate stops (paste into the loader):')
    print(json.dumps(stops, separators=(',', ':')))

    # ---- payment orb ----
    fr2 = frames_of(orb_gif)
    assert len(fr2) == 100, len(fr2)
    c = ORB_SRC
    ox, oy = int(round(ORB_CX - c / 2)), int(round(ORB_CY - c / 2))
    cut2 = []
    for f in fr2:
        d = denoise(f[oy:oy + c, ox:ox + c], 5)
        cut2.append(cv2.resize(d, (ORB_OUT, ORB_OUT), interpolation=cv2.INTER_AREA))
    sheet(cut2, ORB_OUT).save(os.path.join(out, 'pay-orb.webp'), 'WEBP', quality=72, method=6)
    sheet_free, poster_free = free_orb(fr2)
    sheet_free.save(os.path.join(out, 'orb-free.webp'), 'WEBP', quality=75, method=6, alpha_quality=100)
    b = io.BytesIO(); poster_free.save(b, 'WEBP', quality=70, method=6, alpha_quality=100)
    open(os.path.join(out, 'orb-poster.txt'), 'w').write('data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode())
    for n in ('loader-sphere.webp', 'pay-orb.webp', 'orb-free.webp', 'loader-poster.txt', 'orb-poster.txt', 'plate.json'):
        print(n, os.path.getsize(os.path.join(out, n)), 'bytes')


if __name__ == '__main__':
    main()
