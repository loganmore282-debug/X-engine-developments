"""Makes the opened gift picture from the owner's recording of the bursting gift box (video 4):
   user/anim/gift-open.webp  the open box with its coin pile, WITHOUT its star and star pattern: the app puts a UGX coin where the star was
   (The gift that "wants to open" is NOT cut from video any more: it is drawn as SVG in the app, GB_SVG, so it is sharp at any size; it moves like
   the recording's 0.433 s loop.)
   python3 tools/make-gift-art.py <dir with a burst/f folder of 60 fps frames 00001.png ...>      (needs numpy, opencv, Pillow)"""
import sys, os, json, glob
import numpy as np, cv2
from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'user', 'anim')

def key_alpha(bgr, thresh=58, no_purple=False):
    b, g, r = [bgr[:, :, i].astype(np.int32) for i in range(3)]
    v = np.maximum(np.maximum(r, g), b)
    mask = (v > thresh).astype(np.uint8)
    if no_purple:   # the page of that recording has a purple glow in one corner: it is not part of the box
        hh = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 0].astype(np.int32)
        mask[(hh >= 118) & (hh <= 170) & (v < 125)] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    h, w = mask.shape
    pad = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    ff = pad.copy(); cv2.floodFill(ff, None, (0, 0), 2)
    filled = ((ff != 2).astype(np.uint8))[1:-1, 1:-1]
    n, lab, st, _ = cv2.connectedComponentsWithStats(filled)
    keep = np.zeros_like(filled)
    for i in range(1, n):
        if st[i][4] >= 40: keep[lab == i] = 1
    er = cv2.erode(keep, np.ones((3, 3), np.uint8))
    edge = (keep == 1) & (er == 0)
    soft = np.clip((v - 30) / 55.0, 0, 1)
    alpha = keep.astype(np.float32); alpha[edge] = soft[edge]
    rgb = bgr[:, :, ::-1].astype(np.float32)
    inside = er.astype(bool); fillc = rgb.copy()
    for _ in range(2):
        m = inside.astype(np.float32)
        blur = cv2.blur(fillc * m[:, :, None], (3, 3)); cnt = cv2.blur(m, (3, 3))
        newc = np.where(cnt[:, :, None] > 0.01, blur / np.maximum(cnt, 1e-3)[:, :, None], fillc)
        fillc = np.where(inside[:, :, None], fillc, newc); inside = inside | (cnt > 0.01)
    rgb = np.where(er.astype(bool)[:, :, None], rgb, fillc)
    return rgb, alpha

# ------------------------------------------------------------------ the open box, no star
im = cv2.imread(f'{SRC}/burst/f/00070.png')
Hh, Ww = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); h, s, v = [hsv[:, :, i].astype(int) for i in range(3)]
gold = (h >= 14) & (h <= 34) & (s > 110) & (v > 170)
region = np.zeros((Hh, Ww), bool); region[:372, :] = True
star = (gold & region).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(star)
big = max(range(1, n), key=lambda i: st[i][4]); star = (lab == big).astype(np.uint8)
star_d = cv2.dilate(star, np.ones((7, 7), np.uint8)).astype(bool)
# the box without the star: blue parts + everything below the pile
blue = ((h >= 92) & (h <= 114) & (s > 60) & (v > 90)).astype(np.uint8)
blue[:250, :] = 0
hull_pts = cv2.convexHull(np.column_stack(np.where(blue > 0))[:, ::-1])
hull = np.zeros((Hh, Ww), np.uint8); cv2.fillConvexPoly(hull, hull_pts, 1)
inside_hull = hull.astype(bool)
# star over the box's back wall: fill row by row between the wall colours on either side; star over the page: transparent
fixed = im.copy()
for y in range(Hh):
    row = star_d[y] & inside_hull[y]
    if not row.any(): continue
    xs_ = np.where(row)[0]
    # runs
    runs = np.split(xs_, np.where(np.diff(xs_) > 1)[0] + 1)
    for run in runs:
        a, b = run[0] - 1, run[-1] + 1
        if a < 0 or b >= Ww: continue
        ca, cb = im[y, a].astype(np.float32), im[y, b].astype(np.float32)
        for k, x in enumerate(run):
            t = (k + 1) / (len(run) + 1); fixed[y, x] = (ca * (1 - t) + cb * t).astype(np.uint8)
page_star = star_d & ~inside_hull
rgb, alpha = key_alpha(fixed)
alpha[page_star] = 0
# the star pattern on the box faces: lighter, less saturated blue -> flatten it, then put little coins in its place
hsv2 = cv2.cvtColor(fixed, cv2.COLOR_BGR2HSV); h2, s2, v2 = [hsv2[:, :, i].astype(int) for i in range(3)]
body = np.zeros((Hh, Ww), bool); body[440:600, 262:612] = True
bluebase = (h2 >= 95) & (h2 <= 112)
base_s = np.median(s2[body & bluebase])
pat = (body & bluebase & (s2 < base_s - 28) & (v2 > 200)).astype(np.uint8)
pat = cv2.morphologyEx(pat, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(pat)
blobs = [(cen[i], st[i][4]) for i in range(1, n) if st[i][4] >= 150]
flat = cv2.inpaint(fixed, cv2.dilate(pat, np.ones((5, 5), np.uint8)), 6, cv2.INPAINT_TELEA)
rgb, _a = key_alpha(flat); rgb = np.where((alpha > 0)[:, :, None], rgb, rgb)
pil = Image.fromarray(np.clip(np.dstack([rgb, alpha * 255.0]), 0, 255).astype(np.uint8), 'RGBA')
S = 4
big_im = pil.resize((Ww * 1, Hh * 1))
dr = ImageDraw.Draw(big_im)
for (cxx, cyy), area in blobs:
    r = max(11, int(np.sqrt(area / np.pi) * 0.62))
    dr.ellipse([cxx - r * 0.85, cyy - r, cxx + r * 0.85, cyy + r], fill=(150, 214, 255, 255), outline=(112, 192, 252, 255), width=1)
bb = big_im.getbbox(); print('open bbox', bb)
pad = 6; bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(Ww, bb[2] + pad), min(Hh, bb[3] + pad))
art = big_im.crop(bb)
tw = 512; art = art.resize((tw, int(art.height * tw / art.width)), Image.LANCZOS)
art.save(os.path.join(OUT, 'gift-open.webp'), 'WEBP', quality=90, method=6, alpha_quality=95)
# where the star was, in the picture's own pixels (percent of its width/height), for the app to place the coin
sb = st[big]
info = {'w': art.width, 'h': art.height, 'coin': [round((sb[0] + sb[2] / 2 - bb[0]) / (bb[2] - bb[0]) * 100, 2), round((sb[1] + sb[3] / 2 - bb[1]) / (bb[3] - bb[1]) * 100, 2), round(max(sb[2], sb[3]) / (bb[2] - bb[0]) * 100, 2)]}
print('open art', art.size, os.path.getsize(os.path.join(OUT, 'gift-open.webp')) // 1024, 'kB', info)
json.dump(info, open(os.path.join(SRC, 'gift-open.json'), 'w'))
