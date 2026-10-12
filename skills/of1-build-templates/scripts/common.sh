# Sourced by of1-build-templates scripts (bash). Recreates the shared context.
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"
of1_load_env || exit 1
DA_TOKEN=$(da_resolve_token) \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE)" >&2; exit 1; }
# AEM preview uses the SAME IMS token (of1-check-dependencies probes org authorization).
AEM_TOKEN="${AEM_TOKEN:-$DA_TOKEN}"
# Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
export ORG="$OWNER" REPO DA_TOKEN AEM_TOKEN BRANCH   # da-api.sh reads these
. "$SKILL_DIR/assets/da-api.sh"
cd "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}" || exit 1

# Template doc paths, one per line, relative + extensionless (e.g. templates/x).
# Fails when da_list fails, returns a non-list (401/404 error body), or lists no .html docs —
# an empty /templates must never pass as "all previewed". (Never name a loop var `path`: zsh.)
template_docs() {
  local listing docs p
  listing=$(da_list templates) \
    || { echo "ABORT: da_list templates failed — check DA_TOKEN / path" >&2; return 1; }
  docs=$(printf '%s' "$listing" \
    | jq -r 'if type == "array" then .[] | select(.ext == "html") | .path else error("not a DA list") end' 2>/dev/null) \
    || { echo "ABORT: /templates listing is not a DA list: $(printf '%s' "$listing" | head -c 200)" >&2; return 1; }
  [ -n "$docs" ] \
    || { echo "ABORT: no /templates docs listed — check DA_TOKEN / path (did the intent phase da_put any?)" >&2; return 1; }
  printf '%s\n' "$docs" | while IFS= read -r p; do p="${p#/$ORG/$REPO/}"; printf '%s\n' "${p%.html}"; done
}
