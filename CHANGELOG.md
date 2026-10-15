# Changelog

## Unreleased (new tenant system)

- `lib/env.sh`: `TENANT_ID` is now `<owner>/<repo>` (lowercase); new `PROXY_HOST`/`PROXY_BASE` (`<branch>--<repo>--<owner>.of1.live`). `of1_sync <worker> <org/repo> <out> [stage=preview]` posts `/api/tenants/<org>/<repo>/sync?stage=<stage>&ref=<branch>`.

- `da-write.mjs live`: publishes a previewed path to the live index (`admin.hlx.page/live`). `07-config-json.sh` now writes the DA sheet `/of1/config/config` (`key,value`) instead of a git `config.json`; new `of1-build-cta-template/scripts/write-cta-template.sh` writes the `/of1/config/cta-template` sheet. Nothing under `of1/config/` is committed.
- `03b-legacy-config.sh` stops with exit 3 (`Legacy OF1 setup found: run of1-skills:of1-migrate`) when any `of1/config/*` is tracked; `06-hlxignore.sh` removed. `of1-publish` check 1 fails on any tracked `of1/config/*`; check 7 reads `hasCtaTemplate` from `hub/status.json`.
- `of1-publish` syncs both stages: `04-sync.sh` writes `hub/sync-preview.json`, `hub/sync-publish.json` (+ `sync.json` = preview); new `04b-publish-live.sh` (`OF1_PUBLISH_LIVE=1` / driver arg `publish-live`) publishes config sheets and pages live first. Check 2: preview strict, publish tolerates warnings/404s (401/403/5xx fail). `05-status.sh` uses `?stage=preview` (+ informational `status-publish.json`). Check 6 hits `prev--$PROXY_HOST` and `$PROXY_BASE` with `{id,index}`. `02b`/`03`/`03b` are config-sheet aware (no git commits of config). `/of1` block domain row writes `$TENANT_ID`; hub links the DA config sheet and shows both stages.

- Fix round: `of1-migrate` undoes the local removal commit when the push fails and treats config still on `origin/<branch>` as legacy; `02` mirrors gen-web `expandConfigSheet` (list keys comma-joined; arrays/null/`{}`/coercible strings/dotted keys fail naming the key); detached HEAD fails early; `batch.mjs` auto excludes forks/archived, needs `--yes` for `--no-dry-run`, keeps per-repo results in `--out`. `04b-publish-live.sh` treats 401/403/5xx probes as errors, writes `hub/publish-live.json`, exits non-zero; check 2 fails on it; check 6 live host is strict once the publish sync synced something.
- `of1-migrate` 03: rollback after a failed push never uses `--hard` (`reset --keep`, else restores only `of1/config`; revert by subject if HEAD moved) so local work survives; refuses ("pull first") when the config is gone locally but still on `origin/<branch>`. Check 6 live host is strict only when the publish sync synced something or indexed > 0.
- Docs: tenant id `org/repo`, config as DA sheets, stage-aware sync, `--tenant` baseline semantic (host label) documented in README, AGENTS.md, worker-config-schemas.md, da-sync-app.md, docs/README.md.
- New skill `of1-migrate` (`01-detect`, `02-config-to-da`, `04-sync`, `05-verify`, `03-remove-git-config`, `06-report`, `assets/batch.mjs`): moves git `of1/config/*` into DA sheets, syncs preview+publish with `ref=<current branch>`, runs checks 2/3/6 and only then removes the git config. Never merges branches or touches legacy gen-web tenants. `batch.mjs --org --repos <file|auto>` (default dry-run) lists per-repo status.

## 0.3.3

- Security: bearer/DA/AEM tokens no longer appear in curl's argument list (`ps`, `/proc/<pid>/cmdline`, xtrace). New shared `lib/curl-auth.sh` (`of1_curl_auth <TOKEN_VAR_NAME> <auth|auth+source> -- curl-args…`) feeds the `Authorization` (and `x-content-source-authorization`) headers through `curl -K -` on stdin; it takes the variable *name* so even a caller's `set -x` never shows the token, suspends xtrace inside, and refuses tokens outside `[A-Za-z0-9._~+/=-]+`.
- Converted: `da-api.sh` (`da_put`, `da_delete`, `da_list`, `aem_preview`; same signatures), `of1-publish/06-da-listings.sh`, `of1-style-generative-block/upload-of1-page.sh`, `of1-check-dependencies/05-aem-preview-auth.sh`. A guard test fails on `-H Authorization`, `--header`, `curl -u`, `curl -v`/`--trace` or `set -x` in any shell script.

