#!/usr/bin/env bash
# Step 5: run publish checks 2, 3 and 6. All pass -> migrate-verified marker (required by step 3). Fails (exit 1) otherwise.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PUB="$SKILL_DIR/../of1-publish"
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status?stage=preview" > "$HUB/status.json"
[ -f "$OF1_STATE_DIR/migrate-cta" ] && export OF1_CTA_TEMPLATE=1
OUT="$OF1_STATE_DIR/migrate-checks.json"; echo '{}' > "$OUT"; BAD=0
for n in 2 3 6; do
  if MSG=$(SKILL_DIR="$PUB" bash "$PUB/scripts/checks.sh" $n 2>&1); then R=true; else R=false; BAD=1; jq -cn --arg s "check $n" --arg m "$MSG" '{step:$s, error:$m}' >> "$ERRORS"; fi
  echo "check $n: $R"; jq --arg n "$n" --argjson r $R '.[$n] = $r' "$OUT" > "$OUT.t" && mv "$OUT.t" "$OUT"
done
[ "$BAD" = 0 ] || { echo "✗ verification failed — git config left in place; fix and re-run from step 4" >&2; exit 1; }
touch "$OF1_STATE_DIR/migrate-verified"; echo "✓ checks 2, 3, 6 passed"
