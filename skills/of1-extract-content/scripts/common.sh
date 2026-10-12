# Sourced by every of1-extract-content script (bash). Recreates the shared context.
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"; . "$LIB/pw.sh"
of1_load_env || exit 1
DA_TOKEN=$(da_resolve_token) \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE, or provide .hlx/.da-token.json)" >&2; exit 1; }
export DA_TOKEN
# Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
DA_WRITE="$SKILL_DIR/../of1-integration/assets/da-write.mjs"
PAGES="$OF1_STATE_DIR/knowledge-pages.json"

if [ -n "$OF1_CONTENT_SOURCE" ]; then
  # Extract from the REAL external site (content-source=<domain>).
  SOURCE_BASE="https://${OF1_CONTENT_SOURCE}"
else
  # Default: crawl the site's own EDS preview.
  SOURCE_BASE="https://${BRANCH}--${REPO}--${OWNER}.aem.page"
fi
echo "Extracting from: $SOURCE_BASE" >&2

cd "$OF1_DEMO_REPO" || exit 1
