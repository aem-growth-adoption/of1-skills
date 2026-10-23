#!/usr/bin/env bash
# Step 3: preview the config docs/sheets (config lives in DA; nothing is committed to git). signals/llmquestions/
# context-endpoints are read by the edge proxy at request time; absent sheets (non-200 probe) are skipped.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/curl-auth.sh"
for p in of1/config/config of1/config/cta-template of1/config/suggestions of1/config/template-list of1/config/personas of1/config/audiences \
  of1/config/signals of1/config/llmquestions of1/config/context-endpoints; do
  code=$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' "https://admin.da.live/source/${OWNER}/${REPO}/${p}.json")
  [ "$code" = 200 ] || continue
  of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -X POST "https://admin.hlx.page/preview/${OWNER}/${REPO}/main/${p}.json" \
    && echo "✓ previewed $p"
done
