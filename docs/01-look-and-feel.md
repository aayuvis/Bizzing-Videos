# 01 — The Bizzing India channel: look, feel, and how an episode is made

**Status:** binding for every video published under the Bizzing India name.
Episodes: *The Tortoise Who Had to Have the Last Word* (`pt.talkative-tortoise`) and
*The Monkey Who Kept His Heart in a Tree* (`pt.monkey-crocodile`).
Pipeline: [`pipeline/`](../pipeline/) — [docs/02](02-production-brief.md) is how it works and
why it is built that way.

> **Read this first.** Much of this document was written during the **generative-video pass**,
> and that pipeline is **retired** — see docs/02 §0 and §1, and do not run
> `archive/veo-story.py`. The look, the palette, the editorial rules and the publishing
> section are unchanged and binding. The passages about prompting a video model are kept, and
> marked, because the rules everything else follows were paid for in them.

---

## 0. The one rule

**Nothing on the channel is invented for the channel.**

A child who watches a Bizzing India video and then opens the app must meet the *same*
tortoise, hear the *same* voice reading the *same* sentences, and recognise the *same*
country out of the window. If the video has a better tortoise than the app, the video is
wrong — go and fix the app.

That is not brand tidiness. It is the whole proposition: the videos are a doorway, and a
doorway that opens onto a different building is a trick.

So every episode is assembled out of things the app already holds:

| On screen / in the ear | Comes from | Never |
| --- | --- | --- |
| The words | `app/data-stories.js`, verbatim | Re-written "for video" |
| The voice | `app/voice/st/<slug>-*.mp3` | Re-synthesised, or a second narrator |
| The faces | one model sheet per film, then a sprite drawn once and reused in every shot | Described in words and hoped for |
| The world | `app/art/story/<slug>.jpg` — the story's own painting | A generic "Indian village" prompt |
| The palette | `app/tokens.css` | Picked by eye per episode |

Nothing in the pipeline synthesises audio, and nothing will: the channel and the app have one
voice between them. (The retired generative pass produced its own audio track and it was
discarded, for the same reason.)

---

## 1. The look, in one paragraph

> Children's picture-book cartoon for four- to eight-year-olds. Round soft bodies, very
> large dark-brown eyes with a single bright highlight, small pink blush ovals on the
> cheeks, thick soft brown outlines, no visible teeth. Flat cel shading over a light paper
> grain. Sun-warmed Rajasthan: an ochre and gold sky with sunburst rays, dusty green
> fields, a small pink-sandstone walled town far on the horizon. Generous negative space.
> No frame, no border, no text in the picture.

This paragraph lives in `STYLE` in [`pipeline/gen-assets.py`](../pipeline/gen-assets.py) and
is appended to every sprite and plate prompt. **A whole film comes out of one art department,
not one per shot.** Change a word there and every asset changes with it, which is exactly what
you want; do not hand-tune one sprite's prompt to fix a look problem that belongs to all of
them.

### The palette

Straight off `app/tokens.css` — the same five values the app paints itself with:

| | | |
| --- | --- | --- |
| `#e9a13b` | marigold | sky, light, the warm ground of nearly every frame |
| `#d94f3d` | vermilion | accents, cloth, the sandstone town |
| `#5b3fd6` | indigo-violet | night, deep shadow, the last frame's sky |
| sage green | | fields, reeds, the tortoise himself |
| cream | | paper, negative space, air |

### The cast

They are not described from memory. Every film has a **model sheet** —
`films/<story>/charsheet.png`, the cast together on one ground line at true relative scale —
and it goes in as a reference image on every asset call, alongside the story's own painting.
Check the sheet by eye before anything else: it is the one image everything else is measured
against.

Character drift was the failure mode of the whole generative technique — by shot nine you had
a different tortoise, and nobody noticed until it was cut together. Two things kill it here.
First, a character is drawn **once** and reused in every shot, so there is no shot nine to
drift in. Second, the **canonical cell**: generate one sprite for a character, check it, then
pass it on every subsequent call for that character with *"match this drawing exactly; it
outranks every other reference"* — that is the `canon` map in `assets.json`. A model matching
one specific drawing is far steadier than one matching a description, and on episode two it
produced a consistent cast first time.

### What is deliberately *not* copied

The app's story painting (`app/art/story/pt-talkative-tortoise.jpg`) is a Mughal-miniature
plate: fine stipple, an ornate blue-and-gold border, an adult's picture. It is the source
of the **palette, the light and the landscape** — and of nothing else. The *characters*
come from the sticker set, which is already a kids' cartoon.

