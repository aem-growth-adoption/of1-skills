# OF1 Worker — Tenant Config Sources

The OF1 worker reads tenant config from R2. A **sync** (`POST /api/tenants/<id>/sync`, tenant id
`<branch>--<repo>--<owner>`) pulls each source from the site's preview host
`https://<id>.aem.page` and stores it. Most author-tunable config is a **DA document or sheet**;
only `config.json` (and, in pipeline mode, `cta-template.json`) is committed to git.

> **DA config is shared per org/repo, not per branch.** DA keeps one content tree per
> `<owner>/<repo>`; every branch's preview host reads the same `/of1/**` and
> `/templates/**`. Only the git files (`config.json`, `cta-template.json`) are
> branch-scoped. The supported model is therefore **one EDS repo per site/demo** — two
> demos on different branches of the same repo would overwrite each other's DA config,
> and `of1-check-dependencies` Restart's deletion of DA `/of1` and `/templates` affects
> every branch of the repo.

| Source | Where | Produced by | Sync file |
|---|---|---|---|
| `of1/config/config.json` | git | `of1-check-dependencies` | `config` |
| `of1/config/cta-template.json` | git — **pipeline mode only** | `of1-build-cta-template` | `cta-template` |
| `/of1/brand-voice` | DA document | `of1-extract-brand-voice` | `brand-voice` |
| `/of1/config/personas` | DA sheet | `of1-extract-content` | — (not synced; read by the extension / edge proxy) |
| `/of1/config/suggestions` | DA sheet | `of1-build-quick-suggestions` | `suggestions` |
| `/of1` page, `of1` block rows | DA document | `of1-style-generative-block` Step 5 | — (read by the client SDK) |
| `/of1/strategy` | DA document (optional) | authors | `strategy` |
| `/templates/*` | DA documents | `of1-build-templates` | `templates` |
| `/of1/knowledge/**` | DA documents | `of1-extract-content` | `content` |

Every DA item must be **previewed** (`admin.hlx.page/preview/...`) — the worker reads the preview
host, not DA source. `skills/of1-integration/assets/da-write.mjs` writes + previews DA docs and sheets.

**Never commit `of1/config/personas.json` or `of1/config/suggestions.json`.** A git file beats a DA
sheet at the same path on EDS, so a committed file would shadow the authored sheet. `of1-publish`
check 1 fails if any `of1/config/*.json` other than `config.json` (+ `cta-template.json` in pipeline
mode) is tracked in git.

---

## `config.json` (git)

```json
{ "domain": "example.com" }
```

| Field | Required | Notes |
|---|---|---|
| `domain` | yes | Edge-proxy 404 domain fallback. Always written by `of1-check-dependencies` |
| `contentIngestion` | no | Override knowledge-page indexing. Worker defaults: `includePaths ["/of1/knowledge/**"]`, `maxChunkTokens 400`, `contentTopK 4`. `enabled: false` opts out (tenant then never becomes ready) |
| `contentIngestion.indexPath` | no | Site-root index the worker reads knowledge-page paths from (e.g. `"/sitemap.json"`). Default `"/query-index.json"`. Set by `of1-publish` step 2b when the site's index is managed by the AEM config service and `/query-index.json` doesn't list `/of1/knowledge/` |
| `of1Endpoint` | no | Override the derived CTA/landing URL (default `https://<id>.aem.page/of1`) |
| `templates.daPath` | no | Override the template folder (default `/templates`) |
| `templates.names` | no | Array of DA template doc names under `/templates` (e.g. `["product-grid","faq"]`, no extension). When set, the worker uses this list instead of discovering templates from the query index. Set by `of1-publish` step 2b when `/query-index.json` doesn't list `/templates/` |

Example with both overrides (config-service site):

```json
{
  "domain": "example.com",
  "contentIngestion": { "indexPath": "/sitemap.json" },
  "templates": { "names": ["product-grid", "faq", "comparison"] }
}
```

`of1/config/` must be served: if `.hlxignore` excludes it, `of1-check-dependencies` fixes that.

---

## `cta-template.json` (git, pipeline mode only)

Produced only when `OF1_PIPELINE_MODE=1`. The extension / edge proxy inject it into customer pages
via `/api/personalize` (`inject_cta` event). Optional for the worker — not part of the ready gate.

Mustache-style template with placeholders `{{title}}`, `{{description}}`, `{{buttonText}}`, `{{href}}`.

```json
{
  "html": "<aside class=\"of1-cta\"><h3>{{title}}</h3><p>{{description}}</p><a href=\"{{href}}\">{{buttonText}}</a></aside>",
  "slots": ["title", "description", "buttonText"],
  "fallback": {
    "title": "Discover more",
    "description": "Explore curated picks for you.",
    "buttonText": "Browse"
  }
}
```

- `{{href}}` is resolved at runtime from the derived `of1Endpoint` — do NOT include it in `slots`
- `slots` array must be exactly `["title", "description", "buttonText"]`
- `fallback` is used when the LLM doesn't emit a CTA block
- HTML must be self-contained with inline styles, on a single line

---

## `/of1/brand-voice` (DA document)

