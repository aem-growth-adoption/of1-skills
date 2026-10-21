---
name: of1-check-dependencies
description: Verify all OF1 dependencies are installed, check the local EDS repo is valid, and prepare repo-config.json. Use at the start of an OF1 integration (setup), before running any other OF1 step, or whenever dependencies or repo config need a preflight check.
user-invocable: true
---

# OF1 Setup — Verify Dependencies & Repo

## Part 1 — scripted checks

**Run this exact command. Do NOT substitute with ad-hoc checks.**

```bash
bash "${SKILL_DIR:?set SKILL_DIR to this skill's directory}/scripts/verify.sh"
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

1. The plugin's ten OF1 skills are installed (`of1-integration`, `of1-check-dependencies`, `of1-extract-design`, `of1-build-templates`, `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`, `of1-publish`, `of1-style-generative-block`). `of1-build-cta-template` ships here too, though `of1-integration` runs it only when `cta-template` is set. The exact set is the `REQUIRED_SKILLS` array in `scripts/verify.sh`; the count is derived from it, not hardcoded.
2. The Adobe EDS skills `stardust` (incl. `stardust:extract`) and `impeccable` are installed — `of1-extract-design` depends on these directly
3. Shell tools: `node`, `python3`, `jq`, `git`, `curl`
4. `playwright-cli` — probed for the modern `open` subcommand (warns if the binary is present but missing it)
5. `$OF1_DEMO_REPO` is a git checkout with EDS structural files
   (`scripts/aem.js` or `scripts/lib-franklin.js`, `scripts/scripts.js`,
   `styles/styles.css`) — **fails hard** if not, no fallback
6. An Adobe IMS / DA token is resolvable
7. `$OF1_STATE_DIR` is writable

It also resolves `owner`/`repo` (from `git config remote.origin.url`) and
`branch` (from `git branch --show-current`) and writes them into
`setup.json`. **First of all** (before anything is written) it requires the
checkout to be on `main`: on any other branch it exits `1` with `OF1 setup runs
from the main branch (checkout main)` (detached HEAD: its own message). Every
Part 2 step re-checks this through `00-load-setup.sh`.

## Part 2 — repo state (after verify.sh succeeds)

Each step is a script in `$SKILL_DIR/scripts/`, run as `bash "$SKILL_DIR/scripts/<name>"`. Every script except `01` sources `00-load-setup.sh`: it reads `setup.json` (`owner`, `repo`, `branch`, `of1Repo`; token source already validated by `verify.sh`), sets git to fail fast instead of prompting (the container has no TTY, so a rejected token would otherwise hang install-dependencies), and `cd`s into the repo. Run the steps in order, stopping on the first non-zero exit.

| # | Command | What it does |
|---|---------|--------------|
| 0 | `02-domain.sh [<domain>]` | Resolves `DOMAIN`, first match wins: env `DOMAIN`; `.domain` of an existing `$OF1_STATE_DIR/repo-config.json`; `OF1_CONTENT_SOURCE`; first `https://` host in `fstab.yaml`/`README.md` that is not `aem.live\|aem.page\|hlx.*\|github.com`; then the argument. Prints it; exit `2` = nothing resolved, ask the user then re-run with the answer as the argument. Capture with `DOMAIN=$(bash "$SKILL_DIR/scripts/02-domain.sh") \|\| <handle exit>` — never `export DOMAIN=$(...)`, which masks the exit status and can leave `DOMAIN` empty |
| 1 | `01-reset-state.sh` | Clears the previous run's local state (status files, staged DA/hub inputs, `product-urls.txt`). Never deletes DA or git content; every run is idempotent and overwrites only OF1-owned paths |
| 3b | `03b-legacy-config.sh` | Git-tracked `of1/config/config.json` or `cta-template.json` = legacy setup (other tracked files there are left alone): prints `Legacy OF1 setup found: run of1-skills:of1-migrate` and exits `3` (stop; never removes) |
| 4 | `04-code-sync.sh` | Probes the `main` preview (bounded curl, up to ~60 s); only WARNs if not 200 |
| 5 | `05-aem-preview-auth.sh` | Probes AEM preview authorization (a separate grant from DA write); fails with a provisioning message on non-200 |
| 7 | `07-config-json.sh [<domain>]` | Resolves the domain itself (same logic as step 0, fails with exit 1 if empty), writes the DA sheet `/of1/config/config` (`key,value`; row `domain`) via `da-write.mjs` and previews it; nothing is committed to git |
| 8 | `08-helix-query.sh` | Creates `helix-query.yaml` (indexing `/of1/knowledge/**` + `/templates/**` into `/query-index.json`) only if absent; warns, never edits, a customer's. `SKIP_HELIX_QUERY=1` skips it |
| 9 | `09-repo-config.sh [<domain>]` | Resolves the domain itself (fails if empty), writes `$OF1_STATE_DIR/repo-config.json` |

