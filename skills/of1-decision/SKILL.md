---
name: of1-decision
description: Add a decision block to a page: one promo or teaser section is replaced by a block that picks between the original and 2-3 intent-specific fragments. Use after of1-generative.
---

# of1-decision

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.
- Each sub-step ends with `done` or `skipped` (and why) in the report.

## Steps

1. Run `identity` for `site`. Run `prereqs`; if `ok` is false, stop with its `missing`.
2. **Fragment block.** The decision needs `blocks/fragment/fragment.js` in the site repo. If it is missing, stop this step with `fragment-block missing`. (`prereqs` does not report it: check the file.)
3. **Target page.** The same page as of1-generative: its path (first `pages` entry, default `/`), the same mode rules (`code-delivery` `branch`/`pr` forces `copy`; autonomous uses `page-mode`; interactive defaults to `copy`). Run `prepare-page <path> --mode <copy|real>` and use its `target`. `da-get <target>`, write `text` to `page.html`.
4. If `hasDecision(html)` (from `<plugin root>/lib/doc.mjs`) is true: `skipped` (a decision block exists).
5. **Section.** Call `pickDecisionSection(html, findHero(html))`. It returns `{ index, reason }`. `index` -1: `skipped` with that `reason` (interactive: tell the person which page and why). Else the section at `index` (`sections(html)[index]`) is the one to replace.
6. **Fragments.** Choose an `id` (letters, digits, `-`, `_`, at most 64, for example `<page>-promo`) and a `hint` of at most 500 characters: what the section is for and what a visitor with each intent needs.
   - Write the original section as the page `<body><header></header><main>SECTION</main><footer></footer></body>` to `default.html`, then `da-put fragments/of1/<id>/default @default.html`.
   - Write 2-3 versions of the section, each aimed at one intent (`comparison`, `recommendation`, `deep-dive`, `budget` or `discovery`), with the same block, the site's real products, pages and images and the brand voice, and `da-put fragments/of1/<id>/<intent> @<intent>.html` for each. Exist already (`exists`): keep, do not overwrite.
   - `preview fragments/of1/<id>/default fragments/of1/<id>/<intent>...`
7. **Block.** `install-block decision` with `--design stardust/current/DESIGN.json` when that file exists (never `--overwrite`); `exists` is `skipped`. Deliver it with `deliver --message "Add decision block" -- blocks/decision`, `--mode <code-delivery>` (and `--branch <name>` for `branch`/`pr`).
8. **Replace.** Build `<div>` + `decisionBlockHtml({ id, hint, candidates })` + `</div>` with the default candidate first: `['/fragments/of1/<id>/default', '/fragments/of1/<id>/<intent>', ...]` (2-10 entries, no `when` guards). `replaceSection(html, index, thatSection)`, save to `page.html`, `da-put <target> @page.html --overwrite`, `preview <target>`.
9. **Check.** On a `prev--` host the previewed fragments are enough. Report the page URL `https://main--<repo>--<org>.aem.page<target>`.

## Report

Target and mode; step `done`/`skipped` with the reason; decision `id`; fragments written (name and `created`/`exists`); block status; preview status.
