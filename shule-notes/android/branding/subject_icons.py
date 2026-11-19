"""Shule Notes' own subject icons.

Each icon is drawn here on a 48 x 48 grid in one consistent style (round
2.6 strokes, a soft 30% fill for the main shape, small solid accents) and
written twice: as an SVG under subject-icons/ (the editable source, and what
the preview is rendered from) and as an Android vector drawable
(ic_subject_<key>.xml). The app tints each icon with its subject's colour,
so the drawables are plain black on transparent and the soft fill is just
transparency.

    python3 subject_icons.py ../app/src/main/res/drawable
"""
import math
import os
import sys

OUT_RES = sys.argv[1] if len(sys.argv) > 1 else "../app/src/main/res/drawable"
HERE = os.path.dirname(os.path.abspath(__file__))
SVG_DIR = os.path.join(HERE, "subject-icons")


def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def circle(cx, cy, r):
    return f"M{f(cx - r)},{f(cy)}a{f(r)},{f(r)} 0 1,0 {f(2 * r)},0a{f(r)},{f(r)} 0 1,0 {f(-2 * r)},0Z"


def rrect(x, y, w, h, r):
    return (f"M{f(x + r)},{f(y)}H{f(x + w - r)}a{f(r)},{f(r)} 0 0 1 {f(r)},{f(r)}V{f(y + h - r)}"
            f"a{f(r)},{f(r)} 0 0 1 {f(-r)},{f(r)}H{f(x + r)}a{f(r)},{f(r)} 0 0 1 {f(-r)},{f(-r)}"
            f"V{f(y + r)}a{f(r)},{f(r)} 0 0 1 {f(r)},{f(-r)}Z")


def poly(points, close=True):
    d = "M" + "L".join(f"{f(x)},{f(y)}" for x, y in points)
    return d + ("Z" if close else "")


def line(x1, y1, x2, y2):
    return f"M{f(x1)},{f(y1)}L{f(x2)},{f(y2)}"


def ellipse(cx, cy, rx, ry, rot_deg):
    k = 0.5523
    t = math.radians(rot_deg)
    ct, st = math.cos(t), math.sin(t)

    def pt(a):
        x, y = rx * math.cos(a), ry * math.sin(a)
        return cx + x * ct - y * st, cy + x * st + y * ct

    def dv(a):
        x, y = -rx * math.sin(a), ry * math.cos(a)
        return x * ct - y * st, x * st + y * ct

    parts = []
    start = pt(0)
    parts.append(f"M{f(start[0])},{f(start[1])}")
    for i in range(4):
        a0, a1 = i * math.pi / 2, (i + 1) * math.pi / 2
        p0, p1 = pt(a0), pt(a1)
        d0, d1 = dv(a0), dv(a1)
        c1 = (p0[0] + k * d0[0], p0[1] + k * d0[1])
        c2 = (p1[0] - k * d1[0], p1[1] - k * d1[1])
        parts.append(f"C{f(c1[0])},{f(c1[1])} {f(c2[0])},{f(c2[1])} {f(p1[0])},{f(p1[1])}")
    return "".join(parts) + "Z"


def star(cx, cy, ro, ri):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        r = ro if i % 2 == 0 else ri
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return poly(pts)


def gear(cx, cy, r_out, r_in, teeth=8):
    pts = []
    for i in range(teeth):
        a = math.radians(i * 360 / teeth)
        for da, r in ((-13, r_in), (-8, r_out), (8, r_out), (13, r_in)):
            ang = a + math.radians(da)
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return poly(pts)


# kinds: S stroke, S2 thin stroke, F solid, T soft fill, TS soft fill + stroke, FE solid with holes
ICONS = {}


def icon(key, *shapes):
    ICONS[key] = shapes


# Mathematics: a calculator
icon("math",
     ("TS", rrect(10, 5, 28, 38, 5)),
     ("F", rrect(15, 10, 18, 8, 2)),
     *[("F", circle(x, y, 1.9)) for y in (26, 32, 38) for x in (17, 24, 31)])

