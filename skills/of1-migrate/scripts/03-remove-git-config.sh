#!/usr/bin/env bash
# Step 3 (runs LAST, after 05 verified): git rm of1/config/*, commit by pathspec, push rebased. Never merges branches.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$OF1_STATE_DIR/migrate-verified" ] || fail 03 "verification has not passed — refusing to remove the git config"
TRACKED=$(git ls-files of1/config)
if [ -n "$TRACKED" ]; then
  git rm -q -r -- of1/config || fail 03 "git rm of1/config failed"
  git commit -q -m "chore: move OF1 config to DA (of1-migrate)" -- of1/config || fail 03 "commit failed"
  . "$LIB/git-push.sh"
  if ! git_push_rebased "$BRANCH"; then
    git reset -q --hard HEAD~1 2>/dev/null   # restore the config so a re-run still sees the legacy setup
    fail 03 "push failed (rebase conflict or rejected) — local removal undone; re-run from step 4"
  fi
fi
touch "$OF1_STATE_DIR/migrate-removed"; echo "✓ git config removed from $BRANCH"
