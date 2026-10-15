#!/usr/bin/env bash
# Step 4b (only OF1_PUBLISH_LIVE=1): publish the OF1 config sheets and pages live. A failed page is reported, never fatal.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/curl-auth.sh"
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE"); else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
da_list() { of1_curl_auth DA_TOKEN auth+source -- -s "https://admin.da.live/list/${OWNER}/${REPO}$1"; }
live() {
  "${WRITER[@]}" live --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" --path "$1" \
    || echo "⚠ could not publish $1 live — continuing" >&2
}
exists() { [ "$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' "https://admin.da.live/source/${OWNER}/${REPO}/$1")" = 200 ]; }
for s in config cta-template suggestions template-list personas audiences; do
  exists "of1/config/$s.json" && live "of1/config/$s.json"
done
for p in of1 of1/brand-voice of1/strategy; do exists "$p.html" && live "$p"; done
for d in of1/knowledge templates; do
  da_list "/$d" | jq -r '.[]? | select(.ext == "html") | .name' | while read -r n; do live "$d/$n"; done
done
exit 0
