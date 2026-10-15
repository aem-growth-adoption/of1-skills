#!/usr/bin/env bash
# Step 3b: wait until the preview host serves the config sheet JSON.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
for i in $(seq 1 24); do
  if curl -s --connect-timeout 5 --max-time 15 -H 'Cache-Control: no-cache' "${PREVIEW_BASE}/of1/config/config.json" \
    | jq -e '(.data | type) == "array" and (.data | length) > 0' >/dev/null 2>&1; then
    echo "✓ ${PREVIEW_BASE}/of1/config/config.json serves the config sheet"; exit 0
  fi
  sleep 5
done
echo "⚠ config sheet not served by the preview host after 2 min — syncing anyway; re-run step 4 if the sync used stale config" >&2
