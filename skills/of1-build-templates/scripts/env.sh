# SOURCE this (bash/zsh-safe subset): `. "$SKILL_DIR/scripts/env.sh"`. Recreates the old per-phase preamble:
# repo-config -> OWNER/REPO/BRANCH/DOMAIN, DA_TOKEN (+probe), AEM_TOKEN, ORG, da-api.sh helpers,
# cd "$OF1_DEMO_REPO"; and, when OF1_TG_MODE=intent, validates + sets INTENT.
SKILL_DIR="${SKILL_DIR:?set SKILL_DIR to the skill directory}"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"
of1_load_env || return 1 2>/dev/null || exit 1
DA_TOKEN=$(da_resolve_token) \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE)" >&2; return 1 2>/dev/null || exit 1; }
AEM_TOKEN="${AEM_TOKEN:-$DA_TOKEN}"
da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || { return 1 2>/dev/null || exit 1; }
export ORG="$OWNER" REPO DA_TOKEN AEM_TOKEN BRANCH DOMAIN
. "$SKILL_DIR/assets/da-api.sh"
cd "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}" || { return 1 2>/dev/null || exit 1; }
if [ "${OF1_TG_MODE:-}" = intent ]; then
  INTENT="${OF1_TG_INTENT:-}"
  [ -n "$INTENT" ] || { echo "OF1_TG_INTENT required in intent mode" >&2; return 2 2>/dev/null || exit 2; }
  case "$INTENT" in comparison|recommendation|deep-dive|budget|discovery) ;;
    *) echo "OF1_TG_INTENT must be one of: comparison recommendation deep-dive budget discovery" >&2; return 2 2>/dev/null || exit 2;; esac
fi
