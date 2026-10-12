#!/usr/bin/env bash
# Step 4: Code Sync check (warn only).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
PREVIEW_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/"
# Bound every probe: an unbounded curl here can hang install-dependencies. Cap
# the wait to ~60s total — this check only WARNs on non-200 and proceeds
# regardless (Code Sync may still be catching up), so a long block only risks
# tripping the 3-minute install-dependencies watchdog for no benefit.
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 "$PREVIEW_URL")

if [ "$STATUS" != "200" ]; then
  echo "WARN: Preview URL returned $STATUS — waiting for Code Sync..."
  for i in $(seq 1 12); do
    sleep 5
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 "$PREVIEW_URL")
    [ "$STATUS" = "200" ] && break
  done
fi

if [ "$STATUS" = "200" ]; then
  echo "✓ Branch preview live: $PREVIEW_URL"
else
  echo "WARN: Branch preview returned $STATUS — may need a few more minutes for Code Sync"
fi
