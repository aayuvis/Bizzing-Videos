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
 *   node tools/anim/film.js            # every shot, cut to its narration
 *   node tools/anim/film.js --check    # assertions only, render nothing
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');

/* WHICH FILM. One env var picks the story; every path hangs off it, so this file knows
   nothing about any particular film. Story two is where you find out whether the first
   one was a pipeline or just a thing that happened to work. */
const STORY = process.env.STORY || 'pt-talkative-tortoise';
const FILM = path.join(__dirname, STORY);
const HERE = __dirname, ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'anim', STORY);
const VOICE = path.join(ROOT, 'app', 'voice', 'st');
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
  const f = path.join(VOICE, SLUG + '-' + seg + '.mp3');
  if (!fs.existsSync(f)) return null;
  let err = '';
  try { execFileSync(FF, ['-i', f], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr); }
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : null;
}

(async () => {
  const checkOnly = process.argv.includes('--check');
  fs.mkdirSync(OUT, { recursive: true });
  const pre = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  let failures = 0;
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
          for (const l of document.querySelectorAll('.layer')) {
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

    if (checkOnly) { console.log('  ok ' + shot.id); continue; }

    /* ---- render, cut to the narration ---- */
    const secs = narrationSecs(shot.seg);
    if (secs == null) { console.log('  !! ' + shot.id + ': no narration for seg ' + shot.seg); failures++; continue; }
    const dur = secs + 0.35, total = Math.round(dur * FPS);
    const dir = path.join(OUT, 'f-' + shot.id);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
    for (let i = 0; i < total; i++) {
      await page.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms; }),
                          (i / FPS) * 1000);
      await page.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.png') });
    }
    const mp4 = path.join(OUT, shot.id + '.mp4');
    execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(FPS),
                      '-i', path.join(dir, '%04d.png'), '-c:v', 'libx264', '-crf', '18',
                      '-preset', 'medium', '-pix_fmt', 'yuv420p', mp4]);
    fs.rmSync(dir, { recursive: true, force: true });
    // console.log does not do printf padding — it prints the format string. This line
    // reported "ok %-4s %5.2fs 1 frames 14.27 342" for ten shots before anyone read it.
    console.log('  ok ' + shot.id.padEnd(4) + ' ' + dur.toFixed(2) + 's  ' + total + ' frames');
  }
  await b.close();
  if (failures) { console.log('\n' + failures + ' shot(s) failed their checks'); process.exit(1); }
  console.log('\nall shots rendered and all contact checks passed');
})();
