# OF1 Skills

Claude Code skills for integrating OF1 (branded, AI-powered generative search)
into an existing Adobe Edge Delivery Services project. Reuses whatever design
tokens, blocks, and content pages the site already has — no domain crawling,
no site-building. Other tools that build a site first can call `of1-integration`
once the site exists; the stable interface is in [`docs/contract.md`](docs/contract.md).

## Entry point

Invoke `of1-integration` pointed at an existing EDS repo:

```
/of1-integration [content-source=<domain>] [non-interactive] [cta-template]
```

Run it from a top-level context (it dispatches subagents). It runs its own internal step graph (see `skills/of1-integration/SKILL.md`
for the full dependency table), fanning out in parallel where possible, and always
ends by writing `$OF1_STATE_DIR/of1-integration-result.json`. Arguments and the
result shape: [`docs/contract.md`](docs/contract.md).

## Skills

| Skill | Description |
|-------|-------------|
| `of1-check-dependencies` | Verify prerequisites — skills, tools, and repo state; write `repo-config.json` and the DA sheet `/of1/config/config` |
| `of1-integration` | Introduce OF1 onto an existing EDS/Stardust site — the driver / entry point |
| `of1-extract-design` | Extract design tokens (`DESIGN.json`) from the site's own preview URL, when not already present |
| `of1-build-templates` | Author branded generative-search templates as DA documents under `/templates`, composed from the site's own blocks |
| `of1-style-generative-block` | Brand the `of1` block's CSS and author the `/of1` DA page (incl. landing title/subtitle/placeholder rows) |
| `of1-extract-brand-voice` | Extract the brand voice into the DA document `/of1/brand-voice` |
| `of1-extract-content` | Publish the site's page content to DA `/of1/knowledge/**` (RAG) and infer personas into the DA sheet `/of1/config/personas` |
| `of1-build-quick-suggestions` | Generate suggestion chips (DA sheet `/of1/config/suggestions`) and the `/of1` landing copy |
| `of1-build-cta-template` | Only with `cta-template`: generate a branded CTA template (DA sheet `of1/config/cta-template`; read by the gen-web worker as `cta-template`, served via `/api/personalize` `inject_cta`; personas are read by the preview extension / edge proxy instead) |
| `of1-publish` | Assert no git config, sync the OF1 worker (preview + publish stage; `publish-live` publishes first), generate the demo hub (DA edit links + status panel), and run the pre-launch checks |

Author-tunable config lives in DA (edit, preview, then sync — see
`skills/of1-integration/knowledge/da-sync-app.md`). A run commits only
`blocks/of1/`, new general-purpose `blocks/<name>/`, `helix-query.yaml` (only if
absent), `stardust/` + `PRODUCT.md` (only when extraction ran), and `deliverables/index.html`
(+ `deliverables/brand-review.html` when extraction ran). Config is never committed. A repo with git-tracked `of1/config/config.json` or `cta-template.json` (older integration) makes `of1-check-dependencies` step 3b exit `3` (`Legacy OF1 setup found: run of1-skills:of1-migrate`); the run is reported `failed`. `of1-migrate` (own skill, `of1-migrate/SKILL.md`; batch: `assets/batch.mjs`, default branch of each repo, which is expected to carry OF1 on `main`) moves such a repo to DA sheets and the `org/repo` tenant, removing only those two files (other tracked `of1/config/*` stay and are reported as `keptInGit`). OF1 setup (`of1-check-dependencies`, `of1-migrate`, `of1-publish`) runs from `main` and stops before writing anything on another branch; no branch ref is sent to gen-web. Tenant id = `org/repo`; proxy host `<branch>--<repo>--<owner>.of1.live`.
Config shapes: `skills/of1-integration/knowledge/worker-config-schemas.md`.

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
