# Changelog

## 0.2.0

- Added baseline tooling (`scripts/baseline/`) and the golden shape in `docs/baseline/`.
- Removed Restart from `of1-check-dependencies` (DA/git wipe and prompt); runs are idempotent.
- Breaking for callers: `of1-check-dependencies` no longer asks Continue/Restart and no longer removes OF1-owned DA (`/of1/**`, `/templates/**`) or git (`blocks/of1`, `of1/config`) paths; callers that relied on that reset (of1-demo-skills orchestrator step 0a) must remove those paths themselves.
- `of1-extract-content` `download-images.mjs` is manifest-only (dropped `products.json` mode).
- Docs cleanup: removed stale pipeline-stage wording, fixed cta-template consumer docs,
  added `AGENTS.md`, `docs/README.md` index and status headers on specs/plans.

## 0.1.0

- Initial release.
