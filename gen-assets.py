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

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'anim')
API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent'
SHEET = os.path.join(ROOT, 'build', 'video', 'frames', 'charsheet.png')
PAINT = os.path.join(ROOT, 'app', 'art', 'story', 'pt-talkative-tortoise.jpg')

STYLE = ("Flat cel shading, thick soft warm-brown outlines, light paper grain, the warm "
         "marigold-and-gold palette of the reference images. Children's picture-book cartoon.")

SPRITE_TAIL = (" Draw the character ALONE, centred and complete with nothing cropped, on a "
               "COMPLETELY FLAT PURE WHITE background (#FFFFFF). NO shadow, NO glow, NO halo, "
               "NO circle, NO sparkles, NO ground, NO scenery, NO text. This is a cut-out "
               "sprite sheet cell. " + STYLE)

SPRITES = {
  'tortoise-talk':  "The green tortoise from the reference sheet, FULL BODY, standing on all fours in "
                    "three-quarter view, mouth OPEN mid-chatter, one front paw lifted and gesturing, "
                    "eyes bright and happy.",
  'tortoise-idea':  "The green tortoise from the reference sheet, FULL BODY, up on his back legs with "
                    "both front paws raised high in the air, eyes wide and delighted, mouth open in a "
                    "happy grin.",
  'tortoise-hang':  "The green tortoise from the reference sheet, FULL BODY, seen from the FRONT, "
                    "hanging in the air with all four legs dangling straight down and loose, head up, "
                    "mouth CLOSED in a firm straight line as if gripping something, eyes calm and wide. "
                    "Nothing in his mouth -- draw the mouth closed and empty.",
  'tortoise-cross': "The green tortoise from the reference sheet, FULL BODY, seen from the FRONT, "
                    "hanging with legs dangling loose, mouth CLOSED in a firm line, but eyes NARROWED "
                    "with indignation and cheeks flushed a deep hot pink. Face still round and soft, "
                    "no teeth, not ugly.",
  'tortoise-shout': "The green tortoise from the reference sheet, FULL BODY, seen from the FRONT, "
                    "tumbling in the air with legs splayed, mouth WIDE OPEN in a shout, eyes wide with "
                    "alarm. Not smiling. No teeth visible, no fangs -- a soft round open mouth.",
  'tortoise-sit':   "The green tortoise from the reference sheet, FULL BODY, sitting calmly in "
                    "three-quarter view, mouth closed in a small gentle smile, eyes soft.",
  'goose-stand':    "ONE white bird from the reference sheet, FULL BODY, STANDING on both orange legs "
                    "in side profile facing LEFT, wings folded neatly against its body, head up.",
  'goose-up':       "ONE white bird from the reference sheet, FULL BODY, FLYING in side profile facing "
                    "LEFT, both wings raised HIGH above its back at the top of a wingbeat, legs tucked "
                    "back and trailing.",
  'goose-down':     "ONE white bird from the reference sheet, FULL BODY, FLYING in side profile facing "
                    "LEFT, both wings swept DOWN and forward at the bottom of a wingbeat, legs tucked "
                    "back and trailing.",
}

PLATE_TAIL = (" A BACKGROUND PLATE for a cartoon: ABSOLUTELY NO ANIMALS, NO BIRDS, NO PEOPLE and NO "
              "CHARACTERS of any kind anywhere in the picture -- an empty landscape only. "
              "No text, no border, no frame. " + STYLE)

PLATES = {
  'lake-full':   "A round blue lake ringed with green reeds and small white flowers, a flat warm stone "
                 "at the near shore, dusty green fields beyond and a low pink-sandstone walled town far "
                 "on the horizon under an ochre and marigold sky with sunburst rays.",
  'lake-dry':    "The same lake bed after a failed monsoon: shrunk to one small brown puddle in a wide "
                 "plain of cracked dry mud, the reeds yellow and bent, the flat stone bare, the same "
                 "pink-sandstone town small on the horizon under a hot pale sky. Dust in the air.",
  'sky-gold':    "An empty warm sky filling the whole frame -- marigold and gold with a soft sunburst "
                 "and a few cream clouds, and only a thin strip of distant hills along the very bottom.",
  'fields-air':  "A high aerial view over sunlit Rajasthan: patchwork green and gold fields, a winding "
                 "dust road, scattered mango trees, and a low pink-sandstone walled town on the horizon "
                 "under an ochre sky with sunburst rays.",
  'village-air': "A high aerial view looking down a small sunlit village street: terracotta rooftops, a "
                 "big neem tree, a stone well, mud-brick walls, the dust road running away towards a "
                 "pink-sandstone walled town on the horizon. Warm marigold light. The street is EMPTY.",
  'lake-night':  "The same round lake full of blue water again at night: green reeds, a flat empty stone "
                 "on the near shore, the pink-sandstone town dark on the horizon, and a deep indigo sky "
                 "with the last gold of sunset low down and the first stars out.",
}


# THE CANONICAL SPRITE. The first pass drew a white goose twice and a yellow-and-blue
# goose once, and gave the tortoise a brown shell in some cells and a green one in others.
# That is the same drift as before -- except here it is a ONE-TIME defect in an asset, not
# a defect that recurs in every shot of every film. Fix the cell once and 500 videos are
# fixed with it.
#
# The fix is to give each new cell the cell that is already RIGHT, as a reference. A model
# matching one specific drawing is far steadier than a model matching a description.
CANON = {'goose': 'goose-up', 'tortoise': 'tortoise-sit'}


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


def main(argv):
    only = set(a for a in argv if not a.startswith('-'))
    force = '--force' in argv
    for name, desc in SPRITES.items():
        if only and name not in only:
            continue
        out = os.path.join(HERE, 'sprites', name + '.png')
        if os.path.exists(out) and not force:
            print('  %-16s cached' % name); continue
        canon = CANON.get(name.split('-')[0])
        canon = os.path.join(HERE, 'sprites', canon + '.png') if canon and canon != name else None
        ok = gen(desc + SPRITE_TAIL, out, '1:1', canon)
        print('  %-16s %s  %s' % (name, 'drawn' if ok else 'FAILED',
                                  key_out(out) if ok else ''))
    for name, desc in PLATES.items():
        if only and name not in only:
            continue
        out = os.path.join(HERE, 'plates', name + '.png')
        if os.path.exists(out) and not force:
            print('  %-16s cached' % name); continue
        ok = gen(desc + PLATE_TAIL, out, '16:9')
        print('  %-16s %s' % (name, 'drawn' if ok else 'FAILED'))


if __name__ == '__main__':
    main(sys.argv[1:])
