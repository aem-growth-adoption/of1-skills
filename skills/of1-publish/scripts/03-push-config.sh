#!/usr/bin/env bash
# Step 3: push the git config.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Only paths that exist (cta-template.json is absent when `OF1_CTA_TEMPLATE` is off).
PUSH=()
for f in "${ALLOWED[@]}"; do [ -f "$f" ] && PUSH+=("$f"); done
git add -- "${PUSH[@]}"
if ! git diff --cached --quiet -- "${PUSH[@]}"; then
  git commit -m "feat: OF1 config for ${DOMAIN}" -- "${PUSH[@]}"
  # Rebase onto the remote first so a concurrent push never rejects ours.
  . "$LIB/git-push.sh"
  git_push_rebased "$BRANCH" || exit 1
fi
