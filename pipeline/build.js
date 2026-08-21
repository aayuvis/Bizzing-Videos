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
    if name.startswith('log-'):
        # THE LOG'S BACK, MEASURED. The bounding box's top edge is not the log -- it is the
        # WEDGE's head, a narrow spike standing well clear of the trunk. Anchoring the monkey
        # on it stood him on top of the wedge like a circus act, in a shot whose whole point
        # is that he is sitting on the LOG.
        # So: the median of the per-column top edges. The wedge is a spike over a few percent
        # of the columns and a median ignores it by construction -- which is what "anchor on
        # a feature, never an index" means for a silhouette with a spike in it.
        tops=[]
        for x in range(w):
            col=[y for y in range(h) if px[x,y][3]>200]
            if col: tops.append(min(col))
        if tops:
            tops.sort(); rec['back']=tops[len(tops)//2]/h
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
  if (L.who && L.h)
    throw new Error('a layer names who: "' + L.who + '" AND a height. Pick one — the ladder ' +
      'exists so a shot cannot resize a character.');
  const { h, w } = layerSize(L, man);
  const fl = L.flip ? 'scaleX(-1)' : '';
  if (L.perch) { const q = perchXY(L.perch, w, h); L = Object.assign({}, L, { x: q.x, y: q.y }); }
  /* `gild` is a RECOLOUR OF THE SAME DRAWING, never a second drawing. docs/03's worry about
     this film was that the goose after the grab would read as a second goose; a filter over
     one file makes that impossible to get wrong, and film.js asserts the filter is actually
     doing something so the flag can never quietly become decorative. */
  return `<div class="layer char"${L.who ? ` data-who="${L.who}"` : ''}` +
    `${L.gild ? ' data-gild="1"' : ''} ` +
    `style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;` +
    `margin-top:${-h / 2}px;--tx:${L.x}px;--ty:${L.y}px;--fl:${fl};` +
    `background-image:url(${spriteURL(L.gild ? goldCell(L.sprite, man) : L.sprite)});` +
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

/* THE LOG — the same log, in the same place, in two states.
 *
 * This is not film four's primitive; `troop` is, and a film gets one (docs/02 §3). It is the
 * `rock` lesson applied at half the size, and it is here because the shot list got it wrong
 * twice in one pass while it was still prose:
 *
 *   - the moral shot asked for a log HELD OPEN BY ITS WEDGE and a loose wedge lying beside
 *     it, which is two wedges. The whole story is about ONE wedge and where it is.
 *   - the two cells came back at different proportions (2.5:1 open, 3.1:1 shut). Placed by
 *     HEIGHT, as everything else in this pipeline is, the log would have grown 24% longer at
 *     the exact cut where it is supposed to snap shut.
 *
 * So the log is film-level. rig.log gives its x, the ground line it lies on and its LENGTH,
 * and a shot may write only:
 *
 *     "log": {}                                       as the carpenters left it, wedged open
 *     "log": { "shut": true }                          after he heaves it out
 *     "log": { "astride": { "who": "monkey", "cell": "monkey-sit" } }
 *     "log": { "shut": true, "wedge": true }           the wedge now on the ground
 *
 * There is no field for the cell, for where it is, or for how long it is. It is fitted by
 * WIDTH with its underside on the ground line, so its length and its footing are identical in
 * every shot and closing the cut reads as the log getting slimmer -- which is what closing a
 * cut does. `astride` puts the rider's bottom edge ON the log's top edge at the log's middle,
 * so there is no monkey hovering over the gap and none sunk into it. And a shot that asks for
 * a loose wedge while the log is still open is refused here, because that is two wedges. */
function logHTML(log, man) {
  const rig = scenes.rig || {}, cfg = rig.log;
  if (!cfg) throw new Error('a shot has a "log" but scenes.json has no rig.log.\n' +
    'The log is the same log in every shot, so its x, its ground line and its length are ' +
    'film-level — see rig in scenes.json.');
  for (const k of ['x', 'ground', 'w']) {
    if (typeof cfg[k] !== 'number')
      throw new Error('rig.log.' + k + ' is not set. The log cannot be placed per shot.');
  }
  const shut = !!log.shut;
  const cell = shut ? 'log-shut' : 'log-wedged';
  const sp = man[cell];
  if (!sp) throw new Error('the log needs "' + cell + '" and it is not drawn yet — ' +
    'run npm run assets');
  /* ONE WEDGE. It is in the log or it is on the ground; it is never in both places, and a
     shot cannot say otherwise. */
  if (log.wedge && !shut)
    throw new Error('a shot asks for a loose wedge while the log is still wedged open.\n' +
      'That is two wedges, and the story has one. A loose wedge means "log": {"shut": true}.');
  const W = cfg.w, H = Math.round(W * sp.h / sp.w);
  const groundY = Math.round((cfg.ground - 0.5) * 1080 * 1.12);   // a point on the PLATE
  /* THE BACK OF THE LOG, off the drawing -- not the top of its box, which is the wedge's
     head. Measured in build.js's manifest pass; see the note there. */
  const backY = -H + Math.round((typeof sp.back === 'number' ? sp.back : 0) * H);

  const out = [`<div class="log-body" data-log="${shut ? 'shut' : 'wedged'}" ` +
    `style="position:absolute;left:${-W / 2}px;top:${-H}px;width:${W}px;height:${H}px;` +
    `z-index:1;background:url(${spriteURL(cell)}) center/contain no-repeat"></div>`,
    /* a zero-height marker AT the back line, so the assertions measure the same thing the
       renderer used -- the rock's waterline trick, one size down */
    `<div class="log-back" style="position:absolute;left:${-W / 2}px;top:${backY}px;` +
    `width:${W}px;height:0"></div>`];

  if (log.astride) {
    const a = log.astride, ac = man[a.cell];
    if (!ac) throw new Error('log.astride names cell "' + a.cell + '" and it is not drawn yet');
    const h = ladderH(a.who, log.depth), w = Math.round(h * ac.w / ac.h);
    const dx = cfg.astrideDx || 0;
    if (Math.abs(dx) + w / 2 > W / 2)
      throw new Error('rig.log.astrideDx puts him off the end of the log.');
    /* His bottom edge IS the log's back -- the same number, not two close ones. */
    out.push(`<div class="char log-astride" style="position:absolute;left:${dx - w / 2}px;` +
      `top:${backY - h}px;width:${w}px;height:${h}px;z-index:2;` +
      `background:url(${spriteURL(a.cell)}) center/contain no-repeat;` +
      `${a.flip ? 'transform:scaleX(-1);' : ''}` +
      `animation:${MOTION[a.anim] || 'none'}"></div>`);
  }

  if (log.wedge) {
    const wc = man['wedge-loose'];
    if (!wc) throw new Error('a shot has a loose wedge and wedge-loose is not drawn yet');
    const wh = cfg.wedgeH || 70, ww = Math.round(wh * wc.w / wc.h);
    const dx = typeof cfg.wedgeDx === 'number' ? cfg.wedgeDx : Math.round(W * 0.62);
    /* IT IS OUT OF THE LOG, so it lies CLEAR of the log. Put it inside the log's own width
       and it renders on top of the timber, which reads as a wedge still in the cut -- the
       exact thing the shot exists to say is no longer true. */
    if (Math.abs(dx) - ww / 2 < W / 2)
      throw new Error('rig.log.wedgeDx (' + dx + ') lays the loose wedge on top of the log.\n' +
        'It has just come OUT; it has to be clear of the timber — at least ' +
        Math.ceil(W / 2 + ww / 2) + 'px from the middle.');
    /* on the same ground line as the log, so it is lying in the yard and not floating */
    out.push(`<div class="log-wedge" style="position:absolute;left:${dx - ww / 2}px;` +
      `top:${-wh}px;width:${ww}px;height:${wh}px;z-index:3;` +
      `background:url(${spriteURL('wedge-loose')}) center/contain no-repeat"></div>`);
  }

  return `<div id="log" style="position:absolute;left:calc(50% + ${cfg.x}px);` +
    `top:calc(50% + ${groundY}px);width:0;height:0">${out.join('')}</div>`;
}

/* THE TROOP — film four's primitive, and the one docs/02 §5.7 does not cover.
 *
 * The brief says crowds belong in the PLATE, and gives the reason: they never recur, so they
 * are scenery. That is right for a village that runs out to look up. It is wrong for a troop
 * of monkeys who come down off the wall, try the saw, sit in the bucket and pull the wedge --
 * they act, they are on screen for most of the film, and they are made of a cell we own.
 *
 * A crowd of CAST has one failure mode and it is total: six identical monkeys in a row, at
 * the same size, facing the same way, breathing in step. That is not a troop, it is a sprite
 * sheet, and a child sees it instantly.
 *
 * So the rig places them and the rig varies them. A troop names a cell, a count and a line
 * across the plate; each instance gets a scale, a facing and an animation phase from a SEEDED
 * generator -- seeded, because a render has to stay byte-identical between runs (docs/02 §2).
 * film.js then asserts what a viewer would complain about: that no two neighbours share both
 * scale and facing, and that they do not pile up on each other.
 *
 * `n` is the whole crowd. There is no per-instance field, so nobody can hand-place the third
 * monkey and quietly undo the variation. */
function rng(seed) {                       // deterministic; same film, same frames, forever
  let x = seed * 2654435761 % 4294967296;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}

function troopHTML(t, man) {
  const sp = man[t.cell];
  if (!sp) throw new Error('troop needs cell "' + t.cell + '"');
  const n = t.n;
  if (!(n >= 2)) throw new Error('a troop of ' + n + ' is not a troop');
  const base = t.who ? ladderH(t.who, t.depth) : t.h;
  if (!base) throw new Error('troop needs a height, via who: or h:');
  const r = rng(t.seed || 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    /* along the line, with the far end smaller: a crowd standing on a ground plane recedes */
    const px = t.from[0] + (t.to[0] - t.from[0]) * f;
    const py = t.from[1] + (t.to[1] - t.from[1]) * f;
    const jitter = (r() - 0.5) * (t.spread || 0.02);
    const scale = 0.82 + r() * 0.36;                       // 0.82–1.18 of the troop height
    const flip = r() < 0.5;
    const delay = -(r() * 3).toFixed(2);
    const h = Math.round(base * scale), w = Math.round(h * sp.w / sp.h);
    const q = perchXY([px + jitter, py], w, h);
    out.push(`<div class="layer char troop-one" data-troop="${scale.toFixed(3)},${flip ? 1 : 0}" ` +
      `style="width:${w}px;height:${h}px;margin-left:${-w / 2}px;margin-top:${-h / 2}px;` +
      `--tx:${q.x}px;--ty:${q.y}px;--fl:${flip ? 'scaleX(-1)' : ''};` +
      `background-image:url(${spriteURL(t.cell)});` +
      `transform:translate(${q.x}px,${q.y}px) ${flip ? 'scaleX(-1)' : ''};` +
      `animation:${MOTION[t.anim] || 'none'};animation-delay:${delay}s"></div>`);
  }
  return out.join('');
}

/* THE COUNT — film seven's primitive: a set that a child can count, and that changes.
 *
 * "One golden feather every visit, for as long as you need it" only lands if the feathers on
 * the step are a NUMBER. And the moment the story turns on is arithmetic: she pulls out a
 * handful and every single one of them turns into an ordinary white feather. If the film shows
 * six gold and then four white, a child who counts has caught the film out.
 *
 * THE GOLD ONE AND THE WHITE ONE ARE THE SAME DRAWING. That is the whole trick, and it is the
 * `carry` lesson again: the strongest way to promise two things are the same object is for
 * them to BE the same file. One feather sprite; the gold ones carry a gild filter and the
 * plain ones do not, so "it turned into an ordinary white feather" is literally true of the
 * pixels and cannot drift. The same filter makes the goose golden, for the same reason --
 * docs/03 worried the goose after the grab would read as a SECOND goose, and a recolour of one
 * drawing cannot.
 *
 * The row is film-level: rig.count owns where the feathers sit, how far apart and how big.
 * A shot may write only how many of each:
 *
 *     "count": { "gold": 1 }                one on the step
 *     "count": { "plain": 6 }               the six she is left with
 *
 * so there is no field for moving a feather, and a pile cannot drift between shots. film.js
 * then checks the arithmetic across the film: the total never goes down (a feather does not
 * un-happen), gold never comes back once anything has turned plain, and the film shows both. */
/* GOLD IS A RAMP, NOT A HUE, and this used to be a `filter:` chain because that keeps the
 * promise cheaply: the golden goose and the plain goose are one drawing, so he cannot come
 * back as a different bird. Five rounds of tuning proved the filter cannot do it on a WHITE
 * subject -- sepia() preserves luminance, so the bird stays pale until the chroma is pushed
 * far enough to make a lemon rubber duck, and hue-rotating the lemon away gives a traffic
 * cone. See pipeline/gild.py, which does it properly by mapping luminance through a gold
 * ramp and keeping the alpha channel exactly. The promise survives -- it is still one
 * drawing -- and it is now checkable, because two PNGs can be compared and a filter could
 * not be.
 *
 *     "gild": true   on a layer, or a gold count, uses <cell>-gold.png
 */
function goldCell(name, man) {
  const g = name + '-gold';
  if (!man[g]) throw new Error('"' + name + '" is asked for in gold and ' + g + '.png does ' +
    'not exist.\nRun: python3 pipeline/gild.py <path to ' + name + '.png>');
  return g;
}

function countHTML(c, man) {
  const rig = (scenes.rig || {}).count;
  if (!rig) throw new Error('a shot has a "count" but scenes.json has no rig.count.\n' +
    'Where the row sits, how far apart and how big are film-level — see rig in scenes.json.');
  const sp = man[rig.sprite];
  if (!sp) throw new Error('rig.count names sprite "' + rig.sprite + '" and it is not drawn yet');
  const gold = c.gold || 0, plain = c.plain || 0;
  if (gold + plain < 1) throw new Error('a "count" of nothing is not a count');
  const h = rig.h, w = Math.round(h * sp.w / sp.h);
  /* WHERE THE ROW SITS IS FILM-LEVEL, but the feathers are on the step in one shot and on the
     roof in another, so the film DECLARES its spots and a shot picks one by name. It still
     cannot invent a position -- same discipline as the world's stages. */
  const spot = c.at || Object.keys(rig.spots)[0];
  if (!rig.spots[spot]) throw new Error('a shot puts the count "' + spot + '", and rig.count ' +
    'declares only: ' + Object.keys(rig.spots).join(', '));
  const [ax, ay] = rig.spots[spot], [sx, sy] = rig.step;
  const out = [];
  for (let i = 0; i < gold + plain; i++) {
    const isGold = i < gold;
    const q = perchXY([ax, ay], w, h);
    /* `.layer` for the positioning: it is what puts an element's origin at the middle of the
       stage, which is the coordinate system perchXY() answers in. Positioning these from the
       stage's top-left instead put every feather in the top-left corner, half of them off the
       edge -- caught by the in-frame assertion, which is what it is for. */
    out.push(`<div class="layer count-one" data-gold="${isGold ? 1 : 0}" ` +
      `style="width:${w}px;height:${h}px;` +
      `margin-left:${-w / 2}px;margin-top:${-h / 2}px;` +
      `transform:translate(${q.x + i * sx}px,${q.y + i * sy}px);` +
      `background:url(${spriteURL(isGold ? goldCell(rig.sprite, man) : rig.sprite)}) ` +
      `center/contain no-repeat"></div>`);
  }
  return out.join('');
}

/* THE MANY — film eight's primitive, and `troop` at a scale where placing them by hand is
 * not a thing a person does. A hundred thousand olive ridleys come ashore on one Odisha beach
 * in a night; the film needs a beach "cobbled with turtles as far as a torch could shine",
 * and a hundred instances of one drawing is the only honest way to get there.
 *
 * `troop` puts n along a LINE. This fills an AREA with depth, and the failure modes are
 * different and worse:
 *   - a visible grid. Six monkeys in a row read as a row; a hundred turtles in a lattice read
 *     as wallpaper, and a child sees wallpaper instantly.
 *   - flat scale. On a beach receding to the surf, a turtle at the back has to be smaller
 *     than one at the front, or the beach has no depth and the crowd has no size.
 *   - pile-ups. At a hundred instances, uniform random placement WILL overlap; the eye reads
 *     overlapping turtles as one broken shape.
 *
 * So placement is jittered-grid (a lattice with a large random offset inside each cell), which
 * is what gives blue-noise-ish spacing without a rejection loop: dense, uneven, never regular.
 * Depth comes from the row, so scale and y move together and cannot disagree. Seeded, so the
 * render is byte-identical between runs (docs/02 §2).
 *
 *     "many": { "cell": "ridley-crawl", "n": 90, "top": 0.56, "bottom": 0.96,
 *               "far": 46, "near": 130, "seed": 5 }
 *
 * There is no per-instance anything. film.js then asserts what a viewer would complain about:
 * the count, that depth holds (higher up the frame IS smaller), that nearest-neighbour spacing
 * has real variance rather than a lattice's near-zero, and that nobody is a pile-up. */
const PLATE = 1.12;   // perchXY's plate-over-stage scale; see the CSS for #plate

function manyHTML(m, man) {
  const sp = man[m.cell];
  if (!sp) throw new Error('many needs cell "' + m.cell + '"');
  const n = m.n;
  if (!(n >= 20)) throw new Error('a "many" of ' + n + ' is a troop. Use troop.');
  const r = rng(m.seed || 1);
  const aspect = sp.w / sp.h;

  /* ROWS OF DIFFERENT POPULATION, which is the whole difference between this and `troop`.
     A square lattice puts the same number of instances in the near row as the far one, and
     the near ones are three times the size -- so they cannot fit and they draw through each
     other. On a receding plane the BACK holds more, in proportion to how small things are
     there, so instances are dealt to rows by 1/width. Then every row has the same
     instances-per-turtle-width, and the crowd is dense everywhere without piling up anywhere.
     Half a cell of brick offset breaks the horizontal banding a plain grid leaves behind. */
  const rows = m.rows || Math.max(3, Math.round(Math.sqrt(n / 2.6)));
  const span = m.right - m.left;
  const rowY = [], rowW = [];
  for (let i = 0; i < rows; i++) {
    const fy = (i + 0.5) / rows;
    rowY.push(fy);
    rowW.push((m.far + (m.near - m.far) * fy) * aspect);
  }
  const wsum = rowW.reduce((s, w) => s + 1 / w, 0);
  const per = rowW.map(w => Math.max(1, Math.round(n * (1 / w) / wsum)));

  /* WHAT EACH ROW CAN ACTUALLY HOLD, in the plate coordinates a perch is written in -- and
     measured on the WIDEST instance the row's band can produce, because y jitters inside the
     band and its front edge is what has to fit. */
  const CAP = 0.92;   // the minimum centre-to-centre gap, in sprite widths; the relax below
                      // uses the same number, and film.js refuses anything closer
  const cap = [], rowMaxW = [];
  for (let i = 0; i < rows; i++) {
    const wMax = (m.far + (m.near - m.far) * ((i + 0.85) / rows)) * aspect;
    rowMaxW.push(wMax);
    /* against the span the row can ACTUALLY use, which is the declared band narrowed by the
       half-sprite the edge clamp keeps inside the frame. Measuring capacity against the wider
       declared band left the last pair in the widest row pinned against the edge with nowhere
       to be pushed, and one pair overlapping through every relax pass. */
    const edge = (960 - wMax / 2) / (1920 * PLATE);
    const usable = Math.min(m.right, 0.5 + edge) - Math.max(m.left, 0.5 - edge);
    cap.push(Math.max(1, Math.floor(usable * 1920 * PLATE / (wMax * CAP * 1.06))));
  }
  /* water-fill n into the rows: take from any row over its cap, give to any row under it */
  for (let i = 0; i < rows; i++) per[i] = Math.min(per[i], cap[i]);
  let left = n - per.reduce((s, v) => s + v, 0);
  for (let pass = 0; left > 0 && pass < 200; pass++) {
    let placed = 0;
    for (let i = 0; i < rows && left > 0; i++)
      if (per[i] < cap[i]) { per[i]++; left--; placed++; }
    if (!placed) break;
  }
  while (left < 0) { const i = per.indexOf(Math.max(...per)); per[i]--; left++; }
  if (left > 0) {
    /* NO SILENT CAP. A crowd that does not fit is an authoring decision, not something for
       the renderer to quietly shave -- the alternative is turtles drawn through each other,
       which is what this whole layout exists to prevent. */
    throw new Error('a "many" of ' + m.n + ' ' + m.cell + ' does not fit the band it is given.\n' +
      'It holds ' + cap.reduce((s, v) => s + v, 0) + ' at this size. Lower n, lower "near", ' +
      'or widen left/right/top/bottom.');
  }

  const out = [];
  for (let row = 0; row < rows; row++) {
    const k = per[row];
    /* a bricked row is INSET by the half cell it is offset by, so the offset cannot walk the
       last instance in the row off the side of the frame */
    const brick = (row % 2) ? 0.5 : 0;
    const inset = brick * (span / k) * 0.5;
    const cell = (span - inset * 2) / k;
    /* KEEP HALF A SPRITE INSIDE THE FRAME, in PLATE coordinates. A perch is a fraction of the
       plate and the plate is 1.12x the stage, so 0.04 is not 4% in from the left edge -- it is
       29px OFF it, which is how seven turtles ended up half in the sea. */
    const wMax = rowMaxW[row];
    const edge = (960 - wMax / 2) / (1920 * PLATE);
    const lo = Math.max(m.left + inset, 0.5 - edge), hi = Math.min(m.right - inset, 0.5 + edge);
    const inst = [];
    for (let i = 0; i < k; i++) {
      const fy = (row + 0.15 + r() * 0.7) / rows;
      const h = Math.round(m.far + (m.near - m.far) * fy);
      inst.push({ x: lo + cell * (i + 0.19 + r() * 0.62), fy, h,
                  w: Math.round(h * aspect), flip: r() < 0.5, delay: -(r() * 4).toFixed(2) });
    }
    /* JITTER, THEN PUSH APART. Jitter is what stops the crowd reading as a tile, and it is
       also what makes two of them land on the same patch of sand -- turn it up until the
       spacing looks natural and you get pile-ups, turn it down until the pile-ups stop and
       you get wallpaper. Both were measured happening. So: jitter freely, then relax the row
       until nobody is inside anybody, which keeps the uneven spacing AND separates them.
       Neighbours may still touch -- an arribada beach is shoulder to shoulder and should
       look it -- they just may not be drawn through each other. */
    const minGap = CAP / 1920;
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      /* re-sort every pass: a push can carry one instance past its neighbour, and then the
         two that are actually side by side are no longer adjacent in the list -- which is how
         one pair kept overlapping through a relax that reported itself settled */
      inst.sort((a, b) => a.x - b.x);
      for (let i = 1; i < inst.length; i++) {
        const a = inst[i - 1], b = inst[i];
        const need = minGap * Math.max(a.w, b.w);
        const d = b.x - a.x;
        if (d < need) { const push = (need - d) / 2; a.x -= push; b.x += push; moved = true; }
      }
      for (const e of inst) e.x = Math.min(hi, Math.max(lo, e.x));
      if (!moved) break;
    }
    for (const e of inst) {
      const py = m.top + (m.bottom - m.top) * e.fy;
      const q = perchXY([e.x, py], e.w, e.h);
      out.push(`<div class="layer char many-one" data-many="${e.fy.toFixed(4)}" ` +
        `data-band="${row}" data-h="${e.h}" ` +
        `style="width:${e.w}px;height:${e.h}px;margin-left:${-e.w / 2}px;` +
        `margin-top:${-e.h / 2}px;z-index:${row + 1};--tx:${q.x}px;--ty:${q.y}px;` +
        `--fl:${e.flip ? 'scaleX(-1)' : ''};background-image:url(${spriteURL(m.cell)});` +
        `transform:translate(${q.x}px,${q.y}px) ${e.flip ? 'scaleX(-1)' : ''};` +
        `animation:${MOTION[m.anim] || 'none'};animation-delay:${e.delay}s"></div>`);
    }
  }
  return out.join('');
}

