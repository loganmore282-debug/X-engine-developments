#!/usr/bin/env python3
"""Cuts the owner's robot loading GIF (357 x 356, 12 frames, 130 ms each = a 1.56 s loop) into the sprite sheet the start-up screen plays.

  python3 tools/make-robot-loader.py <robot-loading.gif> [out-dir]      (needs Pillow and numpy)

Writes, into out-dir (default user/anim):
  loader-robot.webp   the 12 frames in a 4 x 3 sheet (1428 x 1068 px, frame n = row n // 4, column n % 4), with the GIF's own words "Loading..." wiped out (rows 266-307, the
                      band they sit in; the platform's glow ends at row 262 and the five progress dots start at row 311, so nothing else is touched). The app writes the
                      words itself as live text ("SMART AI Loading...") in that same place; the progress dots, the turning blue arcs, the face and the sparkles are the GIF's.
"""
import io, os, sys
import numpy as np
from PIL import Image

BAND = (266, 308)          # rows of the baked-in "Loading..." (its ink is rows 274-303 in every frame)


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'user', 'anim')
    os.makedirs(out, exist_ok=True)
    im = Image.open(sys.argv[1])
    assert im.n_frames == 12, im.n_frames
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(np.asarray(im.convert('RGB')).copy())
    h, w = frames[0].shape[:2]
    bg = np.median(np.stack([f[:6, :6].reshape(-1, 3) for f in frames]).reshape(-1, 3), axis=0).astype(np.uint8)
    sheet = np.empty((3 * h, 4 * w, 3), np.uint8); sheet[:] = bg
    for n, f in enumerate(frames):
        f = f.copy(); f[BAND[0]:BAND[1], :] = bg
        sheet[(n // 4) * h:(n // 4 + 1) * h, (n % 4) * w:(n % 4 + 1) * w] = f
    path = os.path.join(out, 'loader-robot.webp')
    Image.fromarray(sheet).save(path, 'WEBP', quality=88, method=6)
    print('background', bg.tolist(), '| frame', w, 'x', h, '| sheet', sheet.shape[1], 'x', sheet.shape[0], '|', os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
