# 02 — Making the videos: a production brief

**Audience:** anyone starting video production on a Bizzing property — Bizzing India, Bizzing
Bee, or whatever comes next. This is written to be read cold, by someone who was not in the
room.

**Where the pieces are:** the renderer is `pipeline/`, a film is `films/<story>/`, and the
app the film is made out of is a separate checkout reached through `pipeline/sources.js`.
`README.md` has the commands.

**Status:** learned the expensive way on *Kambugriva the Tortoise* and confirmed on
*The Monkey Who Kept His Heart in a Tree*. Everything below is a conclusion someone paid
for. Read section 1 before you spend anything.

---

## 0. The standing instruction

> **Do not make Veo videos. Make them the way this project makes them now:**
> **generated sprites and plates, composited locally, with the structural facts in the rig.**

That is a decision, not a recommendation, and it applies to every Bizzing property. It was
taken after four full rounds of generative video failed on a single eighty-seven-second
film, and it was confirmed when the local approach produced a second film with one new rig
primitive and no further surprises.

If you are about to open a generative-video API for a story film, stop and read §1.

Generative **image** models stay in the pipeline and are essential — they draw the sprites,
the plates and the model sheet. It is generated **motion** that is out.

---

## 1. Why, in full, because it is the one that costs money

**Do not use generative video (Veo, or any equivalent) for character-driven story films.**

Not "use it carefully". Not "with better prompts". It cannot do the job, and the reason is
structural rather than a quality issue you can iterate away.

A generative model has **no model of the scene**. Every clip is a fresh sample. So a
requirement like *"both geese are holding the stick"* can be **asked for** and can never be
**guaranteed**. On episode one this produced, across four full rounds:

| Round | What was tried | What came back |
| --- | --- | --- |
| 1 | Careful prose describing the characters | Geese changed species between shots; tortoise scale swung from knee-high to taller than a bird |
| 2 | A **character model sheet** as a reference image on every call | Bird design finally held. Scale still drifted in "hero" shots |
| 3 | A `CONTINUITY` block naming size, grip and colour, plus a negative prompt | The tortoise was **roped to the stick in a harness** in one shot, **riding on a bird's back** in another, and **smiling as he fell to his death** |
| 4 | Both endpoints of every shot pinned (`lastFrame`) | Best yet — and the geese still let go of the stick |

Round four was genuinely close, and that is the trap: it looks like one more round will do
it. It will not. Each re-roll can introduce a *new* fault while fixing the old one — fixing
the harness produced the bird-ride; fixing the bird-ride produced bared teeth.

**And the cost is per-attempt, not per-film.** Sixteen clips per film. Four rounds is 64
generations for eighty-seven seconds. Multiply by a catalogue of 300+ stories and it is not
a budget problem, it is an impossible one.

### What generative image models ARE excellent for

Everything that is drawn **once** and then reused:

- **Sprites** — a character in a fixed pose, on flat white, keyed to transparent
- **Plates** — a background with no characters in it
- **Model sheets** — the cast together at true relative scale
- **Title-card artwork**

These are the right use. A defect in a sprite is a **one-time** defect: fix the cell and
every film that uses it is fixed. A defect in a generated *clip* recurs, unpredictably, per
shot, per film, forever.

---

## 2. The architecture that works

**Composite locally. Place things; do not ask for them.**

```
sprites (transparent PNG)  ─┐
plates  (no characters)    ─┼─→  HTML/CSS shot pages  ─→  headless browser, frame by frame
scenes.json (the film)     ─┘         │                          │
                                      └── assertions             └── ffmpeg → mp4
```

Everything after the assets is free. Re-rendering after a note costs **zero API calls** and
a few minutes of CPU. The output is byte-identical on every run.

### Why HTML/CSS rather than a video library

Because the team already writes it, the browser already does compositing, transforms and
easing well, and a headless browser can be **stepped frame by frame** rather than recorded
in real time. Pause every animation, set `currentTime` per frame, screenshot. No dropped
frames, no flakiness, no timing drift.

```js
await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
for (let i = 0; i < total; i++) {
  await page.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms; }),
                      (i / FPS) * 1000);
  await page.screenshot({ path: frame(i) });
}
```

---

## 3. The five rules that carry to any property

### Rule 1 — Nothing on the channel is invented for the channel

