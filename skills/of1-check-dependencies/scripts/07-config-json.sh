#!/usr/bin/env bash
# Step 7: write the DA sheet /of1/config/config (key,value) + preview [<domain>] (resolves DOMAIN via 02-domain.sh; fails if empty). Nothing goes to git.
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
# Resolve DOMAIN ourselves (env/repo-config/content-source/fstab/argument) — never trust a
# caller-exported value that may be silently empty. Refuse to continue on empty.
DOMAIN=$(bash "$(dirname "${BASH_SOURCE[0]}")/02-domain.sh" "${1:-}") \
  || { echo "✗ FAIL: cannot resolve DOMAIN (02-domain.sh exit $?) — pass it as the argument" >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "✗ FAIL: DOMAIN is empty — refusing to write an empty domain" >&2; exit 1; }
ROWS="${OF1_STATE_DIR:?OF1_STATE_DIR required}/config-rows.json"
# Never clobber an authored sheet: keep every existing row, add `domain` only when missing.
SHEET=$(curl -s --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1/config/config.json" 2>/dev/null)
if jq -e '(.data | type) == "array"' >/dev/null 2>&1 <<<"$SHEET"; then
  jq -c --arg d "$DOMAIN" '[.data[] | {key, value}] | if any(.key == "domain") then . else . + [{key:"domain", value:$d}] end' <<<"$SHEET" > "$ROWS"
  if [ "$(jq -S . "$ROWS")" = "$(jq -S '[.data[] | {key, value}]' <<<"$SHEET")" ]; then
    echo "✓ /of1/config/config already has a domain row — left untouched"; exit 0
  fi
else
  jq -n --arg d "$DOMAIN" '[{key:"domain", value:$d}]' > "$ROWS"
fi
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE")
else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
"${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --path of1/config/config --columns key,value --rows "$ROWS" \
  || { echo "✗ FAIL: writing /of1/config/config failed" >&2; exit 1; }
echo "✓ /of1/config/config (domain=${DOMAIN}) written to DA + previewed"
