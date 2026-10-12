#!/usr/bin/env bash
# Step 4: commit + push the extraction (force-adds when stardust/ is gitignored).
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"; . "$LIB/env.sh"
of1_load_env || exit 1
cd "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}" || exit 1
git add PRODUCT.md stardust/ deliverables/ 2>/dev/null
# Ignored dir: stage the deliverable files explicitly.
git add -f stardust/current/DESIGN.json stardust/current/DESIGN.md stardust/current/assets/ 2>/dev/null
if ! git diff --cached --quiet; then
  git commit -m "feat: extraction - design tokens and brand identity for ${DOMAIN}" || exit 1
else
  echo "✓ nothing to commit"
fi
. "$LIB/git-push.sh"
git_push_rebased "$BRANCH" || exit 1
