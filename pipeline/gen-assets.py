#!/usr/bin/env python3
"""Generate the one-time asset library: character sprites and character-free plates.

THIS RUNS ONCE PER STORY, not once per revision. Everything downstream -- every shot,
every re-cut after a note, every future episode that reuses a character -- costs nothing.
Across the whole library there are only 69 distinct cast members in 323 stories, so this
library is the fixed cost of the entire channel, not of one film.

Sprites come back on flat white and are keyed by an EDGE FLOOD FILL rather than a white
threshold: the tortoise's eye highlights and the bird's own white body are near-white too,
and a global threshold punches holes through both.
"""
import base64, json, os, sys, urllib.request, urllib.error
from collections import deque
from PIL import Image

# WHICH FILM, and where the app it is drawn from lives. Everything below is read out of
# films/<story>/assets.json, so the generator carries no knowledge of any particular story
# -- which is the whole test of whether this scales past the first one.
from sources import STORY, FILM, REPO, painting

API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent'
CFG = json.load(open(os.path.join(FILM, 'assets.json'), encoding='utf-8'))
SCENES = json.load(open(os.path.join(FILM, 'scenes.json'), encoding='utf-8'))
CAST = SCENES.get('cast', [])          # scenes.json owns the cast list; nothing else repeats it
SHEET = os.path.join(FILM, 'charsheet.png')
PAINT = painting(STORY)

STYLE = ("Flat cel shading, thick soft warm-brown outlines, light paper grain, the warm "
         "marigold-and-gold palette of the reference images. Children's picture-book cartoon.")

SPRITE_TAIL = (" Draw the character ALONE, centred and complete with nothing cropped, on a "
               "COMPLETELY FLAT PURE WHITE background (#FFFFFF). NO shadow, NO glow, NO halo, "
               "NO circle, NO sparkles, NO ground, NO scenery, NO text. This is a cut-out "
               "sprite sheet cell. " + STYLE)

# PARTS, NOT POSES. The first pass asked for a standing goose, a wings-up goose and a
# wings-down goose, and got three different birds -- which is the same drift that ruined
# four rounds of video, reappearing in the asset library. Asking a model to draw the same
# character twice is the mistake; it will never be the same twice.
#
# Cut-out animation does not ask twice. It draws the bird ONCE, cuts the wing off, and
# poses it by rotating the wing around a shoulder pivot. The body is then byte-identical
# in every frame of every shot of every film, and both geese in a shot are the SAME FILE
# mirrored, so they cannot differ from each other either.
#
# So: one body cell and one wing cell per bird. The flap is arithmetic.
PLATE_TAIL = (" A BACKGROUND PLATE for a cartoon: NO ANIMALS and NO BIRDS anywhere in the picture, "
              "and none of the story's characters. "
              "No text, no border, no frame. " + STYLE)

def gen(prompt, out, ar, canon=None):
    key = os.environ.get('GEMKEY') or sys.exit('GEMKEY is not set')
    def inline(p):
        m = 'image/png' if p.endswith('.png') else 'image/jpeg'
        return {'inline_data': {'mime_type': m,
                                'data': base64.b64encode(open(p, 'rb').read()).decode()}}
    refs = [inline(SHEET), inline(PAINT)]
    if canon and os.path.exists(canon):
        refs.append(inline(canon))
        prompt = ("The LAST reference image is the CANONICAL DRAWING of this character in "
                  "this film: match its exact colours, shapes and proportions -- the same "
                  "shell colour, the same body colour, the same eyes, the same beak and legs. "
                  "It outranks every other reference.\n\n") + prompt
    body = {'contents': [{'role': 'user', 'parts': refs + [{'text': prompt}]}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'],
                                 'imageConfig': {'aspectRatio': ar}}}
    req = urllib.request.Request(API, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json',
                                          'x-goog-api-key': key})
    # A fifteen-asset batch WILL meet a 503 somewhere. Losing the whole run to one
    # transient upstream hiccup -- and the assets already paid for in it -- is the
    # avoidable half of what made the last approach expensive.
    import time
    for attempt in range(5):
        try:
            d = json.load(urllib.request.urlopen(req, timeout=240))
            break
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 4:
                print('      HTTP %d %s' % (e.code, e.read().decode()[:120]))
                return False
            time.sleep(3 * (attempt + 1))
        except Exception as e:
            if attempt == 4:
                print('      %s' % str(e)[:120]); return False
            time.sleep(3 * (attempt + 1))
    else:
        return False
    for c in d.get('candidates', []):
        for p in c.get('content', {}).get('parts', []):
            if 'inlineData' in p:
                open(out, 'wb').write(base64.b64decode(p['inlineData']['data']))
                return True
    return False