# English: a speech bubble holding the letter A
icon("english",
     ("TS", "M14,7H34a8,8 0 0 1 8,8V25a8,8 0 0 1 -8,8H25L16,42V33H14a8,8 0 0 1 -8,-8V15a8,8 0 0 1 8,-8Z"),
     ("S", "M17,27L24,12L31,27"),
     ("S", "M19.5,22.5H28.5"))

# Languages (Kiswahili, Luganda, foreign languages): two bubbles in conversation
icon("languages",
     ("S", "M10,5H24a5,5 0 0 1 5,5V15a5,5 0 0 1 -5,5H17L11,25V20H10a5,5 0 0 1 -5,-5V10a5,5 0 0 1 5,-5Z"),
     ("F", circle(11, 12.5, 1.5)), ("F", circle(17, 12.5, 1.5)), ("F", circle(23, 12.5, 1.5)),
     ("TS", "M24,22H38a5,5 0 0 1 5,5V32a5,5 0 0 1 -5,5H37V42L31,37H24a5,5 0 0 1 -5,-5V27a5,5 0 0 1 5,-5Z"))

# Reading: an open storybook with a bookmark
icon("reading",
     ("TS", "M24,12C20,9 12,8 5,10V36C12,34 20,35 24,38Z"),
     ("S", "M24,12C28,9 36,8 43,10V36C36,34 28,35 24,38Z"),
     ("S2", "M24,12V38"),
     ("S2", "M10,17H19"), ("S2", "M10,22H19"), ("S2", "M10,27H16"),
     ("F", "M32,9.6V20L35,17.5L38,20V10.4Z"))

# Science (primary, integrated): a conical flask with bubbles
icon("science",
     ("T", "M13.6,30H34.4L38.6,38.6a2.6,2.6 0 0 1 -2.4,3.9H11.8a2.6,2.6 0 0 1 -2.4,-3.9Z"),
     ("S", "M18,6H30"),
     ("S", "M19.5,6V18L9.2,37.5a3.4,3.4 0 0 0 3,5H35.8a3.4,3.4 0 0 0 3,-5L28.5,18V6"),
     ("F", circle(21, 36, 2.2)), ("F", circle(28, 34, 1.6)), ("F", circle(25, 28.5, 1.3)))

# Chemistry: a ring molecule with one attached atom
_hex = [(24 + 11 * math.cos(math.radians(30 + 60 * i)), 26 + 11 * math.sin(math.radians(30 + 60 * i))) for i in range(6)]
icon("chemistry",
     ("S", poly(_hex)),
     *[("F", circle(x, y, 3.3)) for x, y in _hex],
     ("S", line(_hex[5][0], _hex[5][1], 40, 9)),
     ("TS", circle(40, 9, 3.6)))

# Physics: an atom
icon("physics",
     ("S", ellipse(24, 24, 19, 7.5, 0)),
     ("S", ellipse(24, 24, 19, 7.5, 60)),
     ("S", ellipse(24, 24, 19, 7.5, 120)),
     ("F", circle(24, 24, 3.6)),
     ("F", circle(43, 24, 2.2)),
     ("F", circle(14.5, 7.5, 2.2)),
     ("F", circle(14.5, 40.5, 2.2)))

# Biology: a DNA helix
_dna1, _dna2 = [], []
for i in range(0, 69):
    y = 6 + i * 0.5
    u = (y - 6) / 34
    s = math.sin(2 * math.pi * 1.5 * u)
    _dna1.append((24 + 11 * s, y))
    _dna2.append((24 - 11 * s, y))
icon("biology",
     ("S", poly(_dna1, close=False)),
     ("S", poly(_dna2, close=False)),
     *[("S2", line(13.5, 6 + 34 * u, 34.5, 6 + 34 * u)) for u in (1 / 6, 0.5, 5 / 6)])

# Agriculture: a seedling in the ground
icon("agriculture",
     ("S", "M5,41H43"),
     ("T", "M9,41C10,37 15,35 24,35C33,35 38,37 39,41Z"),
     ("S", "M24,36V21"),
     ("TS", "M24,29C15,29 10,24 10,15C18,15 24,19 24,29Z"),
     ("TS", "M24,22C24,13 30,8 38,8C38,17 32,22 24,22Z"))