**Titles never dim the whole frame.** The scrim behind the opening title is baked into
the title PNG as a gradient over the top 46% of the picture, not applied in ffmpeg as a
full-frame `drawbox`. Dimming everything to make lettering legible dims the characters
too, and on a film this warm that reads as a colour-grade mistake rather than a design.

**Never put the ornamental border in a shot.** It eats a tenth of the frame, and in motion
it reads as a picture of a picture. The border belongs on a title card, if anywhere.

---

## 2. The audio is the clock

Narration segments run from 2.7 to about 14 seconds, and a shot is **rendered at exactly the
length of the line it serves**: `film.js` reads the clip's duration, renders that many frames
plus `0.35s` of air, and `cut.js` joins them. There is no trimming and no stretching, because
a shot cannot be cut away from a sentence it was built to fit. Re-record a line and the film
re-times itself for free.

Consequence: a shot is never cut away mid-sentence, and no sentence ever plays over silence.
Add a shot to `scenes.json` and the film re-times itself.

> *The retired generative pass had no such freedom — clips came back at a fixed eight seconds,
> so every segment got `ceil(d/8)` shots and the video was trimmed down to the line. If you
> are ever stuck with fixed-length clips: trimming is free, stretching is not. Past about
> **1.10×** a `setpts` stretch stops reading as "slower" and starts reading as broken, and a
> freeze-frame reads as a crash to a four-year-old. Add a shot instead; a second shot is
> cheaper than a bad one.*

---

## 3. Editorial rules for the channel

These carry over from [`docs/05-editorial-policy.md`](05-editorial-policy.md), which is
binding here too, plus three the video form adds.

1. **The badge travels.** The video's description states the story's badge — 🪔 Katha for
   this one — in the same words the app uses. A story told as a story is never presented
   as history.
2. **Nothing sacred is animated for a thumbnail.** The Panchatantra animals are fair game.
   Deities are not, and are not on the channel's list.
3. **No on-screen text inside a shot.** Titles and credits are composited by us afterwards
   in the app's own typefaces. Generated lettering is unreliable, unbrandable and, in
   Devanagari, would break the app's hard rule about setting the script correctly. `NEG`
   in the pipeline blocks it.
4. **Death and harm are elliptical, exactly as the app's telling is.** The Panchatantra's
   tortoise dies. The app's line is *"It was a very good idea. It was, in fact, the last
   one he ever had."* — the whole event held in a joke. The video matches it beat for
   beat: the mouth opens, the stick slips, cut to two geese circling an empty sky. Nothing
   is softened. Nothing is shown. **Never make the video braver than the app's own text.**
5. **No child-directed engagement bait** — no "SMASH that like button", no countdowns, no
   loot. The app takes no ads and tracks no child; the channel does not undo that in the
   first ten seconds. Comments off on every episode, per the same posture.
6. **The people in the crowd are ordinary and various.** Shot 06a has a village street
   running out to look. Bright clothes, mixed ages, nobody a caricature, nobody a type.

---

## 4. The shot list, as a form

A film is `films/<story>/scenes.json`. A shot is a plate plus a list of layers — no prose,
nothing to regenerate, so a note from a reviewer is an edit to a number and a re-render that
costs nothing:

```json
{ "id": "02", "seg": "1", "plate": "river-tree", "camera": "push-in",
  "layers": [
    { "sprite": "croc-bank",    "x": 250, "y": 300, "h": 260, "flip": true, "anim": "small-breathe" },
    { "sprite": "monkey-offer", "h": 290, "anim": "chatter", "perch": [0.255, 0.305], "flip": true },
    { "say": "You look tired.<br>Try these.", "at": 2.4, "dur": 5.0, "from": "monkey-offer" }
  ] }
```

- **`id`** — sorts the film. Two shots for one long line are `05a`, `05b`.
- **`seg`** — which narration clip this shot serves: a scene index, or `hook` / `moral`.
  This is the only link between picture and sound, and it is what lets the timing be
  computed rather than eyeballed. Shots that share a `seg` split its duration.
- **`plate`** — the background, out of `films/<story>/plates/`, with no characters in it.
- **`layers`** — a sprite at a size (`h`) and a place: either `x`/`y` from frame centre, or a
  `perch`, a declared point on the *plate* where the character's feet land. `flip` mirrors
  it; `anim` names a motion from a fixed set (`idle`, `chatter`, `breathe`, …).
