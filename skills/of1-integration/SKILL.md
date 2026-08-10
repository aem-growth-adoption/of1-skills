---
name: of1-integration
description: "Introduce OF1 onto an existing EDS/Stardust site — reuses whatever design tokens/blocks/pages already exist instead of crawling an external domain or pixel-cloning. Works on both Claude Code and SLICC; no sprinkle/scoop UI."
user-invocable: true
---

# OF1 Integration — Introduce OF1 on an Existing EDS/Stardust Site

For sites that already have EDS blocks, content pages, and (usually) Stardust design tokens. Produces only the OF1-specific layer: templates, the `/of1` page, and tenant config. Runs identically in spirit on Claude Code and SLICC — the dispatch mechanism differs (see "## Dispatch" below), but there is **no sprinkle UI and no `sprinkle_send` call on either runtime.**

## Entry

The user invokes you pointed at an existing EDS repo — e.g. "adopt OF1 onto this site" or "/of1-integration" from inside the repo. No domain crawl is needed; the site itself is the source of truth. If the repo isn't obvious from context, ask once via `AskUserQuestion` for the local path.

## Invocation mode

Two modes, decided by `OF1_PIPELINE_MODE`:

- **Standalone (default, `OF1_PIPELINE_MODE` unset):** everything below behaves exactly as
  documented today. Content is extracted from the existing EDS site's own preview URL.
