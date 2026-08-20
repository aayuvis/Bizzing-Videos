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
 *   node pipeline/build.js            # sprite manifest, then every shot
 *   node pipeline/build.js --only 05
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
/* WHICH FILM, and where the app it is set in lives. One env var picks the story; every
   path hangs off it, so this file knows nothing about any particular film. Story two is
   where you find out whether the first one was a pipeline or just a thing that happened
   to work. */
const S = require('./sources');
const { STORY, FILM, OUT } = S;
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
  /* Sprites come from the shared cast library plus this film's own sprites/ (docs/02 §7 —
     69 characters cover 323 stories, so a cell is drawn once for the channel, not once per
     film). Each record carries `src`, the URL the shot page loads it by, because a cast cell
     is no longer a sibling of the page that uses it. */
  const dirs = S.spriteDirs(scenes);
  const py = `
import json,os,sys
from PIL import Image
out={}
film=${JSON.stringify(FILM)}
for d in ${JSON.stringify(dirs)}:
  for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    name=f[:-4]
    if name in out:
        sys.exit('two sprites are called %s (%s and %s). A cast cell and a film sprite '
                 'cannot share a name -- rename the film one.' % (name, out[name]['src'], f))
    im=Image.open(os.path.join(d,f)).convert('RGBA'); w,h=im.size; px=im.load()
    rec={'w':w,'h':h,'src':os.path.relpath(os.path.join(d,f), film)}
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
        # THE HEAD END. A speech bubble comes from a mouth, and on a side-facing animal the
        # mouth is at the leading edge, not the middle of a body that may be most of the
        # frame wide. Leftmost opaque column, and the top of the silhouette there.
        for x in range(w):
            col=[y for y in range(h) if px[x,y][3]>200]
            if col: rec['head']=[x/w, min(col)/h]; break
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

/* WHERE A SPRITE LIVES IS THE MANIFEST'S BUSINESS, not the markup's. Six places used to
   write `sprites/<name>.png` by hand; a cast cell sits outside the film folder, so they all
   ask here instead and a moved library is one change rather than six. */
let MAN = null;
function spriteURL(name) {
  const rec = MAN && MAN[name];
  if (!rec) throw new Error('no sprite "' + name + '" in the cast for this film.\n' +
    'scenes.json declares cast: ' + JSON.stringify(scenes.cast || []) +
    ' — add the character, or the cell, or put a film-only sprite in films/' + STORY + '/sprites/');
  return rec.src;
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
   Set in the app's own Fraunces, so a child sees the same lettering as the reader --
   linked from the app's own stylesheet, see shotHTML. */
.callout{position:absolute;left:50%;top:50%;max-width:900px;padding:30px 44px;
  border-radius:34px;background:#fffdf7;border:5px solid #3a2f1c;box-shadow:0 8px 0 rgba(58,47,28,.18);
  font-family:Fraunces,Georgia,serif;font-weight:800;font-size:54px;line-height:1.2;
  color:#241a34;text-align:center;transform-origin:50% 120%}
.callout.shout{font-size:74px;background:#fff3d0;border-color:#8a2f18;color:#8a2f18}
.callout i{position:absolute;left:var(--tail,50%);bottom:-35px;z-index:1;width:0;height:0;margin-left:-18px;
  border:22px solid transparent;border-top-color:#3a2f1c}
.callout i b{position:absolute;left:-16px;top:-25px;width:0;height:0;
  border:16px solid transparent;border-top-color:#fffdf7}
/* A BUBBLE PLACED BESIDE ITS SPEAKER POINTS SIDEWAYS. Left the tail on the bottom edge and
   it aimed at the floor while the speaker stood off to one side -- the reader then hangs
   the line on whoever happens to be under it. */
.callout.side i{left:auto;top:50%;bottom:auto;margin:-22px 0 0;border-top-color:transparent}
.callout.side i b{left:auto;top:-16px}
.callout.side-l i{right:-40px;border-left-color:#3a2f1c}
.callout.side-l i b{right:-9px;border-left-color:#fffdf7}
.callout.side-r i{left:-40px;border-right-color:#3a2f1c}
.callout.side-r i b{left:-9px;border-right-color:#fffdf7}
@keyframes pop{0%{opacity:0;scale:.6}
  12%{opacity:1;scale:1.06}
  18%,86%{opacity:1;scale:1}
  100%{opacity:0;scale:.96}}

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
    `height:${wh}px;background:url(${spriteURL(WING)}) center/contain no-repeat;` +
    `transform-origin:${wg.pivot[0] * 100}% ${wg.pivot[1] * 100}%;${extra}` +
    (opts.still ? 'transform:rotate(64deg) scale(.62);opacity:.95'
                : `animation:flap .62s ease-in-out infinite ${delay}`) + `"></div>`;
  return `<div class="bird" style="position:absolute;width:${bw}px;height:${h}px">` +
    wing('far', (opts.phase || '0s'), 'filter:brightness(.9);z-index:0;') +
    `<div style="position:absolute;inset:0;z-index:1;` +
    `background:url(${spriteURL(BODY)}) center/contain no-repeat"></div>` +
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
    /* A BUBBLE BELONGS TO A SPEAKER. Placed by hand it lands wherever the numbers say --
       which last pass meant several sitting ON the characters and none above the one
       talking. `from` names a layer; the bubble goes above that layer's head with its tail
       pointing down at it. Same principle as every other anchor here: state the
       relationship and let the geometry follow.

       An off-centre speaker gets an off-centre TAIL rather than a shifted box, so a bubble
       near the frame edge stays fully on screen instead of hanging off it. */
    let side = '';
    const cls0 = 'callout' + (L.shout ? ' shout' : '');
    const W = L.boxW || 820, GAP = 46;
    let cx = L.x || 0, cy = L.y || -300, tail = 50;
    if (L.from) {
      const sp = L._speaker;
      if (!sp) throw new Error('callout from "' + L.from + '" but that layer is not in this shot');
      const boxH = L.boxH || 150;
      cx = Math.max(-860 + W / 2, Math.min(860 - W / 2, sp.x));
      /* CLEAR OF EVERY BODY IT PASSES, NOT JUST THE SPEAKER'S. Above the crocodile's head
         is still on top of the crocodile: he is 1,266px of animal and his head is the far
         tip of it, so a bubble hung off that one anchor sat squarely across his back. The
         bubble rises above the highest thing standing under it -- the speaker plus any
         character whose column the box actually crosses -- and nothing else has to move. */
      let ceil = sp.y - sp.h / 2;
      for (const o of (L._boxes || [])) {
        if (o.x + o.w / 2 < cx - W / 2 - 12 || o.x - o.w / 2 > cx + W / 2 + 12) continue;
        ceil = Math.min(ceil, o.y - o.h / 2);
      }
      cy = ceil - GAP - boxH;
      /* A SPEAKER HIGH IN FRAME HAS NO ROOM ABOVE THEM. The monkey sits near the top of the
         jamun tree, so "above his head" is off the top of the picture. When that happens the
         bubble goes BESIDE him instead, at his own height, on whichever side has more room --
         which is what a comic does, and it keeps the tail pointing at the speaker either
         way. Falling back to a clamped position would just pin it to the ceiling on top of
         him, which is the fault being fixed.

         `cy` is the box's TOP edge (the element is positioned from top:50%, not centred),
         so the room-above test reads cy itself. Comparing cy - boxH/2 declared a bubble
         that fitted with 48px to spare to be off-frame, and threw it sideways onto the
         speaker -- which is how shot 08 ended up with a bubble across the crocodile. */
      if (cy < -540 + 24) {
        cy = sp.y - sp.h * 0.15;
        const room = sp.x < 0 ? 1 : -1;                     // put it on the emptier side
        cx = Math.max(-860 + W / 2, Math.min(860 - W / 2,
             sp.x + room * (sp.w / 2 + W / 2 + 40)));
        side = room > 0 ? ' side side-r' : ' side side-l';  // tail points back at him
      }
      tail = Math.max(14, Math.min(86, 50 + (sp.x - cx) / W * 100));
    }
    /* CENTRE IT ON ITS OWN WIDTH. `margin-left:-W/2` centres a box that is exactly W wide;
       these shrink to fit their text, so a short line sat (W - actual)/2 to the left of the
       speaker -- which is how the monkey's bubble ended up hanging over open water with the
       tail pointing at nothing. translateX(-50%) centres whatever width the text produces.
       `transform` is free here: the pop animation drives `scale` and `opacity`, which are
       separate properties, so the two do not fight. */
    return `<div class="${cls0}${side}" style="translate:${cx}px ${cy}px;--tail:${tail}%;` +
      `max-width:${W}px;transform:translateX(-50%);` +
      `animation:pop ${L.dur || 4}s ease-out forwards ${L.at || 0}s;` +
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
  return `<div class="layer char" style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;` +
    `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${fl};` +
    `background-image:url(${spriteURL(L.sprite)});` +
    `transform:translate(${L.x}px,${L.y}px) ${fl};` +
    `animation:${MOTION[L.anim] || 'none'}"></div>`;
}

