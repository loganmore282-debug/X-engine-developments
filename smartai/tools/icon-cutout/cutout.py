"""Cut a baked-background icon PNG out to a clean transparent PNG.

usage: python3 cutout.py <src_dir> <out_dir> [name ...]    (run survey.py on the same pack first)

Every source icon sits on a smooth light halo plus a faint leftover rectangle with a little noise.
Both are smooth (no edges). The icons themselves have crisp outlines, even the white-on-white ones.
Plan:
  1. smooth + measure edge strength (Lab)
  2. the page = everything reachable from the picture border without crossing an edge (flood)
  3. icon = what the flood could not reach (enclosed white bodies stay in), speck + hole cleanup
  4. narrow trimap around the outline -> closed-form matting -> alpha + decontaminated colours
  5. the soft blue glow under some icons is kept, but only where it is really blue
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
import numpy as np
import cv2
from scipy import ndimage as ndi
from pymatting import estimate_alpha_cf, estimate_foreground_ml

def load(path):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

def lab_of(rgb):
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)

def edge_strength(lab, sigma):
    g = cv2.GaussianBlur(lab, (0, 0), sigma)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    return np.sqrt((gx ** 2 + gy ** 2).sum(axis=2)), g

def page_reference(g):
    fr = np.concatenate([g[:6].reshape(-1, 3), g[-6:].reshape(-1, 3), g[:, :6].reshape(-1, 3), g[:, -6:].reshape(-1, 3)])
    return np.median(fr, axis=0)

_MODE = None
def page_mode():
    """The shared page picture: every icon was pasted on the same synthetic halo, so the per-pixel mode over all
    35 icons is exactly the halo wherever the icons' own little tile does not reach (saved by the survey step)."""
    global _MODE
    if _MODE is None:
        _MODE = np.load(os.path.join(HERE, 'mode_rgb.npy'))
    return _MODE

def tile_mask(rgb):
    """True where the picture differs from the shared halo at all = the icon + its leftover tile."""
    d = np.abs(rgb.astype(np.int16) - page_mode().astype(np.int16)).max(axis=2)
    return d >= 1

def exterior_mask(grad, grad_t, rgb=None, ring=6):
    seeds_extra = None
    if rgb is not None:
        T = tile_mask(rgb)
        T = ndi.binary_opening(T, structure=np.ones((3, 3)), iterations=1) | ndi.binary_dilation(T, iterations=0)
        outside = ~T
        # the tile's own border is not an edge of the icon: let the flood cross it
        near = ndi.distance_transform_edt(~outside) <= ring
        grad = np.where(near, 0.0, grad)
        seeds_extra = outside
    cand = grad < grad_t
    if seeds_extra is not None:
        cand = cand | seeds_extra
    lab_, n = ndi.label(cand)
    ids = np.unique(np.concatenate([lab_[0], lab_[-1], lab_[:, 0], lab_[:, -1]]))
    if seeds_extra is not None:
        ids = np.union1d(ids, np.unique(lab_[seeds_extra]))
    ids = ids[ids != 0]
    return np.isin(lab_, ids)

def clean_fg(fg, min_frac):
    lab_, n = ndi.label(fg)
    if n == 0:
        return fg
    sizes = ndi.sum(fg, lab_, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= fg.size * min_frac
    fg = keep[lab_]
    fg = ndi.binary_fill_holes(fg)
    fg = ndi.binary_closing(fg, structure=np.ones((3, 3)), iterations=2)
    fg = ndi.binary_fill_holes(fg)
    return fg

def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / float(hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def smooth_mask(fg, sigma=2.0, trim=0):
    f = cv2.GaussianBlur(fg.astype(np.float32), (0, 0), sigma)
    m = f > 0.5
    if trim > 0:
        m = cv2.erode(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * trim + 1, 2 * trim + 1))).astype(bool)
    return m

def apply_hints(fg, hints):
    """hints = {'add': [polygon, ...], 'remove': [polygon, ...]}, polygons in 512 px picture coordinates"""
    if not hints:
        return fg
    out = fg.copy().astype(np.uint8)
    if hints.get('replace'):
        out[:] = 0
        for poly in hints['replace']:
            cv2.fillPoly(out, [np.array(poly, np.int32)], 1)
    for poly in hints.get('add', []):
        cv2.fillPoly(out, [np.array(poly, np.int32)], 1)
    for poly in hints.get('remove', []):
        cv2.fillPoly(out, [np.array(poly, np.int32)], 0)
    return out.astype(bool)

def cut(rgb, grad_t=0.5, sigma=2.0, band=2, min_frac=0.004, smooth=3.0, trim=1, hints=None, feather=0.0, open_r=3, close_r=5):
    lab = lab_of(rgb)
    grad, g = edge_strength(lab, sigma)
    ext = exterior_mask(grad, grad_t, rgb)
    fg = clean_fg(~ext, min_frac)
    fg = apply_hints(fg, hints)
    fg = clean_fg(fg, min_frac)
    if open_r > 0:
        # thin slivers (a leftover tile edge touching the icon) are not part of any icon
        fg = ndi.binary_opening(fg, structure=cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * open_r + 1, 2 * open_r + 1)).astype(bool))
        fg = clean_fg(fg, min_frac)
    if close_r > 0:
        # narrow slits (a gap of leftover page between two parts of one icon) are filled
        pad = close_r + 2
        padded = np.pad(fg, pad)
        padded = ndi.binary_closing(padded, structure=cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * close_r + 1, 2 * close_r + 1)).astype(bool))
        fg = padded[pad:-pad, pad:-pad]
        fg = ndi.binary_fill_holes(fg)
    fg = smooth_mask(fg, smooth, trim)
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    fgu = fg.astype(np.uint8)
    sure_fg = cv2.erode(fgu, k(band)).astype(bool)
    near = cv2.dilate(fgu, k(band)).astype(bool)
    tri = np.zeros(fg.shape, np.float64)
    tri[near] = 0.5
    tri[sure_fg] = 1.0
    img = rgb.astype(np.float64) / 255.0
    alpha = np.clip(estimate_alpha_cf(img, tri), 0, 1)
    alpha[~near] = 0.0
    core = cv2.erode(fgu, k(1)).astype(bool)
    alpha[core] = 1.0
    if feather > 0:
        alpha = np.clip(cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), feather), 0, 1).astype(np.float64)
        alpha[~near] = np.minimum(alpha[~near], 0.0)
    fgc = estimate_foreground_ml(img, alpha)
    return fg, tri, alpha, fgc

def to_rgba(fgc, alpha):
    a = alpha.copy()
    a[a < 0.02] = 0
    a[a > 0.985] = 1
    out = np.dstack([np.clip(fgc, 0, 1), a])
    return (out * 255 + 0.5).astype(np.uint8)

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    import json
    hp = os.path.join(HERE, 'hints.json')
    HINTS = json.load(open(hp)) if os.path.exists(hp) else {}
    names = sys.argv[3:] or [f[:-4] for f in sorted(os.listdir(src)) if f.endswith('.png')]
    for n in names:
        rgb = load(os.path.join(src, n + '.png'))
        fg, tri, alpha, fgc = cut(rgb, hints=HINTS.get(n))
        rgba = to_rgba(fgc, alpha)
        cv2.imwrite(os.path.join(out, n + '.png'), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
        cv2.imwrite(os.path.join(out, n + '.mask.png'), (fg * 255).astype(np.uint8))
        print(n, 'fg%', round(100 * fg.mean(), 1), flush=True)
