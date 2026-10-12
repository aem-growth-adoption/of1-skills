#!/usr/bin/env bash
# Step 3: capture pages in batches of 5 into $OF1_STATE_DIR/knowledge-pages.json.
# URLs: arguments, else lines of $OF1_STATE_DIR/product-urls.txt (hand-prune it first).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PRODUCT_URLS=()
if [ "$#" -gt 0 ]; then PRODUCT_URLS=("$@")
else
  while IFS= read -r u; do [ -n "$u" ] && PRODUCT_URLS+=("$u"); done < "$OF1_STATE_DIR/product-urls.txt"
fi
[ "${#PRODUCT_URLS[@]}" -gt 0 ] || { echo "FAIL: no URLs to capture (pass URLs or run discover-urls.sh)" >&2; exit 1; }

# playwright-cli writes .playwright-cli/ into cwd — pw runs it from the state dir in a
# subshell so it never lands in the repo and this shell's cwd doesn't change.
CAPTURE_JS="() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
  const blocks = [];
  root.querySelectorAll('h1,h2,h3,p,li,img').forEach((el) => {
    if (el.closest('nav,header,footer,aside')) return;
    if (el.tagName.toLowerCase() === 'img') {
      const src = el.currentSrc || el.src || '';
      if (src) blocks.push({ tag: 'img', src, alt: (el.alt || '').trim() });
      return;
    }
    const text = el.innerText.replace(/\\s+/g, ' ').trim();
    if (text) blocks.push({ tag: el.tagName.toLowerCase(), text });
  });
  return { url: location.href, title, blocks };
}"
rm -f "$PAGES"
BATCH_SIZE=5
for ((i=0; i<${#PRODUCT_URLS[@]}; i+=BATCH_SIZE)); do
  # Open this batch: first URL starts the browser, the rest are new tabs.
  first=1
  for URL in "${PRODUCT_URLS[@]:$i:$BATCH_SIZE}"; do
    if [ "$first" = 1 ]; then pw open "$URL"; first=0
    else pw tab-new "$URL"; fi
  done
  sleep 5  # wait for batch to render

  # Extract data from each tab in this batch.
  TAB_IDS=($(pw tab-list | grep -oE '^- [0-9]+:' | grep -oE '[0-9]+'))
  for TAB_ID in "${TAB_IDS[@]}"; do
    pw tab-select "$TAB_ID" >/dev/null
    # Readable page content for the knowledge RAG — same tab, no extra page load.
    CAP=$(pw eval "$CAPTURE_JS" | pw_result \
      | jq -c 'if type == "string" then fromjson else . end' 2>/dev/null)
    # Append to $PAGES with jq (never hand-concatenate); skip empty/failed captures.
    if [ -n "$CAP" ] && [ "$(jq '.blocks | length' <<<"$CAP" 2>/dev/null || echo 0)" -gt 0 ]; then
      if [ -f "$PAGES" ]; then
        jq --argjson p "$CAP" '. + [$p]' "$PAGES" > "$PAGES.tmp" && mv "$PAGES.tmp" "$PAGES"
      else
        jq -n --argjson p "$CAP" '[$p]' > "$PAGES"
      fi
    else
      echo "WARN: no content captured from tab $TAB_ID" >&2
    fi
  done

  # Close the whole batch (browser + tabs) before opening the next one.
  pw close >/dev/null 2>&1 || true
done
echo "captured $(jq length "$PAGES" 2>/dev/null || echo 0) page(s) → $PAGES"
