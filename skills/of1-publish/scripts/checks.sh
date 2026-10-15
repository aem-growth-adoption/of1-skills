#!/usr/bin/env bash
# checks.sh <1..7|all> — Pre-Launch Checklist. `all` runs every applicable check
# (7 only when OF1_CTA_TEMPLATE=1), reports each, exits 1 if any failed.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/genweb.sh"

check_1() { assert_git_config; }

# sync_ok <file> <label> <strict:1|0> — strict also requires content.indexed > 0.
sync_ok() {
  local f="$1" l="$2" strict="$3"
  [ "$(jq -r .ok "$f" 2>/dev/null)" = "true" ] || { echo "✗ FAIL (check 2): $l sync ok != true — see $f (.error/.errors)" >&2; return 1; }
  [ "$(jq '[.errors // [] | .[] | select((.warning != null and .error == null) | not)] | length' "$f" 2>/dev/null || echo 1)" -eq 0 ] || { echo "✗ FAIL (check 2): $l sync errors (ok=true is not enough):" >&2; jq -c '.errors[]' "$f" >&2; return 1; }
  if [ "$strict" = 1 ] && [ "$(jq -r '.content.indexed // 0' "$f")" -le 0 ]; then
    echo "✗ FAIL (check 2): content.indexed = 0 — /of1/knowledge/** not in the worker's index (query-index.json or contentIngestion.indexPath — see step 2b; pages must be previewed)" >&2; return 1
  fi
}
check_2() {
  local pf="$HUB/sync-preview.json"; [ -f "$pf" ] || pf="$HUB/sync.json"
  sync_ok "$pf" preview 1 || exit 1
  echo "✓ preview sync ok, $(jq -r '.content.indexed // 0' "$pf") chunk(s) indexed"
  if [ -f "$HUB/publish-live.json" ] && [ "$(jq -r .ok "$HUB/publish-live.json")" != true ]; then
    echo "✗ FAIL (check 2): publish live failed:" >&2; jq -r '.failed[]' "$HUB/publish-live.json" >&2; exit 1
  fi
  if [ -f "$HUB/sync-publish.json" ]; then
    sync_ok "$HUB/sync-publish.json" publish 0 || exit 1
    echo "✓ publish sync ok ($(jq -r '.synced // [] | length' "$HUB/sync-publish.json") synced, $(jq -r '.content.indexed // 0' "$HUB/sync-publish.json") indexed)"
  fi
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
  # Not machine-judged: the reviewer reads the output above.
  echo "REVIEW check 4 output above: any HEADER/FOOTER/OF1 BLOCK MISSING, TITLE MISSING or chips: 0 is a failure"
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

# gen_one <base> <index> <label> <strict404:1|0> — one generate smoke test; returns 0 ok/warn, 1 fail.
gen_one() {
  local base="$1" idx="$2" label="$3" strict="$4" RESPONSE SECTIONS GEN_ERRORS
  OF1_GENERATE_BASE_URL="$base" of1_proxy_post generate "{\"id\":\"${TENANT_ID}\",\"index\":\"${idx}\",\"query\":\"show me your best products\",\"followUp\":false,\"context\":{\"browsing\":[],\"conversationHistory\":[]}}"
  RESPONSE="$PROXY_BODY"
  case "$PROXY_CODE" in
    401|403|404)
      if [ "$PROXY_CODE" = 404 ] && [ "$strict" = 0 ]; then echo "⚠ WARN (check 6): $base/api/generate HTTP 404 ($label not live yet) — skipped" >&2; return 0; fi
      echo "✗ FAIL (check 6): $base/api/generate returned HTTP $PROXY_CODE — the edge proxy rejected it (401/403: proxy credential not accepted by gen-web; 404: no passthrough route or tenant host not proxied). Set OF1_GENERATE_BASE_URL to override the base." >&2
      return 1 ;;
    200) ;;
    *) echo "⚠ WARN (check 6): $base/api/generate not reachable (HTTP $PROXY_CODE) — proxied host not available; generation smoke test NOT run" >&2; return 0 ;;
  esac
  if printf '%s' "$RESPONSE" | head -c 200 | grep -qiE '^[[:space:]]*<(!doctype|html)'; then
    echo "⚠ WARN (check 6): $base/api/generate returned HTML, not NDJSON — proxied host not available; generation smoke test NOT run" >&2; return 0
  fi
  SECTIONS=$(printf '%s\n' "$RESPONSE" | jq -R 'fromjson? | select(.type == "section")' | jq -s 'length')
  GEN_ERRORS=$(printf '%s\n' "$RESPONSE" | jq -R -c 'fromjson? | select(.type == "error")')
  if [ -n "$GEN_ERRORS" ]; then echo "✗ FAIL (check 6): $label generation streamed error event(s):" >&2; printf '%s\n' "$GEN_ERRORS" >&2; return 1
  elif [ "$SECTIONS" -ge 2 ]; then echo "✓ $label generation returned ${SECTIONS} sections"
  else echo "✗ FAIL (check 6): $label generation returned ${SECTIONS} sections (expected ≥2)" >&2; printf '%s\n' "$RESPONSE" | head -20; return 1; fi
}
check_6() {
  local rc=0
  gen_one "https://prev--${PROXY_HOST}.of1.live" preview preview 1 || rc=1
  local strict=0
  jq -e '((.synced // []) | length > 0) or (.content != null)' "$HUB/sync-publish.json" >/dev/null 2>&1 && strict=1
  gen_one "${OF1_GENERATE_BASE_URL:-$PROXY_BASE}" publish live "$strict" || rc=1
  exit $rc
}

check_7() {
  if [ "${OF1_CTA_TEMPLATE:-}" = "1" ]; then
    [ "$(jq -r '.config.hasCtaTemplate // false' "$HUB/status.json" 2>/dev/null)" = "true" ] \
      || { echo "✗ FAIL (check 7): hasCtaTemplate is not true in hub/status.json — DA sheet /of1/config/cta-template missing or not synced" >&2; exit 1; }
    of1_proxy_post personalize "{\"id\":\"${TENANT_ID}\",\"index\":\"preview\",\"elements\":{\"T0\":{\"tag\":\"h1\",\"text\":\"Welcome\"}},\"behaviorProfile\":{\"interests\":[],\"intent\":\"research\"}}"
    printf '%s\n' "$PROXY_BODY" > "$OF1_STATE_DIR/check-personalize.ndjson"
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
if [ "${OF1_CTA_TEMPLATE:-}" = "1" ]; then RANGE="1-3,5-7"; else RANGE="1-3,5-6"; fi
echo "✓ checks $RANGE passed; check 4 needs your review"
