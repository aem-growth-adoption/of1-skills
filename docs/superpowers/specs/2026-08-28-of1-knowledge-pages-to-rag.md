# OF1 Knowledge Pages → Content RAG — Design

## Goal

Feed the OF1 demo agent rich, retrievable knowledge from the target site's
own pages by turning each page the demo already crawls into a bare DA
content page, published under a dedicated `/of1/knowledge/**` folder, so
the gen-web worker's existing content-ingestion phase chunks/embeds/indexes
it into the RAG (`ctx.rag.documents`).

Fast over pretty: these pages carry **content, not craft** — plain
`<h1>/<h2>/<p>` HTML, no EDS block tables, no prototype/deploy/blockify.

## Non-goals

- No changes to the gen-web worker — it already ingests `/of1/knowledge/**`
  via query-index discovery (see `of1-gen-web` content-ingestion feature).
- No new crawl: knowledge capture rides the crawl `of1-extract-content`
  already performs (product/detail pages). Broadening page scope is a later
  option.
- Not a replacement for structured extraction — products/features/faqs/
  personas still drive templates, personalization, and the Intent Map. The
  knowledge pages are an additive free-form RAG source.

## Design decisions (settled)

- **Discovery:** dedicated knowledge folder + query-index. Pages live under
  `/of1/knowledge/**`; the demo repo's `helix-query.yaml` indexes that
  folder; `contentIngestion.includePaths = ["/of1/knowledge/**"]`. The
  worker's existing Approach-A ingestion (query-index → `.plain.html` →
  chunk) finds them. No explicit-path worker change.
- **Page scope:** only pages `of1-extract-content` already opens during
  extraction (product/detail pages). No extra page loads.
- **Content home for the flag:** `contentIngestion` goes in
  `of1/config/config.json`, authored by `of1-check-dependencies` Step 6
  (alongside `knowledgeMode`, `domain`), git-committed and EDS-served.

## How OF1 works today (grounded)

- `of1-extract-content` (of1-skills) crawls product/detail pages in
  playwright batches (Steps 2–5), extracting **structured fields only**
  (name/price/description). It does not capture page text or create DA
  content pages.
- The DA-write + EDS-preview mechanism already exists:
  `assets/publish-config-da.mjs` writes docs via
  `POST admin.da.live/source/{owner}/{repo}/{path}` and makes them live via
  `POST admin.hlx.page/preview/{owner}/{repo}/{branch}/{path}`. It resolves
  the DA token itself and parallelizes uploads.
- `of1-check-dependencies` Step 6 writes `of1/config/config.json`
  (`knowledgeMode: "da-document"`, `domain`), committed to git and served at
  `/of1/config/config.json` — the tenant config the worker syncs.
- `of1-publish` commits config to git and calls the worker's
  `/api/tenants/:id/sync`, which runs the content-ingestion phase.

## Design

### 1. Capture page content (during the existing crawl)

In the same playwright eval `of1-extract-content` runs per page (Step 3),
also capture the page's main content as an ordered list of
`{ tag, text }` blocks — headings and paragraphs from `main`/`article`,
excluding `nav`/`header`/`footer`/aside. Preserve heading structure: the
worker's chunker starts a new chunk at each heading, so headings → clean
per-section chunks.

Output per page appended to `of1/config/knowledge-pages.json`:
`{ url, title, blocks: [{ tag: "h1"|"h2"|"h3"|"p"|"li", text }] }`. The
knowledge-page slug is derived from the source URL's last path segment
(URL-safe, hash-suffixed on collision) → `/of1/knowledge/{slug}`.

### 2. Write bare DA knowledge pages (new asset)

New `assets/publish-knowledge-da.mjs` (mirrors `publish-config-da.mjs`):
- For each captured page, render minimal EDS content HTML — a single
  section of `<h1>{title}</h1>` followed by the captured `<h2>/<p>/<li>`
  blocks in order. No block tables.
- `POST admin.da.live/source/{owner}/{repo}/of1/knowledge/{slug}.html`
  with that HTML, then `POST admin.hlx.page/preview/{owner}/{repo}/{branch}/
  of1/knowledge/{slug}` to make it live on `.aem.page`.
