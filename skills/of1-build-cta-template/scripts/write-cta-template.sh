#!/usr/bin/env bash
# Write the DA sheet /of1/config/cta-template (key,value) from a CTA JSON file {html, fallback:{title,description,buttonText}} and preview it.
# Usage: write-cta-template.sh <cta.json>   (env: OF1_STATE_DIR with repo-config.json)
set -e
SRC="${1:?usage: write-cta-template.sh <cta.json>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../../lib/env.sh"; of1_load_env || exit 1
ROWS="${OF1_STATE_DIR:?OF1_STATE_DIR required}/cta-template-rows.json"
jq -e '[.html, .fallback.title, .fallback.description, .fallback.buttonText] | all(type == "string" and length > 0)' "$SRC" >/dev/null \
  || { echo "✗ FAIL: $SRC needs html and fallback.{title,description,buttonText}" >&2; exit 1; }
# A hard-coded font-family names the EDS replica's fonts (e.g. amag_display), which do not exist on pages served
# from the tenant's real domain through the edge proxy, so the CTA fell back to Arial. Let the host page's fonts apply.
jq -e '.html | test("font-family"; "i") | not' "$SRC" >/dev/null \
  || { echo "✗ FAIL: the CTA html sets font-family. Remove it so the host page's own fonts apply (inherit) — a hard-coded EDS font name renders as Arial on real-domain pages" >&2; exit 1; }
jq -c '[{key:"html",value:.html},{key:"fallback.title",value:.fallback.title},
        {key:"fallback.description",value:.fallback.description},{key:"fallback.buttonText",value:.fallback.buttonText}]' "$SRC" > "$ROWS"
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE")
else WRITER=(node "$HERE/../../of1-integration/assets/da-write.mjs"); fi
"${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" \
  --path of1/config/cta-template --columns key,value --rows "$ROWS" \
  || { echo "✗ FAIL: writing /of1/config/cta-template failed" >&2; exit 1; }
