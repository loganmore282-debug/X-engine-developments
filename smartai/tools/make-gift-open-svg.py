"""Writes the opened gift box (vector, no stars, plain gold coins) that the app shows when a gift code is claimed.
   python3 tools/make-gift-open-svg.py > /tmp/gift-open.svg.html      (the markup goes into user-src/index.html as <svg class="go">)
   The geometry is the same as the closed box drawn by GB_PARTS in original_module.js, so the closed box can swell, burst and hand over to this one in place."""
import sys

def poly(pts, fill, extra=''):
    return '<path d="M' + 'L'.join('%g %g' % p for p in pts) + 'Z" fill="%s" %s/>' % (fill, extra)

LINE = 'stroke="#1c63c4" stroke-width="1.6" stroke-linejoin="round"'
parts = []
parts.append('<ellipse class="go-sh" cx="100" cy="190" rx="66" ry="11" fill="rgba(8,40,110,.28)"/>')
# back flaps, folded out behind the box (each hinged on a back edge of the opening)
parts.append('<g class="gf gf-bl">' + poly([(38,100),(100,76),(84,38),(22,62)], 'url(#gbFl)', LINE) +
             poly([(59.7,91.6),(78.3,84.4),(62.3,46.4),(43.7,53.6)], 'url(#gbRib)') + '</g>')
parts.append('<g class="gf gf-br">' + poly([(100,76),(162,100),(178,62),(116,38)], 'url(#gbFl)', LINE) +
             poly([(121.7,83.4),(140.3,90.6),(156.3,52.6),(137.7,45.4)], 'url(#gbRibD)') + '</g>')
# the inside of the box
parts.append(poly([(38,100),(100,76),(162,100),(100,124)], 'url(#gbIn)'))
parts.append(poly([(38,100),(100,76),(162,100),(100,97)], '#2f86e0', 'opacity=".5"'))
# plain gold coins (no letters), back rows first
def coin(cx, cy, rx=13.5, ry=6.8):
    t = 2.6
    return ('<ellipse cx="%g" cy="%g" rx="%g" ry="%g" fill="#b8710a"/>' % (cx, cy + t, rx, ry) +
            '<rect x="%g" y="%g" width="%g" height="%g" fill="#d9920c"/>' % (cx - rx, cy, 2 * rx, t) +
            '<ellipse cx="%g" cy="%g" rx="%g" ry="%g" fill="url(#gbCoin)" stroke="#b8710a" stroke-width=".9"/>' % (cx, cy, rx, ry) +
            '<ellipse cx="%g" cy="%g" rx="%g" ry="%g" fill="none" stroke="#fff0a0" stroke-width=".8" opacity=".85"/>' % (cx, cy, rx * .68, ry * .68) +
            '<path d="M%g %gQ%g %g %g %g" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".8"/>' % (cx - rx * .7, cy - ry * .2, cx - rx * .35, cy - ry * .85, cx + rx * .1, cy - ry * .8))
rows = [(80, [94, 106]), (86, [86, 100, 114]), (92, [78, 92, 108, 122]), (99, [70, 84, 100, 116, 130]), (106, [62, 78, 94, 110, 126, 140])]
heap = ''
for y, xs in rows:
    for x in xs:
        heap += coin(x, y)
parts.append('<g class="go-heap">' + heap + '</g>')
# the body (the same faces as the closed box)
parts.append(poly([(38,100),(100,124),(100,182),(38,158)], 'url(#gbL)'))
parts.append(poly([(100,124),(162,100),(162,158),(100,182)], 'url(#gbR)'))
parts.append(poly([(62,109.3),(78,115.5),(78,173.5),(62,167.3)], 'url(#gbRib)'))
parts.append(poly([(122,115.5),(138,109.3),(138,167.3),(122,173.5)], 'url(#gbRibD)'))
parts.append(poly([(44,106),(53,109.5),(53,153),(44,149.5)], '#fff', 'opacity=".28"'))
parts.append('<path d="M100 124V182M38 100V158L100 182L162 158V100" fill="none" stroke="#1c63c4" stroke-width="1.6" stroke-linejoin="round" opacity=".75"/>')
# front flaps, folded down and out over the top of the front faces
parts.append('<g class="gf gf-fl">' + poly([(38,100),(100,124),(86,150),(24,126)], 'url(#gbFl)', LINE) +
             poly([(59.7,108.4),(78.3,115.6),(64.3,141.6),(45.7,134.4)], 'url(#gbRib)') + '</g>')
parts.append('<g class="gf gf-fr">' + poly([(100,124),(162,100),(176,126),(114,150)], 'url(#gbFl)', LINE) +
             poly([(121.7,115.6),(140.3,108.4),(154.3,134.4),(135.7,141.6)], 'url(#gbRibD)') + '</g>')
sys.stdout.write('<svg class="go" viewBox="0 0 200 210" aria-hidden="true">' + ''.join(parts) + '</svg>')
