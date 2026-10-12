#!/usr/bin/env bash
# Step 9: write repo-config.json [<domain>] (resolves DOMAIN via 02-domain.sh; fails if empty).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
# Resolve DOMAIN ourselves (env/repo-config/content-source/fstab/argument) — never trust a
# caller-exported value that may be silently empty. Refuse to continue on empty.
DOMAIN=$(bash "$(dirname "${BASH_SOURCE[0]}")/02-domain.sh" "${1:-}") \
  || { echo "✗ FAIL: cannot resolve DOMAIN (02-domain.sh exit $?) — pass it as the argument" >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "✗ FAIL: DOMAIN is empty — refusing to write an empty domain" >&2; exit 1; }
mkdir -p "$OF1_STATE_DIR"
cat > "$OF1_STATE_DIR/repo-config.json" <<EOT
{
  "owner": "${OWNER}",
  "repo": "${REPO}",
  "branch": "${BRANCH}",
  "contentPrefix": "${BRANCH}",
  "repoDir": "${REPO_DIR}",
  "domain": "${DOMAIN}",
  "repoUrl": "https://github.com/${OWNER}/${REPO}",
  "previewUrl": "https://${BRANCH}--${REPO}--${OWNER}.aem.page/",
  "daSource": "da://${OWNER}/${REPO}"
}
EOT
echo "✓ repo-config.json written"
