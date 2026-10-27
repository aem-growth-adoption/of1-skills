# Changelog

## Unreleased

- Docs only (no version bump): aligned docs with the code. `worker-config-schemas.md`: `config` / `cta-template` are DA sheets (no git / pipeline mode), check 1 and step 3b only detect the five legacy files, brand-voice overwrite follows `non-interactive`. `non-interactive` never removes legacy config (step 3b exits `3` → `of1-migrate`) in `docs/contract.md` and `of1-integration`; `of1-publish` step 1 wording. `of1-migrate` listed in README, AGENTS.md and `plugin.json` entrypoints; README entry point shows `publish-live`; proxy host `main--<repo>--<owner>`. `DESIGN.json` lives only at `stardust/current/` (`of1-build-cta-template`, `of1-style-generative-block`); `audiences` documented as legacy (gen-web no longer syncs it). Baseline `--tenant` behaviour documented, incl. the known bug (host label used as tenant id for `/status` and `/api/generate`). CHANGELOG: the stale Unreleased entries moved to the releases that shipped them (CTA `font-family` → 0.5.0, docs cleanup → 0.4.3). `docs/README.md`: merged PRs #20, #24, #29.

## 0.5.1

- **`of1-publish` previews and publishes the edge-proxy sheets.** The edge proxy reads `of1/config/signals`, `of1/config/llmquestions` and `of1/config/context-endpoints` at request time from the stage origin (aem.page for `prev--` hosts, aem.live for publish hosts). Step 3 (`03-push-config.sh`) previewed and step 4b (`04b-publish-live.sh`, `publish-live`) published only `config`, `cta-template`, `suggestions`, `template-list`, `personas`, `audiences`, so these three were never published (also after `of1-migrate`, which writes + previews them and publishes through 4b) and the publish host's proxy got 404. Both lists now include them; absent sheets are still skipped (404 probe), so sites without them are unaffected.
- `03-push-config.sh` exit status no longer depends on which sheet is last: a failed preview of any present sheet (not HTTP 200/201) prints `✗ preview failed <path> (HTTP <code>)` to stderr, the loop continues, a `previewed N, failed M` summary is printed, and the step always exits 0 (warn only).
- Tests: publish step 3 previews / step 4b publishes the three (`admin.hlx.page/{preview,live}/…/<sheet>.json`), absent ones skipped; step 3 with a failed first / last preview exits 0 with the stderr line and summary; migrate with `publish-live` publishes the converted sheets.

## 0.5.0

Found by running the AMAG demo end to end in a real browser (generated pages looked nothing like the site; images were broken).

- **`of1-build-templates` no longer invents images or layouts.**
  - New `assets/harvest-sections.mjs`: fetches the migrated pages' `.plain.html` (from `/sitemap.json` / `/query-index.json`, minus OF1/templates/nav/fragments, or `--paths`), splits out every top-level block with absolute URLs, and pools the real content images into `$OF1_STATE_DIR/of1-build-templates-harvest.json`. The base phase uses it instead of the old per-block fingerprint harvest.
  - New `assets/compose-template.mjs`: composes a template document from harvested blocks (`keepRows`, exact-text `replace`, `images` from the pool, `ctaHref: "/of1"`), keeping structure, variants and colour cells as authored. Fails on unknown blocks, text it cannot find, or a placeholder image. The intent phase composes with it; hand-written markup is only the fallback for a block type the site does not have.
  - New RULES 8-9: never invent an image; compose from the site's own authored blocks.
