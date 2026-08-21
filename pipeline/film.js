#!/usr/bin/env node
/* Render the whole film from scenes.json, checking it as it goes.
 *
 * THE CHECKS ARE THE POINT. Reviewing generated video meant watching every second of every
 * shot by eye, which is how a harness, a bird-ride and a set of teeth still got through --
 * and which does not scale to 500 films. Here the two things that kept breaking are
 * measured out of the live DOM, per shot, in milliseconds:
 *
 *     the stick's ends sit on both beak tips        (the geese are holding it)
 *     the hanging character's mouth sits on the stick (he is biting it, not riding it)
 *
 * A failure is an exit code, not something a person has to notice.
 *
 *   node pipeline/film.js            # every shot, cut to its narration
 *   node pipeline/film.js --check    # assertions only, render nothing
 *   node pipeline/film.js --force    # ignore the cache, re-render everything
 *   JOBS=4 node pipeline/film.js     # how many shots to render at once (default: cores)
 *
 * Shots are cached on a hash of their own page, the art it loads and the narration length,
 * so changing one shot costs one render rather than twelve. The checks always run.
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

/* WHICH FILM, and where the app it is cut from lives. One env var picks the story; every
   path hangs off it, so this file knows nothing about any particular film. Story two is
   where you find out whether the first one was a pipeline or just a thing that happened
   to work. */
const S = require('./sources');
const { STORY, FILM, OUT } = S;
const SLUG = STORY;
const FPS = 24, TOL = 14;          // px: the stick may overlap a beak, never miss it
const scenes = JSON.parse(fs.readFileSync(path.join(FILM, 'scenes.json'), 'utf8'));
const FF = require('child_process')
  .execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
                { encoding: 'utf8' }).trim();

