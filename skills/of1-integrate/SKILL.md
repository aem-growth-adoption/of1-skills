---
name: of1-integrate
description: Connect an existing Edge Delivery Services site to OF1 end to end: register, index, search page and templates, generative block, decision block, delivery and final checks. Use to set up OF1 on a site in one run.
---

# of1-integrate

## Setup

- Plugin root: `$CLAUDE_PLUGIN_ROOT`, else two directories above this SKILL.md. Run the CLI as `node <plugin root>/lib/cli.mjs <command>` from the site repo.
- Portal tools are MCP tools, referred to by name suffix. Use the `of1-portal-token` server's tools when `OF1_PORTAL_TOKEN` is set, else the `of1-portal` server's.
- Autonomous mode: `OF1_AUTONOMOUS` is set to anything other than `0` or `false`, or the argument `autonomous` is given. Never ask questions then.
- If a portal tool returns unauthorized: interactive, tell the person to sign in (`/mcp` in Claude Code) and stop; autonomous, stop with `OF1_PORTAL_TOKEN missing or invalid`.
- Inputs: `pages`, `page-mode` (`copy` default | `real`), `code-delivery` (`main` default | `branch` | `pr`), as arguments `key=value` or `OF1_PAGES`, `OF1_PAGE_MODE`, `OF1_CODE_DELIVERY`. Pass them on to every step, plus `deliver=no`. `DA_TOKEN` is used when set, else the CLI resolves a token itself; never print it.

## Steps

1. **Start.** Run `identity` (take `site`, `hosts`) and `prereqs`. If `ok` is false, stop and show `missing`. Call `describe_site` { site } to check the portal answers.
2. **Mode and inputs.** Autonomous: take the inputs above with their defaults. Interactive: ask what the person wants to demo and about `pages`; defaults otherwise.
3. **Code delivery, before any change.** Interactive: ask "Push to main, push to a branch, or open a pull request?" (`main`, `branch`, `pr`). Autonomous: the `code-delivery` input. `branch` or `pr` forces `copy` for the demo page (the real page would use block code not yet on `main`). Tell every following step this choice.
4. Read and follow, in order, each SKILL.md in the sibling directories of this one: `of1-register`, `of1-index`, `of1-search`, `of1-generative`, `of1-decision`. Stop the run if `of1-register` does not end `skipped` or `done`. Run each with `deliver=no`; keep its report line and collect its `Changed paths`, plus the pages it created or previewed (demo page, decision fragments `/fragments/of1/<id>/...`, `/of1`, `/templates/<intent>-<n>`).
5. **Deliver once.** Run `deliver --mode <code-delivery> --message "Add OF1 integration" -- <collected paths> stardust/current` (always `blocks/of1`, `blocks/decision`, the created CTA block, `stardust/current`; only paths that exist; add `--branch <name>` for `branch`/`pr`: lowercase letters, digits and dashes, short enough that `<name>--<repo>--<org>` is at most 63 characters; an existing `of1-integrate` branch is reused and rebased on the current main by `deliver`, not assumed fresh). It returns `{ ok, ref, prUrl?, reason? }`; `reason` `nothing` means nothing to commit: `skipped`. Any other failure: `failed` with the `reason`.
6. **Publish.** Interactive only: ask "Publish to live?" (default no). On yes run `publish <path>...` with exactly: the demo page, its decision fragments, `/of1` and the `/templates/<intent>-<n>` pages created in this run (paths without `.html`); report each result. Autonomous: never publish. Without a yes: preview only.
7. **Checks.** First make sure the portal Preview holds every change of this run: call `get_setup_diff` { site, from: "saved", to: "preview" }; if any area changed, call `preview_changes` { site } and report `previewed: <areas>` (a sub-skill skipped its own `preview_changes`). `<proxy>` is `hosts.proxyPreview`; for `branch`/`pr` run `identity --ref <ref>` (the `ref` from `deliver`) and use its `hosts.proxyPreview`. Retry each check with a pause of 60 seconds, for up to 20 minutes in total:
   - `check-search <proxy> <query>`, where the query is the `query` of the first suggestion from `get_setup` { site, area: "search" } (`areas.search.suggestions`, written by of1-search): ok when `ok` is true.
   - `check-page <proxy><demo page path>`: ok when `ok` is true (`generative` > 0 and a decision in `decisions`).
   - `get_pages_status` { site }: write the result to `status.json`, run `pages-ready @status.json`. It returns `{ ready, allReady, total, pending, failed }`; ready when `allReady` is true. `ready` is always a number (`0` with `reason: "no-pages"` when there are no pages). Stop waiting as soon as `pending` is empty: `failed` pages (`unusable`, `missing`, `off`, `removed`) are final, report them as `failed`. `reason: "index-off"` means the index is off: stop and report `failed` with that reason.
   After the time is up, report each check that is not ready (with `problems` or the `pending` paths) as `failed`, not as an error of the run.
8. **Summary.** Print: the demo page URL (`<proxy><demo page path>?of1-region=us`), `<proxy>/of1`, `portalUrl` from `identity`, the delivery result (`ref`, `prUrl`), then every item as `created`, `skipped` or `failed`: registration, pages, brand voice, chips, templates, of1 block, `/of1`, demo page, hero, CTA, decision, delivery, each check.

## Questions and defaults

| # | Step | Interactive question | Autonomous default |
| --- | --- | --- | --- |
| 1 | Setup | Portal sign-in | `OF1_PORTAL_TOKEN` from the caller |
| 2 | Register | Registration confirm in the browser | Registered by the caller beforehand |
| 3 | Register | Site domain | Set by the caller at registration |
| 4 | Index | What do you want to demo? | Not asked; inferred from the site |
| 5 | Index | Which pages to index | Selection from the crawl origin (or the `pages` input), 20-40 pages |
| 6 | Search | Run Stardust extract? | Only when `DESIGN.json` is missing |
| 7 | Search | Overwrite brand voice? | Never |
| 8 | Search | Suggestion chips | 8-12 generated; existing kept |
| 9 | Search | Templates | Fixed 15; existing kept |
| 10 | Search | Overwrite `/of1`? | Never |
| 11 | Generative, decision | Which page | Home page |
| 12 | Generative, decision | Copy or real page | `page-mode` input, default `copy` |
| 13 | Generative | CTA block | Reuse if one fits, else create |
| 14 | Decision | Which section | Picked automatically; skip if none |
| 15 | Start | Code delivery | `code-delivery` input, default `main` |
| 16 | End | Publish? | No |
| 17 | All | Feature switches | Leave all on |
| 18 | End | Wait for the crawl | Up to about 20 minutes, then report |

## Report

The summary of step 8. Never publish to live unless the person said yes in step 6.
