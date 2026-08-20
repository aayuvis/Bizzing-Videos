#!/usr/bin/env node
/* What would this story cost as a film? Answer it before authoring anything.
 *
 * Three films in, the expensive decisions are all made before a line of scenes.json exists:
 * which story, whose cast, how many shots, and whether the narration is sound. This reports
 * all four from the app, so a slate can be chosen on numbers rather than on which story
 * someone happened to remember.
 *
 *   node pipeline/plan.js jt-crocodile-rock            # one story
 *   node pipeline/plan.js --collection panch-more      # a whole collection
 *   node pipeline/plan.js --reuse                      # every story whose cast we already own
 *   node pipeline/plan.js --reuse --limit 20
 *
 * WHAT THE NUMBERS MEAN
 *
 *   shots     one per narration segment, two where a segment runs past 11s (docs/02 §4).
 *             Story three's 11 segments became 17 shots that way.
 *   cast      characters the text names, matched against cast/. `have` costs nothing;
 *             `new` is the real price of the film, because a character is drawn once for
 *             the channel and then reused forever (docs/02 §7).
 *   voice     the docs/02 §5.6 batch check. A story that fails it is not ready to build.
 *
 * The cast match is a NAME SEARCH over the story's own words, so it is a shortlist and not
 * a verdict -- a story can name a tiger once in passing and never show one. Read the hook
 * before believing the count. It is right far more often than it is wrong, and it is the
 * difference between planning a slate in an afternoon and planning it a story at a time.
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const S = require('./sources');

const FF = execFileSync('python3',
  ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();

const slug = s => String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');

/* Every character the library already holds, and the words that mean it. A cast directory is
   the source of truth for what exists; the aliases are only for finding it in prose. */
const ALIAS = {
  monkey: /\bmonkeys?\b/i, crocodile: /\bcrocodiles?\b/i, tortoise: /\btortoises?|turtles?\b/i,
  goose: /\bgeese|goose\b/i,
};
function library() {
  const d = path.join(S.REPO, 'cast');
  return fs.existsSync(d) ? fs.readdirSync(d).filter(c =>
    fs.statSync(path.join(d, c)).isDirectory()) : [];
}

/* Characters a story actually names. Deliberately a short, common list: an animal that turns
   up in one story turns up in fifty, and those are the ones worth drawing first. */
const COMMON = {
  /* EVERY ALTERNATION IS GROUPED, and that is not style. `/\bbulls?|oxen|ox\b/` parses as
     `(\bbulls?)|(oxen)|(ox\b)`, so the last branch carries no leading boundary and matches
     inside "box" -- which is how the planner reported that The Goose Who Gave Gold needs a
     bull. It needs a box. `hares?\b` matches "shares" the same way. */
  monkey: /\b(monkeys?)\b/i, crocodile: /\b(crocodiles?)\b/i,
  tortoise: /\b(tortoises?|turtles?)\b/i, goose: /\b(geese|goose)\b/i,
  lion: /\b(lions?)\b/i, tiger: /\b(tigers?)\b/i, jackal: /\b(jackals?)\b/i,
  rabbit: /\b(rabbits?|hares?)\b/i, elephant: /\b(elephants?)\b/i, crow: /\b(crows?)\b/i,
  deer: /\b(deer)\b/i, snake: /\b(snakes?|cobras?)\b/i, mouse: /\b(mouse|mice)\b/i,
  parrot: /\b(parrots?)\b/i, heron: /\b(herons?|cranes?)\b/i, bull: /\b(bulls?|oxen|ox)\b/i,
  dog: /\b(dogs?)\b/i, cat: /\b(cats?)\b/i, mongoose: /\b(mongooses?)\b/i,
  camel: /\b(camels?)\b/i, bear: /\b(bears?)\b/i, fish: /\b(fish)\b/i,
  frog: /\b(frogs?)\b/i, peacock: /\b(peacocks?)\b/i,
  people: /\b(mother|father|daughters?|sons?|wife|husband|girls?|boys?|villagers?|carpenters?)\b/i,
};
function secsOf(file) {
  if (!fs.existsSync(file)) return null;
  let err = '';
  try { execFileSync(FF, ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr); }
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : null;
}