/* THE WATERLINE STACK — story three's primitive, and the first one that is about the WORLD
   rather than about two characters touching.
 *
 * "The Rock That Answered Back" turns on a measurement. The monkey crosses by the same rock
 * twice a day for years; tonight it "was sitting a hand's width higher out of the water than
 * it had ever sat before", because there is a crocodile lying on it. If the rock is not
 * recognisably the SAME rock in the same place across the whole film, the monkey's suspicion
 * is nonsense and the story has no engine.
 *
 * carry and ride are within-shot invariants: a stick in two beaks, a rider on a saddle. This
 * one is ACROSS shots, which is a new thing for this pipeline to be able to promise, and the
 * kind of promise a 323-film channel actually runs on.
 *
 * It is enforced in the SCENE FORMAT first, which is the cheapest place. The rock's sprite,
 * its x, its height and the waterline are film-level constants in `rig`; a shot may say only
 *
 *     "rock": {}                    the rock as it always is
 *     "rock": { "on": "croc-lie" }  tonight
 *
 * so a shot CANNOT move the rock, resize it, or float it — there is no field for any of that.
 * What the assertions then check is that the renderer honoured it, and that the difference
 * between the two is big enough for a child to see. */
function rockHTML(rock, man) {
  const rig = scenes.rig || {};
  for (const k of ['water', 'rockX', 'rockH', 'rise']) {
    if (typeof rig[k] !== 'number') {
      throw new Error('a shot has a "rock" but scenes.json rig.' + k + ' is not set.\n' +
        'The rock is the same rock in every shot, so its sprite, x, height and the waterline ' +
        'are film-level — see rig in scenes.json.');
    }
  }
  const b = man[rig.rockSprite || 'rock-mid'];
  if (!b) throw new Error('rig names rock sprite "' + (rig.rockSprite || 'rock-mid') +
    '" and it is not drawn yet — run npm run assets');
  const bH = rig.rockH, bW = Math.round(bH * b.w / b.h);
  // the waterline is a point on the PLATE, so it goes through the same 1.12 the plate does
  const waterY = Math.round((rig.water - 0.5) * 1080 * 1.12);

  let on = '';
  if (rock.on) {
    const o = man[rock.on];
    if (!o) throw new Error('rock.on names "' + rock.on + '" and it is not drawn yet');
    const oH = rig.rise, oW = Math.round(oH * o.w / o.h);
    /* He lies ON the rock: his bottom edge is the rock's top edge. Not "near" it — the same
       number, so there is no floating crocodile and no crocodile sunk into the stone. */
    on = `<div class="char rock-on" style="position:absolute;left:${-oW / 2}px;` +
      `top:${-bH - oH}px;width:${oW}px;height:${oH}px;z-index:2;` +
      `background:url(${spriteURL(rock.on)}) center/contain no-repeat;` +
      `${rock.flip ? 'transform:scaleX(-1);' : ''}"></div>`;
  }
  /* Bottom of the base sits ON the waterline: top = waterY - bH, so bottom = waterY. */
  return `<div id="rock" style="position:absolute;left:calc(50% + ${rig.rockX}px);` +
    `top:calc(50% + ${waterY}px);width:0;height:0">` +
    `<div class="rock-base" style="position:absolute;left:${-bW / 2}px;top:${-bH}px;` +
    `width:${bW}px;height:${bH}px;z-index:1;` +
    `background:url(${spriteURL(rig.rockSprite || 'rock-mid')}) center/contain no-repeat"></div>` +
    on +
    `</div>`;
}

