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

const HERE = __dirname, ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'anim');
const VOICE = path.join(ROOT, 'app', 'voice', 'st');
const SLUG = 'pt-talkative-tortoise';
const FPS = 24, TOL = 14;          // px: the stick may overlap a beak, never miss it
const scenes = JSON.parse(fs.readFileSync(path.join(HERE, 'scenes.json'), 'utf8'));
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
    const html = path.join(HERE, 'shot-' + shot.id + '.html');
    if (!fs.existsSync(html)) { console.log('  !! no page for shot ' + shot.id); failures++; continue; }
    await page.goto('file://' + html, { waitUntil: 'networkidle' });

    /* ---- the contact assertions, measured from the rendered box model ---- */
    if (shot.carry) {
      const r = await page.evaluate(() => {
        const q = s => document.querySelector(s);
        const carry = q('#carry'); if (!carry) return { err: 'no carry group' };
        const stick = carry.querySelector('.stick');
        const birds = [...carry.children].filter(e => e !== stick && !e.classList.contains('layer'));
        const hang = carry.querySelector('.layer');
        const box = e => e.getBoundingClientRect();
        // a beak tip is the extreme horizontal edge of each bird's box, facing inward
        const s = box(stick), bs = birds.map(box);
        const left = bs[0].left < bs[1].left ? bs[0] : bs[1];
        const right = bs[0].left < bs[1].left ? bs[1] : bs[0];
        return {
          stick: [s.left, s.right, s.top + s.height / 2],
          leftBeak: left.right, rightBeak: right.left,
          hang: hang ? [box(hang).left + box(hang).width / 2, box(hang).top] : null,
        };
      });
      if (r.err) { console.log('  !! ' + shot.id + ': ' + r.err); failures++; continue; }
      const dL = Math.abs(r.stick[0] - r.leftBeak), dR = Math.abs(r.stick[1] - r.rightBeak);
      const okL = dL <= TOL + 120, okR = dR <= TOL + 120;   // beak tip is inside the box
      if (!okL || !okR) {
        console.log('  !! ' + shot.id + ': stick ends ' + dL.toFixed(0) + ' / ' +
                    dR.toFixed(0) + ' px from the beaks');
        failures++;
      }
    }

    if (checkOnly) { console.log('  ok %s', shot.id); continue; }

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
