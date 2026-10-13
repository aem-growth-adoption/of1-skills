#!/usr/bin/env bash
# Step 2b: index coverage — config.json overrides (knowledge indexPath) + removal of a stale templates.names.
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

CFG=of1/config/config.json
CFG_NEW=$(cat "$CFG")
# Index candidates step 2b may write as contentIngestion.indexPath (its own fallbacks).
# Append any index the user names, e.g. INDEX_CANDIDATES+=("/en/query-index.json").
INDEX_CANDIDATES=(/sitemap.json)
CUR_INDEX_PATH=$(jq -r '.contentIngestion.indexPath // empty' "$CFG")
CUR_INDEX_IS_OURS=false
for idx in "${INDEX_CANDIDATES[@]}"; do [ "$CUR_INDEX_PATH" = "$idx" ] && CUR_INDEX_IS_OURS=true; done

QI_PATHS=$(index_paths /query-index.json)
QI_HAS_KNOWLEDGE=false
grep -q '^/of1/knowledge/' <<<"$QI_PATHS" && QI_HAS_KNOWLEDGE=true
echo "query-index.json: knowledge=$QI_HAS_KNOWLEDGE"

# Templates come from the previewed DA sheet /of1/config/template-list (of1-build-templates).
# A templates.names override would shadow it and hide new templates — remove a stale one.
if jq -e '.templates | type == "object" and has("names")' "$CFG" >/dev/null 2>&1; then
  CFG_NEW=$(jq 'del(.templates.names) | if .templates == {} then del(.templates) else . end' <<<"$CFG_NEW")
  echo "→ removed templates.names (superseded by the /of1/config/template-list sheet; an override there would hide new templates)"
fi

if [ -n "$CUR_INDEX_PATH" ] && [ "$CUR_INDEX_IS_OURS" != "true" ]; then
  # User-set indexPath (e.g. "/query-index.json?limit=2000") — never delete or overwrite it.
  echo "· contentIngestion.indexPath = $CUR_INDEX_PATH is user-set — left untouched"
elif [ "$QI_HAS_KNOWLEDGE" = "true" ]; then
  # Index covers knowledge — drop only a fallback this step wrote earlier.
  CFG_NEW=$(jq 'del(.contentIngestion.indexPath) | if .contentIngestion == {} then del(.contentIngestion) else . end' <<<"$CFG_NEW")
else
  # (b) knowledge: first candidate index whose top-level .data lists /of1/knowledge/ paths.
  KNOWLEDGE_INDEX=""
  for idx in "${INDEX_CANDIDATES[@]}"; do
    if index_paths "$idx" | grep -q '^/of1/knowledge/'; then KNOWLEDGE_INDEX="$idx"; break; fi
  done
  if [ -n "$KNOWLEDGE_INDEX" ]; then
    CFG_NEW=$(jq --arg p "$KNOWLEDGE_INDEX" '.contentIngestion = ((.contentIngestion // {}) + {indexPath: $p})' <<<"$CFG_NEW")
    echo "→ contentIngestion.indexPath = $KNOWLEDGE_INDEX"
  else
    echo "⚠ no single-sheet index lists /of1/knowledge/ (tried: ${INDEX_CANDIDATES[*]}) — check 2 (content.indexed > 0) will fail." >&2
    echo "  The site owner must add /of1/knowledge/** to an index (helix-query.yaml or the AEM config service)." >&2
  fi
fi

# Merge result (keeps domain + any other fields); commit ONLY config.json.
if [ "$(jq -S . <<<"$CFG_NEW")" != "$(jq -S . "$CFG")" ]; then
  jq . <<<"$CFG_NEW" > "$CFG"
  git add -- "$CFG"
  git commit -m "feat: OF1 index overrides for ${DOMAIN}" -- "$CFG"
  # Rebase onto the remote first so a concurrent push never rejects ours.
  . "$LIB/git-push.sh"
  git_push_rebased "$BRANCH" || exit 1
  echo "✓ $CFG updated + pushed"
else
  echo "✓ config.json already matches index coverage — unchanged"
fi
