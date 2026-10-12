#!/usr/bin/env bash
# Step 2: verify stardust:extract outputs are present.
cd "${OF1_DEMO_REPO:?OF1_DEMO_REPO required}" || exit 1
test -f stardust/current/DESIGN.json     || { echo "FAIL: DESIGN.json missing"; exit 1; }
test -f stardust/current/DESIGN.md       || { echo "FAIL: DESIGN.md missing"; exit 1; }
test -f stardust/current/assets/logo.svg || { echo "FAIL: logo.svg missing"; exit 1; }
ls stardust/current/assets/screenshots/*.png >/dev/null 2>&1 \
  || { echo "FAIL: no screenshots"; exit 1; }
ls stardust/current/pages/*.json >/dev/null 2>&1 \
  || { echo "FAIL: no pages/*.json — stardust:extract was not invoked correctly"; exit 1; }
echo "✓ Extraction outputs present"
