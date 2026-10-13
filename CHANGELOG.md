# Changelog

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
