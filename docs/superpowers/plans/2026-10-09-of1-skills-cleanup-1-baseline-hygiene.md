# of1-skills cleanup, plan 1: baseline and hygiene (spec stages 1-2)

Status: in progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a regression baseline of what `of1-integration` produces today, then remove dead code, the Restart feature, stale wording, stale branches/worktrees, and add the missing project docs, without changing what a run produces.

**Architecture:** A small Node CLI (`scripts/baseline/baseline.mjs`) reduces a live tenant to a structural "shape" JSON (counts, column names, block sequences, flags; never copy or volatile values) and diffs a new shape against a stored one. Every later task is verified by that diff plus `node --test`.

**Tech Stack:** Node 23 (`node:test`, global `fetch`), bash, jq. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-of1-skills-cleanup-design.md` (stages 1 and 2). Stages 3-7 get their own plans after this one ships.

## Global Constraints

- Claude Code is the only supported runtime, but SLICC text is **not** removed in this plan (stage 3). Do not touch `OF1_PIPELINE_MODE`, `OF1_CONTENT_SOURCE`, `OF1_STAGE2_DONE_FILE` handling (stage 5).
- No behaviour change to what `/of1-integration` writes to git, DA or the worker. The baseline diff must stay empty after every task.
- Never commit secrets, tokens, or `.hlx/`. Never force-push. Do not delete a branch or worktree before the user approves the list (Task 7).
- Commit only the files a task names (`git commit -- <paths>`), per the repo's existing convention.
- Work on branch `chore/cleanup-hygiene` created from `spec/cleanup-foundation`; open one PR for this plan.

## Review Focus

- Baseline capture against a tenant with a missing optional item (no `/of1/brand-voice`, no `cta-template`): the shape records `null`/`false`, it does not crash. Pinned in Task 1.
- Template docs whose `section-metadata` is absent: the shape records `intent: null`. Pinned in Task 1.
- `diff` between identical shapes exits 0 and prints nothing; a changed flag exits 1 and names the path. Pinned in Task 1.
- `download-images.mjs` called with the removed flags must fail loudly, not silently ignore them. Pinned in Task 4.
- A fresh run after Restart removal must still clear the previous run's `of1-*-status.json` (the hub reads them all). Pinned by the text change in Task 3 and checked by the grep in its verification step.

---

### Task 1: Baseline shape extractor and diff CLI

**Files:**
- Create: `scripts/baseline/baseline.mjs`
- Test: `scripts/baseline/baseline.test.mjs`

**Interfaces:**
- Produces (all exported from `baseline.mjs`):
  - `shapeOfConfig(cfg: object|null): { keys: string[], templateNames: number, hasIndexPath: boolean } | null`
  - `shapeOfSheet(json: object|null): { columns: string[], rows: number } | null` (columns from the first data row's keys, sorted)
  - `shapeOfTemplate(plainHtml: string|null): { blocks: string[], intent: string|null, minItems: number|null, maxItems: number|null } | null` (blocks = section-level `<div class="NAME">` wrappers in order, excluding `section-metadata`/`metadata`; metadata from `data-template-*` attributes)
  - `shapeOfOf1Page(plainHtml: string|null): { rows: string[] } | null` (row keys, in order, of the `of1` block)
  - `shapeOfBrandVoice(plainHtml: string|null): { headings: string[], listItems: number } | null`
  - `shapeOfStatus(status: object|null): { ready: boolean, flags: Record<string, boolean> } | null` (numeric flags such as `contentChunks` become `value > 0`)
  - `shapeOfGenerate(ndjson: string): { eventTypes: string[], sections: number, errors: number }` (eventTypes unique, sorted)
  - `diffShapes(a: object, b: object): string[]` (one line `path: before -> after` per leaf difference, sorted; empty array when equal)
  - `captureShape({ base: string, worker: string, tenantId: string, gitFiles: string[], fetchImpl?: typeof fetch }): Promise<object>`
- CLI: `node scripts/baseline/baseline.mjs capture --tenant <id> --repo-dir <path> [--worker <url>] --out <file>` and `node scripts/baseline/baseline.mjs diff <a.json> <b.json>` (exit 1 when `diffShapes` is non-empty; print its lines).

- [ ] **Step 1: Write failing tests** in `baseline.test.mjs` for each `shapeOf*`, `diffShapes` and `captureShape` (with a fake `fetchImpl` returning canned responses). Required assertions:
  - `shapeOfTemplate` on a doc with `<div class="hero">`, `<div class="cards">`, `<div class="section-metadata">` and a section carrying `data-template-intent="budget" data-template-max-items="4"` returns `blocks: ['hero','cards']`, `intent: 'budget'`, `maxItems: 4`, `minItems: null`.
  - `shapeOfTemplate` with no metadata returns `intent: null` (Review Focus).
  - `shapeOfStatus({ready:true, config:{hasTemplates:true, contentChunks:127, hasCtaTemplate:false}})` returns flags `{hasTemplates:true, contentChunks:true, hasCtaTemplate:false}`.
  - `shapeOfBrandVoice(null)`, `shapeOfConfig(null)`, `shapeOfSheet(null)` return `null` (Review Focus).
  - `shapeOfGenerate` over two `section` lines, one `suggestions`, one `done` returns `sections: 2, errors: 0`; over a stream with a `{"type":"error"}` line returns `errors: 1`; non-JSON lines are ignored.
  - `diffShapes({a:{b:1}}, {a:{b:2}})` returns `['a.b: 1 -> 2']`; identical inputs return `[]`.
  - `captureShape` with a fake fetch where `/of1/brand-voice.plain.html` is 404 yields `brandVoice: null` and does not throw.
- [ ] **Step 2: Run** `node --test scripts/baseline/baseline.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `baseline.mjs`. `captureShape` fetches, from `base = https://<tenantId>.aem.page`: `/of1/config/config.json`, `/of1.plain.html`, `/of1/brand-voice.plain.html`, `/of1/config/personas.json`, `/of1/config/suggestions.json`, each template named in `config.templates.names` (else those listed under `/templates/` in `/query-index.json`) at `/templates/<name>.plain.html`, and the count of `/of1/knowledge/` paths in `config.contentIngestion.indexPath` (default `/query-index.json`) `.data[].path`. From `worker`: `GET /api/tenants/<id>/status`, and `POST /api/generate` with `{domain:<id>, query:"show me your best products", followUp:false, context:{browsing:[],conversationHistory:[]}}`. A non-2xx or network failure on any optional item records `null` for it. `gitFiles` is stored sorted. Output keys: `config, of1Page, brandVoice, personas, suggestions, templates` (object keyed by name), `knowledgePages` (number), `status, generate, gitFiles`. Use regex, not a DOM library.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git add scripts/baseline && git commit -m "feat(baseline): structural shape capture + diff for integration output"`.

### Task 2: Capture the golden baseline

**Files:**
- Create: `docs/baseline/of1-site-da-first.shape.json`, `docs/baseline/README.md`
- Modify: none

**Interfaces:**
- Consumes: `baseline.mjs capture` from Task 1.
- Produces: the committed baseline every later task diffs against (`docs/baseline/of1-site-da-first.shape.json`).

- [ ] **Step 1: Capture** from the existing integrated tenant (public preview + prod worker, no credentials needed):
  `node scripts/baseline/baseline.mjs capture --tenant of1-da-first--of1-site--aem-growth-adoption --repo-dir ~/workspace/labs/of1-site-da-first --out docs/baseline/of1-site-da-first.shape.json`
  Expected: file written; open it and confirm `status.ready` is `true`, `templates` has 9 entries, `generate.sections >= 2`, `gitFiles` is exactly `blocks/of1/of1.css, blocks/of1/of1.js, deliverables/index.html, of1/config/config.json`.
- [ ] **Step 2: Write** `docs/baseline/README.md`: what the shape contains, that it records structure not content, the tenant it was taken from and the date, and the two commands (`capture`, `diff`) with "run after every stage; a non-empty diff needs an explanation in the PR".
- [ ] **Step 3: Verify idempotence.** Capture a second time to `/tmp/second.json`, then `node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json /tmp/second.json`. Expected: no output, exit 0. If it differs (e.g. LLM-dependent field), tighten `shapeOfGenerate`/`shapeOfStatus` in Task 1's file until stable, then re-capture.
- [ ] **Step 4: Commit** `git add docs/baseline && git commit -m "docs(baseline): golden shape of the of1-site-da-first integration"`.

### Task 3: Remove the Restart feature

**Files:**
- Modify: `skills/of1-check-dependencies/SKILL.md` (Part 2 preamble line ~72, steps 1, 2, 3, 3b; keep step numbers 4-9 as they are)
- Modify: `skills/of1-check-dependencies/scripts/verify.sh:16` (comment mentioning continue/restart)
- Modify: `skills/of1-integration/knowledge/worker-config-schemas.md:13` (remove the Restart sentence; keep the "one EDS repo per site" note)

**Interfaces:**
- Consumes: baseline diff (Task 2).
- Produces: check-dependencies Part 2 with no Continue/Restart prompt and no DA/git wipe. Other skills do not reference Restart (verified by grep, only `of1-style-generative-block/SKILL.md:97` "restart button" matches, which is unrelated).

- [ ] **Step 1: Edit** `of1-check-dependencies/SKILL.md`:
  - Step 1 becomes "Clear the previous run's local state": delete `$OF1_STATE_DIR/of1-*-status.json`, `discovery.html`, `of1-landing.json`, `personas-rows.json`, `suggestions-rows.json`, `knowledge-pages.json`, `brand-voice.html` and `$OF1_STATE_DIR/hub` (the existing "Local state" snippet from step 3, unchanged). Remove the `repo-config.json` in-progress detection, the `AskUserQuestion`, and "Continue/Restart".
  - Delete step 3 entirely (the DA `da_delete_tree` function, the `git rm` of `blocks/of1` and `of1/config`, and the customer-content warnings). Add one sentence under step 1: "Every run is idempotent and overwrites only OF1-owned paths; a full wipe of a throwaway demo repo is the caller's job."
  - Remove "Continue and Restart" wording at ~72 and ~227; remove the `Restart` bullets under step 2.
- [ ] **Step 2: Edit** `verify.sh:16` to drop the continue/restart phrase; edit `worker-config-schemas.md:13` as described.
- [ ] **Step 3: Verify.** `rg -n -i "restart" skills/of1-check-dependencies skills/of1-integration` returns nothing; `rg -n "da_delete_tree" skills` returns nothing; `bash -n skills/of1-check-dependencies/scripts/verify.sh` exits 0; the `of1-*-status.json` / `hub` reset commands still appear in check-dependencies SKILL.md (Review Focus).
- [ ] **Step 4: Commit** `git commit -m "refactor(check-dependencies): remove Restart (DA/git wipe + prompt); runs are idempotent" -- skills/of1-check-dependencies skills/of1-integration/knowledge/worker-config-schemas.md`.

### Task 4: Strip legacy products logic from `download-images.mjs`

**Files:**
- Modify: `skills/of1-extract-content/assets/download-images.mjs` (header comment lines 1-40, `parseArgs` lines 111-156, manifest derivation 326-338, `--update-products` block 385-400)
- Create: `skills/of1-extract-content/assets/download-images.test.mjs`

**Interfaces:**
- Produces: `download-images.mjs` accepts exactly `--input` (now required), `--owner`, `--repo`, `--branch`, `--output`, `--max-per-product`, `--workers`, `--token-file`, `--mount-dir`. Manifest shape `[{productId, urls}]` and the uploaded filename `product-<productId>-<n>.<ext>` are unchanged (they key the DA media names that `publish-knowledge-da.mjs --image-map` resolves). `--products-json` and `--update-products` are removed.

- [ ] **Step 1: Write failing tests** (run the script as a subprocess via `node:child_process.spawnSync`; the script runs `main()` on import, so no import):
  - `--owner o --repo r --branch b --products-json x` exits 1 and stderr contains `Unknown argument: --products-json`.
  - `--update-products` exits 1 and stderr contains `Unknown argument: --update-products`.
  - `--owner o --repo r --branch b` (no `--input`) exits 1 and stderr contains `--input`.
- [ ] **Step 2: Run** `node --test skills/of1-extract-content/assets/download-images.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the removal; rewrite the header usage text to the manifest-only form; update the "Required:" message to name `--input`. Leave `--mount-dir` and the SLICC shim for stage 3.
- [ ] **Step 4: Run** the new tests and the existing `build-image-manifest`/`publish-knowledge-da` tests: `node --test skills/of1-extract-content/assets/`. Expected: all pass.
- [ ] **Step 5: Commit** `git add skills/of1-extract-content/assets && git commit -m "refactor(extract-content): download-images is manifest-only (drop products.json mode)"`.

