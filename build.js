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
/* WHICH FILM. One env var picks the story; every path hangs off it, so this file knows
   nothing about any particular film. Story two is where you find out whether the first
   one was a pipeline or just a thing that happened to work. */
const STORY = process.env.STORY || 'pt-talkative-tortoise';
const FILM = path.join(__dirname, STORY);
const HERE = __dirname, ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'anim', STORY);
const scenes = JSON.parse(fs.readFileSync(path.join(FILM, 'scenes.json'), 'utf8'));
const MANIFEST = path.join(FILM, 'sprites.json');
/* the carry group's two-part flier, named per film: the next story's carrier is not a
   goose, and a rig that only knows the word "goose" is not a rig */
const BODY = (scenes.rig && scenes.rig.body) || 'goose-body';
const WING = (scenes.rig && scenes.rig.wing) || 'goose-wing';

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
d=os.path.join(${JSON.stringify(FILM)},'sprites')
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    name=f[:-4]; im=Image.open(os.path.join(d,f)).convert('RGBA'); w,h=im.size; px=im.load()
    rec={'w':w,'h':h}
    if name==${JSON.stringify(WING)}:
        # the shoulder is the bottom-left of the wing shape: where it pins to the body
        ys=[y for y in range(h) for x in range(w) if px[x,y][3]>200]
        xs=[x for y in range(h) for x in range(w) if px[x,y][3]>200]
        rec['pivot']=[0.14,0.90]
    if name==${JSON.stringify(BODY)}:
        # the beak is the only strong orange on a white bird; its tip is the extreme x
        tip=None
        for y in range(h):
            for x in range(w):
                r,g,b,a=px[x,y]
                if a>200 and r>200 and 100<g<190 and b<90:
                    if tip is None or x<tip[0]: tip=(x,y)
        if tip: rec['beak']=[tip[0]/w, tip[1]/h]
        rec['shoulder']=[0.56,0.46]      # where the wing pins onto the body
    if name.startswith('croc'):
        # THE SADDLE. A rider must sit ON the mount, not float above it or sink into it,
        # and that is the same class of promise as the stick in both beaks: structural,
        # not something to ask an artist for twice. Measured as the highest opaque pixel
        # along the back, sampled where a rider actually sits -- 55% of the way from the
        # snout, behind the shoulder and in front of the tail.
        col=int(w*0.55); top=None
        for y in range(h):
            if px[col,y][3]>200: top=y; break
        if top is not None: rec['saddle']=[0.55, top/h]
    if name.startswith('tortoise'):
        # THE GRIP ANCHOR, MEASURED. Guessed twice and wrong twice -- 0.30 put the stick
        # across his brow, 0.42 across his chest -- so it is derived from the drawing now.
        # A front-facing cartoon face has three dark bands down it: the eyes, the mouth,
        # then the shell's top edge. The mouth is the SECOND band. Clustering rows by ink
        # and taking that band means a new tortoise sprite is calibrated the moment it is
        # drawn, with nobody squinting at a render -- which is what has to be true if this
        # is going to make hundreds of films.
        ink=[]
        for y in range(int(h*0.04), int(h*0.60)):
            n=sum(1 for x in range(w) if px[x,y][3]>200 and sum(px[x,y][:3])<230)
            ink.append((y,n))
        thresh=max(n for _,n in ink)*0.72
        bands=[]; cur=None
        for y,n in ink:
            if n>=thresh:
                if cur and y-cur[-1]<=3: cur.append(y)
                else:
                    if cur: bands.append(cur)
                    cur=[y]
        if cur: bands.append(cur)
        # "the second band" was too fragile -- a stray line above the eyes (a brow, the top
        # of the head) shifts every index by one and the stick lands on his forehead. The
        # eyes are the HEAVIEST band in the upper part of the face; the mouth is whichever
        # band comes next. That survives a stray line, and it survives a different drawing.
        weight={}
        for i,bd in enumerate(bands):
            weight[i]=sum(n for y,n in ink if bd[0]<=y<=bd[-1])
        upper=[i for i,bd in enumerate(bands) if (bd[0]+bd[-1])/2 < h*0.42]
        rec['mouth']=[0.5,0.24]
        if upper:
            eyes=max(upper,key=lambda i:weight[i])
            if eyes+1 < len(bands):
                b=bands[eyes+1]; rec['mouth']=[0.5,(b[0]+b[-1])/2/h]
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
/* CALLOUTS, on the key lines only. The story is narrated, not acted, so a bubble on every
   sentence would fight the voice and turn a picture book into a comic. Four lines carry
   the plot -- the problem, the idea, the condition, and the shout that ends him -- and
   those get a bubble. The rest of the film stays quiet and lets the narrator work.
   Set in the app's own Fraunces, so a child sees the same lettering as the reader. */
@font-face{font-family:Fraunces;src:url(../../app/font/fraunces-843e59e4.woff2) format('woff2');
           font-weight:800;font-display:block}
