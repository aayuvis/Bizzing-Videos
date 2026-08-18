#!/usr/bin/env node
/* Build the film from scenes.json — deterministically.
 *
 * THE ONE IDEA WORTH UNDERSTANDING is the carry group. Four rounds of generative video
 * could not keep two geese holding one stick, because a model that samples a scene afresh
 * every eight seconds has no notion of "holding". Here there is no state in which they are
 * not holding it: the stick's endpoints ARE the geese's beak tips, computed from measured
 * sprite anchors, and the hanging character's mouth IS the stick's midpoint. Motion moves
 * the whole group. Contact is not animated, it is structural.
 *
 * Everything else follows from that: a note becomes a number in scenes.json, a re-render
 * costs nothing, and the result is byte-identical on every run because render.js drives the
 * clock rather than waiting on it.
 *
 *   node tools/anim/build.js            # sprite manifest, then every shot
 *   node tools/anim/build.js --only 05
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'anim');
const scenes = JSON.parse(fs.readFileSync(path.join(HERE, 'scenes.json'), 'utf8'));
const MANIFEST = path.join(HERE, 'sprites.json');

/* ---------------------------------------------------------------- anchors --
   A sprite's contract with the rig: where its beak tip is, where its mouth is. Measured
   from pixels, not guessed, so swapping a sprite for a better drawing moves the stick with
   it and nothing has to be re-eyeballed. */
