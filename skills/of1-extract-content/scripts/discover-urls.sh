#!/usr/bin/env bash
# Step 2 (non-commerce): list candidate pages from the EDS index, else the nav.
# Prints URLs, one per line, and saves them to $OF1_STATE_DIR/product-urls.txt
# (capture-pages.sh reads that file when given no arguments).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# EDS JSON index (paths) — skip drafts/fragments/OF1/template paths. Read line by
# line into an array (no mapfile / unquoted splitting — works in bash and zsh).
PRODUCT_URLS=()
while IFS= read -r p; do [ -n "$p" ] && PRODUCT_URLS+=("${SOURCE_BASE}${p}"); done < <(
  curl -s --max-time 20 "${SOURCE_BASE}/sitemap.json" \
    | jq -r '[.. | objects | .path? // empty | strings] | .[]' 2>/dev/null \
    | grep -vE '^/(drafts|fragments|of1|templates|nav|footer)(/|$)' | head -20)
# Fallback: the nav fragment's site-relative links.
if [ "${#PRODUCT_URLS[@]}" -eq 0 ]; then
  while IFS= read -r p; do [ -n "$p" ] && PRODUCT_URLS+=("${SOURCE_BASE}${p}"); done < <(
    curl -s --max-time 20 "${SOURCE_BASE}/nav.plain.html" \
      | grep -oE 'href="/[^"#?]*"' | sed -E 's/^href="//; s/"$//' | sort -u | head -20)
fi
# Always capture the home page: prepend it when the index/nav didn't list it.
HOME_URL="${SOURCE_BASE}/"
has_home=0
for u in "${PRODUCT_URLS[@]}"; do [ "$u" = "$HOME_URL" ] && has_home=1; done
[ "$has_home" = 1 ] || PRODUCT_URLS=("$HOME_URL" "${PRODUCT_URLS[@]}")
printf '%s\n' "${PRODUCT_URLS[@]}" | tee "$OF1_STATE_DIR/product-urls.txt"
