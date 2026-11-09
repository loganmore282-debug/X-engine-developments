"""Step 1 for a new icon pack: find the page picture every icon of the pack was pasted on.

All icons of the owner's pack sit on the SAME synthetic light-blue halo (plus a leftover rectangle with a little noise around each icon). The per-pixel
mode over the whole pack is therefore the halo exactly, wherever the icons' own tile does not reach. cutout.py uses it to know what is page.

usage: python3 survey.py <folder with the pack's PNGs>      -> writes mode_rgb.npy next to this file
"""
import os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
d = sys.argv[1]
names = sorted(f for f in os.listdir(d) if f.lower().endswith('.png'))
stack = np.stack([cv2.cvtColor(cv2.imread(os.path.join(d, n)), cv2.COLOR_BGR2RGB) for n in names]).astype(np.int64)
code = (stack[..., 0] << 16) | (stack[..., 1] << 8) | stack[..., 2]
N, H, W = code.shape
srt = np.sort(code, axis=0)
best = srt[0].copy(); bestc = np.ones((H, W), np.int64); run = np.ones((H, W), np.int64)
for i in range(1, N):
    run = np.where(srt[i] == srt[i - 1], run + 1, 1)
    upd = run > bestc
    best = np.where(upd, srt[i], best); bestc = np.where(upd, run, bestc)
mode = np.dstack([(best >> 16) & 255, (best >> 8) & 255, best & 255]).astype(np.uint8)
np.save(os.path.join(HERE, 'mode_rgb.npy'), mode)
print('page picture saved from', N, 'icons; pixels that agree in at least 10 icons:', round(float((bestc >= 10).mean()) * 100, 1), '%')
