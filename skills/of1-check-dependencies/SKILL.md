---
name: of1-check-dependencies
description: Verify all OF1 demo pipeline dependencies are installed, check the local EDS repo is valid, and prepare repo-config.json. Use at the start of an OF1 demo (Step 1 / setup), before running any pipeline step, or whenever dependencies or repo config need a preflight check.
---

# OF1 Setup — Verify Dependencies & Repo

## Part 1 — scripted checks

**Run this exact command. Do NOT substitute with ad-hoc checks.**

```bash
OF1_DEMO_REPO="${OF1_DEMO_REPO:-/workspace/of1-demo-orchestrator}" \
OF1_STATE_DIR="${OF1_STATE_DIR:-/shared/of1-demo-orchestrator}" \
ADOBE_IMS_TOKEN="${ADOBE_IMS_TOKEN:-$(oauth-token adobe 2>/dev/null || true)}" \
bash "${SKILL_DIR:-/workspace/skills/of1-check-dependencies}/scripts/verify.sh"
```

Do NOT:
- Run `command -v` checks yourself instead of the script
- Skip the script because "it's simple" or "I can check faster"
- Write `setup.json` or `repo-config.json` by hand

If exit code is `1`: report the exact error lines and STOP. This includes
the case where `$OF1_DEMO_REPO` is not a valid EDS repo — there is no
fallback to clone or create a repo. The user must `cd` into (or point
`OF1_DEMO_REPO` at) a valid EDS repo checkout and re-run.

If exit code is `0`: continue to **Part 2** below.

Downstream steps **structurally depend on `$OF1_STATE_DIR/repo-config.json`
existing** — it is not written by `verify.sh`; Part 2 writes it.

### What verify.sh checks

1. The pipeline's OF1 skills are installed — the orchestrator (`of1-demo-orchestrator`) plus every step skill it dispatches (`of1-discovery`, `of1-build-templates`, `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`, `of1-generate-config-review`, `of1-publish`, `of1-style-generative-block`, `of1-integration`). The exact set is the `REQUIRED_SKILLS` array in `scripts/verify.sh`; the count is derived from it, not hardcoded. (`of1-signals` is a standalone tool, not checked; `of1-check-dependencies` is running the check.)
2. The Adobe EDS skills `stardust` (incl. `stardust:replica`), `impeccable` are installed
3. Shell tools: `node`, `python3`, `jq`, `git`, `curl`
4. `playwright-cli` — probed for the modern `open` subcommand (warns if the binary is present but missing it)
5. `$OF1_DEMO_REPO` is a git checkout with EDS structural files
   (`scripts/aem.js` or `scripts/lib-franklin.js`, `scripts/scripts.js`,
   `styles/styles.css`) — **fails hard** if not, no fallback
6. An Adobe IMS / DA token is resolvable
7. `$OF1_STATE_DIR` is writable

It also resolves `owner`/`repo` (from `git config remote.origin.url`) and
`branch` (from `git branch --show-current`) and writes them into
`setup.json`. It **warns** (does not fail) if `branch` is empty (detached
HEAD) or `main`.

## Part 2 — repo state (interactive, after verify.sh succeeds)

Read `setup.json` for `owner`, `repo`, `branch`, `of1Repo`, and resolve
`DA_TOKEN` (a shell local — the canonical credential is `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`; see
`of1-demo-orchestrator/knowledge/pipeline-contract.md` § "Environment variables") from whichever
token source `verify.sh` already found (do not re-derive it — `verify.sh` already validated it exists):

```bash
SETUP=$(cat "$OF1_STATE_DIR/setup.json")
OWNER=$(echo "$SETUP" | jq -r .owner)
REPO=$(echo "$SETUP" | jq -r .repo)
BRANCH=$(echo "$SETUP" | jq -r .branch)
REPO_DIR=$(echo "$SETUP" | jq -r .of1Repo)

if [ "$(echo "$SETUP" | jq -r .tokenFromEnv)" = "true" ]; then
  DA_TOKEN="$ADOBE_IMS_TOKEN"
else
  DA_TOKEN=$(jq -r .access_token "$(echo "$SETUP" | jq -r .tokenFile)")
fi
```

