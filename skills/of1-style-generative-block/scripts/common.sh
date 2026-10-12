# Sourced by of1-style-generative-block scripts (bash). SKILL_DIR is always derived from this
# file's location: of1-publish exports ITS OWN SKILL_DIR when it runs upload-of1-page.sh.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"
of1_load_env || exit 1
if [ -z "${DA_TOKEN:-}" ]; then   # of1-publish passes it already probed
  DA_TOKEN=$(da_resolve_token) \
    || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE, or provide .hlx/.da-token.json)" >&2; exit 1; }
  # Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
  da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
fi
