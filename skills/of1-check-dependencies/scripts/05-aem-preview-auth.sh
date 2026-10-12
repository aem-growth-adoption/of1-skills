#!/usr/bin/env bash
# Step 5: AEM preview authorization check (da-blocks-slots requirement).
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
AEM_TOKEN="${AEM_TOKEN:-$DA_TOKEN}"
# MUST bound this probe: admin.hlx.page can stall, and an unbounded curl here
# hangs the whole install-dependencies step (observed: 18min+ wedge). On
# timeout curl exits non-zero and prints "000", which the non-200 branch below
# treats as a failure.
PV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 20 \
  "https://admin.hlx.page/status/${OWNER}/${REPO}/main/index" \
  -H "Authorization: Bearer $AEM_TOKEN")
# status returns the preview/live/code authorization triplet; a 403 here is the
# org-level gap. Treat non-200 (incl. "000" timeout) as a hard prerequisite
# failure for the da-blocks-slots template flow.
if [ "$PV_STATUS" = "200" ]; then
  echo "✓ AEM preview authorization present on ${OWNER}/${REPO}"
else
  echo "✗ FAIL: AEM preview authorization missing (status ${PV_STATUS}) on ${OWNER}/${REPO}." >&2
  echo "  This account can write to DA but cannot preview/publish, so da-blocks-slots templates" >&2
  echo "  would sync as zero. Provision AEM preview/publish rights on the org before proceeding." >&2
  exit 1
fi