### 1. Detect an in-progress demo

```bash
if [ -f "$OF1_STATE_DIR/repo-config.json" ]; then
  echo "=== Existing demo found ==="
  cat "$OF1_STATE_DIR/repo-config.json"
  echo ""
  for f in "$OF1_STATE_DIR"/step-*-status.json; do
    [ -f "$f" ] && { echo "--- $(basename "$f") ---"; cat "$f"; echo ""; }
  done
fi
```

- **If `repo-config.json` does NOT exist:** no demo in progress. Skip
  straight to step 3 (Clean slate) below — treat as fresh, run cleanup
  unconditionally (there is nothing to preserve), no prompt needed.
- **If it DOES exist:** summarize the branch, domain, and last completed
  step to the user from the printed JSON, then ask via `AskUserQuestion`:
  - **Continue** this demo — skip cleanup entirely, keep all existing
    artifacts and DA content, go straight to step 4 (Code Sync check).
  - **Restart** this demo — run cleanup (step 3) against the *same*
    branch, then continue to step 4.

### 2. Warn if on `main` or detached HEAD

If `setup.json`'s `branch` field is empty or `"main"`, tell the user:

> ⚠️ Currently on `{branch or 'a detached HEAD'}` — demo artifacts and DA
> content will be affected on this branch/state. Proceeding anyway per the
> hands-off branch model; check out the intended branch yourself if this
> isn't what you want.

Then proceed regardless — never block on this.

### 3. Clean slate (restart, or fresh setup with nothing to preserve)

Remove previous demo artifacts but preserve EDS boilerplate
(`styles/styles.css`, `scripts/`, `blocks/{header,footer,fragment}/`,
`head.html`):

```bash
cd "$REPO_DIR"
rm -rf stardust/ deliverables/ templates/ fragments/ content/ drafts/ \
       gallery/ of1/config/ tools/ output/ screenshots/ tmp/ da/
rm -rf styles/of1-*.css styles/prototype-*.css
rm -f PRODUCT.md

# Clean prior state
rm -rf "$OF1_STATE_DIR"/step-*
rm -f "$OF1_STATE_DIR/discovery.html"

git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: clean slate for ${BRANCH}"
  git push origin "$BRANCH"
  echo "✓ Clean slate committed + pushed"
else
  echo "✓ Branch already clean"
fi
```

Then clean DA content for the branch:

```bash
DA_LIST=$(curl -s -H "Authorization: Bearer $DA_TOKEN" \
  "https://admin.da.live/list/${OWNER}/${REPO}" 2>/dev/null || echo "[]")

echo "$DA_LIST" | jq -r '.[] | select(.ext == "html") | .name' 2>/dev/null | while read -r name; do
  [ -n "$name" ] || continue
  curl -s -X DELETE -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/source/${OWNER}/${REPO}/${name}.html" >/dev/null
done
echo "✓ DA content cleaned"
```

### 4. Code Sync check

```bash
PREVIEW_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PREVIEW_URL")

if [ "$STATUS" != "200" ]; then
  echo "WARN: Preview URL returned $STATUS — waiting for Code Sync..."
  for i in $(seq 1 30); do
    sleep 5
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PREVIEW_URL")
    [ "$STATUS" = "200" ] && break
  done
fi

if [ "$STATUS" = "200" ]; then
  echo "✓ Branch preview live: $PREVIEW_URL"
else
  echo "WARN: Branch preview returned $STATUS — may need a few more minutes for Code Sync"
fi
```

### 5. Ensure `.hlxignore` does NOT block `of1/config/`

The OF1 extension reads config files from the EDS CDN (`/of1/config/*.json`).
The boilerplate `.hlxignore` must NOT include `of1/` or `of1/config/`:

```bash
if [ -f .hlxignore ] && grep -q '^of1' .hlxignore; then
  sed -i '/^of1/d' .hlxignore
  echo "✓ Removed of1 exclusion from .hlxignore"
fi
```

