#!/usr/bin/env bash
# Step 3b: wait for the pushed config.json to be served.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
CFG_LOCAL=$(jq -S . of1/config/config.json)
CFG_OK=false
for i in $(seq 1 24); do
  CFG_LIVE=$(curl -s --connect-timeout 5 --max-time 15 -H 'Cache-Control: no-cache' \
    "${PREVIEW_BASE}/of1/config/config.json" | jq -S . 2>/dev/null)
  if [ -n "$CFG_LIVE" ] && [ "$CFG_LIVE" = "$CFG_LOCAL" ]; then CFG_OK=true; break; fi
  sleep 5
done
if [ "$CFG_OK" = "true" ]; then
  echo "✓ ${PREVIEW_BASE}/of1/config/config.json matches the committed file"
else
  echo "⚠ config.json on the preview host still differs from the committed file after 2 min — syncing anyway; re-run step 4 if the sync used stale config" >&2
fi
