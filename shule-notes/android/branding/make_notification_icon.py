"""Makes the small icon Android shows in the phone's status bar and in the notification itself.

Android only uses the SHAPE of this icon (it paints it white, or in the accent colour), so a full-colour
logo would show up as a plain white square. This turns the Shule Notes logo into a one-colour shape: the
notebook and the graduation cap are solid, the letters, the ruled lines and the page corner are cut out
of the notebook, and the tassel is kept.

    python3 make_notification_icon.py ../app/src/main/res/drawable-nodpi/logo_mark.png ../app/src/main/res
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float32) / 255
alpha = a[..., 3]
rgb = a[..., :3]
H, W = alpha.shape
solid = alpha > 0.5
ys, xs = np.where(solid)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

# Dark green (notebook and cap) is the body of the icon. Bright pixels are the letters, lines and page corner.
lum = rgb.mean(axis=2)
sat = rgb.max(axis=2) - rgb.min(axis=2)
dark = lum < 0.50
# The teal tassel and cap cord are bright too but sit outside the notebook, so they are kept.
cap_zone = (np.arange(H)[:, None] < y0 + 0.30 * (y1 - y0)) | (np.arange(W)[None, :] > x0 + 0.75 * (x1 - x0))
keep = solid & (dark | (cap_zone & (sat > 0.25)))

# At 24dp the spiral rings and the two ruled lines are too fine to read and only make the edge ragged,
# so the rings are left off and the lines are filled in. (Coordinates are for the 512-pixel logo_mark.png.)
w = x1 - x0
keep[:, : int(x0 + 0.10 * w)] = False
keep[222:278, 290:395] |= solid[222:278, 290:395]

# Close tiny gaps and soften the edge so the shape is clean when shrunk.
mask = Image.fromarray((keep * 255).astype(np.uint8))
mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
m = np.asarray(mask)

# Crop to the shape, centre it on a square with a margin (the 24dp icon box keeps about 2dp clear all round).
ys, xs = np.where(m > 20)
crop = Image.fromarray(m[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
side = max(crop.size)
canvas = Image.new("L", (side, side), 0)
canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))

for folder, px in (("mdpi", 24), ("hdpi", 36), ("xhdpi", 48), ("xxhdpi", 72), ("xxxhdpi", 96)):
    inner = round(px * 20 / 24)                     # 20 of the 24 units; the rest is the margin
    glyph = canvas.resize((inner, inner), Image.LANCZOS)
    icon = Image.new("L", (px, px), 0)
    icon.paste(glyph, ((px - inner) // 2, (px - inner) // 2))
    white = Image.new("RGBA", (px, px), (255, 255, 255, 0))
    white.putalpha(icon)
    import os
    os.makedirs(f"{out}/drawable-{folder}", exist_ok=True)
    white.save(f"{out}/drawable-{folder}/ic_notification.png", optimize=True)
    print("wrote", folder, px)

# A large preview for checking by eye (not shipped).
preview = Image.new("RGBA", (400, 200), (60, 60, 60, 255))
for i, px in enumerate((96, 48)):
    g = Image.open(f"{out}/drawable-{'xxxhdpi' if px == 96 else 'xhdpi'}/ic_notification.png")
    preview.alpha_composite(g, (40 + i * 180, 50))
preview = preview.resize((800, 400), Image.NEAREST)
preview.save("/tmp/notification_preview.png")
