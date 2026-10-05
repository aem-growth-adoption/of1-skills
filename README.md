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
| `of1-check-dependencies` | Verify prerequisites — skills, tools, and repo state; write `repo-config.json` and the git `of1/config/config.json` (`{domain}`) |
| `of1-integration` | Introduce OF1 onto an existing EDS/Stardust site — the standalone entry point |
| `of1-extract-design` | Extract design tokens (`DESIGN.json`) from the site's own preview URL, when not already present |
| `of1-build-templates` | Author branded generative-search templates as DA documents under `/templates`, composed from the site's own blocks |
| `of1-style-generative-block` | Brand the `of1` block's CSS and author the `/of1` DA page (incl. landing title/subtitle/placeholder rows) |
| `of1-extract-brand-voice` | Extract the brand voice into the DA document `/of1/brand-voice` |
| `of1-extract-content` | Publish the site's page content to DA `/of1/knowledge/**` (RAG) and infer personas into the DA sheet `/of1/config/personas` |
| `of1-build-quick-suggestions` | Generate suggestion chips (DA sheet `/of1/config/suggestions`) and the `/of1` landing copy |
| `of1-build-cta-template` | Pipeline mode only (`OF1_PIPELINE_MODE=1`): generate a branded CTA template (git `of1/config/cta-template.json`) |
| `of1-publish` | Assert the git config set, sync the OF1 worker, generate the demo hub (DA edit links + status panel), and run the pre-launch checks |

Author-tunable config lives in DA (edit, preview, then sync — see
`skills/of1-integration/knowledge/da-sync-app.md`). A standalone run commits only
`blocks/of1/`, new general-purpose `blocks/<name>/`, `helix-query.yaml` (only if
absent), `of1/config/config.json`, `stardust/` + `PRODUCT.md` (only when extraction
ran), and `deliverables/index.html` (+ `deliverables/brand-review.html` when
extraction ran). Config shapes: `skills/of1-integration/knowledge/worker-config-schemas.md`.

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
