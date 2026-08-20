#!/usr/bin/env bash
# Publish a rendered film to the gh-pages branch, WITHOUT committing it to the source branch.
#
# WHY IT IS NOT JUST `cp build/video/x.mp4 app/`. app/ is source and everything in it lands
# in git forever; a film is a build artefact that is re-rendered whenever a line of narration
# changes, so committing each cut would grow the repo by tens of megabytes per revision for
# versions nobody will ever check out. gh-pages is already a build-output branch — the film
# belongs there and only there.
#
# So this writes the blob straight into the gh-pages tree by plumbing: hash-object, read the
# existing tree, add one entry, commit, push. The source branch is untouched and the working
# directory is never checked out to another branch.
#
#   pipeline/publish.sh build/pt-talkative-tortoise/pt-talkative-tortoise-preview.mp4 \
#                       video/kambugriva.mp4
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${1:?usage: publish.sh <local file> <path on the site>}
DEST=${2:?usage: publish.sh <local file> <path on the site>}
[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }

# THE PREVIEW CAP. Deliberately a wall you have to step over rather than a hard refusal --
# PUBLISH_MAX_MB=60 is one keystroke -- but stepping over it should be a decision, not the
# thing you discover at 100 MiB when the push is rejected and the cut is already made.
MAX_MB=${PUBLISH_MAX_MB:-25}
SIZE=$(wc -c < "$SRC")
if [ "$SIZE" -gt $((MAX_MB * 1024 * 1024)) ]; then
  cat >&2 <<EOF
refusing $SRC
  $((SIZE / 1048576)) MiB, over the ${MAX_MB} MiB review-preview cap.

This publishes review previews -- the 720p, about 7 MB. Masters do not go in git: every cut
pushed stays in the gh-pages history forever, GitHub refuses anything over 100 MiB, and
episode one's master is 71.8 MiB already.

A finished film goes to YouTube (the channel) and to Drive (the archive), and what shipped
is recorded in films/<story>/released.json. See docs/01 §6.

If you really do mean to put this in git:  PUBLISH_MAX_MB=$(( SIZE / 1048576 + 1 )) $0 ...
EOF
  exit 1
fi

# A NEW CUT GETS A NEW URL. Republishing to a fixed path means the bytes change and the
# address does not, so the browser and the CDN both go on serving what they already have --
# and the reviewer, quite reasonably, reports that the fix is not there. It was; they could
# not see it. So the file also lands at a content-addressed name, and THAT is the link to
# hand anyone, because it cannot be stale by construction.
SHORT=$(git hash-object "$SRC" | cut -c1-8)
VDEST="${DEST%.*}-$SHORT.${DEST##*.}"

# The first film published from a fresh repo has no gh-pages to build on. That is a normal
# state, not an error, so start the branch rather than dying on a missing ref.
# Read the tip from FETCH_HEAD, not from origin/gh-pages. `git fetch origin gh-pages` with
# no refspec writes FETCH_HEAD and does NOT create a remote-tracking ref -- so in a clone
# that has never tracked the branch, rev-parse origin/gh-pages fails, this reads as "no
# gh-pages yet", and the publish silently becomes an ORPHAN commit holding one file whose
# push is then rejected as a non-fast-forward. Publishing four films that way landed the
# first and lost three, each after five retries, which is a loud failure only if you are
# reading stderr.
if git fetch origin gh-pages --quiet 2>/dev/null && BASE=$(git rev-parse FETCH_HEAD 2>/dev/null); then
  PARENT=(-p "$BASE")
else
  echo "no gh-pages branch yet -- starting one"
  BASE=""; PARENT=()
fi
BLOB=$(git hash-object -w "$SRC")
echo "blob $BLOB  ($(du -h "$SRC" | cut -f1))  -> $DEST"

# build the new tree with an index that is NOT the working index
export GIT_INDEX_FILE=$(mktemp -u /tmp/pubidx.XXXXXX)
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
if [ -n "$BASE" ]; then git read-tree "$BASE"; else git read-tree --empty; fi
git update-index --add --cacheinfo 100644,"$BLOB","$DEST"
git update-index --add --cacheinfo 100644,"$BLOB","$VDEST"
TREE=$(git write-tree)

if [ -n "$BASE" ] && [ "$TREE" = "$(git rev-parse "$BASE^{tree}")" ]; then
  echo "gh-pages already has this exact file — nothing to publish"
  exit 0
fi

COMMIT=$(git commit-tree "$TREE" "${PARENT[@]}" -m "Publish $DEST")
for i in 1 2 3 4 5; do
  if git push origin "$COMMIT":refs/heads/gh-pages; then
    SITE="https://$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+)/(.+?)(\.git)?$#\1.github.io/\2#')"
    echo "published: $SITE/$VDEST"
    echo "  (also at the stable path $SITE/$DEST — but that one can be served from cache)"
    exit 0
  fi
  echo "push failed, retry $i" >&2; sleep $((2**i))
done
echo "push failed after 5 attempts" >&2; exit 1
