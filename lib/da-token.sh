# Sourced helper (bash/zsh). No set -e/-u.
_da_tok_from_file() {
  [ -f "$1" ] || return 1
  node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.access_token||j.token||"")}catch(e){}' "$1"
}

da_resolve_token() {
  local t="" f
  if [ -n "${ADOBE_IMS_TOKEN:-}" ]; then printf '%s\n' "$ADOBE_IMS_TOKEN"; return 0; fi
  for f in "${OF1_TOKEN_FILE:-}" "$PWD/.hlx/.da-token.json" "${OF1_DEMO_REPO:+$OF1_DEMO_REPO/.hlx/.da-token.json}"; do
    [ -n "$f" ] || continue
    t=$(_da_tok_from_file "$f")
    if [ -n "$t" ]; then printf '%s\n' "$t"; return 0; fi
  done
  return 1
}

da_probe_token() {
  local owner="$1" repo="$2" tok="$3" code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 20 \
    -H "Authorization: Bearer $tok" "${DA_BASE:-https://admin.da.live}/list/$owner/$repo")
  case "$code" in
    200) return 0 ;;
    401|403) echo "FAIL: DA token expired or invalid (IMS tokens last ~3h) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE" >&2; return 1 ;;
    *) echo "WARN: DA probe returned HTTP $code (continuing)" >&2; return 0 ;;
  esac
}
