"""Makes the app icons (user/ and admin/ icon-192.png + icon-512.png) from the owner's AI robot picture.
   python3 tools/make-app-icons.py <robot-512-cutout.png>      (needs Pillow)
The icon = the robot on the app's blue gradient (no letters)."""
import sys
from PIL import Image, ImageDraw, ImageFilter
robot = Image.open(sys.argv[1]).convert('RGBA')
# the cut-out has a thin light fringe on its rim: pull the edge in a little and soften it
a = robot.getchannel('A').filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2)); robot.putalpha(a)
bb = robot.getbbox(); robot = robot.crop(bb)

def gradient(w, h, top, bottom):
    g = Image.new('RGB', (w, h)); d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(1, h - 1); d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g

def tile(size, fill=0.80, radius=0):
    """square blue tile with the robot centred (+ a soft shadow under it)"""
    S = size * 2   # draw at 2x, shrink for smooth edges
    base = gradient(S, S, (43, 139, 246), (11, 42, 120)).convert('RGBA')
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    gd.ellipse([S * .14, S * .02, S * .86, S * .62], fill=(255, 255, 255, 46)); glow = glow.filter(ImageFilter.GaussianBlur(S * .06))
    base.alpha_composite(glow)
    k = S * fill / max(robot.size); r = robot.resize((max(1, int(robot.width * k)), max(1, int(robot.height * k))), Image.LANCZOS)
    x, y = (S - r.width) // 2, (S - r.height) // 2 + int(S * .01)
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); sh.paste((5, 20, 70, 120), (x, y + int(S * .025)), r.split()[3]); sh = sh.filter(ImageFilter.GaussianBlur(S * .02))
    base.alpha_composite(sh); base.alpha_composite(r, (x, y))
    if radius:
        m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(radius * 2), fill=255); base.putalpha(m)
    return base.resize((size, size), Image.LANCZOS)

for app in ('user', 'admin'):
    for n in (192, 512):
        tile(n).convert('RGB').save(f'{app}/icon-{n}.png', optimize=True)

print('done')
