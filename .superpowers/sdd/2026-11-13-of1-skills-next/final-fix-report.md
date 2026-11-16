# Final fix report
Changes: .mcp.json token header uses `${OF1_PORTAL_TOKEN:-}` (+plugin test); README left as-is (opencode `{env:...}` syntax has no default form). pagesReady now returns `failed` (unusable/missing/off/removed, per portal PageState) excluded from `pending`, and `reason:"index-off"` when sync.status is off; tests added. deliver validates branch (`^[a-z0-9-]+$`, name+`--repo--org` <= 63, from origin URL) -> `bad-branch` before git changes. SKILL.md edits (wait step, `<proxy>/of1`, index `--domain`, branch reuse). target.mjs comment.
Tests: `npm test` all pass.
