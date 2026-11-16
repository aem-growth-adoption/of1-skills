# OF1 Skills

A Claude Code plugin that connects an existing Adobe Edge Delivery Services (EDS) site to OF1: it registers the site in the OF1 portal, chooses the pages to index, builds the search page and templates, adds generative content and a decision block to a demo page, delivers the code and checks the result. It reuses the site's own design, blocks and content; it does not crawl a domain to build a site.

## Install

```bash
claude plugins install /path/to/of1-skills
```

Then, from the site repo:

```
/of1-integrate [autonomous] [pages=...] [page-mode=copy|real] [code-delivery=main|branch|pr]
```

## Sign in to the portal

The portal is reached through MCP only (`.mcp.json`). Either sign in with OAuth (`/mcp` in Claude Code, server `of1-portal`), or set `OF1_PORTAL_TOKEN` (server `of1-portal-token`). A DA token comes from `DA_TOKEN`, else from `npx -y github:adobe-rnd/da-auth-helper token`; it is never printed or committed.

OpenCode (`opencode.json`):

```json
{
  "mcp": {
    "of1-portal": { "type": "remote", "url": "https://dev-portal.of1.live/mcp" },
    "of1-portal-token": {
      "type": "remote",
      "url": "https://dev-portal.of1.live/mcp",
      "headers": { "Authorization": "Bearer {env:OF1_PORTAL_TOKEN}" }
    }
  }
}
```

## Inputs

| Input | Values | Default |
| --- | --- | --- |
| `autonomous` argument or `OF1_AUTONOMOUS` | on for anything other than `0`/`false` | off (asks questions) |
| `OF1_PORTAL_TOKEN` | portal token | OAuth sign-in |
| `DA_TOKEN` | DA token | resolved with the DA auth helper |
| `pages` / `OF1_PAGES` | JSON array of paths/URLs or `{path,type}`, or `@file` | chosen from the site's sitemap |
| `page-mode` / `OF1_PAGE_MODE` | `copy` or `real` | `copy` |
| `code-delivery` / `OF1_CODE_DELIVERY` | `main`, `branch` or `pr` | `main` |

## Skills

| Skill | What it does |
| --- | --- |
| `of1-integrate` | Entry skill: runs all the steps below, delivers the code, checks and summarizes |
| `of1-register` | Registers the site in the portal, or confirms it is registered |
| `of1-index` | Chooses the pages to index, adds them and starts the preview |
| `of1-search` | Brand voice, suggestion chips, 15 search templates, the `of1` block and the `/of1` page |
| `of1-generative` | Generative hero and CTA on a demo page (a copy by default) |
| `of1-decision` | A decision block with fragments on the demo page |

Each step also runs alone and reports `done`, `skipped` or `failed`; re-runs keep what exists.
