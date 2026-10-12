#!/usr/bin/env bash
# Step 1 (no discovery output): list candidate pages (nav, else index) and print the
# undecorated markup of the home page + up to 4 others.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Candidate pages: nav links first, else the JSON index. Collected into an
# array line by line (no unquoted word-splitting — works in bash and zsh).
PAGE_PATHS=()
while IFS= read -r p; do [ -n "$p" ] && PAGE_PATHS+=("$p"); done < <(
  curl -s --max-time 20 "${SOURCE_BASE}/nav.plain.html" \
    | grep -oE 'href="/[^"#?]*"' | sed -E 's/^href="//; s/"$//' | sort -u)
if [ "${#PAGE_PATHS[@]}" -eq 0 ]; then
  while IFS= read -r p; do [ -n "$p" ] && PAGE_PATHS+=("$p"); done < <(
    curl -s --max-time 20 "${SOURCE_BASE}/sitemap.json" \
      | jq -r '[.. | objects | .path? // empty | strings] | .[]' 2>/dev/null \
      | grep -vE '^/(drafts|fragments|of1|templates)(/|$)')
fi
printf '%s\n' "${PAGE_PATHS[@]}" | head -20
# Fetch the home page + up to 4 others (pick the most editorial ones from the list):
PICK=(/)
for p in "${PAGE_PATHS[@]}"; do [ "$p" = "/" ] || PICK+=("$p"); [ "${#PICK[@]}" -ge 5 ] && break; done
for page in "${PICK[@]}"; do
  if [ "$page" = "/" ]; then plain="${SOURCE_BASE}/index.plain.html"; else plain="${SOURCE_BASE}${page%/}.plain.html"; fi
  echo "=== $page"; curl -s --max-time 20 "$plain" | head -c 20000; echo
done
