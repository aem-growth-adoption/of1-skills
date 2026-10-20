#!/usr/bin/env bash
# assemble step 1b: write the DA sheet /of1/config/template-list (column `name`) the worker enumerates templates from.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
DOCS=$(template_docs) || exit 1
ROWS="${OF1_STATE_DIR:?OF1_STATE_DIR required}/template-list-rows.json"
# Names relative to /templates, validated like the worker does.
ALL=$(printf '%s\n' "$DOCS" | sed 's#^templates/##' | jq -R . | jq -sc 'map(select(length > 0)) | unique')
BAD=$(jq -r '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i") | not)] | join(", ")' <<<"$ALL")
[ -n "$BAD" ] && echo "⚠ excluded template doc name(s) the worker rejects: $BAD (rename to [a-z0-9][a-z0-9-_]*)" >&2
jq -c '[.[] | select(test("^[a-z0-9][a-z0-9-_]*$"; "i")) | {name: .}] | sort_by(.name)' <<<"$ALL" > "$ROWS"
[ "$(jq length "$ROWS")" -gt 0 ] \
  || { echo "ABORT: no valid template names to list — nothing written" >&2; exit 1; }
if [ -n "${OF1_DA_WRITE:-}" ]; then WRITER=("$OF1_DA_WRITE")
else WRITER=(node "$SKILL_DIR/../of1-integration/assets/da-write.mjs"); fi
"${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" \
  --path of1/config/template-list --columns name --rows "$ROWS" \
  || { echo "ABORT: writing /of1/config/template-list failed" >&2; exit 1; }
echo "✓ /of1/config/template-list: $(jq -r 'map(.name) | join(", ")' "$ROWS")"
