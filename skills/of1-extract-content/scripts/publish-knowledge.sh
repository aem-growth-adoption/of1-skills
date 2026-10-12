#!/usr/bin/env bash
# Step 8: rehost captured images, then publish the knowledge docs to DA (of1/knowledge/**).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$OF1_DEMO_REPO" || exit 1

# 1. captured images -> download-images input manifest (unique srcs, hash-keyed)
node "$SKILL_DIR/assets/build-image-manifest.mjs" \
  --pages "$OF1_STATE_DIR/knowledge-pages.json" \
  --output /tmp/knowledge-image-manifest.json

# 2. download + upload each image to DA, preview into the Media Bus
#    (skip if the manifest is empty — no images captured)
if [ "$(jq 'length' /tmp/knowledge-image-manifest.json)" -gt 0 ]; then
  node "$SKILL_DIR/assets/download-images.mjs" \
    --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
    --input /tmp/knowledge-image-manifest.json \
    --output /tmp/knowledge-image-mapping.json \
    || echo "WARN: some images failed to rehost — publishing text with the ones that succeeded" >&2
fi

# 3. author the bare knowledge docs with inline <img> (text-only if no map)
node "$SKILL_DIR/assets/publish-knowledge-da.mjs" \
  --owner "$OWNER" --repo "$REPO" --branch "$BRANCH" \
  --pages "$OF1_STATE_DIR/knowledge-pages.json" \
  --image-map /tmp/knowledge-image-mapping.json
rc=$?

rm -f /tmp/knowledge-image-manifest.json /tmp/knowledge-image-mapping.json
exit $rc
