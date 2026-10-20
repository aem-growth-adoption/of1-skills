#!/usr/bin/env bash
# Step 2: git config.json / cta-template.json -> DA sheets (key,value) + preview. Git files stay until step 3.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$OF1_STATE_DIR/migrate-detect.json" ] && [ "$(jq '.tracked | length' "$OF1_STATE_DIR/migrate-detect.json")" -ge 0 ] || fail 02 "run 01-detect.sh first"
write_sheet() { # <name> <rows-file>
  "${WRITER[@]}" sheet --owner "$OWNER" --repo "$REPO" --path "of1/config/$1" --columns key,value --rows "$2" \
    || fail 02 "writing of1/config/$1 failed"
}
ROWS="$OF1_STATE_DIR/migrate-config-rows.json"
SRC=of1/config/config.json
if [ ! -f "$SRC" ] && git cat-file -e "origin/main:$SRC" 2>/dev/null; then git show "origin/main:$SRC" > "$OF1_STATE_DIR/migrate-remote-config.json"; SRC="$OF1_STATE_DIR/migrate-remote-config.json"; fi
if [ -f "$SRC" ]; then
  # Mirrors gen-web expandConfigSheet: list keys are comma-joined; anything the sheet cannot represent losslessly fails.
  jq -c 'def lk: ["templates.names", "contentIngestion.includePaths"];
    def rows($p): to_entries[] | ($p + [.key]) as $q | ($q | join(".")) as $k
      | if (.key | contains(".")) then error("key contains a dot: \($k)")
        elif (.value | type) == "object" then (if (.value | length) == 0 then error("empty object at \($k)") else (.value | rows($q)) end)
        elif ($k | IN(lk[])) then
          (if ((.value | type) != "array") or (.value | any(type != "string" or contains(",") or . != (. | gsub("^\\s+|\\s+$"; "")))) then error("\($k) must be an array of comma-free strings") else {key: $k, value: (.value | join(","))} end)
        elif (.value | type) == "string" then
          (if ((.value | test("^\\s*-?\\d+(\\.\\d+)?\\s*$")) or .value == "true" or .value == "false" or (.value != (.value | gsub("^\\s+|\\s+$"; "")))) then error("string value of \($k) would be coerced or trimmed by the sheet reader") else {key: $k, value: .value} end)
        elif (.value | type) == "number" or (.value | type) == "boolean" then {key: $k, value: (.value | tostring)}
        else error("\($k) has unsupported type \(.value | type)") end;
    [rows([])]' "$SRC" > "$ROWS" 2> "$ROWS.err" || fail 02 "of1/config/config.json cannot be moved to a sheet losslessly: $(sed -E 's/^jq: error[^:]*: //' "$ROWS.err" | head -1) — fix it in git (or move that key manually) and re-run"
else
  jq -n --arg d "$DOMAIN" '[{key:"domain", value:$d}]' > "$ROWS"
fi
write_sheet config "$ROWS"
CTA=of1/config/cta-template.json
if [ ! -f "$CTA" ] && git cat-file -e "origin/main:$CTA" 2>/dev/null; then git show "origin/main:$CTA" > "$OF1_STATE_DIR/migrate-remote-cta.json"; CTA="$OF1_STATE_DIR/migrate-remote-cta.json"; fi
if [ -f "$CTA" ]; then
  jq -e '[.html, .fallback.title, .fallback.description, .fallback.buttonText] | all(type == "string" and length > 0)' "$CTA" >/dev/null \
    || fail 02 "of1/config/cta-template.json needs html and fallback.{title,description,buttonText}"
  jq -c '[{key:"html",value:.html},{key:"fallback.title",value:.fallback.title},{key:"fallback.description",value:.fallback.description},{key:"fallback.buttonText",value:.fallback.buttonText}]' \
    "$CTA" > "$OF1_STATE_DIR/migrate-cta-rows.json"
  write_sheet cta-template "$OF1_STATE_DIR/migrate-cta-rows.json"
  touch "$OF1_STATE_DIR/migrate-cta"
fi
echo "✓ config sheets written to DA + previewed"