Plain prose. Suggested headings: *Personality*, *Tone*, *Words we use*, *Words we avoid*. Authors may
paste brand guidelines freely. Sync fetches `/of1/brand-voice.plain.html`, strips it to text, and
stores it as the tenant's brand voice string — injected as the `## Brand Voice` section of every
generation prompt. Not part of the ready gate (`/status` reports `hasBrandVoice`), but always write it.

In standalone mode, `of1-extract-brand-voice` asks before overwriting an existing author-edited doc;
pipeline mode overwrites.

---

## `/of1/config/personas` (DA sheet)

One row per persona, served as `/of1/config/personas.json` (`{":type":"sheet","data":[…]}`):

| id | name | description | keywords | priorities | explore | research | compare | purchase | deals | support |
|---|---|---|---|---|---|---|---|---|---|---|

- `keywords` / `priorities` are comma-separated in the cell — individual items must not contain commas
  (`da-write.mjs` rejects them).
- The six intent columns are numbers in 0–1 (the persona's intent profile).
- Consumers: the preview extension / edge-proxy injected build ("apply persona" seeds a behaviour
  profile) and the of1-labs experiments proxy. The worker does not sync personas.

---

## `/of1/config/suggestions` (DA sheet)

Columns `label`, `query` — one row per chip, 8–12 rows (the block shows a random 5 per load).

| label | query |
|---|---|
| Dark roast options | Show me all dark roast coffee options |

- `label`: short chip text, under 40 chars. `query`: full query sent to `/api/generate`.
- Sync unwraps `{data:[{label,query}]}` → `{suggestions:[…]}`; served by `/api/suggest` (landing
  chips + follow-up picks). `/status` reports `hasSuggestions`; not part of the ready gate.

---

## `/of1` page — `of1` block rows (DA document)

| Row | Value |
|---|---|
| `api-endpoint` | worker URL (`$OF1_GENWEB_URL` or prod) |
| `domain` | tenant id `<branch>--<repo>--<owner>` |
| `engine` | literal `da-blocks-slots` |
| `title` | optional — landing `<h1>` |
| `subtitle` | optional — supporting text |
| `placeholder` | optional — input placeholder |

`title`/`subtitle`/`placeholder` come from `$OF1_STATE_DIR/of1-landing.json` (written by
`of1-build-quick-suggestions`); absent rows fall back to the SDK defaults. Written by
`of1-style-generative-block` Step 5, re-run by `of1-publish` so the landing rows are present.

---

## `/of1/strategy` (DA document, optional)

Not produced by the skills. If an author creates it, sync snapshots `/of1/strategy.plain.html` and
strategy-aware personalization turns on (`/status` → `hasStrategy`). Delete it to turn strategy off.

---

## `/templates/*` (DA documents)

`of1-build-templates` authors templates as real EDS documents in `/templates` (composed from the
site's own blocks, reused first, new general blocks where useful). The worker always materializes
them with the `da-blocks-slots` engine: it enumerates `/templates` (via `/query-index.json`,
prefix-filtered), fetches each doc's `.plain.html`, and derives content-only slots structurally — no
catalog, no `.metadata.json`, no `data-slot` attributes. Per-template
`intent`/`description`/`minItems`/`maxItems` travel in each doc's `section-metadata` block.
Recognised intents: `comparison`, `recommendation`, `deep-dive`, `budget`, `discovery` (`discovery`
is the fallback). `config.templates.daPath` overrides the folder.

---

## `/of1/knowledge/**` (DA documents)

`of1-extract-content` captures site pages into `$OF1_STATE_DIR/knowledge-pages.json` (state, not
git), then publishes each as `/of1/knowledge/<slug>` (content only: `<h1>` + `<h2>`/`<p>`/`<li>`,
no blocks), previewed **and published live** so they appear in `query-index.json`. Sync indexes
them as content chunks (`content.indexed` in the sync response; `contentChunks` in `/status`).
They ground `/api/generate`, `/api/personalize` and `/api/generate-slots`.

The site's `helix-query.yaml` must index `/of1/knowledge/**`. `of1-check-dependencies` creates it
only if absent; if an existing one lacks `/of1/knowledge`, it warns and leaves it alone — then
`content.indexed` is 0 and `of1-publish` check 2 fails.

---

## Ready gate

`GET /api/tenants/<id>/status`:

```json
{
  "ready": true,
  "of1Endpoint": "https://main--repo--owner.aem.page/of1",
  "config": {
    "hasTemplates": true,
    "hasContent": true,
    "contentChunks": 42,
    "hasBrandVoice": true,
    "hasSuggestions": true,
    "hasCtaTemplate": false,
    "hasStrategy": false
  }
}
```

`ready` = renderable templates (`hasTemplates`) **and** indexed content chunks > 0 (`hasContent`).
Everything else is reported but not gated.

---

## Removed in 2026-10 (DA-first config)

No longer produced or read: `of1-endpoint.json` (endpoint derived), `templates.json` (engine is
always `da-blocks-slots`), `knowledge.json` and the legacy `products`/`features`/`faqs`/`use-cases`/
`testimonials`/`block-guide` JSON, and git `personas.json` / `suggestions.json` / `brand-voice.json`
(moved to the DA items above). A tenant synced before this change reports `ready: false` until
`of1-integration` is re-run.
