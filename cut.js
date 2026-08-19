#!/usr/bin/env node
/* Cut the rendered shots to the app's own narration, and mux.
 *
 * Same rule as the generative pipeline it replaces: THE AUDIO IS THE CLOCK. But here the
 * shots were rendered at exactly their narration length in the first place, so there is no
 * trimming and no stretching -- a shot cannot be cut away from a sentence because it was
 * built to fit one. Re-record a line and the film re-renders to the new length for free.
 *
 * Title and end cards are the ones already rendered in the app's own type; Veo's audio is
 * not a consideration here because nothing generated any.
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
const VOICE = path.join(ROOT, 'app', 'voice', 'st');
const CARDS = FILM;
const SLUG = STORY;
const scenes = JSON.parse(fs.readFileSync(path.join(FILM, 'scenes.json'), 'utf8'));
const FF = execFileSync('python3',
  ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
const run = a => execFileSync(FF, ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });

const cut = path.join(OUT, 'cut'); fs.mkdirSync(cut, { recursive: true });
const shots = scenes.shots.filter(s => fs.existsSync(path.join(OUT, s.id + '.mp4')));
if (shots.length !== scenes.shots.length)
  console.log('note: ' + shots.length + ' of ' + scenes.shots.length + ' shots present');

/* the opening title rides on the first shot rather than sitting on a card of its own */
const title = path.join(CARDS, 'card-title.png');
const first = path.join(OUT, shots[0].id + '.mp4');
const firstOut = path.join(cut, 'v-first.mp4');
if (fs.existsSync(title)) {
  run(['-i', first, '-loop', '1', '-t', '20', '-i', title, '-filter_complex',
       "[1:v]format=rgba,fade=t=in:st=0.5:d=0.7:alpha=1,fade=t=out:st=5.4:d=0.8:alpha=1[t];" +
       "[0:v][t]overlay=0:0:format=auto:shortest=1",
       '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', firstOut]);
} else { fs.copyFileSync(first, firstOut); }

/* the end card: the moral, the mark, and three and a half seconds of quiet to read it */
const endCard = path.join(CARDS, 'card-end.png');
const endV = path.join(cut, 'v-end.mp4'), endA = path.join(cut, 'a-end.m4a');
if (fs.existsSync(endCard)) {
  run(['-loop', '1', '-t', '3.5', '-i', endCard, '-vf', 'scale=1920:1080,fade=t=in:st=0:d=0.5',
       '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '24', endV]);
  run(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '3.5',
       '-c:a', 'aac', '-b:a', '160k', endA]);
}

const vlist = path.join(cut, 'v.txt'), alist = [];
fs.writeFileSync(vlist, shots.map((s, i) =>
  "file '" + (i === 0 ? firstOut : path.join(OUT, s.id + '.mp4')) + "'").join('\n') +
  (fs.existsSync(endV) ? "\nfile '" + endV + "'" : '') + '\n');
shots.forEach(s => alist.push(path.join(VOICE, SLUG + '-' + s.seg + '.mp3')));
if (fs.existsSync(endA)) alist.push(endA);

const vid = path.join(cut, 'video.mp4'), aud = path.join(cut, 'audio.m4a');
run(['-f', 'concat', '-safe', '0', '-i', vlist, '-c', 'copy', vid]);

const inputs = [], filt = [];
alist.forEach((a, i) => { inputs.push('-i', a); filt.push(`[${i}:a]apad=pad_dur=0.35[a${i}]`); });
run([...inputs, '-filter_complex',
     filt.join(';') + ';' + alist.map((_, i) => `[a${i}]`).join('') +
     `concat=n=${alist.length}:v=0:a=1[o]`,
     '-map', '[o]', '-c:a', 'aac', '-b:a', '160k', aud]);

const master = path.join(OUT, STORY + '.mp4');
run(['-i', vid, '-i', aud, '-map', '0:v:0', '-map', '1:a:0',
     '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000',
     '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', '-movflags', '+faststart', master]);
const prev = path.join(OUT, STORY + '-preview.mp4');
/* THE PREVIEW MUST BE SMALLER THAN THE MASTER, which sounds too obvious to state until
   it is not true: a fixed 2.2 Mbps produced a 720p "preview" 0.6 MB LARGER than the 1080p
   master, because flat cel animation at CRF 20 already lands below that. A fixed bitrate
   is not a smaller encode, it is just a different one. Quality-targeted at both sizes, so
   the relationship holds whatever the content does. */
run(['-i', master, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-crf', '28',
     '-preset', 'slow', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', prev]);
for (const f of [master, prev])
  console.log(path.basename(f).padEnd(40) + ' ' + (fs.statSync(f).size / 1e6).toFixed(1) + ' MB');
