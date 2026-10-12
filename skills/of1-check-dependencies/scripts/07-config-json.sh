#!/usr/bin/env bash
# Step 7: write of1/config/config.json + push [<domain>] (resolves DOMAIN via 02-domain.sh; fails if empty).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
# Resolve DOMAIN ourselves (env/repo-config/content-source/fstab/argument) — never trust a
# caller-exported value that may be silently empty. Refuse to continue on empty.
DOMAIN=$(bash "$(dirname "${BASH_SOURCE[0]}")/02-domain.sh" "${1:-}") \
  || { echo "✗ FAIL: cannot resolve DOMAIN (02-domain.sh exit $?) — pass it as the argument" >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "✗ FAIL: DOMAIN is empty — refusing to write an empty domain" >&2; exit 1; }
mkdir -p of1/config
cat > of1/config/config.json <<EOT
{ "domain": "${DOMAIN}" }
EOT
git add -- of1/config/config.json
# Commit ONLY config.json, even if something else happens to be staged.
if ! git diff --cached --quiet -- of1/config/config.json; then
  git commit -m "feat: OF1 config.json for ${DOMAIN}" -- of1/config/config.json
  # Rebase onto the remote first so a concurrent push never rejects ours.
  . "$LIB/git-push.sh"
  git_push_rebased "$BRANCH" || exit 1
  echo "✓ of1/config/config.json committed + pushed"
fi
