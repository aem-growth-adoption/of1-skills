#!/usr/bin/env bash
# Step 4b (only OF1_PUBLISH_LIVE=1): publish the OF1 config sheets and pages live (paths as da-write.mjs live expects:
# sheets with ".json", pages without extension). Writes hub/publish-live.json; exit 1 when anything other than "absent" failed.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
. "$LIB/curl-auth.sh"
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE"); else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
FAILED=(); N_OK=0
note_fail() { FAILED+=("$1: $2"); echo "✗ $1: $2" >&2; }
live() {
  if "${WRITER[@]}" live --owner "$OWNER" --repo "$REPO" --path "$1"; then N_OK=$((N_OK + 1)); else note_fail "$1" "publish failed"; fi
}
# present <da-source-path> -> 0 present, 1 absent (404), 2 probe error (401/403/5xx/network: recorded)
present() {
  local code
  code=$(of1_curl_auth DA_TOKEN auth -- -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "https://admin.da.live/source/${OWNER}/${REPO}/$1")
  case "$code" in 200) return 0 ;; 404) return 1 ;; *) note_fail "$1" "probe HTTP ${code:-none}"; return 2 ;; esac
}
# signals/llmquestions/context-endpoints: the edge proxy reads them from the publish host (aem.live).
for s in config cta-template suggestions template-list personas audiences signals llmquestions context-endpoints; do
  present "of1/config/$s.json" && live "of1/config/$s.json"
done
for p in of1 of1/brand-voice of1/strategy; do present "$p.html" && live "$p"; done
for d in of1/knowledge templates; do
  L=$(of1_curl_auth DA_TOKEN auth+source -- -s --connect-timeout 10 --max-time 30 "https://admin.da.live/list/${OWNER}/${REPO}/$d")
  if ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"$L"; then note_fail "$d" "listing failed"; continue; fi
  while read -r n; do live "$d/$n"; done < <(jq -r '.[] | select(.ext == "html") | .name' <<<"$L")
done
jq -n --argjson ok "$N_OK" --args '{ok: ($ARGS.positional | length == 0), published: $ok, failed: $ARGS.positional}' "${FAILED[@]}" > "$HUB/publish-live.json"
echo "publish live: $N_OK published, ${#FAILED[@]} failed"
[ "${#FAILED[@]}" -eq 0 ]
