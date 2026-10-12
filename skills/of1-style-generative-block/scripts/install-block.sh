#!/usr/bin/env bash
# Step 0: copy of1.js / of1.css fresh from this skill's assets (never reuse a stale copy).
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}" || exit 1
mkdir -p blocks/of1
cp "$SKILL_DIR/assets/of1.js"  blocks/of1/of1.js
cp "$SKILL_DIR/assets/of1.css" blocks/of1/of1.css
echo "✓ installed blocks/of1/of1.{js,css}"
