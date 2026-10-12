---
name: of1-check-dependencies
description: Verify all OF1 demo pipeline dependencies are installed, check the local EDS repo is valid, and prepare repo-config.json. Use at the start of an OF1 demo (Step 1 / setup), before running any pipeline step, or whenever dependencies or repo config need a preflight check.
user-invocable: true
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

1. The pipeline's OF1 skills are installed — the orchestrator (`of1-demo-orchestrator`) plus every step skill it dispatches (`of1-discovery`, `of1-extract-design`, `of1-prototype`, `of1-snowflake`, `of1-build-templates`, `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`, `of1-publish`, `of1-style-generative-block`, `of1-integration`). `of1-build-cta-template` ships here too, though `of1-integration` dispatches it in pipeline mode only. The exact set is the `REQUIRED_SKILLS` array in `scripts/verify.sh`; the count is derived from it, not hardcoded. (`of1-signals` is a standalone tool, not checked; `of1-check-dependencies` is running the check.)
2. The Adobe EDS skills `stardust` (incl. `stardust:extract` and `stardust:prototype`), `impeccable`, and the `snowflake` skill (`aem-edge-delivery-services` plugin) are installed — the three Stage-2 skills `of1-extract-design`/`of1-prototype`/`of1-snowflake` depend on these directly
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
# Every step below (3b, 6, 7, 8) uses repo-relative paths and git — run them all
# from the repo root.
cd "$REPO_DIR" || { echo "✗ cannot cd into $REPO_DIR" >&2; exit 1; }

if [ "$(echo "$SETUP" | jq -r .tokenFromEnv)" = "true" ]; then
  DA_TOKEN="$ADOBE_IMS_TOKEN"
else
  DA_TOKEN=$(jq -r .access_token "$(echo "$SETUP" | jq -r .tokenFile)")
