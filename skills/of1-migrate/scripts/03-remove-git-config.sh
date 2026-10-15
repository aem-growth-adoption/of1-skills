#!/usr/bin/env bash
# Step 3 (runs LAST, after 05 verified): git rm of1/config/*, commit by pathspec, push rebased. Never merges branches.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$OF1_STATE_DIR/migrate-verified" ] || fail 03 "verification has not passed — refusing to remove the git config"
TRACKED=$(git ls-files of1/config)
SUBJECT="chore: move OF1 config to DA (of1-migrate)"
if [ -z "$TRACKED" ] && [ -n "$(git ls-tree -r --name-only "origin/$BRANCH" -- of1/config 2>/dev/null)" ]; then
  fail 03 "of1/config is gone locally but still on origin/$BRANCH — pull first (local branch is behind origin) and re-run from step 1"
fi
if [ -n "$TRACKED" ]; then
  git rm -q -r -- of1/config || fail 03 "git rm of1/config failed"
  git commit -q -m "$SUBJECT" -- of1/config || fail 03 "commit failed"
  MIG=$(git rev-parse HEAD)
  . "$LIB/git-push.sh"
  if ! git_push_rebased "$BRANCH"; then
    # Undo only our own change, never local work: no --hard.
    if [ "$(git rev-parse HEAD)" = "$MIG" ]; then
      git reset -q --keep HEAD~1 2>/dev/null || { git checkout -q HEAD~1 -- of1/config; echo "⚠ could not drop the local commit without touching local changes; restored of1/config only (commit $MIG left in place)" >&2; }
    else
      SHA=$(git log -n1 --format=%H --grep="$SUBJECT" -F)
      [ -z "$SHA" ] || git revert --no-edit "$SHA" >/dev/null 2>&1 || { git revert --abort 2>/dev/null; echo "⚠ could not revert $SHA automatically" >&2; }
    fi
    fail 03 "push failed (rebase conflict or rejected) — local removal undone; re-run from step 4"
  fi
fi
touch "$OF1_STATE_DIR/migrate-removed"; echo "✓ git config removed from $BRANCH"
