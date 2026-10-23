#!/usr/bin/env bash
# of1-check-dependencies verifier — checks all prerequisites for an OF1
# integration, including that OF1_DEMO_REPO is a valid EDS repo (structural
# check, not identity — any org/repo works). Claude Code only. OF1_STATE_DIR
# defaults to $PWD/.of1/state; OF1_DEMO_REPO defaults to the git toplevel of
# $PWD. Contract documented in ../SKILL.md.
#
# Exit 0 = all good; exit 1 = something blocking is missing.
# Side effect on success:
#   <stateDir>/setup.json          — resolved paths + owner/repo/branch + token source
#   <stateDir>/of1-check-dependencies-status.json — progress file
#
# repo-config.json (owner/repo/branch/domain/repoDir) is NOT written by this
# script — it's written interactively by of1-check-dependencies/SKILL.md's "Repo state"
# section after this script exits 0.
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

# ---------- 0. Branch guard: OF1 setup runs from main, before anything is written ----------
_GR="${OF1_DEMO_REPO:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -n "$_GR" ] && [ -e "$_GR/.git" ]; then
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../../lib/env.sh"
  (cd "$_GR" && of1_require_main) || exit 1
fi

# ---------- 1. OF1 step skills (project- or user-scoped) ----------

# The ten skills of the of1-skills plugin.
REQUIRED_SKILLS=(
  of1-integration of1-check-dependencies of1-extract-design
  of1-build-templates of1-style-generative-block
  of1-extract-brand-voice of1-extract-content of1-build-quick-suggestions
  of1-build-cta-template of1-publish
)

# Search locations: plugin, user and project scopes.
SKILL_ROOTS=(
  "$HOME/.claude/plugins"
  "$HOME/.claude/skills"
  "$PWD/.claude/skills"
)

# Claude Code also supports marketplaces sourced from a local directory (`/plugin
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
  fail "found 0 of $TOTAL OF1 skills — is this a local checkout with the plugin not installed to a searched root? fix: /plugin install of1-skills@<marketplace>"
else
  fail "Missing $((${#MISSING[@]})) of $TOTAL OF1 skills: ${MISSING[*]} — fix: /plugin install of1-skills@<marketplace>"
fi

# ---------- 2. Adobe EDS skills: stardust + impeccable ----------

ADOBE_EDS_SKILLS=(stardust impeccable)

for S in "${ADOBE_EDS_SKILLS[@]}"; do
  p=$(find_skill "$S" || true)
  if [ -n "${p:-}" ]; then
    ok "$S → $p"
  else
    case "$S" in
      stardust)
        fail "Adobe EDS skill 'stardust' not installed — fix: /plugin install stardust@adobe-skills" ;;
      impeccable)
        fail "Adobe EDS skill 'impeccable' not installed — fix: /plugin install impeccable@impeccable" ;;
    esac
  fi
done

# ---------- stardust:extract (of1-extract-design depends on it) ----------
if find "${SKILL_ROOTS[@]}" -path "*/skills/extract/SKILL.md" 2>/dev/null | grep -q .; then
  ok "stardust:extract present"
else
  fail "stardust:extract skill not found — of1-extract-design requires it. Update the stardust plugin: /plugin update stardust"
fi

# ---------- 3. Shell tools ----------

for T in node python3 jq git curl; do
  if command -v "$T" >/dev/null 2>&1; then
    ok "$T → $(command -v $T)"
  else
    fail "$T not on PATH"
  fi
done

# OF1 step skills call `playwright-cli open/screenshot/eval` using modern
# @playwright/cli syntax (open, --filename, --full-page, arrow-fn eval). Probe
# SHAPE, not just presence (finding 49): confirm the binary understands the
# `open` subcommand. Its global `--help` exits 0 for any token, so check for the
# `open` command in the help output specifically.
if command -v playwright-cli >/dev/null 2>&1; then
  PWCLI_PATH="$(command -v playwright-cli)"
  if playwright-cli --help 2>&1 | grep -qiE '(^| )open( |$)'; then
    ok "playwright-cli → $PWCLI_PATH"
  else
    warn "playwright-cli at $PWCLI_PATH does not expose the 'open' subcommand — step skills use modern @playwright/cli syntax (open/--filename/--full-page). Install it: npm i -g @playwright/cli@latest && playwright-cli install-browser"
  fi