**Do NOT add `of1/` to `.hlxignore`** — the config files must be served on
the CDN.

### 6. Write `of1-endpoint.json` + push (skip if continuing and file already committed)

```bash
mkdir -p of1/config
cat > of1/config/of1-endpoint.json <<EOF
{
  "url": "https://${BRANCH}--${REPO}--${OWNER}.aem.page/of1"
}
EOF
git add of1/config/of1-endpoint.json
if ! git diff --cached --quiet; then
  git commit -m "feat: of1-endpoint config for ${DOMAIN}"
  git push origin "$BRANCH"
  echo "✓ of1-endpoint.json committed + pushed"
fi
```

### 7. Write `repo-config.json`

```bash
mkdir -p "$OF1_STATE_DIR"
cat > "$OF1_STATE_DIR/repo-config.json" <<EOF
{
  "owner": "${OWNER}",
  "repo": "${REPO}",
  "branch": "${BRANCH}",
  "contentPrefix": "${BRANCH}",
  "repoDir": "${REPO_DIR}",
  "domain": "${DOMAIN}",
  "repoUrl": "https://github.com/${OWNER}/${REPO}",
  "previewUrl": "https://${BRANCH}--${REPO}--${OWNER}.aem.page/",
  "daSource": "da://${OWNER}/${REPO}"
}
EOF
echo "✓ repo-config.json written"
```

## The downstream contract (`repo-config.json`)

Every downstream step reads this file. Required fields:

| Field | Type | Notes |
|---|---|---|
| `owner` | string | GitHub org or user |
| `repo` | string | Repo name |
| `branch` | string | Whatever branch was checked out when setup ran |
| `contentPrefix` | string | Same as `branch` |
| `repoDir` | string | Absolute path to the local clone |
| `domain` | string | The customer domain |

Optional (for humans): `repoUrl`, `previewUrl`, `daSource`.

## Env vars — the orchestrator sets these before invoking

| Var | Purpose |
|-----|---------|
| `OF1_DEMO_REPO` | **required** — absolute path to a local clone of an EDS repo (any org/repo — validated structurally, not by identity) |
| `OF1_STATE_DIR` | shared IPC + state dir. SLICC: `/shared/of1-demo-orchestrator`. CC: `$PWD/.of1/state` (default). |
| `DOMAIN` | the target domain for this demo (e.g. `frescopa.coffee`) — recorded in `repo-config.json` |
| `ADOBE_IMS_TOKEN` | raw token value (preferred — highest priority) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (alternative to the env value) |
| `STRICT` | `1` makes warnings fail. Default `0`. |
| `OF1_RUNTIME` | `cc` or `slicc`. Optional — the verifier auto-detects from its install path (`/workspace/skills/*` → slicc, else cc). |

Token resolution order: `$ADOBE_IMS_TOKEN` → `$OF1_TOKEN_FILE` → `$PWD/.hlx/.da-token.json` → `$OF1_DEMO_REPO/.hlx/.da-token.json`.

## State files written

| File | Purpose |
|------|---------|
| `$OF1_STATE_DIR/setup.json` | resolved paths + owner/repo/branch + token source (from `verify.sh`) |
| `$OF1_STATE_DIR/repo-config.json` | owner/repo/branch/contentPrefix/repoDir/domain/repoUrl/previewUrl/daSource — written interactively in Part 2 |
| `$OF1_STATE_DIR/of1-check-dependencies-status.json` | `{"stage":0,"skill":"of1-check-dependencies","status":"done"\|"failed",…}`. SLICC's sprinkle polls it; CC ignores it. |

## Install behavior

- **SLICC:** the script auto-installs missing Adobe EDS skills (`stardust`, `impeccable`) via `upskill` — SLICC can activate skills mid-session. If auto-install fails, it reports the error and exits.
- **Claude Code:** cannot activate plugins installed mid-session (`/plugin install` only picks up disk changes between turns). Missing items are reported with the exact fix command for the user to run, then restart Claude Code.
