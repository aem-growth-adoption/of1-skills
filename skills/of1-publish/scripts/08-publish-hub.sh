#!/usr/bin/env bash
# Step 8: regenerate the hub and commit + rebase + push it (only if changed) BEFORE the checks —
# check 5 needs ${PREVIEW_BASE}/deliverables/index.html to be live. finish.sh re-does this at the end.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
publish_hub
