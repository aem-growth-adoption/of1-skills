#!/usr/bin/env bash
# Step 4 (check 2): sync -> hub/sync.json. Never fails on sync errors; checks.sh 2 does.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/genweb.sh"
# Worker requires `Authorization: Bearer <DA token>` (gen-web #69); sent via curl -K - so it stays out of ps.
of1_sync "$WORKER_URL" "$TENANT_ID" "$HUB/sync.json"
jq . "$HUB/sync.json"
OK=$(jq -r '.ok' "$HUB/sync.json")
INDEXED=$(jq -r '.content.indexed // 0' "$HUB/sync.json")
# `{file, warning}` entries are non-fatal warnings — not counted as errors.
N_ERR=$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$HUB/sync.json" 2>/dev/null)
echo "Sync: ok=$OK synced=$(jq -c '.synced' "$HUB/sync.json") errors=${N_ERR:-0} content.indexed=$INDEXED"
# `if`, not `[ … ] && …`: a bare && as the block's last command would leave a
# non-zero status when there are no errors.
if [ "${N_ERR:-0}" -gt 0 ]; then
  echo "✗ sync reported $N_ERR error(s) (a failure even though ok=$OK):" >&2
  jq -c '.errors[] | select((.warning != null and .error == null) | not)' "$HUB/sync.json" >&2
fi
jq -r '.errors // [] | .[] | select(.warning != null and .error == null) | "⚠ \(.file // "sync"): \(.warning)"' "$HUB/sync.json" 2>/dev/null
