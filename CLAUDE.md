# CLAUDE.md — Bizzing Videos

Read this, then [docs/02-production-brief.md](docs/02-production-brief.md) before you touch
anything that renders. Every trap in that brief was paid for once already.

## What this is

The story films for the Bizzing YouTube channels: the pipeline, the film assets, and the two
binding documents. It serves every Bizzing property —
[Bizzing India](https://github.com/aayuvis/bizzingindia.com) today, Bizzing Bee when it
starts a channel. It was split out of `bizzingindia.com` with its history intact.

## Working style (the user's pace)

Inherited from Bizzing Bee and Bizzing India, and it holds here:

- **Work autonomously.** Move through the whole request list without stopping to confirm
  routine steps. Stop only for a real fork, a destructive or outward-facing action, or
  missing information you genuinely can't infer.
- **Multitask.** Background long jobs; make independent edits and searches in parallel.
- **Bias to action, then verify.** Prefer doing over asking; verify headlessly rather than
  asking the user to check.
- **Batch and ship.** Group related edits into one commit with a clear message.
- **Keep reasoning tight.**

## Hard rules

### The two that decide everything

1. **Nothing on the channel is invented for the channel.** The words, the narration, the
   characters and the world come out of the app. A child who watches a film and then opens
   the app meets the *same* tortoise. If the film has a better tortoise than the app, the
   film is wrong — go and fix the app. Corollary that bit us once: *a clip the app never
   plays is not the app's narration* (docs/02 §5.6).

2. **No generative video. No generated motion at all for story films.** Films are composited
   locally from generated sprites and plates. This is a decision, not a recommendation: a
   model with no scene cannot *guarantee* a structural fact like "both geese are holding the
   stick", it can only be asked for, and four full rounds on one film proved each re-roll
   fixes one fault by introducing another. Generative **image** models stay in the pipeline
   and draw the sprites, plates and model sheets. `archive/veo-story.py` is evidence, not an
   option — do not run it.

### Making one

- **Structural truths go in the rig, not in a prompt.** If a thing must be true in every
  frame, make it impossible to express otherwise. Ask of every shot: *what would be
  embarrassing on screen here?* That is your rig primitive.
- **Anchors are measured from the drawing, never typed by hand.** Anchor on a *feature*
  (the band below the eyes), never an index (the second band down) — one stray line shifts
  every index and puts the stick across his forehead.
- **The audio is the clock.** Render each shot at exactly its narration length. Never lay
  audio under a fixed cut.
- **Assert what a viewer would complain about.** Turn each note into a check measured from
  the live DOM before a frame is rendered. A failure is an exit code, not something a person
  has to notice. **Never delete or loosen an assertion to make a shot pass** — an assertion
  that fails is doing its job.
- **If a field exists in the scene format, assert somewhere that it has an effect.** A
  number the renderer ignores is worse than a wrong number: a wrong one gets corrected the
  first time someone looks; an ignored one gets "corrected" repeatedly and never changes.
- **Look at a still before you render a film.** Assertions catch what you thought to assert;
  a still catches what you didn't.
- **One renderer per film**, enforced by the pid lock in `film.js`. Never work around it.
  Two renderers sharing an output directory make a film that is neither build, and from the
  outside that is indistinguishable from your fixes being ignored.
- **Destructive, cumulative tools need an explicit subset.** Anything that rewrites files in
  place takes `--only` and says out loud when it is about to do everything.

### Editorial

Binding: [docs/01 §3](docs/01-look-and-feel.md), plus Bizzing India's own
`docs/05-editorial-policy.md`, which applies here too.

- **The badge travels.** A film states the story's badge — 🪔 Katha / 📜 Itihaas / 🧭 Aaj —
  in the same words the app uses. A story told as a story is never presented as history.
- **Harm and death stay as elliptical as the app's own text.** The Panchatantra's tortoise
  dies; the app holds the whole event in a joke, and the film matches it beat for beat —
  the mouth opens, the stick slips, cut to two geese circling an empty sky. Nothing
  softened, nothing shown. **Never make the video braver than the text.**
- **Draw a character as what the story needs them to be.** The crocodile is the *friend* who
  gets talked into it, so he has no visible teeth in any cell. But do not confuse the
  antagonist with the harm: the crocodile's wife is not the harm, she is the argument, and
  the scene needs her. Drawn firm, never monstrous.
- **Nothing sacred to anyone is ever animated for a thumbnail**, and deities are not on the
  channel's list.
- **No generated lettering in a shot.** Titles and callouts are composited afterwards in the
  app's own typefaces. Generated type is unreliable, unbrandable, and in an Indic script it
  would break the app's rule about setting the script properly.
- **Callouts on the plot lines only**, typically three to five. The story is narrated, not
  acted; a bubble on every sentence fights the voice and turns a picture book into a comic.
- **Crowds are ordinary and various.** Mixed ages and colours, nobody a caricature, nobody a
  type. Keep the camera high enough that faces stay small.
- **Folk art traditions are credited** — named artist where commissioned, the tradition and
  region named always.
- **No child-directed engagement bait.** No "smash that like button", no countdowns, no
  loot. The app takes no ads and tracks no child; the channel does not undo that. Comments
  off, Made for Kids on.
- **Disclose AI generation** in the description, and describe the method that was actually
  used. Synthetic-media disclosure applies, and on a children's channel so does ordinary
  honesty.
- **Publishing is a human action.** Nothing in this repo uploads to YouTube.

### The voices

| use | voice | rate |
|---|---|---|
| English story narration | `en-IN-Chirp3-HD-Laomedeia` | 1.02 |
| Hindi | `hi-IN-Neural2-A` | 0.88 |

An Indian narrator is the point, not a preference — the old `en-US-Neural2-F` read the names
as a foreigner would, and it was noticed the first time a film ended. All 646 hook and moral
clips across the app's 323 stories have been re-recorded in it; a film's **first and last
shots are the hook and the moral**, so this is a film-facing fact, not just an app one.

Two failure modes in the app's narration that will reach a film:

- The synthesiser can return **200 OK with an empty MP3**. 34 silent clips shipped that way
  once. `repair-voice.py` in the app repo measures every clip and re-records anything under
  −20 dB or 0.35s.
- A **failed clip keeps its previous audio on disk.** A batch reporting "9 failed" has not
  left 9 missing files, it has left a *mixed corpus that looks fine*. Find them by mtime —
  whatever the pass did not touch — and re-record at fewer workers.

### Code

- The app is reached only through `pipeline/sources.js` / `sources.py`. **Never hard-code a
  path into a sibling checkout**, and never vendor a copy of the app's narration or art here
  — a copy is a fork, and a fork drifts.
- `build/` is never committed. Every input is in the repo and any cut rebuilds in minutes.
- **A finished film never goes in git.** YouTube is the channel, Drive is the archive, and
  `pipeline/publish.sh` publishes the 720p review preview only. git does not forget, so every
  master pushed is permanent, and GitHub refuses anything over 100 MiB — episode one's is
  71.8 MiB. Record what shipped in `films/<story>/released.json`: the film rebuilds from this
  repo, but *which cut is live* is the one fact that does not. docs/01 §6.
- **Never** put a real model identifier in commits, PRs, code, or any pushed artefact.

## Where things stand

**Eight films.** Each introduced one rig primitive, which is the unit of progress here:

| film | primitive | what it makes impossible to get wrong |
|---|---|---|
| `pt-talkative-tortoise` | `carry` | the stick's endpoints **are** the two geese's beak tips |
| `pt-monkey-crocodile` | `ride` | the rider is pinned to a saddle measured off the mount |
| `jt-crocodile-rock` | `rock` | the stone is the same stone, on the same waterline, all film |
| `pt-monkey-wedge` | `troop` | a crowd of *cast* is various by arithmetic, not by asking |
| `jt-partridge-elders` | `scale` | relative size is film-level, so it cannot drift between shots |
| `jt-monkey-gardener` | `world` | the place changes in one declared direction and never drifts back |
| `jt-golden-goose` | `count` | a set a child can count, whose arithmetic holds across the film |
| `fk-ridley-night` | `many` | a hundred instances that are a crowd and not a repeating tile |

Three of them are a different **kind** of promise from the first two, and that is the shape of
the work now. `carry` and `ride` are about one frame. `rock`, `scale`, `world` and `count` are
about the whole film — get one wrong and *no single shot is wrong*, so `film.js` accumulates
measurements across shots and checks the set after the loop.

**Put an invariant in the scene format before you put it in an assertion.** A shot may write
only `"rock": {}` or `"rock": {"on": "croc-lie"}`; only `"world": "uprooted"` and never a plate
beside it; only how many feathers are gold and how many are plain. There is no field for
moving, resizing or re-placing any of them, so those are not mistakes anyone can make. Cheaper
than any test. Film four's shot list got the log wrong *twice while it was still prose* — a
wedge lying loose beside a log still held open by its wedge is two wedges — and the fix was a
build-time refusal, not a note.

**Some things a prompt cannot promise, and it is worth knowing which.** A camera angle is a
structural fact: "a log lying on its side, seen from the side" came back end-on, standing up,
split like firewood. State the axis. And **gold is a ramp, not a hue** — five rounds of CSS
filter tuning could not make a white goose gold, because the information that reads as metal is
in the tone curve. `pipeline/gild.py` maps luminance through a gold ramp and keeps the alpha
channel exactly, which is both a better picture and a *checkable* promise that the golden goose
and the plain one are one drawing.

**A plate that claims a canonical composition is measured now.** Prose asking for "exactly the
same view" has failed silently twice — three river plates with three compositions on film
three, a yard that grew trees and moved the camera on film four — and both times a person had
to notice. `film.js` correlates the edge maps: canon-declared pairs in this repo score
0.62–0.97 and different places 0.10–0.17.

**An assertion that fires on a correct film is a bug in the assertion.** The size-ladder span
check fired on film six, where 2.8× between a man and a monkey is exactly right. The fix was
not to loosen it: a film that means it now declares `rig.ladderSpan`, and the check checks the
promise instead of assuming one.

**Prove an assertion by breaking it.** Every check added for these five was watched to fail
first — the monkey anchored on the top of his box (which is the wedge's head, not the log), a
gold cell that was a different drawing, a crowd on a perfect lattice, a plate claiming a canon
it does not match. Two earlier checks were worthless until that was done to them.

The app has **323 stories** and a cast of roughly 69. **The cast is shared**: cells live in
`cast/<character>/` and a film names what it needs in its `scenes.json` `cast` list. It now
holds monkey, crocodile, tortoise, goose, elephant, partridge, ridley — and **three humans**.

**The human cast is the one open editorial question.** `cast/gardener/`, `cast/mother/` and
`cast/daughter/` exist because three of the five films needed people and the planner had missed
it. Each `cast.json` says what is deliberately absent and why — no caste or religious marker, no
turban-and-moustache shorthand, no bindi or sindoor on a widow, no exaggerated feature, nobody a
type. **docs/03 flagged a reusable human as needing a person's judgement before publishing, and
that judgement has not been given.** Look at `films/jt-monkey-gardener/charsheet.png` and
`films/jt-golden-goose/charsheet.png` before any film with a person in it goes out.

Renders stream frames straight into ffmpeg and run `JOBS` shots at once (default: cores).
Combined with the per-shot cache, one changed shot costs one render rather than seventeen.

**Never show a cut you have not just rendered.** Check the timestamps. If a note arrived after
the render started, the render does not contain the fix — and from the outside that is
indistinguishable from the note being ignored. This cost a whole evening once.

## Where to pick up

The slate in [docs/03](docs/03-the-slate.md) is **made**. What is not done:

1. **A person looks at the human cast** (above). Everything else is blocked behind it for any
   film with people in it, which is most of the catalogue.
2. **Pick the next slate** with `node pipeline/plan.js --reuse`, and gate every candidate on
   `python3 pipeline/check-voice.py <story>` first, always. The planner's `people` pattern is
   still a name search — it missed "gardener" — so read the story before believing the cast
   cost.
3. **The primitives that are still missing** are the ones the next stories will name. Nothing
   in the catalogue yet needs a character to *hand something to* another character, or a
   vehicle, or weather. When one does, that film gets one primitive and only one.

## Branch

Development happens on `claude/youtube-videos-migration-cnlvns` unless told otherwise.

## Commit trailer

```
Co-Authored-By: Claude <noreply@anthropic.com>
```