elif command -v playwright >/dev/null 2>&1; then
  warn "playwright-cli not found; only 'playwright' is installed at $(command -v playwright). Install @playwright/cli: npm i -g @playwright/cli@latest && playwright-cli install-browser — else step skills calling open/screenshot/eval will fail."
else
  fail "playwright-cli not installed — fix: npm i -g @playwright/cli@latest && playwright-cli install-browser"
fi

# ---------- 4. EDS repo verification (any org/repo — structural, not identity) ----------
# OF1_DEMO_REPO defaults to the git toplevel of $PWD.
# Verifies EDS structural files exist and resolves owner/repo/branch from git.

OF1_REPO=""
if [ -z "${OF1_DEMO_REPO:-}" ]; then
  OF1_DEMO_REPO=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi
OWNER=""
REPO=""
BRANCH=""

if [ -n "${OF1_DEMO_REPO:-}" ] && [ -e "${OF1_DEMO_REPO}/.git" ]; then  # -e: worktrees have a .git file
  REMOTE=$(cd "$OF1_DEMO_REPO" && git config remote.origin.url 2>/dev/null || true)
  # Last two path segments of any remote form (https://github.com/o/r.git,
  # git@github.com:o/r.git, ssh host aliases like git@github-perso:o/r.git).
  OWNER=$(echo "$REMOTE" | sed -E 's|\.git$||; s|^.*[:/]([^/:]+)/([^/:]+)$|\1|')
  REPO=$(echo "$REMOTE" | sed -E 's|\.git$||; s|^.*[:/]([^/:]+)/([^/:]+)$|\2|')
  BRANCH=$(cd "$OF1_DEMO_REPO" && git branch --show-current 2>/dev/null || true)

  if { [ -f "${OF1_DEMO_REPO}/scripts/aem.js" ] || [ -f "${OF1_DEMO_REPO}/scripts/lib-franklin.js" ]; } \
     && [ -f "${OF1_DEMO_REPO}/scripts/scripts.js" ] \
     && [ -f "${OF1_DEMO_REPO}/styles/styles.css" ]; then
    OF1_REPO="$OF1_DEMO_REPO"
    ok "EDS repo → $OF1_REPO ($OWNER/$REPO, branch: ${BRANCH:-<detached>})"
  else
    fail "Not an EDS repo at $OF1_DEMO_REPO — missing scripts/aem.js (or lib-franklin.js), scripts/scripts.js, or styles/styles.css. cd into a valid EDS repo checkout (or set OF1_DEMO_REPO) and re-run."
  fi
else
  fail "OF1_DEMO_REPO not set and $PWD is not inside a git checkout — cd into a cloned EDS repo or set OF1_DEMO_REPO to its absolute path"
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
  if [ -d "$STATE_DIR" ]; then
    REASONS=$(printf '%s\n' "${LOG[@]}" | grep '^✗' | sed 's/^✗ //' | head -3 | paste -sd '; ' -)
    ESCAPED=$(printf '%s' "$REASONS" | jq -Rs .)
    printf '{"stage":0,"skill":"of1-check-dependencies","status":"failed","error":%s}\n' "$ESCAPED" \
      > "$STATE_DIR/of1-check-dependencies-status.json"
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

# progress file
echo '{"stage":0,"skill":"of1-check-dependencies","status":"done","summary":"prerequisites verified"}' \
  > "$STATE_DIR/of1-check-dependencies-status.json"

echo "RESULT: OK ($WARN warning(s))"
echo "Wrote $STATE_DIR/setup.json"
exit 0
