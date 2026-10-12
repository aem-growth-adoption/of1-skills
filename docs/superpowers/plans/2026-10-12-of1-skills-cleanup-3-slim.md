# of1-skills cleanup, plan 3: slim the SKILL.md files (spec stage 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the long embedded bash out of the SKILL.md files into scripts under each skill's `scripts/`, so every SKILL.md is a short procedure, with no behaviour change to what a run writes or to the progress files.

**Architecture:** Move code **verbatim** wherever possible (it just passed an end-to-end run); only the glue changes. Each SKILL.md step becomes "run `bash "$SKILL_DIR/scripts/<name>.sh"`" plus the prose that says what it does, when it fails and what to do. Scripts are self-contained: they get shared state from `lib/env.sh` (`of1_load_env`) instead of earlier shell blocks, and source the existing `lib/` helpers.

**Tech Stack:** bash, jq, Node 23 (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-09-of1-skills-cleanup-design.md` (stage 6).

## Global Constraints

- Branch `feat/skills-driver` (PR #14). Work only on it.
- NO behaviour change: same git/DA writes, same commit messages and `git add` scopes, same status files and fields (`docs/contract.md`), same failure messages and exit codes. Move text verbatim; any deliberate difference is listed in the task report.
- A script is invoked as a separate `bash` process, so it must not rely on variables from a previous SKILL.md block. Everything it needs comes from env (`OF1_STATE_DIR`, `OF1_DEMO_REPO`, `SKILL_DIR`, tokens, the three input flags) and `lib/env.sh`.
- Each script: `#!/usr/bin/env bash`, no `set -e`/`-u` unless the original block relied on it, exits non-zero exactly where the original `exit 1`/`return` did, and prints the same lines.
- SKILL.md target: at most 150 lines each (the enforced test limit is 200). Keep: purpose, inputs/env table, step list with what each script does, failure handling, completion/status-file contract.
- Never name a calling harness (existing contract test).
- Commit only files a task names. Full suite after each task: `node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs lib/*.test.mjs skills/*/scripts/*.test.mjs` and `bash -n` on every `.sh`.

## Review Focus

- Variables that used to flow between blocks (`HUB`, `ALLOWED`, `GATED_FLAGS`, `PREVIEW_BASE`, `TENANT_ID`, `WORKER_URL`, `INDEXED`, `OWNER/REPO/BRANCH/DOMAIN`) are reproduced in each script that needs them, with identical values. Pinned in Task 1 (`of1_load_env`) and per-script smoke tests.
- Publish step 2b (`config.json` index overrides) keeps its exact jq logic and refusals (daPath without leading `/`, DA listing errors, user-set indexPath untouched, multi-sheet index). Pinned by a fixture test in Task 2.
- Publish checks 1-7 keep the same pass/fail semantics and `N_CHECKS`; check 7 only with `OF1_CTA_TEMPLATE=1`. Pinned in Task 2.
- A script that is sourced-by-reference in another skill (`of1-publish` re-runs `of1-style-generative-block` Step 5 "Upload OF1 DA content"; `of1-build-templates` `da-api.sh`) keeps working from its new path. Pinned in Tasks 2 and 5.

---

### Task 1: `lib/env.sh`

**Files:** Create `lib/env.sh`, `lib/env.test.mjs`.

**Interfaces:** `of1_load_env` (sourced function; no set -e) reads `$OF1_STATE_DIR/repo-config.json` and exports `OWNER REPO BRANCH DOMAIN`, `PREVIEW_BASE=https://${BRANCH}--${REPO}--${OWNER}.aem.page`, `TENANT_ID=${BRANCH}--${REPO}--${OWNER}`, `WORKER_URL=${OF1_GENWEB_URL:-https://of1-gen-web-service.franklin-prod.workers.dev}`, `PREVIEW_HOST=${BRANCH}--${REPO}--${OWNER}.aem.page`; fails (returns 1, stderr `FAIL: cannot read $OF1_STATE_DIR/repo-config.json`) when the file or a required field (owner, repo, branch) is missing; `cd "$OF1_DEMO_REPO"` is NOT done here.

- [ ] Step 1: tests in `lib/env.test.mjs` (temp state dir with repo-config.json; asserts every exported var value; `OF1_GENWEB_URL` override; missing file returns 1 with the message; missing `branch` returns 1).
- [ ] Step 2: run, expect FAIL; implement; run, expect PASS.
- [ ] Step 3: `git add lib && git commit -m "feat(lib): env loader for skill scripts"`.

### Task 2: `of1-publish`

**Files:** Modify `skills/of1-publish/SKILL.md`; Create `skills/of1-publish/scripts/{common.sh,01-assert-git-config.sh,02-refresh-of1-page.sh,02b-index-overrides.sh,03-push-config.sh,03b-wait-config.sh,04-sync.sh,05-status.sh,06-da-listings.sh,07-hub.sh,checks.sh,finish.sh}`, `skills/of1-publish/scripts/publish.test.mjs`.

**Interfaces:** `common.sh` (sourced by every script) loads env (`of1_load_env`), resolves the token (`lib/da-token.sh`), `cd "$OF1_DEMO_REPO"`, defines `HUB="$OF1_STATE_DIR/hub"`, `ALLOWED`, `GATED_FLAGS`, `write_publish_status`, `publish_hub` (verbatim from the current Process block), and sets `N_CHECKS`. Step scripts are the current numbered sections moved verbatim; `checks.sh <1..7|all>` runs the Pre-Launch Checklist checks (7 only when `OF1_CTA_TEMPLATE=1`); `finish.sh done|failed <summary>` writes the final status and regenerates+commits the hub. Step 2 (`02-refresh-of1-page.sh`) executes the Upload block of `of1-style-generative-block` through that skill's new script from Task 5; until Task 5 lands it keeps the current instruction text in a comment-free stub that calls `bash "$SKILL_DIR/../of1-style-generative-block/scripts/upload-of1-page.sh"` (created in Task 5; Task 2's test stubs it).

