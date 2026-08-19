"""Where the app is — the Python half of the seam. See sources.js for the reasoning.

The asset generator needs one thing out of the app: the story's own painting, which is
where the palette, the light and the landscape come from (docs/01 §1). Everything else it
draws itself.
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_CANDIDATES = [
    ('$BIZZING_INDIA', os.environ.get('BIZZING_INDIA')),
    ('beside this repo', os.path.join(REPO, '..', 'bizzingindia.com')),
]

_cached = None


def _looks_right(d):
    """The two files every stage needs. A bare directory match fails later, mid-run."""
    return (os.path.exists(os.path.join(d, 'tokens.css')) and
            os.path.isdir(os.path.join(d, 'voice')))


def app_dir():
    global _cached
    if _cached:
        return _cached
    tried = []
    for why, root in _CANDIDATES:
        if not root:
            continue
        for d in (os.path.join(root, 'app'), root):
            tried.append('  %s   (%s)' % (d, why))
            if _looks_right(d):
                _cached = os.path.abspath(d)
                return _cached
    sys.exit(
        "Cannot find the Bizzing India app.\n\n"
        "The films are drawn from the app's own story paintings and cut to its own\n"
        "narration -- nothing on the channel is invented for the channel (docs/02 §3,\n"
        "Rule 1) -- so this repo needs a bizzingindia.com checkout to read from:\n\n"
        "    git clone https://github.com/aayuvis/bizzingindia.com ../bizzingindia.com\n\n"
        "or point BIZZING_INDIA at one you already have:\n\n"
        "    BIZZING_INDIA=~/src/bizzingindia.com python3 pipeline/gen-assets.py\n\n"
        "Looked in:\n" + '\n'.join(tried) + "\n")


def app(*parts):
    return os.path.join(app_dir(), *parts)


def painting(slug):
    """The story's own painting: the source of the palette and the landscape."""
    return app('art', 'story', slug + '.jpg')


# WHICH FILM. Read out of films/<story>/assets.json, so the generator carries no knowledge
# of any particular story -- which is the whole test of whether this scales past the first.
STORY = os.environ.get('STORY', 'pt-talkative-tortoise')
FILM = os.path.join(REPO, 'films', STORY)