.callout{position:absolute;left:50%;top:50%;max-width:900px;padding:30px 44px;
  border-radius:34px;background:#fffdf7;border:5px solid #3a2f1c;box-shadow:0 8px 0 rgba(58,47,28,.18);
  font-family:Fraunces,Georgia,serif;font-weight:800;font-size:54px;line-height:1.2;
  color:#241a34;text-align:center;transform-origin:50% 120%}
.callout.shout{font-size:74px;background:#fff3d0;border-color:#8a2f18;color:#8a2f18}
.callout i{position:absolute;left:50%;bottom:-35px;z-index:1;width:0;height:0;margin-left:-18px;
  border:22px solid transparent;border-top-color:#3a2f1c}
.callout i b{position:absolute;left:-16px;top:-25px;width:0;height:0;
  border:16px solid transparent;border-top-color:#fffdf7}
@keyframes pop{0%{opacity:0;transform:translate(var(--cx),var(--cy)) scale(.6)}
  12%{opacity:1;transform:translate(var(--cx),var(--cy)) scale(1.06)}
  18%,86%{opacity:1;transform:translate(var(--cx),var(--cy)) scale(1)}
  100%{opacity:0;transform:translate(var(--cx),var(--cy)) scale(.96)}}

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
  const man = opts.man, b = man[BODY], wg = man[WING];
  const bw = Math.round(h * b.w / b.h);
  const ww = Math.round(h * 0.86 * wg.w / wg.h), wh = Math.round(h * 0.86);
  const sx = b.shoulder[0] * bw, sy = b.shoulder[1] * h;
  const px_ = wg.pivot[0] * ww, py_ = wg.pivot[1] * wh;
  const wing = (cls, delay, extra) =>
    `<div style="position:absolute;left:${sx - px_}px;top:${sy - py_}px;width:${ww}px;` +
    `height:${wh}px;background:url(sprites/${WING}.png) center/contain no-repeat;` +
    `transform-origin:${wg.pivot[0] * 100}% ${wg.pivot[1] * 100}%;${extra}` +
    (opts.still ? 'transform:rotate(64deg) scale(.62);opacity:.95'
                : `animation:flap .62s ease-in-out infinite ${delay}`) + `"></div>`;
  return `<div class="bird" style="position:absolute;width:${bw}px;height:${h}px">` +
    wing('far', (opts.phase || '0s'), 'filter:brightness(.9);z-index:0;') +
    `<div style="position:absolute;inset:0;z-index:1;` +
    `background:url(sprites/${BODY}.png) center/contain no-repeat"></div>` +
    wing('near', (opts.phase || '0s'), 'z-index:2;') +
    `</div>`;
}

/* A PERCH: a point on the PLATE that a character stands on, given as a fraction of the
   plate image. The monkey was placed by raw x/y and ended up sitting on air a foot below
   the branch -- the same failure as a stick that misses a beak, and it deserves the same
   treatment. The plate is drawn at 112% with a -6% inset, so a plate fraction maps to the
   stage by that scale; the sprite's FEET land on the point, not its centre.

   The camera transform is deliberately not compensated for: when the camera drifts, the
   branch drifts, and so should whoever is sitting on it. */
function perchXY(p, w, h) {
  const S = 1.12;
  return { x: Math.round((p[0] - 0.5) * 1920 * S),
           y: Math.round((p[1] - 0.5) * 1080 * S - h / 2) };
}

function layerHTML(L, man) {
  if (L.sprite === 'goose') {
    const b = man[BODY];
    const h = L.h || 300, bw = Math.round(h * b.w / b.h);
    return `<div class="layer" style="width:${bw}px;height:${h}px;margin-left:${-bw / 2}px;` +
      `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${L.flip ? 'scaleX(-1)' : ''};` +
      `transform:translate(${L.x}px,${L.y}px) ${L.flip ? 'scaleX(-1)' : ''};` +
      `animation:${MOTION[L.anim] || 'none'}">${gooseHTML(h, { man, phase: L.phase || '0s', still: L.still })}</div>`;
  }
  if (L.say) {
    const cls = 'callout' + (L.shout ? ' shout' : '');
    return `<div class="${cls}" style="--cx:${L.x}px;--cy:${L.y}px;` +
      `margin-left:-450px;animation:pop ${L.dur || 4}s ease-out forwards ${L.at || 0}s;` +
      `opacity:0">${L.say}<i><b></b></i></div>`;
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
  if (L.perch) { const q = perchXY(L.perch, w, h); L = Object.assign({}, L, { x: q.x, y: q.y }); }
  return `<div class="layer" style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;` +
    `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${fl};` +
    `background-image:url(sprites/${L.sprite}.png);` +
    `transform:translate(${L.x}px,${L.y}px) ${fl};` +
    `animation:${MOTION[L.anim] || 'none'}"></div>`;
}

/* THE CARRY GROUP. Geometry, not choreography. */
function carryHTML(c, man) {
  const b = man[BODY], t = c.hangH ? man[c.hang] : null;
  const gH = c.gooseH, gW = Math.round(gH * b.w / b.h);
  const beakX = b.beak[0] * gW, beakY = -gH / 2 + b.beak[1] * gH;
  const half = c.span / 2;
  // the left bird is mirrored, so its beak sits (gW - beakX) from its own left edge
  const lLeft = -half - (gW - beakX), rLeft = half - beakX;
  /* c.y WAS BEING IGNORED. The stylesheet pins #carry to the stage centre and nothing
     ever read the offset out of the scene, so every "raise the trio" edit changed a number
     that no renderer looked at -- which is worse than a wrong number, because the file
     says one thing and the film does another. In the village shot that left them parked at
     street level among the people they are supposed to be flying over. */
  let html = `<div id="carry" style="top:calc(50% + ${c.y || 0}px);` +
             `animation:${CARRY[c.anim] || 'none'}">`;
  for (const [left, flip, ph] of [[lLeft, true, '0s'], [rLeft, false, '-.31s']]) {
    html += `<div style="position:absolute;left:${left}px;top:${-gH / 2}px;width:${gW}px;` +
      `height:${gH}px;transform:${flip ? 'scaleX(-1)' : 'none'};transform-origin:50% 50%">` +
      gooseHTML(gH, { man, phase: ph }) + `</div>`;
  }
  const th = Math.max(10, Math.round(c.span * 0.026));
  /* ONE STICK, DRAWN IN FRONT OF HIM. The first attempt cut it into two segments stopping
     at his jaw, with his head over the join -- reasonable on paper, wrong on screen: it
     read as a tortoise standing in front of a broken stick. A bite reads when the wood
     passes ACROSS the face at mouth height, so the stick goes above him in z, not behind.
     Depth is the whole vocabulary of cut-out; getting it backwards is the standard way to
     make a puppet look like a sticker. */
  html += `<div class="stick" style="left:${-half}px;top:${beakY - th / 2}px;` +
    `width:${c.span}px;height:${th}px;z-index:5"></div>`;
  if (t) {
    const hH = c.hangH, hW = Math.round(hH * t.w / t.h);
    html += `<div class="layer" style="position:absolute;left:${-hW / 2}px;` +
      `top:${beakY - t.mouth[1] * hH}px;margin:0;width:${hW}px;height:${hH}px;z-index:2;` +
      `background-image:url(sprites/${c.hang}.png);transform-origin:50% ${t.mouth[1] * 100}%;` +
      `animation:hangsway 2.4s ease-in-out infinite"></div>`;
  }
  return html + '</div>';
}

/* A RIDE GROUP: a mount, and a rider pinned to the measured saddle on its back. Same
   promise as the carry group and made the same way -- the rider cannot drift off, cannot
   sink in, and cannot end up behind the animal it is sitting on, because none of those
   are states the markup can express. Story one had a stick between two beaks; story two
   has a monkey on a crocodile. The rig is the part that carries over. */
function rideHTML(r, man) {
  const m = man[r.mount], k = man[r.rider];
  if (!m || !k) throw new Error('ride needs sprites "' + r.mount + '" and "' + r.rider + '"');
  const mH = r.mountH, mW = Math.round(mH * m.w / m.h);
  const kH = r.riderH, kW = Math.round(kH * k.w / k.h);
  const sx = (m.saddle ? m.saddle[0] : 0.55) * mW;
  const sy = (m.saddle ? m.saddle[1] : 0.30) * mH;
  const sink = Math.round(kH * 0.06);         // he sits INTO the back a little, not on top of it
  return `<div id="ride" style="position:absolute;left:50%;top:calc(50% + ${r.y || 0}px);` +
    `width:0;height:0;animation:${CARRY[r.anim] || 'none'}">` +
    `<div style="position:absolute;left:${-mW / 2}px;top:${-mH / 2}px;width:${mW}px;` +
    `height:${mH}px;z-index:1;background:url(sprites/${r.mount}.png) center/contain no-repeat;` +
    `${r.flip ? 'transform:scaleX(-1);' : ''}"></div>` +
    `<div style="position:absolute;left:${-mW / 2 + sx - kW / 2}px;` +
    `top:${-mH / 2 + sy - kH + sink}px;width:${kW}px;height:${kH}px;z-index:2;` +
    `background:url(sprites/${r.rider}.png) center/contain no-repeat;` +
    `transform-origin:50% 100%;animation:hangsway 3s ease-in-out infinite"></div>` +
    `</div>`;
}

function shotHTML(shot, man) {
  const body = [`<div id="plate" style="background-image:url(plates/${shot.plate}.png);` +
    `animation:${CAMERA[shot.camera] || 'none'}"></div>`];
  if (shot.carry) body.push(carryHTML(shot.carry, man));
  if (shot.ride) body.push(rideHTML(shot.ride, man));
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
  const f = path.join(FILM, 'shot-' + shot.id + '.html');
  fs.writeFileSync(f, shotHTML(shot, man));
  n++;
}
console.log('wrote ' + n + ' shot pages');