/* THE HOP — a jump whose LANDINGS are arithmetic.
 *
 * "Make the monkey jump, and make sure he lands on the rock" is a motion note, but the part
 * that would be embarrassing on screen is not the arc: it is a monkey passing THROUGH the
 * stone, or touching down in open water, or landing at the same size he left at when he has
 * crossed half a river. So the arc is decoration and the landings are rig.
 *
 * A hop names where the feet are at each touchdown. The middle one is not typed at all -- it
 * is `onto: "rock"`, and the rig reads the stone's own top surface out of the same film-level
 * constants the rock group uses. Move the rock and the jump follows it; there is no second
 * number to keep in sync, which is the whole point.
 *
 *     "hop": { "from": [0.17,0.93], "onto": "rock", "to": [0.55,0.455],
 *              "fromH": 230, "ontoH": 150, "toH": 96 }
 *
 * The three heights are perspective: he is smaller on the stone than on the near bank, and
 * smaller again on the far side. transform-origin sits at his FEET, so scaling never lifts
 * him off what he is standing on.
 *
 * AND HE HAS TO CHANGE POSE WHEN HE LANDS. One cell through the whole arc means the leaping
 * cell -- arms up, legs tucked -- is what holds on the far bank for two seconds, and that
 * does not read as "landed", it reads as "fell short". So a hop names an `air` cell and a
 * `land` cell, drawn as two layers on the same keyframed transform with complementary
 * opacity: airborne through the arcs, standing on the stone and on the far side.
 *
 * film.js seeks to each touchdown and measures. The times are on the element rather than
 * duplicated in the checker, so a change to the timing cannot leave the assertion behind. */
