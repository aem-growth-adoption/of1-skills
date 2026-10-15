#!/usr/bin/env bash
# Step 5 (check 3): tenant status -> hub/status.json.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status?stage=preview" > "$HUB/status.json"
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status?stage=publish" > "$HUB/status-publish.json"
echo "publish status (informational): ready=$(jq -r .ready "$HUB/status-publish.json" 2>/dev/null)"
jq . "$HUB/status.json"
echo "ready=$(jq -r .ready "$HUB/status.json")"
# Gated flags → failures; everything else → info only.
jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[]
  | if (.key | IN($g[])) then
      (if (.value == false or .value == 0) then "  ✗ \(.key) (gates ready)" else "  ✓ \(.key)" end)
    else "  · \(.key)=\(.value) (info)" end' "$HUB/status.json"
