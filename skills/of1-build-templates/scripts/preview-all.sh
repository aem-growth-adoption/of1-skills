#!/usr/bin/env bash
# assemble step 1: aem_preview every composed template doc (MANDATORY — no preview, no .plain.html).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Capture first so a template_docs failure isn't masked by a pipeline's exit status.
DOCS=$(template_docs) || exit 1
while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  aem_preview "$doc" || { echo "ABORT: preview failed for $doc (see the status above)" >&2; exit 1; }
done <<<"$DOCS"
