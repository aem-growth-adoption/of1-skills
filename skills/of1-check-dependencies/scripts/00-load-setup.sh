# Sourced by the of1-check-dependencies step scripts (bash). Loads setup.json, cd's into the repo.
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
# Never let a git op block on an interactive credential prompt — in the
# container git has no TTY/askpass, so a push whose token is rejected/expired
# would hang install-dependencies indefinitely. Force git to fail fast instead.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=true GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=20

SETUP=$(cat "$OF1_STATE_DIR/setup.json")
OWNER=$(echo "$SETUP" | jq -r .owner)
REPO=$(echo "$SETUP" | jq -r .repo)
BRANCH=$(echo "$SETUP" | jq -r .branch)
REPO_DIR=$(echo "$SETUP" | jq -r .of1Repo)
# Every step uses repo-relative paths and git — run them all from the repo root.
cd "$REPO_DIR" || { echo "✗ cannot cd into $REPO_DIR" >&2; exit 1; }
. "$LIB/env.sh"; of1_require_main || exit 1

if [ "$(echo "$SETUP" | jq -r .tokenFromEnv)" = "true" ]; then
  DA_TOKEN="$ADOBE_IMS_TOKEN"
else
  DA_TOKEN=$(jq -r .access_token "$(echo "$SETUP" | jq -r .tokenFile)")
fi
export OWNER REPO BRANCH REPO_DIR DA_TOKEN
