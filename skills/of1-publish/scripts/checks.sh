#!/usr/bin/env bash
# checks.sh <1..7|all> — Pre-Launch Checklist. `all` runs every applicable check
# (7 only when OF1_CTA_TEMPLATE=1), reports each, exits 1 if any failed.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

check_1() { assert_git_config; }

check_2() {
  [ "$(jq -r .ok "$HUB/sync.json")" = "true" ] || { echo "✗ FAIL (check 2): sync ok != true — see $HUB/sync.json .errors" >&2; exit 1; }
  [ "$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$HUB/sync.json" 2>/dev/null || echo 1)" -eq 0 ] || { echo "✗ FAIL (check 2): sync errors (ok=true is not enough):" >&2; jq -c '.errors[]' "$HUB/sync.json" >&2; exit 1; }
  [ "$(jq -r '.content.indexed // 0' "$HUB/sync.json")" -gt 0 ] || { echo "✗ FAIL (check 2): content.indexed = 0 — /of1/knowledge/** not in the worker's index (query-index.json or contentIngestion.indexPath — see step 2b; pages must be published live)" >&2; exit 1; }
  echo "✓ sync ok, $(jq -r .content.indexed "$HUB/sync.json") chunk(s) indexed"
}

check_3() {
  [ "$(jq -r .ready "$HUB/status.json")" = "true" ] || {
    echo "✗ FAIL (check 3): tenant not ready; failing gated flags:" >&2
    jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[]
      | select((.key | IN($g[])) and (.value == false or .value == 0)) | "  \(.key)"' "$HUB/status.json" >&2
    exit 1
  }
  echo "✓ tenant ready"
  # Not gated — informational only (never fail on these):
  jq -r --argjson g "$GATED_FLAGS" '.config // {} | to_entries[] | select(.key | IN($g[]) | not) | "  · \(.key)=\(.value)"' "$HUB/status.json"
}

check_4() {
  pw open "${PREVIEW_BASE}/of1"
  sleep 6
  pw screenshot --full-page --filename "$OF1_STATE_DIR/check-of1.png"
  pw eval "() => (document.querySelector('header .header a') ? 'header OK' : 'HEADER MISSING')" | pw_result
  pw eval "() => (document.querySelector('footer .footer') && document.querySelector('footer .footer').textContent.trim() ? 'footer OK' : 'FOOTER MISSING')" | pw_result
  pw eval "() => (document.querySelector('main .of1') ? 'of1 block OK' : 'OF1 BLOCK MISSING')" | pw_result
  pw eval "() => (document.querySelector('.of1 .of1-title')?.textContent.trim() || 'TITLE MISSING')" | pw_result
  pw eval "() => ('chips: ' + document.querySelectorAll('.of1 .of1-chip').length)" | pw_result
  pw close >/dev/null 2>&1 || true
  jq -r '.title // "(no of1-landing.json title — SDK default expected)"' "$OF1_STATE_DIR/of1-landing.json" 2>/dev/null
}

check_5() {
  LINKS=(
    "${PREVIEW_BASE}/nav.plain.html"
    "${PREVIEW_BASE}/footer.plain.html"
    "${PREVIEW_BASE}/of1"
    "${PREVIEW_BASE}/deliverables/index.html"
  )
  # Only when a discovery deliverable exists — skipped automatically otherwise.
  [ -f "${OF1_STATE_DIR}/of1-discovery-output.md" ] && LINKS+=("${PREVIEW_BASE}/deliverables/discovery.html")
  
  ALL_OK=true
  for URL in "${LINKS[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
    if [ "$STATUS" = "200" ]; then echo "  ✓ $STATUS $URL"; else echo "  ✗ $STATUS $URL"; ALL_OK=false; fi
  done
  [ "$ALL_OK" = "true" ] || { echo "✗ FAIL (check 5): some deliverable URLs return non-200" >&2; exit 1; }
}

check_6() {
  RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"domain\":\"${TENANT_ID}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}")
  # The response is NDJSON (one event per line). Count real section events; any
  # {"type":"error"} line is a failure even if sections were also emitted.
  # (`grep -c … || echo 0` printed "0" twice on no match — never use it.)
  SECTIONS=$(printf '%s\n' "$RESPONSE" | jq -R 'fromjson? | select(.type == "section")' | jq -s 'length')
  GEN_ERRORS=$(printf '%s\n' "$RESPONSE" | jq -R -c 'fromjson? | select(.type == "error")')
  if [ -n "$GEN_ERRORS" ]; then
    echo "✗ FAIL (check 6): generation streamed error event(s):" >&2
    printf '%s\n' "$GEN_ERRORS" >&2
    exit 1
  elif [ "$SECTIONS" -ge 2 ]; then
    echo "✓ Generation returned ${SECTIONS} sections"
  else
    echo "✗ FAIL (check 6): generation returned ${SECTIONS} sections (expected ≥2)" >&2
    printf '%s\n' "$RESPONSE" | head -20
    exit 1
  fi
}

check_7() {
  if [ "${OF1_CTA_TEMPLATE:-}" = "1" ]; then
    [ -f of1/config/cta-template.json ] || { echo "✗ FAIL (check 7): of1/config/cta-template.json missing" >&2; exit 1; }
    curl -s -X POST "${WORKER_URL}/api/personalize" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"${TENANT_ID}\",\"elements\":{\"T0\":{\"tag\":\"h1\",\"text\":\"Welcome\"}},\"behaviorProfile\":{\"interests\":[],\"intent\":\"research\"}}" \
      > "$OF1_STATE_DIR/check-personalize.ndjson"
    grep -q '"type":"inject_cta"' "$OF1_STATE_DIR/check-personalize.ndjson" \
      && echo "✓ /api/personalize streamed inject_cta" \
      || { echo "✗ FAIL (check 7): no inject_cta event — is hasCtaTemplate true in hub/status.json?" >&2; exit 1; }
  fi
}

sel="${1:?usage: checks.sh <1..7|all>}"
if [ "$sel" != all ]; then
  case "$sel" in [1-7]) ;; *) echo "usage: checks.sh <1..7|all>" >&2; exit 2 ;; esac
  ( "check_$sel" ); exit $?
fi
FAILED=""
for n in 1 2 3 4 5 6 7; do
  [ "$n" = 7 ] && [ "${OF1_CTA_TEMPLATE:-}" != "1" ] && continue
  if ( "check_$n" ); then :; else FAILED="$FAILED $n"; fi
done
if [ -n "$FAILED" ]; then echo "✗ checks failed:$FAILED (of $N_CHECKS)" >&2; exit 1; fi
echo "✓ all $N_CHECKS checks passed"
