#!/usr/bin/env bash
# finish.sh done|failed <summary> — final status, then final regenerate + commit + push of the hub (after the checks).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
st="${1:?usage: finish.sh done|failed <summary>}"
case "$st" in done|failed) ;; *) echo "usage: finish.sh done|failed <summary>" >&2; exit 2 ;; esac
INDEXED=$(jq -r '.content.indexed // 0' "$HUB/sync.json" 2>/dev/null || echo 0)
if [ "$st" = done ]; then
  write_publish_status done "${2:-Synced (${INDEXED} knowledge chunks) + all ${N_CHECKS} pre-launch checks passed.}"
else
  write_publish_status failed "${2:?failed needs a summary}"
fi
publish_hub || exit 1
# Values for the Completion report (copy these; they come from $OF1_STATE_DIR/repo-config.json).
echo "DOMAIN: ${DOMAIN}"
echo "Demo hub: ${PREVIEW_BASE}/deliverables/index.html"
echo "OF1 page: ${PREVIEW_BASE}/of1"
echo "DA config: https://da.live/#/${OWNER}/${REPO}/of1"
echo "Tenant: ${TENANT_ID}"
