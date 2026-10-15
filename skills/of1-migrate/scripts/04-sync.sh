#!/usr/bin/env bash
# Step 4: preview sync, [publish-live], publish sync (ref = current branch). Writes hub/sync-{preview,publish}.json. A failed sync is recorded by 05.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
of1_sync "$WORKER_URL" "$TENANT_ID" "$HUB/sync-preview.json" preview
cp "$HUB/sync-preview.json" "$HUB/sync.json"
PUB="$SKILL_DIR/../of1-publish"
rm -f "$HUB/publish-live.json"
if [ "${OF1_PUBLISH_LIVE:-}" = "1" ]; then SKILL_DIR="$PUB" bash "$PUB/scripts/04b-publish-live.sh" || echo "⚠ publish-live reported failures (hub/publish-live.json); step 4 verification will fail" >&2; fi
of1_sync "$WORKER_URL" "$TENANT_ID" "$HUB/sync-publish.json" publish
for s in preview publish; do echo "sync $s: ok=$(jq -r .ok "$HUB/sync-$s.json") ref=$BRANCH"; done
