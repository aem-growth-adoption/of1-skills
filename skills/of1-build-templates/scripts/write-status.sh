#!/usr/bin/env bash
# write-status.sh base [<n-new-blocks>] | intent | final — writes the phase status file in $OF1_STATE_DIR.
# `intent` uses $OF1_TG_INTENT (validated by env.sh).
OF1_TG_MODE="${OF1_TG_MODE:-}"; [ "${1:-}" = intent ] && OF1_TG_MODE=intent
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
. "$SKILL_DIR/scripts/env.sh" || exit $?

case "${1:-}" in
  base)
    echo '{"stage":3,"skill":"of1-build-templates","phase":"base","status":"done","summary":"Block plan ready; '"${2:-0}"' new general block(s) authored + deployed."}' \
      > "$OF1_STATE_DIR/of1-build-templates-base-status.json" ;;
  intent)
    echo "{\"stage\":3,\"skill\":\"of1-build-templates\",\"phase\":\"intent-${INTENT}\",\"status\":\"done\",\"summary\":\"Composed ${INTENT} template docs to DA.\"}" \
      > "$OF1_STATE_DIR/of1-build-templates-intent-${INTENT}-status.json" ;;
  final)
    EDIT_BASE="https://da.live/edit#/${OWNER}/${REPO}/templates"
    jq -n --arg u "$EDIT_BASE" '{stage:3, skill:"of1-build-templates", status:"review",
      deliverables:[{url:$u, label:"Edit templates in DA"}],
      summary:"Authored, previewed, and verified DA block templates in /templates."}' \
      > "$OF1_STATE_DIR/of1-build-templates-status.json" ;;
  *) echo "usage: write-status.sh base [n] | intent | final" >&2; exit 2 ;;
esac
