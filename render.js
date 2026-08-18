/* Render an animated HTML shot to frames, deterministically.
 *
 * WHY THIS EXISTS. Generative video samples a fresh guess every eight seconds. It has no
 * model of the scene, so "both geese are holding the stick" can be asked for but never
 * GUARANTEED -- four rounds of increasingly precise prompting proved that, at roughly
 * twenty dollars a round. Here the stick is between the beaks because a stylesheet puts
 * it there. It cannot be otherwise, in any frame, ever, and re-rendering costs nothing.
 *
 * The clock is driven, not waited on: Playwright pauses CSS animations and steps them to
 * an exact time per frame, so the output is identical on every run and on every machine.
 *
 *   node tools/anim/render.js shot-fly.html out/ 4      # 4 seconds at 24fps
 */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

(async () => {
  const [html, outDir, secs] = [process.argv[2], process.argv[3], Number(process.argv[4] || 4)];
  const FPS = 24, total = Math.round(secs * FPS);
  fs.mkdirSync(outDir, { recursive: true });

  const pre = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.resolve(html), { waitUntil: 'networkidle' });

  // freeze every animation, then step it by hand — no sleeping, no drift, no flake
  await p.evaluate(() => {
    document.getAnimations().forEach(a => { a.pause(); });
  });
  for (let i = 0; i < total; i++) {
    const t = (i / FPS) * 1000;
    await p.evaluate(ms => {
      document.getAnimations().forEach(a => { a.currentTime = ms; });
    }, t);
    await p.screenshot({ path: path.join(outDir, String(i).padStart(4, '0') + '.png') });
  }
  await b.close();
  console.log('rendered ' + total + ' frames to ' + outDir);
})();
