# of1-skills cleanup: self-contained integration plugin

Date: 2026-10-09
Status: approved, plan 1 in progress

## Intent

`of1-skills` integrates OF1 into an **existing** EDS site. It is a self-contained
plugin: one entry skill, `of1-integration`, that runs its own step graph.
`of1-demo-skills` (migration + integration) treats `of1-skills` as an opaque
dependency and calls `of1-integration` once, the same way it calls
`stardust:replica`. It does not dispatch individual `of1-skills` skills and does
not read `of1-skills` internals.

Claude Code is the only supported runtime. SLICC support is dropped.

Success criteria:

1. A run of `/of1-integration` on a test site produces the same DA docs, git files and
   worker `/status` as today (golden baseline, stage 1).
2. `of1-skills` contains no reference to any `of1-demo-skills` file, no `OF1_PIPELINE_MODE`,
   no SLICC code path.
3. The cross-repo interface is exactly the three inputs and one result file below.
4. Shared logic (DA token, DA client, git push, playwright helper) exists once, with tests.
5. Each SKILL.md is a short procedure; long bash lives in tested scripts.

## Out of scope (separate specs)

- `of1-demo-skills` cleanup: call `of1-integration` once, drop Stage 3 dispatch,
  `dispatch-*.md`, the sprinkle template and dual-runtime text, remove stale audit files
  and README. Depends on stage 5 here; both repos release together.
- `of1-gen-web-service`: index/publish `/templates` so publish step 2b no longer has to
  write `templates.names` (stage 7 below only removes the workaround once the worker
  fix is live).

## Findings this addresses

From the 2026-10-09 audit of `of1-skills` main (`f11d738`) and `of1-demo-skills` origin/main:

- Unresolved references to `of1-demo-orchestrator/knowledge/*` and a stale
  `of1-demo/knowledge/common-pitfalls.md` path.
- `OF1_PIPELINE_MODE`, `OF1_CONTENT_SOURCE`, `OF1_STAGE2_DONE_FILE` coupling; `of1-integration`
  is a spec the caller must dispatch by hand.
- `verify.sh` demo-track skills check disagrees with check-dependencies SKILL.md.
- `$DOMAIN` is never derived in the standalone path; `OF1_DEMO_REPO` default is a SLICC path.
- Duplication: DA token probe in 6 skills, rebase+push block 11 times, `pw()` per skill,
  token resolution re-implemented in 4 scripts.
- Dead code: legacy `products.json` logic in `download-images.mjs`; stale Stage 2a/2c,
  "replica", "snowflake" wording; `step-3-output.md` reference.
- Wrong docs: `cta-template.json` is consumed by the gen-web worker (`/api/personalize`
  `inject_cta`), not by the extension or edge proxy.
- 7 worktrees and 16 branches; four specs/six plans with no status; no `AGENTS.md`;
  plugin version `0.1.0`, no changelog.
- Test gaps: `verify.sh`, `ensure-nav-footer.mjs`, `fill-brand-review.mjs`,
  `download-images.mjs`, and all bash embedded in SKILL.md.

## The cross-repo interface

### Inputs (replace `OF1_PIPELINE_MODE`)

Three arguments to `/of1-integration`; the driver exports them once as env vars so
no other skill parses arguments.

| Argument | Env var | Default | Effect |
|---|---|---|---|
| `content-source=<domain>` | `OF1_CONTENT_SOURCE` | unset | `of1-extract-brand-voice` / `of1-extract-content` crawl `https://<domain>`. Unset: crawl the site's own preview URL. |
| `non-interactive` | `OF1_NON_INTERACTIVE` | off | No skill asks questions: overwrite `/of1/brand-voice`, remove legacy `of1/config/*.json`, skip confirmation steps. |
| `cta-template` | `OF1_CTA_TEMPLATE` | off | Run `of1-build-cta-template`, commit `of1/config/cta-template.json`, enable publish check 7. |

Always required, not new: `OF1_DEMO_REPO` (absolute path to the EDS repo, derived from
cwd when unset) and a DA token (`ADOBE_IMS_TOKEN` or `OF1_TOKEN_FILE`).

