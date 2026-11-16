---
name: of1-generative
description: Make a page generative with OF1: a generative hero and a generative call-to-action below it, on a copy of the page or the real page. Use after of1-search, or on its own for a registered site.
---

# of1-generative

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.
- CTA host-block rules: `cta.md` next to this file.
- Each sub-step ends with `done` or `skipped` (and why) in the report.

## Steps

1. Run `identity` for `site`. Run `prereqs`; if `ok` is false, stop with its `missing`.
2. **Target page.** The path is the first entry of the `pages` input, default `/`. Choose the mode:
   - `code-delivery` `branch` or `pr`: always `copy` (a branch or PR must not change a live page).
   - Autonomous: the `page-mode` input (default `copy`).
   - Interactive: say which page would change, default to `copy` (the page is copied to `/of1-demo/...`), and use `real` only if the person chooses it.
3. Run `prepare-page <path> --mode <copy|real>`. It returns `{ target, created }`: `created` when the copy was made, `exists` when it was already there or the mode is `real`. Never overwrite an existing copy in autonomous mode; interactive, ask before re-copying.
4. Read the target: `da-get <target>` returns `{ status, text }`; write `text` to `page.html`. A `status` other than 200: stop with that reason.
5. **Hero.** If `page.html` has no `h1` section, `skipped` (no hero). If its hero section already has `generative-scope` Section Metadata, `skipped`. Else write one `instruction` from the site's brand voice (`get_setup` { site, area: "site" }) and the page, saying how the headline and text should adapt to the visitor, then apply `heroGenerative(html, instruction)` from `<plugin root>/lib/doc.mjs`. It adds `generative-scope: h1` and `generative-instruction` to the hero's Section Metadata. Keep the original text as it is; it stays the default.
6. **CTA.** If `hasOf1Cta(html)` is true (a `{{generate:` after the hero), `skipped`. Else follow `cta.md`: pick the host block, then insert a section right after the hero built with `ctaSectionHtml({ block, heading, text, button: { label, href } })`. `heading`, `text` and `label` are each `[instruction, default]` (the default is the static text shown without generation); `href` is `/of1`.
7. Save the edited HTML to `page.html`. Run `da-put <target> @page.html --overwrite` (the copy, or the real page only when `real` was chosen), then `preview <target>`.
8. If a CTA block was created or restyled, run `deliver --message "Add of1-cta block" -- blocks/of1-cta` with `--mode <code-delivery>` (and `--branch <name>` for `branch`/`pr`).
9. Report the preview URL `https://main--<repo>--<org>.aem.page<target>` and, for generation, the proxy URL `https://prev--main--<repo>--<org>--dev.of1.live<target>?of1-region=us` (host from `identity` `hosts`).

## Report

Mode and target; `created`/`exists`; hero `done`/`skipped`; CTA `done`/`skipped` and the host block; preview status.
