#!/usr/bin/env bash
# Prints the content-extraction outputs the chips must be based on.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Chip subjects — page titles plus their h1–h3 headings
jq -r '.[] | .title, (.blocks[] | select(.tag == "h1" or .tag == "h2" or .tag == "h3") | "  " + .text)' \
  "$OF1_STATE_DIR/knowledge-pages.json"

# Personas — each suggestion should target a real persona
jq -r '.[] | "\(.name): \(.description)"' "$OF1_STATE_DIR/personas-rows.json"

# Brand voice — personality, tone, words we use / avoid
curl -sf "https://$PREVIEW/of1/brand-voice.plain.html" || cat "$OF1_STATE_DIR/brand-voice.html"
