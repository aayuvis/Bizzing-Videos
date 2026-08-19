#!/usr/bin/env node
/* One frame, one second, no render.
 *
 * The expensive mistake on story two was not a bad fix -- it was showing cuts that predated
 * the fixes, because seeing a change meant a 45-minute render of all twelve shots. This
 * loads a built shot page, pauses every animation at a chosen millisecond and screenshots
 * it. Use it after every build; use film.js when the film is actually ready.
 *
 *   STORY=pt-monkey-crocodile T=3600 node tools/anim/still.js 07 08
 *
 * T is the timeline position in ms (default 4200) -- set it near a callout's `at` to see
 * the bubble. Frames land in build/stills/<story>-<id>.png.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const STORY = process.env.STORY;
if (!STORY) throw new Error('set STORY=<story-dir>');
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('name at least one shot id, e.g. 07');

const FILM = path.join(__dirname, STORY);
const OUT = path.join(__dirname, '..', '..', 'build', 'stills');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const t = Number(process.env.T || 4200);
  for (const id of ids) {
    const src = path.join(FILM, 'shot-' + id + '.html');
    if (!fs.existsSync(src)) throw new Error('no shot-' + id + '.html — run build.js first');
    await page.goto('file://' + src);
    await page.evaluate(ms => document.getAnimations().forEach(a => {
      a.pause(); a.currentTime = ms;
    }), t);
    const out = path.join(OUT, STORY + '-' + id + '.png');
    await page.screenshot({ path: out });
    console.log('  ' + path.relative(process.cwd(), out));
  }
  await browser.close();
})();
