"""Crop each cut-out icon to its own outline, centre it in a square, shrink it properly (alpha-aware), save as WebP.
usage: python3 finalize.py <cut_dir> <out_dir> <size> name=source [name=source ...]"""
import sys, os
import numpy as np, cv2
from PIL import Image
cut_dir, out_dir, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
pairs = [a.split('=') for a in sys.argv[4:]]
os.makedirs(out_dir, exist_ok=True)
margin = 0.035
for out_name, src in pairs:
    im = cv2.imread(os.path.join(cut_dir, src + '.png'), cv2.IMREAD_UNCHANGED)  # BGRA
    a = im[..., 3]
    ys, xs = np.where(a > 8)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = im[y0:y1, x0:x1].astype(np.float32)
    h, w = crop.shape[:2]
    side = int(round(max(h, w) * (1 + 2 * margin)))
    canvas = np.zeros((side, side, 4), np.float32)
    oy, ox = (side - h) // 2, (side - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop
    # premultiply, shrink, un-premultiply
    al = canvas[..., 3:4] / 255.0
    pm = canvas[..., :3] * al
    pm = cv2.resize(pm, (size, size), interpolation=cv2.INTER_AREA)
    al2 = cv2.resize(al[..., 0], (size, size), interpolation=cv2.INTER_AREA)[..., None]
    rgb = np.where(al2 > 1e-4, pm / np.maximum(al2, 1e-4), 0)
    out = np.dstack([np.clip(rgb, 0, 255), np.clip(al2 * 255, 0, 255)]).astype(np.uint8)
    pil = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGRA2RGBA), 'RGBA')
    path = os.path.join(out_dir, out_name + '.webp')
    pil.save(path, 'WEBP', quality=90, alpha_quality=100, method=6)
    print(out_name, '<-', src, 'bbox', (int(x0), int(y0), int(x1), int(y1)), os.path.getsize(path), 'bytes')
