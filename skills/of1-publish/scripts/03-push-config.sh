#!/usr/bin/env bash
# Step 3: preview the config docs/sheets (config lives in DA; nothing is committed to git).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/curl-auth.sh"
for p in of1/config/config of1/config/cta-template of1/config/suggestions of1/config/template-list of1/config/personas of1/config/audiences; do
  code=$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' "https://admin.da.live/source/${OWNER}/${REPO}/${p}.json")
  [ "$code" = 200 ] || continue
  of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -X POST "https://admin.hlx.page/preview/${OWNER}/${REPO}/${BRANCH}/${p}.json" \
    && echo "✓ previewed $p"
done
