#!/usr/bin/env bash
# Step 8: ensure a query-index covers /of1/knowledge/** and /templates/** (helix-query.yaml).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
# Set SKIP_HELIX_QUERY=1 when the site's index is managed by the AEM config
# service — of1-publish step 2b handles those sites.
if [ "${SKIP_HELIX_QUERY:-0}" = "1" ]; then
  echo "↷ index managed by the AEM config service — no helix-query.yaml; of1-publish step 2b sets config.json overrides"
elif [ ! -f helix-query.yaml ]; then
  cat > helix-query.yaml <<'YAML'
version: 1
indices:
  of1-knowledge:
    include:
      - '/of1/knowledge/**'
      - '/templates/**'
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
YAML
  git add -- helix-query.yaml
  git commit -m "chore: index /of1/knowledge and /templates into query-index for OF1" -- helix-query.yaml
  . "$LIB/git-push.sh"
  git_push_rebased "$BRANCH" || exit 1
  echo "✓ created helix-query.yaml (indexes /of1/knowledge/** + /templates/** → /query-index.json)"
else
  # Warn only — never edit a customer's helix-query.yaml.
  # Match a quoted include path ('/templates/… or "/of1/knowledge/…), not any substring.
  for want in /of1/knowledge/ /templates/; do
    grep -qE "[\"']${want}" helix-query.yaml || {
      echo "⚠ helix-query.yaml exists but doesn't include ${want}** — left untouched." >&2
      echo "  Ask the site owner to include ${want}** in an index targeting /query-index.json;" >&2
      echo "  of1-publish step 2b will try config.json overrides, otherwise its checks 2/3 will fail." >&2
    }
  done
  echo "✓ helix-query.yaml present (customer-owned, not edited)"
fi
