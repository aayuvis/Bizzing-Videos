# 04 — The Studio: a video-making agent, proposed

**Status: a proposal. Nothing here is built.** `studio/index.html` is a working mock with real
August-2026 rates behind it, so the shape can be argued with before any of it is written.

This is deliberately *not* a Bizzing India tool. The pipeline in this repo happens to make
Panchatantra films, but nothing in it is about the Panchatantra — it is a way of making video
where structural truths are enforced rather than requested, and that generalises to any video
anybody wants to make.

---

## 0. The one number the whole design is built on

One second of Veo 3.1 Standard costs **$0.75**.

The entire narration track of a twenty-minute film — about 19,000 characters through OpenAI
`tts-1-hd` at $30/1M — costs **$0.57**.

So a single second of premium generated motion costs more than twenty minutes of speech. It
also costs more than thirty-seven Imagen-4-Fast stills, and roughly what three minutes of this
repo's composited path costs end to end.

**Money in video is not spread evenly across the process. It is concentrated in one stage, and
that stage is the last one.** Every other design decision here follows from that.

---

## 1. The three kinds of spend, and why they are not comparable

| | Unit cost | Cacheable? | Fixable after the fact? |
|---|---|---|---|
| **Words** — script, shot list, narration | ~$0.02 a film | trivially | yes, cheaply |
| **Assets** — sprites, plates, keyframes | $0.005–0.24 an image | yes, and **amortised across films** | yes, one at a time |
| **Motion** — generated video seconds | $0.07–0.75 a *second* | no, not usefully | no — you re-roll, and pay again |

The asymmetry is the point. An asset drawn wrong costs four cents to redraw and, if it is a cast
member, it is paid for once for the entire channel — this repo's fourth film had a cast cost of
**zero** and its eighth had a cast cost of **one character**. A generated second that comes back
wrong costs the same again, every time, forever.

**And nobody prices the re-roll.** The sticker price of generated video assumes one take. The
honest multiplier is 2–4×, and this repo has the evidence: four full rounds on one film, each of
which fixed one fault by introducing another. The forecast in the console multiplies by a
per-archetype `takes` figure, because a forecast that ignores re-rolls is not a forecast.

---

## 2. Seven ways to make a minute

Measured from published API rates, August 2026. "Real" includes the re-roll tax.

| Kind | Motion from | Sticker | Takes | Real | Control |
|---|---|---|---|---|---|
| Motion graphics | code → frames → ffmpeg | $0.03 | 1.0× | **$0.03** | total |
| Composited cut-out | a rig | $0.27 | 1.3× | **$0.08–0.35** | total, and *provable* |
| Narrated stills | CSS over stills | $0.27 | 1.2× | **$0.32** | total |
| Interpolated storybook | RIFE/FILM, local | $1.59 | 1.4× | **$2.23** | high |
| Hybrid | mixed | $2.43 | 1.8× | **$4.37** | high where it matters |
| Keyframe → motion | Kling 3.0 @ $0.10/s | $6.51 | 2.5× | **$16.28** | medium |
| Pure generative | Veo 3.1 @ $0.15–0.75/s | $9.00 | 3.0× | **$27–135** | low |

Assumptions: 12 assets a minute for still-led archetypes; Imagen 4 Fast $0.02 and Nano Banana
Pro $0.134 an image; narration $0.03 a minute at `tts-1-hd`; interpolation and compositing run
locally and cost nothing but wall clock.

Three things worth saying out loud about that table:

**The cheap paths are also the controllable ones.** That is not a coincidence and it is not a
trade-off — a rig is cheap *because* it is deterministic. The expensive path is expensive
because it is guessing.

**Interpolation is free and is not animation.** RIFE and FILM compute inbetweens on a local GPU
at no marginal cost, which makes the storybook archetype astonishing value. They also drift on
large motion. The rule is to keep the change between keyframes small — which, conveniently, is
also what makes a picture book read as a picture book.

**Do not build on a model with an end-of-life date.** Sora 2 was deprecated in April 2026 and
its API shuts down on 24 September 2026. Every provider goes behind an adapter that declares its
own price, so a dead model is a config change rather than a rewrite, and so the forecast and the
ledger read from the same number.

---

## 3. The gates

Five, plus a half. Not evenly spaced — bunched immediately before each order-of-magnitude jump
in what a mistake costs.

### G1 · One sentence — costs nothing

