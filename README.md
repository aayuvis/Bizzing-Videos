# Bizzing Videos

The story films that go out on the Bizzing YouTube channels — the pipeline that makes them,
the assets they are made of, and the two documents that are binding on anything published
under the brand.

This repo serves every Bizzing property. Today that is
[Bizzing India](https://github.com/aayuvis/bizzingindia.com); the same pipeline and the same
rules apply to [Bizzing Bee](https://github.com/aayuvis/Bizzing-Bee) when it starts a
channel.

## Read these two things first

- **[docs/02 — the production brief](docs/02-production-brief.md).** Written to be read
  cold, by someone who was not in the room. Its first section is the one that costs money.
- **[docs/01 — the look and feel](docs/01-look-and-feel.md).** Binding on every video
  published under the brand.

Two rules carry everything else:

> **Nothing on the channel is invented for the channel.** The words, the narration, the
> characters and the world all come out of the app. A child who watches a video and then
> opens the app must meet the *same* tortoise. If the video has a better tortoise than the
> app, the video is wrong — go and fix the app.

> **No generated motion.** Films are composited locally from generated sprites and plates.
> Generative *image* models draw the sprites, the plates and the model sheets; generative
> *video* is out, because a model with no scene cannot guarantee a structural fact like
> "both geese are holding the stick" — it can only be asked for. Four full rounds proved
> that on one eighty-seven-second film. See docs/02 §1 before you spend anything.

## What it needs

- **A Bizzing India checkout**, because the app is the source of truth for the words, the
  narration, the type and the story paintings. Put it beside this one, or name it:

  ```bash
  git clone https://github.com/aayuvis/bizzingindia.com ../bizzingindia.com
  # or
  export BIZZING_INDIA=~/src/bizzingindia.com
  ```

  Every stage resolves it through `pipeline/sources.js` (and `sources.py`), which fails with
  instructions rather than half-rendering a film.
- **Node** with `npm install` (Playwright drives a headless Chromium frame by frame).
- **Python 3** with `pillow` and `imageio-ffmpeg`.
- **`GEMKEY`** in the environment, for the asset generator only. Nothing else calls an API.

## Making a film

The order matters and it is the order that saves money — the long version is docs/02 §4.

```bash
export STORY=pt-monkey-crocodile      # one env var picks the film, everywhere

npm run assets      # ONE-TIME per story: sprites and character-free plates (costs API calls)
npm run cards       # title and end cards, set in the app's own type
npm run build       # scenes.json -> one HTML page per shot, with measured anchors
npm run check       # the contact assertions, rendering nothing
npm run still -- 07 # one paused frame of shot 07, in about a second
npm run film        # render every shot, each cut to exactly its narration
npm run cut         # join, mux the app's narration, master + preview
```

Then, if a reviewer needs to watch the whole thing, publish the **preview** — a new cut gets
a content-addressed URL, so a link you hand someone cannot be stale:

```bash
pipeline/publish.sh build/$STORY/$STORY-preview.mp4 video/monkey-crocodile-720p.mp4
```

**The master never goes in git.** It goes to YouTube, which is the channel, and to Drive,
which is the archive; `publish.sh` refuses anything over 25 MB for exactly that reason.
Record what went out in `films/<story>/released.json` — a film rebuilds from this repo, but
*which cut is live* does not, so that is the one thing worth committing. docs/01 §6 covers
all of it, along with the title, the description and the disclosure line.

Uploading to YouTube stays a human action, on purpose.

### The three habits that pay for themselves

- **Assert what a viewer would complain about.** A harness, a bird-ride and a set of bared
  teeth all got through review by eye. Contact is measured out of the live DOM per shot and
  a failure is an exit code (`npm run check`).
- **Look at a still before you render.** Almost every note is about a single moment — where
  the bubble sits, who is facing where, what is touching what. None of them need a video.
- **One renderer per film.** `film.js` takes a pid lock. Two renderers sharing an output
  directory produce a film that is neither build, which from the outside looks exactly like
  your fixes being ignored.

## Layout

```
docs/01-look-and-feel.md     binding: the look, the editorial rules, publishing
docs/02-production-brief.md  binding: how films are made, and every trap already paid for
pipeline/                    the renderer — sources.js is the seam onto the app
films/<story>/               scenes.json, assets.json, sprites, plates, cards, charsheet
                             released.json — which cut is live, and what is wrong with it
archive/veo-story.py         the abandoned generative path, kept as evidence
build/                       output; not committed, rebuilt from source in minutes
```

A film is `films/<story>/scenes.json` plus its art. A note from a reviewer is an edit to a
number in that file and a re-render that costs nothing.

## History

The pipeline was built inside `bizzingindia.com` and split out here with its history intact
— `git log` runs back through both films, and the commit subjects are the record of what
went wrong. `git log --follow` works across the move.