### Task 5: Fix stale wording and wrong docs

**Files:**
- Modify: `skills/of1-extract-design/SKILL.md` (lines ~43, 150 and the "Stage 2a" framing)
- Modify: `skills/of1-style-generative-block/assets/ensure-nav-footer.mjs` (header comment lines 6-14) and `skills/of1-style-generative-block/SKILL.md` (lines ~133, 150, 312)
- Modify: `skills/of1-build-cta-template/SKILL.md` (lines ~23, 58), `skills/of1-integration/knowledge/design-tokens-resolution.md` (lines 9, 19)
- Modify: `skills/of1-integration/knowledge/worker-config-schemas.md` (lines 21, 69), `README.md` (cta-template and personas consumer wording)

**Interfaces:**
- Consumes: nothing. Produces: docs that no longer cite `step-3-output.md`, `of1-demo/knowledge/...`, "Stage 2a/2b/2c", `of1-snowflake` or "replica" as skill names.

- [ ] **Step 1: Apply these exact replacements:**
  - `of1-extract-design`: drop the `step-3-output.md` bullet; change the `of1-demo/knowledge/common-pitfalls.md` pointer to describe the rules inline in one sentence (logo SVG must be complete, image paths must resolve on the EDS preview URL, use real image formats) instead of citing a file this plugin does not own; replace "Stage 2a of the prototype+snowflake pipeline" with "called by of1-integration when no DESIGN.json exists, or by a caller that wants design extraction first".
  - `ensure-nav-footer.mjs` and the style SKILL.md: replace "Stage 2c (of1-snowflake) authors them" with "the site (or the migration step before integration) normally provides them".
  - `of1-build-cta-template` and `design-tokens-resolution.md`: replace "replica/extraction stage" and "Stage 2a" with "the extraction step (`of1-extract-design` / `stardust:extract`)".
  - `worker-config-schemas.md` and `README.md`: state that `cta-template.json` is read by the gen-web worker (synced as `cta-template`, served via `/api/personalize` `inject_cta`), and that personas are read by the preview extension / edge proxy; keep "pipeline mode only" wording (it changes in stage 5).
