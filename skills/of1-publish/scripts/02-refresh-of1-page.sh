#!/usr/bin/env bash
# Step 2: refresh the /of1 page via of1-style-generative-block's upload script.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
export DA_TOKEN OWNER REPO BRANCH DOMAIN OF1_STATE_DIR SKILL_DIR
bash "${OF1_UPLOAD_PAGE_SCRIPT:-$SKILL_DIR/../of1-style-generative-block/scripts/upload-of1-page.sh}"