The words, the narration, the characters and the world all come out of the app. A child who
watches a video and then opens the app must meet the **same** character. If the video has a
better tortoise than the app, the video is wrong — go and fix the app.

Corollary that bit us: **a clip the app never plays is not the app's narration.** See §5.6.

### Rule 2 — Structural truths go in the rig, not in a prompt

If a thing must be true in every frame, make it **impossible to express otherwise**.

Episode one's invariant was a *carry group*: two fliers, a stick, and a character hanging
from it. The stick's endpoints **are** the beak tips, computed from anchors measured out of
the sprite pixels. The geese cannot let go, because there is no state in the markup where
they are not holding it.

Episode two's invariant was a *ride group*: a rider pinned to a **saddle** measured off the
mount's own drawing. He cannot drift off, sink in, or end up behind the animal.

Ask of every shot: *what would be embarrassing on screen here?* That is your rig primitive.

### Rule 3 — Anchors are measured from the drawing, never typed by hand

Guessing the tortoise's mouth at `0.30` put the stick across his brow. Guessing `0.42` put
it across his chest. The third guess was not the answer.

Derive it: a front-facing cartoon face has dark horizontal bands down it — the eyes are the
heaviest band in the upper face, and **the mouth is the band below them**. Cluster rows by
ink and read it off.

> A first attempt used "the second band from the top". Too fragile — one stray line above
> the eyes (a brow, the top of the head) shifts every index and the stick lands on his
> forehead. Anchor on a *feature*, not an index.

The payoff is not this film. It is that **a new sprite calibrates itself the moment it is
drawn**, with nobody squinting at a render. That has to be true to make hundreds of films.

