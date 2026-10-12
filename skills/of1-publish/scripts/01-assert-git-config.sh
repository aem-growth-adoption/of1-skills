#!/usr/bin/env bash
# Step 1 (check 1): assert the git config set. Also resets this run's status file.
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# Replace the PREVIOUS run's of1-publish-status.json right away.
write_publish_status running "Publishing — sync and pre-launch checks in progress."
assert_git_config || exit 1
