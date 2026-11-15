"""Turns the owner's logo (logo-source.png) into the app's image assets: the
dark blue is recoloured to the app's green, the white background is made
transparent, and the mark is cropped out.

    python3 make_logo_assets.py logo-source.png ../app/src/main/res
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
rgb = np.asarray(im).astype(np.float32) / 255

# --- recolour: hue of the dark blue (about 211 degrees) moved to green (158) ---
hsv = np.asarray(im.convert("HSV")).astype(np.float32)
h = hsv[..., 0] / 255 * 360
s = hsv[..., 1] / 255
v = hsv[..., 2] / 255
t = np.clip((h - 186) / 14, 0, 1) * (h < 260)        # 0 for teal, 1 for blue, smooth between
h2 = h + (158 - h) * t
s2 = s * (1 - 0.22 * t)
hsv2 = np.stack([h2 / 360 * 255, s2 * 255, v * 255], axis=-1).clip(0, 255).astype(np.uint8)
green = Image.fromarray(hsv2, "HSV").convert("RGB")

def transparent(img):
    a = np.asarray(img).astype(np.float32) / 255
    near_white = Image.fromarray(((a.min(axis=2) > 0.965) * 255).astype(np.uint8)).copy()
    w, h = near_white.size
    for seed in ((20, 20), (w - 20, 20), (20, h - 20), (w - 20, h - 20)):
        if near_white.getpixel(seed) == 255:
            ImageDraw.floodfill(near_white, seed, 128, thresh=0)
    outside = Image.fromarray(((np.asarray(near_white) == 128) * 255).astype(np.uint8))
    ring = np.asarray(outside.filter(ImageFilter.MaxFilter(7))) > 0   # outside plus its soft edge
    alpha = np.ones(a.shape[:2], np.float32)
    alpha[ring] = 1 - a.min(axis=2)[ring]
    safe = np.maximum(alpha, 1e-3)[..., None]
    colour = np.where(ring[..., None], (a - (1 - alpha[..., None])) / safe, a).clip(0, 1)
    return Image.fromarray((np.dstack([colour, alpha]) * 255).round().astype(np.uint8), "RGBA")

MARK = (349, 160, 891, 837)
def mark_of(img, size, fill):
    m = transparent(img).crop(MARK)
    scale = size * fill / max(m.size)
    m = m.resize((round(m.width * scale), round(m.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas

res = out
mark_of(green, 512, 0.98).save(f"{res}/drawable-nodpi/logo_mark.png")
mark_of(green, 432, 0.58).save(f"{res}/mipmap-xxxhdpi/ic_launcher_foreground.png")

legacy = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
ImageDraw.Draw(legacy).rounded_rectangle((8, 8, 184, 184), radius=40, fill=(255, 255, 255, 255))
legacy.alpha_composite(mark_of(green, 192, 0.66))
legacy.save(f"{res}/mipmap-xxxhdpi/ic_launcher_legacy.png")
