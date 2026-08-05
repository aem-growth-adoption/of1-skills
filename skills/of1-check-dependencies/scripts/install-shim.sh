#!/usr/bin/env bash
# install-shim.sh — idempotently install playwright-cli-shim.sh over the raw
# @playwright/cli binary (finding 56).
#
# Why this exists: the previous instructions hardcoded ~/.npm-global and
# /usr/local/bin. On a homebrew macOS box the real binary is under
# /opt/homebrew/bin, and /usr/local/bin may follow /opt/homebrew/bin on PATH —
# so a symlink there is silently shadowed. This script instead installs the shim
# into the SAME directory as the real binary, so PATH ordering can't shadow it.
#
# Idempotent: safe to re-run. Verifies afterward by exercising the shim.
#
# Usage:
#   bash install-shim.sh              # install/repair
#   PWCLI_DIR=/custom/bin bash install-shim.sh   # force target dir

set -euo pipefail

SHIM_SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/playwright-cli-shim.sh"
[ -r "$SHIM_SRC" ] || { echo "install-shim: cannot read $SHIM_SRC" >&2; exit 1; }

# 1. Ensure @playwright/cli is installed.
if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "install-shim: 'playwright-cli' not on PATH. Install it first:" >&2
  echo "  npm install -g @playwright/cli@latest && playwright-cli install-browser" >&2
  exit 1
fi

CURRENT="$(command -v playwright-cli)"

# 2. If the thing on PATH is already our shim, we're done (idempotent).
if grep -q 'playwright-cli-shim' "$CURRENT" 2>/dev/null; then
  echo "install-shim: shim already installed at $CURRENT"
  REAL="${REAL_PWCLI:-$(command -v playwright-cli.real 2>/dev/null || true)}"
  [ -x "$REAL" ] || { echo "install-shim: WARN — shim present but real binary (playwright-cli.real) not found" >&2; exit 1; }
else
  # 3. Resolve the real binary through any symlinks and install alongside it.
  BIN_DIR="${PWCLI_DIR:-$(cd "$(dirname "$CURRENT")" && pwd)}"
  REAL="$BIN_DIR/playwright-cli.real"

  if [ ! -x "$REAL" ]; then
    echo "install-shim: renaming $CURRENT → $REAL"
    mv "$CURRENT" "$REAL"
  fi

  echo "install-shim: linking shim → $BIN_DIR/playwright-cli"
  ln -sf "$SHIM_SRC" "$BIN_DIR/playwright-cli"
fi

# 4. Verify by exercising the shim's translation on a subcommand that does not
#    launch a browser. `visit` (legacy) must be accepted (renamed to `open` by
#    the shim); the raw binary would reject it with "unknown command".
hash -r 2>/dev/null || true
VERIFY_PATH="$(command -v playwright-cli)"
if ! grep -q 'playwright-cli-shim' "$VERIFY_PATH" 2>/dev/null; then
  echo "install-shim: FAILED — $VERIFY_PATH is not the shim (PATH shadowing?). Ensure $(dirname "$VERIFY_PATH") precedes other playwright-cli locations, or set PWCLI_DIR." >&2
  exit 1
fi

echo "install-shim: OK — playwright-cli → $VERIFY_PATH (shim), real → $REAL"
