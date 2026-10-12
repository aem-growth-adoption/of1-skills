#!/usr/bin/env bash
# assemble step 3: reject empty templates (0 blocks), warn on thin exploratory ones (Max Items >= 3, < 3 blocks).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
DOCS=$(template_docs) || exit 1
while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  html=$(curl -sf "${PREVIEW_BASE}/${doc}.plain.html") \
    || { echo "ABORT: ${doc}.plain.html not served — preview didn't materialize" >&2; exit 1; }
  # Prints "<blocks> <maxItems>"; no output = the helper itself failed, never default it to 0.
  RICH=$(printf '%s' "$html" | node "$SKILL_DIR/assets/template-richness.mjs")
  [ -n "$RICH" ] || { echo "ABORT: template-richness.mjs printed nothing for $doc — check node / \$SKILL_DIR" >&2; exit 1; }
  read -r n maxItems <<<"$RICH"
  [ "$n" -eq 0 ] && { echo "ABORT: $doc has 0 content blocks — empty template, fix before assemble" >&2; exit 1; }
  if [ -n "$maxItems" ] && [ "$maxItems" -ge 3 ] && [ "$n" -lt 3 ]; then
    echo "WARN: exploratory $doc (Max Items $maxItems) has only $n content blocks (target 4–5)" >&2
  fi
  echo "✓ $doc: $n content block(s), Max Items ${maxItems:-?}"
done <<<"$DOCS"
