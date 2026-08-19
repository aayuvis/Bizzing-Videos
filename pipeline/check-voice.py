#!/usr/bin/env python3
"""Is every clip in this story the SAME narrator? Measure it; do not listen for it.

docs/02 §5.6 is the trap with the widest blast radius. The library was re-narrated by an
Indian-English narrator and the hook and moral clips were skipped -- 646 of them -- because
the tool that built the clip list did not emit those two keys. The app never noticed, because
it renders hook and moral as TEXT and never plays them. They were orphans. The first thing
that played them was a film, and the film changed accent at the end.

The brief's instruction after that was "check before you build: measure median F0 across a
story's clips; a 25+ Hz outlier is a different voice." This is that check -- it had no tool,
which meant in practice it was never run -- and it is that rule REFINED, because taking it
literally rejects good films.

A flat 25 Hz per-clip threshold flags emphatic delivery. Shot 7 of the SHIPPED
monkey-crocodile film -- "My wife wants to eat your heart" -- measures 225 Hz against a
192 Hz story median: 33 Hz out, one narrator, nothing whatever wrong with it. A check that
fails that shot is a check people learn to skip, which is worse than no check.

The fault §5.6 is actually about has a much more specific shape. Hook and moral came from a
DIFFERENT BATCH from the scenes, so they move TOGETHER, in the SAME DIRECTION. Two clips
agreeing is far stronger evidence than one clip being loud:

    batch fault   hook and moral both off the scenes, same side, by MORE THAN the band  -> FAIL
    odd clip      one clip outside the band                                             -> note

The band is median +/- max(25 Hz, 3 x MAD), so a story read with wide variation widens its
own tolerance instead of crying wolf. The batch test has to clear that same band, and that
second scaling is not decoration either. jt-crocodile-rock is full of shouted dialogue --
"HEY, ROCK!", "GOOD EVENING" -- which drags its scene median up to 203 Hz while its quiet
hook and moral sit at 174 and 179. Both ends, both low, 26 Hz out: the §5.6 shape exactly,
and completely innocent. Against a band of 38 Hz it is what it actually is, a story read
with range.

WHAT SETTLES IT IS THE CORPUS, not one story. Measured across a 45-story sample: hook sits
+1.6 Hz from its scenes on average, moral +3.3 Hz, and the two land on the same side 42% of
the time -- a coin flip. There is no library-wide hook/moral offset, so the generator fix
that closed §5.6 held. Re-run that sample before believing any single story's verdict; a
suspicious story is only suspicious relative to the corpus it came from.

    python3 pipeline/check-voice.py                      # $STORY, or the default film
    python3 pipeline/check-voice.py jt-crocodile-rock
    python3 pipeline/check-voice.py --all                # every story the app narrates
    python3 pipeline/check-voice.py --self-test          # the decision, against known cases

Exit code is 1 on the batch fault, so it can gate a build. Odd clips are reported, not
failed -- look at them, then decide.

METHOD. Autocorrelation per 40ms frame over 60-400 Hz, on frames with enough energy to be
voiced, then the median across frames. Absolute accuracy does not matter here -- the question
is never "what pitch is this", it is "is this clip the same speaker as its neighbours", and
for that a consistent estimator and a median are enough.
"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402

SR = 16000
FRAME = int(0.040 * SR)
HOP = int(0.020 * SR)
F_MIN, F_MAX = 60, 400
OUTLIER_HZ = 25          # docs/02 §5.6 -- the floor of the per-clip band
PAIR_HZ = 15             # floor for the batch test; the story's own band raises it

FF = subprocess.run(['python3', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
                    capture_output=True, text=True, check=True).stdout.strip()


def pcm(path):
    """Decode to 16 kHz mono float, via ffmpeg because the mp3s are all the app has."""
    out = subprocess.run([FF, '-v', 'quiet', '-i', path, '-f', 's16le', '-ac', '1',
                          '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype='<i2').astype(np.float32) / 32768.0


def f0(x):
    """Median F0 over the voiced frames. None if the clip is too short or all silence."""
    if len(x) < FRAME * 2:
        return None
    n = 1 + (len(x) - FRAME) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, FRAME), strides=(x.strides[0] * HOP, x.strides[0])).copy()
    frames -= frames.mean(axis=1, keepdims=True)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    # voiced-ish: the loud half of the clip, which skips the leading and trailing silence
    # the app's recordings all carry (docs/02 §5.6 clips have ~0.5s of air at each end)
    keep = rms > max(rms.max() * 0.25, 1e-4)
    if keep.sum() < 3:
        return None
    lo, hi = SR // F_MAX, SR // F_MIN
    picks = []
    for fr in frames[keep]:
        # autocorrelation via FFT; normalise so the peak is a real periodicity, not just energy
        sp = np.fft.rfft(fr, 2 * FRAME)
        ac = np.fft.irfft(sp * np.conj(sp))[:FRAME]
        if ac[0] <= 0:
            continue
        ac /= ac[0]
        seg = ac[lo:hi]
        if not len(seg):
            continue
        k = int(np.argmax(seg))
        if seg[k] < 0.30:        # too weak to be periodic -- unvoiced, skip it
            continue
        picks.append(SR / (lo + k))
    return float(np.median(picks)) if len(picks) >= 3 else None


def verdict(scenes, hook, moral):
    """The decision, with no audio in it, so it can be tested. Returns (band, pair_dev, batch)."""
    med = float(np.median(scenes))
    mad = float(np.median([abs(x - med) for x in scenes]))
    band = max(OUTLIER_HZ, 3 * 1.4826 * mad)
    pair_dev, batch = 0.0, False
    if hook and moral:
        dh, dm = hook - med, moral - med
        if dh * dm > 0:                                # same side of the scenes
            pair_dev = (dh + dm) / 2
            batch = abs(pair_dev) > max(PAIR_HZ, band)
    return med, band, pair_dev, batch


def self_test():
    """The checker has to catch the fault it exists for, and clear the ones it does not."""
    cases = [
        # (name, scenes, hook, moral, should_fail)
        ('docs/02 §5.6, as measured: hook 210 / moral 224 over 182-195 scenes',
         [182, 188, 190, 195, 186, 191, 184, 193], 210, 224, True),
        ('jt-crocodile-rock: shouted scenes, quiet ends -- innocent',
         [203, 203, 195, 193, 239, 200, 222, 213, 194], 174, 179, False),
        ('pt-monkey-crocodile as shipped -- innocent',
         [188, 184, 185, 216, 190, 193, 200, 225, 216, 190], 216, 188, False),
        ('pt-talkative-tortoise as shipped -- innocent',
         [200, 195, 190, 188, 188, 213, 186, 182], 184, 211, False),
        ('ends split either side of the scenes is never a batch',
         [188, 190, 186, 191], 230, 150, False),
    ]
    bad = 0
    for name, sc, h, m, want in cases:
        med, band, dev, got = verdict(sc, h, m)
        ok = 'ok  ' if got == want else 'FAIL'
        if got != want:
            bad += 1
        print('  %s %-62s med %3.0f band %4.1f pair %+5.1f -> %s' %
              (ok, name, med, band, dev, 'batch fault' if got else 'clean'))
    print('\n%s' % ('all cases as expected' if not bad else '%d CASE(S) WRONG' % bad))
    return 1 if bad else 0


def check(story, quiet=False):
    """Measure a story. Returns (failed, warnings) -- failed is the batch fault only."""
    segs = ['hook'] + [str(i) for i in range(40)] + ['moral']
    rows = []
    for seg in segs:
        p = sources.app('voice', 'st', '%s-%s.mp3' % (story, seg))
        if os.path.exists(p):
            rows.append((seg, f0(pcm(p))))
    if not rows:
        print('%s: no narration at all' % story)
        return True, ['(no clips)']

    scenes = [hz for seg, hz in rows if hz and seg not in ('hook', 'moral')]
    if not scenes:
        print('%s: no measurable scene clips' % story)
        return False, []
    ends = {seg: hz for seg, hz in rows if seg in ('hook', 'moral') and hz}
    med, band, pair_dev, batch = verdict(scenes, ends.get('hook'), ends.get('moral'))

    warn = [seg for seg, hz in rows if hz and abs(hz - med) > band]

    if not quiet:
        print('%s  -- %d clips, scenes median %.0f Hz, band +/-%.0f Hz' %
              (story, len(rows), med, band))
        for seg, hz in rows:
            if hz is None:
                print('   %-6s     --   (unmeasurable)' % seg); continue
            mark = ''
            if seg in ('hook', 'moral') and batch:
                mark = '  <-- with the other end clip, a different batch'
            elif seg in warn:
                mark = '  <-- outside the band (check it; emphasis reads like this too)'
            print('   %-6s %5.0f Hz  %+5.0f%s' % (seg, hz, hz - med, mark))
        if batch:
            print('   hook and moral are both %.0f Hz %s the scenes -- the docs/02 §5.6 shape'
                  % (abs(pair_dev), 'below' if pair_dev < 0 else 'above'))
    return batch, warn


def main(argv):
    if '--self-test' in argv:
        return self_test()
    quiet = '--quiet' in argv
    names = [a for a in argv if not a.startswith('-')]
    if '--all' in argv:
        import re
        app = sources.app_dir()
        stems = set()
        for f in os.listdir(os.path.join(app, 'voice', 'st')):
            m = re.match(r'(.+)-(hook|moral|\d+)\.mp3$', f)
            if m:
                stems.add(m.group(1))
        names = sorted(stems)
        print('checking %d stories\n' % len(names))
    if not names:
        names = [sources.STORY]

    failed, warned = {}, {}
    for n in names:
        bad, warn = check(n, quiet=quiet and len(names) > 1)
        if bad:
            failed[n] = True
        if warn:
            warned[n] = warn
        if not quiet:
            print()

    if warned and quiet:
        print('%d story/stories with a clip outside its band (emphasis looks like this too, '
              'so these are notes, not failures):' % len(warned))
        for n, segs in sorted(warned.items())[:20]:
            print('  %-28s %s' % (n, ' '.join(segs)))
        print()
    if failed:
        print('%d story/stories where HOOK AND MORAL BOTH sit off the scenes, same side.' % len(failed))
        for n in sorted(failed):
            print('  %s' % n)
        print('\nThat is the docs/02 §5.6 shape: those two clips came from a different batch')
        print('than the scenes. A film built on them changes voice at the open and the close.')
        return 1
    print('no story has the hook/moral batch signature -- one voice from open to close')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