const HOP_MS = 6000, HOP_LAND = 0.45, HOP_LEAVE = 0.56;

function hopHTML(L, man) {
  const rig = scenes.rig || {};
  const sp = man[L.sprite];
  if (!sp) throw new Error('hop needs sprite "' + L.sprite + '"');
  const h = L.hop.fromH || L.h || 230, w = Math.round(h * sp.w / sp.h);
  const pt = p => ({ x: Math.round((p[0] - 0.5) * 1920 * 1.12),
                     y: Math.round((p[1] - 0.5) * 1080 * 1.12) });

  const a = pt(L.hop.from);
  const c = pt(L.hop.to);
  let b;
  if (L.hop.onto === 'rock') {
    if (typeof rig.water !== 'number') throw new Error('hop onto the rock needs rig.water');
    b = { x: rig.rockX, y: Math.round((rig.water - 0.5) * 1080 * 1.12) - rig.rockH };
  } else {
    b = pt(L.hop.onto);
  }
  const sA = 1, sB = (L.hop.ontoH || h) / h, sC = (L.hop.toH || h) / h;

  /* the two apexes: high enough to read as a jump, above whichever end is higher */
  const lift = (p, q) => Math.min(p.y, q.y) - Math.round(h * 0.42);
  const k = `hop-${L.sprite}-${Math.abs(a.x + b.x + c.x)}`;
  const F = (x, y, sc) => `translate(${x}px,${y}px) scale(${sc.toFixed(3)})`;
  const css =
    `@keyframes ${k}{` +
    `0%{transform:${F(a.x, a.y, sA)}}` +
    `22%{transform:${F(Math.round((a.x + b.x) / 2), lift(a, b), (sA + sB) / 2)}}` +
    `${HOP_LAND * 100}%{transform:${F(b.x, b.y, sB)}}` +
    `${HOP_LEAVE * 100}%{transform:${F(b.x, b.y, sB)}}` +
    `78%{transform:${F(Math.round((b.x + c.x) / 2), lift(b, c), (sB + sC) / 2)}}` +
    `100%{transform:${F(c.x, c.y, sC)}}}`;

  /* opacity swaps at the touchdowns, so the landed cell is what holds on the stone and on
     the far bank. Complementary, and stepped rather than eased -- a monkey does not fade. */
  const fk = k + '-f';
  const L1 = HOP_LAND * 100, L2 = HOP_LEAVE * 100;
  const fade = (name, on) =>
    `@keyframes ${name}{` +
    `0%,${(L1 - 0.5).toFixed(1)}%{opacity:${on ? 1 : 0}}` +
    `${L1}%,${L2}%{opacity:${on ? 0 : 1}}` +
    `${(L2 + 0.5).toFixed(1)}%,97.5%{opacity:${on ? 1 : 0}}` +
    `98%,100%{opacity:${on ? 0 : 1}}}`;

  const airCell = L.hop.air || L.sprite;
  const landCell = L.hop.land || L.sprite;
  if (!man[airCell] || !man[landCell])
    throw new Error('hop needs cells "' + airCell + '" and "' + landCell + '"');
  /* TWO CELLS, OR THE SWAP DOES NOTHING. film.js can check that the landed layer is the
     visible one at each touchdown; it cannot know which drawing looks like a landing. Naming
     the same cell for both satisfies every runtime check and still holds the leaping pose for
     two seconds on the far bank, which is the note this whole primitive came from. So it is
     refused here, where the mistake is actually visible. */
  if (airCell === landCell)
    throw new Error('shot ' + (L._id || '') + ': hop.air and hop.land are both "' + airCell +
      '".\nThe point of the swap is that he stops looking airborne when he lands — two ' +
      'different cells, or drop the hop and use a plain layer.');

  /* margin-top:-h, not -h/2: the anchor is the FEET, so a perch and a scale mean the same
     thing here that they mean everywhere else. */
  const layer = (cell, cls, fadeName) =>
    `<div class="layer char ${cls}" data-hop="${Math.round(HOP_MS * HOP_LAND)},${HOP_MS}" ` +
    `style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;margin-top:${-h}px;` +
    `transform-origin:50% 100%;background-image:url(${spriteURL(cell)});` +
    `transform:${F(a.x, a.y, sA)};` +
    `animation:${k} ${HOP_MS}ms cubic-bezier(.4,0,.5,1) forwards,` +
    ` ${fadeName} ${HOP_MS}ms step-end forwards"></div>`;

  return `<style>${css}${fade(fk + 'a', true)}${fade(fk + 'b', false)}</style>` +
    layer(airCell, 'hop hop-air', fk + 'a') +
    layer(landCell, 'hop-land', fk + 'b');
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
    html += `<div class="layer char" style="position:absolute;left:${-hW / 2}px;` +
      `top:${beakY - t.mouth[1] * hH}px;margin:0;width:${hW}px;height:${hH}px;z-index:2;` +
      `background-image:url(${spriteURL(c.hang)});transform-origin:50% ${t.mouth[1] * 100}%;` +
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
    `<div class="char" style="position:absolute;left:${-mW / 2}px;top:${-mH / 2}px;width:${mW}px;` +
    `height:${mH}px;z-index:1;background:url(${spriteURL(r.mount)}) center/contain no-repeat;` +
    `${r.flip ? 'transform:scaleX(-1);' : ''}"></div>` +
    `<div class="char" style="position:absolute;left:${-mW / 2 + sx - kW / 2}px;` +
    `top:${-mH / 2 + sy - kH + sink}px;width:${kW}px;height:${kH}px;z-index:2;` +
    `background:url(${spriteURL(r.rider)}) center/contain no-repeat;` +
    /* A passenger faces the way the boat is pointing; the mount's head end decides it.
       Mirrored with the standalone `scale` property, not with `transform`: hangsway drives
       `transform: rotate()`, and an animated transform replaces an inline one outright --
       the flip would exist for exactly as long as it took the first frame to render. */
    `${r.riderFlip ? 'scale:-1 1;' : ''}` +
    `transform-origin:50% 100%;animation:hangsway 3s ease-in-out infinite"></div>` +
    `</div>`;
}

