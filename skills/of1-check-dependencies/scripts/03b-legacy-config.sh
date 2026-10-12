#!/usr/bin/env bash
# Step 3b: legacy of1/config/*.json. Usage: 03b-legacy-config.sh [remove|keep]
# No argument: remove when OF1_NON_INTERACTIVE=1, otherwise list and exit 2 (caller asks, re-runs).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
ALLOWED=(of1/config/config.json)
[ "${OF1_CTA_TEMPLATE:-}" = "1" ] && ALLOWED+=(of1/config/cta-template.json)
LEGACY=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  ok=0; for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || LEGACY+=("$f")
done < <(git ls-files of1/config)
if [ "${#LEGACY[@]}" -gt 0 ]; then
  echo "Legacy OF1 config files tracked in git (would shadow DA config / no longer read):"
  printf '    %s\n' "${LEGACY[@]}"
else
  echo "✓ No legacy of1/config files tracked"
fi
DECISION="${1:-}"
[ -z "$DECISION" ] && [ "${OF1_NON_INTERACTIVE:-}" = "1" ] && DECISION=remove
if [ "${#LEGACY[@]}" -gt 0 ] && [ -z "$DECISION" ]; then exit 2; fi
if [ "${#LEGACY[@]}" -gt 0 ] && [ "$DECISION" = "keep" ]; then
  echo "WARN: keeping legacy files — of1-publish check 1 will fail until they're gone" >&2
  exit 0
fi
if [ "${#LEGACY[@]}" -gt 0 ]; then
  git rm -q -f -- "${LEGACY[@]}"
  # Commit only files that exist in HEAD: a `git commit -- <path>` whose pathspec
  # git no longer knows (staged-but-never-committed file) fails the whole commit.
  C=()
  for f in "${LEGACY[@]}"; do git cat-file -e "HEAD:$f" 2>/dev/null && C+=("$f"); done
  if [ "${#C[@]}" -gt 0 ]; then
    git commit -m "chore: remove legacy OF1 config JSON" -- "${C[@]}"
    # Rebase onto the remote first so a concurrent push never rejects ours.
    . "$LIB/git-push.sh"
    git_push_rebased "$BRANCH" || exit 1
  fi
  echo "✓ Removed legacy OF1 config JSON: ${LEGACY[*]}"
fi
