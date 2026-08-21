# 03 — The next five films

**Status: made.** All five are authored, checked and cut. This page is now the record of what
they cost and what each one taught the pipeline, plus the one decision they left open.

Three films existed when this was written. There are eight now. The unit of progress is still
**one rig primitive per film** (docs/02 §3, Rule 2), and these five were ordered by what they
teach rather than only by what they cost.

| # | film | shots | run | new cast | primitive | outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | `pt-monkey-wedge` | 15 | 1:48.8 | none | `troop` | cut, checks pass |
| 5 | `jt-partridge-elders` | 16 | 1:52.5 | elephant, partridge | `scale` | cut, checks pass |
| 6 | `jt-monkey-gardener` | 17 | 1:58.3 | **gardener** | `world` | cut, checks pass |
| 7 | `jt-golden-goose` | 17 | ~1:58 | **mother, daughter** | `count` | cut, checks pass |
| 8 | `fk-ridley-night` | 18 | ~2:51 | ridley | `many` | cut, checks pass |

Every one is gated on `check-voice.py` and every one holds picture against narration inside
half a second.

---

## What each one actually taught

**4 — The Monkey and the Wedge · `troop`.** A crowd that is *cast*, not scenery. docs/02 §5.7
puts crowds in the plate because they never recur, which is right for a village that runs out to
look up and wrong for a troop of monkeys who come down off the wall and pull the wedge. One cell
at six instances fails one way and fails completely — identical animals, evenly spaced, facing
the same way, breathing in step — so the rig places them *and* varies them from a seeded
generator, and film.js asserts no two neighbours share both size and facing.

It also put the **log** in the rig, which is not a second primitive: it is the `rock` lesson at a
quarter of the size. The shot list got the log wrong twice while it was still prose — a loose
wedge lying beside a log still held open by its wedge is two wedges — and both faults are now
build-time refusals. The two cells also came back at different proportions, so placing the log by
height would have made it 24% *longer* at the exact cut where it snaps shut; it is fitted by
width with its underside on a declared ground line.

**5 — Who Was Here First? · `scale`.** A declared size ladder for the film, with characters
scaled from it rather than per shot, so a partridge cannot creep up to a convenient size the
moment she has a line. Also `tower`: the three of them stacked, each one's bottom edge computed
as the one below's top edge.

**6 — The Monkeys Who Watered the Garden · `world`.** The counterpart to `rock`. `rock` promised
the world *stayed the same* across a film; this promises it changes, in one declared direction,
and never drifts back. Four garden stages are film-level and ordered, and a garden shot writes
`"world": "uprooted"` *instead of* a plate — so it cannot show a stage that is not one of the
four, and film.js checks the sequence never runs backwards and that both ends appear.

**7 — The Goose Who Gave Gold · `count`.** A set a child can count, that changes. The two
embarrassing outcomes this page predicted — the feathers not matching, and the goose after the
grab reading as a *second* goose — turned out to have one answer: **the gold and the white are
the same drawing.** `pipeline/gild.py` maps luminance through a gold ramp and keeps the alpha
channel exactly, so film.js can compare the two PNGs and prove it. (This was a CSS filter first.
It cannot work: sepia preserves luminance, so a white bird stays white until the chroma is pushed
far enough to make a lemon rubber duck. Gold is a ramp, not a hue.)

**8 — The Night the Sea Comes Ashore · `many`.** `troop` at a scale where hand-placing is not a
thing a person does: 116 turtles on a beach that has to read as a crowd and not as wallpaper.
Instances are dealt to rows by inverse width — a receding plane holds more at the back — jittered
inside their cells, bricked to break the banding, then *relaxed* until nobody is drawn through
anybody. Jitter alone cannot do it: turn it up until the spacing looks natural and you get
pile-ups; turn it down until the pile-ups stop and you get a tile. Both were measured happening.

It also needed **night grading**. A sprite drawn on white for daylight glows when it is dropped
onto a moonlit beach: a hundred olive ridleys came out looking like pale eggs under a floodlight,
in a film whose moral is about switching lights off.

---

## The open decision: the human cast

**It was not avoidable and it has been made provisionally, not settled.** Three of these five
needed people, not two — the planner's `people` pattern was a name search and it did not contain
the word *gardener*, so film 6 was costed at zero new cast and has a man with four lines of
dialogue in it. (The pattern now lists the trades; it will still under-count, which is why
reading the story is step 3 below.)

So the channel now has three human characters: `cast/gardener/`, `cast/mother/` and
`cast/daughter/`. Each `cast.json` records what is deliberately absent and why, because a
*reusable* human on an Indian children's channel has to carry docs/01's rule about nobody being a
type without a crowd to be various in:

- no caste marker of any kind, and no janeu
- no religious mark — no tilak, no cap, no cross
- no bindi or sindoor on the widow: a widow's presentation is a live and painful subject in
  Indian households and this channel does not make a costume of it
- no turban-and-curled-moustache shorthand for "Indian man"
- no exaggerated features, no comic nose, no comic belly
- poor, and not a costume: plain undyed cotton, bare feet, mended clothes

The first pass came back in a stock-vector hand — thin outlines, gradient skin — and bare-chested
with a grey beard, which reads as a sage and walks straight into territory this channel avoids.
Both were fixed. What has *not* happened is a person looking at them.

**A person should look at `films/jt-monkey-gardener/charsheet.png` and
`films/jt-golden-goose/charsheet.png` before any film with a person in it is published.** That is
the same call this page asked for before a prompt was written; the prompts got written because
the slate could not be finished otherwise, and the call is still owed.

## Excluded, and why it matters

`ep-squirrel-bridge` — *The Squirrel Who Built the Bridge* — is the **second-cheapest film in
the catalogue** by cast cost, 14 shots, 1.6 minutes, and a lovely moral. It is a Ramayana story
and it names Rama.

Deities are not on the channel's list (docs/01 §3). A planner ranking by cost recommends it
first, which is exactly why `plan.js` screens for sacred names and flags them rather than
dropping them silently — the call belongs to a person, and it should be an obvious one to make.

`pu-samudra-manthan` is out for the same reason: Kurma is an avatar of Vishnu.
`fk-santhal-first-birds` was dropped from this slate for the same reason, late: it is a Santhal
creation story naming **Thakur Jiu**, and the first sacred-name screen was Hindu-only and sailed
straight past it. A closed list of names can never be complete, so `plan.js` carries a second,
looser net that flags anything reading as religious for a person to judge.

## Before authoring any of them

1. `python3 pipeline/check-voice.py <story>` — the docs/02 §5.6 gate. Always first.
2. `node pipeline/plan.js <story>` — shot count and cast cost.
3. **Read the story's own text end to end.** The cast match is a name search, so it over- and
   under-counts: it missed film three's stepping stone and film six's gardener.
4. Decide the primitive **before** the shot list, and put the invariant in the scene format
   before you put it in an assertion.
5. **Break every new assertion once** and watch it fail. Two of the checks in this pipeline were
   worthless until that was done to them, and both looked fine passing.
