#!/usr/bin/env bash
# Step 3: preview the config docs/sheets (config lives in DA; nothing is committed to git). signals/llmquestions/
# context-endpoints are read by the edge proxy at request time; absent sheets (non-200 probe) are skipped.
# A failed preview is reported and counted but never stops the run (check 2 and the sync catch real problems): exit 0.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/curl-auth.sh"
OK=0; FAILED=0
for p in of1/config/config of1/config/cta-template of1/config/suggestions of1/config/template-list of1/config/personas of1/config/audiences \
  of1/config/signals of1/config/llmquestions of1/config/context-endpoints; do
  code=$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' "https://admin.da.live/source/${OWNER}/${REPO}/${p}.json")
  [ "$code" = 200 ] || continue
  code=$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' -X POST "https://admin.hlx.page/preview/${OWNER}/${REPO}/main/${p}.json")
  case "$code" in
    200 | 201) OK=$((OK + 1)); echo "✓ previewed $p" ;;
    *) FAILED=$((FAILED + 1)); echo "✗ preview failed $p (HTTP ${code:-none})" >&2 ;;
  esac
done
echo "previewed $OK, failed $FAILED"
exit 0
