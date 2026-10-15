#!/usr/bin/env bash
# Step 2b: index coverage — config sheet overrides (DA sheet of1/config/config, key/value rows) (knowledge indexPath) + removal of a stale templates.names.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Paths in an EDS JSON index, one per line — read exactly the way the worker does:
# top-level `.data[].path`. A multi-sheet index (`:type: multi-sheet`, data under
# per-sheet keys) is NOT readable by the worker: warn and return non-zero so it's
# never chosen as indexPath.
index_paths() {
  local body
  body=$(curl -s --connect-timeout 10 --max-time 30 "${PREVIEW_BASE}$1" 2>/dev/null) || return 1
  if jq -e 'type == "object" and (.data | type) == "array"' >/dev/null 2>&1 <<<"$body"; then
    jq -r '.data[]?.path // empty' <<<"$body"
  elif jq -e 'type == "object" and (.[":type"] == "multi-sheet" or has(":names"))' >/dev/null 2>&1 <<<"$body"; then
    echo "⚠ $1 is a multi-sheet index — the worker only reads top-level .data; not usable" >&2
    return 2
  else
    return 1
  fi
}

# Config is a DA sheet {data:[{key,value}]} served at ${PREVIEW_BASE}/of1/config/config.json.
ROWS_FILE="$OF1_STATE_DIR/config-rows.json"
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE"); else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
SHEET=$(curl -s --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "${PREVIEW_BASE}/of1/config/config.json" 2>/dev/null)
jq -e '(.data | type) == "array"' >/dev/null 2>&1 <<<"$SHEET" \
  || { echo "✗ FAIL: ${PREVIEW_BASE}/of1/config/config.json is not a config sheet — run of1-check-dependencies step 7 (or of1-migrate)" >&2; exit 1; }
ROWS=$(jq -c '[.data[] | {key, value}]' <<<"$SHEET")
ROWS_NEW="$ROWS"
INDEX_CANDIDATES=(/sitemap.json)
CUR_INDEX_PATH=$(jq -r '.[] | select(.key == "contentIngestion.indexPath") | .value' <<<"$ROWS")
CUR_INDEX_IS_OURS=false
for idx in "${INDEX_CANDIDATES[@]}"; do [ "$CUR_INDEX_PATH" = "$idx" ] && CUR_INDEX_IS_OURS=true; done

QI_PATHS=$(index_paths /query-index.json)
QI_HAS_KNOWLEDGE=false
grep -q '^/of1/knowledge/' <<<"$QI_PATHS" && QI_HAS_KNOWLEDGE=true
echo "query-index.json: knowledge=$QI_HAS_KNOWLEDGE"

if [ -n "$CUR_INDEX_PATH" ] && [ "$CUR_INDEX_IS_OURS" != "true" ]; then
  echo "· contentIngestion.indexPath = $CUR_INDEX_PATH is user-set — left untouched"
elif [ "$QI_HAS_KNOWLEDGE" = "true" ]; then
  ROWS_NEW=$(jq -c 'map(select(.key != "contentIngestion.indexPath"))' <<<"$ROWS")
else
  KNOWLEDGE_INDEX=""
  for idx in "${INDEX_CANDIDATES[@]}"; do
    if index_paths "$idx" | grep -q '^/of1/knowledge/'; then KNOWLEDGE_INDEX="$idx"; break; fi
  done
  if [ -n "$KNOWLEDGE_INDEX" ]; then
    ROWS_NEW=$(jq -c --arg p "$KNOWLEDGE_INDEX" 'map(select(.key != "contentIngestion.indexPath")) + [{key:"contentIngestion.indexPath", value:$p}]' <<<"$ROWS")
    echo "→ contentIngestion.indexPath = $KNOWLEDGE_INDEX"
  else
    echo "⚠ no single-sheet index lists /of1/knowledge/ (tried: ${INDEX_CANDIDATES[*]}) — check 2 (content.indexed > 0) will fail." >&2
    echo "  The site owner must add /of1/knowledge/** to an index (helix-query.yaml or the AEM config service)." >&2
  fi
fi

if [ "$(jq -S . <<<"$ROWS_NEW")" != "$(jq -S . <<<"$ROWS")" ]; then
  printf '%s\n' "$ROWS_NEW" > "$ROWS_FILE"
  "${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
    --path of1/config/config --columns key,value --rows "$ROWS_FILE" || exit 1
  echo "✓ config sheet updated + previewed"
else
  echo "✓ config sheet already matches index coverage — unchanged"
fi
