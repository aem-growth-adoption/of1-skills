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
  1. The content track (`of1-extract-brand-voice`/`of1-extract-content`/`of1-build-quick-suggestions`)
     extracts from the real external domain — the orchestrator passes `OF1_CONTENT_SOURCE=<domain>`,
     which the content-track skills honor (see each skill's "Source resolution" section). OF1
     integration just forwards the env var to those dispatches.
  2. The site-integration track (`of1-build-templates`, `of1-style-generative-block`,
     `of1-build-cta-template`, `of1-generate-config-review`, `of1-publish`) does not start until
     Stage 2 has finished. The orchestrator passes `OF1_REPLICA_DONE_FILE=<path>`; adopt-site waits
     for that file to exist before dispatching the site-integration track. The content track
     (`of1-extract-brand-voice`/`of1-extract-content` → `of1-build-quick-suggestions`) runs
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

If `HAS_DESIGN_JSON=false`, the extraction step invokes `stardust:extract` directly against the site's own EDS preview URL (`https://<branch>--<repo>--<owner>.aem.page`) to produce `stardust/current/DESIGN.json` (plus `PRODUCT.md`, `DESIGN.md`, and screenshots). If `true`, the extraction step is skipped entirely — the artifact-detection check above already confirmed a spec exists, so there is nothing for `stardust:extract` to do; adopt-site reports the extraction step's status as `"done"` either way (extraction is stardust's — no of1 status file is written for the skip case), so downstream dependency checks don't need to special-case the skip.

`DESIGN.json` may carry `_provenance.mode: bounded-single` when produced by `stardust:replica`
in bounded (`--pages`) mode — this is fully valid input. OF1 integration consumes the tokens the same
way regardless of provenance; do NOT reject or re-extract on a bounded-single spec.

## Step graph

```
of1-check-dependencies (setup) → artifact detection (inline)
              │
       [DESIGN.json exists?]
         no → extraction (stardust:extract against the site's own preview URL)
         yes → skip (adopt-site reuses the existing spec and reports done)
              │
   ┌──────────┼───────────────┬───────────────────┬──────────────────┐
   ↓          ↓               ↓                   ↓                  ↓
of1-build-      of1-style-    of1-extract-      of1-extract-    of1-build-
templates(base) generative-   brand-voice       content         cta-template
              block                              │
   ↓          (styling)        └────────┬────────┘
of1-build-templates(intent-             ↓
  comparison ∥ …-recommendation  of1-build-quick-suggestions
  ∥ …-deep-dive ∥ …-budget       (needs of1-extract-brand-voice
  ∥ …-discovery)                  + of1-extract-content)
   ↓                                    │
of1-build-templates(assemble)           │
   │                                    │
   └──────────────┬─────────────────────┴────────────────┬────┘
                   ↓                                      │
   of1-generate-config-review (inline — needs of1-extract-brand-voice
     + of1-extract-content + of1-build-quick-suggestions + of1-build-cta-template)
                   ↓
   of1-publish (deploy — needs of1-build-templates(assemble)
     + of1-style-generative-block + of1-generate-config-review)
```

`of1-build-templates`(base), `of1-style-generative-block`, `of1-extract-brand-voice`, `of1-extract-content`, and `of1-build-cta-template` all dispatch in the SAME message, in parallel, as soon as the extraction step returns `done` (whether it ran or was skipped) — five siblings, not two sequential tracks. `of1-style-generative-block` has no dependency on `of1-build-templates` at all; it only appears in the same fan-out because both become eligible at the same trigger. `of1-build-quick-suggestions` waits for `of1-extract-brand-voice` + `of1-extract-content`. `of1-generate-config-review` waits for `of1-extract-brand-voice` + `of1-extract-content` + `of1-build-quick-suggestions` + `of1-build-cta-template`. `of1-publish` waits for `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-generate-config-review`.

| Trigger (ALL must be done) | Dispatch in one message |
|---|---|
| `of1-check-dependencies` done | Artifact detection (inline, immediate) |
| Artifact detection done | extraction step |
| Extraction done (ran or skipped) | `of1-build-templates`(base) AND `of1-style-generative-block` AND `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-cta-template` (5 dispatches in one message) |
| `of1-build-templates`(base) done | `of1-build-templates`(intent-comparison…intent-discovery) (5 intent dispatches in one message) |
| `of1-build-templates`(intent-*) all done | `of1-build-templates`(assemble) (1 dispatch, sequential) |
| `of1-extract-brand-voice` + `of1-extract-content` done | `of1-build-quick-suggestions` (needs products.json + brand-voice.json) |
| `of1-extract-brand-voice` + `of1-extract-content` + `of1-build-quick-suggestions` + `of1-build-cta-template` ALL done | `of1-generate-config-review` (inline — do NOT run until all four are confirmed done) |
| `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-generate-config-review` ALL done | `of1-publish` |

**`of1-style-generative-block` (OF1 styling) does NOT wait for `of1-build-templates`** — per `of1-style-generative-block`'s own dependency table (fixed in Task 2), it only needs `of1-check-dependencies`' block install context and the repo's existing chrome (`content/nav.html`/`content/footer.html`, already present since this is an existing EDS site) — dispatch it alongside `of1-build-templates`(base).

### Pipeline-mode timing (OF1_PIPELINE_MODE=1)

The step graph's DEPENDENCIES are unchanged; only the START GATE differs:

- **Content track — dispatch immediately on entry** (parallel with replica): `of1-extract-brand-voice`,
  `of1-extract-content` → `of1-build-quick-suggestions`.
  These need only the live external site (`OF1_CONTENT_SOURCE`) + the narrative focus.
- **Site-integration track — dispatch only after `OF1_REPLICA_DONE_FILE` exists**:
  `of1-build-templates`(base) → `of1-build-templates`(intent-*) → `of1-build-templates`(assemble) ∥
  `of1-style-generative-block` ∥ `of1-build-cta-template`, then `of1-generate-config-review` (needs
  `of1-extract-brand-voice`+`of1-extract-content`+`of1-build-quick-suggestions`+`of1-build-cta-template`),
  then `of1-publish`.

```bash
# Site-integration gate (pipeline mode only)
if [ -n "$OF1_PIPELINE_MODE" ]; then
  echo "Waiting for replica to finish: $OF1_REPLICA_DONE_FILE"
  # Event-driven on SLICC (scoop-notify) / sequential await on CC. Do NOT sleep-poll on SLICC.
  until [ -f "$OF1_REPLICA_DONE_FILE" ]; do :; done   # CC inline fallback only
fi
```

In standalone mode there is no replica and no gate — all five siblings (`of1-build-templates`(base),
`of1-style-generative-block`, `of1-extract-brand-voice`, `of1-extract-content`,
`of1-build-cta-template`) dispatch together exactly as the Trigger table above already says.

**Common mistakes to avoid** (same class of mistake `of1-demo-orchestrator` already warns about):
- Do NOT run `of1-generate-config-review` before ALL of `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template` return `done`.
- Do NOT run `of1-build-quick-suggestions` before BOTH `of1-extract-brand-voice` and `of1-extract-content` return — it needs products.json + brand-voice.json.
- Do NOT dispatch `of1-build-templates`(intent-*) agents before `of1-build-templates`(base) returns — they read its output.

## Dispatch

Same step-graph, same dependency rules on both runtimes. Only the invocation mechanism differs. **Neither runtime ever calls a sprinkle/scoop UI push (`sprinkle_send`) — there is no sprinkle for this skill.**

### Claude Code

**Who dispatches (both runtimes).** On **neither** runtime is this skill run as a single Stage-3 sub-dispatch that then fans out the Integrate skills — because on **both**, the nesting is capped: a Claude Code subagent has no Agent tool, and a SLICC scoop cannot spawn sub-scoops. So the **top-level `of1-demo-orchestrator`** (which detects its runtime and follows `knowledge/dispatch-cc.md` or `knowledge/dispatch-slicc.md`) dispatches the Integrate skills itself, reading this section as the **skill-definition + dependency reference**. Everything below describes *what each skill needs and how they're ordered* — the orchestrator is the dispatcher in both cases.

- The orchestrator uses **TaskCreate** with one task per skill/phase (`of1-check-dependencies`, extraction, `of1-build-templates`(base), `of1-build-templates`(intent-*), `of1-build-templates`(assemble), `of1-style-generative-block`, `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`, `of1-generate-config-review`, `of1-publish`). Mark the `of1-check-dependencies` task completed immediately; mark each task `in_progress`/`completed`/`failed` around its dispatch.
- Each skill (except artifact detection and `of1-generate-config-review`, which are inline) is a single `Agent` dispatch. Sub-agents see none of this conversation — the prompt must be self-contained: read the target skill's `SKILL.md`, export the same env vars the orchestrator exports (`OF1_STATE_DIR`, `OF1_DEMO_REPO`, `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`, `SKILL_DIR`), state the branch/owner/repo, list which prior-skill output files it needs, and require the same JSON status block: `{"stage":3,"skill":"<skill>","status":"done"|"review"|"failed","summary":"...","deliverables":[...]}`.
- **The extraction step's dispatch is a direct `stardust:extract` invocation targeting the site's own EDS preview URL (`https://<branch>--<repo>--<owner>.aem.page`)** — do not point it at any external domain, and do not run it at all if `HAS_DESIGN_JSON=true` from Phase 1.
- In pipeline mode also export `OF1_CONTENT_SOURCE` (to `of1-extract-brand-voice`/`of1-extract-content`/`of1-build-quick-suggestions` dispatches) and pass
  `OF1_REPLICA_DONE_FILE` to the orchestrator's own site-track gate (not to the skill agents).
- **Parallelism is mandatory** at each fan-out point — the top-level orchestrator dispatches all eligible skills in a single message with multiple Agent tool-use blocks. (This is possible precisely because the *top level* is dispatching; a Stage-3 subagent could not, hence the "who dispatches on CC" note above.)
- Model assignment: same rule of thumb the orchestrator uses — Opus only where output quality cascades downstream. Since this pipeline skips discovery/prototype entirely, the only Opus-worthy skills are `of1-style-generative-block` (OF1 styling — multi-step DA authoring) and the extraction step when it actually runs (design-token quality cascades). Everything else (`sonnet`): `of1-build-templates`(base), `of1-build-templates`(intent-*), `of1-build-templates`(assemble), `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`.
- Auto-approve by default (mirrors the orchestrator's one-shot mode) — mark each `review`-status task completed and continue immediately, unless the user explicitly asked to pause between steps.

### SLICC

**Same as CC, the top-level orchestrator (`of1-demo-orchestrator`) dispatches these skills** — a scoop cannot spawn sub-scoops, so this skill is the skill-definition reference, not a self-dispatching scoop. The orchestrator dispatches from its own cone.

- Dispatch each skill as a `scoop_scoop()` call with `writablePaths` covering `/scoops/<name>/`, `/shared/`, and the project repo path. **The extraction step's scoop invokes `stardust:extract` directly against the site's own EDS preview URL** — same reason as the Claude Code column: point it at the wrong target and extraction crawls an external domain instead of the site itself.
- In pipeline mode also export `OF1_CONTENT_SOURCE` (to `of1-extract-brand-voice`/`of1-extract-content`/`of1-build-quick-suggestions` dispatches) and pass
  `OF1_REPLICA_DONE_FILE` to the orchestrator's own site-track gate (not to the skill agents).
- Each scoop writes its own `/shared/of1-demo-orchestrator/of1-<skill>-status.json` on completion (phase scoops of `of1-build-templates` write `of1-build-templates-<phase>-status.json`), exactly like every skill already documents in its own "Completion" section — **do not** additionally push to a sprinkle. There is nothing listening for `sprinkle_send` on this skill.
- Handle completions event-driven, not via polling: end your turn after dispatching, and react when a scoop-completion notification arrives — read its status file, check if it unblocks the next dispatch per the table above, and dispatch the next batch.
- Model assignment: same as the Claude Code column above, using `claude-opus-4-8`/`claude-sonnet-5` model strings per `of1-demo-orchestrator`'s own convention.

## Config review — `of1-generate-config-review` (inline, no dispatch on either runtime)

Once `of1-extract-brand-voice` + `of1-extract-content` + `of1-build-quick-suggestions` + `of1-build-cta-template` are all done, run the `of1-generate-config-review` skill inline (read it and follow it directly — same as `of1-demo-orchestrator`'s config-review step). Export `SKILL_DIR` to that skill's directory first, exactly as the orchestrator does for a dispatched skill.

## Deploy — `of1-publish` (inline)

After `of1-generate-config-review` is approved AND `of1-build-templates`(assemble) + `of1-style-generative-block` are both done, run the `of1-publish` skill inline (read it and follow it directly — same as `of1-demo-orchestrator`'s deploy step). Export `SKILL_DIR` to that skill's directory first, exactly as the orchestrator does for a dispatched skill.

`of1-publish`'s pre-launch checklist is self-contained and already flow-aware — its Check 5 only asserts the discovery deliverable when `of1-discovery-output.md` exists (so it self-skips in this flow, where discovery never runs). Follow the skill's checklist as written; there is nothing to adapt here.
