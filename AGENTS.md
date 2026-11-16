# of1-skills

Claude Code plugin that connects an **existing** Adobe EDS site to OF1. Entry skill: `of1-integrate`. No crawling or site building.

## Layout

- `skills/<name>/SKILL.md`: one skill each (`of1-integrate`, `of1-register`, `of1-index`, `of1-search`, `of1-generative`, `of1-decision`); extra reference files sit next to it.
- `lib/`: the CLI (`lib/cli.mjs`) and helpers, with tests next to the code; `lib/templates/`: template tools; `lib/target.mjs`: the target switch.
- `assets/blocks/`: the `of1` and `decision` blocks installed into a site.

## Commands

```
npm test
```

## Conventions

- Skills know nothing about any calling system (a test enforces it for `skills/`, `lib/`, `assets/`).
- SKILL.md is at most 200 lines; frontmatter `name` equals the directory name.
- The portal is used only through MCP tools (`describe_site`, `register_site`, `get_registration`, `add_pages`, `preview_changes`, `get_pages_status`, `set_area`, `set_suggestions`, `upsert_template`, `set_feature`, `get_setup`, `get_settings`); `lib/` never calls MCP. The MCP `site` argument is `org/repo`.
- DA through `https://admin.da.live/source/<org>/<repo>/<path>`, preview through `https://admin.hlx.page/preview/...`. Never `live` unless the person asks (interactive only). Nothing reads or writes `/of1/config/*`.
- Commit with `git commit -m ... -- <paths>`; `git pull --rebase` before push; never force; never `git add -A`; never delete non-OF1 content.
- Never tests or builds against a real DA, portal or EDS admin: tests use fakes.
- Update `CHANGELOG.md` with each change.

`.mcp.json` ships two servers on the same URL, `of1-portal` (OAuth) and `of1-portal-token` (Bearer `OF1_PORTAL_TOKEN`): Claude Code never falls back to OAuth once an `Authorization` header is set, and an unset `${VAR}` is sent as literal text, so one server cannot serve both. Skills use whichever answers.

## Target switch (rollout)

`lib/target.mjs` `TARGET` is `"dev"` (portal MCP `https://dev-portal.of1.live/mcp`, proxy host suffix `--dev`). For the rollout set it to `"prod"` and change both URLs in `.mcp.json` to the same value; a test checks they agree.

## This repository is public

Keep internal details out of code, docs, commit messages and pull requests: no internal repository names or hostnames, no chat channels, people or customer data. Write "the OF1 team" instead. Do not commit design specs or implementation plans here.
