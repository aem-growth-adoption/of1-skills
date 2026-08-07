#!/usr/bin/env bash
# of1-check-dependencies verifier — checks all prerequisites for the OF1 demo pipeline,
# including that OF1_DEMO_REPO is a valid EDS repo (structural check, not
# identity — any org/repo works). Runtime-agnostic: works in both Claude
# Code and SLICC. The orchestrator exports OF1_STATE_DIR / OF1_DEMO_REPO /
# token env vars before invoking. Contract documented in ../SKILL.md.
#
# Exit 0 = all good; exit 1 = something blocking is missing.
# Side effect on success:
#   <stateDir>/setup.json          — resolved paths + owner/repo/branch + token source
#   <stateDir>/step-1-status.json  — SLICC sprinkle IPC ack (harmless in CC)
#
# repo-config.json (owner/repo/branch/domain/repoDir) is NOT written by this
# script — it's written interactively by of1-check-dependencies/SKILL.md's "Repo state"
# section after this script exits 0, since detecting an in-progress demo and
# asking continue/restart requires AskUserQuestion (not available in bash).
#
# Token resolution order:
#   1. $ADOBE_IMS_TOKEN (env var with the raw value)
#   2. $OF1_TOKEN_FILE  (env var pointing at a file)
#   3. $PWD/.hlx/.da-token.json
#   4. $OF1_DEMO_REPO/.hlx/.da-token.json

set -u

FAIL=0
WARN=0
LOG=()

ok()   { LOG+=("✓ $1"); }
warn() { LOG+=("⚠ $1"); WARN=$((WARN+1)); [ "${STRICT:-0}" = "1" ] && FAIL=$((FAIL+1)); }
fail() { LOG+=("✗ $1"); FAIL=$((FAIL+1)); }

# ---------- 0. Detect runtime (cc | slicc) ----------
# Honor explicit OF1_RUNTIME from the orchestrator; otherwise infer from the
# path this script was loaded from. SLICC installs skills under /workspace.

if [ -n "${OF1_RUNTIME:-}" ]; then
  RUNTIME="$OF1_RUNTIME"
else
  case "${BASH_SOURCE[0]:-$0}" in
    /workspace/skills/*) RUNTIME="slicc" ;;
    *)                   RUNTIME="cc" ;;
  esac
fi
ok "Runtime: $RUNTIME"

# fix_cmd <cc-command> <slicc-command>
# Returns the install command appropriate for the detected runtime.
fix_cmd() {
  if [ "$RUNTIME" = "slicc" ]; then echo "$2"; else echo "$1"; fi
}

# ---------- 1. OF1 step skills (project- or user-scoped) ----------

REQUIRED_SKILLS=(
  of1-demo-orchestrator
  of1-discover-narrative of1-build-templates of1-style-generative-block
  of1-extract-brand-voice of1-extract-content of1-build-quick-suggestions
  of1-build-cta-template of1-generate-config-review of1-publish
  of1-adopt-existing-site
)
# of1-signals is intentionally omitted — it's a standalone operator tool, not a pipeline step (see its SKILL.md).
# of1-check-dependencies is omitted because it's the skill running this check.

# Search locations: CC plugin/user/project scopes plus SLICC's /workspace/skills.
# Each runtime only has its own; the other paths quietly miss.
SKILL_ROOTS=(
  "$HOME/.claude/plugins"
  "$HOME/.claude/skills"
  "$PWD/.claude/skills"
  "/workspace/skills"
)

# CC also supports marketplaces sourced from a local directory (`/plugin
# marketplace add <path>`), whose installLocation lives outside the roots above
# — e.g. a local dev checkout of this very plugin. Add those too.
if [ -r "$HOME/.claude/plugins/known_marketplaces.json" ] && command -v jq >/dev/null 2>&1; then
  while IFS= read -r loc; do
    [ -n "$loc" ] && [ -d "$loc" ] && SKILL_ROOTS+=("$loc")
  done < <(jq -r '.[].installLocation // empty' "$HOME/.claude/plugins/known_marketplaces.json" 2>/dev/null)
fi

find_skill() {
  local name="$1"
  for root in "${SKILL_ROOTS[@]}"; do
    [ -d "$root" ] || continue
    local hit
    hit=$(find "$root" -path "*/skills/$name/SKILL.md" 2>/dev/null | head -1)
    [ -n "$hit" ] && { echo "$hit"; return 0; }
  done
  return 1
}

