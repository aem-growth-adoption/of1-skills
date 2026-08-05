#!/usr/bin/env bash
# playwright-cli-shim — translate SLICC-flavored playwright-cli calls into the
# shape expected by Playwright's agent CLI (https://playwright.dev/agent-cli).
#
# Install: run the idempotent installer next to this file —
#   bash install-shim.sh
# It resolves the real binary with `command -v`, renames it in place, symlinks
# this shim into the SAME directory (so PATH ordering can't shadow it), and
# verifies afterward. Or set REAL_PWCLI to the absolute path of the real binary.

set -e

REAL="${REAL_PWCLI:-${HOME}/.npm-global/bin/playwright-cli.real}"
[ -x "$REAL" ] || REAL="$(command -v playwright-cli.real 2>/dev/null || true)"
[ -x "$REAL" ] || { echo "playwright-cli-shim: real binary not found (set REAL_PWCLI)" >&2; exit 127; }

# Pop the subcommand
SUB="${1:-}"; shift || true

# Rebuild args with: --output→--filename, --fullPage→--full-page (boolean, no
# =value — the modern binary rejects =value on booleans), drop --tab=ID (capture
# id), rename visit/navigate→open
NEW_ARGS=()
SELECT_TAB=""
for arg in "$@"; do
  case "$arg" in
    --tab=*)                   SELECT_TAB="${arg#--tab=}" ;;
    --output)                  NEW_ARGS+=("--filename") ;;
    --output=*)                NEW_ARGS+=("--filename=${arg#--output=}") ;;
    --fullPage|--full-page)    NEW_ARGS+=("--full-page") ;;
    --fullPage=*|--full-page=*) NEW_ARGS+=("--full-page") ;;
    *)                         NEW_ARGS+=("$arg") ;;
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
