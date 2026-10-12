#!/usr/bin/env bash
# base step 5: commit + push new block code, then wait until the code bus serves each block JS.
# Usage: commit-block-code.sh <name>...   (OF1_CODESYNC_TRIES / OF1_CODESYNC_SLEEP tune the wait)
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ $# -gt 0 ] || { echo "usage: commit-block-code.sh <block-name>..." >&2; exit 2; }
for n in "$@"; do git add "blocks/$n/"; done
git commit -m "feat: add general-purpose $* block(s) for OF1 templates" || exit 1
. "$LIB/git-push.sh"
git_push_rebased "$BRANCH" || exit 1
for n in "$@"; do
  ok=0
  for i in $(seq 1 "${OF1_CODESYNC_TRIES:-30}"); do
    curl -sf -o /dev/null "${PREVIEW_BASE}/blocks/$n/$n.js" && { ok=1; break; }
    sleep "${OF1_CODESYNC_SLEEP:-5}"
  done
  [ "$ok" = 1 ] || { echo "✗ FAIL: blocks/$n/$n.js not live on the code bus after waiting" >&2; exit 1; }
  echo "✓ blocks/$n live"
done