fi
```

### 1. Clear the previous run's local state

Every run is idempotent and overwrites only OF1-owned paths; This skill never deletes DA or git content; removing a previous demo's artifacts is outside its scope.

Local state (not customer content) — reset it so the pipeline starts cleanly:

```bash
rm -f "$OF1_STATE_DIR"/of1-*-status.json
rm -f "$OF1_STATE_DIR/discovery.html"
# Staged DA inputs + hub inputs from the previous run — otherwise a re-run
# could re-upload stale landing copy / personas / chips / knowledge pages.
rm -f "$OF1_STATE_DIR"/{of1-landing.json,personas-rows.json,suggestions-rows.json,knowledge-pages.json,brand-voice.html}
rm -rf "$OF1_STATE_DIR/hub"
```

### 2. Warn if on `main` or detached HEAD

If `setup.json`'s `branch` field is empty or `"main"`, tell the user:

> ⚠️ Currently on `{branch or 'a detached HEAD'}` — demo artifacts and DA
> content will be affected on this branch/state. Proceeding anyway per the
> hands-off branch model; check out the intended branch yourself if this
> isn't what you want.

Then proceed regardless — never block on this.

### 3b. Remove legacy `of1/config/*.json` (every run)

**Runs on every run.** Sites integrated by an
older version of these skills still track `of1/config/*.json` files that are no
longer produced or read (`knowledge.json`, `personas.json`, `suggestions.json`,
`brand-voice.json`, `templates.json`, `of1-endpoint.json`, `products.json`,
`features.json`, `faqs.json`, `use-cases.json`, …). A git file beats a DA sheet at
the same URL on EDS, so e.g. a committed `personas.json` / `suggestions.json`
**shadows** the DA sheet `/of1/config/personas` / `/of1/config/suggestions` the
later steps write. Only `of1/config/config.json` (plus
`of1/config/cta-template.json` in pipeline mode) may stay tracked.

```bash
# (cwd is $REPO_DIR — set in the Part 2 preamble.)
ALLOWED=(of1/config/config.json)
[ "${OF1_PIPELINE_MODE:-}" = "1" ] && ALLOWED+=(of1/config/cta-template.json)
LEGACY=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  ok=0; for a in "${ALLOWED[@]}"; do [ "$f" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || LEGACY+=("$f")
done < <(git ls-files of1/config)
if [ "${#LEGACY[@]}" -gt 0 ]; then
  echo "Legacy OF1 config files tracked in git (would shadow DA config / no longer read):"
  printf '    %s\n' "${LEGACY[@]}"
else
  echo "✓ No legacy of1/config files tracked"
fi
```

If `LEGACY` is non-empty, explain to the user that these are legacy OF1 files
from an earlier integration: they're no longer read by the worker, and any that
share a URL with a DA sheet (`personas.json`, `suggestions.json`) would shadow the
author-editable DA version. Then:

- **Standalone mode** (`OF1_PIPELINE_MODE` unset): ask via `AskUserQuestion`
  — **Remove them** (commit + push the deletion of exactly the listed files) /
  **Keep them**. On Keep, skip the removal and warn that `of1-publish` check 1
  will fail until they're gone.
- **Pipeline mode** (`OF1_PIPELINE_MODE=1`): remove without asking.

Removal — exactly the listed files, never the whole `of1/config/` tree (it holds
`config.json`), never a bare `git add -A`/`.`:

```bash
if [ "${#LEGACY[@]}" -gt 0 ]; then
  git rm -q -f -- "${LEGACY[@]}"
  # Commit only files that exist in HEAD: a `git commit -- <path>` whose pathspec
  # git no longer knows (staged-but-never-committed file) fails the whole commit.
  C=()
  for f in "${LEGACY[@]}"; do git cat-file -e "HEAD:$f" 2>/dev/null && C+=("$f"); done
  if [ "${#C[@]}" -gt 0 ]; then
    git commit -m "chore: remove legacy OF1 config JSON" -- "${C[@]}"
    # Rebase onto the remote first so a concurrent push never rejects ours.
    git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
    git push origin "$BRANCH"
  fi
  echo "✓ Removed legacy OF1 config JSON: ${LEGACY[*]}"
fi
```

`of1-publish` check 1 re-asserts the same allowed set as the backstop.

### 4. Code Sync check

```bash
PREVIEW_URL="https://${BRANCH}--${REPO}--${OWNER}.aem.page/"
# Bound every probe: an unbounded curl here can hang install-dependencies. Cap
# the wait to ~60s total — this check only WARNs on non-200 and proceeds
# regardless (Code Sync may still be catching up), so a long block only risks
# tripping the 3-minute install-dependencies watchdog for no benefit.
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 "$PREVIEW_URL")

if [ "$STATUS" != "200" ]; then
  echo "WARN: Preview URL returned $STATUS — waiting for Code Sync..."
  for i in $(seq 1 12); do
    sleep 5
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 "$PREVIEW_URL")
    [ "$STATUS" = "200" ] && break
  done
fi

if [ "$STATUS" = "200" ]; then
  echo "✓ Branch preview live: $PREVIEW_URL"
else
  echo "WARN: Branch preview returned $STATUS — may need a few more minutes for Code Sync"
fi
```

### 5. AEM preview authorization check (da-blocks-slots requirement)

`of1-build-templates` authors templates as DA documents that MUST be EDS-previewed before the OF1
worker can sync them (a DA write with no preview is invisible to `materializeDaTemplates()`). AEM
preview/publish authorization is a **separate grant from DA write access** — the design doc recorded a
project-wide `403 [admin] not authorized` on `of1-labs` with a valid DA token. Probe it up front so the
pipeline fails here with a clear provisioning message rather than deep inside `assemble`:

```bash
AEM_TOKEN="${AEM_TOKEN:-$DA_TOKEN}"
# MUST bound this probe: admin.hlx.page can stall, and an unbounded curl here
# hangs the whole install-dependencies step (observed: 18min+ wedge). On
# timeout curl exits non-zero and prints "000", which the non-200 branch below
# treats as a failure.
PV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 20 \
  "https://admin.hlx.page/status/${OWNER}/${REPO}/main/index" \
  -H "Authorization: Bearer $AEM_TOKEN")
# status returns the preview/live/code authorization triplet; a 403 here is the
# org-level gap. Treat non-200 (incl. "000" timeout) as a hard prerequisite
# failure for the da-blocks-slots template flow.
if [ "$PV_STATUS" = "200" ]; then
  echo "✓ AEM preview authorization present on ${OWNER}/${REPO}"
else
  echo "✗ FAIL: AEM preview authorization missing (status ${PV_STATUS}) on ${OWNER}/${REPO}." >&2
  echo "  This account can write to DA but cannot preview/publish, so da-blocks-slots templates" >&2
  echo "  would sync as zero. Provision AEM preview/publish rights on the org before proceeding." >&2
  exit 1
fi
```

### 6. Ensure `.hlxignore` does NOT block `of1/config/`

The OF1 extension and worker read `of1/config/config.json` from the EDS CDN, so
`.hlxignore` must not exclude it. Edit the file **only** when a line actually
blocks it — `of1` / `of1/` (the whole tree) or anything starting `of1/config`.
Every other line — including `of1/knowledge/` or other customer exclusions — is
left untouched:

```bash
if [ -f .hlxignore ] && grep -Eq '^of1/?$|^of1/config' .hlxignore; then
  # -i.bak works on both GNU and BSD/macOS sed (bare `-i` fails on BSD); drop the backup after.
  sed -E -i.bak '/^of1\/?$/d; /^of1\/config/d' .hlxignore && rm -f .hlxignore.bak
  # An uncommitted edit never reaches EDS — commit (scoped to .hlxignore) + push.
  git add -- .hlxignore
  git commit -m "chore: allow of1/config on the code bus" -- .hlxignore
  # Rebase onto the remote first so a concurrent push never rejects ours.
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
  git push origin "$BRANCH"
  echo "✓ Removed the of1/config exclusion from .hlxignore (committed + pushed)"
else
  echo "✓ .hlxignore does not block of1/config"
fi
```

**Do NOT add `of1/` to `.hlxignore`** — `of1/config/config.json` must be served on
the CDN.

### 7. Write `config.json` + push (skip if the file is already committed)

`config.json` is the only committed OF1 config file this skill writes. It carries just
the target `domain` (which can differ from the EDS host). Nothing else goes in it —
content ingestion uses the worker default `/of1/knowledge/**`; add `contentIngestion`
here only to override. (`of1-publish` step 2b may later merge `templates.names` /
`contentIngestion.indexPath` into it for sites whose index is managed by the AEM
config service — see step 8.)

```bash
mkdir -p of1/config
cat > of1/config/config.json <<EOF
{ "domain": "${DOMAIN}" }
EOF
git add -- of1/config/config.json
# Commit ONLY config.json, even if something else happens to be staged.
if ! git diff --cached --quiet -- of1/config/config.json; then
  git commit -m "feat: OF1 config.json for ${DOMAIN}" -- of1/config/config.json
  # Rebase onto the remote first so a concurrent push never rejects ours.
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
  git push origin "$BRANCH"
  echo "✓ of1/config/config.json committed + pushed"
fi
```

### 8. Ensure a query-index covers `/of1/knowledge/**` and `/templates/**` (author `helix-query.yaml`)

The worker discovers knowledge pages **and** DA template docs from the
**site-root `query-index.json`**, which EDS builds from `helix-query.yaml`. OF1
demo repos ship WITHOUT one — the root `query-index.json` 404s — so the
published `/of1/knowledge/**` pages and `/templates/**` docs are undiscoverable:
ingestion indexes nothing and the tenant syncs zero templates. Author an index
that targets the root `/query-index.json` and includes **both**
`/of1/knowledge/**` and `/templates/**` — **create it only if absent**. If the
site already has a `helix-query.yaml`, it is the customer's: warn only — never
edit a customer's helix-query.yaml.

**Sites whose index lives in the AEM configuration service** (not
`helix-query.yaml`): some sites configure their query index in the AEM config
service, where a repo `helix-query.yaml` is **not honoured** — this is often
stated in the site's own `AGENTS.md`/README, and the root `/query-index.json`
typically 404s or doesn't list `/of1/knowledge/` / `/templates/` paths even
though the site has an index (e.g. `/sitemap.json`). **Do not create a
`helix-query.yaml` for such a site** (it would be dead weight in the customer's
repo). Skip this step; `of1-publish` step 2b detects the gap and points the
worker at the right sources via `config.json` overrides
(`templates.names`, `contentIngestion.indexPath`).

```bash
# Set SKIP_HELIX_QUERY=1 when the site's index is managed by the AEM config
# service (see above) — of1-publish step 2b handles those sites.
if [ "${SKIP_HELIX_QUERY:-0}" = "1" ]; then
  echo "↷ index managed by the AEM config service — no helix-query.yaml; of1-publish step 2b sets config.json overrides"
elif [ ! -f helix-query.yaml ]; then
  cat > helix-query.yaml <<'YAML'
version: 1
indices:
  of1-knowledge:
    include:
      - '/of1/knowledge/**'
      - '/templates/**'
    target: /query-index.json
    properties:
      title:
        select: head > meta[property="og:title"]
        value: attribute(el, "content")
YAML
  git add -- helix-query.yaml
  git commit -m "chore: index /of1/knowledge and /templates into query-index for OF1" -- helix-query.yaml
  git pull --rebase --autostash -q origin "$BRANCH" || { git rebase --abort 2>/dev/null; echo "✗ FAIL: git pull --rebase origin $BRANCH failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin $BRANCH), then re-run. Never force-push." >&2; exit 1; }
  git push origin "$BRANCH"
  echo "✓ created helix-query.yaml (indexes /of1/knowledge/** + /templates/** → /query-index.json)"
else
  # Warn only — never edit a customer's helix-query.yaml.
  # Match a quoted include path ('/templates/… or "/of1/knowledge/…), not any substring.
  for want in /of1/knowledge/ /templates/; do
    grep -qE "[\"']${want}" helix-query.yaml || {
      echo "⚠ helix-query.yaml exists but doesn't include ${want}** — left untouched." >&2
      echo "  Ask the site owner to include ${want}** in an index targeting /query-index.json;" >&2
      echo "  of1-publish step 2b will try config.json overrides, otherwise its checks 2/3 will fail." >&2
    }
  done
  echo "✓ helix-query.yaml present (customer-owned, not edited)"
fi
```

These are two different layers, not a duplicated scope: `helix-query.yaml`
controls what EDS puts *into* `query-index.json` (index membership, a build
concern), while the worker's content-ingestion filter (default `/of1/knowledge/**`,
overridable via `contentIngestion` in `config.json`, Step 7) decides what gets
embedded. The worker needs both. `/templates/**` is in the same index because the
worker lists DA template docs from `query-index.json` too (unless `config.json`
sets `templates.names`). **But a doc only appears in an EDS index once it is
*published* (live)** — `of1-build-templates` only *previews* template docs, so
`/templates/**` is usually absent from the index and `of1-publish` step 2b ends
up setting `templates.names` from the DA listing; that is the normal path, not
an error. After the knowledge
pages are published (`of1-extract-content` Step 8), EDS rebuilds
`/query-index.json` to include them; `of1-publish`'s `content.indexed > 0` gate
is the coverage proof.

### 9. Write `repo-config.json`

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
| `OF1_DEMO_REPO` | **required** — absolute path to the local EDS site repo (any org/repo — validated structurally, not by identity) |
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
- **Claude Code:** cannot activate plugins installed mid-session (`/plugin install` only picks up disk changes between turns). Missing items are reported with the exact fix command for the user to run, then relaunch Claude Code.
