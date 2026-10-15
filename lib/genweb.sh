# Sourced helper (bash/zsh). No set -e/-u. Callers of gen-web without holding secrets.

# of1_proxy_base — same-origin gen-web passthrough: the edge proxy adds the caller
# credential and derives the tenant from the host. Override: OF1_GENERATE_BASE_URL.
of1_proxy_base() { printf '%s' "${OF1_GENERATE_BASE_URL:-${PROXY_BASE}}"; }

[ -n "${BASH_SOURCE[0]:-}" ] && ! type of1_curl_auth >/dev/null 2>&1 && . "$(dirname "${BASH_SOURCE[0]}")/curl-auth.sh"

# of1_sync <worker-url> <org/repo> <out-file> [stage=preview]
# POST /api/tenants/<org>/<repo>/sync?stage=<stage>&ref=$BRANCH with `Authorization: Bearer $DA_TOKEN` (via of1_curl_auth: `-K -`, charset-validated).
# The URL path uses the ORIGINAL-case $OWNER/$REPO when set (gen-web authorizes against DA with the id as sent and lowercases the canonical id itself).
# Never returns non-zero for sync errors: <out-file> always ends up valid JSON. HTTP 409 / "not migrated" -> {ok:false, code:"legacy-tenant-present"}.
of1_sync() {
  local worker="$1" tenant="$2" out="$3" raw code body org repo stage="${4:-preview}" ref_q=""
  org="${OWNER:-${tenant%%/*}}"; repo="${REPO:-${tenant#*/}}"
  [ -n "${BRANCH:-}" ] && ref_q="&ref=$(jq -rn --arg b "$BRANCH" '$b|@uri')"
  if [ -z "${DA_TOKEN:-}" ]; then
    echo "✗ sync skipped: no DA token (set DA_TOKEN/ADOBE_IMS_TOKEN/OF1_TOKEN_FILE or provide .hlx/.da-token.json)" >&2
    printf '{"ok":false,"error":"no DA token"}\n' > "$out"; return 0
  fi
  raw=$(of1_curl_auth DA_TOKEN auth -- -s -X POST -w '\n%{http_code}' "${worker}/api/tenants/${org}/${repo}/sync?stage=${stage}${ref_q}")
  code="${raw##*$'\n'}"; body="${raw%$'\n'*}"
  case "$code" in
    401|403)
      echo "✗ sync rejected (HTTP $code): DA token invalid or lacks access to ${org}/${repo}, or worker not configured" >&2
      jq -n --arg e "sync rejected (HTTP $code): DA token invalid or lacks access to ${org}/${repo}, or worker not configured" \
        '{ok:false, error:$e}' > "$out"; return 0 ;;
    409)
      echo "✗ $(of1_legacy_message "$org" "$repo")" >&2
      jq -n --arg e "$(of1_legacy_message "$org" "$repo")" '{ok:false, code:"legacy-tenant-present", error:$e}' > "$out"; return 0 ;;
  esac
  if printf '%s' "$body" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '%s\n' "$body" > "$out"
  else
    echo "✗ sync returned a non-JSON response (HTTP ${code:-none})" >&2
    jq -n --arg e "sync returned non-JSON response (HTTP ${code:-none})" '{ok:false, error:$e}' > "$out"
  fi
  return 0
}

of1_legacy_message() {
  printf 'Legacy gen-web data exists for %s/%s. An admin must either delete the legacy tenant (DELETE /api/admin/tenants/<legacy id>) so this sync recreates it from DA, or run POST /api/admin/migrate-tenants?tenant=%s/%s; then re-run.' "$1" "$2" "$1" "$2"
}

# of1_proxy_post <name> <json-body> -> sets PROXY_CODE and PROXY_BODY. No credentials.
of1_proxy_post() {
  local raw
  raw=$(curl -s --connect-timeout 10 --max-time 100 -X POST "$(of1_proxy_base)/api/$1" \
    -H "Content-Type: application/json" -d "$2" -w '\n%{http_code}' 2>/dev/null) || raw=$'\n000'
  PROXY_CODE="${raw##*$'\n'}"; PROXY_BODY="${raw%$'\n'*}"
}