- [ ] Step 1: write `publish.test.mjs`: (a) `02b-index-overrides.sh` against a fake `curl` on PATH and a temp git repo with `of1/config/config.json`: cases (index covers both -> config unchanged and stale `templates.names` removed; index lacks templates and DA listing returns two html docs -> `templates.names` set sorted; DA listing HTTP 403 -> exit 1 with the token message; daPath without `/` -> warning and names untouched; user-set `contentIngestion.indexPath` untouched); (b) `01-assert-git-config.sh` fails listing an extra tracked `of1/config/personas.json`, passes with only `config.json`, requires `cta-template.json` only when `OF1_CTA_TEMPLATE=1`; (c) `checks.sh 2` and `checks.sh 3` pass/fail on fixture `hub/sync.json`/`hub/status.json` (indexed 0 fails; errors with only `{warning}` entries pass; not ready fails naming the gated flag); (d) `bash -n` of every script.
- [ ] Step 2: run, expect FAIL. Step 3: implement by moving the bash blocks verbatim; rewrite SKILL.md to <=150 lines. Step 4: run the full suite.
- [ ] Step 5: `git add skills/of1-publish && git commit -m "refactor(of1-publish): move step bash into tested scripts"`.

### Task 3: `of1-check-dependencies`

**Files:** Modify `skills/of1-check-dependencies/SKILL.md`; Create `skills/of1-check-dependencies/scripts/{01-reset-state.sh,02-domain.sh,03b-legacy-config.sh,04-code-sync.sh,05-aem-preview-auth.sh,06-hlxignore.sh,07-config-json.sh,08-helix-query.sh,09-repo-config.sh}` and `scripts/setup.test.mjs`.

**Interfaces:** each script is one current step (numbers kept: 1 reset, DOMAIN resolution, 3b, 4, 5, 6, 7, 8, 9), moved verbatim; they read `setup.json` via a small `00-load-setup.sh` (sourced; exports `OWNER REPO BRANCH REPO_DIR DA_TOKEN`, sets git no-prompt env, `cd "$REPO_DIR"`). `verify.sh` stays as is. The interactive questions (legacy removal, domain) stay in SKILL.md prose, which then passes the decision to the script via `OF1_NON_INTERACTIVE`/an explicit argument (`03b-legacy-config.sh remove|keep`).

