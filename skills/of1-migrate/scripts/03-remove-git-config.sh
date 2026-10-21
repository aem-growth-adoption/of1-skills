#!/usr/bin/env bash
# Step 3 (runs LAST, after 05 verified): git rm only the files 02 converted (of1/config/config.json, cta-template.json), commit by pathspec, push rebased. Never merges branches.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$OF1_STATE_DIR/migrate-verified" ] || fail 03 "verification has not passed — refusing to remove the git config"
CONVERTED=(); while IFS= read -r l; do [ -z "$l" ] || CONVERTED+=("$l"); done < <(cat "$OF1_STATE_DIR/migrate-converted.txt" 2>/dev/null)
[ "${#CONVERTED[@]}" -gt 0 ] || CONVERTED=(of1/config/config.json of1/config/cta-template.json)
TRACKED=$(git ls-files -- "${CONVERTED[@]}")
SUBJECT="chore: move OF1 config to DA (of1-migrate)"
if [ -z "$TRACKED" ] && [ -n "$(git ls-tree -r --name-only origin/main -- "${CONVERTED[@]}" 2>/dev/null)" ]; then
  fail 03 "the config files are gone locally but still on origin/main — pull first (local main is behind origin) and re-run from step 1"
fi
if [ -n "$TRACKED" ]; then
  git rm -q -- $TRACKED || fail 03 "git rm of the converted config files failed"
  git commit -q -m "$SUBJECT" -- $TRACKED || fail 03 "commit failed"
  MIG=$(git rev-parse HEAD)
  . "$LIB/git-push.sh"
  if ! git_push_rebased main; then
    # Undo only our own change, never local work: no --hard.
    if [ "$(git rev-parse HEAD)" = "$MIG" ]; then
      git reset -q --keep HEAD~1 2>/dev/null || { git checkout -q HEAD~1 -- $TRACKED; echo "⚠ could not drop the local commit without touching local changes; restored only the removed files (commit $MIG left in place)" >&2; }
    else
      SHA=$(git log -n1 --format=%H --grep="$SUBJECT" -F)
      [ -z "$SHA" ] || git revert --no-edit "$SHA" >/dev/null 2>&1 || { git revert --abort 2>/dev/null; echo "⚠ could not revert $SHA automatically" >&2; }
    fi
    fail 03 "push failed (rebase conflict or rejected) — local removal undone; re-run from step 4"
  fi
fi
touch "$OF1_STATE_DIR/migrate-removed"; echo "✓ git config removed from main"