The message as a declarative sentence, the audience, the badge, the archetype. Before any prose.
This is the gate the Bizzing Bee handover document is emphatic about: two of the three drafts of
episode two were written because somebody started at the script.

### G2 · Script and shot list — ~$0.01

Every beat with its runtime measured from the narration and **its own price tag**. An expensive
shot should be a number before it is a picture. You cut beats here; the handover doc measured
that rephrasing bought 12 words where cutting bought 530.

### G3 · The look — two images, then stop

**The gate that saves the money.** One model sheet, one hero plate, at full size. Everything
downstream is drawn against these, so if the hand is wrong here it is wrong everywhere — and it
costs ten cents to find out instead of eight dollars.

This is `gen-assets.py`'s existing "model sheet first, always" rule promoted to a gate. It exists
because the one film that skipped it came back with a softly airbrushed elephant standing beside
a flat cel-shaded monkey, and one of its three cells inexplicably gold.

### G4 · The contact sheet — the whole asset library, on one page

**The gate that saves the evening.** Every asset, not a sample, before a single frame renders.
In one day of making five films this caught: a log drawn end-on when the plates have the timber
lying flat; a yard that grew trees at both edges and moved the camera in; a house whose roof
changed from flat to pitched when it was repaired; and a "golden" goose that was a lemon rubber
duck.

The agent judges the sheet in **one** vision call and flags what it cannot defend. The creator
overrules it in either direction.

### G4½ · One second — motion archetypes only

Before ninety seconds of generated video, buy **one**. Fifteen cents against eighteen dollars,
or seventy-five cents against sixty-seven. It answers the only question a still cannot: does it
move like the thing it is meant to be.

A probe is one call and is *not* multiplied by the re-roll tax, which is the one place in the
forecast where that would be dishonest.

### G5 · The cut

A still from every shot, then the preview, with picture and sound gated against each other
before a master is written. **Rendered, not remembered** — the console stamps the render time,
because a cut that predates a note is indistinguishable from the note being ignored, and that
has cost a whole evening.

---

## 4. How the agent works

A **state machine with a model at each node**, not a chat box. A chat box re-derives what it
already knew on every turn and pays for it in tokens.

```
BRIEF → SCRIPT → LOOK → ASSETS → RIG → CHECK → RENDER → SHIP
  G1      G2       G3      G4      —     —       G4½/G5    —
```

Each state: a model **proposes** a patch → a gate **accepts** it → an executor **spends** →
assertions **refuse**. The agent's tools are the scripts this repo already has:

| State | Tool | What it already does |
|---|---|---|
| Script | `plan.js`, `check-voice.py` | shot count, cast cost, sacred-name screen, narration gate |
| Look | `gen-assets.py` | model sheet first, canon cell as an overriding reference |
| Assets | `gen-assets.py`, `gild.py` | content-hash cache; derived art computed, never re-drawn |
| Rig | `build.js` | picks from `carry · ride · rock · troop · scale · world · count · many` |
| Check | `film.js --check` | assertions off the live DOM, before a frame exists |
| Render | `film.js`, `cut.js` | per-shot cache, pid lock, picture-vs-sound gate |
| Ship | `publish.sh` | content-addressed preview, size cap, `released.json` |

**The agent does not invent a pipeline. It drives the one that already refuses things.**

### Five mechanics that keep the token bill down

1. **The agent does not look at pictures.** Assertions are code; a passing check returns one line
   of text. Vision calls happen only when a check fails or a gate opens.
2. **Contact sheets, not files.** Twelve assets judged in one call instead of twelve.
3. **The brief is the context.** Each state reads its own slice of `brief.json`, never the
   transcript.
4. **Cache on content, not names.** Same prompt and same reference set → no call.
5. **Escalate by stage.** A cheap model lays out shots. The expensive one writes the script and
   judges the contact sheet.

---

## 5. Frontend

**One self-contained HTML file, no build step.** It opens from disk, from `gh-pages`, or from a
local daemon; it has no dependencies that can rot. Same argument as the shot pages being plain
HTML: a tool that outlives its framework is worth more than a tool that is pleasant to write.

```
studio/index.html          the console — brief, ladder, stage, ledger, timeline
studio/jobs/<slug>/        one directory per film in production
  brief.json               the whole film as data; the only thing the UI writes
  ledger.jsonl             append-only: every call, cost, and authorising gate
```

Four regions:

