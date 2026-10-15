#!/usr/bin/env bash
# Step 1: detect a legacy setup (git-tracked of1/config/* or a triple tenant id). Nothing found -> already-new result, exit 0.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
rm -f "$ERRORS" "$RESULT" "$OF1_STATE_DIR"/migrate-{verified,removed}
TRACKED=$(git ls-files of1/config)
TRIPLE=$(jq -r '.TENANT_ID // .tenantId // empty | select(test("--"))' "$OF1_STATE_DIR/repo-config.json" 2>/dev/null)
jq -n --arg t "$TRACKED" --arg tr "$TRIPLE" '{tracked: ($t | split("\n") | map(select(. != ""))), triple: $tr}' > "$OF1_STATE_DIR/migrate-detect.json"
if [ -z "$TRACKED" ] && [ -z "$TRIPLE" ]; then
  jq -n --arg r "${OWNER}/${REPO}" --arg ref "$BRANCH" --arg t "$TENANT_ID" \
    '{status:"already-new", repo:$r, ref:$ref, tenant:$t, checks:{}, errors:[]}' > "$RESULT"
  echo "already-new: nothing to migrate in ${OWNER}/${REPO}"; exit 0
fi
echo "legacy setup found in ${OWNER}/${REPO}@${BRANCH}:"; printf '%s\n' "$TRACKED" | sed 's/^/    /'
[ -z "$TRIPLE" ] || echo "    tenant id ${TRIPLE} (triple form)"