- **New assemble step 3b `scripts/verify-images.sh` (+ `assets/template-images.mjs`)**: aborts on placeholder / invented / unusable images (`placehold.co`, `picsum.photos`, `about:error`, `example-*.jpg`, a bare `media_1.png`) and on any template image that does not answer `200 image/*` (relative URLs resolve against the template's preview path). This was the cause of broken `about:error` hero images, and of white-on-white hero headlines.
- **`of1-publish` check 6 accepts a whole page in one section.** The da-blocks-slots engine streams one `section` event holding the whole page, so the old "at least 2 `section` events" rule failed healthy sites. Now: >=2 sections, or 1 section with >=2 blocks; 0 sections, a single thin section, or any `error` event still fail.
- `of1-build-cta-template`: the CTA template no longer sets `font-family`. It hard-coded the EDS replica's font names (`amag_display`, `amag_text`), which do not exist on pages the edge proxy serves from the tenant's real domain, so the injected CTA rendered in Arial there. With no `font-family` the host page's own fonts apply on every page. `write-cta-template.sh` now rejects html containing `font-family`. Existing tenants: re-generate or edit the DA sheet `/of1/config/cta-template` (remove the `font-family:…;` declarations), preview, publish and sync.
- Tests: `template-images`, `harvest-sections`, `compose-template` unit tests; `verify-images` script tests (fake curl); new check 6 cases. 311 tests pass.

## 0.4.5

- `of1-migrate` now also converts `signals.json`, `llmquestions.json` and `context-endpoints.json` to DA sheets (`of1/config/signals`: `param,value,source,context`; `llmquestions`: `url,question`, one row per question; `context-endpoints`: `name,description,url,method,timeoutMs,inputs,outputDescription,outputFields`, `inputs` as `name=from; …` with `*` on required, `outputFields` as `field=description; …`). New `assets/to-sheet.mjs` (converters + test-only reverse functions proving round-trip to the proxy's bare shapes). Everything is validated before any sheet is written; unrepresentable content (more than 2 endpoints, `;`/`=` in field descriptions, input keys outside the proxy allowlist, nested/non-string cells, duplicate llmquestions urls) fails step 2 naming file and key. Step 5 checks each converted sheet is served with the written row count; step 3 removes all converted files; the result JSON gets `converted`. The "proxy reads them from git" warning is gone; legacy catalogs and other files are still kept with warnings. `batch.mjs` dry-run prints `convert=<n>`.
- `of1-check-dependencies` step 3b and `of1-publish` check 1 flag a tracked `signals.json` / `llmquestions.json` / `context-endpoints.json` as legacy (exit 3 / check 1 fails).

## 0.4.4

- `of1-migrate` no longer deletes every file under `of1/config`. Step 3 removes only what step 2 converted (`config.json`, `cta-template.json`; recorded in `migrate-converted.txt`); other tracked files (e.g. `signals.json`, `context-endpoints.json`, which the edge proxy fetches from git at runtime) stay. Step 1 lists all tracked files as `convert` / `keep`; the result JSON gets `keptInGit` and `warnings` (legacy catalogs the worker no longer reads can be deleted by hand; proxy-read files stay). A repo with only kept files is `already-new`. Rollback is restricted to the removed files. `batch.mjs` prints `keptInGit` counts.
- `of1-check-dependencies` step 3b and `of1-publish` check 1 now only flag a tracked `config.json` / `cta-template.json`.
- `of1-check-dependencies` stops (exit 1, `OF1 setup runs from the main branch (checkout main)`) off `main` at the start of `verify.sh` and in `00-load-setup.sh`, before any DA write, commit or push; it no longer only warns.

## 0.4.3

- `of1_sync` (shared by `of1-publish` and `of1-migrate`) now handles sites too big for one sync call. A single gen-web sync may issue only ~50 subrequests (site index + one fetch per page + embeddings), so a larger `/of1/knowledge/**` set failed the content phase with `Too many subrequests by single Worker invocation` and `content: null` (silently leaving the index stale). When that error appears, the content phase is re-run in slices (`file=content&offset=N&limit=40`, resuming at the returned `next`, never `offset+limit`) until `done`, and the final `content` plus any slice errors are folded into `hub/sync-<stage>.json`. Normal-size sites still make exactly one call. A slice that does not advance, non-JSON answer, or 50 slices without `done` stops with an `errors[]` entry `{content: "batch"}` (check 2 fails on it).
- Operational note: a large index needs a few minutes before Vectorize makes the new vectors queryable (small syncs take ~20 s); wait before running the pre-launch generation checks or a demo.
- Tests: `lib/sync-batch.test.mjs` (single call untouched, batching resumes at `next`, slice/unrelated errors kept, other content errors don't batch, stuck batches stop).
- Docs: removed superseded knowledge-only specs/plans (2026-08-27, 2026-08-28, 2026-09-07; history keeps them); cleanup spec/plan statuses set to Implemented.

## 0.4.2 (no ref)

- The branch ref is not a tenant concept. `of1_sync` no longer sends `&ref=`; gen-web reads `main--<repo>--<org>`. `PROXY_HOST`, `PREVIEW_HOST`/`PREVIEW_BASE`, the demo hub, and Helix admin calls (`aemAction`, `aem_preview`, `da-write.mjs live`) use the literal `main`. `repo-config.json` `branch` stays readable (older state) but is ignored for URLs and no longer required.
- `of1-migrate` and `of1-publish` stop with "OF1 setup runs from the main branch (checkout main)" off `main` (detached-HEAD guard kept). `of1-migrate-result.json` drops `ref`.
- `batch.mjs` drops the `repo@branch` syntax and `--branch`; it clones the default branch (repos are expected to have OF1 on `main`).
- `da-write.mjs`, `publish-knowledge-da.mjs`, `download-images.mjs` no longer take `--branch`.

## 0.4.1

- `of1-style-generative-block`: the `/of1` page's `api-endpoint` is now the tenant's proxied host (`$PROXY_BASE`, `https://main--<repo>--<org>[--dev].of1.live`), not the gen-web URL. Production gen-web rejects anonymous browser calls (401) and only the edge proxy holds the caller credential, so a page calling gen-web directly rendered no chips. `OF1_API_ENDPOINT` overrides (bare https origin, validated). `upload-of1-page.sh` fails if `<api-endpoint>/sdk/of1-client.js` is not 200.
- **Requires of1-edge-proxy with `/sdk/*` and tenant-origin CORS on the passthrough** (of1-edge-proxy #44 and #45) deployed. Pages written by 0.4.0 or earlier keep calling gen-web: re-run `of1-style-generative-block` (or `of1-publish`) to rewrite them.
- Tests: new `upload-of1-page` cases (proxied default, dev suffix, override, unsafe override rejected, SDK gate); fixed the stale `domain` row assertion (`o/r`).

## 0.4.0 (new tenant system)

- Breaking/contract: tenant id is `org/repo`, config is DA sheets, sync is stage-aware, new skill `of1-migrate`, `OF1_PUBLISH_LIVE` / `publish-live`. Callers (e.g. of1-demo-skills) must require of1-skills >= 0.4.0.
- Legacy gen-web data: publish sync HTTP 409 `Tenant not migrated` is reported as `legacy-tenant-present` (of1-publish `04-sync.sh` exits 3, check 2 names the reason; `of1-migrate` fails with that code and leaves git untouched). An admin must delete or migrate the gen-web tenant first; the skills never call admin APIs.
- `of1_sync` URL path keeps the original-case `$OWNER/$REPO` (gen-web authorizes against DA with the id as sent); bodies/check 6 use the lowercase id. Token goes through `of1_curl_auth` (charset-validated).
- `07-config-json.sh` no longer overwrites an authored config sheet: existing rows are kept, `domain` is added only when missing.
- `lib/env.sh`: dev workers (`-dev` host) get the `--dev` proxy host suffix; `OF1_PROXY_SUFFIX` overrides.
- `of1-migrate`: reads `cta-template.json` from `origin/<branch>` when only origin has it; `batch.mjs` accepts `repo@branch` and `--branch`.


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

- Template names now come from the previewed DA sheet `/of1/config/template-list` (written by `of1-build-templates` assemble via `write-template-list.sh`); requires a recent gen-web worker.
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
