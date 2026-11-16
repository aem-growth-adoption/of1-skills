---
name: of1-search
description: Prepare Generative Search for a registered site: brand voice, suggestion chips, the 15 search templates, the of1 block and the /of1 page. Use after of1-index.
---

# of1-search

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.
- Brand voice and chips rules: `guidance.md` next to this file. Template tools live in `<plugin root>/lib/templates/`.
- Each sub-step ends with `done` or `skipped` (and why) in the report.

## Steps

1. Run `identity` for `site` and `hosts`; the DA/EDS base is `https://main--<repo>--<org>.aem.page`.
2. **Design.** If `stardust/current/DESIGN.json` is missing, run the `stardust:extract` skill (it writes `stardust/current/DESIGN.json`, `DESIGN.md`, `PRODUCT.md`). Interactive: ask first. Otherwise `skipped`.
3. **Brand voice.** `get_setup` { site, area: "site" }. If `areas.site.brandVoice` is non-empty: `skipped`. Else write it as in `guidance.md` from `stardust/current/PRODUCT.md` and `DESIGN.md` plus a few real pages, then `set_area` { site, area: "site", data } where `data` is the full `areas.site` with `brandVoice` added.
4. **Suggestion chips.** `get_setup` { site, area: "search" }. If `areas.search.suggestions` is non-empty: `skipped`. Else build 8-12 from the indexed pages (`get_setup` area `pages`, titles and headings) as in `guidance.md` and call `set_suggestions` { site, suggestions }.
5. **Templates.** Write `areas.search.templates` (from step 4's read; `[]` when there are none) to `registered.json`. Run `templates-plan @registered.json`. It returns `{ keep, register, build }`; `build` entries are `{ path, intent }`. Registered pages are never rebuilt; ignore any old template Section Metadata (the portal holds the template settings). The portal holds at most 30 templates: if the result has `overflow`, those paths are not registered; report them.
   - If `build` is non-empty, run once: `node <plugin root>/lib/templates/harvest-sections.mjs --base <base> --out harvest.json` (optionally `--paths`, `--max`).
   - For each entry write a spec JSON (see the header of `lib/templates/compose-template.mjs`: `intent`, `description`, `minItems`, `maxItems`, `ctaHref: "/of1"`, `sections`) built from the harvested real blocks and images of that site, then `node <plugin root>/lib/templates/compose-template.mjs --harvest harvest.json --spec spec.json --out template.html`. Vary the three templates of an intent.
   - Check each `template.html`: `node <plugin root>/lib/templates/template-images.mjs < template.html` must exit 0 (no output); `node <plugin root>/lib/templates/template-richness.mjs < template.html` prints `<contentBlocks> <maxItems>`; at least 2 content blocks. If its `maxItems` differs from the spec's `maxItems`, fix the spec (or the template's `Template Max Items` row) and compose again; the `upsert_template` `maxItems` must be the spec value.
   - `da-put <path> @template.html`, then `preview <path>...` for all built pages (paths without `.html`).
   - `upsert_template` { site, template: { path, intent, description, minItems?, maxItems? } } for every built entry and every `register` entry (for `register` pages take the intent from the name `<intent>-<n>`, else the best fit, and write a description of 1-500 characters). Keep `minItems <= maxItems`, whole numbers 1-20.
   - Report counts: kept, registered, built.
6. **Block.** `install-block of1 --design stardust/current/DESIGN.json` (add `--design` only if the file exists; never `--overwrite`). Status `installed` or `exists` (report `skipped`). Commit and publish the code with `deliver --message "Add of1 block" -- blocks/of1` `--mode <code-delivery input, default main>` (and `--branch <name>` for `branch`/`pr`).
7. **`/of1` page.** Run `da-put of1 @of1.html` where `of1.html` is `<body><header></header><main><div><h1>Search</h1><div class="of1"><div><div></div></div></div></div></main><footer></footer></body>`. On status `exists`: interactive, ask before overwriting and re-run with `--overwrite` only on yes; autonomous, keep it. Report `skipped` when kept. Then `preview of1`.
8. Call `preview_changes` { site } so the portal asks gen-web to materialize the templates. Do not wait.

## Report

Per sub-step `done`/`skipped`; chips count; templates kept, registered, built; block status; `/of1` status; that the preview was started.