## 0.3.2

- Fix: `of1-publish` sync works again after gen-web #69 made `POST /api/tenants/<id>/sync` require `Authorization: Bearer <token>`. `04-sync.sh` sends the DA token (resolution: `$DA_TOKEN`, `$ADOBE_IMS_TOKEN`, `$OF1_TOKEN_FILE`, `.hlx/.da-token.json`, `$OF1_DEMO_REPO/.hlx/.da-token.json`) through curl's stdin config (never in argv/`ps`, never written to `hub/`). A 401/403 or missing token yields a clear message and a valid `hub/sync.json` (`ok:false`); the script still never fails itself.
- `da_probe_token` also passes the token via stdin; `da_resolve_token` honours `$DA_TOKEN` first (parity with `lib/da-client.mjs`).
- Check 6 (`/api/generate`), check 7 (`/api/personalize`) and the baseline capture call the tenant's proxied host `https://<tenant-id>.of1.live/api/*` (edge-proxy passthrough adds the gen-web caller credential; ready for gen-web #77). Override: `OF1_GENERATE_BASE_URL`. Proxy 401/403/404 fails check 6; HTML/unreachable warns.
- `/api/tenants/<id>/status` stays unauthenticated and unchanged.

## 0.3.1

- Template names now come from the previewed DA sheet `/of1/config/template-list` (written by `of1-build-templates` assemble via `write-template-list.sh`); requires gen-web worker >= PR #65 (Adobe-AEM-Foundation/of1-gen-web-service#65).
- **Release order: deploy that worker to dev and prod BEFORE this plugin version reaches `main`.** `of1-publish` step 2b deletes a leftover `templates.names`; a worker without the sheet lookup then sees no templates (`ready: false`) until the config is restored.
- `of1-publish` step 2b no longer writes `templates.names` into `config.json` and removes a stale one (an override would hide the sheet). `contentIngestion.indexPath` handling is unchanged.
- Baseline `captureShape` enumerates templates from the sheet first (no change to the baseline shape keys).

## 0.3.0

- Dropped SLICC runtime support (Claude Code only); one DA client (`lib/da-client.mjs`) for the DA scripts; skills use `lib/` helpers.
- `of1-integration` is now a driver: three arguments (`content-source=<domain>`, `non-interactive`, `cta-template`) exported as `OF1_CONTENT_SOURCE`, `OF1_NON_INTERACTIVE`, `OF1_CTA_TEMPLATE`; must run from a top-level context; always writes `$OF1_STATE_DIR/of1-integration-result.json` (`assets/write-result.mjs`).
- `of1-check-dependencies` resolves `DOMAIN` (env, `repo-config.json`, content source, `fstab.yaml`/README, ask or fail) and requires exactly the ten plugin skills.
- Added `docs/contract.md` (progress contract) and `lib/contract.test.mjs`.
- SKILL.md files slimmed (each <= 200 lines, no bash block > 25 lines; enforced by `lib/size.test.mjs`); step bash lives in `skills/*/scripts/`; new `lib/env.sh`.
- Breaking for callers: `OF1_PIPELINE_MODE` and `OF1_STAGE2_DONE_FILE` are removed. Invoke `of1-integration content-source=<domain> non-interactive cta-template` after your own site-build stage finishes and read `of1-integration-result.json`. The demo-track checks in `of1-check-dependencies` are gone.

## 0.2.0

- Skills now source `lib/` helpers (`da-token.sh`, `git-push.sh`, `pw.sh`) instead of inline copies.
- Added baseline tooling (`scripts/baseline/`) and the golden shape in `docs/baseline/`.
- Removed Restart from `of1-check-dependencies` (DA/git wipe and prompt); runs are idempotent.
- Breaking for callers: `of1-check-dependencies` no longer asks Continue/Restart and no longer removes OF1-owned DA (`/of1/**`, `/templates/**`) or git (`blocks/of1`, `of1/config`) paths; callers that relied on that reset (of1-demo-skills orchestrator step 0a) must remove those paths themselves.
- `of1-extract-content` `download-images.mjs` is manifest-only (dropped `products.json` mode).
- Docs cleanup: removed stale pipeline-stage wording, fixed cta-template consumer docs,
  added `AGENTS.md`, `docs/README.md` index and status headers on specs/plans.

## 0.1.0

- Initial release.
