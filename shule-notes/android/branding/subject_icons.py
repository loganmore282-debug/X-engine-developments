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


def arc_to(p, m, q, r):
    """SVG arc command from the current point p to q, passing through m, on a circle of radius r."""
    cross = (m[0] - p[0]) * (q[1] - m[1]) - (m[1] - p[1]) * (q[0] - m[0])
    sweep = 1 if cross > 0 else 0
    chord = (q[0] - p[0], q[1] - p[1])
    # centre of the circle through p and q with radius r, on the same side of the chord as m for a major arc
    mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    d = math.hypot(*chord)
    h = math.sqrt(max(r * r - (d / 2) ** 2, 0))
    nx, ny = -chord[1] / d, chord[0] / d
    best = None
    for sign in (1, -1):
        c = (mid[0] + sign * h * nx, mid[1] + sign * h * ny)
        if best is None or abs(math.hypot(m[0] - c[0], m[1] - c[1]) - r) < abs(math.hypot(m[0] - best[0], m[1] - best[1]) - r):
            best = c
    c = best
    side = lambda a: chord[0] * (a[1] - p[1]) - chord[1] * (a[0] - p[0])
    large = 1 if side(m) * side(c) > 0 else 0
    return f"A{f(r)},{f(r)} 0 {large} {sweep} {f(q[0])},{f(q[1])}"


def crescent(c1, r1, c2, r2):
    """The part of circle 1 not covered by circle 2, as one closed path."""
    dx, dy = c2[0] - c1[0], c2[1] - c1[1]
    d = math.hypot(dx, dy)
    a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    h = math.sqrt(r1 * r1 - a * a)
    mx, my = c1[0] + a * dx / d, c1[1] + a * dy / d
    p = (mx + h * dy / d, my - h * dx / d)
    q = (mx - h * dy / d, my + h * dx / d)
    away = (c1[0] - r1 * dx / d, c1[1] - r1 * dy / d)       # outer arc: the side of circle 1 away from circle 2
    inner = (c2[0] - r2 * dx / d, c2[1] - r2 * dy / d)       # inner arc: the side of circle 2 facing circle 1
    return f"M{f(p[0])},{f(p[1])}" + arc_to(p, away, q, r1) + arc_to(q, inner, p, r2) + "Z"


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

# Chemistry: a benzene ring with two attached atoms
_R = 12.5
_hx = [(24 + _R * math.cos(math.radians(-90 + 60 * i)), 25 + _R * math.sin(math.radians(-90 + 60 * i))) for i in range(6)]


def _inner(i, j):
    (x1, y1), (x2, y2) = _hx[i], _hx[j]
    k = 0.26
    a = (x1 + (24 - x1) * k, y1 + (25 - y1) * k)
    b = (x2 + (24 - x2) * k, y2 + (25 - y2) * k)
    ex, ey = b[0] - a[0], b[1] - a[1]
    return line(a[0] + ex * 0.16, a[1] + ey * 0.16, b[0] - ex * 0.16, b[1] - ey * 0.16)


def _out(i, length):
    a = math.radians(-90 + 60 * i)
    return (_hx[i][0] + length * math.cos(a), _hx[i][1] + length * math.sin(a))


_atom1, _atom2 = _out(1, 8.6), _out(4, 8.6)
icon("chemistry",
     ("TS", poly(_hx)),
     ("S2", _inner(1, 2)), ("S2", _inner(3, 4)), ("S2", _inner(5, 0)),
     ("S", line(_hx[1][0], _hx[1][1], *_out(1, 5.2))), ("TS", circle(_atom1[0], _atom1[1], 3.4)),
     ("S", line(_hx[4][0], _hx[4][1], *_out(4, 5.2))), ("TS", circle(_atom2[0], _atom2[1], 3.4)))

# Physics: an atom
icon("physics",
     ("S", ellipse(24, 24, 18, 7, 0)),
     ("S", ellipse(24, 24, 18, 7, 60)),
     ("S", ellipse(24, 24, 18, 7, 120)),
     ("F", circle(24, 24, 3.8)),
     ("F", circle(42, 24, 3)),
     ("F", circle(15, 8.41, 3)),
     ("F", circle(15, 39.59, 3)))