- **Brief bar** — the dropdowns. Archetype, runtime, narration, hard cap.
- **Ladder** — the gates as a vertical spine, each showing what it unlocks *in dollars*.
- **Stage** — changes per gate: script table, contact sheet, one-second probe, timeline.
- **Ledger** — every call, what it cost, which gate authorised it. Always visible.

The budget meter shows spend against the cap and turns red when the *forecast* passes it, not
when the spend does.

---

## 6. Backend

**File-based, so the agent and the human edit the same object.** The UI writes `brief.json`; a
small Node daemon watches it and runs the pipeline. There is no database and no session state,
which means the whole production is in git and a film from six months ago still opens.

```
pipeline/studio.js         the daemon: watch brief.json, run the state machine
pipeline/adapters/*.js     one per provider; each declares its own costPerUnit
pipeline/ledger.js         append-only spend log + the hard cap
```

Three rules for the backend:

**An adapter declares its price.** The forecast on the console and the line in the ledger read
from the same constant. A forecast that drifts from the invoice is worse than no forecast,
because people stop reading it.

**A call without a gate is a bug.** Every executor takes the authorising gate id and writes it
to the ledger. An unauthorised call shows up in an audit rather than in a bill.

**The cap is a wall, not a warning.** `publish.sh` already works this way — it refuses over the
preview cap and tells you the one keystroke that overrides it. Stepping over a limit should be a
decision, not something you discover afterwards.

---

## 7. The editor edits the film, not the video

A timeline that writes JSON.

| Action | What actually happens |
|---|---|
| Trim / reorder a shot | rewrites `scenes.json`; re-renders only the shots that moved |
| Swap an asset | redraws one cell; re-renders the shots that name it |
| Re-record a line | one narration cue, seconds — not the whole track |
| Promote a shot to generative | the clip turns orange and the forecast jumps *before* you confirm |

And what it refuses: stretching a shot to fit audio; deleting an assertion to make a render pass;
publishing a master over the size cap; running two renderers on one film. Each of those is an
evening that was lost once and is now an exit code.

**There is deliberately no re-timing step.** A shot names a cue phrase, not a timestamp. Re-record
the voice and the picture follows; type a timestamp and it rots the moment a sentence changes.

---

## 8. What is actually new here

Every tool in this space generates. Runway, ComfyUI, Descript, the rest — they are all pipelines
for producing frames, and they are good at it.

**None of them refuse.** None of them will decline to render because two geese are not both
holding the stick, or because the log moved four pixels between shots, or because the film never
showed the rock as it usually sits so "higher than it has ever sat" means nothing.

That is this repo's actual asset: eight films' worth of hard-won assertions, and the discipline
of putting an invariant in the scene format *before* putting it in a test. The studio is how that
reaches a video that is not a Bizzing India story film.

---

## 9. If it gets built, build it in this order

1. **`brief.json` and the ledger.** No model calls. Prove the file format carries a film.
2. **Wire the console to the existing pipeline** for the *composited* archetype only — the one
   that already works end to end — so the gates are exercised against real output.
3. **Narrated stills.** One new executor, no new rig. The cheapest useful archetype.
4. **Adapters and the cap.** Now spend can be metered honestly.
5. **The one-second probe**, then the motion archetypes behind it.
6. **The editor.** Last, because until there are films to edit it is a mock of a mock.

Steps 1–3 are a week and produce something usable. Everything after is optional.

---

## Sources for the rates

Rates are from published pricing pages and comparisons dated May–August 2026 and **will move** —
they belong in `pipeline/adapters/`, not in prose, so there is one place to correct them.

- Video: Veo 3.1 Fast $0.15/s, Standard $0.75/s (native audio); Kling 3.0 ~$0.07–0.14/s;
  Runway Gen-4.5 $0.15/s; Sora 2 deprecated April 2026, API off 24 September 2026.
- Image: Imagen 4 Fast $0.02, Standard $0.04, Ultra $0.06; Flux 2 Pro $0.02; GPT Image 1 Mini
  $0.005; Nano Banana Pro $0.039 (1K) / $0.134 (1–2K) / $0.24 (4K); batch APIs −50%.
- Voice: OpenAI `tts-1` $15/1M chars, `tts-1-hd` $30/1M; Gemini 3.1 Flash TTS $20/1M;
  Inworld TTS-1.5 Max $10/1M; ElevenLabs Flash v2.5 $103/1M, Multilingual v3 $206/1M.
- Interpolation: RIFE and FILM, local, no marginal cost.
