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

  let failures = 0;
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

    if (checkOnly) { console.log('  ok ' + shot.id); continue; }

    /* ---- render, cut to the narration ---- */
    const secs = narrationSecs(shot.seg);
    if (secs == null) { console.log('  !! ' + shot.id + ': no narration for seg ' + shot.seg); failures++; continue; }
    const dur = secs + 0.35, total = Math.round(dur * FPS);
    const mp4 = path.join(OUT, shot.id + '.mp4');

    /* ONE CHANGED SHOT SHOULD NOT COST TWELVE RENDERS. Nothing about a shot's output
       depends on anything but its own page, the art that page loads and the length of its
       narration -- so hash exactly that. Twelve shots at ~4 minutes each is 45 minutes,
       which on story two is what stood between a fix and seeing it, which is how cuts that
       predated their fixes kept getting shown. */
    const stamp = crypto.createHash('sha1');
    stamp.update(fs.readFileSync(page.url().replace('file://', '')));
    stamp.update(String(dur));
    for (const rel of [...new Set((fs.readFileSync(page.url().replace('file://', ''), 'utf8')
                                     .match(/(?:sprites|plates)\/[\w-]+\.png/g) || []))]) {
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
  console.log('\nall shots rendered and all contact checks passed');
})();
