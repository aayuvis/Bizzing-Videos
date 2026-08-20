# 03 — The next five films

**Status:** a plan, not a commitment. Chosen with `pipeline/plan.js` from the app's own 323
stories, then filtered by hand for the things a planner cannot judge. Numbers are measured
from the narration, not estimated.

Three films are made. The unit of progress here is **one rig primitive per film** (docs/02
§3, Rule 2), so these five are ordered by what they teach the pipeline, not only by what they
cost. Each is also cheap, because the shared cast is now doing its job.

| # | film | shots | mins | new cast | primitive it needs |
| --- | --- | --- | --- | --- | --- |
| 4 | `pt-monkey-wedge` | 15 | 1.8 | **none** | `troop` — a crowd that is *cast*, not scenery |
| 5 | `jt-partridge-elders` | 16 | 1.9 | elephant | `scale` — three sizes, and size is the plot |
| 6 | `fk-santhal-first-birds` | 18 | 2.1 | **none** | `world` — the plate's own state changes across the film |
| 7 | `jt-golden-goose` | 17 | 2.0 | bull | `count` — a set that visibly changes |
| 8 | `fk-ridley-night` | 18 | 2.8 | **none** | `many` — one sprite at a hundred instances |

**Three of the five need no new character at all.** That is the cast library paying out: five
films for two new drawings, against fifteen generated assets for each of the first two films.
All five pass the narration gate (`check-voice.py`) as of 2026-08-20.

---

## 4. The Monkey and the Wedge — `troop`

*panch-more · 🪔 Katha · "If you do not know what something is holding up, do not pull it out."*

**Why this one first:** it closes a hole in the brief. docs/02 §5.7 says crowds belong in the
plate *because they never recur* — a village that runs out to look up is scenery. This story's
troop of monkeys **acts**: they come down off the wall, try the saw, sit in the bucket, and one
of them pulls the wedge. A crowd of cast is a different problem from a crowd of scenery, and
the rule as written does not cover it.

**What would be embarrassing on screen:** six identical monkeys in a row, in step, like a
sprite sheet. The primitive has to make instances of one drawing read as individuals — varied
scale, flip, phase offset on the idle animation, and a rule that no two adjacent monkeys share
all three. That is arithmetic, which means it can be asserted.

**Also new:** the wedge. The two halves of the log are held apart *by a prop*, and when the
prop leaves they close. Second candidate primitive; may be worth splitting into film 9 rather
than doing two new things at once.

**Editorial:** the app's retelling deliberately lets the monkey live and says so in the text.
Match it. Never braver than the text — his tail is caught, and that is all.

## 5. Who Was Here First? — `scale`

*jataka-more · 🪔 Katha · "Big is not the same as first, and loud is not the same as either."*

An elephant, a monkey and a small brown bird argue about who defers to whom. **Relative size
is the plot**, exactly as the rock's height was the plot in film three — which makes it the
same class of invariant and a natural successor. If the elephant is not overwhelmingly bigger
than the partridge in every frame they share, the argument is not about anything.

**The primitive:** a declared size ladder for the film, and characters scaled from it rather
than per shot. Assert that the ordering holds in every frame where two of them appear, and
that the ratios stay within a tolerance across the whole film — cross-shot, like `rock`.

**Cost:** one elephant. Worth drawing early on reuse grounds alone; it is one of the most
frequently named animals in the catalogue.

## 6. The Two Birds and the First Morning — `world`

*desh-more · 🪔 Katha · "The world got built by whoever could actually do the job."*

A Santhal creation story: nothing but water, two exhausted birds, and a worm and a tortoise who
between them make the first land. **The plate itself changes state across the film** — open
water becomes an island. `rock` promised the world *stayed the same*; this one promises it
changes in exactly one declared way and never drifts otherwise.

This is the plate-canon mechanism from film three pointed at a sequence: each stage names the
previous as its canonical composition, so the land grows and nothing else moves. That machinery
already exists and has not been stretched yet.

**Cost:** none — tortoise and crocodile are drawn. The two birds are the open question; read
the text before assuming they need new cells rather than the goose.

## 7. The Goose Who Gave Gold — `count`

*jataka-more · 🪔 Katha · "Take what is given and it stays gold. Grab, and it turns to feathers."*

One golden feather per visit, until they grab and it turns to ordinary feathers. **A countable
set that changes across shots**, and a character who changes appearance without becoming a
different character — the same problem the blue jackal poses, and the same problem the shared
cast has to solve properly one day.

**What would be embarrassing:** the pile of feathers not matching the number of visits, or the
goose after the grab reading as a *second* goose rather than the same bird plainly.

**Cost:** one bull, and check whether it is more than a passing mention before drawing it.

## 8. The Night the Sea Comes Ashore — `many`

*desh-east · 🧭 **Aaj** · an Odisha beach, one of the great gatherings on Earth*

**The first non-fable and the first Aaj film**, which the channel needs — three animal
stories in a row is a genre, not a channel. Olive ridleys coming ashore in the dark to nest.

**The primitive:** one sprite at a hundred instances, placed on a ground plane with depth, and
none of it reading as a repeating tile. It is `troop` at a scale where individual authoring is
impossible, so it has to be generated and asserted rather than placed.

**Editorial:** this is 🧭 Aaj — how it lives today — so it carries a factual claim in a way a
katha does not. The moral is about switching lights off for the turtles. Do not embellish
beyond the app's text, and keep the crowd ordinary: no hero turtle.

---

## Excluded, and why it matters

`ep-squirrel-bridge` — *The Squirrel Who Built the Bridge* — is the **second-cheapest film in
the catalogue** by cast cost, 14 shots, 1.6 minutes, and a lovely moral. It is a Ramayana story
and it names Rama.

Deities are not on the channel's list (docs/01 §3). A planner ranking by cost recommends it
first, which is exactly why `plan.js` now screens for sacred names and flags them rather than
dropping them silently — the call belongs to a person, and it should be an obvious one to make.

`pu-samudra-manthan` is out for the same reason: Kurma is an avatar of Vishnu.

## Before authoring any of them

1. `python3 pipeline/check-voice.py <story>` — all five pass today; re-run if the app
   re-records anything.
2. `node pipeline/plan.js <story>` — shot count and cast cost.
3. Read the story's own text end to end. The cast match in `plan.js` is a name search, so it
   over- and under-counts; film three's stepping stone was never going to show up in it.
4. Decide the primitive **before** the shot list, and put the invariant in the scene format
   before you put it in an assertion.
