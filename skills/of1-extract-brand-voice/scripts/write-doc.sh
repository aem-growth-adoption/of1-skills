#!/usr/bin/env bash
# Step 4: usage `write-doc.sh check|overwrite|skip`.
#   check      prints "exists" or "absent" for the DA doc /of1/brand-voice (ask the user when "exists")
#   overwrite  uploads + previews $OF1_STATE_DIR/brand-voice.html (default)
#   skip       keeps the existing doc, writes nothing
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
case "${1:-overwrite}" in
  check)
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "https://${PREVIEW}/of1/brand-voice.plain.html")" = "200" ]; then
      echo exists; else echo absent; fi ;;
  skip) echo "kept existing /of1/brand-voice (not overwritten)" ;;
  overwrite)
    node "$DA_WRITE" doc --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
      --path of1/brand-voice --file "$OF1_STATE_DIR/brand-voice.html" ;;
  *) echo "usage: write-doc.sh check|overwrite|skip" >&2; exit 2 ;;
esac