- [ ] Step 1: `setup.test.mjs` with temp git repo + bare remote + fake curl: `06-hlxignore.sh` removes an `of1/config` exclusion and commits/pushes, leaves other lines; `07-config-json.sh` writes `{ "domain": "<d>" }` and commits only that file; `08-helix-query.sh` creates the file when absent, leaves an existing customer file untouched and warns when `/templates/` missing, skips when `SKIP_HELIX_QUERY=1`; `03b-legacy-config.sh remove` removes exactly the legacy tracked files and keeps `config.json` (and `cta-template.json` only when `OF1_CTA_TEMPLATE=1`); `09-repo-config.sh` writes the documented fields; `02-domain.sh` order: env, repo-config, content-source, fstab host, non-interactive failure message.
- [ ] Step 2-5 as Task 2 (verbatim move, SKILL.md <=150 lines, full suite, commit `refactor(of1-check-dependencies): ...`).

### Task 4: `of1-extract-content` and `of1-extract-brand-voice` and `of1-build-quick-suggestions`

**Files:** Modify the three SKILL.md; Create `skills/of1-extract-content/scripts/{common.sh,discover-urls.sh,capture-pages.sh,publish-knowledge.sh}`, `skills/of1-extract-brand-voice/scripts/{common.sh,pick-pages.sh,write-doc.sh}`, `skills/of1-build-quick-suggestions/scripts/{common.sh,write-sheet.sh}`, tests `scripts/extract.test.mjs` in the first.

**Interfaces:** `common.sh` per skill = env/token/`SOURCE_BASE` resolution (verbatim from the current top block, incl. `OF1_CONTENT_SOURCE`). `capture-pages.sh` runs the playwright batch loop verbatim (writes `$OF1_STATE_DIR/knowledge-pages.json`); `publish-knowledge.sh` runs the three node steps of Step 8 verbatim; persona/chip row writing stays model-authored JSON followed by `node da-write.mjs` (documented in SKILL.md as one command each).

- [ ] Step 1: tests: `discover-urls.sh` with a fake curl returning a sitemap JSON and a nav fragment: excludes `/drafts|/fragments|/of1|/templates|/nav|/footer`, always prepends the home URL, caps at 20; `common.sh` sets `SOURCE_BASE` from `OF1_CONTENT_SOURCE` else the preview host; `bash -n` all.
- [ ] Step 2-5 as Task 2 (commit `refactor: move content/brand-voice/suggestions bash into scripts`).

### Task 5: `of1-style-generative-block` and `of1-build-templates` and `of1-extract-design` and `of1-build-cta-template`

**Files:** Modify the four SKILL.md; Create `skills/of1-style-generative-block/scripts/{install-block.sh,upload-of1-page.sh,verify-live.sh,commit-block.sh}`, `skills/of1-build-templates/scripts/{preview-all.sh,verify-richness.sh,commit-block-code.sh}`, `skills/of1-extract-design/scripts/{verify-outputs.sh,commit-design.sh}`, `skills/of1-style-generative-block/scripts/style.test.mjs`.

**Interfaces:** `upload-of1-page.sh` is the current Step 5 + 5b bash (PUT the `/of1` doc incl. landing rows from `of1-landing.json`, preview, gate) and is what `of1-publish` step 2 runs; `install-block.sh` = Step 0 copy; `verify-live.sh` = Step 7/7b playwright checks; `preview-all.sh` / `verify-richness.sh` = `assemble` phase steps 1 and 3 (`template_docs` function inside); the CTA skill is prose only (no script needed, stays <=150).

- [ ] Step 1: tests: `install-block.sh` copies `of1.js`/`of1.css` fresh over stale ones; `upload-of1-page.sh` with a fake curl (records PUT body): body contains the `engine` row and `title/subtitle/placeholder` rows from a fixture `of1-landing.json` (HTML-escaped), omits them when the file is absent, exits 1 on a PUT status 500 and on a plain.html lacking `engine`; `verify-richness.sh` warns for an exploratory doc with 2 blocks and aborts for 0 blocks (fake curl serving `.plain.html`).
- [ ] Step 2-5 as Task 2 (commit `refactor: move style/templates/design bash into scripts`).

### Task 6: size gate and verification

**Files:** Create `lib/size.test.mjs`.

- [ ] Step 1: `size.test.mjs` asserts every `skills/*/SKILL.md` has <= 200 lines and no fenced bash block longer than 25 lines.
- [ ] Step 2: full suite + `bash -n` + `node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <fresh capture>` (empty) + `rg -n "OF1_PIPELINE_MODE|slicc" skills lib` (empty). Update CHANGELOG (0.3.0 "SKILL.md slimmed; step bash lives in scripts/").
- [ ] Step 3: commit; push `feat/skills-driver`. A full lab run (same procedure as before) is the final acceptance.
