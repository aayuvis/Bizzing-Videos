# Local shot rendering — the deterministic path

## Why this exists

`tools/veo-story.py` asks a model to imagine eight seconds. It has no model of the scene,
so **"both geese are holding the stick" can be requested but never guaranteed** — every
generation is a fresh sample. Four rounds of increasingly precise prompting, a character
model sheet, a continuity block and both endpoints pinned all reduced the failure rate and
none of them removed it. The last surviving fault was the first one reported: the geese
letting go of the stick.

Here the stick is between the beaks because a stylesheet puts it there. It cannot be
otherwise, in any frame, on any run.

## How it works

1. **Sprites** — characters cut out once, on transparent ground (`sprite-*.png` → keyed by
   `cut()`, an edge flood-fill rather than a white threshold, so the eye highlights and the
   bird's white body survive).
2. **Plates** — backgrounds with *no characters in them*, generated once per location.
3. **A rig** — one HTML file per shot. Geese, stick and tortoise are a single group, so the
   contact between them cannot break no matter how the group moves.
4. **Measured geometry** — the beak tip is found in the sprite by colour, and the stick's
   endpoints are computed from it. Change the sprite and the numbers follow. Nothing is
   eyeballed, and "the stick reaches both beaks" is arithmetic that can be asserted in a
   test rather than checked by watching.
5. **A driven clock** — `render.js` pauses every CSS animation and steps `currentTime` to an
   exact value per frame. No sleeping, no dropped frames, byte-identical on every run.

```bash
node tools/anim/render.js tools/anim/shot-fly.html out/ 4     # 4s at 24fps
```

## What it costs

| | Veo path | this path |
| --- | --- | --- |
| First build of a shot | 1 video generation | 1 plate + sprites, shared across shots |
| **Re-render after a note** | **another video generation** | **zero — seconds, locally** |
| Result is repeatable | no | yes, byte for byte |
| "Both geese hold the stick" | requested | guaranteed |

The expensive part of the Veo path was never one clip; it was that *every note meant
re-rolling the dice on all sixteen*, and a re-roll could introduce a new fault while fixing
the old one. Here a note is a number in a stylesheet.

## What it does not do yet

Honest gap: the sprites are placeholders taken from the sticker set and one generated pose.
To match the polish of the generated shots this needs a proper sprite set drawn for
animation — a tortoise drawn *hanging with his jaws closed on a stick*, and two or three
wing positions per bird to flap between instead of rotating the whole body. That is a
one-time art cost, not a per-iteration one, and it is the only thing standing between this
and finished.