/* THE SIZE LADDER — film five's primitive, and the first about a RELATIONSHIP BETWEEN
 * CHARACTERS that has to hold everywhere at once.
 *
 * "Who Was Here First?" is an argument about size. "You are the biggest. That is not the same
 * thing at all" only means something if the elephant is overwhelmingly bigger than the bird in
 * every frame they share. Author heights per shot and they drift: the partridge creeps up to a
 * convenient size the moment she has a line, and the joke quietly dies.
 *
 * So heights are not a shot's business. `rig.ladder` declares one height per character for the
 * whole film, and a layer names WHO it is rather than how tall:
 *
 *     "layers": [ { "who": "elephant", "cell": "elephant-settle" },
 *                 { "who": "partridge", "cell": "partridge-speak", "perch": [0.4,0.7] } ]
 *
 * A shot may set `depth` to push the whole group further away, which scales everything by the
 * same factor and so cannot disturb the ratios. There is no per-character height field, which
 * is the point: the drift is not discouraged, it is unsayable.
 *
 * film.js then checks the ladder holds -- ordering and ratios, in every shot and across the
 * whole film. */
/* ONE PLACE THAT KNOWS HOW BIG A LAYER IS. The renderer and the callout placer each worked
   it out separately, and when the ladder arrived only the renderer learned about it -- so a
   434px elephant was placed as if he were 200px wide, and his bubble landed 82px inside his
   own back with 626px of clear sky above him. Two computations of one fact is one too many. */