MISSING=()
for S in "${REQUIRED_SKILLS[@]}"; do
  find_skill "$S" >/dev/null || MISSING+=("$S")
done
TOTAL=${#REQUIRED_SKILLS[@]}
if [ ${#MISSING[@]} -eq 0 ]; then
  ok "All $TOTAL OF1 skills present"
elif [ ${#MISSING[@]} -eq "$TOTAL" ]; then
  # None found at all — almost always a detector/path problem, not a real absence.
  fail "found 0 of $TOTAL OF1 skills — is this a local checkout with the plugin not installed to a searched root? fix: $(fix_cmd '/plugin install of1-demo-skills@<marketplace>' 'upskill aem-growth-adoption/of1-demo-skills --all')"
else
  fail "Missing $((${#MISSING[@]})) of $TOTAL OF1 skills: ${MISSING[*]} — fix: $(fix_cmd '/plugin install of1-demo-skills@<marketplace>' 'upskill aem-growth-adoption/of1-demo-skills --all')"
fi

# ---------- 2. Adobe EDS skills: stardust + impeccable ----------
# In SLICC, auto-install missing skills via `upskill`. In CC, report the fix command.
# Also check stardust sub-skills (extract, prototype) needed by Steps 4 & 5.

ADOBE_EDS_SKILLS=(stardust impeccable)

install_skill_slicc() {
  local name="$1"
  case "$name" in
    stardust)
      # Install ALL stardust skills (extract, prototype, direct, deploy, etc.)
      upskill adobe/skills --path plugins/stardust --all 2>&1 | tail -1 ;;
    impeccable)
      upskill pbakaus/impeccable --all 2>&1 | tail -1 ;;
  esac
}

for S in "${ADOBE_EDS_SKILLS[@]}"; do
  p=$(find_skill "$S" || true)
  if [ -n "${p:-}" ]; then
    ok "$S → $p"
  else
    if [ "$RUNTIME" = "slicc" ]; then
      echo "  Installing $S..."
      RESULT=$(install_skill_slicc "$S")
      p=$(find_skill "$S" || true)
      if [ -n "${p:-}" ]; then
        ok "$S → $p (auto-installed)"
      else
        fail "Adobe EDS skill '$S' failed to install: $RESULT"
      fi
    else
      case "$S" in
        stardust)
          fail "Adobe EDS skill 'stardust' not installed — fix: /plugin install stardust@adobe-skills" ;;
        impeccable)
          fail "Adobe EDS skill 'impeccable' not installed — fix: /plugin install impeccable@impeccable" ;;
      esac
    fi
  fi
done

# ---------- stardust:replica (Stage 2 depends on it) ----------
if find "${SKILL_ROOTS[@]}" -path "*/skills/replica/SKILL.md" 2>/dev/null | grep -q .; then
  ok "stardust:replica present"
else
  fail "stardust:replica skill not found — Stage 2 requires it. Update the stardust plugin: $(fix_cmd '/plugin update stardust' 'upskill adobe/skills --path plugins/stardust --all')"
fi

# ---------- 3. Shell tools ----------

for T in node python3 jq git curl; do
  if command -v "$T" >/dev/null 2>&1; then
    ok "$T → $(command -v $T)"
  else
    fail "$T not on PATH"
  fi
done

# OF1 step skills call `playwright-cli visit/screenshot/snapshot`. Prefer the
# SLICC-native `playwright-cli` binary; in CC, the standard `playwright` binary
# is accepted as a degraded fallback (shim at scripts/playwright-cli-shim.sh).
# Probe SHAPE, not just presence (finding 49). A `playwright-cli` on PATH may be
# the raw Microsoft @playwright/cli binary, which rejects the legacy
# visit/--output syntax the step skills emit. Its global `--help` exits 0 for any
# token, so `<subcmd> --help` can't distinguish it — check the shim marker, then
# confirm the legacy `visit` subcommand is actually understood.
SHIM_INSTALL="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/install-shim.sh"
if command -v playwright-cli >/dev/null 2>&1; then
  PWCLI_PATH="$(command -v playwright-cli)"
  if grep -q 'playwright-cli-shim' "$PWCLI_PATH" 2>/dev/null; then
    ok "playwright-cli (shim) → $PWCLI_PATH"
  elif playwright-cli visit 2>&1 | grep -qi 'unknown command'; then
    warn "playwright-cli at $PWCLI_PATH is the raw @playwright/cli binary — it rejects the legacy 'visit'/'--output' syntax the step skills use. Install the shim: bash $SHIM_INSTALL"
  else
    ok "playwright-cli → $PWCLI_PATH"
  fi
elif command -v playwright >/dev/null 2>&1; then
  warn "playwright-cli not found; only 'playwright' is installed at $(command -v playwright). Install the shim: bash $SHIM_INSTALL — else step skills calling visit/screenshot/snapshot will fail."
else
  fail "Neither playwright-cli nor playwright installed — fix: npm i -g playwright; npx playwright install chromium"
fi

# ---------- 4. EDS repo verification (any org/repo — structural, not identity) ----------
# No auto-discovery — the orchestrator sets OF1_DEMO_REPO to the repo cwd.
# Verifies EDS structural files exist and resolves owner/repo/branch from git.

OF1_REPO=""
OWNER=""
REPO=""
BRANCH=""

if [ -n "${OF1_DEMO_REPO:-}" ] && [ -d "${OF1_DEMO_REPO}/.git" ]; then
  # Use subshell + cd — SLICC's git shim doesn't support `-C` or `remote get-url`.
  REMOTE=$(cd "$OF1_DEMO_REPO" && git config remote.origin.url 2>/dev/null || true)
  OWNER=$(echo "$REMOTE" | sed 's|.*github.com[:/]||' | cut -d/ -f1)
  REPO=$(echo "$REMOTE" | sed 's|.*github.com[:/]||' | cut -d/ -f2 | sed 's/\.git$//')
  BRANCH=$(cd "$OF1_DEMO_REPO" && git branch --show-current 2>/dev/null || true)

  if { [ -f "${OF1_DEMO_REPO}/scripts/aem.js" ] || [ -f "${OF1_DEMO_REPO}/scripts/lib-franklin.js" ]; } \
     && [ -f "${OF1_DEMO_REPO}/scripts/scripts.js" ] \
     && [ -f "${OF1_DEMO_REPO}/styles/styles.css" ]; then
    OF1_REPO="$OF1_DEMO_REPO"
    ok "EDS repo → $OF1_REPO ($OWNER/$REPO, branch: ${BRANCH:-<detached>})"
  else
    fail "Not an EDS repo at $OF1_DEMO_REPO — missing scripts/aem.js (or lib-franklin.js), scripts/scripts.js, or styles/styles.css. cd into a valid EDS repo checkout (or set OF1_DEMO_REPO) and re-run."
  fi

  if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
    warn "Currently on ${BRANCH:-a detached HEAD} — demo artifacts and DA content will be affected on this branch/state"
  fi
else
  fail "OF1_DEMO_REPO env var not set or not a git checkout — set it to the absolute path of a cloned EDS repo"
fi

# ---------- 5. Adobe IMS / DA token ----------
# Order: $ADOBE_IMS_TOKEN env (raw value) → $OF1_TOKEN_FILE → $PWD/.hlx/.da-token.json → $OF1_REPO/.hlx/.da-token.json

TOKEN_FILE=""
TOKEN_SOURCE=""
TOKEN_HAS_ENV_VALUE="false"

if [ -n "${ADOBE_IMS_TOKEN:-}" ]; then
  TOKEN_SOURCE="env:ADOBE_IMS_TOKEN"
  TOKEN_HAS_ENV_VALUE="true"
elif [ -n "${OF1_TOKEN_FILE:-}" ] && [ -s "${OF1_TOKEN_FILE}" ]; then
  TOKEN_FILE="$OF1_TOKEN_FILE"; TOKEN_SOURCE="env:OF1_TOKEN_FILE"
elif [ -s "$PWD/.hlx/.da-token.json" ]; then
  TOKEN_FILE="$PWD/.hlx/.da-token.json"; TOKEN_SOURCE="project:.hlx"
elif [ -n "$OF1_REPO" ] && [ -s "$OF1_REPO/.hlx/.da-token.json" ]; then
  TOKEN_FILE="$OF1_REPO/.hlx/.da-token.json"; TOKEN_SOURCE="repo:.hlx"
fi

if [ "$TOKEN_HAS_ENV_VALUE" = "true" ]; then
  ok "DA token → \$ADOBE_IMS_TOKEN env var (len=${#ADOBE_IMS_TOKEN})"
elif [ -n "$TOKEN_FILE" ]; then
  if jq -re '.access_token | length > 0' "$TOKEN_FILE" >/dev/null 2>&1; then
    ok "DA token → $TOKEN_FILE ($TOKEN_SOURCE)"
  else
    fail "Token file exists but has no .access_token field: $TOKEN_FILE"
  fi
else
  fail "DA token not found — set \$ADOBE_IMS_TOKEN, or set \$OF1_TOKEN_FILE, or place a file at \$PWD/.hlx/.da-token.json or <of1Repo>/.hlx/.da-token.json (shape: {\"access_token\":\"...\"})"
fi

# ---------- 6. State directory writable ----------

STATE_DIR="${OF1_STATE_DIR:-$PWD/.of1/state}"
mkdir -p "$STATE_DIR" 2>/dev/null && touch "$STATE_DIR/.write-probe" 2>/dev/null && rm "$STATE_DIR/.write-probe" 2>/dev/null \
  && ok "State dir → $STATE_DIR" \
  || fail "State dir not writable: $STATE_DIR"

# ---------- Output ----------

printf '%s\n' "${LOG[@]}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "RESULT: FAIL ($FAIL blocker(s), $WARN warning(s))"
  # SLICC sprinkle IPC ack (CC ignores)
  if [ -d "$STATE_DIR" ]; then
    REASONS=$(printf '%s\n' "${LOG[@]}" | grep '^✗' | sed 's/^✗ //' | head -3 | paste -sd '; ' -)
    # Use python3 for JSON escaping (jq -Rs not available in SLICC)
    ESCAPED=$(printf '%s' "$REASONS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
    printf '{"step":1,"status":"failed","error":%s}\n' "$ESCAPED" \
      > "$STATE_DIR/step-1-status.json"
  fi
  exit 1
fi

# Success — write state files
mkdir -p "$STATE_DIR"
cat > "$STATE_DIR/setup.json" <<EOF
{
  "ok": true,
  "stateDir": "$STATE_DIR",
  "of1Repo": "$OF1_REPO",
  "owner": "$OWNER",
  "repo": "$REPO",
  "branch": "$BRANCH",
  "tokenSource": "$TOKEN_SOURCE",
  "tokenFile": "$TOKEN_FILE",
  "tokenFromEnv": $TOKEN_HAS_ENV_VALUE,
  "playwrightCli": "$(command -v playwright-cli 2>/dev/null || echo "")",
  "playwrightFallback": "$(command -v playwright 2>/dev/null || echo "")",
  "warnings": $WARN,
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# SLICC sprinkle IPC ack (CC ignores)
echo '{"step":1,"status":"done","summary":"prerequisites verified"}' \
  > "$STATE_DIR/step-1-status.json"

echo "RESULT: OK ($WARN warning(s))"
echo "Wrote $STATE_DIR/setup.json"
exit 0