# Biology: a microscope
def rot_rect(cx, cy, w, h, deg):
    t = math.radians(deg)
    ct, st = math.cos(t), math.sin(t)
    return poly([(cx + x * ct - y * st, cy + x * st + y * ct) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))])


def _along(cx, cy, deg, d):
    t = math.radians(deg)
    return cx - d * math.sin(t), cy + d * math.cos(t)


_tilt_deg = -25
_tube_c = (22.5, 17.5)
_obj_c = _along(*_tube_c, _tilt_deg, 13.4)
_eye_c = _along(*_tube_c, _tilt_deg, -11.8)
icon("biology",
     ("TS", rrect(9, 39, 30, 5, 2.5)),
     ("S", "M27,15.8C42,15 45.5,32 35,39"),
     ("TS", rot_rect(_tube_c[0], _tube_c[1], 9, 19, _tilt_deg)),
     ("S", line(*_along(*_tube_c, _tilt_deg, 9.5), *_along(*_tube_c, _tilt_deg, 15))),
     ("S", line(_eye_c[0] - 3.6 * math.cos(math.radians(_tilt_deg)), _eye_c[1] - 3.6 * math.sin(math.radians(_tilt_deg)),
                _eye_c[0] + 3.6 * math.cos(math.radians(_tilt_deg)), _eye_c[1] + 3.6 * math.sin(math.radians(_tilt_deg)))),
     ("S", "M10,34H29"))

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
     ("TS", "M12,41V37.5A8.5,8.5 0 0 1 20.5,29H27.5A8.5,8.5 0 0 1 36,37.5V41Z"),
     ("TS", circle(24, 18.5, 6)),
     ("S", circle(9.5, 21, 4.2)), ("S", "M4,38V35A6,6 0 0 1 10,29H10.5"),
     ("S", circle(38.5, 21, 4.2)), ("S", "M44,38V35A6,6 0 0 0 38,29H37.5"))

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
    _rays.append(("S", line(24 + 8.5 * math.cos(a), 16 + 8.5 * math.sin(a), 24 + 12 * math.cos(a), 16 + 12 * math.sin(a))))
icon("religion",
     ("F", circle(24, 16, 4.2)),
     *_rays,
     ("TS", "M5,31C12,28 20,29 24,32C28,29 36,28 43,31V43C36,40 28,41 24,44C20,41 12,40 5,43Z"),
     ("S2", "M24,32V44"))

# Christian religious education: a book with a cross
icon("christian",
     ("TS", rrect(10, 5, 28, 38, 3.5)),
     ("S2", "M16,5V43"),
     ("S", "M27,14V31"),
     ("S", "M20.5,20H33.5"))

# Islamic religious education: a crescent and star
icon("islam",
     ("TS", crescent((23, 25), 17.5, (31, 20.5), 14)),
     ("F", star(36.8, 17.6, 6, 2.6)))

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

# Physical education: a basketball
_pe = lambda deg: (24 + 18 * math.cos(math.radians(deg)), 24 + 18 * math.sin(math.radians(deg)))
icon("pe",
     ("TS", circle(24, 24, 18)),
     ("S2", "M24,6V42"), ("S2", "M6,24H42"),
     ("S2", f"M{f(_pe(140)[0])},{f(_pe(140)[1])}Q{f(24 - 2)},24 {f(_pe(220)[0])},{f(_pe(220)[1])}"),
     ("S2", f"M{f(_pe(40)[0])},{f(_pe(40)[1])}Q{f(24 + 2)},24 {f(_pe(320)[0])},{f(_pe(320)[1])}"))

# Performing arts and music: two beamed notes
icon("music",
     ("TS", circle(13, 36, 4.6)), ("TS", circle(32, 32, 4.6)),
     ("S", "M17.6,36V12"), ("S", "M36.6,32V8"),
     ("F", "M17.6,12L36.6,8V14L17.6,18Z"))

# Nutrition and food technology: an apple
icon("nutrition",
     ("TS", "M24,16C20,12 7,12.5 7,27C7,37 15,44 20.5,43C22.5,42.5 23.5,42 24,42C24.5,42 25.5,42.5 27.5,43C33,44 41,37 41,27C41,12.5 28,12 24,16Z"),
     ("S2", "M13,27C13,23 14.8,20 17.5,18.8"),
     ("TS", "M24.5,15C24.5,9 28.5,5 34.5,5C34.5,11 30.5,14.5 24.5,15Z"))

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
