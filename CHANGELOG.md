# Changelog

## 0.3.0

- Dropped SLICC runtime support (Claude Code only); one DA client (`lib/da-client.mjs`) for the DA scripts; skills use `lib/` helpers.
- `of1-integration` is now a driver: three arguments (`content-source=<domain>`, `non-interactive`, `cta-template`) exported as `OF1_CONTENT_SOURCE`, `OF1_NON_INTERACTIVE`, `OF1_CTA_TEMPLATE`; must run from a top-level context; always writes `$OF1_STATE_DIR/of1-integration-result.json` (`assets/write-result.mjs`).
- `of1-check-dependencies` resolves `DOMAIN` (env, `repo-config.json`, content source, `fstab.yaml`/README, ask or fail) and requires exactly the ten plugin skills.
- Added `docs/contract.md` (progress contract) and `lib/contract.test.mjs`.
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
