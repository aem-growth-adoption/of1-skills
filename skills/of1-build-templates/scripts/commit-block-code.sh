#!/usr/bin/env bash
# base step 5: commit (one commit per block) + push new block code, then wait for the code bus
# (non-fatal, as before: warns if a block JS never goes live).
# Usage: commit-block-code.sh <name>...   (OF1_CODESYNC_TRIES / OF1_CODESYNC_SLEEP tune the wait)
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ $# -gt 0 ] || { echo "usage: commit-block-code.sh <block-name>..." >&2; exit 2; }
for n in "$@"; do
  git add "blocks/$n/"
  if ! git diff --cached --quiet -- "blocks/$n/"; then
    git commit -q -m "feat: add general-purpose $n block for OF1 templates" -- "blocks/$n/" || exit 1
  else
    echo "✓ blocks/$n: nothing to commit"
  fi
done
# Rebase onto the remote first so a concurrent push never rejects ours.
. "$LIB/git-push.sh"
git_push_rebased "$BRANCH" || exit 1
for n in "$@"; do
  ok=0
  for i in $(seq 1 "${OF1_CODESYNC_TRIES:-30}"); do
    curl -sf -o /dev/null "${PREVIEW_BASE}/blocks/$n/$n.js" && { ok=1; break; }
    sleep "${OF1_CODESYNC_SLEEP:-5}"
  done
  if [ "$ok" = 1 ]; then echo "✓ blocks/$n live"
  else echo "WARN: blocks/$n/$n.js not live on the code bus after waiting — continuing" >&2; fi
done
