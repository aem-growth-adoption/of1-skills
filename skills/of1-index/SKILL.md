---
name: of1-index
description: Choose the pages OF1 should index for a registered site, add them to the portal and start the preview. Use after of1-register.
---

# of1-index

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.
- Optional input `pages` (argument `pages=...` or `OF1_PAGES`): a JSON array of paths/URLs or `{path,type}` objects, or `@<file>` containing that JSON. Always pass it quoted to `--pages`.

## Steps

1. Run `node <plugin root>/lib/cli.mjs identity` for `site`.
2. Call `get_setup` { site, area: "pages" }. If `areas.pages.list` is non-empty, pages are already set: report `skipped` and go to step 6.
3. Call `get_setup` { site, area: "site" } and read `areas.site.domain`.
4. Run `node <plugin root>/lib/cli.mjs pages --domain <domain>`, adding `--pages '<input>'` when the `pages` input is given. It returns `{ origin, source, proposal, skipped }`; `proposal` entries are live pages with a path and type. If `source` is `"none"` (no sitemap or query-index) and no `pages` input: interactive, ask for paths; autonomous, stop and say no pages were found.
5. Choose:
   - **Interactive:** ask "What do you want to demo?", show the proposal grouped by type, and let the person add, remove or change pages. Re-run `pages --pages '<edited JSON>'` on the edited list so non-live pages are still reported, and use its `proposal`.
   - **Autonomous:** take the proposal as is.
   Report pages in `skipped` (`not-live`). Never publish pages for indexing.
   Then call `add_pages` { site, paths } with the chosen paths.
6. Call `preview_changes` { site }. Do not wait for it to finish.

## Report

Pages added (count and list), pages skipped as `not-live`, and that the preview was started.
