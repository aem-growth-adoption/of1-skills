#!/usr/bin/env bash
# Step 7: generate the demo hub (deliverables/index.html). Step 8 commits + pushes it.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
node "$SKILL_DIR/assets/fill-demo-hub.mjs" . "${DOMAIN}"