function shotHTML(shot, man) {
  const body = [`<div id="plate" style="background-image:url(plates/${shot.plate}.png);` +
    `animation:${CAMERA[shot.camera] || 'none'}"></div>`];
  if (shot.rock) {
    /* A CAMERA MOVE SLIDES THE WATERLINE OUT FROM UNDER THE ROCK. The plate is what has water
       painted on it and the plate is what the camera moves; the rock is positioned in stage
       coordinates. Push in on a rock shot and the stone climbs out of the river over eight
       seconds. Refused at build time — cheaper than noticing it in a render. */
    if (shot.camera && shot.camera !== 'hold') {
      throw new Error('shot ' + shot.id + ' has a rock and camera "' + shot.camera + '".\n' +
        'The waterline is painted on the plate, so moving the plate moves the water and not ' +
        'the rock. Rock shots hold.');
    }
    body.push(rockHTML(shot.rock, man));
  }
  if (shot.carry) body.push(carryHTML(shot.carry, man));
  if (shot.ride) body.push(rideHTML(shot.ride, man));
  /* resolve every `from` against this shot's own layers, once their geometry is known --
     a callout cannot be placed until the character it belongs to has a position */
  const placed = {};
  /* what a bubble must CLEAR, as opposed to what it points at: real drawn boxes, including
     the whole of a mount whose speaking anchor is only its head */
  const boxes = [];
  if (shot.ride) {
    /* Register the mount and the rider SEPARATELY, not as one box. Treating the group as
       the speaker made a 1,266px-wide crocodile the thing to place a bubble above -- so
       "above" ran off the top of frame and "beside" had no side to go to. A bubble belongs
       to whoever is talking, and on a side-facing animal it belongs at the HEAD end. */
    const r = shot.ride, m = man[r.mount], k = man[r.rider];
    const mH = r.mountH, mW = Math.round(mH * m.w / m.h);
    const kH = r.riderH || 0, kW = kH ? Math.round(kH * k.w / k.h) : 0;
    const sy = (m.saddle ? m.saddle[1] : 0.3) * mH;
    const hx = (m.head ? m.head[0] : 0.12) * mW, hy = (m.head ? m.head[1] : 0.3) * mH;
    const flip = r.flip ? -1 : 1;
    placed[r.mount] = { x: flip * (-mW / 2 + hx) + (mW * 0.06),
                        y: (r.y || 0) - mH / 2 + hy + 40, w: 300, h: 120 };
    boxes.push({ x: 0, y: r.y || 0, w: mW, h: mH });
    if (kH) {
      placed[r.rider] = { x: flip * (-mW / 2 + (m.saddle ? m.saddle[0] : .55) * mW),
                          y: (r.y || 0) - mH / 2 + sy - kH / 2, w: kW, h: kH };
      boxes.push(placed[r.rider]);
    }
  }
  if (shot.rock) {
    /* The thing on the rock can talk -- that is the story's punchline -- so it registers as a
       speaker like any other character. Centre-relative, same convention as the rest: the
       bubble then lands above it by the ordinary rule and clears the stone underneath. */
    const rig = scenes.rig;
    const b = man[rig.rockSprite || 'rock-mid'];
    const bH = rig.rockH, bW = Math.round(bH * b.w / b.h);
    const waterY = Math.round((rig.water - 0.5) * 1080 * 1.12);
    boxes.push({ x: rig.rockX, y: waterY - bH / 2, w: bW, h: bH });
    if (shot.rock.on && man[shot.rock.on]) {
      const o = man[shot.rock.on], oH = rig.rise, oW = Math.round(oH * o.w / o.h);
      placed[shot.rock.on] = { x: rig.rockX, y: waterY - bH - oH / 2, w: oW, h: oH };
      boxes.push(placed[shot.rock.on]);
    }
  }
  if (shot.carry) {
    const c = shot.carry;
    placed.carry = { x: 0, y: c.y || 0, w: c.span + c.gooseH,
                     h: c.gooseH + (c.hangH || 0) };
    boxes.push(placed.carry);
  }
  for (const L of shot.layers || []) {
    if (L.say || !L.sprite || L.hop) continue;      // a hop moves; it is not a box to clear
    const sp = man[L.sprite]; if (!sp) continue;
    const h = L.h || Math.round((L.w || 200) * sp.h / sp.w);
    const w = L.w || Math.round(h * sp.w / sp.h);
    const q = L.perch ? perchXY(L.perch, w, h) : { x: L.x || 0, y: L.y || 0 };
    placed[L.sprite] = { x: q.x, y: q.y, w: w, h: h };
    boxes.push(placed[L.sprite]);
  }
  for (const L of shot.layers || []) {
    if (L.hop) { body.push(hopHTML(L, man)); continue; }
    body.push(layerHTML(L.say && L.from
      ? Object.assign({}, L, { _speaker: placed[L.from], _boxes: boxes }) : L, man));
  }
  if (shot.fx === 'sparkle')
    body.push('<div class="spark" style="transform:translate(-30px,-190px)"></div>' +
              '<div class="spark" style="transform:translate(24px,-232px) scale(.7);animation-delay:-.4s"></div>');
  /* THE APP'S OWN TYPE, LINKED OUT OF THE APP. This used to be a hand-rolled @font-face
     with a relative path, and it had two faults at once: the path stopped resolving when
     each film got its own folder, and it named the latin-EXT subset, which contains no
     ASCII. Both fail the same silent way -- the browser drops to Georgia and renders a
     perfectly reasonable-looking callout in the wrong face. Linking the app's stylesheet
     fixes both and cannot drift from what the reader sets. */
  return `<!doctype html><meta charset="utf-8">` +
         `<link rel="stylesheet" href="${S.url('fonts.css')}">` +
         `<style>${CSS}</style>` +
         `<div id="stage">${body.join('')}</div>`;
}

const only = process.argv.includes('--only')
  ? new Set(process.argv.slice(process.argv.indexOf('--only') + 1).filter(a => !a.startsWith('-')))
  : null;
const man = MAN = measure();
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const shot of scenes.shots) {
  if (only && !only.has(shot.id)) continue;
  const f = path.join(FILM, 'shot-' + shot.id + '.html');
  fs.writeFileSync(f, shotHTML(shot, man));
  n++;
}
console.log('wrote ' + n + ' shot pages');
