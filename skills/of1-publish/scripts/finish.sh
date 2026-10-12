#!/usr/bin/env bash
# finish.sh done|failed <summary> — final status, then regenerate + commit + push the hub (step 8).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
st="${1:?usage: finish.sh done|failed <summary>}"
case "$st" in done|failed) ;; *) echo "usage: finish.sh done|failed <summary>" >&2; exit 2 ;; esac
INDEXED=$(jq -r '.content.indexed // 0' "$HUB/sync.json" 2>/dev/null || echo 0)
if [ "$st" = done ]; then
  write_publish_status done "${2:-Synced (${INDEXED} knowledge chunks) + all ${N_CHECKS} pre-launch checks passed.}"
else
  write_publish_status failed "${2:?failed needs a summary}"
fi
publish_hub