/* DEITIES ARE NOT ON THE CHANNEL'S LIST (docs/01 §3), and cheapness will not tell you so.
   ep-squirrel-bridge is the second-cheapest film in the whole catalogue by cast cost and it
   is a Ramayana story that names Rama, so it is exactly the film not to make. A planner that
   ranks only by cost recommends it first.
 
   THE FIRST VERSION OF THIS LIST WAS HINDU-ONLY, which is a poor screen on a channel whose
   whole point is that internal diversity is the point. It sailed straight past
   fk-santhal-first-birds, a Santhal creation story that names Thakur Jiu -- as sacred to the
   people who tell it as any name below. A closed list of names cannot be complete, so there
   is a second, wider net: anything that reads as religious gets flagged for a human rather
   than judged here. Neither list drops a story silently; the call belongs to a person. */
const SACRED = /\b(rama|sita|vishnu|shiva|krishna|hanuman|lakshmi|durga|ganesha|brahma|indra|parvati|kali|kurma|varaha|narasimha|thakur jiu|marang buru|allah|nanak|mahavira|jesus|bodhisatta)\b/i;
const RELIGIOUS = /\b(god|goddess|gods|deity|deities|the great one|creator|prayed|prayer|temple|shrine|worship|sacred|holy)\b/i;

function plan(story, have) {
  const id = slug(story.id);
  const segs = ['hook'].concat((story.scenes || []).map((_, i) => String(i))).concat(['moral']);
  let total = 0, shots = 0, missing = 0;
  for (const seg of segs) {
    const s = secsOf(S.narration(id, seg));
    if (s == null) { missing++; continue; }
    total += s + 0.35;
    shots += s > 11 ? 2 : 1;      // docs/02 §4: a long line gets a second picture
  }
  const text = [story.title, story.hook, story.moral]
    .concat((story.scenes || []).map(x => x.text || x)).join(' ');
  const named = Object.keys(COMMON).filter(k => COMMON[k].test(text));
  const sacred = [...new Set((text.match(new RegExp(SACRED.source, 'gi')) || [])
    .map(x => x.toLowerCase()))];
  const religious = !sacred.length && RELIGIOUS.test(text);
  return {
    id, title: story.title, collection: story.collection, badge: story.badge,
    segs: segs.length, missing, shots,
    secs: total + 3.5,                                   // + the end card
    have: named.filter(n => have.includes(n)),
    fresh: named.filter(n => !have.includes(n)),
    sacred, religious,
  };
}

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const val = f => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : null);
const names = argv.filter((a, i) => !a.startsWith('-') && argv[i - 1] !== '--collection'
  && argv[i - 1] !== '--limit');

const have = library();
let stories = S.stories();
if (val('--collection')) stories = stories.filter(s => s.collection === val('--collection'));
else if (flag('--reuse')) {
  stories = stories.filter(s => {
    const t = [s.title, s.hook, s.moral].concat((s.scenes || []).map(x => x.text || x)).join(' ');
    return have.some(c => ALIAS[c] && ALIAS[c].test(t));
  });
} else if (names.length) {
  stories = stories.filter(s => names.includes(slug(s.id)));
}
if (!stories.length) { console.error('no stories matched'); process.exit(1); }

console.log('cast library: ' + (have.join(', ') || '(empty)') + '\n');
const rows = stories.map(s => plan(s, have));
/* cheapest first: a film that needs no new character is a scenes.json and a render */
rows.sort((a, b) => a.fresh.length - b.fresh.length || a.shots - b.shots);
const lim = Number(val('--limit') || 0);
const show = lim ? rows.slice(0, lim) : rows;

console.log('id'.padEnd(24) + 'shots  mins  new cast'.padEnd(30) + 'reuses');
for (const r of show) {
  const mins = (r.secs / 60).toFixed(1);
  console.log(r.id.padEnd(24) + String(r.shots).padStart(4) + '  ' + mins.padStart(4) + '  ' +
    (r.fresh.length ? (r.fresh.length + ': ' + r.fresh.join(',')) : 'none').padEnd(28) +
    (r.have.join(',') || '-') + (r.missing ? '   !! ' + r.missing + ' clips missing' : '') +
    (r.sacred.length ? '   !! names ' + r.sacred.join(',') + ' — not for the channel' : '') +
    (r.religious ? '   ?  religious content — a person decides' : ''));
}
console.log('\n' + show.length + ' of ' + rows.length + ' shown. Run check-voice.py on any ' +
  'story before authoring it (docs/02 §5.6).');