# Geography: a folded map with a pin
icon("geography",
     ("TS", "M5,13L17,8L31,13L43,8V35L31,40L17,35L5,40Z"),
     ("S2", "M17,8V35"), ("S2", "M31,13V40"),
     ("FE", "M26,30C21,24 20,21 20,18A6,6 0 0 1 32,18C32,21 31,24 26,30Z" + circle(26, 18, 2.3)))

# Social studies: a group of people
icon("social",
     ("TS", "M13,41A11,11 0 0 1 35,41Z"),
     ("F", circle(24, 16, 5.6)),
     ("S", "M3,38A7,7 0 0 1 11,30"), ("S", circle(9, 21, 3.8)),
     ("S", "M45,38A7,7 0 0 0 37,30"), ("S", circle(39, 21, 3.8)))

# History: a classical temple
icon("history",
     ("TS", "M5,18L24,7L43,18Z"),
     ("S", "M8,22H40"),
     ("S", "M13,25V35"), ("S", "M21,25V35"), ("S", "M27,25V35"), ("S", "M35,25V35"),
     ("S", "M8,39H40"), ("S", "M5,43H43"))

# Economics: rising bars and a trend arrow
icon("economics",
     ("TS", rrect(7, 29, 8, 13, 1.5)),
     ("TS", rrect(20, 22, 8, 20, 1.5)),
     ("TS", rrect(33, 15, 8, 27, 1.5)),
     ("S", "M5,20L16,11L24,15L40,5"),
     ("S", "M33,5H40V12"))

# Entrepreneurship: a shop with an awning
icon("entrepreneurship",
     ("TS", "M8,8H40L44,19H4Z"),
     ("S2", "M15,8L12.5,19"), ("S2", "M24,8V19"), ("S2", "M33,8L35.5,19"),
     ("S", "M8,19V41H40V19"),
     ("TS", rrect(18.5, 26, 11, 15, 1.5)),
     ("F", circle(27, 34, 1.2)))

# ICT: a monitor with code brackets
icon("ict",
     ("S", rrect(5, 7, 38, 26, 3.5)),
     ("T", rrect(9, 11, 30, 18, 1.5)),
     ("S", "M20,15.5L15,20L20,24.5"), ("S", "M28,15.5L33,20L28,24.5"),
     ("S", "M24,33V40"), ("S", "M16,41H32"))

# Art & design: a paint palette
icon("art",
     ("TS", "M24,5C12,5 4,13 4,23C4,33 13,42 23,42C28,42 29,38.5 27,35.5C25.5,33 27,30 30.5,30H35C40.5,30 44,26.5 44,21.5C44,12 35,5 24,5Z"),
     ("F", circle(14.5, 22, 2.8)), ("F", circle(21, 13.5, 2.8)),
     ("F", circle(31, 13.5, 2.8)), ("F", circle(36.5, 21.5, 2.8)))

# Religious education: a book with rays of light
_rays = []
for i in range(8):
    a = math.radians(i * 45 - 90)
    _rays.append(("S", line(24 + 9 * math.cos(a), 16 + 9 * math.sin(a), 24 + 13 * math.cos(a), 16 + 13 * math.sin(a))))
icon("religion",
     ("F", circle(24, 16, 4.4)),
     *_rays,
     ("TS", "M5,34C12,31 20,32 24,35C28,32 36,31 43,34V42C36,39 28,40 24,43C20,40 12,39 5,42Z"),
     ("S2", "M24,35V43"))

# Christian religious education: a book with a cross
icon("christian",
     ("TS", rrect(10, 5, 28, 38, 3.5)),
     ("S2", "M16,5V43"),
     ("S", "M27,14V31"),
     ("S", "M20.5,20H33.5"))

# Islamic religious education: a crescent and star
icon("islam",
     ("TS", "M25.68,9.43A16,16 0 1 0 35.82,33.07A13,13 0 1 1 25.68,9.43Z"),
     ("F", star(36, 15, 5.2, 2.2)))

# General paper: a newspaper
icon("generalpaper",
     ("S", rrect(6, 7, 36, 34, 3.5)),
     ("TS", rrect(11, 12, 26, 7, 1.5)),
     ("T", rrect(11, 23, 11, 9, 1.2)),
     ("S2", "M26,24H37"), ("S2", "M26,29H37"), ("S2", "M26,34H37"),
     ("S2", "M11,36H22"))

