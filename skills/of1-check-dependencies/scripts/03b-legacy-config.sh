#!/usr/bin/env bash
# Step 3b: a git-tracked of1/config/config.json, cta-template.json, signals.json, llmquestions.json or context-endpoints.json is a legacy OF1 setup. Stop (exit 3) and hand off to of1-migrate.
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
LEGACY=$(git ls-files -- of1/config/config.json of1/config/cta-template.json of1/config/signals.json of1/config/llmquestions.json of1/config/context-endpoints.json)
if [ -n "$LEGACY" ]; then
  echo "Legacy OF1 setup found: run of1-skills:of1-migrate" >&2
  echo "(if the gen-web tenant is legacy too: admin-delete or admin-migrate it first, then of1-migrate)" >&2
  printf '%s\n' "$LEGACY" | sed 's/^/    /' >&2
  exit 3
fi
echo "✓ No migratable of1/config files tracked in git"
