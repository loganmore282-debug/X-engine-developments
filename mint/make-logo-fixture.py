#!/usr/bin/env python3
"""Build the fixture logos test-logo-cutout.py drives the real cutter with.

Three deliberately awkward cases, because a cutter that only handles a clean
logo centred on flat black is not worth having:

  mtn-on-black.png    a wide wordmark on flat black, with BLACK LETTERING
                      inside a bright shape -- the case that catches a cutter
                      keying every dark pixel instead of flood-filling from
                      the border. Those letters must survive.
  soft-on-black.png   the same, antialiased, so the rim pixels are a genuine
                      blend of logo and black. Tests that the edge comes out
                      soft and at the logo's own colour, not as a dark fringe.
  on-white.png        the same artwork on WHITE. Nothing should be removed,
                      and the upload must still be stored.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'test-fixtures')
os.makedirs(OUT, exist_ok=True)

YELLOW = (255, 204, 0)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)


def artwork(bg, size=(400, 220), ss=1):
    """A yellow rounded blob with BLACK letters cut into it, on `bg`."""
    w, h = size[0] * ss, size[1] * ss
    im = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(im)
    # The bright shape, inset so there is real background on all four sides.
    d.rounded_rectangle([60 * ss, 50 * ss, 340 * ss, 170 * ss],
                        radius=60 * ss, fill=YELLOW)
    # Black bars INSIDE it, standing in for dark lettering. Enclosed by the
    # yellow on every side, so a border flood-fill can never reach them.
    for i in range(3):
        x = (100 + i * 80) * ss
        d.rectangle([x, 85 * ss, x + 44 * ss, 135 * ss], fill=BLACK)
    if ss > 1:
        im = im.resize(size, Image.LANCZOS)
    return im


if __name__ == '__main__':
    artwork(BLACK).save(os.path.join(OUT, 'mtn-on-black.png'))
    artwork(BLACK, ss=4).save(os.path.join(OUT, 'soft-on-black.png'))
    artwork(WHITE).save(os.path.join(OUT, 'on-white.png'))
    for n in ('mtn-on-black.png', 'soft-on-black.png', 'on-white.png'):
        p = os.path.join(OUT, n)
        print(f'{p}  {Image.open(p).size}  {os.path.getsize(p)} bytes')