`DOMAIN` is derived by `of1-check-dependencies` (from `content-source`, else the repo's
production domain from `fstab`/README/user prompt) and written to `config.json`.

### Result

`of1-integration` ends by writing `$OF1_STATE_DIR/of1-integration-result.json`:

```json
{ "status": "done|review|failed", "summary": "...",
  "deliverables": [{ "url": "...", "label": "..." }],
  "checks": { "passed": 6, "total": 6 } }
```

This is the only thing a caller reads. Per-skill `of1-*-status.json` files remain an
internal detail used by the demo hub.

### Removed from the interface

`OF1_PIPELINE_MODE`, `OF1_STAGE2_DONE_FILE` (the caller simply invokes `of1-integration`
after its own Stage 2 finishes), `repo-config.json` / `setup.json` as a caller-visible
contract, and all `of1-demo-orchestrator/*` references.

## Stages

Each stage is its own PR, verified against the stage 1 baseline.

1. **Baseline.** Run `/of1-integration` on a throwaway test site; store the DA docs,
   git file list, `/status` JSON and a `/api/generate` sample under `docs/baseline/`
   (text only). Add a script that diffs a new run against it.
2. **Hygiene.** Remove the Restart feature (check-dependencies step 3: DA/git wipe, the
   Continue/Restart prompt and in-progress detection); every run is idempotent and only
   overwrites OF1-owned paths. Delete dead `download-images.mjs` product logic; remove stale stage
   wording and the `step-3-output.md` reference; fix or remove the `of1-demo/` path;
   correct the `cta-template` consumer docs. Remove local worktrees and merged
   branches (list approved first). Add `Status:` headers to old specs/plans. Add
   `AGENTS.md`, `docs/README.md` index, `CHANGELOG.md`; bump plugin version.
3. **Drop SLICC.** Remove `oauth-token` shim, `/workspace` paths, scoop/sprinkle text,
   runtime detection in `verify.sh`, default `OF1_DEMO_REPO`/`OF1_STATE_DIR`
   (state dir defaults to `$PWD/.of1/state`).
4. **Shared library.** Add `lib/`: `da-token.sh` (resolve + probe), `git-push.sh`
   (pull --rebase --autostash, abort on conflict, never force), `pw.sh` (playwright
   from the state dir), and `da-client.mjs` (token, multipart upload, preview, live)
   used by `da-write`, `publish-knowledge-da`, `download-images`, `ensure-nav-footer`.
   Skills source `lib/` by a path relative to the plugin root. Add tests for `lib/`,
   `verify.sh` and the untested scripts.
5. **Contract and driver.** Implement the inputs and result above; remove
   `OF1_PIPELINE_MODE` everywhere; `of1-integration` runs the step graph itself using
   Claude Code subagents (parallel fan-out as today); make `verify.sh` and its doc agree
   (base skills only); derive `DOMAIN`. Released together with the matching
   `of1-demo-skills` change.
6. **Slim SKILL.md.** Move embedded bash (template assemble, publish checks and index
   overrides, extract-content capture, check-dependencies reset) into scripts under each
   skill's `scripts/`, with tests. SKILL.md keeps the procedure, inputs and outputs.
   Target: no SKILL.md over about 150 lines.
7. **Worker follow-up.** After the gen-web-service template fix is live, drop publish
   step 2b's `templates.names` handling. Not started until that fix ships.

## Risks

- No end-to-end test exists today. Mitigation: stage 1 baseline plus a diff script, run
  after every stage.
- Stage 5 is a breaking change for `of1-demo-skills`. Mitigation: ship both PRs together
  and test the demo flow once before merge.
- Removing Restart drops the only way to wipe OF1 DA content from this plugin. A
  full wipe of throwaway demo repos stays the job of `of1-demo-skills`.
- Branch and worktree removal is destructive; the list is shown and approved first.

## Open questions

None blocking. The `DOMAIN` derivation in stage 5 (fstab/README/prompt) is to be
confirmed against a real site when implementing.