Anchors built so far: `beak` (extreme orange pixel), `mouth` (band below the eyes),
`saddle` (highest opaque pixel along the back at 55% of length), `perch` (a point on the
*plate*, declared, where a character's feet land).

### Rule 4 — The audio is the clock

Narration segments run 2.7s to 14s. Never lay audio under a fixed cut. Render each shot at
**exactly its narration length**, so a shot cannot be cut away from a sentence.

Re-record a line and the film re-times itself for free.

*(If you are stuck with fixed-length clips: trimming is free, stretching is not. Past about
1.10× a `setpts` stretch stops reading as "slower" and starts reading as broken. Add a shot
instead — a second shot is cheaper than a bad one.)*

### Rule 5 — Assert what a viewer would complain about

Reviewing generated video means watching every second of every shot by eye. That is how a
harness, a bird-ride and a set of bared teeth **still got through**, and it does not scale
past a handful of films.

Turn each note into a test, measured from the live DOM before a frame is rendered:

```
the stick's ends reach into both beaks     → the geese are holding it
the stick crosses his MOUTH, and he is
  centred on it                            → he is biting it, not standing behind it
the rider's feet are within a hand's
  breadth of the saddle, and over the body → he is on the crocodile, not floating above it
```

A failure is an **exit code**, not something a person has to notice.

---

## 4. Process — the order matters and saves money

1. **Narration first.** It sets every duration. Verify its provenance (§5.6).
2. **Model sheet.** The cast together, on one ground line, at true relative scale. Check it
   by eye — this is the one image everything else is measured against.
3. **Sprites**, each generated with the **canonical cell** as an extra reference (§5.1).
4. **Plates**, with no characters in them (one deliberate exception, §5.7).
5. **Check every asset.** Not a sample — every one. Story one shipped two bad end frames
   because sixteen were generated and two were checked.
6. **Author `scenes.json`.** Shots against narration segments.
7. **Run the assertions** (`--check`) before rendering a single frame.
8. **Look at a still** (`npm run still -- 07`, one paused frame, a second) for every shot you
   changed.
   Assertions catch what you thought to assert; a still catches what you didn't.
9. **Render one shot**, look at it, then render the rest.
10. **Sample the finished film across its length**, not just first-and-last frames.

### The thing that actually costs you: the gap between a fix and seeing it

A twelve-shot film is ~45 minutes to render. On story two that wait, not any single bug,
was the expensive part: notes came in, the fix went into `scenes.json` in a minute, and
then a *previous* cut got shown because the new one wasn't out yet. From the outside that
is indistinguishable from the note being ignored, and it was said out loud.

Two things close the gap, and both belong in the pipeline from day one:

* **Cache each shot on its own inputs** — its page, the art that page loads, its narration
  length. One changed shot then costs one render, not twelve.
* **Screenshot a paused frame** at the millisecond you care about. Almost every note is
  about a single moment: where the bubble sits, who is facing where, what is touching
  what. You do not need a video to answer any of them.

And when you do show a cut, publish it to a **content-addressed URL**
(`name-<hash8>.mp4`). A stable path served from cache is the other way to show someone
yesterday's film while insisting it is today's.

---

## 5. The traps, with symptoms

Each of these cost real time. They are listed so they cost you none.

### 5.1 Character drift in sprites — fix with a canonical reference

**Symptom:** one goose comes back white, one yellow with blue wing flashes; tortoises get
different shell colours.

**Fix:** generate one cell first, check it, then pass it as a reference image on every
subsequent cell with *"match this drawing exactly; it outranks every other reference."*
A model matching one specific drawing is far steadier than one matching a description.
On episode two this produced a consistent cast **first time**.

### 5.2 Depth is the whole vocabulary — getting it backwards makes a puppet look like a sticker

**Symptom:** *"not biting — the tortoise is in front of the stick, needs to be behind it."*

A bite reads when the wood passes **across the face** at mouth height, i.e. the stick is
drawn **above** the character in z. A first attempt split the stick into two segments
stopping at the jaw with the head over the join — reasonable on paper, and on screen it
read as a tortoise standing in front of a broken stick.

### 5.3 A pinned endpoint dictates the shot — so check the picture you pin to

*(Applies if you are using generative video at all.)* Given a `lastFrame`, the model
interpolates toward it. A wrong end frame does not degrade a shot, it **dictates** it. One
end frame with three birds in it produced a third bird in the film.

And **naming the subject is not enough**: told "exactly two birds", the retry gave two — and
swung the camera round, moved the town to the other side of frame and turned the pair into
grey herons. Lock the camera explicitly: *"the camera has not moved at all"*, plus each
element named as unchanged.

### 5.4 A still image has no timeline

**Symptom:** a title card is simply invisible in the finished film, and ffmpeg exits 0.

`-i card.png` is one frame at t=0. `fade=t=in:st=0.5:alpha=1` sets that frame's alpha to
zero (it is before the fade's start) and nothing ever turns it back on. Use `-loop 1 -t <s>`.

### 5.5 A positioned scrim paints over static type

**Symptom:** white lettering comes out muddy grey; looks exactly like a bad font choice.

A `position:fixed` scrim is a positioned element and paints **above** static siblings. The
headline measured luma 164 instead of 250. Give both an explicit `z-index`.

Related: **do not dim the whole frame to make lettering legible.** It dims the characters
too and reads as a colour-grade mistake. Bake a gradient scrim into the title PNG over the
top of the picture only.

### 5.6 Narration provenance — the bug with the widest blast radius

**Symptom:** the film changes accent at the end.

The story library was re-narrated by an Indian-English narrator. The **hook and moral clips
were skipped** — 646 of them — because the tool that generates the canonical clip list did
not emit those two keys per story. Measured: hook 210 Hz and moral 224 Hz against 182–195 Hz
for every scene between them.

Nothing in the app noticed, because the app renders hook and moral as **text** and never
plays them. They were orphans. A video reaching for them is exactly the drift Rule 1 exists
to prevent.

**Check before you build:** `python3 pipeline/check-voice.py <story>`. It measures median F0
per clip and gates on the fault; run it as step 1, before anything is drawn.

Two refinements the original rule needed, both learned by implementing it:

- **A flat 25 Hz per-clip threshold rejects good films.** Shot 7 of the shipped
  monkey-crocodile — *"My wife wants to eat your heart"* — measures 225 Hz against a 192 Hz
  story median. Thirty-three hertz out, one narrator, nothing wrong with it. Emphasis and a
  change of speaker look identical to a single clip's pitch. A check that fails that shot is
  one people learn to skip, which is worse than no check.
- **The fault has a shape, and the shape is the test.** Hook and moral came from a *different
  batch*, so they move **together and in the same direction**. Two clips agreeing is far
  stronger evidence than one clip being loud. So the gate is: both ends off the scene median,
  same side, by more than the story's own band (median ± max(25 Hz, 3×MAD)). A single odd
  clip is reported, not failed.

  That second scaling is not decoration. `jt-crocodile-rock` is full of shouted dialogue —
  *"HEY, ROCK!"*, *"GOOD EVENING"* — which drags its scene median to 203 Hz while its quiet
  hook and moral sit at 174 and 179. Both ends, both low, 26 Hz out: the §5.6 signature
  exactly, and entirely innocent. Against that story's own 38 Hz band it reads as what it is.

**And one story proves nothing on its own — the corpus does.** Measured across a 45-story
sample: hook sits **+1.6 Hz** from its scenes on average, moral **+3.3 Hz**, and the two land
on the same side **42%** of the time, which is a coin flip. There is no library-wide hook/moral
offset any more; the generator fix held. Before believing any single story is suspect, check
it against that baseline — `--all` re-measures it.

### 5.7 The plate rule has one exception, and it is not the characters

Plates contain **no characters** — a painted character cannot be animated and will not match
the cast.

But **crowds are scenery, not cast.** A village that the story says runs out to look up must
have people in it; they never recur, so they belong in the plate. An empty street under that
narration is the shot failing its one job. State the rule per-plate, not globally.

### 5.8 A number the renderer ignores is worse than a wrong number

**Symptom:** you change a value, re-render, and nothing moves.

`carry.y` was set in the scene file and never read by the builder. The flying group was
raised twice and stayed at street level among the villagers it was meant to fly over. A
wrong number gets corrected the first time someone looks; an ignored one gets "corrected"
repeatedly and never changes — and it feels like the tool arguing with you.

If a field exists in the scene format, assert somewhere that it has an effect.

### 5.9 An anchor says where a character *meets* the world, not that he *fits* in frame

**Symptom:** feet correctly on the branch; head 120px above the top of the picture.

Both are needed. Check the sprite's full extent against the frame after anchoring.

### 5.10 `console.log` does not interpolate printf placeholders

Ten shots reported `ok %-4s %5.2fs 1 frames 14.27 342` for an entire render and nobody read
it, including the person who wrote it. A progress line nobody can read is **worse** than
none, because it looks like instrumentation.

### 5.11 A derived artefact must be measurably smaller than its source

A 720p "preview" came out **0.6 MB larger** than the 1080p master. The preview was pinned to
a fixed bitrate while the master was quality-targeted (CRF), and flat cel animation already
lands below that bitrate at 1080p. Quality-target both.

### 5.12 Polling must survive the network

A single dropped connection killed a sixteen-shot run at shot fifteen — a traceback instead
of a result. A transient read error is not a failed job. Retry, with a bound.

### 5.13 Destructive tools need an `--only`

A pitch/pause tuner rewrites mp3s **in place** and is **cumulative** — running it twice
applies the change twice, with nothing in the file to say it has been tuned. Pointing it at
a directory to fix two clips began re-tuning all 6,454 and had degraded 1,068 before it was
killed. They came back from git.

If a tool is destructive and cumulative, make the subset explicit and say out loud when it
is about to do everything.

### 5.13a One renderer per film, enforced with a lock

The single most expensive bug on story two was not in a shot. A render started in an
earlier session kept running for over half an hour after it was believed dead, writing
shot mp4s into the same output directory as the current one — so a cut assembled from
"the finished shots" was a mix of two builds, and a film published as the fixed one was
overwritten by the old one minutes later. From the outside this is
*"still the old video"* and *"I feel my prompts are not being implemented"*, and neither
diagnosis points anywhere near the real fault.

Take a pid lockfile in the output directory and refuse to start a second renderer. Clear
a stale lock (no such pid) and say so. Kill by process, not by whatever wrapper you
think you started — a `TaskStop` on the shell can leave the node process running.

### 5.14 A speech bubble clears every body it passes, not just the speaker's

"Above the speaker's head" is the right rule and it is not sufficient. A side-facing
crocodile is 1,266px of animal whose head anchor is the far tip of him: hang a bubble off
that one point and it sits neatly above his *head* and squarely across his *back*. And a
bubble anchored to a rider has the mount underneath it too.

Place it above the highest thing standing in its own column — the speaker plus every
character box the bubble's x-range actually crosses — and point the tail at the speaker.
The tail carries the "who is talking"; the box only has to stay out of the way.

### 5.15 Know whether your coordinate is a centre or an edge

The same bubble was also thrown sideways onto the crocodile by a guard meant to catch
bubbles running off the top of frame. `cy` is the box's **top** edge — the element is
positioned from `top:50%` with no vertical centring — but the guard tested `cy - boxH/2`,
so a bubble sitting 48px inside the frame was declared off-frame and sent to the fallback,
which places it *beside* the speaker at his own height. On top of him, in other words: the
exact fault the fallback exists to fix.

Assert the outcome, not the intermediate. `film.js` measures the rendered rectangles and
fails the shot; that is what caught this, and no amount of reading the placement code did.

---

## 6. Editorial (carries to any Bizzing property)

1. **Harm and death stay as elliptical as the app's own text.** The Panchatantra's tortoise
   dies; the app's line is *"It was, in fact, the last one he ever had."* The video matches
   it beat for beat: the mouth opens, the stick slips, cut to two geese circling an empty
   sky. Nothing softened, nothing shown. **Never make the video braver than the text.**
2. **Draw a character as what the story needs them to be.** The crocodile is the *friend* who
   gets talked into it — so he has **no visible teeth in any cell**. Drawing him as a
   predator would make the ending mean something it does not.
3. **But do not confuse the antagonist with the harm.** The crocodile's wife was left off the
   page on elliptical-harm reasoning. That was wrong: *she is not the harm, she is the
   argument*, and a scene about someone being talked into something needs the other person
   in it. Drawn firm, never monstrous.
4. **No generated lettering in a shot.** Titles and callouts are composited afterwards in the
   app's own typefaces. Generated type is unreliable, unbrandable, and in an Indic script
   would break the app's rule about setting the script properly.
5. **Callouts on the plot lines only** — typically three to five. The story is narrated, not
   acted; a bubble on every sentence fights the voice and turns a picture book into a comic.
6. **Crowds are ordinary and various.** Mixed ages and colours, nobody a caricature, nobody a
   type. Keep the camera high enough that faces stay small — pushing in on a generated crowd
   produces a wall of one repeated face.
7. **No child-directed engagement bait.** No "smash that like button", no countdowns, no
   loot. The app takes no ads and tracks no child; the channel does not undo that.
8. **Disclose AI generation** in the description. Synthetic-media disclosure applies, and on
   a children's channel so does ordinary honesty.

---

## 7. What it actually costs

Measured on this project.

| | Episode 1 (learning) | Episode 2 (the pipeline working) |
| --- | --- | --- |
| New code | the whole thing | one rig primitive + its assertion |
| Generated assets | 15 | 15 |
| Authoring | scenes file | scenes file + assets file |
| Cast consistent on attempt | 3 | **1** |
| Cost to re-render after a note | zero | zero |

**The asset library is the fixed cost of the entire channel.** In this catalogue there are
**69 distinct cast members across 323 stories**. Sixty-nine characters cover every film you
will ever make. Do the same count for your property before you plan anything.

That only pays if the library is keyed by **character**, not by film. The first two films
each generated their own sprites, which would have made story three's monkey a *second
drawing* of story two's monkey — the exact drift Rule 1 exists to stop, arriving through the
back door. So cells live in `cast/<character>/` and a film declares what it needs:

```json
{ "story": "jt.crocodile-rock", "cast": ["monkey", "crocodile"], "shots": [ ... ] }
```

Story three named those two and its sprite cost was **zero**. Do this before the film that
first needs it, not after: it is a rename while there are two films and a migration once
there are twenty.

Render time is now the slow part — roughly four minutes per shot at 1080p24, so ~45 minutes
for a two-minute film from cold. It parallelises trivially across shots and costs nothing but
CPU.

**That gap is closed, and closing it was worth more than any single bug fix.** `film.js` now
hashes each shot on its own inputs — its page, the art that page loads, its narration length
— so one changed shot costs one render rather than twelve, and a fix is visible in four
minutes rather than forty-five. If you are porting this pipeline anywhere, port the cache on
day one: the wait between a fix and seeing it is what made cuts that predated their own
fixes keep getting shown.

---

## 8. Checklist before you publish

- [ ] Every clip's narration is the app's own, and one voice throughout (measure F0)
- [ ] Every sprite checked individually, against the model sheet
- [ ] Every plate checked, and character-free (crowds excepted, deliberately)
- [ ] Assertions pass for every shot, before rendering
- [ ] Finished film sampled across its whole length
- [ ] Harm elliptical; nothing braver than the app's text
- [ ] No generated lettering anywhere in a shot
- [ ] Preview measurably smaller than the master
- [ ] Description discloses AI generation; Made for Kids; comments off
- [ ] Publishing itself is a **human action**, not automated
