#!/usr/bin/env bash
# Step 2: upload + preview $OF1_STATE_DIR/suggestions-rows.json as DA sheet /of1/config/suggestions.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
node "$DA_WRITE" sheet --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --path of1/config/suggestions \
  --columns label,query \
  --rows "$OF1_STATE_DIR/suggestions-rows.json"
