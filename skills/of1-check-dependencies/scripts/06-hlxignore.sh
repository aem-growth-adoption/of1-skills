#!/usr/bin/env bash
# Step 6: ensure .hlxignore does NOT block of1/config/.
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
if [ -f .hlxignore ] && grep -Eq '^of1/?$|^of1/config' .hlxignore; then
  # -i.bak works on both GNU and BSD/macOS sed (bare `-i` fails on BSD); drop the backup after.
  sed -E -i.bak '/^of1\/?$/d; /^of1\/config/d' .hlxignore && rm -f .hlxignore.bak
  # An uncommitted edit never reaches EDS — commit (scoped to .hlxignore) + push.
  git add -- .hlxignore
  git commit -m "chore: allow of1/config on the code bus" -- .hlxignore
  # Rebase onto the remote first so a concurrent push never rejects ours.
  . "$LIB/git-push.sh"
  git_push_rebased "$BRANCH" || exit 1
  echo "✓ Removed the of1/config exclusion from .hlxignore (committed + pushed)"
else
  echo "✓ .hlxignore does not block of1/config"
fi
