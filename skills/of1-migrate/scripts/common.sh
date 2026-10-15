# Sourced by every of1-migrate script (bash). Runs in ONE EDS repo ($OF1_DEMO_REPO, branch = its current branch).
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
: "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}"; : "${OF1_STATE_DIR:?OF1_STATE_DIR required}"
mkdir -p "$OF1_STATE_DIR/hub"
cd "$OF1_DEMO_REPO" || exit 1
[ "$(git rev-parse --abbrev-ref HEAD)" != HEAD ] || { echo "✗ FAIL: detached HEAD — check out the branch to migrate first (it is passed to the worker as ref)" >&2; exit 1; }
if [ ! -f "$OF1_STATE_DIR/repo-config.json" ]; then
  _url=$(git remote get-url origin 2>/dev/null | sed -E 's#(\.git)?/?$##; s#.*[:/]([^/:]+)/([^/]+)$#\1 \2#')
  jq -n --arg o "${_url% *}" --arg r "${_url#* }" --arg b "$(git rev-parse --abbrev-ref HEAD)" \
    '{owner:$o, repo:$r, branch:$b, domain:""}' > "$OF1_STATE_DIR/repo-config.json"
fi
. "$LIB/env.sh"; . "$LIB/da-token.sh"; . "$LIB/curl-auth.sh"; . "$LIB/genweb.sh"
of1_load_env || exit 1
DA_TOKEN=$(da_resolve_token) || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE)" >&2; exit 1; }
da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
HUB="$OF1_STATE_DIR/hub"
RESULT="$OF1_STATE_DIR/of1-migrate-result.json"
ERRORS="$OF1_STATE_DIR/migrate-errors.jsonl"
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE"); else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
# fail <step> <message> — record the error for 06-report.sh and stop.
fail() { jq -cn --arg s "$1" --arg m "$2" --arg c "${3:-}" '{step:$s, error:$m} + (if $c != "" then {code:$c} else {} end)' >> "$ERRORS"; echo "✗ FAIL ($1): $2" >&2; exit 1; }
