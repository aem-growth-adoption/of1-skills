#!/usr/bin/env bash
# Step 6: DA listings -> hub/da-{pages,templates,knowledge}.txt
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
da_list() {
  curl -s -H "Authorization: Bearer $DA_TOKEN" \
    -H "x-content-source-authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/list/${OWNER}/${REPO}$1"
}
# Site pages (one "<name>.html" per line) — the hub's EDS pages section.
da_list ""               | jq -r '.[] | select(.ext == "html") | .name + ".html"' > "$HUB/da-pages.txt"
# Template docs (names, no extension) — the authoring showcase.
da_list "/templates"     | jq -r '.[] | select(.ext == "html") | .name' > "$HUB/da-templates.txt"
# Knowledge pages (slugs, no extension).
da_list "/of1/knowledge" | jq -r '.[] | select(.ext == "html") | .name' > "$HUB/da-knowledge.txt"
for f in da-pages da-templates da-knowledge; do
  [ -s "$HUB/$f.txt" ] || echo "WARN: $HUB/$f.txt is empty — that hub section will be empty"
done
