# Sourced helper (bash/zsh). No set -e/-u. Callers of gen-web without holding secrets.

# of1_proxy_base — same-origin gen-web passthrough: the edge proxy adds the caller
# credential and derives the tenant from the host. Override: OF1_GENERATE_BASE_URL.
of1_proxy_base() { printf '%s' "${OF1_GENERATE_BASE_URL:-${PROXY_BASE}}"; }

# of1_sync <worker-url> <org/repo> <out-file> [stage=preview]
# POST /api/tenants/<org>/<repo>/sync?stage=<stage>&ref=$BRANCH with `Authorization: Bearer $DA_TOKEN`. The token goes to
# curl via `-K -` (stdin, printf is a builtin): never in argv/ps, never echoed or saved.
# Never returns non-zero for sync errors: <out-file> always ends up valid JSON.
of1_sync() {
  local worker="$1" tenant="$2" out="$3" raw code body org repo stage="${4:-preview}"
  org="${tenant%%/*}"; repo="${tenant#*/}"
  if [ -z "${DA_TOKEN:-}" ]; then
    echo "✗ sync skipped: no DA token (set DA_TOKEN/ADOBE_IMS_TOKEN/OF1_TOKEN_FILE or provide .hlx/.da-token.json)" >&2
    printf '{"ok":false,"error":"no DA token"}\n' > "$out"; return 0
  fi
  raw=$(printf 'header = "Authorization: Bearer %s"\n' "$DA_TOKEN" \
    | curl -s -K - -X POST -w '\n%{http_code}' "${worker}/api/tenants/${org}/${repo}/sync?stage=${stage}&ref=${BRANCH}")
  code="${raw##*$'\n'}"; body="${raw%$'\n'*}"
  case "$code" in
    401|403)
      echo "✗ sync rejected (HTTP $code): DA token invalid or lacks access to ${org}/${repo}, or worker not configured" >&2
      jq -n --arg e "sync rejected (HTTP $code): DA token invalid or lacks access to ${org}/${repo}, or worker not configured" \
        '{ok:false, error:$e}' > "$out"; return 0 ;;
  esac
  if printf '%s' "$body" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '%s\n' "$body" > "$out"
  else
    echo "✗ sync returned a non-JSON response (HTTP ${code:-none})" >&2
    jq -n --arg e "sync returned non-JSON response (HTTP ${code:-none})" '{ok:false, error:$e}' > "$out"
  fi
  return 0
}

# of1_proxy_post <name> <json-body> -> sets PROXY_CODE and PROXY_BODY. No credentials.
of1_proxy_post() {
  local raw
  raw=$(curl -s --connect-timeout 10 --max-time 100 -X POST "$(of1_proxy_base)/api/$1" \
    -H "Content-Type: application/json" -d "$2" -w '\n%{http_code}' 2>/dev/null) || raw=$'\n000'
  PROXY_CODE="${raw##*$'\n'}"; PROXY_BODY="${raw%$'\n'*}"
}