- A layer with **`say`** is a callout instead of a character: `from` names the speaker it
  points at, `at` and `dur` are seconds. Plot lines only — three to five in a film.
- **`carry`** and **`ride`** are rig groups rather than layers, and that is the whole idea:
  the contact inside them *cannot* be expressed as two independent positions, so it cannot
  break. See docs/02 §3, Rule 2.
- **`camera`** — one move from a named set (`push-in`, `pull-back`, `drift-left`, `rise`,
  `hold`).

A shot holds **one idea**. "The birds lift off and the camera tilts up to follow them" is a
shot. "They take off, fly over the fields, and reach the town" is three.

---

### From the generative pass — kept because the rules came out of it

*The next three sections are about prompting a video model, which this project no longer
does. They are the record of why the rig exists: every fault below is now impossible to
express rather than merely discouraged.*

### Continuity is not style, and reference images do not carry it

The first cut was rejected on three faults, and they are the same fault wearing three
hats: **a thing obvious to someone watching the whole film is invisible to a model drawing
one frame.** Reference art holds the *drawing* of a character. It does not hold the
*relationship between two* characters, and it does not hold *what a character is doing
with its mouth*. Those must be stated, in words, in every prompt — which is what the
`CONTINUITY` block in the pipeline is, appended verbatim to all sixteen.

- **Scale drifted shot to shot.** The tortoise stood shoulder-high to a bird in one shot,
  smaller than a bird's head in the next, and larger than both birds in a third. The rule
  is now numeric and repeated everywhere: *a standing bird is about twice the tortoise's
  height; his shell is roughly as wide as a bird's body.*
- **The bite was wrong, and the bite is the story.** Kambugriva must carry the stick **in
  his mouth** — that is why opening it costs him everything. The first cut had him
  gripping the stick in his front paws, standing on it, and in one shot roped to it in a
  little harness. With a harness the ending makes no sense: he could shout all he liked.
  This is a **story** error that arrived dressed as an art error, and it is the reason
  `CONTINUITY` spells out jaws-closed-on-the-wood, legs-hanging-free, never tied, never
  held with the feet, never ridden.
- **The birds changed species mid-film.** One shot grew them blue crests and blue wing
  feathers. Locked: plain white all through, orange beak and legs, no crest, both birds
  identical to each other.

The negative prompt carries the same three as explicit exclusions, because saying what you
want and saying what you must not have catch different failures.

**The lesson worth keeping:** before shooting, write down the handful of facts that must
be true in *every* frame — relative sizes, what is touching what, who is holding what and
how — and repeat them in full each time. It feels redundant on shot three and it is the
only thing that works by shot sixteen.

### What went wrong on the first pass, and what it teaches

Both failures were the *motion* prompt, not the art, and both are worth knowing before
you write the next shot list.

- **"rises out of frame" made the subject vanish.** Shot 05a asked the birds to lift off
  and leave frame with the camera tilting after them. Veo obliged by zooming out until the
  three of them were specks against an enormous red sunburst — and a shot that ends on a
  colour the film does not use reads as a mistake even to someone who could not name why.
  The fix: say *close*, say *stay large in frame*, say *do not zoom out*, and name the
  palette a second time inside the move.
- **"the camera drifts down towards the street" became a wall of one face.** Shot 06a's
  village crowd, pushed into, resolved as forty near-identical shouting faces. Ugly, and
  straight against rule 6. The fix was not a better crowd prompt but a *higher camera*:
  stay above the rooftops, keep the people small and various, and say explicitly that the
  camera never descends to anyone's face.

The general rule: **a camera move that leaves the subject will be taken literally.** If
the subject must stay, say so twice.

### The audio is the clock — and it decides the shot count

Every narration segment gets `ceil(d/8)` shots, and the video is trimmed down to the line.
Trimming is free; stretching is not. A `setpts` stretch past about **1.10×** stops reading
as "slower" and starts reading as broken, so a segment that would need more than that gets
another shot instead. Three of them did here — 1.16×, 1.07× and **1.37×** — and shots
`02b`, `03b` and `04b` exist for no other reason. A second shot is cheaper than a bad one.

Run the timing before you run the shots:

```
hook  ['00']          need  7.69  have  8.0  trim
0     ['01a','01b']   need 14.27  have 16.0  trim
3     ['04','04b']    need 10.96  have 16.0  trim     ← was ['04'], stretch ×1.37
```

