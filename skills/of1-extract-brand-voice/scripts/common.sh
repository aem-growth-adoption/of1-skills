# Sourced by every of1-extract-brand-voice script (bash). Recreates the shared context.
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"
of1_load_env || exit 1
# Resolve the token in the shell only to probe it (da-write.mjs resolves its own, same order).
DA_TOKEN="${DA_TOKEN:-$(da_resolve_token)}"
if [ -n "$DA_TOKEN" ]; then
  # Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
  da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
else
  echo "WARN: no DA token resolvable in the shell — skipping the probe (da-write.mjs will report)" >&2
fi
PREVIEW="$PREVIEW_HOST"
DA_WRITE="$SKILL_DIR/../of1-integration/assets/da-write.mjs"

if [ -n "$OF1_CONTENT_SOURCE" ]; then
  SOURCE_BASE="https://${OF1_CONTENT_SOURCE}"
else
  SOURCE_BASE="https://main--${REPO}--${OWNER}.aem.page"
fi
echo "Extracting from: $SOURCE_BASE" >&2
cd "$OF1_DEMO_REPO" || exit 1
