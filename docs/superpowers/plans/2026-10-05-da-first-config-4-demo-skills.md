# DA-first config — Plan 4/4: of1-demo-skills Implementation Plan

Status: Historical

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The demo orchestrator dispatches the new Stage-3 graph (no `config-review`, CTA pipeline-only, hub kept) and owns the optional full wipe for throwaway repos.

**Architecture:** Docs-only change in `of1-demo-skills`; the orchestrator already defers to `of1-integration`'s graph but hard-codes skill names in four places — align those.

**Tech Stack:** Markdown skills. No test runner in this repo; verification is grep + one pipeline-mode run (Plan 3 Task 7 Step 4).

**Spec:** `of1-skills/docs/superpowers/specs/2026-10-05-da-first-config-design.md`

## Global Constraints

- Land together with Plan 3 (same release); branch `feat/da-first-config`.
- `of1-build-cta-template` stays dispatched (pipeline mode); `config-review` no longer exists anywhere.
- Full wipe is allowed **only** in this orchestrator, only for repos it provisioned, only on explicit "Restart".

## Review Focus

- SLICC sprinkle sub-step map still contains a `config` key → UI shows a step that never completes. Covered by Task 1 grep.
- Orchestrator audit (`pipeline-audit.json`) records for removed `config-review` → hub renders a stale row. Covered by Task 1 (contract example update).
- Restart wipe accidentally run against a customer repo via `of1-integration` standalone → must be impossible: wipe step lives only in the orchestrator and checks `OF1_PIPELINE_MODE=1`. Covered by Task 2.

---

### Task 1: Align Stage-3 references

**Files:**
- Modify: `skills/of1-demo-orchestrator/SKILL.md:82-131,150`
- Modify: `skills/of1-demo-orchestrator/knowledge/pipeline-contract.md:46,138,170,239-240,256`
- Modify: `skills/of1-demo-orchestrator/knowledge/dispatch-cc.md:13-24,70-73,171-172,200`
- Modify: `skills/of1-demo-orchestrator/knowledge/dispatch-slicc.md:203-207,230-240,263,312`
- Modify: `skills/of1-demo-orchestrator/knowledge/common-pitfalls.md:79,105,133`

- [ ] **Step 1:** Replace every `→ config-review →` / `config-review` task/sub-step with nothing (graph: `of1-build-templates`(assemble) ∥ `of1-style-generative-block` ∥ `of1-build-quick-suggestions` ∥ `of1-build-cta-template` → `of1-publish`). Remove `config-review)  KEY=config ;;` from the SLICC map. Keep `of1-build-cta-template) KEY=cta ;;`.
- [ ] **Step 2:** `pipeline-contract.md:256` and `SKILL.md:150` → point to the rewritten `worker-config-schemas.md` ("DA-first config: what lives in git vs DA"). `dispatch-slicc.md:263` → check DA sheets/state files instead of `ls of1/config/`. `common-pitfalls.md:79,105` → use `deliverables/index.html` as the example; `:133` → `git add templates/ styles/ fragments/ of1/config/config.json`.
- [ ] **Step 3: Verify:** `grep -rn "config-review\|knowledge.json\|personas.json\|of1/config/\*" skills/` → no hits.
- [ ] **Step 4: Commit** `docs(orchestrator): Stage-3 graph without config-review; DA-first config`

### Task 2: Orchestrator-owned full wipe (throwaway repos)

**Files:**
- Modify: `skills/of1-demo-orchestrator/SKILL.md` (setup section near L55 "continue/restart")

- [ ] **Step 1:** Add "Restart a provisioned demo repo" step, run by the orchestrator **before** dispatching `of1-check-dependencies`, only when `OF1_PIPELINE_MODE=1` and the user chose Restart: move the former clean-slate block here verbatim from `of1-skills` git history (`git show main:skills/of1-check-dependencies/SKILL.md` §3), prefixed with a guard `[ "$OF1_PIPELINE_MODE" = "1" ] || { echo "refusing full wipe outside the demo pipeline" >&2; exit 1; }`.
- [ ] **Step 2: Verify:** `grep -n "rm -rf" skills/of1-demo-orchestrator/SKILL.md` → exactly the guarded block.
- [ ] **Step 3: Commit** `feat(orchestrator): own the full wipe for throwaway demo repos`; push; open PR, link Plan 3's PR.