## 5. Running it

```bash
export STORY=pt-monkey-crocodile   # one env var picks the film, everywhere
export GEMKEY=…                    # never written to a file; the asset stage only

npm run assets      # ONE-TIME per story: sprites and character-free plates
npm run cards       # title and end cards, set in the app's own type
npm run build       # scenes.json -> one page per shot, anchors measured from the sprites
npm run check       # the contact assertions, rendering nothing
npm run still -- 07 # one paused frame of shot 07, in about a second
npm run film        # every shot, each rendered at exactly its narration length
npm run cut         # join, mux the narration, master + preview
```

Only the first line costs money, and it is resumable: an existing sprite or plate is left
alone unless `--force`. Everything after it is local and free — a re-render after a note is
CPU and minutes, and `film.js` caches each shot on its own inputs, so one changed shot costs
one render rather than twelve.

Output: `build/<story>/<story>.mp4`, 1920×1080, 24 fps, and a 720p preview beside it.

`build/` is **not committed**. Every input is in the repo and the film rebuilds from them; a
rendered video in git is a hundred megabytes that go stale the first time a line of narration
is re-recorded. Published cuts live on gh-pages — `pipeline/publish.sh`.

### Delivery

The final mux does two things beyond joining the tracks, and both matter more than they
look:

- **Loudness.** The narration is synthesised speech and lands around −24 LUFS. YouTube
  normalises to roughly −14, so ours would simply sit quiet next to whatever plays next.
  `loudnorm=I=-14:TP=-1.5` hands the platform the target rather than arguing with it.
- **Bitrate.** The segment files are CRF 18 at ~10.6 Mbps, which is well past the point
  where flat cel-shaded animation gains anything. The master goes out at CRF 20, 48 kHz
  stereo, `+faststart`.

Episode one measured: **90.6s, 1920×1080 at 24 fps, 8.3 Mbps video, 96 MB, −15.0 LUFS
integrated, −4.2 dBTP.** Well inside what YouTube wants for 1080p24 and loud enough to
sit level with the feed around it.

### Three things that will bite

The first two are ffmpeg and CSS and still bite. The third is generative-pass history.

- **A still image has no timeline.** `-i card.png` is one frame at t=0, so
  `fade=t=in:st=0.5:alpha=1` sets that frame's alpha to zero and nothing ever turns it
  back on. ffmpeg exits 0 and the title is simply invisible in the finished film. Use
  `-loop 1 -t <seconds>`. This cost a full re-render to notice.
- **A positioned scrim paints over static type.** `.scrim` is `position:fixed`, the
  headline is not, so the scrim landed on top of it and the white lettering came out at
  luma 164 instead of 250 — muddy grey over the sky. It looks exactly like a bad font
  choice, which is where the hour goes. `z-index` on both, deliberately.
- **A download that 302s is not a download** *(generative pass)*. The file URI redirected to
  a signed URL and `urllib.urlopen` handed back the redirect body as if it were the file — 95
  bytes of JSON that `ffmpeg` then reported as a missing `moov` atom, which sends you looking
  for a video bug that is actually an HTTP bug. Use `curl -L`, check the byte count, and
  delete anything too small rather than leaving a stub the next run treats as cached. The
  general form of this one still applies to the asset generator: **a truncated artefact that
  is cached is worse than one that failed.**

---

## 6. Publishing

Not automated, on purpose — publishing is outward-facing and stays a human action.

- **Title:** the story's own title, then the form and the brand —
  `The Tortoise Who Had to Have the Last Word — a Panchatantra story for kids | Bizzing India`.
  Take it from the app, never from memory: this story was called *Kambugriva the Tortoise*
  when episode one was cut, the app retitled it, and the title card went on saying the old
  name until it was re-rendered. **If episode one is already live under the old title, change
  it** — the app is the source of truth, and a child who searches the name they saw must find
  the same story.
- **Made for Kids:** yes. Comments off (see rule 5).
- **Description:** the story's own `hook` and `moral`, verbatim, then the source line from
  `data-stories.js` — *"Panchatantra, Book I. The tale travelled into Aesop, the Arabian
  Nights and beyond."* — then the app link.
