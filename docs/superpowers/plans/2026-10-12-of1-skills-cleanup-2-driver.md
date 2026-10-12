# of1-skills cleanup, plan 2: drop SLICC, shared library, integration driver (spec stages 3-5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `of1-skills` Claude-Code-only, move duplicated shell/JS into one tested `lib/`, and turn `of1-integration` into a runnable driver with three explicit inputs and one result file, without changing what a run writes to git, DA or the worker.

**Architecture:** `lib/` at the plugin root holds `da-token.sh`, `git-push.sh`, `pw.sh` (sourced by skills via `"$SKILL_DIR/../../lib/<file>"`) and `da-client.mjs` (imported by the four scripts that talk to DA). `of1-integration/SKILL.md` becomes the driver procedure: resolve inputs, export env vars, run the existing step graph with Claude Code subagents, write `of1-integration-result.json`. `docs/contract.md` states the progress contract and a node test enforces it.

**Tech Stack:** bash, jq, Node 23 (`node:test`, global `fetch`), Claude Code skills.

**Spec:** `docs/superpowers/specs/2026-10-09-of1-skills-cleanup-design.md` (stages 3, 4, 5 and its Progress contract). Stage 6 is a separate plan.

## Global Constraints

- Branch `feat/skills-driver` (based on `spec/lab-contract`, which carries PR #13). Do not push to `main`.
- No change to what an integration writes: git (`blocks/of1/`, `of1/config/config.json`, `deliverables/index.html`, plus `of1/config/cta-template.json` only when `cta-template` is on), DA docs/sheets, worker config. After each task `node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs lib/*.test.mjs` passes and `bash -n` is clean on every `.sh`.
- Status-file names and fields stay exactly as the spec's Progress contract: `$OF1_STATE_DIR/<skill>-status.json` with `status` and `skill`; the ten skill names are unchanged; `of1-build-templates` phase files keep their `-base-`/`-intent-` basenames; `deliverables/index.html` stays.
- Inputs (spec): `content-source=<domain>` -> `OF1_CONTENT_SOURCE`; `non-interactive` -> `OF1_NON_INTERACTIVE=1`; `cta-template` -> `OF1_CTA_TEMPLATE=1`. `OF1_PIPELINE_MODE` and `OF1_STAGE2_DONE_FILE` disappear from every file in this repo.
- The skills name no calling harness (no "lab", "of1-labs", "of1-demo-orchestrator", "of1-demo-skills" in skills/ or docs/contract.md). They may say "caller".
- Never force-push; commit only files a task names (`git commit -- <paths>`).

## Review Focus

- Interactive default: with no inputs set, check-dependencies and brand-voice still ask where they asked before. Pinned in Task 5 (grep test in the contract test: every `AskUserQuestion` site is guarded by `OF1_NON_INTERACTIVE`).
- `DOMAIN` resolution when nothing provides it and `non-interactive` is set must fail with a clear message, not write `"domain": ""`. Pinned in Task 5.
- `lib/git-push.sh` on a rebase conflict aborts the rebase, returns non-zero and never pushes. Pinned in Task 2.
- `lib/da-token.sh` with an expired token (401/403) fails fast with the existing hint text; unreachable DA (other status) only warns. Pinned in Task 2.
- cta-template off: publish check 7 is skipped and `cta-template.json` is not required; on: required. Pinned in Task 5.

---

### Task 1: Drop SLICC

**Files:**
- Modify: `skills/of1-check-dependencies/scripts/verify.sh`, `skills/of1-check-dependencies/SKILL.md`, `skills/of1-integration/SKILL.md` (only the `### SLICC` section and SLICC bullets), `skills/of1-extract-design/SKILL.md`, `skills/of1-build-templates/SKILL.md`, `skills/of1-build-quick-suggestions/SKILL.md`, `skills/of1-extract-brand-voice/SKILL.md`, `skills/of1-extract-content/SKILL.md`, `skills/of1-style-generative-block/SKILL.md`, `skills/of1-publish/SKILL.md`, `skills/of1-extract-content/assets/download-images.mjs`, `skills/of1-extract-content/assets/publish-knowledge-da.mjs`, `skills/of1-integration/assets/da-write.mjs`, `AGENTS.md`, `README.md`, `.claude-plugin/plugin.json` (`_notes`)
- Test: `skills/of1-check-dependencies/scripts/verify.test.mjs` (new, spawns verify.sh against a temp git repo)

**Interfaces:**
- Produces: `verify.sh` with no runtime detection; `OF1_STATE_DIR` defaults to `$PWD/.of1/state`; `OF1_DEMO_REPO` defaults to `git rev-parse --show-toplevel` of `$PWD` (error if not a git repo); skill search roots are `$HOME/.claude/plugins`, `$HOME/.claude/skills`, `$PWD/.claude/skills` and marketplace `installLocation`s. Token order everywhere becomes `ADOBE_IMS_TOKEN`, `OF1_TOKEN_FILE`, `$PWD/.hlx/.da-token.json`, `$OF1_DEMO_REPO/.hlx/.da-token.json` (the `oauth-token adobe` step and `/workspace` paths are removed).

- [ ] **Step 1: Write failing test** `verify.test.mjs`: create a temp dir with `git init`, a minimal EDS layout (`scripts/aem.js`, `scripts/scripts.js`, `styles/styles.css`) and a fake `HOME` with the ten skills as `$HOME/.claude/skills/<name>/SKILL.md`; run `bash verify.sh` with `OF1_STATE_DIR` unset, cwd = that repo, `ADOBE_IMS_TOKEN=x`, a PATH stub dir providing `node python3 jq git curl playwright-cli`. Assert: exit 0, `<repo>/.of1/state/setup.json` exists with `of1Repo` equal to the repo, stdout contains no `Runtime:` line. Second case: run with cwd outside any git repo and `OF1_DEMO_REPO` unset: exit 1 and stderr/stdout names `OF1_DEMO_REPO`. Third: `rg -n -i "slicc|/workspace/|oauth-token|upskill|sprinkle|scoop"` over `skills/ README.md AGENTS.md .claude-plugin` (excluding the baseline docs and `docs/`) returns nothing (assert via `spawnSync("rg", ...)` status 1).
- [ ] **Step 2: Run** `node --test skills/of1-check-dependencies/scripts/verify.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `verify.sh`: delete runtime detection and `fix_cmd`'s SLICC branch (fix hint is always the Claude Code command), the SLICC `upskill` auto-install, the `/workspace/skills` root, python3 JSON escaping (use `jq -Rn`), the "SLICC git shim" comments, and the default `/workspace/of1-demo-orchestrator`/`/shared/of1-demo-orchestrator` values. Keep writing `of1-check-dependencies-status.json`. In every other listed file delete SLICC sentences, `### SLICC` blocks, `oauth-token` fallbacks and "SLICC IPC" comments (keep the status-file writes; rename comments to "progress file"). Remove the `of1-demo-orchestrator`/`of1-discovery`/`of1-prototype`/`of1-snowflake` demo-track skill list from `verify.sh` and SKILL.md (base skills only).
- [ ] **Step 4: Run** the new test plus the full suite and `bash -n`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "refactor: drop SLICC runtime support (Claude Code only)" -- <changed paths>`.

### Task 2: Shared `lib/` shell helpers

**Files:**
- Create: `lib/da-token.sh`, `lib/git-push.sh`, `lib/pw.sh`, `lib/lib.test.mjs`

**Interfaces (all sourced, no `set -e`, safe in bash and zsh):**
- `da-token.sh` defines `da_resolve_token` (prints the token, empty/non-zero if none; order ADOBE_IMS_TOKEN, OF1_TOKEN_FILE, `$PWD/.hlx/.da-token.json`, `$OF1_DEMO_REPO/.hlx/.da-token.json`) and `da_probe_token <owner> <repo> <token>` (GET `https://admin.da.live/list/<owner>/<repo>` with `--connect-timeout 10 --max-time 20`; 200 -> 0; 401/403 -> prints `FAIL: DA token expired or invalid (IMS tokens last ~3h) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE` to stderr, returns 1; other -> prints a `WARN:` to stderr, returns 0). `DA_BASE` env (default `https://admin.da.live`) overrides the host for tests.
- `git-push.sh` defines `git_push_rebased <branch>`: `git pull --rebase --autostash -q origin <branch>`; on failure `git rebase --abort`, print the existing message `✗ FAIL: git pull --rebase origin <branch> failed (conflict with the remote) — rebase aborted, nothing pushed. Resolve manually (git pull --rebase origin <branch>), then re-run. Never force-push.` to stderr and return 1 without pushing; else `git push origin <branch>`.
- `pw.sh` defines `pw` (runs `playwright-cli "$@"` inside a subshell cd'd to `$OF1_STATE_DIR`) and `pw_result` (prints only the `### Result` section: `awk '/^### Result/{f=1;next} /^### /{f=0} f'`).

- [ ] **Step 1: Write failing tests** in `lib.test.mjs` (spawn `bash -c 'source lib/x.sh; ...'`): `da_resolve_token` precedence (env beats file; file JSON `{"access_token":"t"}`); `da_probe_token` against a local `http.createServer` returning 200 (rc 0), 401 (rc 1, stderr has `expired or invalid`), 500 (rc 0, stderr has `WARN`) using `DA_BASE=http://127.0.0.1:<port>`; `git_push_rebased` with a bare remote and two clones: clean case pushes, conflicting case returns 1, stderr has `rebase aborted`, and the remote head is unchanged and the clone has no `.git/rebase-merge`; `pw_result` filters a sample report to the lines under `### Result`.
- [ ] **Step 2: Run** `node --test lib/lib.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files per the Interfaces block.
- [ ] **Step 4: Run** `node --test lib/lib.test.mjs && bash -n lib/*.sh`. Expected: pass.
- [ ] **Step 5: Commit** `git add lib && git commit -m "feat(lib): shared da-token, git-push and playwright helpers (tested)"`.

### Task 3: Replace the shell duplicates with `lib/`

**Files:**
- Modify: `skills/of1-extract-design/SKILL.md`, `skills/of1-build-templates/SKILL.md`, `skills/of1-extract-brand-voice/SKILL.md`, `skills/of1-extract-content/SKILL.md`, `skills/of1-build-quick-suggestions/SKILL.md`, `skills/of1-style-generative-block/SKILL.md`, `skills/of1-publish/SKILL.md`, `skills/of1-check-dependencies/SKILL.md`
- Test: `lib/skills-use-lib.test.mjs`

**Interfaces:**
- Consumes: Task 2 helpers. Each skill sources them with `LIB="$SKILL_DIR/../../lib"; . "$LIB/da-token.sh"` (and the others it needs). `SKILL_DIR` is already exported by the caller.

- [ ] **Step 1: Write failing test:** over `skills/*/SKILL.md` assert none contains `DA_PROBE=`, a `git pull --rebase --autostash` line, or a `pw() {` definition; and that every skill that needs them contains `. "$LIB/da-token.sh"` / `git_push_rebased` / `. "$LIB/pw.sh"` respectively (list per skill: da-token in brand-voice, extract-content, quick-suggestions, build-templates, style-generative-block, publish; git-push in extract-design, build-templates, style-generative-block, publish, check-dependencies; pw in extract-content, style-generative-block, publish).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement:** replace each inline token-resolve+probe block with `DA_TOKEN=$(da_resolve_token) || { echo "FAIL: no DA token ..." >&2; exit 1; }; da_probe_token "$OWNER" "$REPO" "$DA_TOKEN" || exit 1`; each pull-rebase-push group with `git_push_rebased "$BRANCH"`; each `pw`/`pw_result` definition with the source line. Keep surrounding text and any step-specific logic. Do not change commit messages or `git add` scopes.
- [ ] **Step 4: Run** the new test, the full suite, `bash -n` on extracted blocks is not needed. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "refactor(skills): use lib/ for DA token, git push and playwright helpers" -- <paths>`.

### Task 4: One DA client for the four scripts

**Files:**
- Create: `lib/da-client.mjs`, `lib/da-client.test.mjs`
- Modify: `skills/of1-integration/assets/da-write.mjs`, `skills/of1-extract-content/assets/publish-knowledge-da.mjs`, `skills/of1-extract-content/assets/download-images.mjs`, `skills/of1-style-generative-block/assets/ensure-nav-footer.mjs`

**Interfaces:**
- Produces (exports of `lib/da-client.mjs`): `resolveToken(opts?: { tokenFile?: string }): Promise<string>` (order: `tokenFile`, `DA_TOKEN`, `ADOBE_IMS_TOKEN`, `OF1_TOKEN_FILE`, `./.hlx/.da-token.json`, `$OF1_DEMO_REPO/.hlx/.da-token.json`; JSON files read `access_token`; throws `Could not resolve DA token...`), `buildMultipart(content: string|Buffer, filename: string, contentType: string): { body: Buffer, contentType: string }`, `daUpload({ owner, repo, path, content, contentType, token, fetchImpl? }): Promise<string|null>` (null on 2xx, else `FAIL upload <path> HTTP <status>`, with `TOKEN_HINT` appended on 401/403), `aemAction({ action: 'preview'|'live', owner, repo, branch, path, token, fetchImpl? }): Promise<string|null>` (POST `https://admin.hlx.page/<action>/<owner>/<repo>/<branch>/<path>` with both `Authorization` and `x-content-source-authorization`), `TOKEN_HINT`.
- The four scripts import from `../../../lib/da-client.mjs` (relative to `skills/<skill>/assets/`). Their public CLIs, exports used by existing tests (`buildSheetJson`, `writeDa`, `renderContentDoc`, `hashSrc`, `slugify`, `resolveSlug`, `parseArgs`, `buildMultipart`, `TOKEN_HINT`, `resolveToken` from `da-write.mjs`) keep working: re-export from `da-write.mjs` what its test imports.

- [ ] **Step 1: Write failing tests** `da-client.test.mjs`: `resolveToken` precedence with a temp token file; `buildMultipart` has the boundary header and both CRLF delimiters; `daUpload` with a fake `fetchImpl` returns null on 200 and the `FAIL upload ... HTTP 401 — DA token expired or invalid` string on 401; `aemAction` sends both auth headers and the expected URL for `live`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `da-client.mjs` by lifting the logic from `da-write.mjs`; refactor `da-write.mjs` (`writeDa`), `publish-knowledge-da.mjs` (`uploadDoc`, `triggerPreview`, `triggerLive`), `download-images.mjs` (token + the DA upload/preview calls), `ensure-nav-footer.mjs` (token + upload/preview) onto it. Keep the `--token-file` option behaviour of the two scripts that have it.
- [ ] **Step 4: Run** `node --test skills/*/assets/*.test.mjs lib/*.test.mjs scripts/baseline/*.test.mjs`. Expected: all pass (existing da-write and publish-knowledge tests unchanged apart from import paths).
- [ ] **Step 5: Commit** `git commit -m "refactor: one DA client (token, upload, preview/live) for the four DA scripts" -- <paths>`.

### Task 5: Driver, inputs, contract and result file

**Files:**
- Modify: `skills/of1-integration/SKILL.md` (rewrite as the driver), `skills/of1-check-dependencies/SKILL.md` and `scripts/verify.sh` (DOMAIN resolution, remove demo-track skills and pipeline-mode text), `skills/of1-extract-brand-voice/SKILL.md`, `skills/of1-extract-content/SKILL.md`, `skills/of1-build-quick-suggestions/SKILL.md`, `skills/of1-build-templates/SKILL.md`, `skills/of1-style-generative-block/SKILL.md`, `skills/of1-build-cta-template/SKILL.md`, `skills/of1-publish/SKILL.md`, `skills/of1-integration/knowledge/worker-config-schemas.md`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` (version `0.3.0`)
- Create: `docs/contract.md`, `lib/contract.test.mjs`, `skills/of1-integration/assets/write-result.mjs`, `skills/of1-integration/assets/write-result.test.mjs`

**Interfaces:**
- `write-result.mjs` CLI: `node write-result.mjs --state-dir <dir> --status done|review|failed --summary <text> [--deliverable <url>=<label> ...] [--checks <passed>/<total>]`; writes `<dir>/of1-integration-result.json` `{status, summary, deliverables:[{url,label}], checks:{passed,total}}`. Exports `buildResult(args): object`.
- Driver SKILL.md (`of1-integration`) procedure, in order: (1) parse arguments `content-source=<domain>`, `non-interactive`, `cta-template` and export `OF1_CONTENT_SOURCE`, `OF1_NON_INTERACTIVE=1`, `OF1_CTA_TEMPLATE=1`, `OF1_DEMO_REPO` (git toplevel if unset), `OF1_STATE_DIR` (default `$PWD/.of1/state`); (2) run `of1-check-dependencies` inline (Skill tool); (3) artifact detection and `of1-extract-design` if no `DESIGN.json`; (4) fan out in ONE message `of1-build-templates`(base), `of1-style-generative-block`, `of1-extract-brand-voice`, `of1-extract-content` (+ `of1-build-cta-template` only when `OF1_CTA_TEMPLATE=1`), then the existing dependent steps and `of1-publish` inline, exactly the current graph and gating text minus pipeline-mode/Stage-2 timing; (5) always finish by running `write-result.mjs` (done/review/failed) — also on failure. Every dispatch prompt exports the same env vars, requires the same final JSON status block, and uses Claude Code model hints already in the file. States that the driver must be run from a top-level context (a subagent cannot dispatch subagents).
- `OF1_NON_INTERACTIVE=1`: `AskUserQuestion` call sites (brand-voice overwrite, legacy-config removal, confirmation/summary steps, driver repo prompt) are skipped with the non-interactive choice already documented (overwrite brand voice, remove legacy files, skip confirmations).
- `DOMAIN` in `of1-check-dependencies` Part 2: `DOMAIN` env, else `.domain` of an existing `$OF1_STATE_DIR/repo-config.json`, else `OF1_CONTENT_SOURCE`, else the production host found in the repo's `fstab.yaml`/README (first `https://` host that is not `aem.live|aem.page|hlx.*|github.com`), else ask (interactive) or `echo "FAIL: cannot determine DOMAIN — set DOMAIN or pass content-source=<domain>" >&2; exit 1` (non-interactive).
- `OF1_CTA_TEMPLATE` replaces every `OF1_PIPELINE_MODE=1` check: publish's `ALLOWED`/check 1/step 3/check 7/`N_CHECKS`, check-dependencies 3b `ALLOWED`, config-schema doc wording.
- `docs/contract.md`: the spec's Progress contract table verbatim, plus the inputs table and the result-file shape.

- [ ] **Step 1: Write failing tests.** `write-result.test.mjs`: `buildResult` shape for done with two deliverables and `--checks 6/6`; CLI writes the file; invalid `--status` exits non-zero. `contract.test.mjs` (reads files): (a) `rg`-style scan: no `OF1_PIPELINE_MODE`, `OF1_STAGE2_DONE_FILE`, `of1-demo-orchestrator`, `of1-demo-skills`, `of1-labs` in `skills/`, `docs/contract.md`, `README.md`, `AGENTS.md`, `lib/`; (b) every `AskUserQuestion` line in skills sits within 12 lines after a line containing `OF1_NON_INTERACTIVE` (or in the driver's argument parsing); (c) each of the ten skill names appears in `docs/contract.md`; each completion block's status file name `of1-<skill>-status.json` found in a SKILL.md equals `<that skill's dir name>-status.json` or one of the `of1-build-templates-(base|intent-*|…)` phase names; (d) `verify.sh` requires exactly the ten base skills (parse the array) and contains no `of1-demo-orchestrator|of1-discovery|of1-prototype|of1-snowflake`.
- [ ] **Step 2: Run** `node --test lib/contract.test.mjs skills/of1-integration/assets/write-result.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** all of the above (write `write-result.mjs`, rewrite the driver, replace pipeline-mode with the three inputs across the listed files, add `docs/contract.md`, DOMAIN resolution, bump version, CHANGELOG 0.3.0 "Breaking for callers": `OF1_PIPELINE_MODE`/`OF1_STAGE2_DONE_FILE` removed, call `of1-integration content-source=<domain> non-interactive cta-template`, result file).
- [ ] **Step 4: Run** the full suite + `bash -n` + `node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <fresh capture>` (empty). Expected: pass.
- [ ] **Step 5: Commit** in two commits: code+tests, then docs (`git commit -m ... -- <paths>`).

### Task 6: Verification and PR branch

- [ ] **Step 1:** `node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs lib/*.test.mjs skills/of1-check-dependencies/scripts/*.test.mjs` all pass; `bash -n` clean on `lib/*.sh skills/*/scripts/*.sh skills/*/assets/*.sh`.
- [ ] **Step 2:** `rg -n -i "slicc|OF1_PIPELINE_MODE|OF1_STAGE2_DONE_FILE|oauth-token" skills lib docs/contract.md README.md AGENTS.md` returns nothing.
- [ ] **Step 3:** push `feat/skills-driver` (stacked on PR #13's branch; PR base `chore/cleanup-hygiene` until #13 merges).

---

## Self-review notes

- Spec coverage: stage 3 -> Task 1; stage 4 -> Tasks 2-4 (the spec's "tests for verify.sh and the untested scripts" are covered for `verify.sh` in Task 1 and `ensure-nav-footer`/`download-images` indirectly via the client; `fill-brand-review.mjs` stays untested, deferred to the slimming plan); stage 5 -> Task 5 (inputs, result file, DOMAIN, verify.sh base-only, contract doc and test).
- Not in this plan: stage 6 (slim SKILL.md), the demo-skills and labs changes.
