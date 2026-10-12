#!/usr/bin/env bash
# Step 7: write of1/config/config.json + push (needs DOMAIN exported).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
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
