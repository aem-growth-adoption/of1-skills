#!/usr/bin/env bash
# Step 6: write $OF1_STATE_DIR/of1-migrate-result.json {status, repo, tenant, checks, errors}; exit 1 when failed.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
if [ -f "$RESULT" ] && [ "$(jq -r .status "$RESULT")" = already-new ]; then cat "$RESULT"; exit 0; fi
ST=failed; [ -f "$OF1_STATE_DIR/migrate-verified" ] && [ -f "$OF1_STATE_DIR/migrate-removed" ] && ST=migrated
ERR='[]'; [ -f "$ERRORS" ] && ERR=$(jq -s . "$ERRORS")
CHK='{}'; [ -f "$OF1_STATE_DIR/migrate-checks.json" ] && CHK=$(cat "$OF1_STATE_DIR/migrate-checks.json")
DET='{"keep":[],"warnings":[]}'; [ -f "$OF1_STATE_DIR/migrate-detect.json" ] && DET=$(cat "$OF1_STATE_DIR/migrate-detect.json")
jq -n --argjson d "$DET" --arg s "$ST" --arg r "${OWNER}/${REPO}" --arg t "$TENANT_ID" --argjson c "$CHK" --argjson e "$ERR" \
  '{status:$s, repo:$r, tenant:$t, checks:$c, errors:$e, keptInGit:$d.keep, warnings:$d.warnings}' > "$RESULT"
cat "$RESULT"; [ "$ST" = migrated ]