# Literature: a page and a quill
icon("literature",
     ("S", "M30,42H12a3.5,3.5 0 0 1 -3.5,-3.5V10.5A3.5,3.5 0 0 1 12,7H26"),
     ("S2", "M13,15H22"), ("S2", "M13,21H20"), ("S2", "M13,27H19"),
     ("TS", "M43,5C35,7 28,14 25,24L23,33L31,28C39,23 43,15 43,5Z"),
     ("S2", "M23,33L36,13"))

# Physical education: a ball
icon("pe",
     ("TS", circle(24, 24, 18)),
     ("S2", "M24,6V42"), ("S2", "M6,24H42"),
     ("S2", "M11,10C17,17 17,31 11,38"), ("S2", "M37,10C31,17 31,31 37,38"))

# Performing arts and music: two beamed notes
icon("music",
     ("TS", circle(13, 36, 4.6)), ("TS", circle(32, 32, 4.6)),
     ("S", "M17.6,36V12"), ("S", "M36.6,32V8"),
     ("F", "M17.6,12L36.6,8V14L17.6,18Z"))

# Nutrition and food technology: an apple
icon("nutrition",
     ("TS", "M24,15C20,11 8,12 8,26C8,36 15,43 20,42C22,41.5 23,41 24,41C25,41 26,41.5 28,42C33,43 40,36 40,26C40,12 28,11 24,15Z"),
     ("F", "M24,15C24,9 28,6 33,6C33,11 29,14 24,15Z"))

# Technology and design: a gear
icon("technology",
     ("TS", gear(24, 24, 19, 14.5)),
     ("S", circle(24, 24, 6)))

ORDER = list(ICONS.keys())


def svg_for(key, colour="#000000"):
    body = []
    for kind, d in ICONS[key]:
        if kind == "S":
            body.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')
        elif kind == "S2":
            body.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
        elif kind == "F":
            body.append(f'<path d="{d}" fill="{colour}"/>')
        elif kind == "FE":
            body.append(f'<path d="{d}" fill="{colour}" fill-rule="evenodd"/>')
        elif kind == "T":
            body.append(f'<path d="{d}" fill="{colour}" fill-opacity="0.3"/>')
        elif kind == "TS":
            body.append(f'<path d="{d}" fill="{colour}" fill-opacity="0.3"/>')
            body.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n  '
            + "\n  ".join(body) + "\n</svg>\n")


def xml_for(key):
    paths = []
    for kind, d in ICONS[key]:
        if kind in ("S", "S2", "TS"):
            w = "1.8" if kind == "S2" else "2.6"
            if kind == "TS":
                paths.append(f'    <path\n        android:fillColor="#FF000000"\n        android:fillAlpha="0.3"\n        android:pathData="{d}" />')
            paths.append(f'    <path\n        android:pathData="{d}"\n        android:strokeColor="#FF000000"\n        android:strokeWidth="{w}"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />')
        elif kind == "F":
            paths.append(f'    <path\n        android:fillColor="#FF000000"\n        android:pathData="{d}" />')
        elif kind == "FE":
            paths.append(f'    <path\n        android:fillColor="#FF000000"\n        android:fillType="evenOdd"\n        android:pathData="{d}" />')
        elif kind == "T":
            paths.append(f'    <path\n        android:fillColor="#FF000000"\n        android:fillAlpha="0.3"\n        android:pathData="{d}" />')
    return ('<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="48dp"\n    android:height="48dp"\n'
            '    android:viewportWidth="48"\n    android:viewportHeight="48">\n'
            + "\n".join(paths) + "\n</vector>\n")


os.makedirs(SVG_DIR, exist_ok=True)
os.makedirs(OUT_RES, exist_ok=True)
for key in ORDER:
    with open(os.path.join(SVG_DIR, f"{key}.svg"), "w") as fh:
        fh.write(svg_for(key))
    with open(os.path.join(OUT_RES, f"ic_subject_{key}.xml"), "w") as fh:
        fh.write(xml_for(key))
print("wrote", len(ORDER), "icons:", " ".join(ORDER))
