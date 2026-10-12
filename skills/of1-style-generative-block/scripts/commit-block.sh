#!/usr/bin/env bash
# Step 6: commit + push blocks/of1/ (both of1.js and of1.css).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "${OF1_DEMO_REPO:?}" || exit 1
git add blocks/of1/
git commit -m "feat: OF1 page + brand-aligned block styling for ${DOMAIN}"
. "$LIB/git-push.sh"
git_push_rebased "$BRANCH" || exit 1
