---
name: of1-integration
description: "Introduce OF1 onto an existing EDS/Stardust site — reuses whatever design tokens/blocks/pages already exist instead of crawling an external domain or pixel-cloning. Driver skill: run it from a top-level context. Claude Code only."
user-invocable: true
---

# OF1 Integration — Introduce OF1 on an Existing EDS/Stardust Site

For sites that already have EDS blocks, content pages, and (usually) Stardust design tokens. Produces only the OF1-specific layer: templates, the `/of1` page, and tenant config.

**Run this skill from a top-level context.** It is a driver: it dispatches the other skills as
subagents, and a subagent cannot dispatch subagents. If you are yourself a subagent, stop and
tell the caller to run `of1-integration` at top level.

## 1. Arguments and environment

Invocation: `/of1-integration [content-source=<domain>] [non-interactive] [cta-template]`

| Argument | Env var exported | Effect |
|---|---|---|
| `content-source=<domain>` | `OF1_CONTENT_SOURCE=<domain>` | brand-voice/content skills crawl `https://<domain>`; unset = the site's own preview URL |
| `non-interactive` | `OF1_NON_INTERACTIVE=1` | no skill asks anything: overwrite `/of1/brand-voice`, remove legacy `of1/config/*.json`, skip confirmations |
| `cta-template` | `OF1_CTA_TEMPLATE=1` | also run `of1-build-cta-template`, commit `of1/config/cta-template.json`, enable publish check 7 |

Parse the arguments, then export (these are the **same env vars every dispatch gets**):

```bash
# Set the three flags from the parsed arguments, e.g.:
#   export OF1_CONTENT_SOURCE=frescopa.coffee OF1_NON_INTERACTIVE=1 OF1_CTA_TEMPLATE=1
# OF1_DEMO_REPO: absolute path to the EDS repo (git toplevel of the cwd when unset).
if [ -z "${OF1_DEMO_REPO:-}" ]; then
  OF1_DEMO_REPO=$(git rev-parse --show-toplevel 2>/dev/null) || OF1_DEMO_REPO=""
fi
export OF1_DEMO_REPO
export OF1_STATE_DIR="${OF1_STATE_DIR:-$PWD/.of1/state}"
mkdir -p "$OF1_STATE_DIR"
```

If `OF1_DEMO_REPO` is still empty (not inside a git repo): when `OF1_NON_INTERACTIVE=1` write the
result file with `failed` (see "Result file") and stop; otherwise ask once via `AskUserQuestion`
for the local path to the EDS repo.

A DA token (`ADOBE_IMS_TOKEN` or `OF1_TOKEN_FILE`) must be available; `of1-check-dependencies` verifies it.