- **Thumbnail:** frame `03`, the moment of the idea. Big eyes, raised paw, the sparkle.
- **Disclosure:** the description states that the animation is AI-generated from the app's
  own artwork and narration. Say it plainly; YouTube's synthetic-media disclosure applies
  and, on a children's channel, so does ordinary honesty. **Say what was actually done** —
  the characters and backgrounds are drawn by an image model and animated by us, and the
  description must not go on claiming a video model that no longer touches these films.

### Where a finished film lives

**Not in git.** This repo holds the recipe, not the dish: `scenes.json`, the sprites and the
plates, plus the app's narration, rebuild any cut byte-identically in about forty-five minutes
with no API calls. So a master in version control buys nothing and costs permanently — every
cut ever pushed stays in the branch history, a re-cut is an *addition* rather than a
replacement, GitHub warns above 50 MiB and **refuses above 100 MiB**, and episode one's master
is 71.8 MiB already. Pages is not a media host and is not meant to be one.

| | |
| --- | --- |
| **The channel** | **YouTube.** The finished film goes out there. Nothing else ever serves a film to a child. |
| **The archive** | **Drive**, one file per cut, named `<story>-<commit>.mp4`. Insurance, so what shipped can be re-uploaded without a re-render. |
| **Review** | `pipeline/publish.sh` — the **720p preview only**, about 7 MB. It refuses anything larger. A new cut gets a content-addressed URL, so a link you hand someone cannot be stale. |

And then the one thing here that is *not* reproducible, which is therefore the one thing that
belongs in the repo: **which cut is live.** `films/<story>/released.json` records the date, the
commit, the duration and the YouTube id. Without it nothing can answer *"is the film on the
channel the current story?"* — which is exactly how a 720p preview sat two cuts stale, six
seconds short of its own master, with nobody able to see that it had.

### The description, ready to paste

```
Kambugriva was a tortoise who could not stop talking. Not for a moment. Not for
anything. When the lake dried up, his two goose friends found a way to carry him to
water — on one condition. He had to keep his mouth shut.

A Panchatantra story, told for children 4–8.

🪔 Katha — a story as it is told.
Source: Panchatantra, Book I. The tale travelled into Aesop, the Arabian Nights and
beyond.

"There is a time to speak and a time to keep your mouth shut. Knowing the difference
is most of wisdom."

More stories, the living map of India, and Hindi from the beginning:
https://bizzingindia.com

—
How this was made: the words and the narration are taken unchanged from the Bizzing
India app. The characters and backgrounds were drawn with an AI image model from the
app's own character artwork and story painting, and animated by hand. No ads, no
tracking, nothing collected from children.
```

## 7. Known gaps

Narration lives in the app, so the tools named here are in the **bizzingindia.com** checkout,
not this repo.

- **Hook and moral clips — closed, and worth knowing about.** `tools/story-clips.js` did not
  emit those two keys per story, so when the library was re-narrated by the Indian narrator
  they were skipped — 646 clips, silently. The app never plays them (it renders hook and
  moral as text), so nothing noticed until a video used them and the film changed accent at
  the end. The generator was fixed and the whole library re-narrated: all 323 hooks and 323
  morals are now the Indian narrator's. Two things survive the fix:

  **Measure before you build.** Median F0 across a story's clips; a 25+ Hz outlier is a
  different voice. The film changing accent should never again be how anyone finds out.

  **`voice-tune.py` is destructive and cumulative** — it rewrites each mp3 in place and
  running it twice applies the change twice, with nothing in the file to say it has been
  tuned. Always pass `--only`. (The flag exists because the obvious command — point it at
  the directory — began re-tuning all 6,454 clips and had degraded 1,068 before it was
  killed. They came back from git.)

  ```bash
  # in the bizzingindia.com checkout
  node tools/story-clips.js /tmp/clips.json
  python3 tools/tts.py /tmp/clips.json --voice en-IN-Chirp3-HD-Laomedeia --rate 1.02 --for en-US
  python3 tools/voice-tune.py app/voice/st --pitch -5 --pause -15 --only <the new stems>
  ```

## 8. Before the next episode

- The narration is still the **synthesised placeholder voice**. Bizzing India's `docs/09` §9
  stands: a human reader replaces it before launch, and the channel inherits that the moment
  the app does — the film is rebuilt from the same files, no re-edit.
- The Hindi telling of this story exists (`-hi` clips) and is a **draft pending a named
  Hindi pedagogue**. A Hindi cut of this episode is one flag in the pipeline and must not
  ship before that review.
- No music yet. When it arrives it is one bed, credited, at a level that never competes
  with the narration.
