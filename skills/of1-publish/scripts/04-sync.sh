#!/usr/bin/env bash
# Step 4 (check 2): preview sync, [04b live publish], publish sync -> hub/sync-{preview,publish}.json (+ sync.json = preview). Never fails on sync errors; checks.sh 2 does.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/genweb.sh"
report() {
  local f="$HUB/sync-$1.json" n
  jq . "$f"
  n=$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$f" 2>/dev/null)
  echo "Sync $1: ok=$(jq -r '.ok' "$f") synced=$(jq -c '.synced' "$f") errors=${n:-0} content.indexed=$(jq -r '.content.indexed // 0' "$f")"
  if [ "${n:-0}" -gt 0 ]; then
    echo "✗ $1 sync reported $n error(s):" >&2
    jq -c '.errors[] | select((.warning != null and .error == null) | not)' "$f" >&2
  fi
  jq -r '.errors // [] | .[] | select(.warning != null and .error == null) | "⚠ \(.file // "sync"): \(.warning)"' "$f" 2>/dev/null
}
of1_sync "$WORKER_URL" "$TENANT_ID" "$HUB/sync-preview.json" preview
cp "$HUB/sync-preview.json" "$HUB/sync.json"
report preview
rm -f "$HUB/publish-live.json"
if [ "${OF1_PUBLISH_LIVE:-}" = "1" ]; then bash "$SKILL_DIR/scripts/04b-publish-live.sh" || echo "⚠ publish-live reported failures (hub/publish-live.json); check 2 will fail" >&2; fi
of1_sync "$WORKER_URL" "$TENANT_ID" "$HUB/sync-publish.json" publish
report publish
if jq -e '.code == "legacy-tenant-present"' "$HUB/sync-publish.json" "$HUB/sync-preview.json" >/dev/null 2>&1; then
  echo "✗ STOP: $(jq -r 'select(.code == "legacy-tenant-present") | .error' "$HUB/sync-publish.json" "$HUB/sync-preview.json" | head -1)" >&2
  exit 3
fi