### Decisions the scripts cannot make

- **Step 0.** If `02-domain.sh` exits `2` (nothing resolved, interactive), ask the user for the production domain via `AskUserQuestion` and re-run it with the answer as the argument. With `OF1_NON_INTERACTIVE=1` it instead exits `1` with `FAIL: cannot determine DOMAIN — set DOMAIN or pass content-source=<domain>`; stop. Step 7 writes the domain to `config.json`.
- **Branch.** Not on `main` = hard stop (`OF1 setup runs from the main branch (checkout main)`); tell the user to check out `main` and re-run. Nothing was written.
- **Step 3b.** Exit `3` means the repo still has git-tracked OF1 config (old setup). Stop the run and tell the user to run `of1-skills:of1-migrate`; do not remove files here.

### Why steps 7 and 8 exist

`config.json` is the only committed OF1 config file this skill writes; it carries just the target `domain` (which can differ from the EDS host). Content ingestion uses the worker default `/of1/knowledge/**`; add `contentIngestion` only to override. `of1-publish` step 2b may later merge `contentIngestion.indexPath` into it.

The worker discovers knowledge pages from the site-root `query-index.json`, built by EDS from `helix-query.yaml`. OF1 demo repos ship without one, so the published pages would be undiscoverable. Sites whose index lives in the AEM configuration service (a repo `helix-query.yaml` is not honoured; often stated in the site's `AGENTS.md`/README; root `/query-index.json` 404s) must run step 8 with `SKIP_HELIX_QUERY=1` — `of1-publish` step 2b then sets the `config.json` overrides. `helix-query.yaml` controls what goes *into* the index; the worker's ingestion filter decides what gets embedded. A doc only appears in an index once *published*. Template names do not depend on the index: `of1-build-templates` writes the previewed sheet `/of1/config/template-list`, which the worker reads (`of1-publish` step 2b removes any stale `templates.names` override). `of1-publish`'s `content.indexed > 0` gate is the coverage proof.

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

## Env vars — optional unless noted

| Var | Purpose |
|-----|---------|
| `OF1_DEMO_REPO` | absolute path to the local EDS site repo (any org/repo — validated structurally, not by identity). Default: `git rev-parse --show-toplevel` of `$PWD`; error if not a git repo. |
| `OF1_STATE_DIR` | state dir for progress/state files. Default: `$PWD/.of1/state`. |
| `DOMAIN` | the site's production domain (e.g. `frescopa.coffee`) — recorded in `repo-config.json`; resolved per step 0 when unset |
| `ADOBE_IMS_TOKEN` | raw token value (preferred — highest priority) |
| `OF1_TOKEN_FILE` | path to a `{"access_token":"…"}` JSON (alternative to the env value) |
| `STRICT` | `1` makes warnings fail. Default `0`. |

Token resolution order: `$ADOBE_IMS_TOKEN` → `$OF1_TOKEN_FILE` → `$PWD/.hlx/.da-token.json` → `$OF1_DEMO_REPO/.hlx/.da-token.json`.

## State files written

| File | Purpose |
|------|---------|
| `$OF1_STATE_DIR/setup.json` | resolved paths + owner/repo/branch + token source (from `verify.sh`) |
| `$OF1_STATE_DIR/repo-config.json` | owner/repo/branch/contentPrefix/repoDir/domain/repoUrl/previewUrl/daSource — written interactively in Part 2 |
| `$OF1_STATE_DIR/of1-check-dependencies-status.json` | `{"stage":0,"skill":"of1-check-dependencies","status":"done"\|"failed",…}`. |

## Install behavior

- **Claude Code:** cannot activate plugins installed mid-session (`/plugin install` only picks up disk changes between turns). Missing items are reported with the exact fix command for the user to run, then relaunch Claude Code.