**Per-skill env and `SKILL_DIR`.** Every skill requires `SKILL_DIR` = its own directory. For a skill
of this plugin that is the base directory the Skill tool reports when you load it (the plugin's
`skills/<name>/`). Each time you run or dispatch a skill, export `SKILL_DIR` for *that* skill
(not the driver's) alongside the vars above.

## 2. Verify dependencies + repo state (inline)

Invoke the `of1-check-dependencies` skill with the Skill tool (not an Agent dispatch — this step is light and must run in your own context to read the verified state; export `SKILL_DIR` for it first). If it fails, surface the exact error, write the result file with `failed`, and stop.

After it succeeds, read `$OF1_STATE_DIR/setup.json` for `stateDir`/`of1Repo` and `$OF1_STATE_DIR/repo-config.json` for `owner`/`repo`/`branch`/`domain`. Use these for all subsequent steps.

## 3. Artifact detection (inline)

```bash
cd "$OF1_DEMO_REPO"
# Resolve DESIGN.json via the shared resolver: stardust/current/DESIGN.json. See
# of1-integration/knowledge/design-tokens-resolution.md
HAS_DESIGN_JSON=false
[ -f stardust/current/DESIGN.json ] && HAS_DESIGN_JSON=true
echo "DESIGN.json present: $HAS_DESIGN_JSON"
```

If `HAS_DESIGN_JSON=false`, the extraction step runs the `of1-extract-design` skill (inline via
the Skill tool) against the site's own EDS preview URL
(`https://<branch>--<repo>--<owner>.aem.page`) to produce `stardust/current/DESIGN.json` (plus
`DESIGN.md`, screenshots, and `deliverables/brand-review.html`). If `true`, the extraction step
is skipped entirely — of1-integration reports the extraction step's status as `"done"` either
way. (`of1-extract-design` ends with status `review`; the driver treats that as approved and continues.)

## 4. Run the graph (step graph)

This is the single ordering authority for the whole skill. Three steps run **inline** in the
driver's own context — `of1-check-dependencies`, artifact detection, and `of1-publish`
(each documented in its own section below); every other step is **dispatched** as an
Agent (see "## Dispatch"). The graph nodes and the Trigger table are authoritative — the prose
sections describe *what each step does*, not a competing order.

```
of1-check-dependencies (setup) → artifact detection (inline)
              │
       [DESIGN.json exists?]
         no → extraction (of1-extract-design against the site's own preview URL)
         yes → skip (of1-integration reuses the existing spec and reports done)
              │
   ┌──────────┼───────────────┬───────────────────┬──────────────────┐
   ↓          ↓               ↓                   ↓                  ↓
of1-build-      of1-style-    of1-extract-      of1-extract-    of1-build-
templates(base) generative-   brand-voice       content         cta-template
              block           (DA /of1/         (knowledge       [ONLY when
   ↓          (styling)        brand-voice)      pages → state    OF1_CTA_TEMPLATE=1]
of1-build-templates(intent-       │              + DA /of1/            │
  comparison ∥ …-recommendation   │              knowledge/**,         │
  ∥ …-deep-dive ∥ …-budget        │              DA personas sheet)    │
  ∥ …-discovery)                  └────────┬────────┘                  │
   ↓                                       ↓                           │
of1-build-templates(assemble)    of1-build-quick-suggestions           │
   │                             (needs knowledge pages + personas     │
   │                              + brand voice; writes DA             │
   │                              suggestions sheet + landing copy)    │
   │                                       │                           │
   └──────────────┬────────────────────────┴───────────────────────────┘
                  ↓
   of1-publish (inline — needs of1-build-templates(assemble)
     + of1-style-generative-block + of1-build-quick-suggestions
     [+ of1-build-cta-template when OF1_CTA_TEMPLATE=1])
```

`of1-build-templates`(base), `of1-style-generative-block`, `of1-extract-brand-voice` and `of1-extract-content` (plus `of1-build-cta-template` **only when `OF1_CTA_TEMPLATE=1`**) all dispatch in the SAME message, in parallel, as soon as the extraction step returns `done` (whether it ran or was skipped) — siblings, not sequential tracks. `of1-style-generative-block` has no dependency on `of1-build-templates` at all; it only appears in the same fan-out because both become eligible at the same trigger. `of1-build-quick-suggestions` waits for `of1-extract-brand-voice` + `of1-extract-content`. `of1-publish` waits for `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-build-quick-suggestions` (+ `of1-build-cta-template` when `OF1_CTA_TEMPLATE=1`). There is no separate config review step: authored config (brand voice, personas, chips, landing copy, templates, knowledge pages) lives in DA and is reviewed/edited there — the demo hub links each item.

| Trigger (ALL must be done) | Dispatch in one message |
|---|---|
| `of1-check-dependencies` done | Artifact detection (inline, immediate) |
| Artifact detection done | extraction step |
| Extraction done (ran or skipped) | `of1-build-templates`(base) AND `of1-style-generative-block` AND `of1-extract-brand-voice` AND `of1-extract-content` (4 dispatches in one message) — **plus `of1-build-cta-template` only when `OF1_CTA_TEMPLATE=1`** (5 dispatches) |
| `of1-build-templates`(base) done | `of1-build-templates`(intent-comparison…intent-discovery) (5 intent dispatches in one message) |
| `of1-build-templates`(intent-*) all done | `of1-build-templates`(assemble) (1 dispatch, sequential) |
| `of1-extract-brand-voice` + `of1-extract-content` done | `of1-build-quick-suggestions` (needs the knowledge pages in `$OF1_STATE_DIR/knowledge-pages.json` + the personas from `of1-extract-content` + the brand voice from `of1-extract-brand-voice`) |
| `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-build-quick-suggestions` ALL done (+ `of1-build-cta-template` when `OF1_CTA_TEMPLATE=1`) | `of1-publish` (inline) |

**`of1-style-generative-block` (OF1 styling) does NOT wait for `of1-build-templates`** — per `of1-style-generative-block`'s own dependency table (fixed in Task 2), it only needs `of1-check-dependencies`' block install context and the repo's existing chrome (`content/nav.html`/`content/footer.html`, already present since this is an existing EDS site) — dispatch it alongside `of1-build-templates`(base). It may finish before `of1-build-quick-suggestions` has written the landing copy; `of1-publish` re-runs its Step 5 (the idempotent `/of1` DA write) so the `/of1` block always carries the `title`/`subtitle`/`placeholder` rows.



## Dispatch

The driver (you, at top level) dispatches every non-inline skill itself.

- Use **TaskCreate** with one task per skill/phase (`of1-check-dependencies`, extraction, `of1-build-templates`(base), `of1-build-templates`(intent-*), `of1-build-templates`(assemble), `of1-style-generative-block`, `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template` (only when `OF1_CTA_TEMPLATE=1`), `of1-publish`). Mark the `of1-check-dependencies` task completed immediately; mark each task `in_progress`/`completed`/`failed` around its dispatch.
- Each skill (except artifact detection and `of1-publish`, which are inline) is a single `Agent` dispatch. Sub-agents see none of this conversation — the prompt must be self-contained:
  - tell it to **read the skill's `SKILL.md`** (path: `<skill base dir>/SKILL.md`) and follow it;
  - export the same env vars the driver exports (`OF1_STATE_DIR`, `OF1_DEMO_REPO`, `OF1_CONTENT_SOURCE`, `OF1_NON_INTERACTIVE`, `OF1_CTA_TEMPLATE` — only those that are set — and `ADOBE_IMS_TOKEN`/`OF1_TOKEN_FILE`) **plus `SKILL_DIR` set to that skill's own directory** (e.g. `export SKILL_DIR=<skill base dir>`);
  - state the branch/owner/repo, list which prior-skill output files it needs;
  - require a final JSON status block: `{"stage":3,"skill":"<skill>","status":"done"|"review"|"failed","summary":"...","deliverables":[...]}`. Each skill also writes its own `$OF1_STATE_DIR/<skill>-status.json`.
- **The extraction step runs the `of1-extract-design` skill** (via the `Skill` tool) targeting the site's own EDS preview URL — do not point it at any external domain, and do not run it at all if `HAS_DESIGN_JSON=true`.
- **Parallelism is mandatory** at each fan-out point — dispatch all eligible skills in a single message with multiple Agent tool-use blocks.
- Model assignment: Opus only where output quality cascades downstream: `of1-style-generative-block` (multi-step DA authoring) and `of1-extract-design` when it actually runs (design-token quality cascades). Everything else (`sonnet`): `of1-build-templates`(base), `of1-build-templates`(intent-*), `of1-build-templates`(assemble), `of1-extract-brand-voice`, `of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`.
- Auto-approve by default — mark each `review`-status task completed and continue immediately, unless the user explicitly asked to pause between steps.
- If any dispatched skill returns `failed`, stop dispatching new work, let in-flight siblings finish, and go to "Result file" with `failed`.

## 5. Deploy — `of1-publish` (inline)

Once `of1-build-templates`(assemble) + `of1-style-generative-block` + `of1-build-quick-suggestions` (+ `of1-build-cta-template` when `OF1_CTA_TEMPLATE=1`) are all done, run the `of1-publish` skill inline with the Skill tool (export `SKILL_DIR` to its base directory first). With `OF1_CTA_TEMPLATE` off there is no `cta-template.json` requirement and check 7 is skipped. Its pre-launch checklist is self-contained; follow it as written.

## 6. Result file (always, also on failure)

Always finish by writing `$OF1_STATE_DIR/of1-integration-result.json` — this is the one file a calling skill needs. Use `assets/write-result.mjs` (in this skill's directory):

```bash
node "$SKILL_DIR/assets/write-result.mjs" --state-dir "$OF1_STATE_DIR" \
  --status done|review|failed --summary "<one line>" \
  --deliverable "<url>=<label>" ... --checks <passed>/<total>
```

- `done`: every skill `done` and all `of1-publish` checks passed (`--checks 6/6`, or `7/7` with `cta-template`); deliverables come from `$OF1_STATE_DIR/of1-publish-status.json` (`.deliverables[]`: `url`, `label`).
- `review`: finished but something needs a human look (e.g. a skill returned `review` that you could not auto-approve, or a non-gating check failed); pass the actual `passed/total`.
- `failed`: any skill failed or you had to stop; the summary names the failing skill and reason. Run it on every failure path (dependencies, dispatch, publish) — never exit without it. Here `SKILL_DIR` is the `of1-integration` skill's own base directory.

The per-skill `$OF1_STATE_DIR/<skill>-status.json` files are written by the skills themselves; the driver writes no other status file.

## Author-facing re-sync (Sync OF1 DA app)

After deploy, author edits in DA (`/of1/brand-voice`, `/of1/config/personas`, `/of1/config/suggestions`, `/of1/strategy`, `/templates/*`, `/of1/knowledge/*`) only reach the worker on a **preview + sync**. The **Sync OF1** DA app gives authors a one-click sync from inside the DA editor. It is **not** part of this run (no dispatch, no gate) — it's a one-time manual site setup: add one row to the site's DA `library` sheet pointing at the worker's `/da-app`. Full install + usage: `knowledge/da-sync-app.md`.
