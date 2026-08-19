#!/usr/bin/env node
/* Render a film's title and end cards, in the app's own type.
 *
 * RENDERED, NEVER GENERATED. docs/14 rule 3: no lettering comes out of an image model. It is
 * unreliable, unbrandable, and for an Indic script it would break the app's rule about
 * setting the script properly. These are laid out in a headless browser against the app's
 * own stylesheet and self-hosted faces, so a child sees the same lettering as in the reader.
 *
 *   STORY=pt-monkey-crocodile node tools/anim/cards.js
 *
 * The words come from the story itself -- title, hook and moral straight out of
 * data-stories.js -- so a card cannot drift from what the app says. Change the moral in the
 * app and the end card changes with it.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');

const STORY = process.env.STORY || 'pt-talkative-tortoise';
const HERE = __dirname, ROOT = path.join(HERE, '..', '..'), APP = path.join(ROOT, 'app');
const FILM = path.join(HERE, STORY);

/* the story, read from the app rather than retyped */
const W = { window: {} }; W.window = W; vm.createContext(W);
fs.readdirSync(APP).filter(f => /^data-stories.*\.js$/.test(f)).sort()
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), W, { filename: f }));
const all = ['IND_STORIES','IND_STORIES_REGIONAL','IND_STORIES_MORE','IND_STORIES_SOUTH',
  'IND_STORIES_NORTH','IND_STORIES_EAST','IND_STORIES_WEST','IND_STORIES_NE_A',
  'IND_STORIES_NE_B','IND_STORIES_MODERN','IND_STORIES_VIGYAN']
  .reduce((a, k) => a.concat(W[k] || []), []);
const slug = s => String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60);
const story = all.find(s => slug(s.id) === STORY);
if (!story) { console.error('no story with slug ' + STORY); process.exit(2); }

const BADGE = { katha: 'Katha', itihaas: 'Itihaas', aaj: 'Aaj' };

/* Break a title into two BALANCED lines. Peeling the last word or two off the end gave
   "The Monkey Who Kept His Heart in / a Tree" -- a widow, and it reads as a mistake on a
   card that is otherwise carefully set. Split at the word boundary nearest the middle by
   character count; leave short titles alone. */
function balance(t) {
  const w = t.split(' ');
  if (w.length < 4) return t;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(' ').length, b = w.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return w.slice(0, best).join(' ') + '<br>' + w.slice(best).join(' ');
}
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CSS = `
html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{display:flex;align-items:__ALIGN__;justify-content:center;font-family:var(--body);background:__BG__}
.scrim{position:fixed;inset:0 0 auto 0;height:52%;z-index:0;
  background:linear-gradient(180deg,rgba(24,14,52,.70) 0%,rgba(24,14,52,.42) 58%,rgba(24,14,52,0) 100%)}
.wrap{position:relative;text-align:center;padding:__PAD__;max-width:1560px}
.kicker{position:relative;z-index:1;font-size:29px;letter-spacing:.24em;text-transform:uppercase;
  font-weight:800;color:__KICK__;margin-bottom:30px}
.scrim ~ .kicker,.scrim ~ h1,.scrim ~ p{text-shadow:0 2px 18px rgba(18,10,40,.7)}
h1{position:relative;z-index:1;font-family:var(--display);font-weight:800;font-size:__SIZE__px;
  line-height:1.07;letter-spacing:-.015em;margin:0 0 30px;color:__FG__}
p{position:relative;z-index:1;font-size:37px;line-height:1.5;margin:0;color:__SUB__;font-weight:600}
.rule{width:120px;height:5px;border-radius:99px;background:__KICK__;margin:0 auto 34px}
.brand{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:66px;
  font-family:var(--display);font-weight:800;font-size:46px;color:__FG__}
.brand img{width:80px;height:80px}
.brand i{font-style:italic;color:__KICK__}
.tag{font-size:26px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;
  color:__KICK__;margin-top:22px}
`;

function page(spec) {
  let css = CSS;
  for (const [k, v] of Object.entries(spec.vars)) css = css.split('__' + k + '__').join(v);
  return `<!doctype html><meta charset="utf-8">` +
    `<link rel="stylesheet" href="../../../app/tokens.css">` +
    `<link rel="stylesheet" href="../../../app/fonts.css">` +
    `<style>${css}</style><div class="wrap">${spec.body}</div>`;
}

const cards = {
  'card-title': {
    vars: { ALIGN: 'flex-start', BG: 'transparent', PAD: '92px 160px 0',
            FG: '#fffaf0', SUB: '#f6e6c8', KICK: '#f7c667', SIZE: '104' },
    body: `<div class="scrim"></div>` +
      `<div class="kicker">${esc(story.collection || 'Story')} &middot; ${BADGE[story.badge] || ''}</div>` +
      `<h1>${balance(esc(story.title))}</h1>` +
      `<p>${esc(story.hook)}</p>`,
  },
  'card-end': {
    vars: { ALIGN: 'center', BG: '#fdf4e4', PAD: '0 180px',
            FG: '#1e1440', SUB: '#5a4a72', KICK: '#d94f3d', SIZE: '58' },
    body: `<div class="rule"></div><h1>${esc(story.moral)}</h1>` +
      `<div class="brand"><img src="../../../app/art/logo.png" alt="">Bizzing <i>India</i></div>` +
      `<p class="tag">bizzingindia.com</p>`,
  },
};

(async () => {
  const pre = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, spec] of Object.entries(cards)) {
    const html = path.join(FILM, '_' + name + '.html');
    fs.writeFileSync(html, page(spec));
    await pg.goto('file://' + html);
    await pg.waitForTimeout(700);                       // let the self-hosted faces land
    await pg.screenshot({ path: path.join(FILM, name + '.png'),
                          omitBackground: spec.vars.BG === 'transparent' });
    fs.unlinkSync(html);
    console.log('  ' + name + ' rendered');
  }
  await b.close();
})();
