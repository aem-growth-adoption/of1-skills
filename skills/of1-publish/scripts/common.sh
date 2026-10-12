# Sourced by every of1-publish script (bash). Recreates the shared context.
SKILL_DIR="${SKILL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LIB="$SKILL_DIR/../../lib"
. "$LIB/env.sh"; . "$LIB/da-token.sh"; . "$LIB/pw.sh"
of1_load_env || exit 1
DA_TOKEN=$(da_resolve_token) \
  || { echo "FAIL: no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE, or provide .hlx/.da-token.json)" >&2; exit 1; }
# Fail fast on an expired/invalid token (IMS tokens last ~3h) — before any write.
da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1
cd "$OF1_DEMO_REPO" || exit 1

HUB="$OF1_STATE_DIR/hub"
mkdir -p "$HUB"
# Bash array — never a space-joined string expanded unquoted (zsh doesn't word-split it).
ALLOWED=(of1/config/config.json)
[ "${OF1_CTA_TEMPLATE:-}" = "1" ] && ALLOWED+=(of1/config/cta-template.json)
# The worker gates `ready` on these two flags only; every other /status flag is informational.
GATED_FLAGS='["hasTemplates","hasContent"]'
N_CHECKS=6; [ "${OF1_CTA_TEMPLATE:-}" = "1" ] && N_CHECKS=7

# write_publish_status <running|done|failed> <summary> — this run's own status file.
write_publish_status() {
  jq -n --arg st "$1" --arg sum "$2" \
    --arg hub "${PREVIEW_BASE}/deliverables/index.html" --arg of1 "${PREVIEW_BASE}/of1" \
    '{stage: 3, skill: "of1-publish", status: $st, summary: $sum,
      deliverables: [{url: $hub, label: "Demo hub"}, {url: $of1, label: "OF1 page"}]}' \
    > "$OF1_STATE_DIR/of1-publish-status.json"
}
# publish_hub — (re)generate deliverables/index.html from the CURRENT status files,
# commit it only if it changed (an identical hub must not fail), rebase, push.
publish_hub() {
  node "$SKILL_DIR/assets/fill-demo-hub.mjs" . "${DOMAIN}" || return 1
  git add -- deliverables/index.html
  if ! git diff --cached --quiet -- deliverables/index.html; then
    git commit -q -m "feat: OF1 demo hub for ${DOMAIN}" -- deliverables/index.html
    # Rebase onto the remote first so a concurrent push never rejects ours.
    . "$LIB/git-push.sh"
    git_push_rebased "$BRANCH" || return 1
  else
    echo "✓ hub unchanged — nothing to commit"
  fi
}
# assert_git_config — step 1 / check 1.
assert_git_config() {
  local EXTRA
  EXTRA=$(git ls-files of1/config | while IFS= read -r f; do
    ok=0; for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && ok=1; done
    [ "$ok" = 1 ] || echo "$f"
  done)
  if [ -n "$EXTRA" ]; then
    echo "✗ FAIL (check 1): unexpected files tracked under of1/config/ — they shadow DA config or are no longer read:" >&2
    echo "$EXTRA" | sed 's/^/    /' >&2
    echo "  Re-run of1-check-dependencies (step 3b removes legacy of1/config JSON: scoped git rm + commit + push), then re-run of1-publish." >&2
    return 1
  fi
  [ -f of1/config/config.json ] || { echo "✗ FAIL: of1/config/config.json missing — run of1-check-dependencies" >&2; return 1; }
  if [ "${OF1_CTA_TEMPLATE:-}" = "1" ] && [ ! -f of1/config/cta-template.json ]; then
    echo "✗ FAIL: OF1_CTA_TEMPLATE=1 but of1/config/cta-template.json missing — of1-build-cta-template did not run" >&2; return 1
  fi
  echo "✓ git config set OK: $(git ls-files of1/config | tr '\n' ' ')"
}
