'use strict';
/* WHERE THE APP IS — the one thing this repo cannot hold itself.
 *
 * Rule 1 of docs/02: nothing on the channel is invented for the channel. The words, the
 * narration, the typefaces and the story painting all come out of the Bizzing India app,
 * so that a child who watches a film and then opens the app meets the same tortoise. That
 * rule is the reason this file exists rather than a `voice/` directory in this repo: a
 * copy is a fork, and a fork drifts. The app is read live, and it is the source of truth.
 *
 * (It is also half a gigabyte of narration. Vendoring it here would be a second copy of
 * the library that goes stale the first time a line is re-recorded.)
 *
 * Resolution order:
 *   1. $BIZZING_INDIA           — a checkout you name
 *   2. ../bizzingindia.com      — a checkout sitting beside this one
 *
 * Nothing is guessed silently: if neither is there, the first call says so and says what
 * to do about it, because "no narration for seg 03" twelve shots into a render is a much
 * worse way to find out.
 */
const fs = require('fs'), path = require('path');

const REPO = path.join(__dirname, '..');
const CANDIDATES = [
  ['$BIZZING_INDIA', process.env.BIZZING_INDIA],
  ['beside this repo', path.join(REPO, '..', 'bizzingindia.com')],
].filter(([, p]) => p);

/* A checkout is the real thing if it has the two files every stage needs: the app's design
   tokens and its narration library. Testing for the directory alone matches an empty clone
   and fails later, in the middle of a render, which is the failure this check exists to
   move forward. */
const looksRight = d => fs.existsSync(path.join(d, 'tokens.css')) &&
                        fs.existsSync(path.join(d, 'voice'));

let cached = null;
function appDir() {
  if (cached) return cached;
  const tried = [];
  for (const [why, root] of CANDIDATES) {
    // accept either the checkout root or the app/ directory inside it
    for (const dir of [path.join(root, 'app'), root]) {
      tried.push('  ' + dir + '   (' + why + ')');
      if (looksRight(dir)) return (cached = path.resolve(dir));
    }
  }
  throw new Error(
    'Cannot find the Bizzing India app.\n\n' +
    'The films are cut to the app\'s own narration and set in the app\'s own type — nothing\n' +
    'on the channel is invented for the channel (docs/02 §3, Rule 1) — so this repo needs a\n' +
    'bizzingindia.com checkout to read from:\n\n' +
    '    git clone https://github.com/aayuvis/bizzingindia.com ../bizzingindia.com\n\n' +
    'or point BIZZING_INDIA at one you already have:\n\n' +
    '    BIZZING_INDIA=~/src/bizzingindia.com npm run build\n\n' +
    'Looked in:\n' + tried.join('\n') + '\n');
}

/** A path inside the app checkout. */
const app = (...p) => path.join(appDir(), ...p);

/** The same, as an absolute file: URL — for a generated page that is not next to the app. */
const url = (...p) => 'file://' + app(...p);

/** The narration clip a shot is cut to: app/voice/st/<slug>-<seg>.mp3 */
const narration = (slug, seg) => app('voice', 'st', slug + '-' + seg + '.mp3');

/** The story's own painting, the source of the palette and the landscape (docs/01 §1). */
const painting = slug => app('art', 'story', slug + '.jpg');

/** Every story the app tells, read out of its data files rather than retyped. */
function stories() {
  const vm = require('vm');
  const W = { window: {} }; W.window = W; vm.createContext(W);
  fs.readdirSync(appDir()).filter(f => /^data-stories.*\.js$/.test(f)).sort()
    .forEach(f => vm.runInContext(fs.readFileSync(app(f), 'utf8'), W, { filename: f }));
  return ['IND_STORIES', 'IND_STORIES_REGIONAL', 'IND_STORIES_MORE', 'IND_STORIES_SOUTH',
    'IND_STORIES_NORTH', 'IND_STORIES_EAST', 'IND_STORIES_WEST', 'IND_STORIES_NE_A',
    'IND_STORIES_NE_B', 'IND_STORIES_MODERN', 'IND_STORIES_VIGYAN']
    .reduce((a, k) => a.concat(W[k] || []), []);
}

/* The app's own name for a collection. A title card that says "JATAKA-MORE" is showing a
   child a database key; the app calls it "More Jataka Tales" and Rule 1 says the words on the
   channel are the app's words. Same evaluation trick as stories(). */
function collections() {
  const vm = require('vm');
  const W = { window: {} }; W.window = W; vm.createContext(W);
  fs.readdirSync(appDir()).filter(f => /^data-stories.*\.js$/.test(f)).sort()
    .forEach(f => vm.runInContext(fs.readFileSync(app(f), 'utf8'), W, { filename: f }));
  return ['', '_REGIONAL', '_MORE', '_SOUTH', '_NORTH', '_EAST', '_WEST', '_NE_A', '_NE_B',
    '_MODERN', '_VIGYAN', '_DASHAVATARA', '_DEVASURA']
    .reduce((a, k) => a.concat(W['IND_COLLECTIONS' + k] || []), []);
}

/* THE CAST IS SHARED, THE FILM IS NOT.
 *
 * Every film used to generate its own sprites, so the monkey in story two and the monkey in
 * story three would have been two drawings of the same animal -- which is the drift Rule 1
 * exists to stop, arriving through the back door. Across 323 stories there are about 69
 * distinct cast members, so a character drawn once and reused is the difference between a
 * per-film art cost and a fixed one for the whole channel.
 *
 * A film declares `cast: ["monkey", "crocodile"]` in its scenes.json and gets those cells.
 * Sprites that belong to one film only -- a prop, a one-off -- still live in the film's own
 * sprites/ directory, which is searched last, so a film can override a cast cell by name if
 * it ever genuinely needs to.
 */
function spriteDirs(scenes) {
  const dirs = ((scenes && scenes.cast) || []).map(c => path.join(REPO, 'cast', c));
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      throw new Error('scenes.json names cast "' + path.basename(d) + '" but ' + d +
        ' does not exist.\nCast members live in cast/<character>/ and are shared across films.');
    }
  }
  dirs.push(path.join(FILM, 'sprites'));       // film-only sprites win, and may not exist
  return dirs.filter(d => fs.existsSync(d));
}

/* WHICH FILM, and where its pieces live. One env var picks the story; every path hangs off
   it, so no stage carries knowledge of any particular film. */
const STORY = process.env.STORY || 'pt-talkative-tortoise';
const FILM = path.join(REPO, 'films', STORY);
const OUT = path.join(REPO, 'build', STORY);

module.exports = { REPO, STORY, FILM, OUT, appDir, app, url, narration, painting, stories, collections,
                   spriteDirs };
