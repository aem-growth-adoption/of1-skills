# Sourced helper (bash/zsh). No set -e/-u.
pw() { ( cd "$OF1_STATE_DIR" && playwright-cli "$@" ); }
pw_result() { awk '/^### Result/{f=1;next} /^### /{f=0} f'; }
