#!/usr/bin/env bash
# playwright-cli-shim — translate SLICC-flavored playwright-cli calls into the
# shape expected by Playwright's agent CLI (https://playwright.dev/agent-cli).
#
# Install:
#   1. npm install -g @playwright/cli@latest
#   2. playwright-cli install-browser
#   3. mv "$(which playwright-cli)" "$(which playwright-cli).real"
#   4. ln -s <repo>/.claude/skills/of1-check-dependencies/scripts/playwright-cli-shim.sh \
#         /usr/local/bin/playwright-cli
#
# Or set REAL_PWCLI env var to the absolute path of the real binary.

set -e

REAL="${REAL_PWCLI:-${HOME}/.npm-global/bin/playwright-cli.real}"
[ -x "$REAL" ] || REAL="$(command -v playwright-cli.real 2>/dev/null || true)"
[ -x "$REAL" ] || { echo "playwright-cli-shim: real binary not found (set REAL_PWCLI)" >&2; exit 127; }

# Pop the subcommand
SUB="${1:-}"; shift || true

# Rebuild args with: --output→--filename, drop --tab=ID (capture id), rename visit/navigate→open
NEW_ARGS=()
SELECT_TAB=""
for arg in "$@"; do
  case "$arg" in
    --tab=*)           SELECT_TAB="${arg#--tab=}" ;;
    --output)          NEW_ARGS+=("--filename") ;;
    --output=*)        NEW_ARGS+=("--filename=${arg#--output=}") ;;
    *)                 NEW_ARGS+=("$arg") ;;
  esac
done

# Subcommand renames
case "$SUB" in
  visit|navigate) SUB="open" ;;
  eval)
    # Wrap a bare expression in an arrow fn if the user passed `expr` not `() => expr`
    if [ ${#NEW_ARGS[@]} -ge 1 ]; then
      EXPR="${NEW_ARGS[0]}"
      case "$EXPR" in
        "() =>"*|"async () =>"*|"function"*) ;;  # already a function
        *) NEW_ARGS[0]="() => ($EXPR)" ;;
      esac
    fi
    ;;
esac

# If a --tab was specified, switch to it first (best-effort; index-based)
if [ -n "$SELECT_TAB" ]; then
  "$REAL" tab-select "$SELECT_TAB" >/dev/null 2>&1 || true
fi

exec "$REAL" "$SUB" "${NEW_ARGS[@]}"
