#!/usr/bin/env bash
# Step 7: upload + preview $OF1_STATE_DIR/personas-rows.json as DA sheet /of1/config/personas.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
node "$DA_WRITE" sheet --owner "$OWNER" --repo "$REPO" \
  --path of1/config/personas \
  --columns id,name,description,keywords,priorities,explore,research,compare,purchase,deals,support \
  --rows "$OF1_STATE_DIR/personas-rows.json"
