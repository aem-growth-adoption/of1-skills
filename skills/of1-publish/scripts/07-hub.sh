#!/usr/bin/env bash
# Step 7: generate the demo hub (steps 7+8 commit/push via finish.sh).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
node "$SKILL_DIR/assets/fill-demo-hub.mjs" . "${DOMAIN}"
