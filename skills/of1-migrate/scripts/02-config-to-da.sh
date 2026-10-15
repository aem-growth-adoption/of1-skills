#!/usr/bin/env bash
# Step 2: git config.json / cta-template.json -> DA sheets (key,value) + preview. Git files stay until step 3.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$OF1_STATE_DIR/migrate-detect.json" ] && [ "$(jq '.tracked | length' "$OF1_STATE_DIR/migrate-detect.json")" -ge 0 ] || fail 02 "run 01-detect.sh first"
write_sheet() { # <name> <rows-file>
  "${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" --path "of1/config/$1" --columns key,value --rows "$2" \
    || fail 02 "writing of1/config/$1 failed"
}
ROWS="$OF1_STATE_DIR/migrate-config-rows.json"
if [ -f of1/config/config.json ]; then
  jq -c 'def rows($p): to_entries[] | ($p + [.key]) as $q | ($q | join(".")) as $k
      | if (.value | type) == "object" then (.value | rows($q))
        else {key: $k, value: (.value | if type == "string" then . elif type == "array" then tojson else tostring end)} end;
    [rows([])]' of1/config/config.json > "$ROWS" || fail 02 "of1/config/config.json is not valid JSON"
else
  jq -n --arg d "$DOMAIN" '[{key:"domain", value:$d}]' > "$ROWS"
fi
write_sheet config "$ROWS"
if [ -f of1/config/cta-template.json ]; then
  jq -e '[.html, .fallback.title, .fallback.description, .fallback.buttonText] | all(type == "string" and length > 0)' of1/config/cta-template.json >/dev/null \
    || fail 02 "of1/config/cta-template.json needs html and fallback.{title,description,buttonText}"
  jq -c '[{key:"html",value:.html},{key:"fallback.title",value:.fallback.title},{key:"fallback.description",value:.fallback.description},{key:"fallback.buttonText",value:.fallback.buttonText}]' \
    of1/config/cta-template.json > "$OF1_STATE_DIR/migrate-cta-rows.json"
  write_sheet cta-template "$OF1_STATE_DIR/migrate-cta-rows.json"
  touch "$OF1_STATE_DIR/migrate-cta"
fi
echo "✓ config sheets written to DA + previewed"