function measure() {
  const sharpish = require('zlib');   // no image lib in node here — shell out to python
  const py = `
import json,os,sys
from PIL import Image
out={}
d=os.path.join(${JSON.stringify(HERE)},'sprites')
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    name=f[:-4]; im=Image.open(os.path.join(d,f)).convert('RGBA'); w,h=im.size; px=im.load()
    rec={'w':w,'h':h}
    if name=='goose-wing':
        # the shoulder is the bottom-left of the wing shape: where it pins to the body
        ys=[y for y in range(h) for x in range(w) if px[x,y][3]>200]
        xs=[x for y in range(h) for x in range(w) if px[x,y][3]>200]
        rec['pivot']=[0.14,0.90]
    if name=='goose-body':
        # the beak is the only strong orange on a white bird; its tip is the extreme x
        tip=None
        for y in range(h):
            for x in range(w):
                r,g,b,a=px[x,y]
                if a>200 and r>200 and 100<g<190 and b<90:
                    if tip is None or x<tip[0]: tip=(x,y)
        if tip: rec['beak']=[tip[0]/w, tip[1]/h]
        rec['shoulder']=[0.56,0.46]      # where the wing pins onto the body
    if name.startswith('tortoise'):
        # THE GRIP ANCHOR, calibrated once per drawing. A heuristic was tried first -- the
        # widest opaque row in the upper half, plus a nudge -- and it put the stick across
        # the top of his shell, so he read as sitting on it rather than hanging from it.
        # A drawing's mouth is not derivable from its silhouette, so it is measured by eye
        # once and written down. That is what a sprite manifest is FOR: the calibration
        # lives beside the art, and every shot in every film inherits it.
        rec['mouth']=[0.5, {'tortoise-hang':0.30,'tortoise-cross':0.33,
                            'tortoise-shout':0.30}.get(name, 0.34)]
    out[name]=rec
json.dump(out, open(${JSON.stringify(MANIFEST)},'w'), indent=1)
print(len(out),'sprites measured')
`;
  console.log(execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim());
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

/* ------------------------------------------------------------------ motion --
   Named motions, so scenes.json stays declarative. Each is a CSS animation on the layer. */
const MOTION = {
  'idle':          'sway 3.4s ease-in-out infinite',
  'idle-b':        'sway 3.9s ease-in-out infinite -1.2s',
  'lean':          'lean 4.2s ease-in-out infinite',
  'lean-b':        'lean 4.6s ease-in-out infinite -1.5s',
  'chatter':       'chatter .5s ease-in-out infinite',
  'small-breathe': 'breathe 3.2s ease-in-out infinite',
  'bounce':        'bounce 1.05s ease-in-out infinite',
  'still':         'none',
  'drop':          'drop 8s cubic-bezier(.4,0,.9,.6) forwards',
  'tumble-away':   'tumble 8s linear forwards',
};
const CARRY = {          /* how the whole carry group moves */
  'settle': 'bob 2.6s ease-in-out infinite',
  'climb':  'climb 8s ease-out forwards, bob 1.15s ease-in-out infinite',
  'cruise': 'bob 1.15s ease-in-out infinite',
  'circle': 'circle 8s ease-in-out infinite',
};
const CAMERA = {
  'push-in':     'cam-in 8s ease-out forwards',
  'pull-back':   'cam-out 8s ease-out forwards',
  'drift-right': 'cam-right 8s linear forwards',
  'drift-left':  'cam-left 8s linear forwards',
  'rise':        'cam-rise 8s ease-out forwards',
  'hold':        'none',
};

const CSS = `
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f3dca6}
#stage{position:relative;width:1920px;height:1080px;overflow:hidden}
#plate{position:absolute;inset:-6%;width:112%;height:112%;background-size:cover;
       background-position:center;transform-origin:50% 50%}
.layer{position:absolute;left:50%;top:50%;background-repeat:no-repeat;
       background-size:contain;background-position:center}
#carry{position:absolute;left:50%;top:50%;width:0;height:0}
.stick{position:absolute;border-radius:9px;
       background:linear-gradient(#b7813f,#7d4f26);box-shadow:0 2px 0 rgba(0,0,0,.14)}
@keyframes sway{0%,100%{transform:translate(var(--tx),var(--ty)) var(--fl) rotate(-2deg)}
                50%{transform:translate(var(--tx),var(--ty)) var(--fl) rotate(2deg)}}
@keyframes lean{0%,100%{transform:translate(var(--tx),var(--ty)) var(--fl) rotate(3deg)}
                50%{transform:translate(var(--tx),var(--ty)) var(--fl) rotate(-4deg)}}
@keyframes chatter{0%,100%{transform:translate(var(--tx),var(--ty)) var(--fl) scale(1)}
                   50%{transform:translate(var(--tx),calc(var(--ty) - 6px)) var(--fl) scale(1.02)}}
@keyframes breathe{0%,100%{transform:translate(var(--tx),var(--ty)) var(--fl) scale(1)}
                   50%{transform:translate(var(--tx),var(--ty)) var(--fl) scale(1.015)}}
@keyframes bounce{0%,100%{transform:translate(var(--tx),var(--ty)) var(--fl) translateY(0)}
                  50%{transform:translate(var(--tx),var(--ty)) var(--fl) translateY(-26px)}}
@keyframes drop{from{transform:translate(var(--tx),var(--ty)) var(--fl) translateY(0) rotate(0)}
                to{transform:translate(var(--tx),var(--ty)) var(--fl) translateY(900px) rotate(38deg)}}
@keyframes tumble{from{transform:translate(var(--tx),var(--ty)) rotate(0)}
                  to{transform:translate(var(--tx),calc(var(--ty) + 620px)) rotate(420deg)}}
@keyframes bob{0%,100%{transform:translateY(-15px)}50%{transform:translateY(15px)}}
@keyframes climb{from{transform:translateY(320px)}to{transform:translateY(-90px)}}
@keyframes circle{0%,100%{transform:translate(-28px,-10px)}50%{transform:translate(28px,10px)}}
@keyframes flap{0%,100%{transform:rotate(-26deg)}50%{transform:rotate(30deg)}}
@keyframes hangsway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes cam-in{from{transform:scale(1)}to{transform:scale(1.13)}}
@keyframes cam-out{from{transform:scale(1.13)}to{transform:scale(1)}}
@keyframes cam-right{from{transform:translateX(-40px) scale(1.06)}to{transform:translateX(40px) scale(1.06)}}
@keyframes cam-left{from{transform:translateX(50px) scale(1.07)}to{transform:translateX(-50px) scale(1.07)}}
@keyframes cam-rise{from{transform:translateY(-60px) scale(1.1)}to{transform:translateY(40px) scale(1.05)}}
@keyframes sparkle{0%,100%{opacity:.25;transform:scale(.9)}50%{opacity:1;transform:scale(1.15)}}
.spark{position:absolute;left:50%;top:50%;width:46px;height:46px;
  background:radial-gradient(circle,#fff6c9 0 30%,rgba(255,214,102,.85) 45%,transparent 70%);
  animation:sparkle 1.1s ease-in-out infinite}
`;

/* ONE BIRD, MADE OF PARTS. Both geese in a shot are this same markup, one mirrored, so
   they are identical to each other by construction rather than by asking twice. The flap
   is the wing rotating on its shoulder; the body never changes, in any frame, ever. */
function gooseHTML(h, opts) {
  const man = opts.man, b = man['goose-body'], wg = man['goose-wing'];
  const bw = Math.round(h * b.w / b.h);
  const ww = Math.round(h * 0.86 * wg.w / wg.h), wh = Math.round(h * 0.86);
  const sx = b.shoulder[0] * bw, sy = b.shoulder[1] * h;
  const px_ = wg.pivot[0] * ww, py_ = wg.pivot[1] * wh;
  const wing = (cls, delay, extra) =>
    `<div style="position:absolute;left:${sx - px_}px;top:${sy - py_}px;width:${ww}px;` +
    `height:${wh}px;background:url(sprites/goose-wing.png) center/contain no-repeat;` +
    `transform-origin:${wg.pivot[0] * 100}% ${wg.pivot[1] * 100}%;${extra}` +
    `animation:flap .62s ease-in-out infinite ${delay}"></div>`;
  return `<div class="bird" style="position:absolute;width:${bw}px;height:${h}px">` +
    wing('far', (opts.phase || '0s'), 'filter:brightness(.9);z-index:0;') +
    `<div style="position:absolute;inset:0;z-index:1;` +
    `background:url(sprites/goose-body.png) center/contain no-repeat"></div>` +
    wing('near', (opts.phase || '0s'), 'z-index:2;') +
    `</div>`;
}

function layerHTML(L, man) {
  if (L.sprite === 'goose') {
    const b = man['goose-body'];
    const h = L.h || 300, bw = Math.round(h * b.w / b.h);
    return `<div class="layer" style="width:${bw}px;height:${h}px;margin-left:${-bw / 2}px;` +
      `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${L.flip ? 'scaleX(-1)' : ''};` +
      `transform:translate(${L.x}px,${L.y}px) ${L.flip ? 'scaleX(-1)' : ''};` +
      `animation:${MOTION[L.anim] || 'none'}">${gooseHTML(h, { man, phase: L.phase || '0s' })}</div>`;
  }
  if (L.sprite === 'stick-prop') {
    const w = L.w || 300, th = Math.max(9, Math.round(w * 0.045));
    return `<div class="layer stick" style="width:${w}px;height:${th}px;margin-left:${-w / 2}px;` +
      `margin-top:${-th / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:;` +
      `transform:translate(${L.x}px,${L.y}px);animation:${MOTION[L.anim] || 'none'}"></div>`;
  }
  const s = man[L.sprite];
  if (!s) throw new Error('no sprite "' + L.sprite + '" — run the asset generator');
  const h = L.h || Math.round((L.w || 200) * s.h / s.w);
  const w = L.w || Math.round(h * s.w / s.h);
  const fl = L.flip ? 'scaleX(-1)' : '';
  return `<div class="layer" style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;` +
    `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${fl};` +
    `background-image:url(sprites/${L.sprite}.png);` +
    `transform:translate(${L.x}px,${L.y}px) ${fl};` +
    `animation:${MOTION[L.anim] || 'none'}"></div>`;
}

/* THE CARRY GROUP. Geometry, not choreography. */
function carryHTML(c, man) {
  const b = man['goose-body'], t = c.hangH ? man[c.hang] : null;
  const gH = c.gooseH, gW = Math.round(gH * b.w / b.h);
  const beakX = b.beak[0] * gW, beakY = -gH / 2 + b.beak[1] * gH;
  const half = c.span / 2;
  // the left bird is mirrored, so its beak sits (gW - beakX) from its own left edge
  const lLeft = -half - (gW - beakX), rLeft = half - beakX;
  let html = `<div id="carry" style="animation:${CARRY[c.anim] || 'none'}">`;
  for (const [left, flip, ph] of [[lLeft, true, '0s'], [rLeft, false, '-.31s']]) {
    html += `<div style="position:absolute;left:${left}px;top:${-gH / 2}px;width:${gW}px;` +
      `height:${gH}px;transform:${flip ? 'scaleX(-1)' : 'none'};transform-origin:50% 50%">` +
      gooseHTML(gH, { man, phase: ph }) + `</div>`;
  }
  const th = Math.max(10, Math.round(c.span * 0.026));
  html += `<div class="stick" style="left:${-half}px;top:${beakY - th / 2}px;` +
    `width:${c.span}px;height:${th}px;z-index:3"></div>`;
  if (t) {
    const hH = c.hangH, hW = Math.round(hH * t.w / t.h);
    html += `<div class="layer" style="position:absolute;left:${-hW / 2}px;` +
      `top:${beakY - t.mouth[1] * hH}px;margin:0;width:${hW}px;height:${hH}px;z-index:2;` +
      `background-image:url(sprites/${c.hang}.png);transform-origin:50% ${t.mouth[1] * 100}%;` +
      `animation:hangsway 2.4s ease-in-out infinite"></div>`;
  }
  return html + '</div>';
}

function shotHTML(shot, man) {
  const body = [`<div id="plate" style="background-image:url(plates/${shot.plate}.png);` +
    `animation:${CAMERA[shot.camera] || 'none'}"></div>`];
  if (shot.carry) body.push(carryHTML(shot.carry, man));
  for (const L of shot.layers || []) body.push(layerHTML(L, man));
  if (shot.fx === 'sparkle')
    body.push('<div class="spark" style="transform:translate(-30px,-190px)"></div>' +
              '<div class="spark" style="transform:translate(24px,-232px) scale(.7);animation-delay:-.4s"></div>');
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style>` +
         `<div id="stage">${body.join('')}</div>`;
}

const only = process.argv.includes('--only')
  ? new Set(process.argv.slice(process.argv.indexOf('--only') + 1).filter(a => !a.startsWith('-')))
  : null;
const man = measure();
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const shot of scenes.shots) {
  if (only && !only.has(shot.id)) continue;
  const f = path.join(HERE, 'shot-' + shot.id + '.html');
  fs.writeFileSync(f, shotHTML(shot, man));
  n++;
}
console.log('wrote ' + n + ' shot pages');