- Parallelize 8-wide; resolve the DA token like the sibling scripts.
- The capture manifest `of1/config/knowledge-pages.json` (written in §1) is the
  single artifact tracking the pages — verification (§5) counts it directly.
  No separate `knowledge-pages.txt`.

### 3. query-index coverage (verify-only)

`contentIngestion.includePaths` (§4) is the **single source of truth** for the
knowledge folder. The worker discovers pages from the site-root
`query-index.json`; most EDS repos ship a default index over all pages, so
`/of1/knowledge/**` is covered automatically with no config. Do NOT author a
second scope in `helix-query.yaml`. `of1-check-dependencies` only flags the
exclusion exception (a repo whose index config explicitly excludes `/of1/**`);
the real coverage proof is the `content.indexed` gate (§5). This keeps one knob
(`includePaths`) that can't drift against a second config.

### 4. Enable ingestion in the tenant config

`of1-check-dependencies` Step 6 adds to `of1/config/config.json`:

```jsonc
"contentIngestion": {
  "enabled": true,
  "includePaths": ["/of1/knowledge/**"],
  "maxChunkTokens": 400,
  "contentTopK": 4
}
```

### 5. Trigger + verify

`of1-publish` already calls `/api/tenants/:id/sync`; that sync now also runs
the content phase and indexes the knowledge pages. `of1-publish` verifies
`response.content.indexed >= 1` whenever `knowledge-pages.json` is non-empty
(count via `jq 'length'`) and surfaces a failure if zero were indexed — the
single check that also proves query-index coverage (§3).

## Where the changes land (of1-skills)

| Skill / asset | Change |
|---|---|
| `of1-extract-content/SKILL.md` | New step: capture page blocks to `knowledge-pages.json` during the existing crawl; call `publish-knowledge-da.mjs`. |
| `of1-extract-content/assets/publish-knowledge-da.mjs` | **New.** Render bare HTML, POST DA source + preview, 8-wide. |
| `of1-check-dependencies/SKILL.md` | Add `contentIngestion` to `config.json` (single source of truth); verify-only query-index note (patch `helix-query.yaml` only on the exclusion exception). |
| `of1-publish/SKILL.md` | Verify `content.indexed` after sync (count from `knowledge-pages.json`). |

Worker: unchanged.

## Sequencing / data flow

```
of1-extract-content crawl (existing)
  ├─ structured fields → products/faqs/... .json  (existing)
  └─ page blocks → of1/config/knowledge-pages.json (manifest)
        → publish-knowledge-da.mjs → DA /of1/knowledge/{slug}.html + EDS preview
of1-check-dependencies: config.json.contentIngestion (single source of truth)
of1-publish: /sync → worker content phase → Vectorize (contentType:"content")
runtime: ragVectorize 2nd query → ctx.rag.documents → prompt
```

## Risks / open questions

- **query-index coverage:** if the demo repo's index config explicitly excludes
  `/of1/**`, knowledge pages won't appear in query-index and ingestion finds
  nothing. This is the exception, not the default (most repos index all pages).
  Mitigation: the `content.indexed` gate fails loud; the fix is a one-time
  `helix-query.yaml` include for `/of1/knowledge/**`. `includePaths` stays the
  single source of truth either way.
- **Preview propagation timing:** a page must be previewed (live + indexed)
  before `of1-publish`'s sync runs, or the query-index lags. Sequence the
  sync after previews complete; the `content.indexed` gate catches lag.
- **Volume:** product-page scope keeps counts low (tens), well under the
  worker's per-invocation subrequest ceiling that whole-site ingestion hit.
  If page scope later broadens, revisit worker-side pagination.
- **Text quality:** stripping to `main`/`article` blocks may miss content in
  non-semantic markup; capture falls back to `body` minus nav/header/footer
  when `main`/`article` is absent.
- **Slug collisions:** two source URLs with the same last segment collide;
  dedupe by appending a short hash (mirrors the worker chunker's fix).
