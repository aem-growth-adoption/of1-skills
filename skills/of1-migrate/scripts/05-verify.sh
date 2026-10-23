#!/usr/bin/env bash
# Step 5: converted extra sheets are served with the written row count; run publish checks 2, 3 and 6. All pass -> migrate-verified marker (required by step 3). Fails (exit 1) otherwise.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PUB="$SKILL_DIR/../of1-publish"
curl -s "${WORKER_URL}/api/tenants/${TENANT_ID}/status?stage=preview" > "$HUB/status.json"
[ -f "$OF1_STATE_DIR/migrate-cta" ] && export OF1_CTA_TEMPLATE=1
OUT="$OF1_STATE_DIR/migrate-checks.json"; echo '{}' > "$OUT"; BAD=0
# Every converted extra sheet must be served by the preview with as many rows as were written.
for n in signals llmquestions context-endpoints; do
  grep -qx "of1/config/$n.json" "$OF1_STATE_DIR/migrate-converted.txt" 2>/dev/null || continue
  WANT=$(jq length "$OF1_STATE_DIR/migrate-$n-rows.json" 2>/dev/null)
  GOT=$(curl -s --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "${PREVIEW_BASE}/of1/config/$n.json" 2>/dev/null | jq -r '.data | length' 2>/dev/null)
  if [ -n "$WANT" ] && [ "$GOT" = "$WANT" ]; then R=true; else R=false; BAD=1; jq -cn --arg s "sheet $n" --arg m "${PREVIEW_BASE}/of1/config/$n.json serves ${GOT:-no} rows, expected $WANT" '{step:$s, error:$m}' >> "$ERRORS"; echo "✗ $n sheet: ${GOT:-not served} rows, expected $WANT" >&2; fi
  echo "sheet $n: $R"
done
for n in 2 3 6; do
  if MSG=$(SKILL_DIR="$PUB" bash "$PUB/scripts/checks.sh" $n 2>&1); then R=true; else R=false; BAD=1; jq -cn --arg s "check $n" --arg m "$MSG" '{step:$s, error:$m}' >> "$ERRORS"; fi
  echo "check $n: $R"; jq --arg n "$n" --argjson r $R '.[$n] = $r' "$OUT" > "$OUT.t" && mv "$OUT.t" "$OUT"
done
[ "$BAD" = 0 ] || { echo "✗ verification failed — git config left in place; fix and re-run from step 4" >&2; exit 1; }
touch "$OF1_STATE_DIR/migrate-verified"; echo "✓ checks 2, 3, 6 passed"
