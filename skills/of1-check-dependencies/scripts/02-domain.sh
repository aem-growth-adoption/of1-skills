#!/usr/bin/env bash
# Step 0: resolve DOMAIN. Usage: 02-domain.sh [<domain the user gave when asked>]
# Prints the domain on stdout (`export DOMAIN=$(bash 02-domain.sh)`); exits 1 with the
# documented message when non-interactive; exits 2 (interactive, nothing resolved) so the
# caller asks the user and re-runs with the answer as $1.
. "$(dirname "${BASH_SOURCE[0]}")/00-load-setup.sh"
if [ -z "${DOMAIN:-}" ] && [ -f "$OF1_STATE_DIR/repo-config.json" ]; then
  DOMAIN=$(jq -r '.domain // empty' "$OF1_STATE_DIR/repo-config.json")
fi
[ -z "${DOMAIN:-}" ] && DOMAIN="${OF1_CONTENT_SOURCE:-}"
if [ -z "${DOMAIN:-}" ]; then
  DOMAIN=$(cat fstab.yaml README.md 2>/dev/null | grep -Eo 'https://[A-Za-z0-9.-]+' | sed 's#https://##' \
    | grep -Ev '(^|\.)(aem\.live|aem\.page|github\.com)$|^hlx\.|\.hlx\.' | head -1)
fi
[ -z "${DOMAIN:-}" ] && DOMAIN="${1:-}"
if [ -z "${DOMAIN:-}" ]; then
  if [ "${OF1_NON_INTERACTIVE:-}" = "1" ]; then
    echo "FAIL: cannot determine DOMAIN — set DOMAIN or pass content-source=<domain>" >&2; exit 1
  fi
  echo "NEED_DOMAIN: ask the user for the production domain, then re-run with it as the argument" >&2; exit 2
fi
printf '%s\n' "$DOMAIN"