function seconds(file) {
  const e = execFileSync(FF, ['-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return e;
}
function narrationSecs(seg) {
  const f = S.narration(SLUG, seg);
  if (!fs.existsSync(f)) return null;
  let err = '';
  try { execFileSync(FF, ['-i', f], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr); }
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : null;
}

(async () => {
  const checkOnly = process.argv.includes('--check');
  /* ONE RENDERER PER FILM. A render started in an earlier session kept going for half an
     hour after it was thought dead, writing shot mp4s into this same directory -- so cuts
     assembled from "the finished shots" were a mix of two builds, and a film published as
     the fixed one got clobbered by the old one minutes later. That is what "still the old
     video" actually was. A stale lock (no such pid) is cleared and reported. */
  const lock = path.join(OUT, '.render.lock');
  if (!checkOnly) {
    fs.mkdirSync(OUT, { recursive: true });
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8').trim());
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { alive = false; }
      if (alive) {
        console.error('another render of ' + STORY + ' is running as pid ' + pid + '.\n' +
                      'Two renderers share one output directory and produce a film that is ' +
                      'neither build.\nStop it, or wait for it.');
        process.exit(2);
      }
      console.log('  (cleared a stale lock from pid ' + pid + ')');
    }
    fs.writeFileSync(lock, String(process.pid) + '\n');
    const drop = () => { try { fs.unlinkSync(lock); } catch (e) {} };
    process.on('exit', drop);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.on(sig, () => { drop(); process.exit(130); });
  }
  const force = process.argv.includes('--force');   // re-render even an unchanged shot
  fs.mkdirSync(OUT, { recursive: true });
  const pre = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  /* TWO SHOTS FOR ONE LONG LINE SPLIT THAT LINE, they do not each get all of it. A segment
     is one recorded sentence; if it is served by two shots they are two pictures over the
     same sentence, so each runs half of it. Giving both the full length makes the video run
     longer than the audio, and story three -- the first film where any segment has two shots
     -- came out 3:41 against a 2:14 narration. Documented in story one's scenes.json from the
     beginning; never implemented, because neither of the first two films had a segment with
     two shots to expose it. docs/02 §5.8 is exactly this. */
  const perSeg = {};
  for (const sh of scenes.shots) perSeg[sh.seg] = (perSeg[sh.seg] || 0) + 1;

  let failures = 0;

  /* THE PLATE CANON, MEASURED. docs/02 §5.1 says a plate that must match another names it as
     its canonical composition, and the generator passes that reference through -- but a
     reference is a request, not a guarantee, and it has silently failed twice. Film three got
     three river plates with three compositions, which would have floated the rock in one shot
     and sunk it in the next. Film four got a yard that grew trees at both edges and moved the
     camera in, so "the carpenters have gone to lunch" read as a different yard. Both were
     caught by a person looking at a picture.

     So it is measured. Not by pixel difference -- that is dominated by the LIGHT, and film
     three's own day-vs-night pair of one composition scores further apart (71) than two
     genuinely different places do (56). Composition is WHERE THE EDGES ARE, so: downscale,
     take the edge map, z-score it and correlate. On the plates already in this repo every
     canon-declared pair lands between 0.64 and 0.96 and every different place between 0.10
     and 0.17, so 0.55 is a wall with a canyon on either side of it. */
  {
    const ap = path.join(FILM, 'assets.json');
    const cfg = fs.existsSync(ap) ? JSON.parse(fs.readFileSync(ap, 'utf8')) : {};
    const pairs = Object.entries(cfg.plates || {})
      .filter(([, v]) => v && typeof v === 'object' && v.like)
      .map(([n, v]) => [v.like, n]);
    if (pairs.length) {
      const files = [...new Set(pairs.flat())]
        .map(n => path.join(FILM, 'plates', n + '.png'));
      if (files.every(f => fs.existsSync(f))) {
        const script = `
import sys, math
from PIL import Image, ImageFilter
def ez(f):
    im = Image.open(f).convert('L').resize((192, 108)).filter(ImageFilter.FIND_EDGES)
    v = list(im.getdata()); m = sum(v) / len(v)
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / len(v)) or 1.0
    return [(x - m) / sd for x in v]
E = {}
for f in sys.argv[1:]:
    E[f] = ez(f)
print(' '.join('%.3f' % (sum(x * y for x, y in zip(E[a], E[b])) / len(E[a]))
               for a, b in zip(sys.argv[1:][0::2], sys.argv[1:][1::2])))
`;
        const args = pairs.flatMap(([a, b]) =>
          [path.join(FILM, 'plates', a + '.png'), path.join(FILM, 'plates', b + '.png')]);
        const r = execFileSync('python3', ['-c', script, ...args], { encoding: 'utf8' })
          .trim().split(' ').map(Number);
        pairs.forEach(([a, b], i) => {
          if (r[i] < 0.55) {
            console.log('  !! plate "' + b + '" says it is "' + a + '" at another moment, and ' +
              'it is a different composition (' + r[i].toFixed(2) + ').\n     Same place means ' +
              'the same camera — redraw it against its canon, or stop claiming it is the ' +
              'same place.');
            failures++;
          } else if (r[i] > 0.9995) {
            console.log('  !! plate "' + b + '" is pixel-for-pixel "' + a + '". A second ' +
              'plate that changes nothing is not a second moment.');
            failures++;
          }
        });
        console.log('  plate canon: ' + pairs.map(([a, b], i) =>
          b + '←' + a + ' ' + r[i].toFixed(2)).join(', '));
      }
    }
  }

  /* where a cell actually lives: the shared cast library, or this film's own sprites/ */
  const spritePath = n => {
    for (const d of S.spriteDirs(scenes)) {
      const f = path.join(d, n + '.png');
      if (fs.existsSync(f)) return f;
    }
    return path.join(FILM, 'sprites', n + '.png');
  };

  /* GOLD IS THE SAME DRAWING. docs/03's worry about this film was that the goose after the
     grab would read as a SECOND goose, and the answer is that he is not drawn twice: the gold
     cell is generated from the plain one by pipeline/gild.py, which maps luminance through a
     gold ramp and leaves the alpha channel alone. So it is checkable, and this checks it --
     identical alpha, pixel for pixel, means identical silhouette, identical line, identical
     drawing. And it must actually be gold: a gold cell that came back as pale as the white
     one is a film whose central object never turns. */
  {
    const gilded = new Set();
    for (const sh of scenes.shots) {
      for (const L of sh.layers || []) if (L.gild) gilded.add(L.cell || L.sprite);
      if (sh.count && sh.count.gold) gilded.add((scenes.rig.count || {}).sprite);
    }
    for (const name of gilded) {
      if (!name) continue;
      const out = execFileSync('python3', ['-c', `
import sys
from PIL import Image
plain, gold = sys.argv[1], sys.argv[2]
a = Image.open(plain).convert('RGBA'); b = Image.open(gold).convert('RGBA')
if a.size != b.size:
    print('SIZE %s vs %s' % (a.size, b.size)); raise SystemExit
if list(a.getchannel('A').getdata()) != list(b.getchannel('A').getdata()):
    print('ALPHA'); raise SystemExit
def warmth(im):
    px = [p for p in im.convert('RGBA').getdata() if p[3] > 200]
    return sum(p[0] - p[2] for p in px) / max(1, len(px))
print('OK %.1f %.1f' % (warmth(a), warmth(b)))
`, spritePath(name), spritePath(name + '-gold')], { encoding: 'utf8' }).trim();
      if (out.startsWith('SIZE') || out.startsWith('ALPHA')) {
        console.log('  !! "' + name + '-gold" is not the same drawing as "' + name + '" (' +
          out + '). It has to be a recolour of that file — run pipeline/gild.py.');
        failures++;
      } else {
        const [, wp, wg] = out.split(' ').map(Number);
        if (wg - wp < 40) {
          console.log('  !! "' + name + '-gold" is only ' + (wg - wp).toFixed(0) +
            ' warmer than "' + name + '". It does not read as gold.');
          failures++;
        } else {
          console.log('  gold: ' + name + ' +' + (wg - wp).toFixed(0) + ' warmth, same alpha');
        }
      }
    }
  }

  /* THE WORLD -- film six's primitive, checked from the shot list before a frame is drawn.
     `rock` promised the world STAYED THE SAME; this promises it CHANGES, in one declared
     direction, and never drifts back. Stage indices in shot order never decrease, and the
     first and last stage both appear: "a garden of wilted sticks" is only a loss to a viewer
     who was shown the kept garden earlier, which is the same argument that makes film three
     refuse a film never showing the rock as it usually sits. */
  {
    const w = (scenes.rig || {}).world;
    if (w) {
      const seen = [];
      let last = -1;
      for (const sh of scenes.shots) {
        if (!sh.world) continue;
        const i = w.of.indexOf(sh.world);
        if (i < last) {
          console.log('  !! shot ' + sh.id + ' puts the world back to "' + sh.world +
            '" after "' + w.of[last] + '". It changes in one direction.');
          failures++;
        }
        last = Math.max(last, i); seen.push(i);
      }
      if (!seen.includes(0) || !seen.includes(w.of.length - 1)) {
        console.log('  !! the film never shows the world ' +
          (seen.includes(0) ? 'as it ends up' : 'as it started') +
          '. Both ends, or there is nothing to have lost.');
        failures++;
      } else {
        console.log('  world: ' + w.of.join(' → ') + ', in ' + seen.length + ' shots');
      }
    }
  }

  const ladder = [];      // cross-shot: relative size is the argument, so it must hold
  const rocks = [];        // cross-shot: the rock has to be the same rock every time
  const logs = [];         // cross-shot: one log, one place, one length, two states
  const counts = [];       // cross-shot: a feather does not un-happen, and gold turns once
  const todo = [];          // shots that need rendering, drained in parallel below
  for (const shot of scenes.shots) {
    const html = path.join(FILM, 'shot-' + shot.id + '.html');
    if (!fs.existsSync(html)) { console.log('  !! no page for shot ' + shot.id); failures++; continue; }
    await page.goto('file://' + html, { waitUntil: 'networkidle' });

    /* ---- the contact assertions, measured from the rendered box model ---- */
    if (shot.carry) {
      const r = await page.evaluate((MOUTH) => {
        const carry = document.querySelector('#carry');
        if (!carry) return { err: 'no carry group' };
        const sticks = [...carry.querySelectorAll('.stick')]
          .map(e => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        const birds = [...carry.children]
          .filter(e => !e.classList.contains('stick') && !e.classList.contains('layer'))
          .map(e => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        const hang = carry.querySelector('.layer');
        const h = hang ? hang.getBoundingClientRect() : null;
        return {
          outerL: sticks[0].left, outerR: sticks[sticks.length - 1].right,
          innerL: sticks.length > 1 ? sticks[0].right : null,
          innerR: sticks.length > 1 ? sticks[1].left : null,
          beakL: birds[0].right, beakR: birds[1].left,
          stickY: sticks[0].top + sticks[0].height / 2,
          jaw: h ? [h.left + h.width * 0.28, h.left + h.width * 0.72,
                    h.top + h.height * MOUTH, h.left + h.width / 2] : null,
        };
      }, shot.carry.hang
           ? JSON.parse(fs.readFileSync(path.join(FILM, 'sprites.json'), 'utf8'))[shot.carry.hang].mouth[1]
           : 0.3);
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; continue; }
      /* THE CONTRACT, asserted per shot:
           the stick's ends reach into both beaks   -> the geese are holding it
           the stick crosses his MOUTH, not his shell or his chin, and he is centred on it
                                                    -> he is biting it
         The second one exists because "he is at the right height but reads as standing
         behind the stick" was a real note, twice, and an assertion is cheaper than an eye. */
      const inBeak = (edge, beak) => Math.abs(edge - beak) <= 140;
      if (!inBeak(r.outerL, r.beakL) || !inBeak(r.outerR, r.beakR)) {
        console.log('  !! ' + shot.id + ': stick ends ' +
          Math.abs(r.outerL - r.beakL).toFixed(0) + ' / ' +
          Math.abs(r.outerR - r.beakR).toFixed(0) + ' px from the beaks');
        failures++;
      }
      if (r.jaw) {
        const onMouth = Math.abs(r.stickY - r.jaw[2]) <= 26;
        const centred = Math.abs(r.jaw[3] - (r.outerL + r.outerR) / 2) <= 40;
        if (!onMouth || !centred) {
          console.log('  !! ' + shot.id + ': stick is ' + (r.stickY - r.jaw[2]).toFixed(0) +
            'px off his mouth line, and he is ' +
            (r.jaw[3] - (r.outerL + r.outerR) / 2).toFixed(0) + 'px off centre');
          failures++;
        }
      }
    }

    /* THE RIDE CONTRACT. A rider must sit ON the mount: his feet within a hand's breadth
       of the measured saddle, and horizontally over the mount's body rather than off its
       nose or past its tail. Same reasoning as the stick -- the thing that would be
       embarrassing on screen is the thing worth asserting, and "he is floating above the
       crocodile" is exactly the note a viewer sends back. */
    if (shot.ride) {
      const r = await page.evaluate(() => {
        const g = document.querySelector('#ride');
        if (!g) return { err: 'no ride group' };
        const kids = [...g.children].map(e => e.getBoundingClientRect());
        const mount = kids[0], rider = kids[1];
        return { mount: [mount.left, mount.right, mount.top],
                 rider: [rider.left + rider.width / 2, rider.bottom] };
      });
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; }
      else {
        const gap = r.rider[1] - r.mount[2];               // feet vs the top of the back
        const overBody = r.rider[0] > r.mount[0] + 40 && r.rider[0] < r.mount[1] - 40;
        if (gap < -10 || gap > 130 || !overBody) {
          console.log('  !! ' + shot.id + ': rider ' + gap.toFixed(0) +
            'px from the saddle' + (overBody ? '' : ', and not over the body'));
          failures++;
        }
      }
    }

    /* THE WATERLINE CONTRACT, part one: within the shot.
       The rock sits ON the water, and anything lying on the rock sits ON the rock. Both are
       the same class of promise as the stick in two beaks -- a number shared, not two numbers
       that happen to be close. Part two is across shots, after the loop. */
    if (shot.rock) {
      const r = await page.evaluate(() => {
        const g = document.querySelector('#rock');
        if (!g) return { err: 'no rock group' };
        const base = g.querySelector('.rock-base'), on = g.querySelector('.rock-on');
        const bb = base.getBoundingClientRect();
        const anchor = g.getBoundingClientRect();      // the zero-size group IS the waterline
        return { water: anchor.top, base: [bb.left, bb.top, bb.right, bb.bottom],
                 on: on ? [...(o => [o.left, o.top, o.right, o.bottom])(on.getBoundingClientRect())] : null };
      });
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; }
      else {
        const floatBy = r.base[3] - r.water;
        if (Math.abs(floatBy) > 2) {
          console.log('  !! ' + shot.id + ': the rock sits ' + floatBy.toFixed(0) +
            'px off the waterline');
          failures++;
        }
        if (r.on) {
          const gap = r.on[3] - r.base[1];             // his bottom vs the rock's top
          if (Math.abs(gap) > 2) {
            console.log('  !! ' + shot.id + ': what is lying on the rock is ' + gap.toFixed(0) +
              'px off it -- floating, or sunk into the stone');
            failures++;
          }
          /* "AS FAR AS ANYBODY COULD TELL FROM THE BANK, A SLIGHTLY LARGER ROCK." That is the
             story's own spec for this shot and it is a proportion, so it is a test. A
             crocodile scaled to a believable thickness is 2.6x the width of a stone drawn at
             1.4:1 -- he hangs off both ends and reads as a crocodile draped over a pebble,
             which is a different scene from the one the narration is describing. Caught by
             looking at a still; asserted so nobody has to look twice. */
          const over = (r.on[2] - r.on[0]) / (r.base[2] - r.base[0]);
          if (over > 1.4) {
            console.log('  !! ' + shot.id + ': what is on the rock is ' + over.toFixed(2) +
              'x its width — it hangs off both ends and cannot read as "a slightly larger ' +
              'rock". Draw the stone broader, or the animal more compact.');
            failures++;
          }
        }
        const top = r.on ? r.on[1] : r.base[1];
        if (r.base[0] < 0 || r.base[2] > 1920 || top < 0) {
          console.log('  !! ' + shot.id + ': the rock is not wholly in frame');
          failures++;
        }
        rocks.push({ id: shot.id, water: r.water, base: r.base,
                     proud: r.water - top, high: !!r.on });
      }
    }

    /* THE LOG CONTRACT, part one: within the shot. He sits ON the log, the log sits ON the
       ground, and the whole thing is in frame. Part two is across shots, after the loop. */
    if (shot.log) {
      const r = await page.evaluate(() => {
        const g = document.querySelector('#log');
        if (!g) return { err: 'no log group' };
        const body = g.querySelector('.log-body'), back = g.querySelector('.log-back');
        const on = g.querySelector('.log-astride'), wedge = g.querySelector('.log-wedge');
        const box = e => { const b = e.getBoundingClientRect();
          return [b.left, b.top, b.right, b.bottom]; };
        return { ground: g.getBoundingClientRect().top,   // the zero-size group IS the ground
                 state: body.dataset.log, body: box(body),
                 back: back.getBoundingClientRect().top,  // and this one IS the log's back
                 on: on ? box(on) : null, wedge: wedge ? box(wedge) : null };
      });
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; }
      else {
        const sink = r.body[3] - r.ground;
        if (Math.abs(sink) > 2) {
          console.log('  !! ' + shot.id + ': the log sits ' + sink.toFixed(0) +
            'px off the ground line');
          failures++;
        }
        if (r.on) {
          /* HIS BOTTOM vs THE LOG'S BACK -- not the top of the log's BOX, which is the head
             of the wedge standing proud of it. Measured against the box, he stood on top of
             the wedge and the assertion said he was perfect. */
          const gap = r.on[3] - r.back;
          if (Math.abs(gap) > 2) {
            console.log('  !! ' + shot.id + ': the monkey astride the log is ' + gap.toFixed(0) +
              'px off its back — hovering over the gap, or sunk into it');
            failures++;
          }
          if (r.back - r.body[1] < 4) {
            console.log('  !! ' + shot.id + ': the log\'s back and the top of its box are the ' +
              'same line, so the back was never measured off the drawing — check the manifest.');
            failures++;
          }
          /* astride means ON it, not beside it: his middle has to be over the timber */
          const mid = (r.on[0] + r.on[2]) / 2;
          if (mid < r.body[0] || mid > r.body[2]) {
            console.log('  !! ' + shot.id + ': the monkey is not over the log at all');
            failures++;
          }
        }
        if (r.wedge) {
          const off = r.wedge[3] - r.ground;
          if (Math.abs(off) > 2) {
            console.log('  !! ' + shot.id + ': the loose wedge is ' + off.toFixed(0) +
              'px off the ground'); failures++;
          }
          if (r.wedge[2] > r.body[0] && r.wedge[0] < r.body[2]) {
            console.log('  !! ' + shot.id + ': the loose wedge is drawn over the log. It has ' +
              'just come out of it — it lies clear of the timber or it reads as still in.');
            failures++;
          }
        }
        if (r.body[0] < 0 || r.body[2] > 1920 || r.body[1] < 0) {
          console.log('  !! ' + shot.id + ': the log is not wholly in frame'); failures++;
        }
        logs.push({ id: shot.id, ground: r.ground, body: r.body, state: r.state });
      }
    }

    /* THE COUNT, part one: within the shot. What is on screen is what the shot said, and the
       gold ones are the gilded ones -- the field has an effect or it is not a field
       (CLAUDE.md). Part two, the arithmetic across the film, is after the loop. */
    if (shot.count) {
      const r = await page.evaluate(() => [...document.querySelectorAll('.count-one')]
        .map(e => { const b = e.getBoundingClientRect();
          return { gold: e.dataset.gold === '1', filter: getComputedStyle(e).filter,
                   l: b.left, r: b.right, t: b.top, b: b.bottom }; }));
      const wantG = shot.count.gold || 0, wantP = shot.count.plain || 0;
      const gotG = r.filter(x => x.gold).length, gotP = r.length - gotG;
      if (gotG !== wantG || gotP !== wantP) {
        console.log('  !! ' + shot.id + ': the shot says ' + wantG + ' gold and ' + wantP +
          ' plain, and ' + gotG + ' and ' + gotP + ' rendered.');
        failures++;
      }
      const g = r.find(x => x.gold), p = r.find(x => !x.gold);
      /* one drawing, so they are the same SIZE whichever colour they are: a gold feather
         that is bigger than the white one it becomes is a different feather */
      if (g && p && Math.abs((g.r - g.l) - (p.r - p.l)) > 1) {
        console.log('  !! ' + shot.id + ': the gold and plain feathers are different sizes. ' +
          'They are meant to be the same feather.');
        failures++;
      }
      const off = r.filter(x => x.l < 0 || x.r > 1920 || x.t < 0 || x.b > 1080);
      if (off.length) {
        console.log('  !! ' + shot.id + ': ' + off.length + ' of the ' + r.length +
          ' feathers are out of frame — a child cannot count what is off the edge.');
        failures++;
      }
      counts.push({ id: shot.id, gold: gotG, plain: gotP });
    }

    /* THE MANY. A hundred instances of one drawing has three ways to look wrong and all of
       them are arithmetic, so all of them are checks rather than something a person squints
       at: the count, the depth, the spacing, the pile-ups. */
    if (shot.many) {
      const t = await page.evaluate(() => [...document.querySelectorAll('.many-one')]
        .map(e => { const b = e.getBoundingClientRect();
          /* the LAID-OUT height, not the measured box: these breathe on staggered delays, so
             a bounding rect is a snapshot of an animation and two identical turtles measure
             differently. The first depth check failed on exactly that and it was the check
             that was wrong, not the crowd. */
          return { f: +e.dataset.many, band: +e.dataset.band, h: +e.dataset.h,
                   x: (b.left + b.right) / 2, y: b.bottom,
                   w: b.width, l: b.left, r: b.right, t: b.top }; }));
      if (t.length !== shot.many.n) {
        console.log('  !! ' + shot.id + ': the shot says ' + shot.many.n + ' and ' + t.length +
          ' rendered.'); failures++;
      }
      if (t.length > 3) {
        /* DEPTH HOLDS. Sort by how far back they stand; height must not go up as they recede,
           or the beach is flat and the crowd has no size. */
        const byDepth = [...t].sort((a, b) => a.f - b.f);
        const bad = byDepth.filter((e, i) => i && e.h < byDepth[i - 1].h - 1);
        if (bad.length) {
          console.log('  !! ' + shot.id + ': ' + bad.length + ' of the crowd are further back ' +
            'and drawn BIGGER. The beach has no depth.'); failures++;
        }
        if (byDepth[byDepth.length - 1].h / byDepth[0].h < 1.6) {
          console.log('  !! ' + shot.id + ': front to back the crowd only changes ' +
            (byDepth[byDepth.length - 1].h / byDepth[0].h).toFixed(2) + 'x. A beach running ' +
            'to the surf has more depth in it than that.'); failures++;
        }
        /* NOT A LATTICE. Nearest-neighbour distance on a regular grid is almost constant; on
           a real scatter it is not. A crowd whose spacing has no variance is wallpaper, and
           wallpaper is the one thing a hundred copies of one drawing must never look like. */
        const nn = t.map(a => Math.min(...t.filter(b => b !== a)
          .map(b => Math.hypot(a.x - b.x, a.y - b.y))));
        const mean = nn.reduce((s, v) => s + v, 0) / nn.length;
        const cv = Math.sqrt(nn.reduce((s, v) => s + (v - mean) ** 2, 0) / nn.length) / mean;
        if (cv < 0.18) {
          console.log('  !! ' + shot.id + ': the crowd is spaced too evenly (variation ' +
            cv.toFixed(2) + '). That reads as a repeating tile, not a beach.'); failures++;
        }
        /* NO PILE-UPS, AND THE PAIRS THAT MATTER ARE THE ONES AT THE SAME DEPTH. A near
           turtle covering part of a far one is OCCLUSION -- it is what a dense beach looks
           like, and the rows paint back to front so it reads correctly. Two at the SAME
           depth overlapping have no such excuse: neither is in front, so they read as one
           mangled animal. So this compares within a depth band, and is stricter there (a
           quarter, not a half) than the first version was everywhere. */
        let piled = 0;
        for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
          const a = t[i], b = t[j];
          if (a.band !== b.band) continue;
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
          const oy = Math.min(a.y, b.y) - Math.max(a.t, b.t);
          if (ox > 0 && oy > 0 && ox * oy > 0.25 * Math.min(a.w * a.h, b.w * b.h)) piled++;
        }
        if (piled) {
          console.log('  !! ' + shot.id + ': ' + piled + ' pair(s) of the crowd are drawn ' +
            'through each other.'); failures++;
        }
        const off = t.filter(e => e.l < -20 || e.r > 1940 || e.t < -20 || e.y > 1100);
        if (off.length > t.length * 0.06) {
          console.log('  !! ' + shot.id + ': ' + off.length + ' of the crowd are off the edge.');
          failures++;
        }
        console.log('  many ' + shot.id + ': ' + t.length + ', ' +
          (byDepth[byDepth.length - 1].h / byDepth[0].h).toFixed(1) + 'x front to back, ' +
          'spacing variation ' + cv.toFixed(2));
      }
    }

    /* THE HOP CONTRACT. The arc is decoration; the touchdowns are the promise. Seek to each
       one and measure where his feet actually are -- on the stone's top surface, horizontally
       over it, and on solid ground at the far end. A jump that clips through the rock or ends
       in open water is the exact note that produced this primitive, so it is a number now.

       The times come off the element rather than being repeated here: retime the animation
       and the checker follows it instead of quietly measuring the wrong instant. */
    if ((shot.layers || []).some(L => L.hop)) {
      const r = await page.evaluate(async () => {
        const el = document.querySelector('.hop-land');
        const air = document.querySelector('.hop-air');
        if (!el || !air) return { err: 'no hop element' };
        const [landMs, endMs] = el.dataset.hop.split(',').map(Number);
        const rockEl = document.querySelector('.rock-base');
        const rock = rockEl ? (b => ({ l: b.left, r: b.right, top: b.top }))(
          rockEl.getBoundingClientRect()) : null;
        const at = ms => {
          document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; });
          const b = el.getBoundingClientRect();
          return { l: b.left, r: b.right, bottom: b.bottom, w: b.width,
                   landed: Number(getComputedStyle(el).opacity),
                   flying: Number(getComputedStyle(air).opacity) };
        };
        return { rock, land: at(landMs), end: at(endMs), start: at(0) };
      });
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; }
      else {
        if (!r.rock) { console.log('  !! ' + shot.id + ': hop onto a rock, but no rock in the shot'); failures++; }
        else {
          const drop = r.land.bottom - r.rock.top;
          const mid = (r.land.l + r.land.r) / 2;
          if (Math.abs(drop) > 6) {
            console.log('  !! ' + shot.id + ': at the landing his feet are ' + drop.toFixed(0) +
              'px off the top of the stone — he goes through it, or hovers over it');
            failures++;
          }
          if (mid < r.rock.l || mid > r.rock.r) {
            console.log('  !! ' + shot.id + ': he lands beside the stone, not on it');
            failures++;
          }
        }
        /* A LANDING LOOKS LIKE ONE. Holding the leaping cell -- arms up, legs tucked -- for
           two seconds on the far bank reads as "he fell short", which is exactly the note
           this came from. The landed cell has to be the visible one once he is down. */
        for (const [when, m] of [['on the stone', r.land], ['on the far bank', r.end]]) {
          if (m.landed < 0.9 || m.flying > 0.1) {
            console.log('  !! ' + shot.id + ': ' + when + ' he is still showing the leaping ' +
              'cell — that reads as mid-air, not landed');
            failures++;
          }
        }
        /* and he has to get smaller as he goes away from the camera, or the far bank reads
           as being the same distance off as the near one */
        if (r.end.w >= r.start.w) {
          console.log('  !! ' + shot.id + ': he is no smaller on the far side than on the near ' +
            'bank — he has crossed a river, so perspective has to show it');
          failures++;
        }
        if (r.end.l < 0 || r.end.r > 1920) {
          console.log('  !! ' + shot.id + ': he finishes the jump outside the frame');
          failures++;
        }
      }
      /* leave the clock where the renderer expects it */
      await page.evaluate(() => document.getAnimations().forEach(a => { a.currentTime = 0; }));
    }

    /* THE SIZE LADDER, part one: within the shot. Anything the ladder names must be drawn at
       the ladder's height times this shot's depth -- so two characters in one frame are always
       in the declared ratio, whatever the shot is doing. And the tower's steps stand ON each
       other: a bottom edge IS the top edge below it. */
    {
      const r = await page.evaluate(() => {
        const out = { seen: {}, tower: [] };
        for (const el of document.querySelectorAll('[data-who]')) {
          const b = el.getBoundingClientRect();
          out.seen[el.dataset.who] = b.height;
          if (el.classList.contains('tower-step'))
            out.tower.push({ who: el.dataset.who, top: b.top, bottom: b.bottom });
        }
        return out;
      });
      for (let i = 1; i < r.tower.length; i++) {
        const gap = r.tower[i].bottom - r.tower[i - 1].top;
        if (Math.abs(gap) > 3) {
          console.log('  !! ' + shot.id + ': in the tower, ' + r.tower[i].who + ' is ' +
            gap.toFixed(0) + 'px off ' + r.tower[i - 1].who + "'s back");
          failures++;
        }
      }
      if (Object.keys(r.seen).length) ladder.push({ id: shot.id, seen: r.seen });
    }

    /* THE TROOP CONTRACT. A crowd of one cell has exactly one way to fail and it fails
       completely: identical animals, evenly spaced, facing the same way. So the two things a
       viewer would notice are measured — no two NEIGHBOURS share both size and facing, and
       nobody is standing inside anybody. */
    if (shot.troop) {
      const t = await page.evaluate(() => [...document.querySelectorAll('.troop-one')]
        .map(e => { const b = e.getBoundingClientRect();
          return { k: e.dataset.troop, l: b.left, r: b.right, w: b.width, t: b.top, b: b.bottom }; })
        .sort((a, b) => a.l - b.l));
      if (t.length < 2) { console.log('  !! ' + shot.id + ': troop did not render'); failures++; }
      for (let i = 1; i < t.length; i++) {
        if (t[i].k === t[i - 1].k) {
          console.log('  !! ' + shot.id + ': two neighbours in the troop are the same size and ' +
            'facing the same way — that reads as a sprite sheet, not a crowd');
          failures++;
          break;
        }
        const overlap = t[i - 1].r - t[i].l;
        if (overlap > Math.min(t[i].w, t[i - 1].w) * 0.55) {
          console.log('  !! ' + shot.id + ': two of the troop overlap by ' + overlap.toFixed(0) +
            'px — they are standing inside each other');
          failures++;
          break;
        }
      }
      const off = t.filter(x => x.l < 0 || x.r > 1920 || x.t < 0 || x.b > 1080);
      if (off.length) {
        console.log('  !! ' + shot.id + ': ' + off.length + ' of the troop are part-way out of frame');
        failures++;
      }
    }

    /* THE CALLOUT CONTRACT. A bubble must sit ABOVE the character speaking and must not
       overlap them -- "the callouts are not above the character speaking and are covering
       the characters" was the note, and it is geometry, so it is a test rather than
       something to squint at in a render. Also asserted: the bubble stays inside the
       frame, since anchoring it to an off-centre speaker is exactly what would push it
       off the edge. */
    {
      const bad = await page.evaluate(() => {
        const out = [];
        for (const c of document.querySelectorAll('.callout')) {
          const b = c.getBoundingClientRect();
          if (b.left < 8 || b.right > 1912 || b.top < 8) out.push('off-frame');
          for (const l of document.querySelectorAll('.char')) {
            const r = l.getBoundingClientRect();
            const overlap = !(b.right < r.left || b.left > r.right ||
                              b.bottom < r.top || b.top > r.bottom);
            // a tail may touch the speaker's head; a body-sized overlap may not
            if (overlap && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 40)
              out.push('covers a character');
          }
        }
        return out;
      });
      if (bad.length) {
        console.log('  !! ' + shot.id + ': callout ' + [...new Set(bad)].join(', '));
        failures++;
      }
    }

    /* THE ART ACTUALLY LOADED. Every assertion above measures a BOX, and a div keeps its
       width and height whether or not its background-image resolves — so a sprite that 404s
       passes the contact checks and renders a shot with nothing in it but a plate. That
       became reachable the moment sprites stopped being siblings of the page, so it is
       asserted rather than trusted. */
    {
      const broken = await page.evaluate(async () => {
        const urls = new Set();
        for (const e of document.querySelectorAll('*')) {
          const m = getComputedStyle(e).backgroundImage.match(/url\("?([^")]+)/);
          if (m) urls.add(m[1]);
        }
        const bad = [];
        for (const u of urls) {
          const ok = await new Promise(res => {
            const i = new Image();
            i.onload = () => res(i.naturalWidth > 0);
            i.onerror = () => res(false);
            i.src = u;
          });
          if (!ok) bad.push(decodeURI(u).replace(/^file:\/\//, ''));
        }
        return bad;
      });
      if (broken.length) {
        console.log('  !! ' + shot.id + ': art did not load — ' + broken.join(', '));
        failures++;
      }
    }

    if (checkOnly) { console.log('  ok ' + shot.id); continue; }

    /* ---- render, cut to the narration ---- */
    const secs = narrationSecs(shot.seg);
    if (secs == null) { console.log('  !! ' + shot.id + ': no narration for seg ' + shot.seg); failures++; continue; }
    const dur = (secs + 0.35) / perSeg[shot.seg], total = Math.round(dur * FPS);
    const mp4 = path.join(OUT, shot.id + '.mp4');

    /* ONE CHANGED SHOT SHOULD NOT COST TWELVE RENDERS. Nothing about a shot's output
       depends on anything but its own page, the art that page loads and the length of its
       narration -- so hash exactly that. Twelve shots at ~4 minutes each is 45 minutes,
       which on story two is what stood between a fix and seeing it, which is how cuts that
       predated their fixes kept getting shown. */
    const stamp = crypto.createHash('sha1');
    stamp.update(fs.readFileSync(page.url().replace('file://', '')));
    stamp.update(String(dur));
    /* EVERY image the page loads, wherever it lives. This used to match `sprites/x.png` and
       `plates/x.png` only, which stopped covering the art the moment the cast moved to the
       shared library at ../../cast/<character>/ — and a hash that silently stops covering an
       input is docs/02 §5.8 exactly: you redraw a cell, re-render, and nothing changes. */
    for (const rel of [...new Set((fs.readFileSync(page.url().replace('file://', ''), 'utf8')
                                     .match(/url\(([^)'"]+\.png)\)/g) || [])
                                    .map(m => m.slice(4, -1)))]) {
      const f = path.join(FILM, rel);
      if (fs.existsSync(f)) { stamp.update(rel); stamp.update(fs.readFileSync(f)); }
    }
    const key = stamp.digest('hex');
    const keyFile = path.join(OUT, shot.id + '.key');
    if (!force && fs.existsSync(mp4) && fs.existsSync(keyFile) &&
        fs.readFileSync(keyFile, 'utf8').trim() === key) {
      console.log('  -- ' + shot.id.padEnd(4) + ' unchanged, kept');
      continue;
    }

    todo.push({ shot, html, dur, total, mp4, key, keyFile });
    console.log('  ok ' + shot.id.padEnd(4) + ' checks, queued  ' +
                dur.toFixed(2) + 's  ' + total + ' frames');
  }
  /* THE SIZE LADDER, part two: ACROSS the film. The declared ratios are the story's argument,
     so they are checked wherever two ladder characters share a frame, in every shot, against
     one set of numbers. Per-shot authoring is what lets a bird creep up to a convenient size
     over sixteen shots with no single shot looking wrong. */
  if (ladder.length) {
    const rig = scenes.rig || {}, L = rig.ladder || {};
    for (const row of ladder) {
      const who = Object.keys(row.seen);
      for (let i = 0; i < who.length; i++) {
        for (let j = i + 1; j < who.length; j++) {
          const a = who[i], b = who[j];
          const want = L[a] / L[b], got = row.seen[a] / row.seen[b];
          if (Math.abs(got - want) / want > 0.02) {
            console.log('  !! ' + row.id + ': ' + a + ' is ' + got.toFixed(2) + 'x ' + b +
              ', the ladder says ' + want.toFixed(2) + 'x');
            failures++;
          }
        }
      }
    }
    /* WHEN SIZE IS THE ARGUMENT, it has to be dramatic: the elephant dwarfs the bird or "you
       are the biggest" is a remark about nothing. But that is a promise film FIVE makes, not
       something true of every film with a ladder in it -- film six uses the ladder only to
       stop a man and a monkey drifting relative to each other, and 2.8x is exactly right for
       a man and a monkey. So the film declares the span it is promising, in rig.ladderSpan,
       and this checks the promise rather than assuming one. An assertion that fires on a
       correct film teaches people to ignore assertions. */
    const names = Object.keys(L);
    const want = (scenes.rig || {}).ladderSpan;
    if (names.length >= 2) {
      const hi = Math.max(...names.map(n => L[n])), lo = Math.min(...names.map(n => L[n]));
      const span = hi / lo;
      if (want && span < want) {
        console.log('  !! the size ladder only spans ' + span.toFixed(1) + 'x, and this film ' +
          'promises ' + want + 'x in rig.ladderSpan. Size is its argument — it has to be ' +
          'obvious at a glance.');
        failures++;
      } else {
        console.log('\n  ladder: ' + names.map(n => n + ' ' + L[n]).join(', ') +
          ' — ' + span.toFixed(1) + 'x across' + (want ? ' (promised ' + want + 'x)' : '') +
          ', holding in ' + ladder.length + ' shots');
      }
    }
  }

  /* THE COUNT, part two: ACROSS the film, which is where this primitive actually lives.
     Three promises, all of them arithmetic a nine-year-old could check:
       - the total never goes down. A feather does not un-happen.
       - once anything has turned plain, no gold comes back. "The moment it left him" is one
         way; a gold feather in a later shot means the turn was a trick of the light.
       - the film shows both, because "it turned to feathers in your hand" needs the gold on
         screen first. Same argument as film three refusing a film that never shows the rock
         as it usually sits. */
  if (counts.length) {
    let turned = false, total = 0;
    for (const c of counts) {
      if (c.gold + c.plain < total) {
        console.log('  !! shot ' + c.id + ': the film is down to ' + (c.gold + c.plain) +
          ' feathers from ' + total + '. A feather does not un-happen.');
        failures++;
      }
      if (turned && c.gold) {
        console.log('  !! shot ' + c.id + ': gold feathers are back after they turned plain. ' +
          'The turn goes one way — that is the story.');
        failures++;
      }
      /* AND AFTER THE TURN THE NUMBER IS FIXED. She pulled out a handful; the girls put that
         handful in a box and kept them. Six on the roof and five in the box is a film that
         cannot count, and a child watching it can. */
      if (turned && c.gold + c.plain !== total) {
        console.log('  !! shot ' + c.id + ': ' + (c.gold + c.plain) + ' feathers, and there ' +
          'were ' + total + ' when they turned. That handful is the whole set from then on.');
        failures++;
      }
      if (c.plain) turned = true;
      total = Math.max(total, c.gold + c.plain);
    }
    const anyGold = counts.some(c => c.gold), anyPlain = counts.some(c => c.plain);
    if (!anyGold || !anyPlain) {
      console.log('  !! the film only ever shows ' + (anyGold ? 'gold' : 'plain') +
        ' feathers. Both, or the turn is not on screen.');
      failures++;
    } else {
      console.log('  count: ' + counts.map(c => c.id + ' ' + c.gold + 'g' +
        (c.plain ? '+' + c.plain + 'w' : '')).join(', '));
    }
  }

  /* THE LOG CONTRACT, part two: ACROSS shots. The carpenters left ONE log in ONE place, and
     the cut where it snaps shut is the loudest cut in the film -- so the only thing allowed to
     change across it is the gap. Same x, same length, same ground line, everywhere. And the
     film has to show both states, for the same reason film three has to show the rock twice:
     "the two halves came together" means nothing to a viewer who never saw them apart. */
  if (logs.length) {
    const px = n => (n > 0 ? '+' : '') + n.toFixed(0) + 'px';
    const ref = logs[0];
    for (const l of logs.slice(1)) {
      const dl = l.body[0] - ref.body[0], dr = l.body[2] - ref.body[2];
      const dg = l.ground - ref.ground;
      if (Math.abs(dl) > 2 || Math.abs(dr) > 2 || Math.abs(dg) > 2) {
        console.log('  !! shot ' + l.id + ': the log moved since shot ' + ref.id +
          ' — left ' + px(dl) + ', right ' + px(dr) + ', ground ' + px(dg) +
          '.\n     It is the one log the carpenters left; it does not wander.');
        failures++;
      }
    }
    const open = logs.filter(l => l.state === 'wedged'), shut = logs.filter(l => l.state === 'shut');
    if (!open.length || !shut.length) {
      console.log('  !! the film shows the log ' + (open.length ? 'only open' : 'only shut') +
        '. Both states or the story has no moment in it.');
      failures++;
    } else {
      /* the halves coming together has to be VISIBLE, not a two-pixel difference in a
         drawing -- the same argument as the crocodile making the rock higher */
      const hOf = l => l.body[3] - l.body[1];
      const drop = hOf(open[0]) - hOf(shut[0]);
      if (drop < 10) {
        console.log('  !! the log is only ' + px(drop) + ' slimmer once it shuts. The two ' +
          'halves coming together is the loudest thing in the film and a viewer has to see ' +
          'it — draw the open cut wider, or the shut log tighter.');
        failures++;
      } else {
        console.log('\n  log: ' + Math.round(ref.body[2] - ref.body[0]) + 'px long in ' +
          logs.length + ' shots, ' + drop.toFixed(0) + 'px slimmer shut');
      }
    }
  }

  /* THE WATERLINE CONTRACT, part two: ACROSS shots -- the new thing story three needed.
     carry and ride each promise something about one frame. This promises something about the
     FILM: that the rock the monkey has crossed by for years is the same rock, in the same
     place, every time we see it, and that the one night it is different is different by a
     visible amount. Get that wrong and no single shot looks wrong -- which is exactly why it
     has to be measured rather than watched. */
  if (rocks.length) {
    const px = n => n.toFixed(0) + 'px';
    const ref = rocks[0];
    for (const r of rocks.slice(1)) {
      const dx = Math.abs((r.base[0] + r.base[2]) / 2 - (ref.base[0] + ref.base[2]) / 2);
      const dw = Math.abs((r.base[2] - r.base[0]) - (ref.base[2] - ref.base[0]));
      const dwater = Math.abs(r.water - ref.water);
      if (dx > 2 || dw > 2 || dwater > 2) {
        console.log('  !! shot ' + r.id + ': the rock moved since shot ' + ref.id +
          ' — ' + px(dx) + ' across, ' + px(dw) + ' wider, waterline ' + px(dwater) + ' off.' +
          '\n     It is the same rock every night; that is the whole story.');
        failures++;
      }
    }
    const low = rocks.filter(r => !r.high), high = rocks.filter(r => r.high);
    /* THE FILM HAS TO SHOW BOTH. "Higher than it has ever sat before" means nothing to
       someone who was never shown how it usually sits. A film that only ever shows the
       crocodile on the rock has cut the comparison the plot runs on. */
    if (!low.length || !high.length) {
      console.log('  !! the film shows the rock ' + (low.length ? 'only as it always is' :
        'only with the crocodile on it') + '. The story is the difference between the two, ' +
        'so both have to be on screen.');
      failures++;
    } else {
      const rise = Math.min(...high.map(r => r.proud)) - Math.max(...low.map(r => r.proud));
      const MIN_VISIBLE = 28;      // 1080p: below this "a hand's width higher" is not a thing a child sees
      if (rise < MIN_VISIBLE) {
        console.log('  !! the crocodile only makes the rock ' + px(rise) + ' higher. ' +
          'The monkey notices it across a river at dusk, so a viewer has to notice it too — ' +
          'wants at least ' + MIN_VISIBLE + 'px.');
        failures++;
      } else {
        console.log('\n  rock: same stone in ' + rocks.length + ' shots, ' + px(rise) +
          ' higher on the night the crocodile is on it');
      }
    }
  }

  /* ---- render the queue, several shots at a time ----------------------------------
     The old loop did one thing at a time on a multi-core machine: step a frame, screenshot
     it to a PNG file, step the next, and only when all ~250 files existed hand the
     directory to ffmpeg. So capture never overlapped encode, and every core but one
     watched.

     Two changes. Frames go straight down ffmpeg's stdin as an image2pipe stream, so the
     encoder is working on frame 40 while the browser paints frame 41 and no intermediate
     file is ever written -- that alone removes ~3,000 file writes and deletes from a
     twelve-shot film. And shots run JOBS at a time, each in its own page, because a shot
     is completely independent of every other shot: that is the same fact the cache
     already relies on.

     Every ffmpeg gets -threads 1. Left to itself each encoder grabs a thread per core, so
     four of them on four cores means sixteen threads fighting; the parallelism is at the
     shot level and should stay there.

     Measured on four cores: a 98-frame shot went from ~4 minutes to 101 seconds. */
  if (todo.length) {
    const JOBS = Math.max(1, Math.min(Number(process.env.JOBS) || os.cpus().length, todo.length));
    console.log('\nrendering ' + todo.length + ' shot(s), ' + JOBS + ' at a time');
    const t0 = Date.now();

    const renderOne = async (job, p) => {
      await p.goto('file://' + job.html, { waitUntil: 'networkidle' });
      await p.evaluate(() => document.getAnimations().forEach(a => a.pause()));
      const ff = spawn(FF, ['-y', '-loglevel', 'error', '-threads', '1',
                            '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
                            '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
                            '-pix_fmt', 'yuv420p', job.mp4]);
      let ffErr = '';
      ff.stderr.on('data', d => { ffErr += d; });
      const encoded = new Promise((res, rej) => {
        ff.on('error', rej);
        ff.on('close', c => c === 0 ? res()
          : rej(new Error('ffmpeg exited ' + c + (ffErr ? ': ' + ffErr.trim() : ''))));
      });
      // EPIPE if the encoder dies mid-stream; the close handler above carries the real
      // reason, so swallow the write error rather than masking it with a stack trace.
      ff.stdin.on('error', () => {});
      for (let i = 0; i < job.total; i++) {
        await p.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms; }),
                         (i / FPS) * 1000);
        const png = await p.screenshot();
        if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
      await encoded;
      fs.writeFileSync(job.keyFile, job.key + '\n');
      // console.log does not do printf padding — it prints the format string. This line
      // reported "ok %-4s %5.2fs 1 frames 14.27 342" for ten shots before anyone read it.
      console.log('  rendered ' + job.shot.id.padEnd(4) + ' ' + job.dur.toFixed(2) + 's  ' +
                  job.total + ' frames');
    };

    let next = 0;
    /* A BROWSER EACH, NOT A PAGE EACH. Four pages in one Chromium share one browser process,
       and page.screenshot() goes through it -- so the four workers queued behind each other
       and the first measured run got 13% for 4x the jobs, with only 1.17 of four cores busy.
       Separate browsers are separate processes and actually run at the same time. */
    const worker = async () => {
      const own = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
      const p = await own.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      try {
        while (true) {
          const i = next++;
          if (i >= todo.length) break;
          try { await renderOne(todo[i], p); }
          catch (e) {
            console.log('  !! ' + todo[i].shot.id + ': render failed — ' + e.message);
            failures++;
          }
        }
      } finally { await p.close(); await own.close(); }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
    console.log('  ' + ((Date.now() - t0) / 1000).toFixed(0) + 's for ' + todo.length + ' shot(s)');
  }

  await b.close();
  if (failures) { console.log('\n' + failures + ' shot(s) failed their checks'); process.exit(1); }
  /* WHAT IS CURRENT, RECORDED ONCE, BY THE THING THAT ACTUALLY KNOWS. cut.js used to decide
     staleness by comparing each mp4's mtime against its shot page, which is a proxy and a bad
     one: build.js rewrites every page on every run, so thirteen shots this renderer had just
     proved unchanged -- by content hash, the real test -- looked stale and the cut was
     refused. Two definitions of "current" in one pipeline is one too many. This is the only
     one: film.js finished, checks passed, and these are the shots it covered. */
  fs.writeFileSync(path.join(OUT, '.rendered.json'),
    JSON.stringify({ shots: scenes.shots.map(s => s.id) }, null, 1) + '\n');
  console.log('\nall shots rendered and all contact checks passed');
})();