def key_out(path, tol=26):
    """Clear white CONNECTED TO THE EDGE, then crop to the ink."""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque([(x, y) for x in range(w) for y in (0, h - 1)] +
              [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        r, g, b, a = px[x, y]
        if r < 255 - tol or g < 255 - tol or b < 255 - tol:
            continue
        seen[i] = 1
        px[x, y] = (r, g, b, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    box = im.getchannel('A').getbbox()
    im.crop(box).save(path)
    return im.crop(box).size


def draw(name, prompt, out, canon, only, force, ar='1:1'):
    if only and name not in only:
        return
    if os.path.exists(out) and not force:
        print('  %-16s cached' % name)
        return
    ok = gen(prompt + (SPRITE_TAIL if ar == '1:1' else PLATE_TAIL), out, ar, canon)
    print('  %-16s %s  %s' % (name, 'drawn' if ok else 'FAILED', key_out(out) if ok and ar == '1:1' else ''))


def main(argv):
    only = set(a for a in argv if not a.startswith('-'))
    force = '--force' in argv

    # THE CAST FIRST, and only the cells that are missing. A character is drawn once for the
    # whole channel (docs/02 §7): a film that reuses an existing character pays nothing here,
    # which is the entire point of cast/ existing. `cached` on every line is the good outcome.
    for char in CAST:
        cdir = os.path.join(REPO, 'cast', char)
        cfile = os.path.join(cdir, 'cast.json')
        if not os.path.exists(cfile):
            sys.exit('scenes.json names cast "%s" but %s does not exist.\n'
                     'A new character needs cast/%s/cast.json with its cells and a canon.'
                     % (char, cfile, char))
        cj = json.load(open(cfile, encoding='utf-8'))
        canon_name = cj.get('canon')
        cells = cj['cells']
        # CANON FIRST, ALWAYS. Every other cell is drawn with it as an overriding reference
        # (docs/02 §5.1) -- generating them in dict order once produced a cast that drifted.
        order = ([canon_name] if canon_name in cells else []) + \
                [k for k in cells if k != canon_name]
        print('cast/%s' % char)
        for name in order:
            canon = os.path.join(cdir, canon_name + '.png') if canon_name and name != canon_name else None
            draw(name, cells[name], os.path.join(cdir, name + '.png'), canon, only, force)

    # then anything that belongs to this film alone -- a prop, a one-off
    if CFG.get('sprites'):
        print('films/%s/sprites' % STORY)
        os.makedirs(os.path.join(FILM, 'sprites'), exist_ok=True)
        for name, desc in CFG['sprites'].items():
            c = CFG.get('canon', {}).get(name.split('-')[0])
            c = os.path.join(FILM, 'sprites', c + '.png') if c and c != name else None
            draw(name, desc, os.path.join(FILM, 'sprites', name + '.png'), c, only, force)

    print('films/%s/plates' % STORY)
    os.makedirs(os.path.join(FILM, 'plates'), exist_ok=True)
    for name, desc in CFG['plates'].items():
        draw(name, desc, os.path.join(FILM, 'plates', name + '.png'), None, only, force, ar='16:9')


if __name__ == '__main__':
    main(sys.argv[1:])
