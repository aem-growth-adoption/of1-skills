# OF1 Skills

Claude Code skills for integrating OF1 (branded, AI-powered generative search)
into an existing Adobe Edge Delivery Services project. Reuses whatever design
tokens, blocks, and content pages the site already has — no domain crawling,
no site-building. For building a full demo from scratch (crawl an external
site, prototype it, convert to EDS, *then* integrate), see
[of1-demo-skills](https://github.com/aem-growth-adoption/of1-demo-skills),
which depends on this plugin for the integration step.

## Entry point

Invoke `of1-integration` pointed at an existing EDS repo:

```
/of1-integration
```

It runs its own internal step graph (see `skills/of1-integration/SKILL.md`
for the full dependency table), fanning out in parallel where possible.

## Skills

| Skill | Description |
|-------|-------------|
| `of1-check-dependencies` | Verify prerequisites — skills, tools, and repo state; prepare `repo-config.json` |
| `of1-integration` | Introduce OF1 onto an existing EDS/Stardust site — the standalone entry point |
| `of1-extract-design` | Extract design tokens (`DESIGN.json`) from the site's own preview URL, when not already present |
| `of1-build-templates` | Generate 15 branded templates (5 intents × 3 variations) |
| `of1-style-generative-block` | Generate CSS for dynamically-rendered generative sections |
| `of1-extract-brand-voice` | Extract brand voice from a website and generate `brand-voice.json` |
| `of1-extract-content` | Scrape product data, personas, use cases, features, and FAQs |
| `of1-build-quick-suggestions` | Generate suggestion chips and search UI copy |
| `of1-build-cta-template` | Extract site design system and generate a branded CTA template |
| `of1-publish` | Commit config, sync to the OF1 worker, generate the demo hub, and verify |

## Usage

```bash
claude plugins install /path/to/of1-skills
```

Then run the entry point:

```
/of1-integration
```

## Prerequisites

`of1-check-dependencies` (run automatically as `of1-integration`'s step 1)
verifies:

- **Skills installed** — this plugin's own skills + Adobe `stardust`
  (`adobe/skills`) + `impeccable` (`pbakaus/impeccable`)
- **Playwright** — `playwright-cli` available on PATH
- **Node.js** — `node` available on PATH
- **Git credentials** — `~/.git-credentials` present for push access
- **EDS repo** — a valid Edge Delivery Services checkout (any org/repo;
  verified structurally, not by identity)
