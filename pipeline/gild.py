#!/usr/bin/env python3
"""Make the gold version of a drawing, by arithmetic, from the white one.

WHY THIS IS NOT A CSS FILTER, which is what it was first. The promise film seven needs is
that the golden goose and the plain goose are THE SAME BIRD -- docs/03's worry was that a
separately drawn plucked goose would read as a second goose -- and the strongest way to keep
that promise is for the two to be the same drawing. A `filter:` chain does that and costs
nothing, so it was the obvious answer.

It does not work on a WHITE subject, and five rounds of tuning proved it rather than
suggesting it. sepia() preserves luminance, so a near-white bird stays near-white however
much saturate() follows; push the chroma hard enough to see it and you get a lemon rubber
duck, and hue-rotate far enough to kill the lemon and you get a traffic cone. Gold is not a
hue, it is a RAMP: brown in the shadows, amber in the mid-tones, pale cream in the
highlights. No sequence of hue and saturation operations produces that from flat white,
because the information that makes it read as metal is in the tone curve.

So: map luminance through a gold ramp and keep the alpha channel exactly. That IS the same
drawing -- same silhouette, same line, same shading, computed from the same file -- and it is
a stronger guarantee than the filter was, because film.js can assert the two PNGs have
identical alpha and a filter left nothing to check.

    python3 pipeline/gild.py cast/goose/goose-body.png films/x/sprites/feather.png

writes <name>-gold.png beside each. Deterministic, so a rebuild is byte-identical.
"""
import sys, os
from PIL import Image

# shadow -> highlight. Warm brown, amber, pale cream: the tone curve is what reads as gold.
# The top of the ramp is GOLD, not cream, and that is the whole calibration. A cartoonwhite 
# subject is drawn almost entirely between L 0.88 and L 1.0 -- the body is one flat white
# with a hair of shading -- so a ramp that only turns gold in the mid-tones leaves the bird
# pale and the film's central object looking like a pale duck. Everything above L 0.8 has to
# already be metal, with only the drawn highlights lifting toward cream.
RAMP = [(0.00, (46, 28, 6)), (0.35, (122, 79, 14)), (0.60, (176, 124, 26)),
        (0.80, (214, 164, 44)), (0.93, (238, 196, 78)), (1.00, (250, 222, 126))]


def gold(l):
    for i in range(len(RAMP) - 1):
        a, ca = RAMP[i]
        b, cb = RAMP[i + 1]
        if l <= b:
            t = 0 if b == a else (l - a) / (b - a)
            return tuple(round(ca[k] + (cb[k] - ca[k]) * t) for k in range(3))
    return RAMP[-1][1]


LUT = [gold(i / 255) for i in range(256)]


def gild(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            # Rec.709 luma, so the drawing's own shading survives the recolour
            px[x, y] = LUT[min(255, int(0.2126 * r + 0.7152 * g + 0.0722 * b))] + (a,)
    out = path[:-4] + '-gold.png'
    im.save(out)
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        if not os.path.exists(p):
            sys.exit('no such file: ' + p)
        print('  ' + gild(p))
