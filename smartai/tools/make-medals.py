"""Cuts the owner's three medal animations (level 1 gold, level 2 silver, level 3 bronze; screen recordings on a dark page, 3 s loops) into
transparent sprite sheets: user/anim/medal-1.webp, medal-2.webp, medal-3.webp (+ user/icons/level1|2|3.webp = the resting picture) and prints the
timeline (which cell shows at each 1/30 s) to paste into original_module.js (MEDAL_TL).
   python3 tools/make-medals.py <dir with gold/ silver/ bronze/ folders of 60 fps frames named n/00001.png ...>
Needs numpy, opencv, Pillow."""
import sys, os, json, glob
import numpy as np, cv2
from PIL import Image

SRC = sys.argv[1]
FPS_OUT = 30           # sampled 30 times a second, 90 pictures per 3 s loop
LOOP = 180             # frames at 60 fps = 3.0 s
CELL = 128             # one cell is CELL x CELL pixels in the sheet
COLS = 10

def key(frame_bgr):
    """returns (rgb, alpha) of the artwork with the dark page taken away"""
    b, g, r = [frame_bgr[:, :, i].astype(np.int32) for i in range(3)]
    v = np.maximum(np.maximum(r, g), b)
    mask = (v > 58).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # the black digit and other dark parts inside the artwork: everything enclosed by the artwork belongs to it
    h, w = mask.shape
    pad = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    ff = pad.copy(); cv2.floodFill(ff, None, (0, 0), 2)
    filled = ((ff != 2).astype(np.uint8))[1:-1, 1:-1]
    # drop specks (compression noise): keep components with some size
    n, lab, st, _ = cv2.connectedComponentsWithStats(filled)
    keep = np.zeros_like(filled)
    for i in range(1, n):
        if st[i][4] >= 18: keep[lab == i] = 1
    filled = keep
    # soft edge: the outermost pixel row is partly dark page; give it a value from its own brightness
    er = cv2.erode(filled, np.ones((3, 3), np.uint8))
    edge = (filled == 1) & (er == 0)
    soft = np.clip((v - 30) / 55.0, 0, 1)
    alpha = filled.astype(np.float32)
    alpha[edge] = soft[edge]
    # colours at the edge: push the colour of the inside outward so no dark halo shows on a light page
    inside = er.astype(bool)
    rgb = frame_bgr[:, :, ::-1].astype(np.float32)
    fillc = rgb.copy()
    for _ in range(2):
        m = inside.astype(np.float32)
        blur = cv2.blur(fillc * m[:, :, None], (3, 3)); cnt = cv2.blur(m, (3, 3))
        newc = np.where(cnt[:, :, None] > 0.01, blur / np.maximum(cnt, 1e-3)[:, :, None], fillc)
        fillc = np.where(inside[:, :, None], fillc, newc); inside = inside | (cnt > 0.01)
    rgb = np.where(er.astype(bool)[:, :, None], rgb, fillc)
    return rgb, alpha

def load(name):
    files = sorted(glob.glob(f'{SRC}/{name}/n/*.png'))
    return files

result = {}
for name, level in (('gold', 1), ('silver', 2), ('bronze', 3)):
    files = load(name)
    picks = [files[i] for i in range(0, LOOP, 60 // FPS_OUT)]
    frames = []
    for f in picks:
        rgb, a = key(cv2.imread(f))
        frames.append((rgb, a))
    # union box of the artwork, made square, with a little air
    ys = [np.where(a.max(axis=1) > 0.3)[0] for _, a in frames]; xs = [np.where(a.max(axis=0) > 0.3)[0] for _, a in frames]
    y0 = min(y.min() for y in ys if len(y)); y1 = max(y.max() for y in ys if len(y)); x0 = min(x.min() for x in xs if len(x)); x1 = max(x.max() for x in xs if len(x))
    side = max(y1 - y0, x1 - x0) + 6; cy = (y0 + y1) // 2; cx = (x0 + x1) // 2
    H, W = frames[0][1].shape
    sy0 = int(np.clip(cy - side // 2, 0, max(0, H - side))); sx0 = int(np.clip(cx - side // 2, 0, max(0, W - side)))
    cells = []
    for rgb, a in frames:
        c = np.dstack([rgb, a * 255.0])[sy0:sy0 + side, sx0:sx0 + side]
        im = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'RGBA').resize((CELL, CELL), Image.LANCZOS)
        cells.append(np.asarray(im))
    # same picture as the one before it (the medal is at rest) -> one cell, shown for longer
    uniq, tl = [], []
    for c in cells:
        if uniq and np.abs(c.astype(np.int16) - uniq[-1].astype(np.int16)).mean() < 2.2: tl.append(len(uniq) - 1); continue
        uniq.append(c); tl.append(len(uniq) - 1)
    rows = (len(uniq) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, c in enumerate(uniq): sheet.paste(Image.fromarray(c, 'RGBA'), ((i % COLS) * CELL, (i // COLS) * CELL))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'user', 'anim', f'medal-{level}.webp')
    sheet.save(out, 'WEBP', quality=88, method=6, alpha_quality=95)
    # the resting picture (the cell shown longest)
    best = max(set(tl), key=tl.count)
    c = np.dstack([frames[tl.index(best)][0], frames[tl.index(best)][1] * 255.0])[sy0:sy0 + side, sx0:sx0 + side]
    rest = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'RGBA').resize((192, 192), Image.LANCZOS)
    rest.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'user', 'icons', f'level{level}.webp'), 'WEBP', quality=72, method=6, alpha_quality=90)
    result[level] = {'cells': len(uniq), 'timeline': tl, 'box': [int(sx0), int(sy0), int(side)], 'bytes': os.path.getsize(out)}
    print(level, name, 'cells', len(uniq), 'of', len(tl), 'box', (sx0, sy0, side), 'sheet', sheet.size, 'kB', os.path.getsize(out) // 1024)
json.dump(result, open(os.path.join(SRC, 'medals.json'), 'w'))
