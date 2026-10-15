#!/usr/bin/env bash
# Step 3b: any git-tracked of1/config/* is a legacy OF1 setup. Stop (exit 3) and hand off to of1-migrate.
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
LEGACY=$(git ls-files of1/config)
if [ -n "$LEGACY" ]; then
  echo "Legacy OF1 setup found: run of1-skills:of1-migrate" >&2
  printf '    %s\n' $LEGACY >&2
  exit 3
fi
echo "✓ No of1/config files tracked in git"