- [ ] **Step 2: Verify.** `rg -n "step-3-output|of1-demo/knowledge|Stage 2[abc]|of1-snowflake" skills README.md` returns only `verify.sh` and `of1-check-dependencies/SKILL.md` (stage 3/5 own those). `node --test skills/*/assets/*.test.mjs` passes.
- [ ] **Step 3: Commit** `git commit -m "docs(skills): remove stale pipeline-stage wording, fix cta-template consumer docs" -- skills README.md`.

### Task 6: Project docs: AGENTS.md, docs index, changelog, version, spec status

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md` (symlink to `AGENTS.md`), `docs/README.md`, `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json` (version `0.1.0` -> `0.2.0`), the `Status:` header of each file in `docs/superpowers/specs/` and `docs/superpowers/plans/`

**Interfaces:**
- Produces: `AGENTS.md` covering what the repo is (self-contained integration plugin, `of1-demo-skills` is a caller), skill list, commands (`node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs`, `bash -n` on shell scripts), the baseline workflow, and conventions already used (scoped `git commit -- <paths>`, `git pull --rebase --autostash` before push, never force-push, never commit `of1/config/*.json` other than `config.json`).

- [ ] **Step 1: Write** `AGENTS.md` (under 80 lines), `docs/README.md` (table: doc, type, status, superseded-by), `CHANGELOG.md` (entries: 0.2.0 baseline tooling, Restart removed, download-images manifest-only, docs cleanup).
- [ ] **Step 2: Add `Status:` lines** (add the line after the title if absent): `2026-08-27-knowledge-only-*`, `2026-08-28-of1-knowledge-pages-to-rag`, `2026-09-07-of1-knowledge-pages-to-rag` -> `Superseded by 2026-10-05-da-first-config-design`; `2026-08-31-of1-build-templates-da-blocks-slots-migration` -> `Implemented`; `2026-10-05-da-first-config-*` -> `Implemented (PRs #11, #12)`. Before writing each, check the doc's first paragraph so the status is true; if unsure, write `Historical` and note it in the PR.
- [ ] **Step 3: Verify.** `jq -r .version .claude-plugin/plugin.json` prints `0.2.0`; `ls -l CLAUDE.md` shows the symlink; `rg -L "^Status:|\*\*Status:\*\*" docs/superpowers` returns nothing.
- [ ] **Step 4: Commit** `git add AGENTS.md CLAUDE.md docs CHANGELOG.md .claude-plugin/plugin.json && git commit -m "docs: add AGENTS.md, docs index, changelog; mark spec/plan status; bump to 0.2.0"`.

### Task 7: Prune worktrees and branches (user-approved)

**Files:** none (git refs and `.worktrees/` only).

- [ ] **Step 1: Show the user this list and wait for approval before deleting anything:**
  - Fully merged into `origin/main` (0 commits ahead), safe to delete locally: `docs/da-sync-app-knowledge`, `feat/knowledge-only-config`, `feat/knowledge-only-producer`, `feat/of1-knowledge-pages`, `feat/relocate-config-schema-contract`, `fix/hub-index-preview-url`, `fix/of1-page-engine-row`, `fix/skills-of1-site-run`, `knowledge-da-support`, `security-fix-image-ssrf`, `spec/da-first-config`. Remote copies of the same (where they exist): `docs/da-sync-app-knowledge`, `feat/knowledge-only-producer`, `feat/of1-knowledge-pages`, `feat/relocate-config-schema-contract`, `fix/skills-of1-site-run`, `spec/da-first-config`.
  - **Not merged, needs a decision:** `feat/knowledge-page-images` (15 commits ahead, worktree `ko-images`) and `feat/knowledge-pages-plus-da-blocks` (26 ahead, worktree `combined`). Likely superseded by squash-merged PRs #8/#9; check with `git log origin/main..<branch> --oneline` and a diff of the touched files before proposing deletion.
  - Worktrees (all clean): `combined`, `da-sync-knowledge`, `knowledge-pages`, `knowledge-producer`, `ko-images`, `relocate-schema`.
- [ ] **Step 2: After approval,** for each approved worktree `git worktree remove .worktrees/<name>`, then `git branch -d <branch>` (use `-D` only for the two unmerged ones and only if approved); delete approved remote branches with `git push origin --delete <branch>`.
- [ ] **Step 3: Verify.** `git worktree list` shows only the main checkout; `git branch` shows only kept branches. No commit needed.

### Task 8: Final verification and PR

- [ ] **Step 1: Run** `node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs`. Expected: all pass (57 existing + new). Run `for f in skills/*/scripts/*.sh skills/*/assets/*.sh; do bash -n "$f"; done`. Expected: no output.
- [ ] **Step 2: Re-capture and diff:** `node scripts/baseline/baseline.mjs capture --tenant of1-da-first--of1-site--aem-growth-adoption --repo-dir ~/workspace/labs/of1-site-da-first --out /tmp/after.json && node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json /tmp/after.json`. Expected: no output. (This plan does not change worker-side output, so it only proves the tooling and the tenant are stable; the real regression gate starts at stage 3 when a fresh integration run is compared.)
- [ ] **Step 3: Push the branch and open a PR** titled "chore: baseline tooling + hygiene (cleanup stages 1-2)" with the spec link and the list of removed items. Return the PR URL.

---

## Self-review notes

- Spec coverage: stage 1 -> Tasks 1-2; stage 2 -> Tasks 3-7 (Restart removal, download-images, stale wording and cta docs, `AGENTS.md`/index/changelog/version/status headers, branch and worktree pruning). The `of1-demo/` path fix and `step-3-output.md` are in Task 5.
- Not in this plan by design: SLICC removal (stage 3), shared library (4), driver/contract (5), SKILL.md slimming (6), template-publish workaround removal (7).
- Honest limit: the baseline captures an already-integrated tenant, so it proves output stability, not that a fresh run still produces it. A fresh golden run on a throwaway repo is needed before stage 3 (needs DA credentials; a human or the user's token).
