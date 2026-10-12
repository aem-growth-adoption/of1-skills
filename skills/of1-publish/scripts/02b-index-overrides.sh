#!/usr/bin/env bash
# Step 2b: index coverage — config.json overrides for config-service sites.
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
# Template folder: honour a configured templates.daPath (default /templates).
# The worker uses the raw value, so a daPath without a leading "/" is NOT silently
# normalised here — warn and leave templates.names alone for this run.
TPL_DIR=$(jq -r '.templates.daPath // "/templates"' "$CFG")
TPL_SKIP=false
case "$TPL_DIR" in
  /*) TPL_DIR="${TPL_DIR%/}" ;;
  *) echo "⚠ templates.daPath \"$TPL_DIR\" has no leading '/' — the worker uses the raw value; fix config.json. Not setting/deleting templates.names this run." >&2
     TPL_SKIP=true ;;
esac
# Index candidates step 2b may write as contentIngestion.indexPath (its own fallbacks).
# Append any index the user names, e.g. INDEX_CANDIDATES+=("/en/query-index.json").
INDEX_CANDIDATES=(/sitemap.json)
CUR_INDEX_PATH=$(jq -r '.contentIngestion.indexPath // empty' "$CFG")
CUR_INDEX_IS_OURS=false
for idx in "${INDEX_CANDIDATES[@]}"; do [ "$CUR_INDEX_PATH" = "$idx" ] && CUR_INDEX_IS_OURS=true; done

QI_PATHS=$(index_paths /query-index.json)
QI_HAS_TEMPLATES=false; QI_HAS_KNOWLEDGE=false
grep -q "^${TPL_DIR}/" <<<"$QI_PATHS" && QI_HAS_TEMPLATES=true
grep -q '^/of1/knowledge/' <<<"$QI_PATHS" && QI_HAS_KNOWLEDGE=true
echo "query-index.json: templates($TPL_DIR)=$QI_HAS_TEMPLATES knowledge=$QI_HAS_KNOWLEDGE"

if [ "$TPL_SKIP" = "true" ]; then
  : # daPath malformed — warned above; templates.names left as-is.
elif [ "$QI_HAS_TEMPLATES" = "true" ]; then
  # Index covers templates — drop a stale override so the worker uses the index.
  CFG_NEW=$(jq 'del(.templates.names) | if .templates == {} then del(.templates) else . end' <<<"$CFG_NEW")
else
  # (a) templates: list the DA template folder (names of .html entries, no extension),
  # keeping only names the worker accepts (same regex it validates with).
  # A failed listing must never look like "no templates": check the HTTP status and
  # the body shape; only a genuine empty array means the folder is empty.
  TPL_RESP=$(curl -s -w '\n%{http_code}' --connect-timeout 10 --max-time 30 \
    -H "Authorization: Bearer $DA_TOKEN" "https://admin.da.live/list/${OWNER}/${REPO}${TPL_DIR}")
  TPL_CODE=$(printf '%s\n' "$TPL_RESP" | tail -n1)
  TPL_BODY=$(printf '%s\n' "$TPL_RESP" | sed '$d')
  case "$TPL_CODE" in
    200) ;;
    401|403) echo "✗ FAIL: DA token expired or lacks access to ${OWNER}/${REPO}${TPL_DIR} (HTTP ${TPL_CODE}) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE and re-run" >&2; exit 1 ;;
    *) echo "✗ FAIL: listing DA ${TPL_DIR} returned HTTP ${TPL_CODE}: $(printf '%s' "$TPL_BODY" | head -c 200)" >&2; exit 1 ;;
  esac
  TPL_ALL=$(jq -c 'if type == "array" then [.[] | select(.ext == "html") | .name] | sort else error("not a list") end' <<<"$TPL_BODY" 2>/dev/null) \
    || { echo "✗ FAIL: DA ${TPL_DIR} listing (HTTP 200) is not a JSON array: $(printf '%s' "$TPL_BODY" | head -c 200)" >&2; exit 1; }
  TPL_NAMES=$(jq -c '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i"))]' <<<"$TPL_ALL")
  TPL_BAD=$(jq -r '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i") | not)] | join(", ")' <<<"$TPL_ALL")
  [ -n "$TPL_BAD" ] && echo "⚠ excluded template doc name(s) the worker rejects: $TPL_BAD (rename to [a-z0-9][a-z0-9-_]*)" >&2
  if [ "$TPL_NAMES" != "[]" ]; then
    CFG_NEW=$(jq --argjson n "$TPL_NAMES" '.templates = ((.templates // {}) + {names: $n})' <<<"$CFG_NEW")
    echo "→ templates.names = $TPL_NAMES"
  else
    echo "⚠ DA ${TPL_DIR} has no usable template docs — run of1-build-templates; check 3 (hasTemplates) will fail" >&2
  fi
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
