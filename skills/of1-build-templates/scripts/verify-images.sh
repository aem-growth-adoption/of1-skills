#!/usr/bin/env bash
# assemble step 3b: every image in every template must be real. Aborts (non-zero) on
#  - placeholder / invented / unusable images (placehold.co, picsum.photos, about:error, example-*.jpg, bare media_1.png), and
#  - any image URL that is not served as an image (HTTP 200 + image/*), resolved against the template's preview path.
# Static findings are reported without any HTTP probe. Prints "✓ <doc>: N image(s) ok" per clean template.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
DOCS=$(template_docs) || exit 1
FAILED=0
while IFS= read -r doc; do
  [ -n "$doc" ] || continue
  html=$(curl -sf "${PREVIEW_BASE}/${doc}.plain.html") \
    || { echo "ABORT: ${doc}.plain.html not served — preview didn't materialize" >&2; exit 1; }
  bad=$(printf '%s' "$html" | node "$SKILL_DIR/assets/template-images.mjs"); rc=$?
  if [ -n "$bad" ] || [ "$rc" -ne 0 ]; then
    echo "✗ $doc: $(printf '%s\n' "$bad" | grep -c .) bad image(s) — replace with real images from the site's own pages (see harvest-sections):" >&2
    printf '%s\n' "$bad" | sed 's/^/    /' >&2; FAILED=1; continue
  fi
  n=0; broken=""
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    case "$u" in
      http*) full="$u" ;;
      //*) full="https:$u" ;;
      /*) full="${PREVIEW_BASE}$u" ;;
      *) full="${PREVIEW_BASE}/${doc%/*}/${u#./}" ;;
    esac
    res=$(curl -s -L --max-time 25 -o /dev/null -w '%{http_code} %{content_type}' "$full")
    case "$res" in "200 image/"*) n=$((n + 1)) ;; *) broken="${broken}    ${res}	${full}"$'\n' ;; esac
  done < <(printf '%s' "$html" | node "$SKILL_DIR/assets/template-images.mjs" --urls)
  if [ -n "$broken" ]; then echo "✗ $doc: image URL(s) not served as an image:" >&2; printf '%s' "$broken" >&2; FAILED=1; continue; fi
  echo "✓ $doc: $n image(s) ok"
done <<<"$DOCS"
[ "$FAILED" -eq 0 ] || { echo "ABORT: templates reference images that do not exist — fix the DA docs, re-preview, re-run" >&2; exit 1; }