- **Pipeline (`OF1_PIPELINE_MODE=1`):** invoked by the full demo orchestrator alongside a
  running `stardust:replica`. Two differences only:
  1. The content track (8a/8b/9) extracts from the real external domain — the orchestrator
     passes `OF1_CONTENT_SOURCE=<domain>`, which the content-track skills honor (see each
     skill's "Source resolution" section). OF1 integration just forwards the env var to those dispatches.
  2. The site-integration track (6, 7, 10, 11, 12) does not start until Stage 2 has finished.
     The orchestrator passes `OF1_REPLICA_DONE_FILE=<path>`; adopt-site waits for that file to
     exist before dispatching the site-integration track. The content track (8a/8b → 9) runs
     immediately, in parallel with the still-running replica.

## Phase 0 — Verify dependencies + repo state (inline)

Invoke the `of1-check-dependencies` skill exactly as `of1-demo-orchestrator` does (Skill tool on Claude Code; read + follow inline on SLICC — not Agent/scoop dispatch, this step is light and must run in your own context to read the verified state). If it fails, surface the exact error and stop.

After it succeeds, read `<STATE_DIR>/setup.json` for `stateDir`/`of1Repo` and `<STATE_DIR>/repo-config.json` for `owner`/`repo`/`branch`/`domain`. Use these for all subsequent steps.

## Phase 1 — Artifact detection (inline)

```bash
cd "$OF1_DEMO_REPO"
# Resolve DESIGN.json via the shared resolver: stardust/current/ (full replica)
# OR project root ./ (bounded-single replica). See
# of1-demo-orchestrator/knowledge/design-tokens-resolution.md
HAS_DESIGN_JSON=false
[ -f stardust/current/DESIGN.json ] || [ -f ./DESIGN.json ] && HAS_DESIGN_JSON=true
echo "DESIGN.json present: $HAS_DESIGN_JSON"
```

If `HAS_DESIGN_JSON=false`, Step 3 (extraction) invokes `stardust:extract` directly against the site's own EDS preview URL (`https://<branch>--<repo>--<owner>.aem.page`) to produce `stardust/current/DESIGN.json` (plus `PRODUCT.md`, `DESIGN.md`, and screenshots). If `true`, Step 3 is skipped entirely — the artifact-detection check above already confirmed a spec exists, so there is nothing for `stardust:extract` to do; adopt-site reuses the existing spec and writes `step-3-status.json` with `"status":"done"` either way, so downstream dependency checks don't need to special-case the skip.

`DESIGN.json` may carry `_provenance.mode: bounded-single` when produced by `stardust:replica`
in bounded (`--pages`) mode — this is fully valid input. OF1 integration consumes the tokens the same
way regardless of provenance; do NOT reject or re-extract on a bounded-single spec.

## Step graph

```
1 (setup) → artifact detection (inline)
              │
       [DESIGN.json exists?]
         no → 3 (extraction — invoke `stardust:extract` against the site's own preview URL)
         yes → skip (adopt-site reuses the existing spec and reports done)
              │
   ┌──────────┼───────────┬────────────┬────────────┐
   ↓          ↓           ↓            ↓            ↓
6-base        7          8a           8b           10
(templates) (styling)  (brand-voice)(content)   (CTA template)
   ↓                       └──────┬─────┘
6a ∥ 6b ∥ 6c ∥ 6d ∥ 6e             ↓
   ↓                     9 (suggestions — needs 8a + 8b)
6-assemble                         │
   │                               │
   └──────────────┬────────────────┴───────────┬────┘
                   ↓                            │
      11 (config review, inline — needs 8a + 8b + 9 + 10)
                   ↓
      12 (deploy — needs 6-assemble + 7 + 11)
```

Steps 6-base, 7, 8a, 8b, and 10 all dispatch in the SAME message, in parallel, as soon as step 3 returns `done` (whether it ran or was skipped) — five siblings, not two sequential tracks. Step 7 has no dependency on step 6 at all; it only appears in the same fan-out because both become eligible at the same trigger. Step 9 waits for 8a + 8b. Step 11 waits for 8a + 8b + 9 + 10. Step 12 waits for 6-assemble + 7 + 11.

| Trigger (ALL must be done) | Dispatch in one message |
|---|---|
| Step 1 done | Artifact detection (inline, immediate) |
| Artifact detection done | Step 3 |
| Step 3 done (ran or skipped) | Step 6-base AND Step 7 AND Steps 8a, 8b, 10 (5 dispatches in one message) |
| Step 6-base done | Steps 6a–6e (5 intent dispatches in one message) |
| Steps 6a–6e all done | Step 6-assemble (1 dispatch, sequential) |
| Steps 8a + 8b done | Step 9 (needs products.json + brand-voice.json) |
| Steps 8a + 8b + 9 + 10 ALL done | Step 11 (inline — do NOT run until all four are confirmed done) |
| Steps 6-assemble + 7 + 11 ALL done | Step 12 |

**Step 7 (OF1 styling) does NOT wait for step 6** — per `of1-style-generative-block`'s own dependency table (fixed in Task 2), it only needs step 1's block install context and the repo's existing chrome (`content/nav.html`/`content/footer.html`, already present since this is an existing EDS site) — dispatch it alongside step 6-base.

### Pipeline-mode timing (OF1_PIPELINE_MODE=1)

The step graph's DEPENDENCIES are unchanged; only the START GATE differs:

- **Content track — dispatch immediately on entry** (parallel with replica): 8a, 8b → 9.
  These need only the live external site (`OF1_CONTENT_SOURCE`) + the narrative focus.
- **Site-integration track — dispatch only after `OF1_REPLICA_DONE_FILE` exists**:
  6-base → 6a–6e → 6-assemble ∥ 7 ∥ 10, then 11 (needs 8a+8b+9+10), then 12.

```bash
# Site-integration gate (pipeline mode only)
if [ -n "$OF1_PIPELINE_MODE" ]; then
  echo "Waiting for replica to finish: $OF1_REPLICA_DONE_FILE"
  # Event-driven on SLICC (scoop-notify) / sequential await on CC. Do NOT sleep-poll on SLICC.
  until [ -f "$OF1_REPLICA_DONE_FILE" ]; do :; done   # CC inline fallback only
fi
```

In standalone mode there is no replica and no gate — all five siblings (6-base, 7, 8a, 8b, 10)
dispatch together exactly as the Trigger table above already says.

**Common mistakes to avoid** (same class of mistake `of1-demo-orchestrator` already warns about):
- Do NOT run Step 11 before ALL of 8a, 8b, 9, 10 return `done`.
- Do NOT run Step 9 before BOTH 8a and 8b return — it needs products.json + brand-voice.json.
- Do NOT dispatch step 6-intent agents before step 6-base returns — they read its output.

## Dispatch

Same step-graph, same dependency rules on both runtimes. Only the invocation mechanism differs. **Neither runtime ever calls a sprinkle/scoop UI push (`sprinkle_send`) — there is no sprinkle for this skill.**

### Claude Code

**Who dispatches (both runtimes).** On **neither** runtime is this skill run as a single Stage-3 sub-dispatch that then fans out steps 6–12 — because on **both**, the nesting is capped: a Claude Code subagent has no Agent tool, and a SLICC scoop cannot spawn sub-scoops. So the **top-level `of1-demo-orchestrator`** (which detects its runtime and follows `knowledge/dispatch-cc.md` or `knowledge/dispatch-slicc.md`) dispatches steps 6–12 itself, reading this section as the **step-definition + dependency reference**. Everything below describes *what each step needs and how they're ordered* — the orchestrator is the dispatcher in both cases.

- The orchestrator uses **TaskCreate** with one task per step (1, 3, 6-base, 6a–6e, 6-assemble, 7, 8a, 8b, 9, 10, 11, 12). Mark task 1 completed immediately; mark each task `in_progress`/`completed`/`failed` around its dispatch.
- Each step (except artifact detection and 11, which are inline) is a single `Agent` dispatch. Sub-agents see none of this conversation — the prompt must be self-contained: read the target step skill's `SKILL.md`, export the same env vars the orchestrator exports (`OF1_STATE_DIR`, `OF1_DEMO_REPO`, `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`, `SKILL_DIR`), state the branch/owner/repo, list which prior-step output files it needs, and require the same JSON status block: `{"step":N,"status":"done"|"review"|"failed","summary":"...","deliverables":[...]}`.
- **Step 3's dispatch is a direct `stardust:extract` invocation targeting the site's own EDS preview URL (`https://<branch>--<repo>--<owner>.aem.page`)** — do not point it at any external domain, and do not run it at all if `HAS_DESIGN_JSON=true` from Phase 1.
- In pipeline mode also export `OF1_CONTENT_SOURCE` (to 8a/8b/9 dispatches) and pass
  `OF1_REPLICA_DONE_FILE` to the orchestrator's own site-track gate (not to the step agents).
- **Parallelism is mandatory** at each fan-out point — the top-level orchestrator dispatches all eligible steps in a single message with multiple Agent tool-use blocks. (This is possible precisely because the *top level* is dispatching; a Stage-3 subagent could not, hence the "who dispatches on CC" note above.)
- Model assignment: same rule of thumb the orchestrator uses — Opus only where output quality cascades downstream. Since this pipeline skips discovery/prototype entirely, the only Opus-worthy step is 7 (OF1 styling — multi-step DA authoring) and 3 when it actually runs (extraction — design-token quality cascades). Everything else (`sonnet`): 6-base, 6a–6e, 6-assemble, 8a, 8b, 9, 10.
- Auto-approve by default (mirrors the orchestrator's one-shot mode) — mark each `review`-status task completed and continue immediately, unless the user explicitly asked to pause between steps.

### SLICC

**Same as CC, the top-level orchestrator (`of1-demo-orchestrator`) dispatches these steps** — a scoop cannot spawn sub-scoops, so this skill is the step-definition reference, not a self-dispatching scoop. The orchestrator dispatches from its own cone.

- Dispatch each step as a `scoop_scoop()` call with `writablePaths` covering `/scoops/<name>/`, `/shared/`, and the project repo path. **Step 3's scoop invokes `stardust:extract` directly against the site's own EDS preview URL** — same reason as the Claude Code column: point it at the wrong target and extraction crawls an external domain instead of the site itself.
- In pipeline mode also export `OF1_CONTENT_SOURCE` (to 8a/8b/9 dispatches) and pass
  `OF1_REPLICA_DONE_FILE` to the orchestrator's own site-track gate (not to the step agents).
- Each scoop writes its own `/shared/of1-demo-orchestrator/step-N-status.json` on completion, exactly like every step skill already documents in its own "Completion" section — **do not** additionally push to a sprinkle. There is nothing listening for `sprinkle_send` on this skill.
- Handle completions event-driven, not via polling: end your turn after dispatching, and react when a scoop-completion notification arrives — read its status file, check if it unblocks the next dispatch per the table above, and dispatch the next batch.
- Model assignment: same as the Claude Code column above, using `claude-opus-4-8`/`claude-sonnet-5` model strings per `of1-demo-orchestrator`'s own convention.

## Step 11 — Config review (inline, no dispatch on either runtime)

Identical to `of1-demo-orchestrator`'s Step 11 — run the `of1-generate-config-review` skill's fill script directly:

```bash
cd "$OF1_DEMO_REPO"
node "$SKILL_DIR_CONFIG_REVIEW/assets/fill-config-review.mjs" . "$DOMAIN"
git add deliverables/config-review.html
git commit -m "docs: config review page for $DOMAIN"
git push origin "$BRANCH"
```

(`$SKILL_DIR_CONFIG_REVIEW` = absolute path to the `of1-generate-config-review` skill directory.)

## Step 12 — Deploy (inline)

After step 11 is approved AND steps 6-assemble + 7 are both done, run the `of1-publish` skill inline (read it and follow it directly — same as `of1-demo-orchestrator`'s Step 12).

**Check 5 (deliverable URLs return 200) is already adopt-flow-aware:** it only asserts
`discovery.html` when `of1-discovery-output.md` exists, and discovery never runs in the adopt flow, so that
URL is skipped automatically — no manual edit needed. (`brand-review.html` is no longer asserted by
any path.) `/`, `/nav`, `/footer`, `/of1`, gallery, config-review, and the hub are asserted in both
flows and must all return 200.

Checks 1, 2, 3, 4, and 6 apply unchanged.