function layerSize(L, man) {
  const sp = man[L.sprite];
  if (!sp) return null;
  const h = L.who ? ladderH(L.who, L._depth) : (L.h || Math.round((L.w || 200) * sp.h / sp.w));
  return { h, w: L.w || Math.round(h * sp.w / sp.h) };
}

function ladderH(who, depth) {
  const rig = scenes.rig || {};
  const L = rig.ladder || {};
  if (typeof L[who] !== 'number')
    throw new Error('layer names who: "' + who + '" but rig.ladder has no height for it.\n' +
      'Heights are film-level so relative size cannot drift between shots — add it to the ladder.');
  return Math.round(L[who] * (depth || 1));
}

/* THE TOWER. The story ends with them going about the forest in a stack -- partridge on the
 * monkey, monkey on the elephant -- and that is carved on gateways all over India, which is
 * why the film has to get it exactly right. Each one stands ON the one below: its bottom edge
 * IS the other's top edge, computed, not placed. Same promise as the stick in two beaks. */
function towerHTML(t, man) {
  const depth = t.depth || 1;
  let bottom = Math.round((t.ground - 0.5) * 1080 * 1.12);   // feet of the lowest, on the plate
  const out = [];
  for (const step of t.of) {
    const sp = man[step.cell];
    if (!sp) throw new Error('tower needs cell "' + step.cell + '"');
    const h = ladderH(step.who, depth), w = Math.round(h * sp.w / sp.h);
    out.push(`<div class="char tower-step" data-who="${step.who}" ` +
      `style="position:absolute;left:${-w / 2}px;top:${bottom - h}px;width:${w}px;height:${h}px;` +
      `background:url(${spriteURL(step.cell)}) center/contain no-repeat;` +
      `${step.flip ? 'transform:scaleX(-1);' : ''}"></div>`);
    bottom -= h;                                  // the next one stands on this one's top
  }
  return `<div id="tower" style="position:absolute;left:calc(50% + ${t.x || 0}px);top:50%;` +
    `width:0;height:0;animation:${CARRY[t.anim] || 'none'}">${out.join('')}</div>`;
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

/* THE WORLD — film six's primitive, and the second one about the place rather than the
 * people in it. `rock` promised the world STAYED THE SAME; this promises it changes, in one
 * declared direction, and never drifts back.
 *
 * The king's garden is kept, then half dug up, then wholly dug up, then wilted, and that
 * progression IS the story: monkeys who water a garden by pulling every sapling up first.
 * Get it wrong and no single shot is wrong -- a wilted garden in shot 6 and a kept one in
 * shot 12 both look fine on their own, and only the film is broken.
 *
 * So the stages are film-level and ORDERED:
 *
 *     "rig": { "world": { "plate": "garden", "of": ["kept","pulling","uprooted","wilted"] } }
 *
 * and a garden shot writes `"world": "uprooted"` INSTEAD of a plate. A shot cannot name both,
 * so it cannot show a stage that is not one of these; film.js then checks the sequence never
 * runs backwards and that the first and last stage both appear -- "a garden of wilted sticks"
 * needs the kept garden on screen earlier or there is nothing to have lost.
 *
 * Shots that are not in the garden name a plate as usual. The mango tree is not a stage. */
function worldPlate(shot) {
  const w = (scenes.rig || {}).world;
  if (!w) throw new Error('shot ' + shot.id + ' names a world stage but scenes.json has no ' +
    'rig.world. The stages are film-level and ordered — see rig in scenes.json.');
  if (shot.plate) throw new Error('shot ' + shot.id + ' names both a plate and a world stage.\n' +
    'A garden shot is a stage; a shot somewhere else names a plate. Never both.');
  const i = w.of.indexOf(shot.world);
  if (i < 0) throw new Error('shot ' + shot.id + ' is at world stage "' + shot.world +
    '", which is not one of: ' + w.of.join(', '));
  return { plate: w.plate + '-' + shot.world, i };
}

function shotHTML(shot, man) {
  if (shot.world) shot.plate = worldPlate(shot).plate;
  /* `who` names a character and `cell` the drawing; the sprite name the rest of the builder
     expects is the cell, and the height comes from the ladder. */
  if (shot.layers) shot.layers = shot.layers.map(L => L.who
    ? Object.assign({}, L, { sprite: L.cell || L.sprite, _depth: shot.depth }) : L);
  const body = [`<div id="plate" style="background-image:url(plates/${shot.plate}.png);` +
    `animation:${CAMERA[shot.camera] || 'none'}"></div>`];
  /* NIGHT GRADES THE CAST, NOT THE PLATE. A night plate is painted dark; a sprite is drawn on
     white for daylight, so dropped onto a moonlit beach unchanged it GLOWS -- a hundred olive
     ridleys came out looking like a hundred pale eggs under a floodlight, in a film whose
     moral is about switching lights off. Darkening is the one thing a CSS filter is genuinely
     good at (unlike recolouring: see gild.py), so it is one. film.js measures the result
     against the plate beside it, because "is it dark enough" is a comparison, not a constant. */
  const nightOpen = shot.night ? '<div id="night" style="position:absolute;inset:0;' +
    'filter:brightness(0.46) saturate(0.55) contrast(1.08)">' : '';
  if (shot.troop) body.push(troopHTML(shot.troop, man));
  if (shot.many) body.push(manyHTML(shot.many, man));
  if (shot.count) body.push(countHTML(shot.count, man));
  if (shot.tower) body.push(towerHTML(shot.tower, man));
  if (shot.log) {
    /* Same reason a rock shot holds: the ground line is painted on the PLATE, so a camera
       move slides the yard out from under the log. */
    if (shot.camera && shot.camera !== 'hold') {
      throw new Error('shot ' + shot.id + ' has a log and camera "' + shot.camera + '".\n' +
        'The ground is painted on the plate, so moving the plate moves the ground and not ' +
        'the log. Log shots hold.');
    }
    body.push(logHTML(shot.log, man));
  }
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
  if (shot.log) {
    /* Same registration the rock gets, and for the same reason: a bubble belongs to whoever
       is speaking, and it has to clear the timber he is sitting on. layerSize() cannot see
       either of them -- neither is a layer. */
    const cfg = scenes.rig.log, shut = !!shot.log.shut;
    const sp = man[shut ? 'log-shut' : 'log-wedged'];
    if (sp) {
      const W = cfg.w, H = Math.round(W * sp.h / sp.w);
      const groundY = Math.round((cfg.ground - 0.5) * 1080 * 1.12);
      boxes.push({ x: cfg.x, y: groundY - H / 2, w: W, h: H });
      const a = shot.log.astride;
      if (a && man[a.cell]) {
        const ac = man[a.cell], h = ladderH(a.who, shot.log.depth);
        const w = Math.round(h * ac.w / ac.h);
        const back = groundY - H + Math.round((typeof sp.back === 'number' ? sp.back : 0) * H);
        placed[a.cell] = { x: cfg.x + (cfg.astrideDx || 0), y: back - h / 2, w, h };
        boxes.push(placed[a.cell]);
      }
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
    const sz = layerSize(L, man); if (!sz) continue;
    const { h, w } = sz;
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
  /* the plate is already night; everything after it is cast, so the wrapper opens after it */
  const html = nightOpen
    ? body[0] + nightOpen + body.slice(1).join('') + '</div>'
    : body.join('');
  return `<!doctype html><meta charset="utf-8">` +
         `<link rel="stylesheet" href="${S.url('fonts.css')}">` +
         `<style>${CSS}</style>` +
         `<div id="stage">${html}</div>`;
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
